export default function GoldLoading() {
  return (
    <div
      className="min-h-screen bg-[var(--bg-depth)]"
      aria-busy="true"
      aria-label="Loading"
    >
      {/* Header skeleton */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-transparent pt-[env(safe-area-inset-top,0px)]">
        <div className="w-full container-padding">
          <div className="flex items-center justify-between h-16 md:h-20">
            <div className="h-6 md:h-8 w-32 md:w-40 rounded bg-[var(--stone-dark)] animate-pulse" />
            <nav className="hidden md:flex items-center gap-8">
              <div className="h-4 w-12 rounded bg-[var(--stone-dark)] animate-pulse" />
              <div className="h-9 w-24 rounded bg-[var(--stone-dark)] animate-pulse" />
            </nav>
          </div>
        </div>
      </header>

      {/* Gold token card skeleton */}
      <main id="main-content" className="relative z-10 pt-16 md:pt-20">
        <div className="container-padding py-12 md:py-16">
          <div className="max-w-4xl mx-auto">
            {/* Token card skeleton */}
            <div className="card-premium p-8 md:p-12 rounded-xl">
              <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
                {/* Left: title + stats */}
                <div className="flex-1 w-full space-y-6">
                  <div className="h-10 md:h-12 w-48 rounded bg-[var(--stone-dark)] animate-pulse" />
                  <div className="h-4 w-full max-w-md rounded bg-[var(--stone-dark)] animate-pulse opacity-80" />
                  <div className="h-4 w-3/4 rounded bg-[var(--stone-dark)] animate-pulse opacity-60" />
                  <div className="flex flex-wrap gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="stat-panel min-w-[6rem]">
                        <div className="h-3 w-12 rounded bg-[var(--stone-dark)] animate-pulse mb-2" />
                        <div className="h-5 w-16 rounded bg-[var(--stone-dark)] animate-pulse opacity-80" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <div className="h-10 w-36 rounded bg-[var(--stone-dark)] animate-pulse" />
                    <div className="h-10 w-28 rounded bg-[var(--stone-dark)] animate-pulse" />
                  </div>
                </div>
                {/* Right: token image placeholder */}
                <div className="flex-shrink-0">
                  <div className="w-40 h-40 md:w-48 md:h-48 rounded-full bg-[var(--stone-dark)] animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
