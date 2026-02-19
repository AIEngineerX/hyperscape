/**
 * BFS Pathfinder — OSRS "Smartpathing"
 *
 * OSRS player movement uses BFS ("smartpathing") as the primary algorithm.
 * Naive/dumb diagonal pathing is ONLY used by NPC chase movement (see ChasePathfinding.ts).
 *
 * Key features:
 * - BFS with OSRS neighbor order (W,E,S,N,SW,SE,NW,NE)
 * - findPathToAny(): Multi-destination BFS for combat — terminates at the first
 *   valid combat tile reached, naturally finding the shortest path.
 * - findNaivePath(): Exposed for NPC chase systems only, never called from findPath().
 *
 * @see https://oldschool.runescape.wiki/w/Pathfinding
 */

import {
  TileCoord,
  TILE_DIRECTIONS,
  PATHFIND_RADIUS,
  MAX_PATH_LENGTH as _MAX_PATH_LENGTH,
  tileKey,
  tilesEqual,
  isDiagonal,
} from "./TileSystem";
import { bfsPool } from "./ObjectPools";

/**
 * Walkability check function type
 * Takes a tile and optional "from" tile for directional blocking
 */
export type WalkabilityChecker = (
  tile: TileCoord,
  fromTile?: TileCoord,
) => boolean;

/**
 * BFS Pathfinder for tile-based movement
 */
export class BFSPathfinder {
  /**
   * Find a path from start to end using BFS (OSRS "smartpathing").
   * BFS is the primary pathfinder for all player movement.
   */
  findPath(
    start: TileCoord,
    end: TileCoord,
    isWalkable: WalkabilityChecker,
  ): TileCoord[] {
    // Already at destination
    if (tilesEqual(start, end)) {
      return [];
    }

    // Check if end is walkable
    if (!isWalkable(end)) {
      // Find nearest walkable tile to destination
      const nearestWalkable = this.findNearestWalkable(end, isWalkable);
      if (!nearestWalkable) {
        return []; // No path possible
      }
      end = nearestWalkable;
    }

    // BFS is the primary pathfinder (OSRS "smartpathing")
    return this.findBFSPath(start, end, isWalkable);
  }

  /**
   * Multi-destination BFS: find shortest path from start to ANY destination tile.
   *
   * OSRS combat pathfinding feeds all valid interaction tiles into the pathfinder
   * and terminates as soon as any is reached. This naturally finds the shortest
   * path to the closest valid combat tile.
   *
   * @param start - Starting tile
   * @param destinations - Array of valid destination tiles (e.g. all tiles in attack range with LoS)
   * @param isWalkable - Walkability checker
   * @returns Shortest path to the nearest reachable destination, or [] if none reachable
   */
  findPathToAny(
    start: TileCoord,
    destinations: TileCoord[],
    isWalkable: WalkabilityChecker,
  ): TileCoord[] {
    if (destinations.length === 0) return [];

    // Check if already at any destination
    for (const dest of destinations) {
      if (tilesEqual(start, dest)) return [];
    }

    // Build destination lookup set for O(1) checks
    const destSet = new Set<string>();
    for (const dest of destinations) {
      destSet.add(tileKey(dest));
    }

    // Standard BFS from start, terminate at first destination hit
    const pooledData = bfsPool.acquire();
    const { visited, parent, queue } = pooledData;

    try {
      queue.push(start);
      visited.add(tileKey(start));

      const minX = start.x - PATHFIND_RADIUS;
      const maxX = start.x + PATHFIND_RADIUS;
      const minZ = start.z - PATHFIND_RADIUS;
      const maxZ = start.z + PATHFIND_RADIUS;
      let front = 0;

      while (front < queue.length) {
        const current = queue[front++];

        // Check if we reached ANY destination
        if (destSet.has(tileKey(current))) {
          return this.reconstructPath(start, current, parent);
        }

        // Expand neighbors in OSRS order
        for (const dir of TILE_DIRECTIONS) {
          const nx = current.x + dir.x;
          const nz = current.z + dir.z;
          if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;

          const neighborKey = `${nx},${nz}`;
          if (visited.has(neighborKey)) continue;

          const neighbor: TileCoord = { x: nx, z: nz };
          if (!this.canMoveTo(current, neighbor, isWalkable)) continue;

          visited.add(neighborKey);
          parent.set(neighborKey, current);
          queue.push(neighbor);
        }
      }

      // No destination reachable — partial path to closest destination
      return this.findPartialPathToAny(start, destinations, visited, parent);
    } finally {
      bfsPool.release(pooledData);
    }
  }

