/**
 * GrassExclusionManager - Manages exclusion zones where grass should not grow.
 *
 * Used by BuildingRenderingSystem, vegetation systems, and object placement to
 * prevent grass from rendering under buildings, trees, rocks, and placed objects.
 *
 * Supports:
 * - Rectangular blockers (buildings, furniture)
 * - Circular blockers (trees, rocks, poles)
 * - GPU exclusion texture generation for efficient shader sampling
 *
 * @module GrassExclusionManager
 */

/**
 * Rectangular exclusion zone data.
 */
interface RectangularBlocker {
  id: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  rotation: number;
  fadeDistance: number;
}

/**
 * Circular exclusion zone data (for trees, rocks, objects).
 */
interface CircularBlocker {
  id: string;
  centerX: number;
  centerZ: number;
  radius: number;
  fadeDistance: number;
}

/**
 * Exclusion texture data for GPU sampling.
 */
interface ExclusionTextureData {
  data: Float32Array;
  width: number;
  height: number;
  worldSize: number;
  centerX: number;
  centerZ: number;
}

/**
 * Interface for grass exclusion management.
 */
interface GrassExclusionManagerInterface {
  addRectangularBlocker(
    id: string,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    rotation?: number,
    fadeDistance?: number,
  ): void;
  removeRectangularBlocker(id: string): void;
  addCircularBlocker(
    id: string,
    centerX: number,
    centerZ: number,
    radius: number,
    fadeDistance?: number,
  ): void;
  removeCircularBlocker(id: string): void;
  getRectangularBlockers(): RectangularBlocker[];
  getCircularBlockers(): CircularBlocker[];
  getBlockers(): RectangularBlocker[];
  isPointBlocked(x: number, z: number): boolean;
  getExclusionValue(x: number, z: number): number;
  generateExclusionTexture(
    textureSize?: number,
    worldSize?: number,
    centerX?: number,
    centerZ?: number,
  ): ExclusionTextureData;
  getVersion(): number;
  onBlockersChanged(callback: () => void): () => void;
}

/**
 * Singleton grass exclusion manager.
 * Stores blockers (buildings, trees, rocks, objects) to exclude from grass rendering.
 */
class GrassExclusionManager implements GrassExclusionManagerInterface {
  private static instance: GrassExclusionManager | null = null;
  private rectangularBlockers: Map<string, RectangularBlocker> = new Map();
  private circularBlockers: Map<string, CircularBlocker> = new Map();
  private version = 0;
  private changeCallbacks: Set<() => void> = new Set();

  private constructor() {}

  static getInstance(): GrassExclusionManager {
    if (!GrassExclusionManager.instance) {
      GrassExclusionManager.instance = new GrassExclusionManager();
    }
    return GrassExclusionManager.instance;
  }

  /**
   * Get current version number (increments on changes).
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Register a callback for when blockers change.
   * Returns an unsubscribe function.
   */
  onBlockersChanged(callback: () => void): () => void {
    this.changeCallbacks.add(callback);
    return () => this.changeCallbacks.delete(callback);
  }

  private notifyChange(): void {
    this.version++;
    for (const callback of this.changeCallbacks) {
      callback();
    }
  }

  /**
   * Add a rectangular exclusion zone (e.g., building footprint).
   * @param rotation - Rotation in radians around Y-axis (default 0)
   * @param fadeDistance - Soft edge fade distance in world units (default 0.5)
   */
  addRectangularBlocker(
    id: string,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    rotation = 0,
    fadeDistance = 0.5,
  ): void {
    this.rectangularBlockers.set(id, {
      id,
      centerX,
      centerZ,
      width,
      depth,
      rotation,
      fadeDistance,
    });

    // Debug: log first few buildings for coordinate verification
    if (this.rectangularBlockers.size <= 3) {
      console.log(
        `[GrassExclusionManager] Added blocker "${id}": center=(${centerX.toFixed(1)}, ${centerZ.toFixed(1)}), ` +
          `size=${width.toFixed(1)}x${depth.toFixed(1)}, rot=${((rotation * 180) / Math.PI).toFixed(0)}° | ` +
          `Total blockers: ${this.rectangularBlockers.size}`,
      );
    }

    this.notifyChange();
  }

  /**
   * Remove a rectangular exclusion zone.
   */
  removeRectangularBlocker(id: string): void {
    if (this.rectangularBlockers.delete(id)) {
      this.notifyChange();
    }
  }

  /**
   * Add a circular exclusion zone (e.g., tree trunk, rock, object).
   * @param fadeDistance - Soft edge fade distance in world units (default 0.3)
   */
  addCircularBlocker(
    id: string,
    centerX: number,
    centerZ: number,
    radius: number,
    fadeDistance = 0.3,
  ): void {
    this.circularBlockers.set(id, {
      id,
      centerX,
      centerZ,
      radius,
      fadeDistance,
    });
    this.notifyChange();
  }

