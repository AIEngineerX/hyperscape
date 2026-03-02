/**
 * Spatial Index for Interest Management
 *
 * Tracks player positions in a region-based grid (21×21 tiles per region,
 * matching AggroSystem) to enable O(k) nearby-player queries instead of
 * O(n) full broadcasts.
 *
 * Used by BroadcastManager.sendToNearby() to limit network traffic to
 * players who can actually see the event.
 */

/** Region size in tiles — matches AggroSystem TOLERANCE_REGION_SIZE */
const REGION_SIZE = 21;

export class SpatialIndex {
  /** regionKey (numeric) → Set<playerId> - uses numeric keys to avoid string allocations */
  private playersByRegion = new Map<number, Set<string>>();
  /** playerId → regionKey (numeric) */
  private playerRegion = new Map<string, number>();

  /** Pre-allocated buffer for zero-allocation queries */
  private readonly _nearbyBuffer: string[] = [];

  /** Large prime for region key calculation to minimize collisions */
  private static readonly REGION_KEY_OFFSET = 1_000_000;

  /**
   * Update (or insert) a player's position in the index.
   * Call this on every PLAYER_POSITION_UPDATED event.
   */
  updatePlayerPosition(playerId: string, worldX: number, worldZ: number): void {
    const tileX = Math.floor(worldX);
    const tileZ = Math.floor(worldZ);
    const newKey = this.regionKey(tileX, tileZ);
    const oldKey = this.playerRegion.get(playerId);

    if (oldKey === newKey) return; // No region change

    // Remove from old region
    if (oldKey !== undefined) {
      const oldSet = this.playersByRegion.get(oldKey);
      if (oldSet) {
        oldSet.delete(playerId);
        if (oldSet.size === 0) {
          this.playersByRegion.delete(oldKey);
        }
      }
    }

    // Add to new region
    let regionSet = this.playersByRegion.get(newKey);
    if (!regionSet) {
      regionSet = new Set();
      this.playersByRegion.set(newKey, regionSet);
    }
    regionSet.add(playerId);
    this.playerRegion.set(playerId, newKey);
  }

  /**
   * Get player IDs within a 3×3 region grid (~63×63 tiles) around a world position.
   *
   * Returns an internal buffer — callers must consume before the next call.
   */
  getPlayersNear(worldX: number, worldZ: number): string[] {
    const tileX = Math.floor(worldX);
    const tileZ = Math.floor(worldZ);
    const centerRX = Math.floor(tileX / REGION_SIZE);
    const centerRZ = Math.floor(tileZ / REGION_SIZE);

    const buf = this._nearbyBuffer;
    buf.length = 0;

    // PERF: Use numeric keys to avoid string allocations in hot path
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = this.regionKeyFromCoords(centerRX + dx, centerRZ + dz);
        const players = this.playersByRegion.get(key);
        if (players) {
          for (const pid of players) {
            buf.push(pid);
          }
        }
      }
    }

    return buf;
  }

  /**
   * Remove a player from the index (call on disconnect / entity removal).
   */
  removePlayer(playerId: string): void {
    const regionKey = this.playerRegion.get(playerId);
    if (regionKey !== undefined) {
      const regionSet = this.playersByRegion.get(regionKey);
      if (regionSet) {
        regionSet.delete(playerId);
        if (regionSet.size === 0) {
          this.playersByRegion.delete(regionKey);
        }
      }
      this.playerRegion.delete(playerId);
    }
  }

  /** Discard all tracking data. */
  destroy(): void {
    this.playersByRegion.clear();
    this.playerRegion.clear();
    this._nearbyBuffer.length = 0;
  }

  /** Calculate numeric region key - avoids string allocation */
  private regionKey(tileX: number, tileZ: number): number {
    const rx = Math.floor(tileX / REGION_SIZE);
    const rz = Math.floor(tileZ / REGION_SIZE);
    // Use offset to handle negative coordinates: key = (rx + offset) * 2*offset + (rz + offset)
    return (
      (rx + SpatialIndex.REGION_KEY_OFFSET) *
        (2 * SpatialIndex.REGION_KEY_OFFSET) +
      (rz + SpatialIndex.REGION_KEY_OFFSET)
    );
  }

  /** Calculate numeric region key from region coordinates */
  private regionKeyFromCoords(rx: number, rz: number): number {
    return (
      (rx + SpatialIndex.REGION_KEY_OFFSET) *
        (2 * SpatialIndex.REGION_KEY_OFFSET) +
      (rz + SpatialIndex.REGION_KEY_OFFSET)
    );
  }
}
