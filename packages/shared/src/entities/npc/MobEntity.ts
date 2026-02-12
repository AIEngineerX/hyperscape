/**
 * MobEntity - Enemy/Monster Entity
 *
 * Represents hostile creatures (mobs) in the game world. Handles combat AI,
 * patrolling, aggression, and loot drops.
 *
 * **Extends**: CombatantEntity (inherits health, combat, and damage)
 *
 * **Key Features**:
 *
 * **AI Behavior**:
 * - Idle state: Stands still or patrols spawn area
 * - Patrol state: Walks between patrol points
 * - Aggro state: Detected player within aggro radius
 * - Combat state: Actively attacking target
 * - Fleeing state: Low health retreat (future)
 * - Dead state: Corpse state before despawn
 *
 * **Combat System**:
 * - Attack power and speed
 * - Defense rating
 * - Attack range (melee or ranged)
 * - Aggro radius (detection range)
 * - Combat level for XP calculations
 * - Attack styles (melee, ranged, magic)
 *
 * **Patrol System**:
 * - Generates random patrol points around spawn
 * - Walks between points when not in combat
 * - Returns to spawn area if pulled too far
 * - Configurable patrol radius
 *
 * **Aggression**:
 * - Aggro radius determines detection range
 * - Remembers last attacker
 * - Chases target within leash distance
 * - Resets when target dies or escapes
 *
 * **Loot System**:
 * - Drops items on death based on loot table
 * - Quantity randomization
 * - Rare drop chances
 * - Corpse despawn timer
 *
 * **Respawning**:
 * - Respawn timer after death
 * - Resets to spawn position
 * - Full health restoration
 * - State reset (clears aggro, target)
 *
 * **Visual Representation**:
 * - 3D model (GLB) or procedural mesh
 * - Health bar when damaged
 * - Death animation
 * - Attack animations
 * - Name shown in right-click menu (OSRS pattern)
 *
 * **Network Sync**:
 * - Position broadcast to clients
 * - State changes (idle, combat, dead)
 * - Health updates
 * - Target information
 *
 * **Database**: Mob instances are NOT persisted (respawn from spawn points)
 *
 * **Runs on**: Server (authoritative), Client (visual only)
 * **Referenced by**: MobNPCSystem, MobNPCSpawnerSystem, CombatSystem, AggroSystem
 *
 * @public
 */

import * as THREE from "../../extras/three/three";
import type {
  EntityData,
  MeshUserData,
  MobEntityData,
  Position3D,
} from "../../types";
import { AttackType } from "../../types/core/core";
import type {
  EntityInteractionData,
  MobEntityConfig,
} from "../../types/entities";
import { MobAIState } from "../../types/entities";
import { EventType } from "../../types/events";
import type { World } from "../../core/World";
import { CombatantEntity, type CombatantConfig } from "../CombatantEntity";
import { Emotes } from "../../data/playerEmotes";
// NOTE: Loot drops are handled by LootSystem, not MobEntity directly
import { DeathStateManager } from "../managers/DeathStateManager";
import { CombatStateManager } from "../managers/CombatStateManager";
import {
  AIStateMachine,
  type AIStateContext,
} from "../managers/AIStateMachine";
import { generateKillToken } from "../../utils/game/KillTokenUtils";
import { RespawnManager } from "../managers/RespawnManager";
import { COMBAT_CONSTANTS } from "../../constants/CombatConstants";
import { AggroManager } from "../managers/AggroManager";
import {
  worldToTile,
  tileToWorld,
  TICK_DURATION_MS,
  getBestStepOutTile,
} from "../../systems/shared/movement/TileSystem";
import { CollisionMask } from "../../systems/shared/movement/CollisionFlags";
import type { EntityID } from "../../types/core/identifiers";
import { getGameRng } from "../../utils/SeededRandom";
import { isTerrainSystem } from "../../utils/typeGuards";
import {
  AnimationLOD,
  getCameraPosition,
} from "../../utils/rendering/AnimationLOD";

import type { AggroSystem } from "../../systems/shared/combat/AggroSystem";
import {
  MobVisualManager,
  type MobVisualContext,
} from "../managers/MobVisualManager";
import {
  MobMovementManager,
  type MobMovementContext,
} from "../managers/MobMovementManager";
import {
  MobHealthBarManager,
  type MobHealthBarContext,
} from "../managers/MobHealthBarManager";

// Polyfill ProgressEvent for Node.js server environment

if (typeof ProgressEvent === "undefined") {
  const ProgressEventPolyfill = class extends Event {
    lengthComputable = false;
    loaded = 0;
    total = 0;
    constructor(
      type: string,
      init?: { lengthComputable?: boolean; loaded?: number; total?: number },
    ) {
      super(type);
      if (init) {
        this.lengthComputable = init.lengthComputable || false;
        this.loaded = init.loaded || 0;
        this.total = init.total || 0;
      }
    }
  };
  (
    globalThis as unknown as { ProgressEvent?: typeof ProgressEventPolyfill }
  ).ProgressEvent = ProgressEventPolyfill;
}

/** Valid melee attack styles for XP validation (avoids granting wrong XP type) */
const MELEE_STYLES = new Set([
  "accurate",
  "aggressive",
  "defensive",
  "controlled",
]);

export class MobEntity extends CombatantEntity {
  protected config: MobEntityConfig;

  private deathManager: DeathStateManager;
  private combatManager: CombatStateManager;
  private aiStateMachine: AIStateMachine;
  private respawnManager: RespawnManager;
  private aggroManager: AggroManager;

  private visualManager!: MobVisualManager;
  private movementManager!: MobMovementManager;
  private healthBarManager!: MobHealthBarManager;
  private _serverEmote: string | null = null; // Server-forced one-shot emote (e.g., combat)
  private _tempMatrix = new THREE.Matrix4();
  private _tempScale = new THREE.Vector3(1, 1, 1);
  // Pre-allocated temps for update/lateUpdate to avoid per-frame allocations
  private _combatQuat = new THREE.Quaternion();
  private _combatAxis = new THREE.Vector3(0, 1, 0);
  /** Tracked combat rotation state — slerped privately then copied to node.quaternion */
  private _smoothedCombatQuat = new THREE.Quaternion();
  private _hasCombatRot = false;
  private _hasValidTerrainHeight = false;
  // Track if we've received authoritative position from server (Issue #416 fix)
  // Ensures all clients start with same XZ before terrain snapping
  private _hasReceivedServerPosition = false;
  // Track if death position has been terrain-snapped (Issue #244 fix)
  // Ensures death animation plays at ground level, not floating
  private _deathPositionTerrainSnapped = false;
  // Track if visibility needs to be restored after respawn position update
  private _pendingRespawnRestore = false;

  /** Animation LOD controller - throttles animation updates for distant mobs */
  private readonly _animationLOD = new AnimationLOD({
    fullDistance: 30, // Full 60fps animation within 30m
    halfDistance: 60, // 30fps animation at 30-60m
    quarterDistance: 100, // 15fps animation at 60-100m
    pauseDistance: 150, // No animation beyond 150m (bind pose)
  });

  /** Duration of death animation in ticks (7 ticks = 4200ms at 600ms/tick) */
  private readonly DEATH_ANIMATION_TICKS = 7;

  // findUnoccupiedSpawnTile, registerOccupancy, unregisterOccupancy,
  // updateOccupancy, generatePatrolPoints, moveTowardsTarget,
  // generateWanderTarget, getDistance2D, getSpawnDistanceTiles
  // are delegated to MobMovementManager

  // Health bar init, updateHealthBar, position, visibility, destroy/recreate
  // are delegated to MobHealthBarManager

  private _justRespawned = false; // Track if we just respawned (for one-time logging)

  // AI runs once per server tick (600ms), not every frame (~16ms)
  private _lastAITick: number = -1;

  async init(): Promise<void> {
    await super.init();

    // Register for update loop (both client and server)
    // Client: VRM animations via clientUpdate()
    // Server: AI behavior via serverUpdate()
    this.world.setHot(this, true);

    // Register health bar with HealthBars system (client-side only)
    this.healthBarManager.init();

    // NOTE: Server-side validation disabled due to ProgressEvent polyfill issues
    // Validation happens on client side instead (see clientUpdate)
  }

  /**
   * Override initializeVisuals to skip sprite health bar creation
   * MobEntity uses HealthBars system (atlas + instanced mesh) instead
   */
  protected override initializeVisuals(): void {
    // Call parent but it won't create health bar for mobs because we override createHealthBar
    // Note: We still want name tags from Entity.ts if applicable
    // But mobs don't show nametags (RS pattern: names in right-click menu only)
    // So just create the mesh without UI elements
  }