  /**
   * Naive diagonal pathing — "dumb pathfinding" for NPC chase systems.
   * Moves diagonally toward target first, then cardinally.
   * This is NOT used for player movement (players use BFS).
   *
   * Exposed publicly for ChasePathfinding and NPC follow systems.
   */
  findNaivePath(
    start: TileCoord,
    end: TileCoord,
    isWalkable: WalkabilityChecker,
  ): TileCoord[] {
    const path: TileCoord[] = [];
    let current = { ...start };

    const maxIterations = 500;
    let iterations = 0;

    while (!tilesEqual(current, end) && iterations < maxIterations) {
      iterations++;

      const dx = Math.sign(end.x - current.x);
      const dz = Math.sign(end.z - current.z);

      let nextTile: TileCoord | null = null;

      if (dx !== 0 && dz !== 0) {
        const diagonal: TileCoord = { x: current.x + dx, z: current.z + dz };

        if (this.canMoveTo(current, diagonal, isWalkable)) {
          nextTile = diagonal;
        } else {
          const xDist = Math.abs(end.x - current.x);
          const zDist = Math.abs(end.z - current.z);

          if (xDist >= zDist) {
            const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
            const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
            if (this.canMoveTo(current, cardinalX, isWalkable)) {
              nextTile = cardinalX;
            } else if (this.canMoveTo(current, cardinalZ, isWalkable)) {
              nextTile = cardinalZ;
            }
          } else {
            const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
            const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
            if (this.canMoveTo(current, cardinalZ, isWalkable)) {
              nextTile = cardinalZ;
            } else if (this.canMoveTo(current, cardinalX, isWalkable)) {
              nextTile = cardinalX;
            }
          }
        }
      } else if (dx !== 0) {
        const cardinalX: TileCoord = { x: current.x + dx, z: current.z };
        if (this.canMoveTo(current, cardinalX, isWalkable)) {
          nextTile = cardinalX;
        }
      } else if (dz !== 0) {
        const cardinalZ: TileCoord = { x: current.x, z: current.z + dz };
        if (this.canMoveTo(current, cardinalZ, isWalkable)) {
          nextTile = cardinalZ;
        }
      }

      if (!nextTile) {
        return [];
      }

      path.push(nextTile);
      current = nextTile;

      if (path.length > 200) {
        return path;
      }
    }

    return path;
  }

