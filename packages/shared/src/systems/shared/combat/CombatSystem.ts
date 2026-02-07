/**
 * CombatSystem - Handles all combat mechanics
 */

import { EventType } from "../../../types/events";
import type { World } from "../../../core/World";
import {
  COMBAT_CONSTANTS,
  WEAPON_DEFAULT_ATTACK_STYLE,
  type MeleeAttackStyle,
} from "../../../constants/CombatConstants";
import { AttackType } from "../../../types/core/core";
import { EntityID } from "../../../types/core/identifiers";
import { MobEntity } from "../../../entities/npc/MobEntity";
import { Entity } from "../../../entities/Entity";
import { PlayerSystem } from "..";
import {
  isAttackOnCooldownTicks,
  calculateRetaliationDelay,
  CombatStyle,
  PrayerCombatBonuses,
} from "../../../utils/game/CombatCalculations";
import { PrayerSystem } from "../character/PrayerSystem";
import { GroundItemSystem } from "../economy/GroundItemSystem";
import { createEntityID } from "../../../utils/IdentifierUtils";
import { EntityManager } from "..";
import { MobNPCSystem } from "..";
import { SystemBase } from "../infrastructure/SystemBase";
import {
  tilesWithinMeleeRange,
  tilesWithinRange,
  worldToTile,
} from "../movement/TileSystem";
import { tilePool, PooledTile } from "../../../utils/pools/TilePool";
import { CombatAnimationManager } from "./CombatAnimationManager";
import { CombatRotationManager } from "./CombatRotationManager";
import { CombatStateService, CombatData } from "./CombatStateService";
import {
  CombatAntiCheat,
  CombatViolationType,
  CombatViolationSeverity,
} from "./CombatAntiCheat";
import { getEntityPosition } from "../../../utils/game/EntityPositionUtils";
import { quaternionPool } from "../../../utils/pools/QuaternionPool";
import { EntityIdValidator } from "./EntityIdValidator";
import { CombatRateLimiter } from "./CombatRateLimiter";
import { CombatEntityResolver } from "./CombatEntityResolver";
import { DamageCalculator } from "./DamageCalculator";
import {
  EventStore,
  GameEventType,
  type GameStateInfo,
  type EntitySnapshot,
  type CombatSnapshot,
} from "../EventStore";
import {
  getGameRngState,
  type SeededRandomState,
} from "../../../utils/SeededRandom";
import {
  DamageHandler,
  PlayerDamageHandler,
  MobDamageHandler,
  MeleeAttackHandler,
  RangedAttackHandler,
  MagicAttackHandler,
} from "./handlers";
import type {
  CombatAttackContext,
  EquipmentStatsCache,
  MeleeAttackData,
} from "./handlers";
import { PidManager } from "./PidManager";
import {
  CombatTickProcessor,
  type CombatTickContext,
} from "./CombatTickProcessor";
import { getGameRng } from "../../../utils/SeededRandom";
import {
  isEntityDead,
  getMobRetaliates,
  getPendingAttacker,
  clearPendingAttacker,
  isPlayerDamageHandler,
  isMobEntity,
} from "../../../utils/typeGuards";
import type { TerrainSystem } from "../world/TerrainSystem";
import { ProjectileService } from "./ProjectileService";
import type { EquipmentSystem } from "../character/EquipmentSystem";
import type { InventorySystem } from "../character/InventorySystem";
import type { Item, EquipmentSlot } from "../../../types/game/item-types";

// Re-export CombatData from CombatStateService for backwards compatibility
export type { CombatData } from "./CombatStateService";

export class CombatSystem extends SystemBase {
  // --- Fields exposed to attack handlers via CombatAttackContext ---
  public nextAttackTicks = new Map<EntityID, number>(); // Tick when entity can next attack
  private mobSystem?: MobNPCSystem;
  private entityManager?: EntityManager;
  public playerSystem?: PlayerSystem; // Cached for auto-retaliate checks (hot path optimization)
  public prayerSystem?: PrayerSystem | null; // Cached for prayer bonus calculations (hot path)
  private groundItemSystem: GroundItemSystem | null = null;
  public terrainSystem?: TerrainSystem;

  // Public for GameTickProcessor access during tick processing
  public readonly stateService: CombatStateService;
  public readonly animationManager: CombatAnimationManager;
  public readonly rotationManager: CombatRotationManager;

  public readonly antiCheat: CombatAntiCheat;
  public readonly entityIdValidator: EntityIdValidator;
  public readonly rateLimiter: CombatRateLimiter;
  public readonly eventStore: EventStore;
  public readonly entityResolver: CombatEntityResolver;
  private damageCalculator: DamageCalculator;
  private eventRecordingEnabled: boolean = true;

  // Equipment stats cache per player for damage calculations
  public readonly playerEquipmentStats = new Map<string, EquipmentStatsCache>();

  // Ranged/Magic combat services (F2P)
  public readonly projectileService: ProjectileService;
  public equipmentSystem?: EquipmentSystem;
  public inventorySystem?: InventorySystem;

  // Pre-allocated pooled tiles for hot path calculations (zero GC)
  public readonly _attackerTile: PooledTile = tilePool.acquire();
  public readonly _targetTile: PooledTile = tilePool.acquire();

  // OSRS-accurate: Track last known target tile per attacker for persistent combat follow.
  // In OSRS, the player continuously follows the target while in combat — not just when
  // out of range. This map lets us detect when the target has moved and re-path accordingly.
  private lastCombatTargetTile = new Map<string, { x: number; z: number }>();

  // Auto-retaliate disabled after 20 minutes of no input (OSRS behavior)
  private lastInputTick = new Map<string, number>();

  private damageHandlers: Map<"player" | "mob", DamageHandler>;

  // Lower PID = higher priority when attacks occur on same tick
  public readonly pidManager: PidManager;

  // Attack handlers (extracted from CombatSystem for size reduction)
  private readonly meleeHandler: MeleeAttackHandler;
  private readonly rangedHandler: RangedAttackHandler;
  private readonly magicHandler: MagicAttackHandler;

  // Tick processor (extracted from CombatSystem for size reduction)
  private readonly tickProcessor: CombatTickProcessor;

  // Pre-allocated array for processCombatTick attack promises (zero GC)
  private readonly _attackPromises: Promise<void>[] = [];

  constructor(world: World) {
    super(world, {
      name: "combat",
      dependencies: {
        required: ["entity-manager"], // Combat needs entity manager
        optional: ["mob-npc"], // Combat can work without mob NPCs but better with them
      },
      autoCleanup: true,
    });

    this.stateService = new CombatStateService(world);
    this.animationManager = new CombatAnimationManager(world);
    this.rotationManager = new CombatRotationManager(world);
    this.antiCheat = new CombatAntiCheat();
    this.entityIdValidator = new EntityIdValidator();
    this.rateLimiter = new CombatRateLimiter();
    this.entityResolver = new CombatEntityResolver(world);
    this.damageCalculator = new DamageCalculator(this.playerEquipmentStats);

    this.eventStore = new EventStore({
      snapshotInterval: 100,
      maxEvents: 100000,
      maxSnapshots: 10,
    });

    this.damageHandlers = new Map();
    this.damageHandlers.set("player", new PlayerDamageHandler(world));
    this.damageHandlers.set("mob", new MobDamageHandler(world));

    this.pidManager = new PidManager(getGameRng());

    // Ranged/Magic projectile service (F2P)
    this.projectileService = new ProjectileService();

    // Attack handlers (context is `this` cast to CombatAttackContext)
    const ctx = this as unknown as CombatAttackContext;
    this.meleeHandler = new MeleeAttackHandler(ctx);
    this.rangedHandler = new RangedAttackHandler(ctx);
    this.magicHandler = new MagicAttackHandler(ctx);

    // Tick processor (context is `this` cast to CombatTickContext)
    this.tickProcessor = new CombatTickProcessor(
      this as unknown as CombatTickContext,
    );
  }