  constructor(world: World, config: MobEntityConfig) {
    // Convert MobEntityConfig to CombatantConfig format with proper type assertion
    // attackSpeedTicks is in game ticks (600ms each), convert to attacks/second for legacy field
    const attacksPerSecond = 1.0 / (config.attackSpeedTicks * 0.6);
    const combatConfig = {
      ...config,
      rotation: config.rotation || { x: 0, y: 0, z: 0, w: 1 },
      combat: {
        attack: Math.floor(config.attackPower / 10),
        defense: Math.floor(config.defense / 10),
        attackSpeed: attacksPerSecond,
        criticalChance: 0.05,
        combatLevel: config.level,
        respawnTime: config.respawnTime,
        aggroRadius: config.aggroRange,
        attackRange: config.combatRange,
      },
    } as unknown as CombatantConfig;

    super(world, combatConfig);
    this.config = config;

    // Initialize visual manager with context bridging to this entity
    const visualContext: MobVisualContext = {
      world: this.world,
      config: this.config,
      id: this.id,
      node: this.node,
      getMesh: () => this.mesh,
      setMesh: (m) => {
        this.mesh = m;
      },
    };
    this.visualManager = new MobVisualManager(visualContext);

    // Initialize health bar manager with context bridging to this entity
    const healthBarContext: MobHealthBarContext = {
      world: this.world,
      config: this.config,
      id: this.id,
      node: this.node,
      getHealth: () => this.health,
      getMaxHealth: () => this.maxHealth,
      setHealth: (h) => this.setHealth(h),
      isCurrentlyDead: () => this.deathManager?.isCurrentlyDead() ?? false,
    };
    // NOTE: healthBarManager is initialized here but deathManager may not yet be set;
    // isCurrentlyDead uses optional chaining to handle the initialization order.

    // Entity constructor defaults to 100/100 - sync with config
    this.health = config.currentHealth;
    this.maxHealth = config.maxHealth;
    this.data.health = this.health;
    (this.data as { maxHealth?: number }).maxHealth = this.maxHealth;

    // Manifest is source of truth for respawnTime - no minimum enforcement
    if (!this.config.respawnTime) {
      this.config.respawnTime = 15000; // Default 15s if not specified
    }

    // Death State Manager
    this.deathManager = new DeathStateManager({
      respawnTime: this.config.respawnTime,
      deathAnimationDuration: this.DEATH_ANIMATION_TICKS * TICK_DURATION_MS,
      spawnPoint: this.config.spawnPoint,
    });

    // Wire up death manager callbacks (handles visibility during death animation only)
    this.deathManager.onMeshVisibilityChange((visible) => {
      if (this.mesh) {
        this.mesh.visible = visible;
      }
    });

    // NOTE: Respawn callback is now handled by RespawnManager, not DeathStateManager

    // Combat State Manager (TICK-BASED)
    // attackSpeedTicks from manifest is already in ticks
    this.combatManager = new CombatStateManager({
      attackPower: this.config.attackPower,
      attackSpeedTicks: this.config.attackSpeedTicks,
      attackRange: this.config.combatRange,
    });

    // Wire up combat manager callbacks
    this.combatManager.onAttack((targetId) => {
      this.performAttackAction(targetId);
    });

    // AI State Machine
    this.aiStateMachine = new AIStateMachine();

    // Aggro Manager - handles targeting and aggro detection
    this.aggroManager = new AggroManager({
      aggroRange: this.config.aggroRange,
      combatRange: this.config.combatRange,
    });

    // Respawn Manager - handles spawn area and respawn locations
    this.respawnManager = new RespawnManager({
      spawnAreaCenter: this.config.spawnPoint, // Use spawnPoint as center of spawn area
      spawnAreaRadius: this.config.wanderRadius || this.config.aggroRange, // Spawn anywhere within wander/aggro range
      respawnTimeMin: this.config.respawnTime,
      respawnTimeMax: this.config.respawnTime + 5000, // Add 5s randomness
    });

    // Wire up respawn manager callback
    this.respawnManager.onRespawn((spawnPoint) => {
      this.handleRespawn(spawnPoint);
    });

    // Listen for player deaths - disengage if we were targeting them
    this.world.on(EventType.PLAYER_SET_DEAD, (data: unknown) => {
      const deathData = data as { playerId: string; isDead: boolean };
      if (
        deathData.isDead &&
        this.config.targetPlayerId === deathData.playerId
      ) {
        this.clearTargetAndExitCombat();
      }
    });

    // CRITICAL: Server uses RespawnManager to generate random spawn position
    // Client uses position from config (which comes from network data - the server's authoritative position)
    // This prevents client from generating its own random position that differs from server
    let initialSpawnPoint: Position3D;

    if (this.world.isServer) {
      // Server: Generate random position within spawn area
      initialSpawnPoint = this.respawnManager.generateSpawnPoint();
    } else {
      // Client: Use position from network data (via config.spawnPoint)
      // The server already determined the correct position, client should not randomize
      initialSpawnPoint = { ...this.config.spawnPoint };
    }

    // Initialize movement manager with context bridging to this entity
    const movementContext: MobMovementContext = {
      world: this.world,
      config: this.config,
      id: this.id,
      node: this.node,
      position: this.position,
      getPosition: () => this.getPosition(),
      setPosition: (x, y, z) => this.setPosition(x, y, z),
      markNetworkDirty: () => this.markNetworkDirty(),
      setHealth: (h) => this.setHealth(h),
      setProperty: (k, v) => this.setProperty(k, v),
    };
    this.movementManager = new MobMovementManager(
      movementContext,
      initialSpawnPoint,
    );

    // Initialize health bar manager (context was created above, before deathManager)
    this.healthBarManager = new MobHealthBarManager(healthBarContext);

    this.setPosition(
      initialSpawnPoint.x,
      initialSpawnPoint.y,
      initialSpawnPoint.z,
    );
    this.node.position.set(
      initialSpawnPoint.x,
      initialSpawnPoint.y,
      initialSpawnPoint.z,
    );

    // Register tile occupancy for OSRS-accurate NPC collision
    // Called after position is set (server-only, no-op on client)
    this.movementManager.registerOccupancy();

    this.movementManager.generatePatrolPoints();

    // Set entity properties for systems to access
    this.setProperty("mobType", config.mobType);
    this.setProperty("level", config.level);
    this.setProperty("health", {
      current: config.currentHealth,
      max: config.maxHealth,
    });

    // Add stats component for skills system compatibility
    this.addComponent("stats", {
      // Combat stats - mobs have simplified skills
      attack: {
        level: Math.max(1, Math.floor(config.attackPower / 10)),
        xp: 0,
      },
      strength: {
        level: Math.max(1, Math.floor(config.attackPower / 10)),
        xp: 0,
      },
      defense: { level: Math.max(1, Math.floor(config.defense / 10)), xp: 0 },
      constitution: { level: Math.max(10, config.level), xp: 0 },
      ranged: { level: 1, xp: 0 }, // Most mobs don't use ranged
      // Non-combat skills not applicable to mobs
      woodcutting: { level: 1, xp: 0 },
      mining: { level: 1, xp: 0 },
      fishing: { level: 1, xp: 0 },
      firemaking: { level: 1, xp: 0 },
      cooking: { level: 1, xp: 0 },
      // Additional stats
      combatLevel: config.level,
      totalLevel: config.level * 5, // Approximate
      health: config.currentHealth,
      maxHealth: config.maxHealth,
      level: config.level,
      // HP stats for combat level calculation
      hitpoints: {
        level: Math.max(10, config.level),
        current: config.currentHealth,
        max: config.maxHealth,
      },
      prayer: { level: 1, points: 0 }, // Mobs don't use prayer
      magic: { level: 1, xp: 0 }, // Basic mobs don't use magic
    });
  }

  // setupAnimations, loadVRMModel, loadVRMModelAsync, loadIdleAnimation,
  // createRaycastProxy, destroyRaycastProxy are delegated to MobVisualManager

  protected async createMesh(): Promise<void> {
    return this.visualManager.createMesh();
  }

  protected async onInteract(data: EntityInteractionData): Promise<void> {
    // Handle attack interaction
    if (data.interactionType === "attack") {
      this.world.emit(EventType.COMBAT_ATTACK_REQUEST, {
        attackerId: data.playerId,
        targetId: this.id,
        attackerType: "player",
        targetType: "mob",
        attackType: AttackType.MELEE,
        position: this.getPosition(),
      });
    } else {
      // Default interaction - show mob info or examine
      this.world.emit(EventType.MOB_NPC_EXAMINE, {
        playerId: data.playerId,
        mobId: this.id,
        mobData: this.getMobData(),
      });
    }
  }