  /**
   * BFS pathfinding — primary pathfinder for player movement.
   *
   * Uses object pool to minimize allocations in this hot path.
   */
  private findBFSPath(
    start: TileCoord,
    end: TileCoord,
    isWalkable: WalkabilityChecker,
  ): TileCoord[] {
    // Acquire pooled data structures to avoid per-call allocations
    const pooledData = bfsPool.acquire();
    const { visited, parent, queue } = pooledData;

    try {
      // Start BFS from start tile
      queue.push(start);
      visited.add(tileKey(start));

      // Track bounds for 128x128 limit
      const minX = start.x - PATHFIND_RADIUS;
      const maxX = start.x + PATHFIND_RADIUS;
      const minZ = start.z - PATHFIND_RADIUS;
      const maxZ = start.z + PATHFIND_RADIUS;

      // Front-pointer index: avoids O(n) queue.shift() — reads advance the pointer,
      // the underlying array is truncated on release by bfsPool.
      let front = 0;

      while (front < queue.length) {
        const current = queue[front++];

        // Found the destination
        if (tilesEqual(current, end)) {
          return this.reconstructPath(start, end, parent);
        }

        // Check all 8 directions in OSRS order: W, E, S, N, SW, SE, NW, NE
        for (const dir of TILE_DIRECTIONS) {
          const nx = current.x + dir.x;
          const nz = current.z + dir.z;

          // Skip if out of search bounds
          if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) {
            continue;
          }

          const neighborKey = `${nx},${nz}`;

          // Skip if already visited
          if (visited.has(neighborKey)) {
            continue;
          }

          const neighbor: TileCoord = { x: nx, z: nz };

          // Check walkability (including diagonal corner checks)
          if (!this.canMoveTo(current, neighbor, isWalkable)) {
            continue;
          }

          // Add to queue
          visited.add(neighborKey);
          parent.set(neighborKey, current);
          queue.push(neighbor);
        }
      }

      // No path found - return partial path to closest point
      return this.findPartialPath(start, end, visited, parent);
    } finally {
      // Always release back to pool
      bfsPool.release(pooledData);
    }
  }

  /**
   * Check if movement from one tile to another is valid.
   * Handles diagonal corner clipping prevention.
   */
  canMoveTo(
    from: TileCoord,
    to: TileCoord,
    isWalkable: WalkabilityChecker,
  ): boolean {
    // Target must be walkable
    if (!isWalkable(to, from)) {
      return false;
    }

    const dx = to.x - from.x;
    const dz = to.z - from.z;

    // For diagonal movement, check corner clipping
    if (isDiagonal(dx, dz)) {
      // Check both adjacent cardinal tiles
      const cardinalX: TileCoord = { x: from.x + dx, z: from.z };
      const cardinalZ: TileCoord = { x: from.x, z: from.z + dz };

      // Both adjacent tiles must be walkable to prevent corner clipping
      if (!isWalkable(cardinalX, from) || !isWalkable(cardinalZ, from)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Reconstruct path from BFS parent map
   * Returns FULL TILE-BY-TILE path from start (exclusive) to end (inclusive)
   */
  private reconstructPath(
    start: TileCoord,
    end: TileCoord,
    parent: Map<string, TileCoord>,
  ): TileCoord[] {
    const fullPath: TileCoord[] = [];
    let current = end;

    // Trace back from end to start
    while (!tilesEqual(current, start)) {
      fullPath.unshift(current);
      const parentTile = parent.get(tileKey(current));
      if (!parentTile) break;
      current = parentTile;
    }

    // Limit to reasonable max to prevent memory issues
    if (fullPath.length > 200) {
      return fullPath.slice(0, 200);
    }

    return fullPath;
  }

  /**
   * Find nearest walkable tile to a target
   * Used when destination is blocked
   */
  private findNearestWalkable(
    target: TileCoord,
    isWalkable: WalkabilityChecker,
  ): TileCoord | null {
    // Check tiles in expanding rings around target
    for (let radius = 1; radius <= 5; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          // Only check tiles on the edge of this ring
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) {
            continue;
          }

          const tile: TileCoord = {
            x: target.x + dx,
            z: target.z + dz,
          };

          if (isWalkable(tile)) {
            return tile;
          }
        }
      }
    }

    return null;
  }

  /**
   * Find a partial path when destination is unreachable
   * Returns path to the closest visited tile to the destination
   */
  private findPartialPath(
    start: TileCoord,
    end: TileCoord,
    visited: Set<string>,
    parent: Map<string, TileCoord>,
  ): TileCoord[] {
    // Find the visited tile closest to the destination
    let closestTile: TileCoord | null = null;
    let closestDistance = Infinity;

    for (const key of visited) {
      const [x, z] = key.split(",").map(Number);
      const tile: TileCoord = { x, z };
      const distance = Math.abs(tile.x - end.x) + Math.abs(tile.z - end.z);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestTile = tile;
      }
    }

    if (!closestTile || tilesEqual(closestTile, start)) {
      return [];
    }

    return this.reconstructPath(start, closestTile, parent);
  }

  /**
   * Find a partial path when no destination is reachable (multi-destination variant).
   * Returns path to the visited tile closest to any destination.
   */
  private findPartialPathToAny(
    start: TileCoord,
    destinations: TileCoord[],
    visited: Set<string>,
    parent: Map<string, TileCoord>,
  ): TileCoord[] {
    let closestTile: TileCoord | null = null;
    let closestDistance = Infinity;

    for (const key of visited) {
      const [x, z] = key.split(",").map(Number);
      const tile: TileCoord = { x, z };

      // Find minimum Manhattan distance to any destination
      let minDist = Infinity;
      for (const dest of destinations) {
        const distance = Math.abs(tile.x - dest.x) + Math.abs(tile.z - dest.z);
        if (distance < minDist) minDist = distance;
      }

      if (minDist < closestDistance) {
        closestDistance = minDist;
        closestTile = tile;
      }
    }

    if (!closestTile || tilesEqual(closestTile, start)) {
      return [];
    }

    return this.reconstructPath(start, closestTile, parent);
  }

  /**
   * Calculate path length (in tiles walked, not checkpoints)
   */
  getPathLength(path: TileCoord[]): number {
    if (path.length <= 1) {
      return path.length;
    }

    let length = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = Math.abs(path[i].x - path[i - 1].x);
      const dz = Math.abs(path[i].z - path[i - 1].z);
      // Diagonal counts as 1 tile (Chebyshev distance)
      length += Math.max(dx, dz);
    }

    return length;
  }
}
