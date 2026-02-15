/**
 * Object Pool for Vector3 and Quaternion
 *
 * Reuses temporary objects to avoid GC pressure in hot loops.
 * These pools are module-level singletons for maximum efficiency.
 */

import * as THREE from "three";

/**
 * Simple object pool with automatic growth.
 */
class ObjectPool<T> {
  private pool: T[] = [];
  private index = 0;
  private factory: () => T;

  constructor(factory: () => T, initialSize = 64) {
    this.factory = factory;
    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /**
   * Get an object from the pool (may be dirty - reset it yourself).
   */
  acquire(): T {
    if (this.index >= this.pool.length) {
      // Grow pool
      const newSize = this.pool.length * 2;
      for (let i = this.pool.length; i < newSize; i++) {
        this.pool.push(this.factory());
      }
    }
    return this.pool[this.index++]!;
  }

  /**
   * Reset pool for next frame/operation.
   */
  reset(): void {
    this.index = 0;
  }

  /**
   * Current pool size.
   */
  get size(): number {
    return this.pool.length;
  }

  /**
   * Number of objects in use.
   */
  get used(): number {
    return this.index;
  }
}

// Global pools
const vec3Pool = new ObjectPool(() => new THREE.Vector3(), 256);
const quatPool = new ObjectPool(() => new THREE.Quaternion(), 64);
const mat4Pool = new ObjectPool(() => new THREE.Matrix4(), 16);

/**
 * Get a temporary Vector3 from the pool.
 * The returned vector may contain garbage - set or copy to it.
 */
export function tempVec3(): THREE.Vector3 {
  return vec3Pool.acquire();
}

/**
 * Get a temporary Quaternion from the pool.
 */
export function tempQuat(): THREE.Quaternion {
  return quatPool.acquire();
}

/**
 * Get a temporary Matrix4 from the pool.
 */
export function tempMat4(): THREE.Matrix4 {
  return mat4Pool.acquire();
}

/**
 * Reset all pools. Call at the start of a generation operation.
 */
export function resetPools(): void {
  vec3Pool.reset();
  quatPool.reset();
  mat4Pool.reset();
}

/**
 * Get pool statistics for debugging.
 */
export function getPoolStats(): {
  vec3: { size: number; used: number };
  quat: { size: number; used: number };
  mat4: { size: number; used: number };
} {
  return {
    vec3: { size: vec3Pool.size, used: vec3Pool.used },
    quat: { size: quatPool.size, used: quatPool.used },
    mat4: { size: mat4Pool.size, used: mat4Pool.used },
  };
}

// Pre-allocated scratch vectors for common operations
// These are for internal use only and should never be returned from functions
export const _scratch = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  v5: new THREE.Vector3(),
  v6: new THREE.Vector3(),
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  m1: new THREE.Matrix4(),
};