  /**
   * Create AI State Context for the state machine
   * This provides all the methods the AI states need to interact with the mob
   */
  private createAIContext(): AIStateContext {
    return {
      // Position & Movement
      getPosition: () => this.getPosition(),
      moveTowards: (target, _deltaTime) => {
        // Delegate tile movement request to MobMovementManager
        // The deltaTime parameter is ignored - movement is now tick-based
        this.movementManager.emitTileMoveRequest(target);
      },
      teleportTo: (position) => {
        this.setPosition(position.x, position.y, position.z);
        this.config.aiState = MobAIState.IDLE;
        this.config.currentHealth = this.config.maxHealth;
        this.setHealth(this.config.maxHealth);
        this.setProperty("health", {
          current: this.config.maxHealth,
          max: this.config.maxHealth,
        });
        this.combatManager.exitCombat();
        this.markNetworkDirty();
      },

      // Targeting
      findNearbyPlayer: () => this.findNearbyPlayer(),
      getPlayer: (playerId) => this.getPlayer(playerId),
      getCurrentTarget: () => this.config.targetPlayerId,
      setTarget: (playerId) => {
        this.config.targetPlayerId = playerId;
        if (playerId) {
          this.aggroManager.setTarget(playerId);
        } else {
          this.aggroManager.clearTarget();
        }
      },

      // Combat (TICK-BASED, OSRS-accurate)
      canAttack: (currentTick) => this.combatManager.canAttack(currentTick),
      performAttack: (targetId, currentTick) => {
        this.combatManager.performAttack(targetId, currentTick);
      },
      onEnterCombatRange: (currentTick) => {
        this.combatManager.onEnterCombatRange(currentTick);
      },
      isInCombat: () => this.combatManager.isInCombat(),
      exitCombat: () => this.combatManager.exitCombat(),

      // Spawn & Leashing (use CURRENT spawn location, not area center)
      // CRITICAL: Return mob's current spawn point (changes on respawn)
      // NOT the spawn area center (which is fixed)
      getSpawnPoint: () => this.movementManager.getCurrentSpawnPoint(),
      getDistanceFromSpawn: () => this.movementManager.getSpawnDistanceTiles(), // OSRS Chebyshev tiles
      getWanderRadius: () => this.respawnManager.getSpawnAreaRadius(),
      getLeashRange: () => this.movementManager.getLeashRange(),
      getCombatRange: () => this.config.combatRange,

      // Wander
      getWanderTarget: () => {
        const wt = this.movementManager.getWanderTarget();
        return wt ? { ...wt, y: this.getPosition().y } : null;
      },
      setWanderTarget: (target) => {
        this.movementManager.setWanderTarget(
          target ? { x: target.x, z: target.z } : null,
        );
      },
      generateWanderTarget: () => this.movementManager.generateWanderTarget(),

      // Movement type (from manifest)
      getMovementType: () => this.config.movementType,

      // Timing
      getCurrentTick: () => this.world.currentTick, // Server tick number for combat timing
      getTime: () => Date.now(), // Date.now() for non-combat timing (idle duration, etc.)

      // State management
      markNetworkDirty: () => this.markNetworkDirty(),
      emitEvent: (eventType, data) => {
        this.world.emit(eventType as EventType, data);
      },

      // Entity Occupancy (OSRS-accurate NPC collision)
      getEntityId: () => this.id as EntityID,
      getEntityOccupancy: () => this.world.entityOccupancy,
      isWalkable: (tile) => {
        // Check CollisionMatrix for static objects (trees, rocks, stations)
        if (
          this.world.collision.hasFlags(
            tile.x,
            tile.z,
            CollisionMask.BLOCKS_WALK,
          )
        ) {
          return false;
        }

        // Check terrain walkability using TerrainSystem if available
        const terrain = this.world.getSystem("terrain");
        if (isTerrainSystem(terrain)) {
          const worldPos = tileToWorld(tile);
          const result = terrain.isPositionWalkable(worldPos.x, worldPos.z);
          return result.walkable;
        }
        // Fallback: assume walkable if no terrain system
        return true;
      },

      // Same-tile step-out (OSRS-accurate)
      // When NPC is on same tile as target, it cannot attack.
      // Tries all 4 cardinal directions in shuffled order, picking the first
      // valid tile (walkable terrain + no entity blocking).
      // Returns false if ALL directions are blocked (mob is stuck).
      tryStepOutCardinal: (): boolean => {
        const currentPos = this.getPosition();
        const currentTile = worldToTile(currentPos.x, currentPos.z);

        // Use game RNG for deterministic shuffled direction order
        const rng = getGameRng();

        // Find best step-out tile (checks walkability + entity occupancy)
        // Uses shuffled order for OSRS-style randomness
        const stepOutTile = getBestStepOutTile(
          currentTile,
          this.world.entityOccupancy,
          this.id as EntityID,
          (tile) => {
            // Check CollisionMatrix for static objects (trees, rocks, stations)
            if (
              this.world.collision.hasFlags(
                tile.x,
                tile.z,
                CollisionMask.BLOCKS_WALK,
              )
            ) {
              return false;
            }

            // Check terrain walkability using type guard
            const terrain = this.world.getSystem?.("terrain");
            if (isTerrainSystem(terrain)) {
              const worldPos = tileToWorld(tile);
              const result = terrain.isPositionWalkable(worldPos.x, worldPos.z);
              return result.walkable;
            }
            // Fallback: assume walkable if no terrain system
            return true;
          },
          rng,
        );

        // If no valid tile found, all directions are blocked
        if (!stepOutTile) {
          // All cardinal tiles blocked - wait for next tick
          // In OSRS, mob would be stuck until a tile opens up
          return false;
        }

        // Convert to world position
        const targetWorld = tileToWorld(stepOutTile);
        const targetPos = {
          x: targetWorld.x,
          y: currentPos.y,
          z: targetWorld.z,
        };

        // Emit movement request
        this.world.emit(EventType.MOB_NPC_MOVE_REQUEST, {
          mobId: this.id,
          targetPos: targetPos,
          targetEntityId: undefined, // Not chasing - just stepping out
          tilesPerTick: 1, // Single tile step
        });

        return true; // Valid tile found and movement requested
      },
    };
  }

  // generateWanderTarget is delegated to MobMovementManager

  /**
   * Handle respawn callback from RespawnManager (SERVER-SIDE)
   * Handles game logic: health reset, state changes, position teleport
   * Visual restoration happens on client side in handleClientRespawn()
   *
   * @param spawnPoint - Random spawn point generated by RespawnManager
   */
  private handleRespawn(spawnPoint: Position3D): void {
    // Reset health and state
    this.config.currentHealth = this.config.maxHealth;
    this.setHealth(this.config.maxHealth);
    this.setProperty("health", {
      current: this.config.maxHealth,
      max: this.config.maxHealth,
    });

    // Reset AI state - set to IDLE first, then force AI state machine to IDLE
    this.config.aiState = MobAIState.IDLE;
    this.config.targetPlayerId = null;
    this.config.deathTime = null;

    // Clear aggro target
    this.aggroManager.clearTarget();

    // CRITICAL: Reset DeathStateManager BEFORE network sync
    // Without this, getNetworkData() thinks mob is still dead and strips position from network packet!
    this.deathManager.reset();
    // Reset death terrain snap flag for next death (Issue #244)
    this._deathPositionTerrainSnapped = false;

    // CRITICAL: Force AI state machine to IDLE state after respawn
    this.aiStateMachine.forceState(MobAIState.IDLE, this.createAIContext());

    // Clear combat state
    this.combatManager.exitCombat();

    // Clear any combat state in CombatSystem
    const combatSystem = this.world.getSystem("combat");
    if (combatSystem) {
      combatSystem.forceEndCombat(this.id);
    }

    // CRITICAL: Update current spawn point to NEW random location
    // This ensures AI (patrol, leashing, return) uses the new spawn location
    this.movementManager.setCurrentSpawnPoint(spawnPoint);

    // Regenerate patrol points around NEW spawn location
    this.movementManager.regeneratePatrolPoints();

    // Teleport to NEW random spawn point (generated by RespawnManager)
    this.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);

