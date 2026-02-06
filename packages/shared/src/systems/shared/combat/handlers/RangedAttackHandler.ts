/**
 * RangedAttackHandler - Handles ranged attack validation, projectile creation, and damage.
 *
 * Extracted from CombatSystem to reduce class size.
 * Pre-allocates RangedDamageParams to eliminate per-attack heap allocations.
 */

import type { CombatAttackContext } from "./AttackContext";
import { EntityID } from "../../../../types/core/identifiers";
import { AttackType } from "../../../../types/core/core";
import { EventType } from "../../../../types/events";
import { COMBAT_CONSTANTS } from "../../../../constants/CombatConstants";
import { createEntityID } from "../../../../utils/IdentifierUtils";
import {
  CombatViolationType,
  CombatViolationSeverity,
} from "../CombatAntiCheat";
import { getEntityPosition } from "../../../../utils/game/EntityPositionUtils";
import { tilePool } from "../../../../utils/pools/TilePool";
import { tileChebyshevDistance } from "../../movement/TileSystem";
import { isMobEntity } from "../../../../utils/typeGuards";
import {
  calculateRangedDamage,
  type RangedDamageParams,
} from "../RangedDamageCalculator";
import {
  type RangedCombatStyle,
  RANGED_STYLE_BONUSES,
} from "../../../../types/game/combat-types";
import { ammunitionService } from "../AmmunitionService";
import type { CreateProjectileParams } from "../ProjectileService";
import { getGameRng } from "../../../../utils/SeededRandom";
import type { Entity } from "../../../../entities/Entity";
import type { MobEntity } from "../../../../entities/npc/MobEntity";

export class RangedAttackHandler {
  /** Pre-allocated params object — mutated in-place to avoid per-attack allocations */
  private readonly _rangedParams: RangedDamageParams = {
    rangedLevel: 0,
    rangedAttackBonus: 0,
    rangedStrengthBonus: 0,
    style: "accurate",
    targetDefenseLevel: 0,
    targetRangedDefenseBonus: 0,
    prayerBonuses: undefined,
    targetPrayerBonuses: undefined,
  };

  constructor(private readonly ctx: CombatAttackContext) {}

