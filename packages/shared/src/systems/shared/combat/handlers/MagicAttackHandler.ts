/**
 * MagicAttackHandler - Handles magic attack validation, projectile creation, and damage.
 *
 * Extracted from CombatSystem to reduce class size.
 * Pre-allocates MagicDamageParams to eliminate per-attack heap allocations.
 */

import type { CombatAttackContext } from "./AttackContext";
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
  calculateMagicDamage,
  type MagicDamageParams,
} from "../MagicDamageCalculator";
import {
  type MagicCombatStyle,
  MAGIC_STYLE_BONUSES,
} from "../../../../types/game/combat-types";
import { runeService } from "../RuneService";
import { spellService, type Spell } from "../SpellService";
import type { CreateProjectileParams } from "../ProjectileService";
import { getGameRng } from "../../../../utils/SeededRandom";
import type { Entity } from "../../../../entities/Entity";
import type { MobEntity } from "../../../../entities/npc/MobEntity";
import type { Item } from "../../../../types/game/item-types";

export class MagicAttackHandler {
  /** Pre-allocated params object — mutated in-place to avoid per-attack allocations */
  private readonly _magicParams: MagicDamageParams = {
    magicLevel: 0,
    magicAttackBonus: 0,
    style: "accurate",
    spellBaseMaxHit: 0,
    targetType: "npc",
    targetMagicLevel: 0,
    targetDefenseLevel: 0,
    targetMagicDefenseBonus: 0,
    prayerBonuses: undefined,
    targetPrayerBonuses: undefined,
  };

  constructor(private readonly ctx: CombatAttackContext) {}