  /**
   * Remove a circular exclusion zone.
   */
  removeCircularBlocker(id: string): void {
    if (this.circularBlockers.delete(id)) {
      this.notifyChange();
    }
  }

  /**
   * Get all rectangular blockers.
   */
  getRectangularBlockers(): RectangularBlocker[] {
    return Array.from(this.rectangularBlockers.values());
  }

  /**
   * Get all circular blockers.
   */
  getCircularBlockers(): CircularBlocker[] {
    return Array.from(this.circularBlockers.values());
  }

  /**
   * Get all rectangular blockers (legacy alias).
   */
  getBlockers(): RectangularBlocker[] {
    return this.getRectangularBlockers();
  }

  /**
   * Check if a point is inside any exclusion zone.
   * Handles rotated rectangles and circles.
   */
  isPointBlocked(x: number, z: number): boolean {
    return this.getExclusionValue(x, z) > 0.5;
  }

  /**
   * Get exclusion value at a point (0 = no exclusion, 1 = fully excluded).
   * Handles soft edges via fadeDistance.
   */
  getExclusionValue(x: number, z: number): number {
    let maxExclusion = 0;

    // Check rectangular blockers
    for (const blocker of this.rectangularBlockers.values()) {
      // Transform point into blocker's local space (rotated around center)
      const dx = x - blocker.centerX;
      const dz = z - blocker.centerZ;
      const cos = Math.cos(-blocker.rotation);
      const sin = Math.sin(-blocker.rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;

      const halfW = blocker.width / 2;
      const halfD = blocker.depth / 2;

      // Distance from rectangle edge (negative = inside)
      const distX = Math.abs(localX) - halfW;
      const distZ = Math.abs(localZ) - halfD;
      const dist = Math.max(distX, distZ);

      // Calculate exclusion with fade
      let exclusion = 0;
      if (dist < 0) {
        exclusion = 1; // Inside rectangle
      } else if (blocker.fadeDistance > 0 && dist < blocker.fadeDistance) {
        exclusion = 1 - dist / blocker.fadeDistance; // Fade zone
      }

      maxExclusion = Math.max(maxExclusion, exclusion);
    }

    // Check circular blockers
    for (const blocker of this.circularBlockers.values()) {
      const dx = x - blocker.centerX;
      const dz = z - blocker.centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz) - blocker.radius;

      // Calculate exclusion with fade
      let exclusion = 0;
      if (dist < 0) {
        exclusion = 1; // Inside circle
      } else if (blocker.fadeDistance > 0 && dist < blocker.fadeDistance) {
        exclusion = 1 - dist / blocker.fadeDistance; // Fade zone
      }

      maxExclusion = Math.max(maxExclusion, exclusion);
    }

    return maxExclusion;
  }

  /**
   * Generate an exclusion texture for GPU grass culling.
   * The texture stores exclusion values (0-1) in the red channel.
   *
   * @param textureSize - Texture resolution (default 512)
   * @param worldSize - World coverage in meters (default 1000)
   * @param centerX - World center X (default 0)
   * @param centerZ - World center Z (default 0)
   */
  generateExclusionTexture(
    textureSize = 512,
    worldSize = 1000,
    centerX = 0,
    centerZ = 0,
  ): ExclusionTextureData {
    const data = new Float32Array(textureSize * textureSize);
    const halfWorld = worldSize / 2;
    const metersPerPixel = worldSize / textureSize;

    // For each pixel, calculate exclusion value
    for (let py = 0; py < textureSize; py++) {
      for (let px = 0; px < textureSize; px++) {
        // Convert pixel to world coordinates
        const worldX = centerX - halfWorld + (px + 0.5) * metersPerPixel;
        const worldZ = centerZ - halfWorld + (py + 0.5) * metersPerPixel;

        // Get exclusion value at this point
        const exclusion = this.getExclusionValue(worldX, worldZ);
        data[py * textureSize + px] = exclusion;
      }
    }

    return {
      data,
      width: textureSize,
      height: textureSize,
      worldSize,
      centerX,
      centerZ,
    };
  }

  /**
   * Clear all blockers (useful for cleanup).
   */
  clear(): void {
    const hadBlockers =
      this.rectangularBlockers.size > 0 || this.circularBlockers.size > 0;
    this.rectangularBlockers.clear();
    this.circularBlockers.clear();
    if (hadBlockers) {
      this.notifyChange();
    }
  }
}

/**
 * Get the singleton grass exclusion manager.
 */
export function getGrassExclusionManager(): GrassExclusionManagerInterface {
  return GrassExclusionManager.getInstance();
}

export type {
  GrassExclusionManagerInterface,
  RectangularBlocker,
  CircularBlocker,
  ExclusionTextureData,
};
