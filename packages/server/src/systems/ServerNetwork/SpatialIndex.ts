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
  /** regionId → Set<playerId> */
  private playersByRegion = new Map<string, Set<string>>();
  /** playerId → regionId */
  private playerRegion = new Map<string, string>();

  /** Pre-allocated buffer for zero-allocation queries */
  private readonly _nearbyBuffer: string[] = [];

  /**
   * Update (or insert) a player's position in the index.
   * Call this on every PLAYER_POSITION_UPDATED event.
   */
  updatePlayerPosition(playerId: string, worldX: number, worldZ: number): void {
    const tileX = Math.floor(worldX);
    const tileZ = Math.floor(worldZ);
    const regionId = this.regionId(tileX, tileZ);
    const oldRegion = this.playerRegion.get(playerId);

    if (oldRegion === regionId) return; // No region change

    // Remove from old region
    if (oldRegion) {
      const oldSet = this.playersByRegion.get(oldRegion);
      if (oldSet) {
        oldSet.delete(playerId);
        if (oldSet.size === 0) {
          this.playersByRegion.delete(oldRegion);
        }
      }
    }

    // Add to new region
    let regionSet = this.playersByRegion.get(regionId);
    if (!regionSet) {
      regionSet = new Set();
      this.playersByRegion.set(regionId, regionSet);
    }
    regionSet.add(playerId);
    this.playerRegion.set(playerId, regionId);
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

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const rid = `${centerRX + dx}:${centerRZ + dz}`;
        const players = this.playersByRegion.get(rid);
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
    const regionId = this.playerRegion.get(playerId);
    if (regionId) {
      const regionSet = this.playersByRegion.get(regionId);
      if (regionSet) {
        regionSet.delete(playerId);
        if (regionSet.size === 0) {
          this.playersByRegion.delete(regionId);
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

  private regionId(tileX: number, tileZ: number): string {
    const rx = Math.floor(tileX / REGION_SIZE);
    const rz = Math.floor(tileZ / REGION_SIZE);
    return `${rx}:${rz}`;
  }
}