  async init(): Promise<void> {
    // Get entity manager - required dependency
    this.entityManager = this.world.getSystem("entity-manager");
    if (!this.entityManager) {
      throw new Error(
        "[CombatSystem] EntityManager not found - required dependency",
      );
    }

    // Get mob NPC system - optional but recommended
    this.mobSystem = this.world.getSystem("mob-npc");

    // Configure entity resolver with entity manager and logger
    this.entityResolver.setEntityManager(this.entityManager);
    this.entityResolver.setLogger(this.logger);

    // Cache PlayerSystem for auto-retaliate checks (hot path optimization)
    // Optional dependency - combat still works without it (defaults to retaliate)
    this.playerSystem = this.world.getSystem("player");

    // Cache PlayerSystem into PlayerDamageHandler for damage application
    const playerHandler = this.damageHandlers.get("player");
    if (isPlayerDamageHandler(playerHandler)) {
      playerHandler.cachePlayerSystem(this.playerSystem ?? null);
    }

    // Cache EquipmentSystem and InventorySystem for ranged/magic combat (F2P)
    this.equipmentSystem = this.world.getSystem("equipment");
    this.inventorySystem = this.world.getSystem("inventory");

    // Cache PrayerSystem for prayer bonus calculations (hot path optimization)
    this.prayerSystem = this.world.getSystem("prayer") as PrayerSystem | null;

    // Cache GroundItemSystem for OSRS arrow recovery (dropped arrows at target position)
    this.groundItemSystem = this.world.getSystem("ground-items") ?? null;

    // Cache TerrainSystem for attacker position validation (anti-cheat)
    this.terrainSystem = this.world.getSystem("terrain");

    // Listen for auto-retaliate toggle to start combat if toggled ON while being attacked
    // SERVER-ONLY: Combat state changes must happen on server, client receives via network sync
    this.subscribe(
      EventType.UI_AUTO_RETALIATE_CHANGED,
      (data: { playerId: string; enabled: boolean }) => {
        if (!this.world.isServer) return; // Combat is server-authoritative
        if (data.enabled) {
          this.handleAutoRetaliateEnabled(data.playerId);
        }
      },
    );

    // OSRS-accurate: Player clicked to move = cancel their attacking combat
    // In OSRS, clicking anywhere else cancels your current action including combat
    // SERVER-ONLY: Combat state changes must happen on server
    this.subscribe(
      EventType.COMBAT_PLAYER_DISENGAGE,
      (data: { playerId: string }) => {
        if (!this.world.isServer) return; // Combat is server-authoritative
        this.handlePlayerDisengage(data.playerId);
      },
    );

    // Set up event listeners - required for combat to function
    // SERVER-ONLY: Combat processing should only happen on server to avoid duplicate damage events
    this.subscribe(
      EventType.COMBAT_ATTACK_REQUEST,
      async (data: {
        playerId: string;
        targetId: string;
        attackerType?: "player" | "mob";
        targetType?: "player" | "mob";
        attackType?: AttackType;
      }) => {
        if (!this.world.isServer) return; // Combat is server-authoritative
        await this.handleAttack({
          attackerId: data.playerId,
          targetId: data.targetId,
          attackerType: data.attackerType || "player",
          targetType: data.targetType || "mob",
          attackType: data.attackType || AttackType.MELEE,
        });
      },
    );
    this.subscribe<{
      attackerId: string;
      targetId: string;
      attackerType: "player" | "mob";
      targetType: "player" | "mob";
    }>(EventType.COMBAT_MELEE_ATTACK, (data) => {
      if (!this.world.isServer) return; // Combat is server-authoritative
      this.meleeHandler.handle(data);
    });
    // MVP: Ranged combat subscription removed - melee only
    this.subscribe(
      EventType.COMBAT_MOB_NPC_ATTACK,
      (data: { mobId: string; targetId: string }) => {
        if (!this.world.isServer) return; // Combat is server-authoritative
        this.handleMobAttack(data);
      },
    );

    // Listen for death events to end combat
    this.subscribe(EventType.NPC_DIED, (data: { mobId: string }) => {
      this.handleEntityDied(data.mobId, "mob");
    });
    this.subscribe(EventType.PLAYER_DIED, (data: { playerId: string }) => {
      this.handleEntityDied(data.playerId, "player");
    });
    // Also listen for ENTITY_DEATH to catch all entity destructions
    this.subscribe(
      EventType.ENTITY_DEATH,
      (data: { entityId: string; entityType: string }) => {
        this.handleEntityDied(data.entityId, data.entityType);
      },
    );

    // CRITICAL: Listen for player respawn to clear any lingering combat states
    // This catches edge cases where combat states survive the death cleanup
    this.subscribe(
      EventType.PLAYER_RESPAWNED,
      (data: {
        playerId: string;
        spawnPosition: { x: number; y: number; z: number };
      }) => {
        this.handlePlayerRespawned(data.playerId);
      },
    );

    this.subscribe(EventType.PLAYER_JOINED, (data: { playerId: string }) => {
      const tickNumber = this.world.currentTick ?? 0;
      this.pidManager.assignPid(data.playerId as EntityID, tickNumber);
    });

    this.subscribe(EventType.PLAYER_LEFT, (data: { playerId: string }) => {
      this.cleanupPlayerDisconnect(data.playerId);
      this.pidManager.removePid(data.playerId as EntityID);
    });

    // Listen for explicit combat stop requests (e.g., player clicking new target)
    this.subscribe(
      EventType.COMBAT_STOP_ATTACK,
      (data: { attackerId: string }) => {
        if (this.stateService.isInCombat(data.attackerId)) {
          this.logger.info("Stopping combat for target switch", {
            attackerId: data.attackerId,
          });
          this.forceEndCombat(data.attackerId);
        }
      },
    );

    // Listen for combat follow events to initiate player movement toward target
    this.subscribe(
      EventType.COMBAT_FOLLOW_TARGET,
      (data: {
        playerId: string;
        targetId: string;
        targetPosition: { x: number; y: number; z: number };
      }) => {
        this.handleCombatFollow(data);
      },
    );

    // Listen for equipment stats updates to use bonuses in damage calculation
    this.subscribe(
      EventType.PLAYER_STATS_EQUIPMENT_UPDATED,
      (data: {
        playerId: string;
        equipmentStats: {
          attack: number;
          strength: number;
          defense: number;
          ranged: number;
          // Optional ranged/magic bonuses (F2P)
          rangedAttack?: number;
          rangedStrength?: number;
          magicAttack?: number;
          magicDefense?: number;
          // Optional per-style bonuses (OSRS combat triangle)
          defenseStab?: number;
          defenseSlash?: number;
          defenseCrush?: number;
          defenseRanged?: number;
          attackStab?: number;
          attackSlash?: number;
          attackCrush?: number;
        };
      }) => {
        this.playerEquipmentStats.set(data.playerId, {
          attack: data.equipmentStats.attack,
          strength: data.equipmentStats.strength,
          defense: data.equipmentStats.defense,
          ranged: data.equipmentStats.ranged,
          rangedAttack: data.equipmentStats.rangedAttack ?? 0,
          rangedStrength: data.equipmentStats.rangedStrength ?? 0,
          magicAttack: data.equipmentStats.magicAttack ?? 0,
          magicDefense: data.equipmentStats.magicDefense ?? 0,
          defenseStab: data.equipmentStats.defenseStab ?? 0,
          defenseSlash: data.equipmentStats.defenseSlash ?? 0,
          defenseCrush: data.equipmentStats.defenseCrush ?? 0,
          defenseRanged: data.equipmentStats.defenseRanged ?? 0,
          attackStab: data.equipmentStats.attackStab ?? 0,
          attackSlash: data.equipmentStats.attackSlash ?? 0,
          attackCrush: data.equipmentStats.attackCrush ?? 0,
        });
      },
    );
  }

