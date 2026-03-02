/**
 * EventPayloadPool - Factory for creating type-safe event payload pools
 *
 * Creates pools for event payloads that would otherwise be allocated
 * on every event emission. Eliminates GC pressure in high-frequency
 * event loops like combat, movement, and network updates.
 *
 * Usage:
 *   // Create a pool for a specific event type
 *   const damagePool = createEventPayloadPool<DamagePayload>(
 *     () => ({ attackerId: '', targetId: '', damage: 0, type: 'melee' }),
 *     (p) => { p.attackerId = ''; p.targetId = ''; p.damage = 0; p.type = 'melee'; }
 *   );
 *
 *   // Emit event with pooled payload
 *   const payload = damagePool.acquire();
 *   payload.attackerId = attacker.id;
 *   payload.targetId = target.id;
 *   payload.damage = 15;
 *   emitter.emit('damage', payload);
 *
 *   // Listener releases after processing
 *   emitter.on('damage', (payload) => {
 *     // ... process ...
 *     damagePool.release(payload);
 *   });
 */

/**
 * A pooled payload has a hidden pool index for tracking
 */
export interface PooledPayload {
  /** Internal pool index - do not modify */
  _poolIndex: number;
}

/**
 * Statistics for event payload pool
 */
export interface EventPayloadPoolStats {
  name: string;
  total: number;
  available: number;
  inUse: number;
  peakUsage: number;
  acquireCount: number;
  releaseCount: number;
  leakWarnings: number;
}

/**
 * Event payload pool interface
 */
export interface EventPayloadPool<T extends PooledPayload> {
  /** Acquire a payload from the pool */
  acquire(): T;
  /** Release a payload back to the pool */
  release(payload: T): void;
  /** Acquire, use, and auto-release */
  withPayload<R>(fn: (payload: T) => R): R;
  /** Get pool statistics */
  getStats(): EventPayloadPoolStats;
  /** Reset pool to initial state */
  reset(): void;
  /** Check for leaked payloads (call at end of tick) */
  checkLeaks(): number;
}

/**
 * Configuration for creating an event payload pool
 */
export interface EventPayloadPoolConfig<T extends PooledPayload> {
  /** Factory function to create a new payload */
  factory: () => Omit<T, "_poolIndex">;
  /** Reset function to clear payload state */
  reset: (payload: T) => void;
  /** Pool name for debugging */
  name: string;
  /** Initial pool size (default: 64) */
  initialSize?: number;
  /** Growth size when exhausted (default: 32) */
  growthSize?: number;
  /** Enable leak detection warnings (default: true) */
  warnOnLeaks?: boolean;
}

/**
 * Create a type-safe event payload pool
 *
 * @param config - Pool configuration
 * @returns Pool instance for acquiring/releasing payloads
 */
export function createEventPayloadPool<T extends PooledPayload>(
  config: EventPayloadPoolConfig<T>,
): EventPayloadPool<T> {
  const {
    factory,
    reset: resetFn,
    name,
    initialSize = 64,
    growthSize = 32,
    warnOnLeaks = true,
  } = config;

  const pool: T[] = [];
  const available: number[] = [];
  let lastExhaustionWarning = 0;

  // Stats
  let acquireCount = 0;
  let releaseCount = 0;
  let peakUsage = 0;
  let leakWarnings = 0;

  function grow(count: number): void {
    const startIndex = pool.length;
    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      const payload = factory() as T;
      (payload as PooledPayload)._poolIndex = index;
      pool.push(payload);
      available.push(index);
    }
  }

  // Initialize pool
  grow(initialSize);

  return {
    acquire(): T {
      acquireCount++;

      if (available.length === 0) {
        const now = Date.now();
        if (now - lastExhaustionWarning > 60_000) {
          lastExhaustionWarning = now;
          console.warn(
            `[EventPayloadPool:${name}] Pool exhausted (${pool.length}/${pool.length} in use), growing by ${growthSize}`,
          );
        }
        grow(growthSize);
      }

      const index = available.pop()!;
      const payload = pool[index];

      // Track peak usage
      const inUse = pool.length - available.length;
      if (inUse > peakUsage) {
        peakUsage = inUse;
      }

      return payload;
    },

    release(payload: T): void {
      releaseCount++;
      resetFn(payload);
      available.push(payload._poolIndex);
    },

    withPayload<R>(fn: (payload: T) => R): R {
      const payload = this.acquire();
      try {
        return fn(payload);
      } finally {
        this.release(payload);
      }
    },

    getStats(): EventPayloadPoolStats {
      return {
        name,
        total: pool.length,
        available: available.length,
        inUse: pool.length - available.length,
        peakUsage,
        acquireCount,
        releaseCount,
        leakWarnings,
      };
    },

    reset(): void {
      pool.length = 0;
      available.length = 0;
      acquireCount = 0;
      releaseCount = 0;
      peakUsage = 0;
      leakWarnings = 0;
      grow(initialSize);
    },

    checkLeaks(): number {
      const inUse = pool.length - available.length;
      if (inUse > 0 && warnOnLeaks) {
        leakWarnings++;
        if (leakWarnings <= 10) {
          console.warn(
            `[EventPayloadPool:${name}] Potential leak: ${inUse} payloads still in use at end of tick`,
          );
        } else if (leakWarnings === 11) {
          console.warn(
            `[EventPayloadPool:${name}] Suppressing further leak warnings (${leakWarnings} total)`,
          );
        }
      }
      return inUse;
    },
  };
}

/**
 * Registry of all event payload pools for monitoring
 */
class EventPayloadPoolRegistry {
  private pools: Map<string, EventPayloadPool<PooledPayload>> = new Map();

  register<T extends PooledPayload>(pool: EventPayloadPool<T>): void {
    const stats = pool.getStats();
    this.pools.set(stats.name, pool as EventPayloadPool<PooledPayload>);
  }

  unregister(name: string): void {
    this.pools.delete(name);
  }

  getAllStats(): EventPayloadPoolStats[] {
    return Array.from(this.pools.values()).map((p) => p.getStats());
  }

  checkAllLeaks(): Map<string, number> {
    const results = new Map<string, number>();
    for (const [name, pool] of this.pools) {
      const leaks = pool.checkLeaks();
      if (leaks > 0) {
        results.set(name, leaks);
      }
    }
    return results;
  }

  resetAll(): void {
    for (const pool of this.pools.values()) {
      pool.reset();
    }
  }
}

/**
 * Global registry of all event payload pools
 */
export const eventPayloadPoolRegistry = new EventPayloadPoolRegistry();
