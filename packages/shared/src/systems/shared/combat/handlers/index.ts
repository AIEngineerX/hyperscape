/**
 * Combat Handlers
 *
 * Polymorphic damage handling for different entity types,
 * plus attack handlers (Melee, Ranged, Magic) extracted from CombatSystem.
 */

export type { DamageHandler, DamageApplicationResult } from "./DamageHandler";
export { PlayerDamageHandler } from "./PlayerDamageHandler";
export { MobDamageHandler } from "./MobDamageHandler";

export type {
  CombatAttackContext,
  MeleeAttackData,
  AttackValidationResult,
  EquipmentStatsCache,
} from "./AttackContext";
export { MeleeAttackHandler } from "./MeleeAttackHandler";
export { RangedAttackHandler } from "./RangedAttackHandler";
export { MagicAttackHandler } from "./MagicAttackHandler";