  /**
   * Get attack type from equipped weapon or selected spell
   * Returns AttackType based on weapon's attackType property, or MAGIC if spell selected
   *
   * OSRS-accurate: You can cast spells without a staff - the staff just provides
   * magic attack bonus and elemental staves give infinite runes
   */
  private getAttackTypeFromWeapon(attackerId: string): AttackType {
    // Check if player has a spell selected - if so, use magic regardless of weapon
    const playerEntity = this.world.getPlayer?.(attackerId);
    const selectedSpell = playerEntity?.data
      ? ((playerEntity.data as { selectedSpell?: string }).selectedSpell ??
        null)
      : null;
    if (selectedSpell) {
      return AttackType.MAGIC;
    }

    if (!this.equipmentSystem) return AttackType.MELEE;

    const equipment = this.equipmentSystem.getPlayerEquipment(attackerId);
    const weapon = equipment?.weapon?.item;

    if (!weapon) return AttackType.MELEE;

    // Normalize to lowercase for comparison (JSON may have uppercase values)
    const attackType = weapon.attackType?.toLowerCase();
    const weaponType = weapon.weaponType?.toLowerCase();

    // Check weapon's attackType property for ranged
    // Note: Magic only activates via autocast (checked above) - staffs melee by default
    if (attackType === "ranged") {
      return AttackType.RANGED;
    }

    // Fall back to weaponType for legacy compatibility (ranged only)
    if (weaponType === "bow" || weaponType === "crossbow") {
      return AttackType.RANGED;
    }

    // Default to melee (includes staffs/wands without autocast - OSRS accurate)
    return AttackType.MELEE;
  }

  /**
   * Get equipped arrows slot for ranged combat
   */
  public getEquippedArrows(playerId: string): EquipmentSlot | null {
    if (!this.equipmentSystem) return null;
    const equipment = this.equipmentSystem.getPlayerEquipment(playerId);
    return equipment?.arrows ?? null;
  }

  /**
   * Get equipped weapon for combat
   */
  public getEquippedWeapon(playerId: string): Item | null {
    if (!this.equipmentSystem) return null;
    const equipment = this.equipmentSystem.getPlayerEquipment(playerId);
    return equipment?.weapon?.item ?? null;
  }

  private async handleAttack(data: {
    attackerId: string;
    targetId: string;
    attackerType: "player" | "mob";
    targetType: "player" | "mob";
    attackType?: AttackType;
  }): Promise<void> {
    // Route by attack type from equipped weapon (F2P ranged/magic support)
    const attackType =
      data.attackerType === "player"
        ? this.getAttackTypeFromWeapon(data.attackerId)
        : (data.attackType ?? AttackType.MELEE);

    // Enforce duel attack-type rules after weapon type resolution (authoritative check)
    if (data.attackerType === "player" && data.targetType === "player") {
      const duelSystem = this.world.getSystem("duel") as {
        isPlayerInActiveDuel?: (playerId: string) => boolean;
        canUseMelee?: (playerId: string) => boolean;
        canUseRanged?: (playerId: string) => boolean;
        canUseMagic?: (playerId: string) => boolean;
        canUseSpecialAttack?: (playerId: string) => boolean;
      } | null;

      if (duelSystem?.isPlayerInActiveDuel?.(data.attackerId)) {
        if (
          (attackType === AttackType.MELEE &&
            duelSystem.canUseMelee &&
            !duelSystem.canUseMelee(data.attackerId)) ||
          (attackType === AttackType.RANGED &&
            duelSystem.canUseRanged &&
            !duelSystem.canUseRanged(data.attackerId)) ||
          (attackType === AttackType.MAGIC &&
            duelSystem.canUseMagic &&
            !duelSystem.canUseMagic(data.attackerId))
        ) {
          return; // Attack type blocked by duel rules
        }
      }
    }

    switch (attackType) {
      case AttackType.RANGED:
        this.rangedHandler.handle(data);
        break;
      case AttackType.MAGIC:
        await this.magicHandler.handle(data);
        break;
      case AttackType.MELEE:
      default:
        this.meleeHandler.handle(data);
        break;
    }
  }

  /**
   * Validate that a player attacker is on a walkable tile.
   * Fails open: if TerrainSystem isn't available, allows the attack.
   * Only checks players (mobs can't cheat).
   */
  public validateAttackerPosition(
    attackerId: string,
    targetId: string,
    attackType: string,
    currentTick: number,
  ): boolean {
    if (!this.terrainSystem) return true; // fail-open
    const attacker = this.entityResolver.resolve(attackerId, "player");
    if (!attacker) return true;
    const pos = getEntityPosition(attacker);
    if (!pos) return true;
    if (!this.terrainSystem.isTileWalkable(pos.x, pos.z)) {
      this.antiCheat.recordViolation(
        attackerId,
        CombatViolationType.INVALID_ATTACKER_POSITION,
        CombatViolationSeverity.MAJOR,
        `${attackType} from unwalkable tile (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`,
        targetId,
        currentTick,
      );
      return false;
    }
    return true;
  }

  /**
   * Melee attack — delegates to MeleeAttackHandler.
   * Public so ranged/magic handlers can fall back to melee for mobs (F2P).
   */
  public handleMeleeAttack(data: MeleeAttackData): void {
    this.meleeHandler.handle(data);
  }

  /**
   * Check if attack is on cooldown
   */
  public checkAttackCooldown(
    typedAttackerId: EntityID,
    currentTick: number,
  ): boolean {
    const nextAllowedTick = this.nextAttackTicks.get(typedAttackerId) ?? 0;
    return !isAttackOnCooldownTicks(currentTick, nextAllowedTick);
  }

  /**
   * Get player skill level (used by attack handlers via CombatAttackContext)
   */
  public getPlayerSkillLevel(
    playerId: string,
    skill: "ranged" | "magic" | "defense",
  ): number {
    const playerEntity = this.world.getPlayer?.(playerId);
    if (!playerEntity) return 1;

    const statsComponent = playerEntity.getComponent("stats");
    if (!statsComponent?.data) return 1;

    const stats = statsComponent.data as Record<
      string,
      { level: number } | number
    >;
    const skillData = stats[skill];

    if (typeof skillData === "object" && skillData !== null) {
      return skillData.level ?? 1;
    }
    if (typeof skillData === "number") {
      return skillData;
    }
    return 1;
  }

  /**
   * Get player's current attack style (used by CombatTickProcessor)
   */
  public getPlayerAttackStyle(playerId: string): { id: string } | null {
    const playerSys = this.world.getSystem("player") as PlayerSystem | null;
    return playerSys?.getPlayerAttackStyle?.(playerId) ?? null;
  }

  private handleMobAttack(data: { mobId: string; targetId: string }): void {
    // Handle mob attacking player
    this.handleMeleeAttack({
      attackerId: data.mobId,
      targetId: data.targetId,
      attackerType: "mob",
      targetType: "player",
    });
  }

