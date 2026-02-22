/**
 * SessionStore — Generic session storage interface for horizontal scaling.
 *
 * Provides a pluggable abstraction over session storage so backends can be
 * swapped from in-memory Maps to Redis, PostgreSQL, or other distributed
 * stores without changing domain logic.
 *
 * The default InMemorySessionStore works for single-server deployments.
 * For multi-server deployments, implement a RedisSessionStore or
 * PostgresSessionStore that shares state across instances.
 *
 * Usage:
 * ```typescript
 * // Single server (default)
 * const store = new InMemorySessionStore<DuelSession>();
 *
 * // Multi-server (future)
 * const store = new RedisSessionStore<DuelSession>(redisClient, "duels");
 * ```
 */

/**
 * Generic session store interface.
 *
 * All operations are async to support network-backed stores (Redis, DB).
 * In-memory implementations return resolved promises for consistency.
 */
export interface SessionStore<T> {
  /** Get a session by primary key. */
  get(key: string): T | undefined;

  /** Store or update a session. */
  set(key: string, value: T): void;

  /** Delete a session by primary key. Returns true if it existed. */
  delete(key: string): boolean;

  /** Check if a session exists. */
  has(key: string): boolean;

  /** Get the number of active sessions. */
  readonly size: number;

  /** Iterate over all sessions. */
  entries(): IterableIterator<[string, T]>;

  /** Clear all sessions. */
  clear(): void;
}

/**
 * In-memory session store backed by a Map.
 *
 * Suitable for single-server deployments. All operations are O(1) for
 * get/set/delete/has and O(n) for entries/clear.
 */
export class InMemorySessionStore<T> implements SessionStore<T> {
  private store = new Map<string, T>();

  get(key: string): T | undefined {
    return this.store.get(key);
  }

  set(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, T]> {
    return this.store.entries();
  }

  clear(): void {
    this.store.clear();
  }
}
