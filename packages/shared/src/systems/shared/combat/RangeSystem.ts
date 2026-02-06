/**
 * Range calculations for NPC aggro and combat.
 * Three range types: Hunt (SW tile), Attack (all tiles), Max (leash).
 */

import type { TileCoord } from "../movement/TileSystem";
import {
  worldToTile,
  tileChebyshevDistance,
  tilesWithinMeleeRange,
} from "../movement/TileSystem";
import { AttackType } from "../../../types/core/core";
import type { Position3D } from "../../../types";
import { TILE_SIZE } from "../movement/TileSystem";
import { Logger } from "../../../utils/Logger";

/** Track which NPC sizes have already triggered a buffer overflow warning */
const _warnedOversizedNPCs = new Set<string>();

export interface NPCSize {
  width: number;
  depth: number;
}

export interface NPCRangeData {
  position: Position3D;
  size: NPCSize;
  huntRange: number;
  attackRange: number;
  maxRange: number;
  attackType: AttackType;
}

export const NPC_SIZES: Record<string, NPCSize> = {
  // 1x1 (default)
  goblin: { width: 1, depth: 1 },
  cow: { width: 1, depth: 1 },
  chicken: { width: 1, depth: 1 },
  rat: { width: 1, depth: 1 },
  spider: { width: 1, depth: 1 },
  skeleton: { width: 1, depth: 1 },
  zombie: { width: 1, depth: 1 },
  imp: { width: 1, depth: 1 },

  // 2x2
  general_graardor: { width: 2, depth: 2 },
  kril_tsutsaroth: { width: 2, depth: 2 },
  commander_zilyana: { width: 2, depth: 2 },
  kreearra: { width: 2, depth: 2 },
  giant_mole: { width: 2, depth: 2 },
  kalphite_queen: { width: 2, depth: 2 },

  // 3x3
  corporeal_beast: { width: 3, depth: 3 },
  cerberus: { width: 3, depth: 3 },
  king_black_dragon: { width: 3, depth: 3 },

  // 4x4
  vorkath: { width: 4, depth: 4 },

  // 5x5
  olm_head: { width: 5, depth: 5 },
};

export function getNPCSize(mobType: string): NPCSize {
  return NPC_SIZES[mobType.toLowerCase()] ?? { width: 1, depth: 1 };
}

/** Pre-allocates tile buffers for zero-GC range checks */
export class RangeSystem {
  private readonly _tileBuffer: TileCoord = { x: 0, z: 0 };
  private readonly _occupiedTiles: TileCoord[] = [];

  constructor() {
    for (let i = 0; i < 25; i++) {
      this._occupiedTiles.push({ x: 0, z: 0 });
    }
  }

  /** Hunt range: measured from SW tile only */
  isInHuntRange(npc: NPCRangeData, playerPos: Position3D): boolean {
    const npcSWTile = this.getSWTile(npc.position);
    const playerTile = worldToTile(playerPos.x, playerPos.z);
    return tileChebyshevDistance(npcSWTile, playerTile) <= npc.huntRange;
  }

  /** Attack range: measured from ALL occupied tiles */
  isInAttackRange(npc: NPCRangeData, playerPos: Position3D): boolean {
    const playerTile = worldToTile(playerPos.x, playerPos.z);
    const occupiedCount = this.getOccupiedTiles(npc.position, npc.size);

    for (let i = 0; i < occupiedCount; i++) {
      if (
        this.checkAttackRange(
          this._occupiedTiles[i],
          playerTile,
          npc.attackType,
          npc.attackRange,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /** Max range: for leashing (SW tile to spawn) */
  isWithinMaxRange(npc: NPCRangeData, spawnPoint: TileCoord): boolean {
    const npcSWTile = this.getSWTile(npc.position);
    return tileChebyshevDistance(npcSWTile, spawnPoint) <= npc.maxRange;
  }

  getDistanceToTarget(npcPos: Position3D, targetPos: Position3D): number {
    const npcTile = worldToTile(npcPos.x, npcPos.z);
    const targetTile = worldToTile(targetPos.x, targetPos.z);
    return tileChebyshevDistance(npcTile, targetTile);
  }

  getSWTile(npcPos: Position3D): TileCoord {
    this._tileBuffer.x = Math.floor(npcPos.x / TILE_SIZE);
    this._tileBuffer.z = Math.floor(npcPos.z / TILE_SIZE);
    return this._tileBuffer;
  }

  /** Returns count of tiles filled into buffer */
  getOccupiedTiles(npcPos: Position3D, size: NPCSize): number {
    const swTile = this.getSWTile(npcPos);
    const width = size.width || 1;
    const depth = size.depth || 1;

    const totalTiles = width * depth;
    if (totalTiles > this._occupiedTiles.length) {
      const sizeKey = `${width}x${depth}`;
      if (!_warnedOversizedNPCs.has(sizeKey)) {
        _warnedOversizedNPCs.add(sizeKey);
        Logger.systemWarn(
          "RangeSystem",
          `NPC size ${sizeKey} exceeds tile buffer capacity (${this._occupiedTiles.length}), range checks will be truncated`,
          {
            width,
            depth,
            totalTiles,
            bufferCapacity: this._occupiedTiles.length,
          },
        );
      }
    }

    let index = 0;
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        if (index < this._occupiedTiles.length) {
          this._occupiedTiles[index].x = swTile.x + dx;
          this._occupiedTiles[index].z = swTile.z + dz;
          index++;
        }
      }
    }

    return index;
  }

  getOccupiedTilesBuffer(): readonly TileCoord[] {
    return this._occupiedTiles;
  }

  isTileOccupied(tile: TileCoord, npcPos: Position3D, size: NPCSize): boolean {
    const swTile = this.getSWTile(npcPos);
    return (
      tile.x >= swTile.x &&
      tile.x < swTile.x + (size.width || 1) &&
      tile.z >= swTile.z &&
      tile.z < swTile.z + (size.depth || 1)
    );
  }

  /** Melee range 1 = cardinal only; range 2+ includes diagonals */
  private checkAttackRange(
    attackerTile: TileCoord,
    targetTile: TileCoord,
    attackType: AttackType,
    range: number,
  ): boolean {
    if (attackType === AttackType.MELEE) {
      return tilesWithinMeleeRange(attackerTile, targetTile, range);
    }
    const distance = tileChebyshevDistance(attackerTile, targetTile);
    return distance <= range && distance > 0;
  }
}

let _rangeSystemInstance: RangeSystem | null = null;

export function getRangeSystem(): RangeSystem {
  if (!_rangeSystemInstance) {
    _rangeSystemInstance = new RangeSystem();
  }
  return _rangeSystemInstance;
}
