/**
 * PositionPool - Object pool for {x, y, z} position objects
 *
 * Eliminates allocations in hot paths like position updates, movement, and combat.
 * Uses a simple pooling pattern with automatic growth.
 *
 * Performance characteristics:
 * - O(1) acquire/release operations
 * - Zero allocations after warmup (unless pool exhausted)
 * - Automatic pool growth when exhausted
 *
 * Usage:
 *   const pos = positionPool.acquire(10, 0, 20);
 *   // ... use pos ...
 *   positionPool.release(pos);
 *
 * Or with automatic release:
 *   positionPool.withPosition(10, 0, 20, (pos) => {
 *     // pos is automatically released after this callback
 *   });
 */

export interface PooledPosition {
  x: number;
  y: number;
  z: number;
  /** Internal pool index - do not modify */
  _poolIndex: number;
}

/**
 * Object pool for {x, y, z} position objects.
 * Thread-safe within single tick (no async between acquire/release).
 */
class PositionPoolImpl {
  private pool: PooledPosition[] = [];
  private available: number[] = [];
  private readonly INITIAL_SIZE = 128;
  private readonly GROW_SIZE = 64;
  private lastExhaustionWarning = 0;

  // Stats
  private _acquireCount = 0;
  private _releaseCount = 0;
  private _peakUsage = 0;

  constructor() {
    this.grow(this.INITIAL_SIZE);
  }

  /**
   * Grow the pool by adding more positions
   */
  private grow(count: number): void {
    const startIndex = this.pool.length;
    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      this.pool.push({
        x: 0,
        y: 0,
        z: 0,
        _poolIndex: index,
      });
      this.available.push(index);
    }
  }

  /**
   * Acquire a position from the pool.
   * Returns a position initialized to the given values (default 0, 0, 0).
   *
   * IMPORTANT: Must call release() when done to return to pool.
   */
  acquire(x = 0, y = 0, z = 0): PooledPosition {
    this._acquireCount++;

    if (this.available.length === 0) {
      const now = Date.now();
      if (now - this.lastExhaustionWarning > 60_000) {
        this.lastExhaustionWarning = now;
        console.warn(
          `[PositionPool] Pool exhausted (${this.pool.length}/${this.pool.length} in use), growing by ${this.GROW_SIZE}`,
        );
      }
      this.grow(this.GROW_SIZE);
    }

    const index = this.available.pop()!;
    const pos = this.pool[index];
    pos.x = x;
    pos.y = y;
    pos.z = z;

    // Track peak usage
    const inUse = this.pool.length - this.available.length;
    if (inUse > this._peakUsage) {
      this._peakUsage = inUse;
    }

    return pos;
  }

  /**
   * Release a position back to the pool.
   * Resets position to origin before returning.
   */
  release(pos: PooledPosition): void {
    this._releaseCount++;
    // Reset to origin
    pos.x = 0;
    pos.y = 0;
    pos.z = 0;
    this.available.push(pos._poolIndex);
  }

  /**
   * Acquire, use, and automatically release a position.
   * Convenience method for short-lived usage patterns.
   */
  withPosition<T>(
    x: number,
    y: number,
    z: number,
    fn: (pos: PooledPosition) => T,
  ): T {
    const pos = this.acquire(x, y, z);
    try {
      return fn(pos);
    } finally {
      this.release(pos);
    }
  }

  /**
   * Set position values in-place.
   */
  set(pos: PooledPosition, x: number, y: number, z: number): void {
    pos.x = x;
    pos.y = y;
    pos.z = z;
  }

  /**
   * Copy values from another position-like object.
   */
  copy(
    target: PooledPosition,
    source: { x: number; y: number; z: number },
  ): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
  }

  /**
   * Calculate distance squared between two positions (avoids sqrt).
   */
  distanceSquared(
    a: PooledPosition,
    b: { x: number; y: number; z: number },
  ): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Get pool statistics (for monitoring/debugging).
   */
  getStats(): {
    total: number;
    available: number;
    inUse: number;
    peakUsage: number;
    acquireCount: number;
    releaseCount: number;
  } {
    return {
      total: this.pool.length,
      available: this.available.length,
      inUse: this.pool.length - this.available.length,
      peakUsage: this._peakUsage,
      acquireCount: this._acquireCount,
      releaseCount: this._releaseCount,
    };
  }

  /**
   * Reset pool to initial state.
   * Use with caution - invalidates all acquired positions.
   */
  reset(): void {
    this.pool = [];
    this.available = [];
    this._acquireCount = 0;
    this._releaseCount = 0;
    this._peakUsage = 0;
    this.grow(this.INITIAL_SIZE);
  }
}

/**
 * Global position pool instance.
 * Use this singleton for all position operations in hot paths.
 */
export const positionPool = new PositionPoolImpl();
