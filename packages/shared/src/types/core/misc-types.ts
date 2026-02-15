/**
 * Miscellaneous Types
 * All other shared type definitions including dialogue, spawning, movement, processing, death, world, resources, NPCs, interactions, UI, systems, banking, etc.
 */

import THREE from "../../extras/three/three";
import type { Position3D } from "./base-types";
import type { World } from "../../core/World";

// Export core re-exports
export type { World, Position3D };
export { ItemRarity } from "../entities";

// Re-export from item-types to maintain compatibility
export {
  WeaponType,
  ItemType,
  EquipmentSlotName,
  AttackType,
} from "../game/item-types";
export type { EquipmentSlotType } from "../game/item-types";

// Re-export from combat-types
export type { CombatStyle } from "../game/combat-types";

// All other interfaces from core.ts bundled here
// (Due to time constraints, including ALL remaining interfaces in one file)
// This can be further modularized later if needed

// Movement types
export interface MovementComponent {
  position: Position3D;
  velocity: THREE.Vector3;
  targetPosition: Position3D | null;
  destination: Position3D | null;
  speed: number;
  movementSpeed: number;
  isMoving: boolean;
  path: Position3D[];
  pathNodes: Position3D[];
  currentPathIndex: number;
  lastMovementTime: number;
}

export interface Waypoint {
  position: THREE.Vector3;
  isCorner?: boolean;
}

export interface PathRequest {
  playerId: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  callback: (path: THREE.Vector3[]) => void;
}

export interface ClickToMoveEvent {
  type: "click-to-move";
  playerId: string;
  targetPosition: Position3D;
  timestamp: number;
}

export interface PlayerPositionUpdatedEvent {
  type: "player-position-updated";
  playerId: string;
  position: Position3D;
}

// All remaining types bundled together for expediency
// TODO: Further modularize if time permits

// ============================================================================
// ASSET LOADING PRIORITY
// ============================================================================

/**
 * Priority levels for asset loading across all systems.
 *
 * Used by ClientLoader, ImpostorManager, LODManager, and VegetationSystem
 * to coordinate loading priority based on distance from player.
 *
 * Lower numbers = higher priority = loads first.
 */
export enum LoadPriority {
  /** Immediately needed - block if necessary (player, UI, adjacent tiles) */
  CRITICAL = 0,
  /** High priority - load ASAP (1-2 tiles away, visible objects) */
  HIGH = 1,
  /** Normal priority - load when capacity available (2-3 tiles) */
  NORMAL = 2,
  /** Low priority - background load during idle (3+ tiles) */
  LOW = 3,
  /** Prefetch - speculative loading based on movement prediction */
  PREFETCH = 4,
}

/**
 * Request for prioritized file loading
 */
export interface PrioritizedLoadRequest {
  /** URL to load */
  url: string;
  /** Loading priority */
  priority: LoadPriority;
  /** World position for distance-based priority updates (optional) */
  position?: THREE.Vector3;
  /** Tile coordinates for tile-based priority (optional) */
  tile?: { x: number; z: number };
  /** Resolve function from the promise */
  resolve: (file: File | undefined) => void;
}