    // CRITICAL: Force update node position (setPosition might only update this.position)
    this.node.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);

    // Register tile occupancy at new spawn location
    this.movementManager.registerOccupancy();

    // Update userData
    if (this.mesh?.userData) {
      const userData = this.mesh.userData as MeshUserData;
      if (userData.mobData) {
        userData.mobData.health = this.config.currentHealth;
      }
    }

    // Emit respawn event
    this.world.emit(EventType.MOB_NPC_RESPAWNED, {
      mobId: this.id,
      position: this.getPosition(),
    });

    // Set flag to log next network sync (one-time only)
    this._justRespawned = true;

    this.markNetworkDirty();
  }

  // NOTE: Client-side respawn restoration is now handled inline in modify()
  // AFTER super.modify() updates the position from server
  // This ensures the VRM is moved to the correct spawn location, not the death location

  /**
   * Perform attack action (called by CombatStateManager)
   */
  private performAttackAction(targetId: string): void {
    this.world.emit(EventType.COMBAT_MOB_NPC_ATTACK, {
      mobId: this.id,
      targetId: targetId,
      damage: this.config.attackPower,
      attackerType: "mob",
      targetType: "player",
      attackType: this.config.attackType ?? "melee",
      spellId: this.config.spellId,
      arrowId: this.config.arrowId,
    });
  }

  /**
   * SERVER-SIDE UPDATE
   * Handles AI logic, pathfinding, combat, and state management
   * Changes are synced to clients via getNetworkData() and markNetworkDirty()
   */
  private serverUpdateCalls = 0;

  protected serverUpdate(deltaTime: number): void {
    super.serverUpdate(deltaTime);
    this.serverUpdateCalls++;

    // Handle death state (position locking during death animation)
    if (this.deathManager.isCurrentlyDead()) {
      // Use Date.now() for consistent millisecond timing (world.getTime() has inconsistent units)
      const currentTime = Date.now();

      // Lock position to death location (prevent any movement)
      const lockedPos = this.deathManager.getLockedPosition();
      if (lockedPos) {
        // Forcefully lock position every frame (defense in depth)
        if (
          this.position.x !== lockedPos.x ||
          this.position.y !== lockedPos.y ||
          this.position.z !== lockedPos.z
        ) {
          console.warn(
            `[MobEntity] ⚠️ Server position moved while dead! Restoring lock.`,
          );
          this.position.copy(lockedPos);
          this.node.position.copy(lockedPos);
        }
      }

      // Update death manager (handles death animation timing only, not respawn)
      this.deathManager.update(deltaTime, currentTime);

      // Update respawn manager (TICK-BASED - handles respawn timer and location)
      // Uses server tick for OSRS-accurate timing instead of Date.now()
      if (this.respawnManager.isRespawnTimerActive()) {
        this.respawnManager.update(this.world.currentTick);
      }

      return; // Don't run AI when dead
    }

    // Validate target is still alive before running AI (RuneScape-style: instant disengage on target death)
    if (this.config.targetPlayerId) {
      const targetPlayer = this.world.getPlayer(this.config.targetPlayerId);

      // Target is dead or gone - immediately disengage
      if (!targetPlayer || targetPlayer.health.current <= 0) {
        this.clearTargetAndExitCombat();
      }
    }

    // AI runs once per server tick (600ms), not every frame
    const currentTick = this.world.currentTick;
    if (currentTick === this._lastAITick) {
      // Same tick as last AI update - skip AI processing
      // This saves ~59 out of 60 AI updates per second
      return;
    }
    this._lastAITick = currentTick;

    // Update AI state machine (now runs once per tick instead of every frame)
    this.aiStateMachine.update(this.createAIContext(), deltaTime);

    // Sync config.aiState with AI state machine current state
    this.config.aiState = this.aiStateMachine.getCurrentState();
  }

  // getEmoteForAIState, isPriorityEmote, isCombatEmote, applyServerEmote,
  // updateAnimation are delegated to MobVisualManager

  /**
   * CLIENT-SIDE UPDATE
   * Handles visual updates: animations, interpolation, and rendering
   * Position and AI state are synced from server via modify()
   */
  private clientUpdateCalls = 0;
  private initialBonePosition: THREE.Vector3 | null = null;

  // Track when death animation started on client (in Date.now() milliseconds)
  private clientDeathStartTime: number | null = null;

  /**
   * Override health bar rendering to use HealthBars system (atlas + instanced mesh)
   * Delegates to MobHealthBarManager
   */
  protected override updateHealthBar(): void {
    this.healthBarManager.updateHealthBar();
  }

  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);
    this.clientUpdateCalls++;

    // ANIMATION LOD: Calculate distance to camera once and throttle animation updates
    // This reduces CPU/GPU load for distant mobs significantly (50-80% savings)
    const cameraPos = getCameraPosition(this.world);
    const animLODResult = cameraPos
      ? this._animationLOD.updateFromPosition(
          this.node.position.x,
          this.node.position.z,
          cameraPos.x,
          cameraPos.z,
          deltaTime,
        )
      : {
          shouldUpdate: true,
          effectiveDelta: deltaTime,
          lodLevel: 0,
          distanceSq: 0,
        };

    // Update health bar position and visibility (delegated to MobHealthBarManager)
    this.healthBarManager.updatePosition();
    this.healthBarManager.updateVisibilityTimeout();

    // Handle dead state on client (hide mesh and stop VRM animation after death animation)
    if (this.config.aiState === MobAIState.DEAD) {
      // Start tracking client-side death time when we first see DEAD state
      if (!this.clientDeathStartTime) {
        this.clientDeathStartTime = Date.now();
        // Destroy health bar immediately when mob dies (frees atlas slot)
        this.healthBarManager.destroyOnDeath();
      }

      const currentTime = Date.now();
      const timeSinceDeath = currentTime - this.clientDeathStartTime;

      // Hide mesh and VRM after death animation finishes
      if (timeSinceDeath >= this.DEATH_ANIMATION_TICKS * TICK_DURATION_MS) {
        // Hide the mesh
        if (this.mesh && this.mesh.visible) {
          this.mesh.visible = false;
        }
        // Hide the node (contains VRM scene)
        if (this.node && this.node.visible) {
          this.node.visible = false;
        }
        // CRITICAL: Stop the VRM animation mixer by clearing the emote
        // This prevents the death animation from looping
        const avatarInst = this.visualManager.getAvatarInstance();
        if (
          avatarInst &&
          this.visualManager.getCurrentEmote() === Emotes.DEATH
        ) {
          this.visualManager.setCurrentEmote(""); // Clear emote to stop mixer
          avatarInst.setEmote(""); // Stop animation playback
          this.visualManager.setManualEmoteOverrideUntil(0); // Clear override
        }
        // Skip all further updates while dead and invisible
        return;
      }
    } else {
      // Not dead anymore - this is handled in modify() when state changes
      // No need for duplicate logic here
    }

    // VRM path: Use avatar instance update (handles everything)
    const _avatarInstance = this.visualManager.getAvatarInstance();
    if (_avatarInstance) {
      // CRITICAL: Don't switch emotes while in DEAD state
      // The death animation was already set via server emote, just let it play
      // After 4.5s the node will be hidden above
      if (this.config.aiState !== MobAIState.DEAD) {
        // Skip AI-based emote updates if manual override is active (for one-shot attack animations)
        const now = Date.now();
        if (now >= this.visualManager.getManualEmoteOverrideUntil()) {
          // Switch animation based on AI state (walk when patrolling/chasing, idle otherwise)
          const targetEmote = this.visualManager.getEmoteForAIState(
            this.config.aiState,
          );
          if (this.visualManager.getCurrentEmote() !== targetEmote) {
            this.visualManager.setCurrentEmote(targetEmote);
            _avatarInstance.setEmote(targetEmote);
          }
        }
      }

      // COMBAT ROTATION: Rotate to face target when in ATTACK state (RuneScape-style)
      // BUT: Only apply combat rotation when NOT moving via tile movement
      // TileInterpolator handles rotation when entity is walking/running
      const isTileMoving = this.data.tileMovementActive === true;
      const inCombatRotation =
        !isTileMoving &&
        this.config.aiState === MobAIState.ATTACK &&
        this.config.targetPlayerId;

      if (!inCombatRotation) {
        // Reset tracked state so next combat entry seeds from current facing
        this._hasCombatRot = false;
      }

      if (inCombatRotation && this.config.targetPlayerId) {
        const targetPlayer = this.world.getPlayer?.(this.config.targetPlayerId);
        if (targetPlayer && targetPlayer.position) {
          const dx = targetPlayer.position.x - this.position.x;
          const dz = targetPlayer.position.z - this.position.z;
          const distanceSquared = dx * dx + dz * dz;

          // OSRS-ACCURATE: Skip rotation when on same tile (distance too small)
          // Prevents 180° flips from floating-point instability when dx ≈ 0, dz ≈ 0
          if (
            distanceSquared >=
            COMBAT_CONSTANTS.ROTATION.MIN_ROTATION_DISTANCE_SQ
          ) {
            let angle = Math.atan2(dx, dz);

            // VRM 1.0+ models have 180° base rotation, so we need to compensate
            // Otherwise entities face AWAY from each other instead of towards
            angle += Math.PI;

            // Smooth combat rotation using exponential decay (~95% in 150ms)
            this._combatQuat.setFromAxisAngle(this._combatAxis, angle);

            if (!this._hasCombatRot) {
              // First frame of combat: seed from current facing direction
              this._smoothedCombatQuat.copy(this.node.quaternion);
              this._hasCombatRot = true;
            }

            // Slerp on private tracked quaternion (immune to external quaternion resets)
            const combatRotAlpha =
              1 -
              Math.exp(
                -deltaTime * COMBAT_CONSTANTS.ROTATION.COMBAT_SLERP_SPEED,
              );
            this._smoothedCombatQuat.slerp(this._combatQuat, combatRotAlpha);

            // Full overwrite — no other system can fight this
            this.node.quaternion.copy(this._smoothedCombatQuat);
          }
          // else: preserve current facing direction (no rotation update)
        }
      }

      // If mob is dead, lock position to prevent death animation from sliding
      const lockedPos = this.deathManager.getLockedPosition();
      if (lockedPos) {
        this.node.position.copy(lockedPos);
        this.position.copy(lockedPos);
      } else {
        // CRITICAL: Snap to terrain EVERY frame (server doesn't have terrain system)
        // Keep trying until terrain tile is generated, then snap every frame
        // This also counteracts VRM animation root motion that would push character into ground
        //
        // Issue #416 fix: Only snap to terrain AFTER receiving server position
        // This ensures all clients use same XZ coordinates for terrain lookup,
        // preventing Y desync between clients with different terrain load times
        if (this._hasReceivedServerPosition) {
          const terrain = this.world.getSystem("terrain");
          if (terrain && "getHeightAt" in terrain) {
            try {
              // CRITICAL: Must call method on terrain object to preserve 'this' context
              const terrainHeight = (
                terrain as { getHeightAt: (x: number, z: number) => number }
              ).getHeightAt(this.node.position.x, this.node.position.z);
              if (Number.isFinite(terrainHeight)) {
                this._hasValidTerrainHeight = true;
                this.node.position.y = terrainHeight;
                this.position.y = terrainHeight;
              }
            } catch (_err) {
              // Terrain tile not generated yet - keep current Y and retry next frame
              if (
                this.clientUpdateCalls === 10 &&
                !this._hasValidTerrainHeight
              ) {
                console.warn(
                  `[MobEntity] Waiting for terrain tile to generate at (${this.node.position.x.toFixed(1)}, ${this.node.position.z.toFixed(1)})`,
                );
              }
            }
          }
        }
      }

      // Update node transform matrices
      // NOTE: ClientNetwork updates XZ from server, we calculate Y from client terrain
      this.node.updateMatrix();
      this.node.updateMatrixWorld(true);

      // SPECIAL HANDLING FOR DEATH: Lock position, let animation play
      const deathLockedPos = this.deathManager.getLockedPosition();
      if (deathLockedPos) {
        // Issue #244 fix: Terrain-snap death position ONCE to prevent floating death animation
        // Server doesn't have terrain, so death position Y may be stale/incorrect
        if (!this._deathPositionTerrainSnapped) {
          const terrain = this.world.getSystem("terrain");
          if (terrain && "getHeightAt" in terrain) {
            try {
              const terrainHeight = (
                terrain as { getHeightAt: (x: number, z: number) => number }
              ).getHeightAt(deathLockedPos.x, deathLockedPos.z);
              if (Number.isFinite(terrainHeight)) {
                // Snap death position to ground level
                deathLockedPos.y = terrainHeight;
                this._deathPositionTerrainSnapped = true;
              }
            } catch (_err) {
              // Terrain not ready yet, will retry next frame
            }
          }
        }

        // Lock the node position to death position (prevents teleporting)
        this.node.position.copy(deathLockedPos);
        this.position.copy(deathLockedPos);
        this.node.updateMatrix();
        this.node.updateMatrixWorld(true);

        // DON'T call move() - it causes sliding due to internal interpolation
        // VRM scene was positioned once in modify() when entering death state
        // Just update the animation, VRM scene stays locked
        // NOTE: Death animations always run at full speed (no LOD throttling)
        _avatarInstance.update(deltaTime);
      } else {
        // NORMAL PATH: Use move() to sync VRM - it preserves the VRM's internal scale
        // move() applies vrm.scene.scale to maintain height normalization
        _avatarInstance.move(this.node.matrixWorld);

        // ANIMATION LOD: Only update VRM animations when LOD allows
        // This significantly reduces CPU/GPU load for distant mobs
        if (animLODResult.shouldUpdate) {
          // Update VRM animations (mixer + humanoid + skeleton)
          // Use effectiveDelta which may be accumulated from skipped frames
          _avatarInstance.update(animLODResult.effectiveDelta);
        }
      }

      // Post-animation position locking for non-death states
      if (this.config.aiState !== MobAIState.DEAD) {
        // CRITICAL: Re-snap to terrain AFTER animation update to counteract root motion
        // Animation root motion can push character down/back, so we fix position after it applies
        const terrain = this.world.getSystem("terrain");
        if (terrain && "getHeightAt" in terrain) {
          try {
            const terrainHeight = (
              terrain as { getHeightAt: (x: number, z: number) => number }
            ).getHeightAt(this.node.position.x, this.node.position.z);
            if (Number.isFinite(terrainHeight)) {
              this.node.position.y = terrainHeight;
              this.position.y = terrainHeight;

              // CRITICAL: Update matrices and call move() again to apply corrected Y position to VRM
              this.node.updateMatrix();
              this.node.updateMatrixWorld(true);
              _avatarInstance.move(this.node.matrixWorld);
            }
          } catch (_err) {
            // Terrain tile not generated yet
          }
        }
      }

      // VRM handles all animation internally
      return;
    }

    // If mesh is the placeholder hitbox, skip animation (VRM still loading)
    if (this.mesh === this.visualManager.getRaycastProxy()) {
      // Just update position from terrain while waiting for VRM to load
      const terrain = this.world.getSystem("terrain");
      if (terrain && "getHeightAt" in terrain) {
        try {
          const terrainHeight = (
            terrain as { getHeightAt: (x: number, z: number) => number }
          ).getHeightAt(this.node.position.x, this.node.position.z);
          if (Number.isFinite(terrainHeight)) {
            this.node.position.y = terrainHeight;
            this.position.y = terrainHeight;
          }
        } catch {
          // Terrain tile not generated yet
        }
      }
      return; // No animation updates while in placeholder mode
    }

    // GLB path: Existing animation code for non-VRM mobs
    // Update animations based on AI state
    this.visualManager.updateAnimation(this.config.aiState);

    // Update animation mixer
    const mixer = this.visualManager.getMixer();

    // Note: Mixer may not exist for mobs with no animations - that's OK
    // The visible placeholder fallback doesn't have a mixer

    // ANIMATION LOD: Only update mixer when LOD allows
    // This significantly reduces CPU/GPU load for distant mobs
    if (mixer && animLODResult.shouldUpdate) {
      mixer.update(animLODResult.effectiveDelta);

      // Update skeleton bones using pre-defined callback to avoid GC pressure
      if (this.mesh) {
        this.mesh.traverse(this._updateSkeletonCallback);
      }
    }
  }

  /**
   * Pre-defined callback for skeleton update to avoid creating new functions every frame
   * Called from lateUpdate via mesh.traverse()
   */
  private _updateSkeletonCallback = (child: THREE.Object3D): void => {
    if (child instanceof THREE.SkinnedMesh && child.skeleton) {
      const skeleton = child.skeleton;

      // Update bone matrices using for-loop instead of forEach to avoid callback allocation
      const bones = skeleton.bones;
      for (let i = 0; i < bones.length; i++) {
        bones[i].updateMatrixWorld();
      }
      skeleton.update();

      // VALIDATION: Check if bones are actually transforming (only first 60 frames)
      if (this.clientUpdateCalls === 1) {
        // Find hips bone using for-loop instead of .find()
        let hipsBone: THREE.Bone | undefined;
        for (let i = 0; i < bones.length; i++) {
          if (bones[i].name.toLowerCase().includes("hips")) {
            hipsBone = bones[i];
            break;
          }
        }
        if (hipsBone) {
          // Use copy instead of clone to reuse existing object if available
          if (!this.initialBonePosition) {
            this.initialBonePosition = hipsBone.position.clone();
          } else {
            this.initialBonePosition.copy(hipsBone.position);
          }
        }
      } else if (this.clientUpdateCalls === 60) {
        // Find hips bone using for-loop instead of .find()
        let hipsBone: THREE.Bone | undefined;
        for (let i = 0; i < bones.length; i++) {
          if (bones[i].name.toLowerCase().includes("hips")) {
            hipsBone = bones[i];
            break;
          }
        }
        if (hipsBone && this.initialBonePosition) {
          const distance = hipsBone.position.distanceTo(
            this.initialBonePosition,
          );
          if (distance < 0.001) {
            const glbMixer = this.visualManager.getMixer();
            throw new Error(
              `[MobEntity] BONES NOT MOVING: ${this.config.mobType}\n` +
                `  Start: [${this.initialBonePosition.toArray().map((v) => v.toFixed(4))}]\n` +
                `  Now: [${hipsBone.position.toArray().map((v) => v.toFixed(4))}]\n` +
                `  Distance: ${distance.toFixed(6)} (need > 0.001)\n` +
                `  Mixer time: ${glbMixer?.time.toFixed(2) ?? "N/A"}s\n` +
                `  Animation runs but doesn't affect bones!`,
            );
          }
        }
      }
    }
  };

  // getDistance2D, getSpawnDistanceTiles are delegated to MobMovementManager

  /**
   * Get the mob's current spawn point (public accessor for movement capping)
   * Used by MobTileMovementManager to enforce OSRS-accurate leash range
   */
  getSpawnPoint(): Position3D {
    return this.movementManager.getCurrentSpawnPoint();
  }

  /**
   * Get the mob's leash range (max tiles from spawn during chase)
   * OSRS-accurate default: 7 tiles max range from spawn
   * @see https://oldschool.runescape.wiki/w/Aggressiveness
   */
  getLeashRange(): number {
    return this.movementManager.getLeashRange();
  }

  /**
   * Update this mob's tile occupancy after movement (public delegate)
   * Called by MobTileMovementManager after successful movement.
   */
  public updateOccupancy(): void {
    this.movementManager.updateOccupancy();
  }

  takeDamage(damage: number, attackerId?: string): boolean {
    // Already dead - ignore damage
    if (this.deathManager.isCurrentlyDead()) {
      return false;
    }

    // Enter combat (prevents safety teleport while fighting)
    this.combatManager.enterCombat(attackerId);

    // Apply damage
    this.config.currentHealth = Math.max(0, this.config.currentHealth - damage);

    // Sync all health fields (single source of truth)
    this.setHealth(this.config.currentHealth);
    this.setProperty("health", {
      current: this.config.currentHealth,
      max: this.config.maxHealth,
    });

    // Update health bar visual (setHealth already does this, but ensure it's called)
    this.updateHealthBar();

    // Update userData for mesh
    if (this.mesh?.userData) {
      const userData = this.mesh.userData as MeshUserData;
      if (userData.mobData) {
        userData.mobData.health = this.config.currentHealth;
      }
    }

    // COMBAT_DAMAGE_DEALT is emitted by CombatSystem - no need to emit here
    // to avoid duplicate damage splats

    // Check if mob died
    if (this.config.currentHealth <= 0) {
      this.die();
      return true; // Mob died
    } else {
      // Become aggressive towards attacker (use AggroManager for target management)
      // BUT only if mob retaliates - peaceful mobs (retaliates: false) don't fight back
      if (attackerId && !this.config.targetPlayerId && this.config.retaliates) {
        this.config.targetPlayerId = attackerId;
        this.aggroManager.setTargetIfNone(attackerId);
        this.aiStateMachine.forceState(
          MobAIState.CHASE,
          this.createAIContext(),
        );
      }
    }

    this.markNetworkDirty();
    return false; // Mob survived
  }

  die(): void {
    // Unregister tile occupancy (dead NPCs don't block tiles)
    this.movementManager.unregisterOccupancy();

    // Use Date.now() for consistent millisecond timing (world.getTime() has inconsistent units)
    const currentTime = Date.now();
    const deathPosition = this.getPosition();

    // Delegate death logic to DeathStateManager (position locking, death animation timing)
    this.deathManager.die(deathPosition, currentTime);

    // Start respawn timer with RespawnManager (TICK-BASED - generates NEW random spawn point - NOT death location!)
    // Uses server tick for OSRS-accurate timing
    this.respawnManager.startRespawnTimer(
      this.world.currentTick,
      deathPosition,
    );

    // Update config state for network sync
    this.config.aiState = MobAIState.DEAD;
    this.config.deathTime = currentTime;
    this.config.targetPlayerId = null;
    this.config.currentHealth = 0;

    // Clear aggro target
    this.aggroManager.clearTarget();

    // Update base health property for isDead() check
    this.setHealth(0);

    // CRITICAL FIX FOR ISSUE #269: Don't end combat immediately when mob dies
    // Let combat timeout naturally after 4.8 seconds (8 ticks) to keep health bars visible
    // This matches RuneScape behavior where combat state persists briefly after death
    // CombatSystem.handleEntityDied() already removes the dead mob's combat state
    // The attacker's combat will timeout naturally via the 4.8 second timer
    //
    // NOTE: Issue #275 fix (not resetting target's emote) is still preserved because
    // we're not calling endCombat() at all - the emote will finish naturally

    // Play death animation via server emote broadcast
    this.setServerEmote(Emotes.DEATH);

    // Mark for network update to sync death state to clients
    this.markNetworkDirty();

    // Emit death event with last attacker
    const lastAttackerId = this.combatManager.getLastAttackerId();
    if (lastAttackerId) {
      // Generate kill token for anti-spoof validation
      const timestamp = Date.now();
      const killToken = generateKillToken(this.id, lastAttackerId, timestamp);

      this.world.emit(EventType.NPC_DIED, {
        mobId: this.id,
        mobType: this.config.mobType,
        level: this.config.level,
        killedBy: lastAttackerId,
        position: this.getPosition(),
        timestamp,
        killToken,
      });

      // Emit COMBAT_KILL event for SkillsSystem to grant combat XP
      // Determine attack style based on weapon type (ranged/magic override melee styles)
      const equipmentSystem = this.world.getSystem("equipment") as {
        getPlayerEquipment?: (playerId: string) => {
          weapon?: { item?: { weaponType?: string; attackType?: string } };
        } | null;
      } | null;
      const playerSystem = this.world.getSystem("player") as {
        getPlayerAttackStyle?: (playerId: string) => { id: string } | null;
      } | null;

      // Check equipped weapon type to determine if using ranged/magic
      const equipment = equipmentSystem?.getPlayerEquipment?.(lastAttackerId);
      const weapon = equipment?.weapon?.item;
      let attackStyle = "aggressive"; // Default

      // Check if player has a spell selected (needed for magic detection)
      const playerEntity = this.world.getPlayer?.(lastAttackerId);
      const selectedSpell = (playerEntity?.data as { selectedSpell?: string })
        ?.selectedSpell;

      if (weapon) {
        // Check attackType first (preferred), then weaponType (legacy)
        // Values may be uppercase (from JSON) or lowercase (from enum)
        const attackType = weapon.attackType?.toLowerCase();
        const weaponType = weapon.weaponType?.toLowerCase();

        if (
          attackType === "ranged" ||
          weaponType === "bow" ||
          weaponType === "crossbow"
        ) {
          // Ranged weapon - use "ranged" style for Ranged XP
          attackStyle = "ranged";
        } else if (
          (attackType === "magic" ||
            weaponType === "staff" ||
            weaponType === "wand") &&
          selectedSpell
        ) {
          // Magic weapon WITH active spell - use "magic" style for Magic XP
          // OSRS-accurate: staffs used for melee (no spell) grant melee XP
          attackStyle = "magic";
        } else {
          // Melee attack (or staff/wand without a spell) - use player's selected attack style
          // but only if it's a valid melee style; non-melee styles (longrange, autocast, rapid)
          // would grant wrong XP type
          const attackStyleData =
            playerSystem?.getPlayerAttackStyle?.(lastAttackerId);
          const playerStyle = attackStyleData?.id;
          attackStyle =
            playerStyle && MELEE_STYLES.has(playerStyle)
              ? playerStyle
              : "aggressive";
        }
      } else {
        // No weapon (unarmed) - check if player has a spell selected
        // OSRS-accurate: You can cast spells without a staff
        if (selectedSpell) {
          // Player has a spell selected - use "magic" for Magic XP
          attackStyle = "magic";
        } else {
          // No spell, no weapon - use player's melee attack style
          const attackStyleData =
            playerSystem?.getPlayerAttackStyle?.(lastAttackerId);
          const playerStyle = attackStyleData?.id;
          attackStyle =
            playerStyle && MELEE_STYLES.has(playerStyle)
              ? playerStyle
              : "aggressive";
        }
      }

      this.world.emit(EventType.COMBAT_KILL, {
        attackerId: lastAttackerId,
        targetId: this.id,
        damageDealt: this.config.maxHealth,
        attackStyle: attackStyle,
      });

      // NOTE: Loot is handled by LootSystem via NPC_DIED event (emitted above)
      // Do NOT call dropLoot() here - it would cause duplicate drops
    } else {
      console.warn(`[MobEntity] ${this.id} died but no lastAttackerId found`);
    }
  }

  // generatePatrolPoints, moveTowardsTarget are delegated to MobMovementManager

  /**
   * Find nearby player within aggro range (RuneScape-style)
   * Delegates to AggroManager component
   *
   * IMPORTANT: Only scans for players if mob is aggressive.
   * Non-aggressive mobs won't attack on sight.
   * Retaliation when attacked is controlled by the separate `retaliates` flag.
   */
  private findNearbyPlayer(): { id: string; position: Position3D } | null {
    // Non-aggressive mobs don't scan for players
    if (!this.config.aggressive) {
      return null;
    }

    const currentPos = this.getPosition();

    // Use spatial player index for O(k) lookup instead of O(P) iteration
    // AggroSystem maintains a playersByRegion index using 21x21 tile regions
    // This queries a 3x3 grid of regions (63x63 tiles) which covers any aggro range
    const aggroSystem = this.world.getSystem("aggro") as
      | AggroSystem
      | undefined;
    const players = aggroSystem
      ? aggroSystem.getPlayersInNearbyRegions(currentPos)
      : this.world.getPlayers(); // Fallback if AggroSystem not available

    // OSRS-Accurate Aggression Range:
    // The aggression range origin is the static spawn point of the NPC.
    // Aggression range = max range (leash) + attack range (combat range)
    // Players must be within this distance of SPAWN to be attacked.
    // @see https://oldschool.runescape.wiki/w/Aggressiveness
    const leashRange =
      this.config.leashRange ?? COMBAT_CONSTANTS.DEFAULTS.NPC.LEASH_RANGE;
    const attackRange = Math.max(1, this.config.combatRange);
    const aggressionRange = leashRange + attackRange;

    return this.aggroManager.findNearbyPlayer(
      currentPos,
      players,
      this.movementManager.getCurrentSpawnPoint(), // Spawn point for OSRS-accurate aggression check
      aggressionRange, // Max attack distance from spawn
    );
  }

  /**
   * Get player by ID (delegates to AggroManager)
   */
  private getPlayer(
    playerId: string,
  ): { id: string; position: Position3D } | null {
    return this.aggroManager.getPlayer(playerId, (id) =>
      this.world.getPlayer(id),
    );
  }

  /**
   * Clear current target and exit combat (called when target dies or becomes invalid)
   * RuneScape-style: Mob immediately disengages and returns to spawn area
   */
  private clearTargetAndExitCombat(): void {
    // Clear target
    this.config.targetPlayerId = null;
    this.aggroManager.clearTarget();

    // Exit combat state
    this.combatManager.exitCombat();

    // Force AI state based on movement type
    const context = this.createAIContext();
    if (this.config.movementType === "stationary") {
      // Stationary mobs go directly to IDLE
      this.aiStateMachine.forceState(MobAIState.IDLE, context);
    } else {
      // Wandering mobs go to RETURN to walk back to spawn area
      this.aiStateMachine.forceState(MobAIState.RETURN, context);
    }
  }

  /**
   * Called by CombatSystem when this mob's current target dies
   * Resets combat state so mob can immediately attack new targets (e.g., respawned player)
   * @param targetId - ID of the target that died (for validation)
   */
  onTargetDied(targetId: string): void {
    // Only reset if this was actually our target
    if (this.config.targetPlayerId === targetId) {
      this.clearTargetAndExitCombat();
    }
  }

  // Map internal AI states to interface expected states (RuneScape-style)
  private mapAIStateToInterface(
    internalState: string,
  ): "idle" | "wander" | "chase" | "attack" | "return" | "dead" {
    // Direct mapping - internal states match interface states
    return (
      (internalState as
        | "idle"
        | "wander"
        | "chase"
        | "attack"
        | "return"
        | "dead") || "idle"
    );
  }

  // Get mob data for systems
  getMobData(): MobEntityData {
    return {
      id: this.id,
      name: this.config.name,
      type: this.config.mobType,
      level: this.config.level,
      health: this.config.currentHealth,
      maxHealth: this.config.maxHealth,
      attack: this.config.attack,
      attackPower: this.config.attackPower,
      defense: this.config.defense,
      defenseBonus: this.config.defenseBonus ?? 0,
      attackSpeedTicks: this.config.attackSpeedTicks,
      xpReward: this.config.xpReward,
      aiState: this.mapAIStateToInterface(this.config.aiState),
      targetPlayerId: this.config.targetPlayerId || null,
      spawnPoint: this.config.spawnPoint,
      position: this.getPosition(),
    };
  }

  /**
   * Check if this mob can be attacked by players
   * Controlled by combat.attackable in the manifest
   */
  isAttackable(): boolean {
    return this.config.attackable;
  }

  /**
   * Get this mob's combat range in tiles
   * Controlled by combat.combatRange in the manifest (meters, 1 tile = 1 meter)
   * @returns Combat range in tiles (minimum 1)
   */
  getCombatRange(): number {
    return Math.max(1, Math.floor(this.config.combatRange));
  }

  // Override serialize to include model path for client
  override serialize(): EntityData {
    const baseData = super.serialize();
    return {
      ...baseData,
      model: this.config.model, // CRITICAL: Include model path for client VRM loading
      mobType: this.config.mobType,
      level: this.config.level,
      currentHealth: this.config.currentHealth,
      maxHealth: this.config.maxHealth,
      aiState: this.config.aiState,
      targetPlayerId: this.config.targetPlayerId,
      scale: [
        this.config.scale.x,
        this.config.scale.y,
        this.config.scale.z,
      ] as [number, number, number], // CRITICAL: Include scale for client model sizing
    };
  }

  // Network data override
  getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();

    // Handle death state separately
    if (this.deathManager.isCurrentlyDead()) {
      // Remove ALL position data from baseData
      delete baseData.x;
      delete baseData.y;
      delete baseData.z;
      delete baseData.p;
      delete baseData.position;

      const networkData: Record<string, unknown> = {
        ...baseData,
        model: this.config.model,
        mobType: this.config.mobType,
        level: this.config.level,
        currentHealth: this.config.currentHealth,
        maxHealth: this.config.maxHealth,
        aiState: this.config.aiState,
        targetPlayerId: this.config.targetPlayerId,
        deathTime: this.deathManager.getDeathTime(),
        scale: this.config.scale, // Include scale for client
      };

      // Send death emote once
      if (this._serverEmote) {
        networkData.e = this._serverEmote;
        this._serverEmote = null;
      }

      // ALWAYS send death position when dead (handles packet loss, late-joining clients)
      // Previously only sent once, but clients would miss it and use wrong position
      const deathPos = this.deathManager.getDeathPosition();
      if (deathPos) {
        networkData.p = [deathPos.x, deathPos.y, deathPos.z];
        this.deathManager.markDeathStateSent();
      }

      return networkData;
    }

    // Normal path for living mobs
    // Query CombatSystem for combat state (like players send 'c')
    const combatSystem = this.world.getSystem("combat") as {
      isInCombat?: (entityId: string) => boolean;
    } | null;
    const inCombat = combatSystem?.isInCombat?.(this.id) ?? false;

    const networkData: Record<string, unknown> = {
      ...baseData,
      model: this.config.model,
      mobType: this.config.mobType,
      level: this.config.level,
      currentHealth: this.config.currentHealth,
      maxHealth: this.config.maxHealth,
      aiState: this.config.aiState,
      targetPlayerId: this.config.targetPlayerId,
      c: inCombat, // Combat state for health bar visibility (like players)
      scale: this.config.scale, // Include scale for client model sizing
    };

    // CRITICAL: Force position to be included if not present
    // Parent class may omit position to save bandwidth, but we always need it for mobs
    if (!networkData.p || !Array.isArray(networkData.p)) {
      const pos = this.getPosition();
      networkData.p = [pos.x, pos.y, pos.z];
    }

    // Only broadcast server-forced emotes
    if (this._serverEmote) {
      networkData.e = this._serverEmote;
      this._serverEmote = null;
    }

    // Clear respawn flag after first network sync
    if (this._justRespawned) {
      this._justRespawned = false;
    }

    return networkData;
  }

  /**
   * Set a one-shot emote from server (e.g., combat animation)
   * This will be broadcast once, then cleared automatically
   */
  setServerEmote(emote: string): void {
    this._serverEmote = emote;
    this.markNetworkDirty();
  }

  /**
   * Override modify to handle network updates from server
   */
  override modify(data: Partial<EntityData>): void {
    // Handle AI state changes
    if ("aiState" in data) {
      const newState = data.aiState as MobAIState;

      // If entering DEAD state on client, lock position to CURRENT VISUAL position
      if (
        newState === MobAIState.DEAD &&
        !this.deathManager.isCurrentlyDead()
      ) {
        // CRITICAL: Clear the death timer so clientUpdate() can set a fresh timestamp
        // Without this, stale timestamps from previous deaths cause immediate reset
        this.clientDeathStartTime = null;

        // CRITICAL: Use current VISUAL position (this.position), NOT server position (data.p)
        // TileInterpolator may be mid-interpolation, showing the mob at a different location
        // than the server's authoritative position. The mob should die WHERE THE PLAYER SEES IT,
        // not teleport to the server position. This matches RS3's smooth movement philosophy.
        const visualDeathPos = new THREE.Vector3(
          this.position.x,
          this.position.y,
          this.position.z,
        );
        this.deathManager.applyDeathPositionFromServer(visualDeathPos);

        // Clear TileInterpolator control flag so it stops updating this entity
        this.data.tileInterpolatorControlled = false;

        // Position VRM scene at current visual position for death animation
        const deathAvatar = this.visualManager.getAvatarInstance();
        if (deathAvatar) {
          this.node.updateMatrix();
          this.node.updateMatrixWorld(true);
          deathAvatar.move(this.node.matrixWorld);
        }
      }

      // CRITICAL: ALWAYS check if death manager should be reset (not just on state change!)
      // Server might send multiple updates with same state (aiState=idle, idle, idle...)
      // We need to reset death manager on ANY update where server says NOT DEAD
      // BUT: Don't reset until death animation is complete (4.5 seconds)
      const deathManagerDead = this.deathManager.isCurrentlyDead();

      if (newState !== MobAIState.DEAD && deathManagerDead) {
        // CRITICAL: If clientDeathStartTime is null, death just happened but
        // clientUpdate() hasn't run yet to set the timestamp. DON'T reset in this case!
        if (this.clientDeathStartTime) {
          const timeSinceDeath = Date.now() - this.clientDeathStartTime;
          const deathAnimationDurationMs =
            this.DEATH_ANIMATION_TICKS * TICK_DURATION_MS;

          if (timeSinceDeath >= deathAnimationDurationMs) {
            // Death animation is complete, safe to reset
            this.clientDeathStartTime = null;
            this.deathManager.reset();
            // Reset death terrain snap flag for next death (Issue #244)
            this._deathPositionTerrainSnapped = false;

            // CRITICAL: Clear stale 'death' emote — without this,
            // onEntityModified thinks mob is still dead on subsequent packets
            // (it checks entity.data.e for 'death' in isDeadMob calculation)
            // (also cleared in ClientNetwork.onEntityModified respawn path as defense in depth)
            (this.data as Record<string, unknown>).e = undefined;
            (this.data as Record<string, unknown>).emote = undefined;

            // CRITICAL: Snap position immediately to server's new spawn point
            // This prevents interpolation from starting at death location
            if ("p" in data && Array.isArray(data.p) && data.p.length === 3) {
              const spawnPos = data.p as [number, number, number];
              this.position.set(spawnPos[0], spawnPos[1], spawnPos[2]);
              this.node.position.set(spawnPos[0], spawnPos[1], spawnPos[2]);
            }

            // Reset health to full on respawn (server will send correct value)
            this.config.currentHealth = this.config.maxHealth;
            this.healthBarManager.setLastKnownHealth(this.config.maxHealth);

            // Reset health bar visibility timeout so bar stays hidden until combat
            this.healthBarManager.resetVisibilityTimeout();

            // Mark that we need to restore visibility AFTER position update
            this._pendingRespawnRestore = true;
          }
        }
      }

      this.config.aiState = newState;
    }

    // Handle combat state for health bar visibility (like players)
    // Show health bar when in combat (including 0 damage hits), hide after timeout
    if ("c" in data) {
      const inCombat = data.c as boolean;
      if (inCombat) {
        this.healthBarManager.showForCombat();
      }
      // Note: Hiding is handled by clientUpdate() via healthBarManager.updateVisibilityTimeout()
    }

    // Update health from server
    if ("currentHealth" in data) {
      const newHealth = data.currentHealth as number;
      this.healthBarManager.setLastKnownHealth(newHealth);
      this.config.currentHealth = newHealth;
      this.setHealth(newHealth);
    }

    // Update max health from server
    if ("maxHealth" in data) {
      const newMaxHealth = data.maxHealth as number;
      this.config.maxHealth = newMaxHealth;
      this.maxHealth = newMaxHealth;
      // Update entity data for consistency
      (this.data as { maxHealth?: number }).maxHealth = newMaxHealth;
      // Refresh health bar to show updated max health
      this.updateHealthBar();
    }

    // Update target from server
    if ("targetPlayerId" in data) {
      this.config.targetPlayerId = data.targetPlayerId as string | null;
    }

    // Update death time from server
    if ("deathTime" in data) {
      this.config.deathTime = data.deathTime as number | null;
      this.deathManager.setDeathTime(data.deathTime as number | null);
    }

    // Handle emote from server (like PlayerRemote does)
    if ("e" in data && data.e !== undefined) {
      const serverEmote = data.e as string;

      // If avatar not loaded yet, store as pending - will be applied when VRM loads
      if (!this.visualManager.getAvatarInstance()) {
        this.visualManager.setPendingServerEmote(serverEmote);
      } else {
        // Avatar ready - apply emote immediately
        this.visualManager.applyServerEmote(serverEmote);
      }
    }

    // Handle position for living mobs (non-death, non-respawn cases)
    if (!this.deathManager.shouldLockPosition()) {
      // Check if TileInterpolator is controlling position - if so, skip position updates
      // TileInterpolator handles position smoothly for tile-based movement
      // This prevents entityModified packets from overriding smooth interpolation
      const tileControlled = this.data.tileInterpolatorControlled === true;
      if (!tileControlled) {
        // Not dead and not tile-controlled - apply position updates from server
        if ("p" in data && Array.isArray(data.p) && data.p.length === 3) {
          const pos = data.p as [number, number, number];
          this.position.set(pos[0], pos[1], pos[2]);
          this.node.position.set(pos[0], pos[1], pos[2]);
          // Mark that we've received authoritative server position (Issue #416 fix)
          // This ensures all clients have consistent XZ before terrain snapping Y
          this._hasReceivedServerPosition = true;
        }
      }
    } else {
      // Dead - enforce locked position (defense in depth)
      const lockedPos = this.deathManager.getLockedPosition();
      if (lockedPos) {
        this.node.position.copy(lockedPos);
        this.position.copy(lockedPos);
      }
    }

    // Call parent modify for standard properties (non-transform data like entity data)
    // Strip position from data since we handled it above
    const dataWithoutPosition = { ...data };
    delete dataWithoutPosition.p;
    delete dataWithoutPosition.x;
    delete dataWithoutPosition.y;
    delete dataWithoutPosition.z;
    delete dataWithoutPosition.position;
    super.modify(dataWithoutPosition);

    // CRITICAL: Restore visibility AFTER position has been updated from server
    // This ensures VRM is moved to the correct spawn location, not death location
    if (this._pendingRespawnRestore) {
      this._pendingRespawnRestore = false;

      // CRITICAL: Update client's _currentSpawnPoint to match new position from server
      // This ensures client and server are in sync (defense in depth)
      this.movementManager.setCurrentSpawnPoint({
        x: this.node.position.x,
        y: this.node.position.y,
        z: this.node.position.z,
      });

      // Restore node visibility
      if (this.node && !this.node.visible) {
        this.node.visible = true;
      }

      // Restore mesh visibility
      if (this.mesh && !this.mesh.visible) {
        this.mesh.visible = true;
      }

      // Recreate health bar (was destroyed on death to free atlas slot)
      this.healthBarManager.recreateOnRespawn();

      // Reset VRM animation and move to UPDATED position (from server)
      const respawnAvatar = this.visualManager.getAvatarInstance();
      if (respawnAvatar) {
        this.visualManager.setCurrentEmote(Emotes.IDLE);
        respawnAvatar.setEmote(Emotes.IDLE);
        this.visualManager.setManualEmoteOverrideUntil(0);

        // Position has been updated above in the position handling section
        // So this.node.position is the NEW spawn point from server, not death location
        this.node.updateMatrix();
        this.node.updateMatrixWorld(true);
        respawnAvatar.move(this.node.matrixWorld);
      }
    }
  }

  /**
   * Override destroy to clean up animations, health bar, and placeholder
   */
  override destroy(): void {
    // Unregister entity from hot updates
    this.world.setHot(this, false);

    // Clean up visual resources (VRM, raycast proxy, GLB mixer)
    this.visualManager.destroy();

    // Clean up health bar handle (HealthBars system)
    this.healthBarManager.destroy();

    // Parent will handle mesh removal (mesh is child of node)
    super.destroy();
  }
}
