/**
 * Combat Types
 * All combat-related type definitions
 */

import type { Position3D } from "../core/base-types";
import type { AttackType } from "../game/item-types";
import type { CombatStyle } from "../../utils/game/CombatCalculations";

// Re-export CombatStyle from CombatCalculations (single source of truth)
// This includes the 4 melee styles: accurate, aggressive, defensive, controlled
export type { CombatStyle };

// Extended combat style type that includes ranged/magic
export type CombatStyleExtended =
  | "accurate"
  | "aggressive"
  | "defensive"
  | "controlled"
  | "longrange"
  | "rapid"
  | "autocast";

// Re-export ranged/magic style types and constants from CombatConstants (canonical location)
export type {
  RangedCombatStyle,
  MagicCombatStyle,
  RangedStyleBonus,
  MagicStyleBonus,
} from "../../constants/CombatConstants";

export {
  RANGED_STYLE_BONUSES,
  MAGIC_STYLE_BONUSES,
} from "../../constants/CombatConstants";

export interface CombatData {
  attackerId: string;
  targetId: string;
  attackerType: "player" | "mob";
  targetType: "player" | "mob";
  startTime: number;
  lastAttackTime: number;
  combatStyle: CombatStyle | null;
}

export interface CombatStateData {
  isInCombat: boolean;
  target: string | null;
  lastAttackTime: number;
  attackCooldown: number;
  damage: number;
  range: number;
}

export interface CombatTarget {
  entityId: string;
  entityType: "player" | "mob";
  distance: number;
  playerId: string;
  threat: number;
  position: Position3D;
  lastSeen: number;
}

// Attack style interfaces
export interface AttackStyle {
  id: string;
  name: string;
  description: string;
  xpDistribution: {
    attack: number;
    strength: number;
    defense: number;
    constitution: number;
  };
  icon: string;
}

// Animation system types
export interface AnimationTask {
  id: string;
  entityId: string;
  targetId?: string;
  animationName: string;
  duration: number;
  attackType: AttackType;
  style: CombatStyle;
  damage?: number;
  startTime: number;
  progress: number;
  cancelled?: boolean;
}

// Combat utility result types
export interface CanAttackResult {
  canAttack: boolean;
  reason?: string;
}

export interface CombatAttackResult {
  success: boolean;
  reason?: string;
  damage?: number;
}