  /**
   * Handle ranged attack - validate arrows, create projectile, queue damage
   */
  handle(data: {
    attackerId: string;
    targetId: string;
    attackerType: "player" | "mob";
    targetType: "player" | "mob";
  }): void {
    const { attackerId, targetId, attackerType, targetType } = data;
    const currentTick = this.ctx.world.currentTick ?? 0;

    // Only players can initiate ranged attacks in F2P (mobs use melee)
    if (attackerType !== "player") {
      this.ctx.handleMeleeAttack(data);
      return;
    }

    // Validate entity IDs
    if (
      !this.ctx.entityIdValidator.isValid(attackerId) ||
      !this.ctx.entityIdValidator.isValid(targetId)
    ) {
      return;
    }

    // Rate limiting
    const rateResult = this.ctx.rateLimiter.checkLimit(attackerId, currentTick);
    if (!rateResult.allowed) {
      this.ctx.antiCheat.recordViolation(
        attackerId,
        CombatViolationType.ATTACK_RATE_EXCEEDED,
        CombatViolationSeverity.MINOR,
        `Ranged rate limited: ${rateResult.reason}`,
        undefined,
        currentTick,
      );
      return;
    }
    this.ctx.antiCheat.trackAttack(attackerId, currentTick);

    // Validate attacker is on a walkable tile (anti-cheat)
    if (
      !this.ctx.validateAttackerPosition(
        attackerId,
        targetId,
        "Ranged",
        currentTick,
      )
    )
      return;

    // Get entities
    const attacker = this.ctx.entityResolver.resolve(attackerId, attackerType);
    const target = this.ctx.entityResolver.resolve(targetId, targetType);
    if (!attacker || !target) return;

    // Check both are alive
    if (
      !this.ctx.entityResolver.isAlive(attacker, attackerType) ||
      !this.ctx.entityResolver.isAlive(target, targetType)
    ) {
      return;
    }

    // Validate arrows equipped
    const weapon = this.ctx.getEquippedWeapon(attackerId);
    const arrowSlot = this.ctx.getEquippedArrows(attackerId);
    const rangedLevel = this.ctx.getPlayerSkillLevel(attackerId, "ranged");

    const arrowValidation = ammunitionService.validateArrows(
      weapon,
      arrowSlot,
      rangedLevel,
    );
    if (!arrowValidation.valid) {
      this.ctx.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: attackerId,
        message: arrowValidation.error ?? "You need arrows to attack.",
        type: "error",
      });
      return;
    }

    // Resolve ranged style before range check so longrange +2 applies (OSRS-accurate)
    let rangedStyle: RangedCombatStyle = "accurate";
    const styleData = this.ctx.playerSystem?.getPlayerAttackStyle?.(attackerId);
    if (styleData?.id) {
      const id = styleData.id;
      if (id === "accurate" || id === "rapid" || id === "longrange") {
        rangedStyle = id;
      }
    }
    const styleBonus = RANGED_STYLE_BONUSES[rangedStyle];

    // Check ranged attack range — longrange style adds +2 tiles (OSRS-accurate)
    const attackRange = (weapon?.attackRange ?? 7) + styleBonus.rangeModifier;
    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return;

    tilePool.setFromPosition(this.ctx._attackerTile, attackerPos);
    tilePool.setFromPosition(this.ctx._targetTile, targetPos);
    const distance = tileChebyshevDistance(
      this.ctx._attackerTile,
      this.ctx._targetTile,
    );

    if (distance > attackRange || distance === 0) {
      this.ctx.emitTypedEvent(EventType.COMBAT_ATTACK_FAILED, {
        attackerId,
        targetId,
        reason: "out_of_range",
      });
      return;
    }

    // Check cooldown
    const typedAttackerId = createEntityID(attackerId);
    if (!this.ctx.checkAttackCooldown(typedAttackerId, currentTick)) {
      return;
    }

    // Get attack speed from weapon with style modifier (rapid = -1 tick)
    const baseAttackSpeed = weapon?.attackSpeed ?? 4;
    const attackSpeedTicks = Math.max(
      1,
      baseAttackSpeed + styleBonus.speedModifier,
    );

    // Claim cooldown slot immediately to prevent dual-path race condition
    // (event handler + tick auto-attack can both pass checkAttackCooldown on same tick)
    this.ctx.nextAttackTicks.set(
      typedAttackerId,
      currentTick + attackSpeedTicks,
    );

    // Face target
    this.ctx.rotationManager.rotateTowardsTarget(
      attackerId,
      targetId,
      attackerType,
      targetType,
    );

    // Play attack animation
    this.ctx.animationManager.setCombatEmote(
      attackerId,
      attackerType,
      currentTick,
      attackSpeedTicks,
    );

    // Calculate damage
    const damage = this.calculateRangedDamageForAttack(
      attacker,
      target,
      attackerId,
      targetType,
    );

    // Create projectile with delayed hit
    const projectileParams: CreateProjectileParams = {
      sourceId: attackerId,
      targetId,
      attackType: AttackType.RANGED,
      damage,
      currentTick,
      sourcePosition: { x: attackerPos.x, z: attackerPos.z },
      targetPosition: { x: targetPos.x, z: targetPos.z },
      arrowId: arrowSlot?.itemId ? String(arrowSlot.itemId) : undefined,
    };

    this.ctx.projectileService.createProjectile(projectileParams);

    // OSRS: Consume one arrow from equipment on fire
    this.ctx.emitTypedEvent(EventType.EQUIPMENT_CONSUME_ARROW, {
      playerId: attackerId,
    });

    // Emit projectile created event for client visuals.
    // travelDurationMs derived from hit-delay so arrow arrives when damage splat shows.
    const { HIT_DELAY: RANGED_HIT_DELAY, TICK_DURATION_MS: TICK_MS } =
      COMBAT_CONSTANTS;
    const rangedHitDelayTicks = Math.min(
      RANGED_HIT_DELAY.MAX_HIT_DELAY,
      RANGED_HIT_DELAY.RANGED_BASE +
        Math.floor(
          (RANGED_HIT_DELAY.RANGED_DISTANCE_OFFSET + distance) /
            RANGED_HIT_DELAY.RANGED_DISTANCE_DIVISOR,
        ),
    );
    const arrowLaunchDelayMs = 400;
    const arrowTravelDurationMs = Math.max(
      200,
      rangedHitDelayTicks * TICK_MS - arrowLaunchDelayMs,
    );

    this.ctx.emitTypedEvent(EventType.COMBAT_PROJECTILE_LAUNCHED, {
      attackerId,
      targetId,
      projectileType: "arrow",
      sourcePosition: attackerPos,
      targetPosition: targetPos,
      delayMs: arrowLaunchDelayMs,
      arrowId: arrowSlot?.itemId ? String(arrowSlot.itemId) : undefined,
      travelDurationMs: arrowTravelDurationMs,
    });

    // Enter combat (cooldown already claimed above before projectile creation)
    const typedTargetId = createEntityID(targetId);
    this.ctx.enterCombat(
      typedAttackerId,
      typedTargetId,
      attackSpeedTicks,
      AttackType.RANGED,
    );
  }

  /**
   * Calculate ranged damage for an attack.
   * Reuses pre-allocated _rangedParams to avoid per-attack heap allocation.
   */
  private calculateRangedDamageForAttack(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    attackerId: string,
    targetType: "player" | "mob",
  ): number {
    const rangedLevel = this.ctx.getPlayerSkillLevel(attackerId, "ranged");
    const equipmentStats = this.ctx.playerEquipmentStats.get(attackerId);
    const arrowSlot = this.ctx.getEquippedArrows(attackerId);

    // Get arrow strength bonus
    const arrowStrength = ammunitionService.getArrowStrengthBonus(arrowSlot);

    // Get target stats
    const targetDefenseLevel =
      targetType === "mob" && isMobEntity(target)
        ? target.getMobData().defense
        : this.ctx.getPlayerSkillLevel(String(target.id), "defense");

    // Use per-style defenseRanged from equipment (OSRS combat triangle).
    // Falls back to generic ranged bonus for backward compatibility.
    const targetEquipStats = this.ctx.playerEquipmentStats.get(
      String(target.id),
    );
    const targetRangedDefense =
      targetType === "mob" && isMobEntity(target)
        ? target.getMobData().defense
        : (targetEquipStats?.defenseRanged ?? targetEquipStats?.ranged ?? 0);

    // Get prayer bonuses
    const prayerSystem = this.ctx.prayerSystem;
    const attackerPrayer = prayerSystem?.getCombinedBonuses(attackerId);
    const defenderPrayer =
      targetType === "player"
        ? prayerSystem?.getCombinedBonuses(String(target.id))
        : undefined;

    // NOTE: equipmentStats.rangedStrength already includes arrow strength from EquipmentSystem
    // Do NOT add arrowStrength separately as that would double-count it
    const rangedStrengthBonus = equipmentStats?.rangedStrength ?? arrowStrength;

    // Get player's combat style for OSRS-accurate damage bonuses
    let rangedStyle: RangedCombatStyle = "accurate";
    const styleData = this.ctx.playerSystem?.getPlayerAttackStyle?.(attackerId);
    if (styleData?.id) {
      const id = styleData.id;
      if (id === "accurate" || id === "rapid" || id === "longrange") {
        rangedStyle = id;
      }
    }

    // Mutate pre-allocated params in-place (zero GC)
    const p = this._rangedParams;
    p.rangedLevel = rangedLevel;
    p.rangedAttackBonus = equipmentStats?.rangedAttack ?? 0;
    p.rangedStrengthBonus = rangedStrengthBonus;
    p.style = rangedStyle;
    p.targetDefenseLevel = targetDefenseLevel;
    p.targetRangedDefenseBonus = targetRangedDefense;
    p.prayerBonuses = attackerPrayer;
    p.targetPrayerBonuses = defenderPrayer;

    const result = calculateRangedDamage(p, getGameRng());
    return result.damage;
  }
}
