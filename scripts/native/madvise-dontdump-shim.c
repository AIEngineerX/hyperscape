#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stddef.h>
#include <sys/mman.h>

/*
 * MADV_DONTDUMP is Linux-specific; keep build portable for local dev hosts.
 * Linux value: 16 (include/uapi/asm-generic/mman-common.h).
 */
#ifndef MADV_DONTDUMP
#define MADV_DONTDUMP 16
#endif

/*
 * Bun/JSC can hot-loop on madvise(MADV_DONTDUMP) when the kernel returns
 * EAGAIN under sustained allocator churn. Treat that specific transient as
 * success so the runtime does not spin and starve the event loop.
 */
int madvise(void *addr, size_t length, int advice) {
  typedef int (*madvise_fn)(void *, size_t, int);
  static madvise_fn real_madvise = NULL;

  if (!real_madvise) {
    real_madvise = (madvise_fn)dlsym(RTLD_NEXT, "madvise");
    if (!real_madvise) {
      errno = ENOSYS;
      return -1;
    }
  }

  const int rc = real_madvise(addr, length, advice);
  if (rc == -1 && advice == MADV_DONTDUMP && errno == EAGAIN) {
    return 0;
  }
  return rc;
}