  /**
   * Handle auto-retaliate being toggled ON while being attacked
   * OSRS behavior: Player should start fighting back immediately
   *
   * Supports both PvE (mob attacker) and PvP (player attacker) scenarios.
   */
  private handleAutoRetaliateEnabled(playerId: string): void {
    const playerEntity = this.world.getPlayer?.(playerId);
    if (!playerEntity) return;

    // Use type guard to get pending attacker ID
    const pendingAttacker = getPendingAttacker(playerEntity);
    if (!pendingAttacker) return;

    // Detect attacker type dynamically - supports both PvP and PvE
    // This fixes the bug where PvP retaliation failed because we assumed "mob"
    const attackerType = this.entityResolver.resolveType(pendingAttacker);
    const attackerEntity = this.entityResolver.resolve(
      pendingAttacker,
      attackerType,
    );

    if (
      !attackerEntity ||
      !this.entityResolver.isAlive(attackerEntity, attackerType)
    ) {
      // Attacker gone - clear pending attacker state using type guard
      clearPendingAttacker(playerEntity);
      return;
    }

    // Start combat! Player now retaliates against the attacker
    const attackSpeedTicks = this.entityResolver.getAttackSpeed(
      createEntityID(playerId),
      "player",
    );

    // enterCombat() detects entity types internally
    this.enterCombat(
      createEntityID(playerId),
      createEntityID(pendingAttacker),
      attackSpeedTicks,
    );

    // Clear pending attacker since we're now actively fighting
    clearPendingAttacker(playerEntity);

    // Clear server face target since player now has a combat target
    // Note: enterCombat() already handles rotation via rotateTowardsTarget()
    this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
      playerId: playerId,
    });
  }

  /**
   * OSRS-accurate: Handle player clicking to move (disengage from combat)
   * In OSRS, clicking anywhere else cancels YOUR current action including combat.
   *
   * CRITICAL: This only affects the DISENGAGING player's combat state.
   * The player who was attacking them (their target) keeps their combat state
   * and continues chasing. This is correct OSRS behavior:
   * - "Deliberate movement out of the opponent's weapon range to force them to follow
   *    is called dragging." - OSRS Wiki (Free-to-play PvP techniques)
   * - Pathfinding recalculates every tick when targeting a moving entity
   *
   * @see https://oldschool.runescape.wiki/w/Free-to-play_PvP_techniques
   * @see https://oldschool.runescape.wiki/w/Pathfinding
   */
  private handlePlayerDisengage(playerId: string): void {
    // Check if player is currently attacking something
    const combatState = this.stateService.getCombatData(playerId);
    if (!combatState || combatState.attackerType !== "player") {
      return; // Not in combat as an attacker, nothing to cancel
    }

    const targetId = String(combatState.targetId);
    const typedPlayerId = createEntityID(playerId);

    // OSRS-ACCURATE: Only remove THIS player's combat state
    // DO NOT call forceEndCombat() as it removes BOTH players' states!
    // The target (who may be attacking this player) keeps their combat state
    // and continues chasing this player. This enables the "dragging" PvP technique.

    // Reset emote for disengaging player only
    this.animationManager.resetEmote(playerId, "player");

    // Clear combat UI state from this player's entity only
    this.stateService.clearCombatStateFromEntity(playerId, "player");

    // Remove ONLY this player's combat state - NOT the target's!
    this.stateService.removeCombatState(typedPlayerId);

    // Clean up combat follow tracking for disengaging player
    this.lastCombatTargetTile.delete(playerId);

    // Mark player as "in combat without target" - the attacker is still chasing them
    // This keeps the combat timer active but player won't auto-attack
    // If auto-retaliate is ON and attacker catches up and hits, player will start fighting again
    this.stateService.markInCombatWithoutTarget(playerId, targetId);

    // OSRS-ACCURATE: Do NOT face the target when walking away
    // Player should face their walking direction (handled by tile movement)
    // Only face target when auto-retaliate triggers (handled by enterCombat)
  }

  /**
   * Handle combat follow - move player toward target when out of melee range.
   * This allows combat to continue when the target moves instead of timing out.
   *
   * NOTE: Actual movement is handled by ServerNetwork listening for COMBAT_FOLLOW_TARGET event.
   * This handler validates that combat is still active before the server initiates movement.
   */
  private handleCombatFollow(data: {
    playerId: string;
    targetId: string;
    targetPosition: { x: number; y: number; z: number };
  }): void {
    // Verify player is still in combat with this target
    const combatState = this.stateService
      .getCombatStatesMap()
      .get(data.playerId as EntityID);
    if (!combatState || combatState.targetId !== data.targetId) {
      return; // Combat ended or target changed, don't follow
    }
    // Movement is handled by ServerNetwork's COMBAT_FOLLOW_TARGET listener
    // which calls TileMovementManager.movePlayerToward()
  }

  public calculateMeleeDamage(
    attacker: Entity | MobEntity,
    target: Entity | MobEntity,
    style: CombatStyle = "accurate",
  ): number {
    // Get prayer bonuses for attacker and defender (players only)
    let attackerPrayerBonuses: PrayerCombatBonuses | undefined;
    let defenderPrayerBonuses: PrayerCombatBonuses | undefined;

    const prayerSystem = this.prayerSystem;
    if (prayerSystem) {
      // Attacker prayer bonuses (if player)
      if (!(attacker instanceof MobEntity)) {
        const bonuses = prayerSystem.getCombinedBonuses(attacker.id);
        if (bonuses.attackMultiplier || bonuses.strengthMultiplier) {
          attackerPrayerBonuses = bonuses;
        }
      }

      // Defender prayer bonuses (if player)
      if (!(target instanceof MobEntity)) {
        const bonuses = prayerSystem.getCombinedBonuses(target.id);
        if (bonuses.defenseMultiplier) {
          defenderPrayerBonuses = bonuses;
        }
      }
    }

    // Determine melee attack style from weapon type (OSRS combat triangle)
    let meleeAttackStyle: MeleeAttackStyle | undefined;
    if (!(attacker instanceof MobEntity)) {
      const weapon = this.getEquippedWeapon(attacker.id);
      const weaponType = weapon?.weaponType?.toLowerCase() ?? "none";
      meleeAttackStyle = WEAPON_DEFAULT_ATTACK_STYLE[weaponType] ?? "crush";
    }

    return this.damageCalculator.calculateMeleeDamage(
      attacker,
      target,
      style,
      attackerPrayerBonuses,
      defenderPrayerBonuses,
      meleeAttackStyle,
    );
  }

  public applyDamage(
    targetId: string,
    targetType: string,
    damage: number,
    attackerId: string,
  ): void {
    // Validate target type
    if (targetType !== "player" && targetType !== "mob") {
      return;
    }

    // Get the appropriate handler for the target type
    const handler = this.damageHandlers.get(targetType);
    if (!handler) {
      this.logger.error("No damage handler for target type", undefined, {
        targetType,
      });
      return;
    }

    // Create typed EntityID for handler
    const typedTargetId = createEntityID(targetId);
    const typedAttackerId = createEntityID(attackerId);

    // Determine attacker type for handler
    const attackerType = this.entityResolver.resolveType(attackerId);

    // Apply damage through polymorphic handler
    let result;
    try {
      result = handler.applyDamage(
        typedTargetId,
        damage,
        typedAttackerId,
        attackerType,
      );
    } catch (error) {
      this.logger.error(
        "Damage handler threw exception",
        error instanceof Error ? error : undefined,
        { targetId, targetType, attackerId, damage },
      );
      return;
    }

    // Handle failed damage application
    if (!result.success) {
      if (result.targetDied) {
        // Target was already dead - end ALL combat with this entity
        this.handleEntityDied(targetId, targetType);
      } else {
        this.logger.error("Failed to apply damage", undefined, {
          targetId,
          targetType,
        });
      }
      return;
    }

    // Prevent additional attacks if target died this tick
    if (result.targetDied) {
      this.handleEntityDied(targetId, targetType);
      return;
    }

    // Emit UI message based on target type
    if (targetType === "player") {
      // Get attacker name for message
      const attackerHandler = this.damageHandlers.get(attackerType);
      const attackerName = attackerHandler
        ? attackerHandler.getDisplayName(typedAttackerId)
        : "enemy";

      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: targetId,
        message: `The ${attackerName} hits you for ${damage} damage!`,
        type: "damage",
      });
    }
    // Note: Mob death messages are emitted by MobEntity.die() to avoid duplication

    // Note: Damage splatter events are now emitted at the call sites
    // (handleMeleeAttack, processAutoAttack) to ensure they're emitted even for 0 damage hits
  }

  // Note: syncCombatStateToEntity, clearCombatStateFromEntity moved to CombatStateService
  // Note: setCombatEmote, resetEmote moved to CombatAnimationManager
  // Note: rotateTowardsTarget moved to CombatRotationManager

  public enterCombat(
    attackerId: EntityID,
    targetId: EntityID,
    attackerSpeedTicks?: number,
    weaponType?: AttackType,
  ): void {
    const currentTick = this.world.currentTick ?? 0;

    // Detect entity types (don't assume attacker is always player!)
    const attackerEntity = this.world.entities.get(String(attackerId));
    const targetEntity = this.world.entities.get(String(targetId));

    // Don't enter combat if target is dead (using type guard)
    if (isEntityDead(targetEntity)) {
      return;
    }

    // Also check if target is a player marked as dead (use cached reference)
    if (this.playerSystem?.getPlayer) {
      const targetPlayer = this.playerSystem.getPlayer(String(targetId));
      if (targetPlayer && !targetPlayer.alive) {
        return;
      }
    }

    const attackerType =
      attackerEntity?.type === "mob" ? ("mob" as const) : ("player" as const);
    const targetType =
      targetEntity?.type === "mob" ? ("mob" as const) : ("player" as const);

    // PvP ZONE VALIDATION: Prevent player vs player combat in safe zones
    // This is critical to prevent:
    // - Combat resuming after respawn in safe zone
    // - Players attacking each other in towns/banks
    // - Auto-retaliate triggering in non-PvP areas
    if (attackerType === "player" && targetType === "player") {
      const zoneSystem = this.world.getSystem("zone-detection");
      if (zoneSystem) {
        const attackerPos = getEntityPosition(attackerEntity);
        if (attackerPos) {
          const isPvPAllowed = zoneSystem.isPvPEnabled({
            x: attackerPos.x,
            z: attackerPos.z,
          });
          if (!isPvPAllowed) {
            this.logger.debug(
              `PvP combat blocked: ${attackerId} tried to attack ${targetId} in safe zone`,
            );
            return; // Cannot start PvP in safe zone
          }
        }
      }
    }

    // Get attack speeds in ticks (use provided or calculate)
    const attackerAttackSpeedTicks =
      attackerSpeedTicks ??
      this.entityResolver.getAttackSpeed(attackerId, attackerType);
    const targetAttackSpeedTicks = this.entityResolver.getAttackSpeed(
      targetId,
      targetType,
    );

    // Set combat state for attacker (just attacked, so next attack is after cooldown)
    this.stateService.createAttackerState(
      attackerId,
      targetId,
      attackerType,
      targetType,
      currentTick,
      attackerAttackSpeedTicks,
      weaponType,
    );

    // OSRS Retaliation: Target retaliates after ceil(speed/2) + 1 ticks
    // @see https://oldschool.runescape.wiki/w/Auto_Retaliate
    // Check if target can retaliate (mobs have retaliates flag, players check auto-retaliate setting)
    let canRetaliate = true;
    if (targetType === "mob" && targetEntity) {
      // Check mob's retaliates config using type guard - if false, mob won't fight back
      canRetaliate = getMobRetaliates(targetEntity);
    } else if (targetType === "player") {
      // Check player's auto-retaliate setting
      // Uses cached reference (no getSystem() call in hot path)
      // Defaults to true if PlayerSystem unavailable (fail-safe, OSRS default)
      if (this.playerSystem) {
        canRetaliate = this.playerSystem.getPlayerAutoRetaliate(
          String(targetId),
        );
      }
      // Note: If playerSystem is null, canRetaliate stays true (default OSRS behavior)

      // 20 min AFK disables auto-retaliate
      if (canRetaliate && this.isAFKTooLong(String(targetId), currentTick)) {
        canRetaliate = false;
      }
    }

    // Attacker always faces target
    this.rotationManager.rotateTowardsTarget(
      String(attackerId),
      String(targetId),
      attackerType,
      targetType,
    );

    // Emit COMBAT_FACE_TARGET for the attacker so the local player client
    // rotates toward the target. This is essential for magic/ranged attacks
    // where the player is stationary (no movement to naturally rotate them).
    if (attackerType === "player") {
      this.emitTypedEvent(EventType.COMBAT_FACE_TARGET, {
        playerId: String(attackerId),
        targetId: String(targetId),
      });
    }

    // Schedule retaliation if target can fight back
    const targetHasValidTarget = this.scheduleRetaliation(
      attackerId,
      targetId,
      attackerType,
      targetType,
      canRetaliate,
      targetAttackSpeedTicks,
      currentTick,
      attackerEntity,
      targetEntity,
    );

    // Sync combat state and emit notifications
    this.syncAndNotifyCombatStart(
      attackerId,
      targetId,
      attackerType,
      targetType,
      canRetaliate,
      targetHasValidTarget,
      attackerAttackSpeedTicks,
      targetAttackSpeedTicks,
      attackerEntity,
      targetEntity,
    );
  }

  /**
   * Schedule retaliation for the target entity (OSRS auto-retaliate)
   * @returns Whether the target already has a valid combat target
   */
  private scheduleRetaliation(
    attackerId: EntityID,
    targetId: EntityID,
    attackerType: "player" | "mob",
    targetType: "player" | "mob",
    canRetaliate: boolean,
    targetAttackSpeedTicks: number,
    currentTick: number,
    attackerEntity: Entity | null | undefined,
    targetEntity: Entity | null | undefined,
  ): boolean {
    let targetHasValidTarget = false;
    if (!canRetaliate) {
      return targetHasValidTarget;
    }

    const targetCombatState = this.stateService.getCombatData(targetId);
    targetHasValidTarget = !!(
      targetCombatState &&
      targetCombatState.inCombat &&
      this.entityResolver.isAlive(
        this.entityResolver.resolve(
          String(targetCombatState.targetId),
          targetCombatState.targetType,
        ),
        targetCombatState.targetType,
      )
    );

    if (targetHasValidTarget) {
      // Target already has valid target - just extend their combat timer
      // They stay locked on their current target (OSRS-accurate)
      this.stateService.extendCombatTimer(targetId, currentTick);
      return targetHasValidTarget;
    }

    // Target has no valid target - schedule retaliation (normal OSRS auto-retaliate)
    const retaliationDelay = calculateRetaliationDelay(targetAttackSpeedTicks);

    this.stateService.createRetaliatorState(
      targetId,
      attackerId,
      targetType,
      attackerType,
      currentTick,
      retaliationDelay,
      targetAttackSpeedTicks,
    );

    // ALWAYS rotate defender to face attacker immediately when retaliation starts
    // This fixes PvP rotation bug where defender wouldn't face attacker
    if (targetType === "player") {
      this.rotationManager.rotateTowardsTarget(
        String(targetId),
        String(attackerId),
        targetType,
        attackerType,
      );
    }

    // If not in attack range, emit follow event to trigger movement
    if (targetType === "player" && attackerEntity && targetEntity) {
      this.emitRetaliationFollow(
        attackerId,
        targetId,
        attackerType,
        attackerEntity,
        targetEntity,
      );
    }

    return targetHasValidTarget;
  }

  /**
   * Emit follow event for retaliating player if not in attack range
   */
  private emitRetaliationFollow(
    attackerId: EntityID,
    targetId: EntityID,
    attackerType: "player" | "mob",
    attackerEntity: Entity,
    targetEntity: Entity,
  ): void {
    const attackerPos = getEntityPosition(attackerEntity);
    const targetPos = getEntityPosition(targetEntity);

    if (!attackerPos || !targetPos) return;

    const attackerTile = worldToTile(attackerPos.x, attackerPos.z);
    const targetTile = worldToTile(targetPos.x, targetPos.z);

    // Get target player's attack type and range (they are retaliating)
    const targetAttackType = this.getAttackTypeFromWeapon(String(targetId));
    const targetCombatRange = this.entityResolver.getCombatRange(
      targetEntity,
      "player",
    );

    // Use appropriate range check based on attack type
    const inRange =
      targetAttackType === AttackType.MELEE
        ? tilesWithinMeleeRange(targetTile, attackerTile, targetCombatRange)
        : tilesWithinRange(targetTile, attackerTile, targetCombatRange);

    if (!inRange) {
      this.emitTypedEvent(EventType.COMBAT_FOLLOW_TARGET, {
        playerId: String(targetId),
        targetId: String(attackerId),
        targetPosition: {
          x: attackerPos.x,
          y: attackerPos.y,
          z: attackerPos.z,
        },
        attackRange: targetCombatRange,
        attackType: targetAttackType,
      });
    }
  }

  /**
   * Sync combat state to entities and emit combat start events/notifications
   */
  private syncAndNotifyCombatStart(
    attackerId: EntityID,
    targetId: EntityID,
    attackerType: "player" | "mob",
    targetType: "player" | "mob",
    canRetaliate: boolean,
    targetHasValidTarget: boolean,
    attackerAttackSpeedTicks: number,
    targetAttackSpeedTicks: number,
    attackerEntity: Entity | null | undefined,
    targetEntity: Entity | null | undefined,
  ): void {
    // Attacker always gets combat state with target
    this.stateService.syncCombatStateToEntity(
      String(attackerId),
      String(targetId),
      attackerType,
    );

    // Target only gets NEW combat target if they will retaliate AND
    // don't already have a valid target (OSRS-accurate)
    if (canRetaliate && !targetHasValidTarget) {
      this.stateService.syncCombatStateToEntity(
        String(targetId),
        String(attackerId),
        targetType,
      );
    } else if (!canRetaliate && targetType === "player") {
      // Mark player as in combat (for logout timer) but without a target
      this.stateService.markInCombatWithoutTarget(
        String(targetId),
        String(attackerId),
      );

      // Player visually faces attacker even with auto-retaliate off
      this.emitTypedEvent(EventType.COMBAT_FACE_TARGET, {
        playerId: String(targetId),
        targetId: String(attackerId),
      });
    }

    // Emit combat started event
    this.emitTypedEvent(EventType.COMBAT_STARTED, {
      attackerId: String(attackerId),
      targetId: String(targetId),
    });

    this.recordCombatEvent(GameEventType.COMBAT_START, String(attackerId), {
      targetId: String(targetId),
      attackerType,
      targetType,
      attackerAttackSpeedTicks,
      targetAttackSpeedTicks,
    });

    // Show combat UI indicator for the local player
    const localPlayer = this.world.getPlayer();
    if (
      localPlayer &&
      (String(attackerId) === localPlayer.id ||
        String(targetId) === localPlayer.id)
    ) {
      const opponent =
        String(attackerId) === localPlayer.id ? targetEntity : attackerEntity;
      const opponentName = opponent?.name ?? "Unknown";

      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: localPlayer.id,
        message: `Combat started with ${opponentName}!`,
        type: "combat",
        duration: 3000,
      });
    }
  }

  private endCombat(data: {
    entityId: string;
    skipAttackerEmoteReset?: boolean;
    skipTargetEmoteReset?: boolean;
  }): void {
    // Validate entity ID before processing
    if (!data.entityId) {
      return;
    }

    const typedEntityId = createEntityID(data.entityId);
    const combatState = this.stateService.getCombatData(data.entityId);
    if (!combatState) return;

    // Reset emotes for both entities via AnimationManager
    // Skip attacker emote reset if requested (e.g., when target died during attack animation)
    if (!data.skipAttackerEmoteReset) {
      this.animationManager.resetEmote(data.entityId, combatState.attackerType);
    }
    // Skip target emote reset if requested (e.g., when dead entity ends combat, don't reset their attacker)
    if (!data.skipTargetEmoteReset) {
      this.animationManager.resetEmote(
        String(combatState.targetId),
        combatState.targetType,
      );
    }

    // Clear combat state from player entities via StateService
    this.stateService.clearCombatStateFromEntity(
      data.entityId,
      combatState.attackerType,
    );
    this.stateService.clearCombatStateFromEntity(
      String(combatState.targetId),
      combatState.targetType,
    );

    // Remove combat states via StateService
    this.stateService.removeCombatState(typedEntityId);
    this.stateService.removeCombatState(combatState.targetId);

    // Clean up combat follow tracking
    this.lastCombatTargetTile.delete(data.entityId);
    this.lastCombatTargetTile.delete(String(combatState.targetId));

    // Emit combat ended event
    this.emitTypedEvent(EventType.COMBAT_ENDED, {
      attackerId: data.entityId,
      targetId: String(combatState.targetId),
    });

    this.recordCombatEvent(GameEventType.COMBAT_END, data.entityId, {
      targetId: String(combatState.targetId),
      attackerType: combatState.attackerType,
      targetType: combatState.targetType,
      reason: "timeout_or_manual",
    });

    if (combatState.attackerType === "player") {
      this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
        playerId: data.entityId,
      });
    }
    if (combatState.targetType === "player") {
      this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
        playerId: String(combatState.targetId),
      });
    }

    // Show combat end message for player
    if (combatState.attackerType === "player") {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId: data.entityId,
        message: `Combat ended.`,
        type: "info",
      });
    }
  }

  /**
   * Handle entity death - immediately clear ALL combat states involving the dead entity
   *
   * CRITICAL FIX: Previously only cleared the dead entity's state, leaving attackers
   * with stale targetIds pointing to the dead (soon respawned) entity. This caused:
   * - Players chasing dead players to spawn point
   * - Mobs following dead players
   * - Combat resuming immediately after respawn
   *
   * Now we:
   * 1. Clear the dead entity's combat state
   * 2. Notify mob attackers via onTargetDied() so they can return to patrol
   * 3. Clear ALL attacker combat states targeting this entity
   * 4. Clean up attack cooldowns for all involved parties
   */
  private handleEntityDied(entityId: string, entityType: string): void {
    const typedEntityId = createEntityID(entityId);

    // Record death event for analytics
    const deathEventType =
      entityType === "player"
        ? GameEventType.DEATH_PLAYER
        : GameEventType.DEATH_MOB;
    const combatState = this.stateService.getCombatData(entityId);
    this.recordCombatEvent(deathEventType, entityId, {
      entityType,
      killedBy: combatState ? String(combatState.targetId) : "unknown",
    });

    // 1. Remove the dead entity's own combat state from the internal map
    this.stateService.removeCombatState(typedEntityId);

    // 1b. CRITICAL: Sync the cleared state to the entity/client
    //     Without this, the client's combat.combatTarget persists and they keep facing the target!
    if (entityType === "player") {
      this.stateService.clearCombatStateFromEntity(entityId, "player");
    }

    // 2. Clear the dead entity's attack cooldown so they can attack immediately after respawn
    this.nextAttackTicks.delete(typedEntityId);

    // 3. Clear any scheduled emote resets for the dead entity
    this.animationManager.cancelEmoteReset(entityId);

    // 4. BEFORE clearing attacker states, notify mob attackers so they can return to patrol
    //    and clear attack cooldowns so attackers can target someone else immediately
    const combatStatesMap = this.stateService.getCombatStatesMap();
    for (const [attackerId, state] of combatStatesMap) {
      if (String(state.targetId) === entityId) {
        // Clear attacker's cooldown so they can engage new targets immediately
        this.nextAttackTicks.delete(attackerId);

        // Notify mob attackers so they can return to patrol/spawn
        if (state.attackerType === "mob") {
          const mobEntity = this.world.entities.get(String(attackerId));
          if (
            isMobEntity(mobEntity) &&
            typeof mobEntity.onTargetDied === "function"
          ) {
            mobEntity.onTargetDied(entityId);
          }
        }
      }
    }

    // 5. CRITICAL: Clear ALL attacker combat states targeting this dead entity
    //    This prevents attackers from continuing to chase/fight the respawned entity
    const clearedAttackers = this.stateService.clearStatesTargeting(entityId);
    if (clearedAttackers.length > 0) {
      this.logger.debug(
        `Cleared ${clearedAttackers.length} attacker states targeting dead ${entityType} ${entityId}`,
      );
    }

    // 6. Clear face target for players who had this as pending attacker
    if (entityType === "mob") {
      for (const player of this.world.entities.players.values()) {
        const pendingAttacker = getPendingAttacker(player);
        if (pendingAttacker === entityId) {
          clearPendingAttacker(player);
          this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
            playerId: player.id,
          });
        }
      }
    }

    // 7. Reset dead entity's emote if they were mid-animation
    // SKIP for players - let the death animation play instead of resetting to idle
    // Mobs can reset since they have different animation handling
    if (entityType === "mob") {
      this.animationManager.resetEmote(entityId, entityType);
    }
    // Player death animation is handled by PlayerDeathSystem
  }

  /**
   * Handle player respawn - clear any lingering combat states
   *
   * This is a safety net that catches edge cases where combat states
   * might survive the death cleanup. When a player respawns:
   * 1. They should have NO combat state (fresh start)
   * 2. NO entities should be targeting them (they just spawned)
   * 3. Their attack cooldown should be clear (can attack immediately)
   *
   * This ensures players respawn in a completely clean combat state,
   * preventing bugs like:
   * - Being immediately attacked at spawn point
   * - Having stale combat UI indicators
   * - Auto-retaliate triggering against old attackers
   */
  private handlePlayerRespawned(playerId: string): void {
    const typedPlayerId = createEntityID(playerId);

    // 1. Clear any lingering combat state the respawned player might have
    const playerCombatState = this.stateService.getCombatData(typedPlayerId);
    if (playerCombatState) {
      this.logger.debug(
        `Clearing lingering combat state for respawned player ${playerId}`,
      );
      this.stateService.removeCombatState(typedPlayerId);
      this.stateService.clearCombatStateFromEntity(playerId, "player");
    }

    // 2. Clear the respawned player's attack cooldown
    this.nextAttackTicks.delete(typedPlayerId);

    // 3. Clear any attacker states that might still be targeting this player
    //    (Safety net - handleEntityDied should have already done this)
    const clearedAttackers = this.stateService.clearStatesTargeting(playerId);
    if (clearedAttackers.length > 0) {
      this.logger.debug(
        `Cleared ${clearedAttackers.length} stale attacker states targeting respawned player ${playerId}`,
      );
    }

    // 4. Clear any pending attacker reference on the player
    const playerEntity = this.world.getPlayer?.(playerId);
    if (playerEntity) {
      clearPendingAttacker(playerEntity);
    }

    // 5. Clear face target so player doesn't auto-look at old attacker
    this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
      playerId,
    });
  }

  // Public API methods
  public startCombat(
    attackerId: string,
    targetId: string,
    options?: {
      attackerType?: "player" | "mob";
      targetType?: "player" | "mob";
      weaponType?: AttackType;
    },
  ): boolean {
    const opts = {
      attackerType: "player",
      targetType: "mob",
      weaponType: AttackType.MELEE,
      ...options,
    };

    // Check if entities exist
    const attacker = this.entityResolver.resolve(attackerId, opts.attackerType);
    const target = this.entityResolver.resolve(targetId, opts.targetType);

    if (!attacker || !target) {
      return false;
    }

    const attackerAlive = this.entityResolver.isAlive(
      attacker,
      opts.attackerType,
    );
    const targetAlive = this.entityResolver.isAlive(target, opts.targetType);

    if (!attackerAlive) {
      return false;
    }
    if (!targetAlive) {
      return false;
    }

    // MVP: Melee-only range check (tile-based)
    const attackerPos = getEntityPosition(attacker);
    const targetPos = getEntityPosition(target);
    if (!attackerPos || !targetPos) return false; // Missing position

    // Use pre-allocated pooled tiles (zero GC)
    tilePool.setFromPosition(this._attackerTile, attackerPos);
    tilePool.setFromPosition(this._targetTile, targetPos);
    const combatRangeTiles = this.entityResolver.getCombatRange(
      attacker,
      opts.attackerType,
    );
    // OSRS-accurate melee range check (cardinal-only for range 1)
    if (
      !tilesWithinMeleeRange(
        this._attackerTile,
        this._targetTile,
        combatRangeTiles,
      )
    ) {
      return false;
    }

    // Start combat
    this.enterCombat(createEntityID(attackerId), createEntityID(targetId));
    return true;
  }

  public isInCombat(entityId: string): boolean {
    return this.stateService.isInCombat(entityId);
  }

  public getCombatData(entityId: string): CombatData | null {
    return this.stateService.getCombatData(entityId);
  }

  /**
   * Check if player is on attack cooldown
   * Used by eating system to determine if eat should add attack delay
   *
   * OSRS Rule: Foods only add to EXISTING attack delay.
   * If weapon is ready to attack (cooldown expired), eating does NOT add delay.
   *
   * @param playerId - Player to check
   * @param currentTick - Current game tick
   * @returns true if player has pending attack cooldown
   */
  public isPlayerOnAttackCooldown(
    playerId: string,
    currentTick: number,
  ): boolean {
    const typedPlayerId = createEntityID(playerId);
    const nextAllowedTick = this.nextAttackTicks.get(typedPlayerId) ?? 0;
    return currentTick < nextAllowedTick;
  }

  /**
   * Add delay ticks to player's next attack
   * Used by eating system (OSRS: eating during combat adds 3 tick delay)
   *
   * OSRS-Accurate: Only called when player is ALREADY on cooldown.
   * If weapon is ready, eating does not add delay.
   *
   * @param playerId - Player to modify
   * @param delayTicks - Ticks to add to attack cooldown
   */
  public addAttackDelay(playerId: string, delayTicks: number): void {
    const typedPlayerId = createEntityID(playerId);
    const currentNext = this.nextAttackTicks.get(typedPlayerId);

    if (currentNext !== undefined) {
      // Add delay to existing cooldown (mutate in place, no allocation)
      this.nextAttackTicks.set(typedPlayerId, currentNext + delayTicks);

      // Also update CombatData if active (keeps state consistent)
      const combatData = this.stateService.getCombatData(typedPlayerId);
      if (combatData) {
        combatData.nextAttackTick += delayTicks;
      }
    }
    // If no current cooldown, do nothing (OSRS-accurate: no delay if weapon ready)
  }

  public forceEndCombat(
    entityId: string,
    options?: {
      skipAttackerEmoteReset?: boolean;
      skipTargetEmoteReset?: boolean;
    },
  ): void {
    this.endCombat({
      entityId,
      skipAttackerEmoteReset: options?.skipAttackerEmoteReset,
      skipTargetEmoteReset: options?.skipTargetEmoteReset,
    });
  }

  /**
   * Check if a player can logout based on combat state
   * OSRS-accurate: Cannot logout while actively in combat
   * Uses the combat timeout window to determine if player is in active combat
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   * @returns Object with allowed boolean and optional reason string
   */
  public canLogout(
    playerId: string,
    currentTick: number,
  ): { allowed: boolean; reason?: string } {
    const combatData = this.stateService.getCombatData(playerId);

    // Player is in active combat if:
    // 1. They have combat data with inCombat flag
    // 2. Current tick is before their combat end tick
    if (combatData?.inCombat && currentTick < combatData.combatEndTick) {
      return {
        allowed: false,
        reason: "Cannot logout during combat",
      };
    }

    return { allowed: true };
  }

  /**
   * Update the last input tick for a player
   * Called by PlayerSystem when player performs any action
   * OSRS: Auto-retaliate disabled after 20 minutes of no input
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   */
  public updatePlayerInput(playerId: string, currentTick: number): void {
    this.lastInputTick.set(playerId, currentTick);
  }

  /**
   * Check if a player has been AFK too long (20 minutes)
   * OSRS-accurate: Auto-retaliate disabled after 2000 ticks of no input
   *
   * @param playerId - The player's entity ID
   * @param currentTick - The current game tick
   * @returns true if player has been AFK too long
   */
  public isAFKTooLong(playerId: string, currentTick: number): boolean {
    const lastInput = this.lastInputTick.get(playerId) ?? currentTick;
    return (
      currentTick - lastInput >= COMBAT_CONSTANTS.AFK_DISABLE_RETALIATE_TICKS
    );
  }

  /**
   * Clean up all combat state for a disconnecting player
   * Called when a player disconnects to prevent orphaned combat states
   * and allow mobs to immediately retarget other players
   */
  public cleanupPlayerDisconnect(playerId: string): void {
    const typedPlayerId = createEntityID(playerId);

    // Remove player's own combat state
    this.stateService.removeCombatState(typedPlayerId);

    // Clear player's attack cooldowns
    this.nextAttackTicks.delete(typedPlayerId);

    // Clear any scheduled emote resets
    this.animationManager.cancelEmoteReset(playerId);

    // Clear player's equipment stats cache
    this.playerEquipmentStats.delete(playerId);

    this.antiCheat.cleanup(playerId);
    this.rateLimiter.cleanup(playerId);
    this.lastInputTick.delete(playerId);
    this.lastCombatTargetTile.delete(playerId);

    // Find all entities that were targeting this disconnected player
    const combatStatesMap = this.stateService.getCombatStatesMap();
    for (const [attackerId, state] of combatStatesMap) {
      if (String(state.targetId) === playerId) {
        // Clear the attacker's cooldown so they can immediately retarget
        this.nextAttackTicks.delete(attackerId);

        // If attacker is a mob, reset its internal combat state
        if (state.attackerType === "mob") {
          const mobEntity = this.world.entities.get(String(attackerId));
          if (
            isMobEntity(mobEntity) &&
            typeof mobEntity.onTargetDied === "function"
          ) {
            // Reuse the same method - disconnect is similar to death
            mobEntity.onTargetDied(playerId);
          }
        }

        // Remove the attacker's combat state (don't let them keep attacking empty air)
        this.stateService.removeCombatState(attackerId);

        // Clear combat state from entity if it's a player
        if (state.attackerType === "player") {
          this.stateService.clearCombatStateFromEntity(
            String(attackerId),
            "player",
          );
        }
      }
    }
  }

  // Combat update loop - DEPRECATED: Combat logic now handled by processCombatTick() via TickSystem
  // This method is kept for compatibility but does nothing - all combat runs through tick system
  update(_dt: number): void {
    // Combat logic moved to processCombatTick() for OSRS-accurate tick-based timing
    // This is called by TickSystem at TickPriority.COMBAT
  }

  /**
   * Process combat on each server tick (OSRS-accurate)
   * Called by TickSystem at COMBAT priority (after movement, before AI)
   */
  public processCombatTick(tickNumber: number): void {
    this.tickProcessor.processCombatTick(tickNumber);
  }

  public processNPCCombatTick(mobId: string, tickNumber: number): void {
    this.tickProcessor.processNPCCombatTick(mobId, tickNumber);
  }

  public processPlayerCombatTick(playerId: string, tickNumber: number): void {
    this.tickProcessor.processPlayerCombatTick(playerId, tickNumber);
  }

  /**
   * Build GameStateInfo for event recording
   */
  private buildGameStateInfo(): GameStateInfo {
    const combatStatesMap = this.stateService.getCombatStatesMap();
    return {
      currentTick: this.world.currentTick ?? 0,
      playerCount: this.world.entities.players.size,
      activeCombats: combatStatesMap.size,
    };
  }

  /**
   * Build a full snapshot of combat state for replay
   * Called periodically (every 100 ticks) for efficient replay start points
   */
  private buildCombatSnapshot(): {
    entities: Map<string, EntitySnapshot>;
    combatStates: Map<string, CombatSnapshot>;
    rngState: SeededRandomState;
  } {
    const entities = new Map<string, EntitySnapshot>();
    const combatStates = new Map<string, CombatSnapshot>();

    // Snapshot all active combat participants
    for (const [entityId, state] of this.stateService.getCombatStatesMap()) {
      const attackerEntity = this.entityResolver.resolve(
        String(entityId),
        state.attackerType,
      );
      const targetEntity = this.entityResolver.resolve(
        String(state.targetId),
        state.targetType,
      );

      // Snapshot attacker
      if (attackerEntity) {
        const pos = getEntityPosition(attackerEntity);
        entities.set(String(entityId), {
          id: String(entityId),
          type: state.attackerType,
          position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined,
          health: this.entityResolver.getHealth(attackerEntity),
          maxHealth: attackerEntity.getMaxHealth?.() ?? 100,
        });
      }

      // Snapshot target
      if (targetEntity) {
        const pos = getEntityPosition(targetEntity);
        entities.set(String(state.targetId), {
          id: String(state.targetId),
          type: state.targetType,
          position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined,
          health: this.entityResolver.getHealth(targetEntity),
          maxHealth: targetEntity.getMaxHealth?.() ?? 100,
        });
      }

      // Snapshot combat state
      combatStates.set(String(entityId), {
        attackerId: String(entityId),
        targetId: String(state.targetId),
        startTick: state.lastAttackTick, // Use lastAttackTick as approximate start
        lastAttackTick: state.lastAttackTick,
      });
    }

    // Get RNG state for deterministic replay
    const rngState = getGameRngState() ?? { state0: "0", state1: "0" };

    return { entities, combatStates, rngState };
  }

  /**
   * Record a combat event to the EventStore
   * Includes RNG state for deterministic replay
   */
  private recordCombatEvent(
    type: GameEventType,
    entityId: string,
    payload: unknown,
  ): void {
    if (!this.eventRecordingEnabled) return;

    const tick = this.world.currentTick ?? 0;
    const stateInfo = this.buildGameStateInfo();

    // Include snapshot data periodically (every 100 ticks)
    const snapshot = tick % 100 === 0 ? this.buildCombatSnapshot() : undefined;

    this.eventStore.record(
      {
        tick,
        type,
        entityId,
        payload: {
          ...((payload as object) ?? {}),
          rngState: getGameRngState(), // Include RNG state for replay
        },
      },
      stateInfo,
      snapshot,
    );
  }

  destroy(): void {
    this.stateService.destroy();
    this.animationManager.destroy();
    this.antiCheat.destroy();
    this.rateLimiter.destroy();
    this.eventStore.destroy();
    this.projectileService.clear();
    tilePool.release(this._attackerTile);
    tilePool.release(this._targetTile);
    this.nextAttackTicks.clear();
    super.destroy();
  }

  /**
   * Decay anti-cheat scores and clean stale XP history
   * Call periodically (e.g., every minute) to prevent memory leaks
   */
  public decayAntiCheatScores(): void {
    this.antiCheat.decayScores();
    // Also clean stale XP history to prevent memory leaks from disconnected players
    const currentTick = this.world.currentTick ?? 0;
    this.antiCheat.cleanupStaleXPHistory(currentTick);
  }

  /**
   * Get pool statistics for monitoring dashboard
   * Useful for detecting memory leaks or pool exhaustion
   *
   * @see COMBAT_SYSTEM_IMPROVEMENTS.md Section 3.2
   */
  public getPoolStats(): {
    quaternions: { total: number; available: number; inUse: number };
  } {
    return {
      quaternions: quaternionPool.getStats(),
    };
  }
}