  /**
   * Handle magic attack - validate runes, create projectile, queue damage
   */
  async handle(data: {
    attackerId: string;
    targetId: string;
    attackerType: "player" | "mob";
    targetType: "player" | "mob";
  }): Promise<void> {
    const { attackerId, targetId, attackerType, targetType } = data;
    const currentTick = this.ctx.world.currentTick ?? 0;

    // Only players can initiate magic attacks in F2P (mobs use melee)
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
        `Magic rate limited: ${rateResult.reason}`,
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
        "Magic",
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

    // Get selected spell from player data
    const selectedSpellId = this.getPlayerSelectedSpell(attackerId);
    const magicLevel = this.ctx.getPlayerSkillLevel(attackerId, "magic");

    // Validate spell can be cast
    const spellValidation = spellService.canCastSpell(
      selectedSpellId,
      magicLevel,
    );
    if (!spellValidation.valid) {
      this.ctx.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: attackerId,
        message: spellValidation.error ?? "You cannot cast this spell.",
        type: "error",
      });
      return;
    }

    const spell = spellService.getSpell(selectedSpellId!);
    if (!spell) return;

    // Validate runes in inventory
    const weapon = this.ctx.getEquippedWeapon(attackerId);
    const inventory = this.getPlayerInventoryItems(attackerId);
    const runeValidation = runeService.hasRequiredRunes(
      inventory,
      spell.runes,
      weapon,
    );
    if (!runeValidation.valid) {
      this.ctx.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: attackerId,
        message: runeValidation.error ?? "You don't have enough runes.",
        type: "error",
      });
      return;
    }

    // Resolve magic style before range check so longrange +2 applies (OSRS-accurate)
    let magicStyle: MagicCombatStyle = "accurate";
    const magicStyleData =
      this.ctx.playerSystem?.getPlayerAttackStyle?.(attackerId);
    if (magicStyleData?.id) {
      const id = magicStyleData.id;
      if (id === "accurate" || id === "longrange" || id === "autocast") {
        magicStyle = id;
      }
    }

    // Check magic attack range — longrange style adds +2 tiles (OSRS-accurate)
    const attackRange = 10 + MAGIC_STYLE_BONUSES[magicStyle].rangeModifier;
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

    // Get attack speed from spell (clamp to minimum 1 tick to prevent zero-speed exploit)
    const attackSpeedTicks = Math.max(1, spell.attackSpeed);

    // Claim cooldown slot IMMEDIATELY to prevent async race condition.
    // handleMagicAttack is async (awaits consumeRunesForSpell), so two concurrent
    // invocations (event handler + tick auto-attack) can both pass checkAttackCooldown
    // before either sets the cooldown, resulting in duplicate projectiles.
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
    const damage = this.calculateMagicDamageForAttack(
      attacker,
      target,
      attackerId,
      targetType,
      spell,
    );

    // Create projectile and emit visual event BEFORE consuming runes.
    // consumeRunesForSpell is async (inventory writes), so awaiting it lets
    // game ticks advance. If we emit the visual event after the await, the
    // client receives it late and the projectile arrives after the damage splat.
    // Rune availability was already validated above (hasRequiredRunes).
    const projectileParams: CreateProjectileParams = {
      sourceId: attackerId,
      targetId,
      attackType: AttackType.MAGIC,
      damage,
      currentTick,
      sourcePosition: { x: attackerPos.x, z: attackerPos.z },
      targetPosition: { x: targetPos.x, z: targetPos.z },
      spellId: spell.id,
      xpReward: spell.baseXp,
    };

    this.ctx.projectileService.createProjectile(projectileParams);

    // Emit projectile created event for client visuals.
    // delayMs = time after attack start before projectile appears (staff release point).
    // travelDurationMs = how long the projectile flies, derived from the hit-delay
    // formula so the visual arrival coincides with the server-side damage splat.
    const { HIT_DELAY, TICK_DURATION_MS } = COMBAT_CONSTANTS;
    const magicHitDelayTicks = Math.min(
      HIT_DELAY.MAX_HIT_DELAY,
      HIT_DELAY.MAGIC_BASE +
        Math.floor(
          (HIT_DELAY.MAGIC_DISTANCE_OFFSET + distance) /
            HIT_DELAY.MAGIC_DISTANCE_DIVISOR,
        ),
    );
    const spellLaunchDelayMs = 600;
    const travelDurationMs = Math.max(
      200,
      magicHitDelayTicks * TICK_DURATION_MS - spellLaunchDelayMs,
    );

    this.ctx.emitTypedEvent(EventType.COMBAT_PROJECTILE_LAUNCHED, {
      attackerId,
      targetId,
      projectileType: spell.element,
      sourcePosition: attackerPos,
      targetPosition: targetPos,
      spellId: spell.id,
      delayMs: spellLaunchDelayMs,
      travelDurationMs,
    });

    // Enter combat (cooldown already claimed above before async work)
    const typedTargetId = createEntityID(targetId);
    this.ctx.enterCombat(
      typedAttackerId,
      typedTargetId,
      attackSpeedTicks,
      AttackType.MAGIC,
    );

    // Consume runes after projectile/visual are dispatched.
    // This is async (inventory writes) but runes were already validated.
    await this.consumeRunesForSpell(attackerId, spell, weapon);
  }

  /**
   * Get player's selected autocast spell
   */
  private getPlayerSelectedSpell(playerId: string): string | null {
    // Use world.getPlayer() to ensure we get the same player entity as PlayerSystem
    const playerEntity = this.ctx.world.getPlayer?.(playerId);
    if (!playerEntity?.data) return null;

    return (
      (playerEntity.data as { selectedSpell?: string }).selectedSpell ?? null
    );
  }

  /**
   * Get player inventory items for rune checking
   */
  private getPlayerInventoryItems(
    playerId: string,
  ): Array<{ itemId: string; quantity: number; slot: number }> {
    if (!this.ctx.inventorySystem) return [];

    const inventory = this.ctx.inventorySystem.getInventory(playerId);
    if (!inventory?.items) return [];

    return inventory.items
      .filter((item) => item.itemId)
      .map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity ?? 1,
        slot: item.slot,
      }));
  }

  /**
   * Consume runes for spell cast
   */
  private async consumeRunesForSpell(
    playerId: string,
    spell: Spell,
    weapon: Item | null,
  ): Promise<void> {
    if (!this.ctx.inventorySystem) return;

    const runesToConsume = runeService.getRunesToConsume(spell.runes, weapon);

    for (const requirement of runesToConsume) {
      await this.ctx.inventorySystem.removeItemDirect(playerId, {
        itemId: requirement.runeId,
        quantity: requirement.quantity,
      });
    }
  }

  /**
   * Calculate magic damage for an attack.
   * Reuses pre-allocated _magicParams to avoid per-attack heap allocation.
   */
  private calculateMagicDamageForAttack(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    attackerId: string,
    targetType: "player" | "mob",
    spell: Spell,
  ): number {
    const magicLevel = this.ctx.getPlayerSkillLevel(attackerId, "magic");
    const equipmentStats = this.ctx.playerEquipmentStats.get(attackerId);

    // Get target stats
    const targetMagicLevel =
      targetType === "mob" && isMobEntity(target)
        ? 1 // Most F2P mobs have 1 magic
        : this.ctx.getPlayerSkillLevel(String(target.id), "magic");

    const targetDefenseLevel =
      targetType === "mob" && isMobEntity(target)
        ? target.getMobData().defense
        : this.ctx.getPlayerSkillLevel(String(target.id), "defense");

    const targetMagicDefense =
      targetType === "mob" && isMobEntity(target)
        ? 0
        : (this.ctx.playerEquipmentStats.get(String(target.id))?.magicDefense ??
          0);

    // Get prayer bonuses
    const prayerSystem = this.ctx.prayerSystem;
    const attackerPrayer = prayerSystem?.getCombinedBonuses(attackerId);
    const defenderPrayer =
      targetType === "player"
        ? prayerSystem?.getCombinedBonuses(String(target.id))
        : undefined;

    // Get player's combat style for OSRS-accurate damage bonuses
    let magicStyle: MagicCombatStyle = "accurate";
    const styleData = this.ctx.playerSystem?.getPlayerAttackStyle?.(attackerId);
    if (styleData?.id) {
      const id = styleData.id;
      if (id === "accurate" || id === "longrange" || id === "autocast") {
        magicStyle = id;
      }
    }

    // Mutate pre-allocated params in-place (zero GC)
    const p = this._magicParams;
    p.magicLevel = magicLevel;
    p.magicAttackBonus = equipmentStats?.magicAttack ?? 0;
    p.style = magicStyle;
    p.spellBaseMaxHit = spell.baseMaxHit;
    // MagicDamageParams uses "npc" instead of "mob"
    p.targetType = targetType === "mob" ? "npc" : "player";
    p.targetMagicLevel = targetMagicLevel;
    p.targetDefenseLevel = targetDefenseLevel;
    p.targetMagicDefenseBonus = targetMagicDefense;
    p.prayerBonuses = attackerPrayer;
    p.targetPrayerBonuses = defenderPrayer;

    const result = calculateMagicDamage(p, getGameRng());
    return result.damage;
  }
}
