/**
 * PlayerLocal - Local Player Entity (Coordinator)
 *
 * This class represents the player controlled by the current client. It coordinates
 * between four extracted controllers:
 * - **PlayerInputHandler**: Touch controls, control binding, camera target
 * - **PlayerCharacterController**: PhysX capsule, position validation, teleport, flying
 * - **PlayerCameraController**: Camera state, follow events, zoom
 * - **PlayerAvatarController**: VRM loading, emotes, bone transforms, aura
 *
 * PlayerLocal itself remains the coordinator that:
 * - Owns all player data/stats (health, skills, equipment, combat)
 * - Handles the init/update/destroy lifecycle
 * - Processes modify() for server-authoritative state changes
 * - Routes events (health, teleport, death, respawn, combat facing)
 * - Manages stamina, run mode, and UI elements
 *
 * **Runs on**: Client only (browser)
 * **Referenced by**: PlayerSystem, ClientInput, ClientGraphics
 *
 * @public
 */

import { createNode } from "../../extras/three/createNode";
import * as THREE from "../../extras/three/three";
import { UI, UIText, UIView } from "../../nodes";
import type {
  HealthBars as HealthBarsSystem,
  HealthBarHandle,
} from "../../systems/client/HealthBars";
import type {
  Player,
  PlayerCombatData,
  PlayerDeathData,
  PlayerEquipmentItems,
  PlayerHealth,
  Skills,
} from "../../types/core/core";
import { EventType } from "../../types/events";
import { NetworkData, EntityData } from "../../types/index";
import type {
  ActorHandle,
  PlayerStickState,
  PlayerTouch,
  PxCapsuleGeometry,
  PxMaterial,
  PxRigidDynamic,
  PxShape,
  PxSphereGeometry,
} from "../../types/systems/physics";
import type { HotReloadable } from "../../types";

import type { World } from "../../core/World";
import { Entity } from "../Entity";
import { COMBAT_CONSTANTS } from "../../constants/CombatConstants";
import { ticksToMs } from "../../utils/game/CombatCalculations";

// Controllers
import { PlayerInputHandler } from "./PlayerInputHandler";
import { PlayerCharacterController } from "./PlayerCharacterController";
import { PlayerCameraController } from "./PlayerCameraController";
import { PlayerAvatarController } from "./PlayerAvatarController";
import type { ControlBinding } from "../../types/index";

const UP = new THREE.Vector3(0, 1, 0);

interface NodeWithInstance extends THREE.Object3D {
  instance?: THREE.Object3D;
  activate?: (...args: unknown[]) => void;
}

interface PlayerLocalWithDying {
  isDying?: boolean;
  data: EntityData & { isDying?: boolean };
  movementTarget?: unknown;
  path?: unknown;
  destination?: unknown;
}

// Pre-allocated temps for update/lateUpdate to avoid per-frame allocations
const _combatQuat = new THREE.Quaternion();
const _combatAxis = new THREE.Vector3(0, 1, 0);
const _healthBarMatrix = new THREE.Matrix4();

// Pre-allocated temp for handleTeleport
const _teleportVec = new THREE.Vector3();

const DEFAULT_CAM_HEIGHT = 1.2;
const DEG2RAD = Math.PI / 180;

export class PlayerLocal extends Entity implements HotReloadable {
  // RS3-style run energy
  public stamina: number = 100;
  private readonly staminaDrainPerSecond: number = 2;
  private readonly staminaRegenWhileWalkingPerSecond: number = 2;
  private readonly staminaRegenPerSecond: number = 4;
  private autoRunSwitchSent: boolean = false;
  public totalWeight: number = 0;
  private readonly weightDrainModifier: number = 0.005;
  private readonly agilityRegenModifier: number = 0.01;

  hotReload?(): void {
    // Implementation for hot reload functionality
  }

  // Player interface implementation
  hyperscapePlayerId: string = "";
  alive: boolean = true;
  private _playerHealth: PlayerHealth = { current: 100, max: 100 };
  skills: Skills = {
    attack: { level: 1, xp: 0 },
    strength: { level: 1, xp: 0 },
    defense: { level: 1, xp: 0 },
    constitution: { level: 1, xp: 0 },
    ranged: { level: 1, xp: 0 },
    magic: { level: 1, xp: 0 },
    prayer: { level: 1, xp: 0 },
    woodcutting: { level: 1, xp: 0 },
    mining: { level: 1, xp: 0 },
    fishing: { level: 1, xp: 0 },
    firemaking: { level: 1, xp: 0 },
    cooking: { level: 1, xp: 0 },
    smithing: { level: 1, xp: 0 },
    agility: { level: 1, xp: 0 },
    crafting: { level: 1, xp: 0 },
    fletching: { level: 1, xp: 0 },
    runecrafting: { level: 1, xp: 0 },
  };
  equipment: PlayerEquipmentItems = {
    weapon: null,
    shield: null,
    helmet: null,
    body: null,
    legs: null,
    boots: null,
    gloves: null,
    cape: null,
    amulet: null,
    ring: null,
    arrows: null,
  };
  inventory?: { items?: unknown[] } = { items: [] };
  coins: number = 0;
  combat: PlayerCombatData = {
    combatLevel: 1,
    trainingSkill: "attack",
    inCombat: false,
    combatTarget: null,
    autoRetaliate: true,
  };
  private _lastCombatRotation: THREE.Quaternion | null = null;
  private _serverFaceTargetId: string | null = null;
  stats?: {
    attack: number;
    strength: number;
    defense: number;
    constitution: number;
  };
  death: PlayerDeathData = {
    respawnTime: 0,
    deathLocation: { x: 0, y: 0, z: 0 },
  };
  lastAction: string | null = null;
  lastSaveTime: number = Date.now();
  sessionId: string | null = null;

  // Player state
  isPlayer: boolean;
  isLocal: boolean = true;
  mass: number = 1;
  gravity: number = 20;
  effectiveGravity: number = 20;
  jumpHeight: number = 1.5;
  capsuleRadius: number = 0.3;
  capsuleHeight: number = 1.6;
  grounded: boolean = false;
  groundAngle: number = 0;
  groundNormal: THREE.Vector3 = new THREE.Vector3().copy(UP);
  groundSweepRadius: number = 0.29;
  groundSweepGeometry: PxSphereGeometry | PxCapsuleGeometry | PxShape | null =
    null;
  pushForce: THREE.Vector3 | null = null;
  pushForceInit: boolean = false;
  slipping: boolean = false;
  jumped: boolean = false;
  jumping: boolean = false;
  justLeftGround: boolean = false;
  fallTimer: number = 0;
  falling: boolean = false;
  moveDir: THREE.Vector3 = new THREE.Vector3();
  moving: boolean = false;
  lastJumpAt: number = 0;
  flying: boolean = false;
  flyForce: number = 100;
  flyDrag: number = 300;
  flyDir: THREE.Vector3 = new THREE.Vector3();
  platform: {
    actor: Record<string, unknown> | null;
    prevTransform: THREE.Matrix4;
  } = {
    actor: null,
    prevTransform: new THREE.Matrix4(),
  };
  speaking: boolean = false;
  lastSendAt: number = 0;
  base: THREE.Group | undefined = undefined;
  aura: THREE.Group | null = null;
  private _healthBarHandle: HealthBarHandle | null = null;
  private _healthBarVisibleUntil: number = 0;
  bubble: UI | null = null;
  bubbleBox: UIView | null = null;
  bubbleText: UIText | null = null;
  camHeight: number = DEFAULT_CAM_HEIGHT;
  cam: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    rotation: THREE.Euler;
    zoom: number;
  } = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    rotation: new THREE.Euler(0, 0, 0, "YXZ"),
    zoom: 1.5,
  };
  avatarUrl?: string;

  material: PxMaterial | null = null;
  capsule: PxRigidDynamic | null = null;
  capsuleHandle: ActorHandle | null = null;
  control: ControlBinding | undefined;
  stick?: PlayerStickState;
  pan?: PlayerTouch;
  capsuleDisabled?: boolean;
  materialMax?: boolean;
  airJumping?: boolean;
  airJumped?: boolean;
  fallStartY?: number;
  fallDistance?: number;
  onEffectEnd?: () => void;
  lastState: {
    p?: THREE.Vector3;
    q?: THREE.Quaternion;
    e?: string;
  } = {};
  private lastInterpolatedFrame: number = -1;
  emote?: string;
  effect?: string;
  running: boolean = false;
  rotSpeed: number = 5;
  clickMoveTarget: THREE.Vector3 | null = null;
  serverPosition: THREE.Vector3;
  lastServerUpdate: number = 0;
  public runMode: boolean = true;
  private clientPredictMovement: boolean = true;
  private pendingMoves: { seq: number; pos: THREE.Vector3 }[] = [];
  private _tempVec3 = new THREE.Vector3();

  // Controllers
  private _inputHandler: PlayerInputHandler;
  private _characterController: PlayerCharacterController;
  private _cameraController: PlayerCameraController;
  private _avatarController: PlayerAvatarController;

  constructor(
    world: World,
    data: NetworkData & {
      position?: [number, number, number];
      avatarUrl?: string;
    },
    local?: boolean,
  ) {
    super(world, { ...data, type: "player" }, local);
    this.isPlayer = true;

    // Initialize Player interface properties
    const healthFromData = (data as { health?: number }).health;
    const maxHealthFromData = (data as { maxHealth?: number }).maxHealth;
    const currentHealth =
      Number.isFinite(healthFromData) &&
      healthFromData !== undefined &&
      healthFromData > 0
        ? healthFromData
        : Number.isFinite(this.health) && this.health > 0
          ? this.health
          : 10;
    const maxHealth =
      Number.isFinite(maxHealthFromData) &&
      maxHealthFromData !== undefined &&
      maxHealthFromData > 0
        ? maxHealthFromData
        : Number.isFinite(this.maxHealth) && this.maxHealth > 0
          ? this.maxHealth
          : 10;
    this._playerHealth = {
      current: currentHealth,
      max: maxHealth,
    };
    this.hyperscapePlayerId = data.id || "";

    // Apply auto-retaliate setting from server if provided
    const autoRetaliateFromData = (data as { autoRetaliate?: boolean })
      .autoRetaliate;
    if (typeof autoRetaliateFromData === "boolean") {
      this.combat.autoRetaliate = autoRetaliateFromData;
    }

    // Initialize emote to idle if not provided
    if (!this.emote && !data.e) {
      this.emote = "idle";
      this.data.emote = "idle";
    }

    // CRITICAL: Initialize server position BEFORE anything else
    if (
      data.position &&
      Array.isArray(data.position) &&
      data.position.length === 3
    ) {
      this.serverPosition = new THREE.Vector3(
        data.position[0],
        data.position[1],
        data.position[2],
      );
      this.position.set(data.position[0], data.position[1], data.position[2]);
      this.node.position.set(
        data.position[0],
        data.position[1],
        data.position[2],
      );

      if (data.position[1] < -5) {
        throw new Error(
          `[PlayerLocal] FATAL: Spawning below terrain at Y=${data.position[1]}! Server sent invalid spawn position.`,
        );
      }
      if (data.position[1] > 200) {
        throw new Error(
          `[PlayerLocal] FATAL: Spawning too high at Y=${data.position[1]}! Server sent invalid spawn position.`,
        );
      }

      if (data.position[1] < 0 || data.position[1] > 100) {
        console.warn(
          `[PlayerLocal] WARNING: Starting with unusual Y position: ${data.position[1]}`,
        );
      }
    } else {
      throw new Error(
        "[PlayerLocal] FATAL: No server position provided in constructor! This will cause Y=0 spawn bug.",
      );
    }

    this.lastServerUpdate = performance.now();

    // Initialize controllers
    this._inputHandler = new PlayerInputHandler(this);
    this._characterController = new PlayerCharacterController(this);
    this._cameraController = new PlayerCameraController(this);
    this._avatarController = new PlayerAvatarController(this);

    // Start aggressive position validation via character controller
    this._characterController.startPositionValidation();
  }

  /**
   * Get Player interface representation for compatibility with systems that expect Player
   */
  getPlayerData(): Player {
    return {
      id: this.id,
      hyperscapePlayerId: this.hyperscapePlayerId,
      name: this.data.name || "Unknown Player",
      health: this._playerHealth,
      alive: this.alive,
      stamina: { current: this.stamina, max: 100 },
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      skills: this.skills,
      equipment: this.equipment,
      inventory: this.inventory,
      coins: this.coins,
      combat: this.combat,
      stats: this.stats,
      death: this.death,
      lastAction: this.lastAction,
      lastSaveTime: this.lastSaveTime,
      sessionId: this.sessionId,
      node: {
        position: this.position,
        quaternion: this.rotation,
      },
      data: {
        id: this.data.id as string,
        name: (this.data.name as string) || "Unknown Player",
        health: this.health,
        roles: this.data.roles as string[] | undefined,
        owner: this.data.owner as string | undefined,
        effect: this.data.effect,
      },
      avatar: this.avatar,
      setPosition: this.setPosition.bind(this),
    };
  }

  get playerData(): Player {
    return this.getPlayerData();
  }

  get avatar():
    | {
        getHeight?: () => number;
        getHeadToHeight?: () => number;
        setEmote?: (emote: string) => void;
        getBoneTransform?: (boneName: string) => THREE.Matrix4 | null;
      }
    | undefined {
    return this._avatarController.getAvatarInterface();
  }

  /** Expose avatar node for EquipmentVisualSystem (expects player._avatar?.instance) */
  get _avatar():
    | {
        instance: {
          raw: { scene: THREE.Object3D; userData?: Record<string, unknown> };
          destroy(): void;
          move(matrix: THREE.Matrix4): void;
          update(delta: number): void;
        } | null;
      }
    | undefined {
    return this._avatarController.avatarNode as
      | {
          instance: {
            raw: {
              scene: THREE.Object3D;
              userData?: Record<string, unknown>;
            };
            destroy(): void;
            move(matrix: THREE.Matrix4): void;
            update(delta: number): void;
          } | null;
        }
      | undefined;
  }

  /**
   * Override initializeVisuals to skip UIRenderer-based UI elements.
   * PlayerLocal uses HealthBars system for health bars.
   */
  protected initializeVisuals(): void {
    // Skip UIRenderer - we use HealthBars system
  }

  // Override modify to handle shorthand network keys like PlayerRemote does
  override modify(data: Partial<EntityData>): void {
    // Handle combat state updates
    if ("c" in data) {
      const newInCombat = data.c as boolean;
      this.combat.inCombat = newInCombat;
      if (this._healthBarHandle) {
        if (newInCombat) {
          this._healthBarHandle.show();
          this._healthBarVisibleUntil =
            Date.now() + ticksToMs(COMBAT_CONSTANTS.COMBAT_TIMEOUT_TICKS);
        } else {
          this._healthBarHandle.hide();
          this._healthBarVisibleUntil = 0;
        }
      }
    }
    if ("ct" in data) {
      this.combat.combatTarget = data.ct as string | null;
      // NOTE: Don't null _lastCombatRotation here — player should hold their
      // last combat facing direction when the target dies. Movement clears it.
    }

    if ("e" in data && data.e !== undefined) {
      const newEmote = data.e as string;

      const playerWithDying = this as PlayerLocalWithDying;
      const isDyingState =
        playerWithDying.isDying || playerWithDying.data.isDying;
      const shouldBlockEmote = isDyingState && newEmote !== "death";

      if (!shouldBlockEmote) {
        this.data.emote = newEmote;
        this.emote = newEmote;
        this._avatarController.applyEmote(newEmote);
      }
    }

    if ("p" in data && data.p !== undefined) {
      const pos = data.p as number[];
      if (pos.length === 3) {
        const playerWithDying = this as PlayerLocalWithDying;
        if (playerWithDying.isDying || playerWithDying.data.isDying) {
          // Ignore position updates during death
        } else if (
          this.data?.tileInterpolatorControlled === true &&
          !("t" in data)
        ) {
          this.serverPosition.set(pos[0], pos[1], pos[2]);
          this.lastServerUpdate = Date.now();
        } else {
          this.serverPosition.set(pos[0], pos[1], pos[2]);
          this.lastServerUpdate = Date.now();

          this.position.set(pos[0], pos[1], pos[2]);
          this.node.position.set(pos[0], pos[1], pos[2]);

          if (this.base) {
            this.base.position.set(0, 0, 0);
          }

          if (this.capsule) {
            const pose = this.capsule.getGlobalPose();
            if (pose?.p) {
              pose.p.x = pos[0];
              pose.p.y = pos[1];
              pose.p.z = pos[2];
              this.capsule.setGlobalPose(pose, true);
            }
          }

          this.node.updateMatrix();
          this.node.updateMatrixWorld(true);
        }
      }
    }

    if ("q" in data && data.q !== undefined) {
      if (this.data?.tileInterpolatorControlled === true) {
        // Ignore server quaternion - TileInterpolator handles rotation
      } else if (this.combat.combatTarget || this._serverFaceTargetId) {
        // Ignore server quaternion during combat - client slerps toward target locally.
        // Applying server q would fight with the smooth combat rotation in update(),
        // causing visible oscillation (server resets what slerp just interpolated).
      } else {
        const quat = data.q as number[];
        if (quat.length === 4 && this.base) {
          this.base.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        }
      }
    }

    if ("v" in data && data.v !== undefined) {
      const vel = data.v as number[];
      if (vel.length === 3) {
        const playerWithDying = this as PlayerLocalWithDying;
        if (!(playerWithDying.isDying || playerWithDying.data.isDying)) {
          this.velocity.set(vel[0], vel[1], vel[2]);
        }
      }
    }

    if ("health" in data && data.health !== undefined) {
      const newHealth = data.health as number;
      this.setHealth(newHealth);
      this._playerHealth.current = newHealth;
    }
    if ("maxHealth" in data && data.maxHealth !== undefined) {
      this.maxHealth = data.maxHealth as number;
      this.data.maxHealth = this.maxHealth;
      this._playerHealth.max = this.maxHealth;
    }

    super.modify(data);
  }

  async init(): Promise<void> {
    // Make sure we're added to the world's entities
    if (!this.world.entities.has(this.id)) {
      this.world.entities.items.set(this.id, this);
    }

    // Wait for terrain to be ready
    await this._characterController.waitForTerrain();

    // Register for physics updates
    this.world.setHot(this, true);

    // Initialize physics state via character controller
    this._characterController.initPhysicsState();

    this.speaking = false;
    this.lastSendAt = 0;

    // Create base group
    this.base = new THREE.Group();
    if (this.base) {
      this.base.name = "player-base";
    }
    if (!this.base) {
      throw new Error("Failed to create base node for PlayerLocal");
    }

    this.node.add(this.base);

    // Attach the camera rig to the player's base
    if (this.world.rig && this.base) {
      this.base.add(this.world.rig);
    }

    let spawnX = this.position.x;
    let spawnY = this.position.y;
    let spawnZ = this.position.z;

    if (spawnX === 0 && spawnY === 0 && spawnZ === 0) {
      spawnX = 0;
      spawnY = 10;
      spawnZ = 0;
      this.position.set(spawnX, spawnY, spawnZ);
    }

    if (this.base) {
      if (this.serverPosition) {
        this.position.copy(this.serverPosition);
      }
      this._characterController.validateTerrainPosition();
    }

    if ("visible" in this.base) {
      Object.defineProperty(this.base, "visible", {
        value: true,
        writable: true,
      });
    }
    this.active = true;

    // Create aura group
    this.aura = new THREE.Group();
    this.aura.name = "player-aura";
    if (!this.aura) {
      throw new Error("Failed to create aura node for PlayerLocal");
    }

    // Register with HealthBars system
    const healthbars = this.world.getSystem?.("healthbars") as
      | HealthBarsSystem
      | undefined;

    if (healthbars) {
      const currentHealth = (this.data.health as number) || 100;
      const maxHealth = (this.data.maxHealth as number) || 100;
      this._healthBarHandle = healthbars.add(this.id, currentHealth, maxHealth);
    }

    // Create bubble UI
    this.bubble = createNode("ui", {
      id: "bubble",
      width: 300,
      height: 512,
      pivot: "bottom-center",
      billboard: "full",
      scaler: [3, 30],
      justifyContent: "flex-end",
      alignItems: "center",
      active: false,
    }) as UI;
    if (!this.bubble) {
      throw new Error("Failed to create bubble node for PlayerLocal");
    }
    this.bubbleBox = createNode("uiview", {
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      borderRadius: 10,
      padding: 10,
    }) as UIView;
    if (!this.bubbleBox) {
      throw new Error("Failed to create bubbleBox node for PlayerLocal");
    }
    this.bubbleText = createNode("uitext", {
      color: "white",
      fontWeight: 100,
      lineHeight: 1.4,
      fontSize: 16,
    }) as UIText;
    if (!this.bubbleText) {
      throw new Error("Failed to create bubbleText node for PlayerLocal");
    }
    this.bubble.add(this.bubbleBox);
    this.bubbleBox.add(this.bubbleText);
    this.bubble.ctx = this.world;
    if (this.bubble.activate) {
      this.bubble.activate(this.world);
    }
    const bubbleInstance = (this.bubble as unknown as NodeWithInstance)
      .instance;
    if (bubbleInstance && bubbleInstance.isObject3D) {
      this.aura.add(bubbleInstance);
    }

    // Add aura to base
    if (this.base) {
      this.base.add(this.aura);
    }

    // Initialize camera state via camera controller
    this._cameraController.initCameraState();

    if (this.world.loader?.preloader) {
      await this.world.loader.preloader;
    }

    // Load avatar via avatar controller
    await this._avatarController.applyAvatar(this.bubble);

    // Emit camera follow events now that avatar is loaded
    this._cameraController.emitCameraFollowEvents(
      this._avatarController.avatarNode,
    );
    this._cameraController.emitAvatarLoadComplete(this.id);

    // Initialize physics capsule via character controller
    await this._characterController.initCapsule();

    // Initialize input via input handler
    this._inputHandler.initControl();

    // Initialize camera system via input handler
    this._inputHandler.initCameraSystem(
      this._avatarController.avatarNode,
      this.camHeight,
    );

    // Retry camera initialization after a delay
    setTimeout(() => {
      this._cameraController.retryCameraInit();
    }, 1000);

    this.world.setHot(this, true);

    // Register with systems
    this.world.emit(EventType.PLAYER_REGISTERED, { playerId: this.data.id });

    // Listen for system events
    this.world.on(
      EventType.PLAYER_HEALTH_UPDATED,
      this.handleHealthChange.bind(this),
    );
    this.world.on(
      EventType.PLAYER_TELEPORT_REQUEST,
      this.handleTeleport.bind(this),
    );
    this.world.on(EventType.PLAYER_SET_DEAD, (eventData) => {
      this.handlePlayerSetDead(
        eventData as {
          playerId: string;
          isDead: boolean;
          deathPosition?:
            | [number, number, number]
            | { x: number; y: number; z: number };
        },
      );
    });
    this.world.on(EventType.PLAYER_RESPAWNED, (eventData) => {
      this.handlePlayerRespawned(
        eventData as {
          playerId: string;
          spawnPosition?:
            | { x: number; y: number; z: number }
            | [number, number, number];
        },
      );
    });
    this.world.on(
      EventType.UI_AUTO_RETALIATE_CHANGED,
      this.handleAutoRetaliateChanged.bind(this),
    );
    this.world.on(
      EventType.COMBAT_FACE_TARGET,
      this.handleCombatFaceTarget.bind(this),
    );
    this.world.on(
      EventType.COMBAT_CLEAR_FACE_TARGET,
      this.handleCombatClearFaceTarget.bind(this),
    );

    // Signal to UI that the world is ready
    this.world.emit(EventType.READY);
  }

  getAvatarUrl(): string {
    return this._avatarController.getAvatarUrl();
  }

  async applyAvatar(): Promise<void> {
    await this._avatarController.applyAvatar(this.bubble);

    // Emit camera follow events after avatar reload
    this._cameraController.emitCameraFollowEvents(
      this._avatarController.avatarNode,
    );
    this._cameraController.emitAvatarLoadComplete(this.id);
  }

  // RuneScape-style run mode toggle
  public toggleRunMode(): void {
    this.runMode = !this.runMode;
    if (this.moving) {
      this.running = this.runMode;
    }
    this.world.emit(EventType.MOVEMENT_TOGGLE_RUN, {
      playerId: this.id,
      isRunning: this.runMode,
    });
  }

  // Delegate to character controller
  public updateServerPosition(x: number, y: number, z: number): void {
    this._characterController.updateServerPosition(x, y, z);
  }

  public updateServerVelocity(x: number, y: number, z: number): void {
    this._characterController.updateServerVelocity(x, y, z);
  }

  public setClickMoveTarget(
    target: { x: number; y: number; z: number } | null,
  ): void {
    const playerWithDying = this as PlayerLocalWithDying;
    const isDead =
      !!(playerWithDying.isDying || playerWithDying.data.isDying) ||
      this.health <= 0;
    this._characterController.setClickMoveTarget(target, isDead);
  }

  public override setPosition(
    posOrX: { x: number; y: number; z: number } | number,
    y?: number,
    z?: number,
  ): void {
    const newX =
      y !== undefined && z !== undefined
        ? (posOrX as number)
        : (posOrX as { x: number; y: number; z: number }).x;
    const newY =
      y !== undefined && z !== undefined
        ? y
        : (posOrX as { x: number; y: number; z: number }).y;
    const newZ =
      y !== undefined && z !== undefined
        ? z
        : (posOrX as { x: number; y: number; z: number }).z;

    super.setPosition(newX, newY, newZ);
    this._characterController.syncCapsulePosition(newX, newY, newZ);
  }

  toggleFlying() {
    this._characterController.toggleFlying();
  }

  getAnchorMatrix() {
    const effect = this.data.effect as { anchorId?: string } | undefined;
    if (effect?.anchorId) {
      return this.world.anchors.get(effect.anchorId);
    }
    return null;
  }

  private updateCallCount = 0;

  /** Check if a looked-up entity is dead (mob corpse, dying player, or zero health) */
  private isTargetDead(entity: { data?: EntityData } | undefined): boolean {
    if (!entity) return true;
    const d = entity.data;
    return (
      d?.aiState === "dead" ||
      (d as { isDying?: boolean } | undefined)?.isDying === true ||
      (d as { currentHealth?: number } | undefined)?.currentHealth === 0
    );
  }

  update(delta: number): void {
    this.updateCallCount++;

    // COMBAT ROTATION: Rotate to face target when in combat (RuneScape-style)
    let combatTarget: {
      position: { x: number; z: number };
      id: string;
    } | null = null;

    if (this.combat.combatTarget) {
      const targetEntity =
        this.world.entities.items.get(this.combat.combatTarget) ||
        this.world.entities.players?.get(this.combat.combatTarget);
      // Stop tracking dead targets — mob entity persists in world during death/respawn
      if (this.isTargetDead(targetEntity)) {
        this.combat.combatTarget = null;
        this._serverFaceTargetId = null;
      } else if (targetEntity?.position) {
        const dx = targetEntity.position.x - this.position.x;
        const dz = targetEntity.position.z - this.position.z;
        const distance2D = Math.sqrt(dx * dx + dz * dz);
        if (distance2D <= 20) {
          combatTarget = {
            position: targetEntity.position,
            id: targetEntity.id,
          };
        }
      }
    }

    if (!combatTarget && this._serverFaceTargetId) {
      const targetEntity =
        this.world.entities.items.get(this._serverFaceTargetId) ||
        this.world.entities.players?.get(this._serverFaceTargetId);
      if (this.isTargetDead(targetEntity)) {
        this._serverFaceTargetId = null;
      } else if (targetEntity?.position) {
        const dx = targetEntity.position.x - this.position.x;
        const dz = targetEntity.position.z - this.position.z;
        const distance2D = Math.sqrt(dx * dx + dz * dz);
        if (distance2D <= 20) {
          combatTarget = {
            position: targetEntity.position,
            id: targetEntity.id,
          };
        }
      }
    }

    const isMoving = this.data?.tileMovementActive === true;

    if (isMoving) {
      this._lastCombatRotation = null;
      this._serverFaceTargetId = null;
    }

    if (combatTarget && !isMoving) {
      const dx = combatTarget.position.x - this.position.x;
      const dz = combatTarget.position.z - this.position.z;
      let angle = Math.atan2(dx, dz);
      angle += Math.PI;

      if (this.base) {
        _combatQuat.setFromAxisAngle(_combatAxis, angle);

        if (!this._lastCombatRotation) {
          // First frame of combat: seed from current facing direction
          this._lastCombatRotation = this.base.quaternion.clone();
        }

        // Slerp on private tracked quaternion (immune to external quaternion resets)
        const combatRotAlpha =
          1 - Math.exp(-delta * COMBAT_CONSTANTS.ROTATION.COMBAT_SLERP_SPEED);
        this._lastCombatRotation.slerp(_combatQuat, combatRotAlpha);

        // Full overwrite — no other system can fight this
        this.base.quaternion.copy(this._lastCombatRotation);
      }
    } else if (
      !combatTarget &&
      !isMoving &&
      this._lastCombatRotation &&
      this.base
    ) {
      this.base.quaternion.copy(this._lastCombatRotation);
    }

    // Ensure matrices are up to date
    this.node.updateMatrix();
    this.node.updateMatrixWorld(true);

    if (this.base) {
      if (
        this.base.position.x !== 0 ||
        this.base.position.y !== 0 ||
        this.base.position.z !== 0
      ) {
        this.base.position.set(0, 0, 0);
      }
      this.base!.updateMatrix();
      this.base!.updateMatrixWorld(true);
    }

    // Update avatar via avatar controller
    if (this.base) {
      this._avatarController.updateAvatar(delta, this.base.matrixWorld);
    }

    // Stamina logic
    const dt = delta;
    const currentEmote = this.emote || "";
    if (currentEmote === "run") {
      const weightMultiplier = 1 + this.totalWeight * this.weightDrainModifier;
      const drainRate = this.staminaDrainPerSecond * weightMultiplier;
      this.stamina = THREE.MathUtils.clamp(
        this.stamina - drainRate * dt,
        0,
        100,
      );
      if (this.stamina <= 0 && !this.autoRunSwitchSent) {
        this.runMode = false;
        this.world.network.send("moveRequest", { runMode: false });
        this.autoRunSwitchSent = true;
      }
    } else if (currentEmote === "walk") {
      const agilityMultiplier =
        1 + this.skills.agility.level * this.agilityRegenModifier;
      const regenRate =
        this.staminaRegenWhileWalkingPerSecond * agilityMultiplier;
      this.stamina = THREE.MathUtils.clamp(
        this.stamina + regenRate * dt,
        0,
        100,
      );
      if (this.stamina > 1) {
        this.autoRunSwitchSent = false;
      }
    } else {
      const agilityMultiplier =
        1 + this.skills.agility.level * this.agilityRegenModifier;
      const regenRate = this.staminaRegenPerSecond * agilityMultiplier;
      this.stamina = THREE.MathUtils.clamp(
        this.stamina + regenRate * dt,
        0,
        100,
      );
      if (this.stamina > 1) {
        this.autoRunSwitchSent = false;
      }
    }
  }

  lateUpdate(_delta: number): void {
    this._characterController.validateTerrainPosition();

    // Update aura position via avatar controller
    this._avatarController.updateAuraPosition(this.aura);

    // Update health bar position
    if (this._healthBarHandle && this.base) {
      _healthBarMatrix.copy(this.base.matrixWorld);
      _healthBarMatrix.elements[13] += 2.0;
      this._healthBarHandle.move(_healthBarMatrix);
    }

    // Fallback: Hide health bar after combat timeout
    if (this._healthBarHandle && this._healthBarVisibleUntil > 0) {
      if (Date.now() >= this._healthBarVisibleUntil) {
        this._healthBarHandle.hide();
        this._healthBarVisibleUntil = 0;
      }
    }
  }

  postLateUpdate(_delta: number): void {}

  teleport(position: THREE.Vector3, rotationY?: number): void {
    this._characterController.teleport(position, rotationY);
  }

  setEffect(effect: string, onEnd?: () => void) {
    if (this.data.effect === effect) return;
    if (this.data.effect) {
      this.data.effect = undefined;
      this.onEffectEnd?.();
      this.onEffectEnd = undefined;
    }
    this.data.effect = { emote: effect };
    this.onEffectEnd = onEnd;
    this.world.network.send("entityModified", {
      id: this.data.id,
      ef: effect,
    });
  }

  setSpeaking(speaking: boolean) {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
  }

  push(force: THREE.Vector3) {
    this._characterController.push(force);
  }

  setName(name: string) {
    this.modify({ name });
    this.world.network.send("entityModified", { id: this.data.id, name });
  }

  setSessionAvatar(avatar: string) {
    this.data.sessionAvatar = avatar;
    this.applyAvatar();
    this.world.network.send("entityModified", {
      id: this.data.id as string,
      sessionAvatar: avatar,
    });
  }

  chat(msg: string): void {
    this.bubbleText!.value = msg;
    this.bubble!.active = true;
    setTimeout(() => {
      this.bubble!.active = false;
    }, 5000);
  }

  say(msg: string): void {
    this.chat(msg);
  }

  onNetworkData(_data: Partial<NetworkData>): void {
    // Health bar is NOT updated here - visual updates ONLY via handleHealthChange()
  }

  handleHealthChange(event: {
    playerId: string;
    health: number;
    maxHealth: number;
  }): void {
    if (event.playerId === this.data.id && this._healthBarHandle) {
      this._healthBarHandle.setHealth(event.health, event.maxHealth);
    }
  }

  handleTeleport(event: {
    playerId: string;
    position: { x: number; y: number; z: number };
    rotationY?: number;
  }): void {
    if (event.playerId === this.data.id) {
      _teleportVec.set(event.position.x, event.position.y, event.position.z);
      this.teleport(_teleportVec, event.rotationY || 0);
    }
  }

  handleAutoRetaliateChanged(event: {
    playerId: string;
    enabled: boolean;
  }): void {
    if (event.playerId !== this.data.id) return;
    this.combat.autoRetaliate = event.enabled;
  }

  handleCombatFaceTarget(eventData: unknown): void {
    const event = eventData as { playerId: string; targetId: string };
    if (event.playerId !== this.data.id) return;
    this._serverFaceTargetId = event.targetId;
  }

  handleCombatClearFaceTarget(eventData: unknown): void {
    const event = eventData as { playerId: string };
    if (event.playerId !== this.data.id) return;
    this._serverFaceTargetId = null;
    this.combat.combatTarget = null;
    // NOTE: Don't null _lastCombatRotation — player holds last combat facing
    // until they start moving (isMoving clears it in update()).
  }

  handlePlayerSetDead(event: {
    playerId: string;
    isDead: boolean;
    deathPosition?:
      | [number, number, number]
      | { x: number; y: number; z: number };
  }): void {
    if (event.playerId !== this.data.id) return;

    if (event.isDead === false) {
      const playerWithDying = this as PlayerLocalWithDying;
      playerWithDying.isDying = false;
      playerWithDying.data.isDying = false;
      this._characterController.unfreezePhysics();
      return;
    }

    // isDead:true = player is dying
    const playerWithDying = this as PlayerLocalWithDying;
    playerWithDying.isDying = true;
    playerWithDying.data.isDying = true;

    // Clear ALL movement state
    this.clickMoveTarget = null;
    this.moveDir.set(0, 0, 0);
    this.moving = false;
    this.running = false;
    if (this.velocity) {
      this.velocity.set(0, 0, 0);
    }

    if (playerWithDying.movementTarget) playerWithDying.movementTarget = null;
    if (playerWithDying.path) playerWithDying.path = null;
    if (playerWithDying.destination) playerWithDying.destination = null;

    // Apply death position
    if (event.deathPosition) {
      let x: number, y: number, z: number;
      if (Array.isArray(event.deathPosition)) {
        [x, y, z] = event.deathPosition;
      } else {
        x = event.deathPosition.x;
        y = event.deathPosition.y;
        z = event.deathPosition.z;
      }

      this.position.set(x, y, z);
      this.node.position.set(x, y, z);
      if (this.data?.position && Array.isArray(this.data.position)) {
        this.data.position[0] = x;
        this.data.position[1] = y;
        this.data.position[2] = z;
      }

      console.log(
        `[PlayerLocal] Applied death position: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
      );
    }

    // Set death animation
    this.data.e = "death";
    this.data.emote = "death";
    this._avatarController.applyDeathEmote();

    // Freeze physics via character controller
    this._characterController.freezePhysicsForDeath(event.deathPosition);

    console.log(
      "[PlayerLocal] Death state applied - all movement blocked for 4.5s death animation",
    );
  }

  handlePlayerRespawned(event: {
    playerId: string;
    spawnPosition?:
      | { x: number; y: number; z: number }
      | [number, number, number];
  }): void {
    if (event.playerId !== this.data.id) return;

    const playerWithDying = this as PlayerLocalWithDying;
    playerWithDying.isDying = false;
    playerWithDying.data.isDying = false;

    if (event.spawnPosition) {
      const spawnPos = event.spawnPosition;
      const isArray = Array.isArray(spawnPos);
      const x = isArray
        ? spawnPos[0]
        : (spawnPos as { x: number; y: number; z: number }).x;
      const y = isArray
        ? spawnPos[1]
        : (spawnPos as { x: number; y: number; z: number }).y;
      const z = isArray
        ? spawnPos[2]
        : (spawnPos as { x: number; y: number; z: number }).z;

      console.log(
        `[PlayerLocal] Teleporting to spawn position: (${x}, ${y}, ${z})`,
      );

      this.position.set(x, y, z);
      this.node.position.set(x, y, z);
      if (Array.isArray(this.data.position)) {
        this.data.position[0] = x;
        this.data.position[1] = y;
        this.data.position[2] = z;
      }

      this._characterController.setCapsulePosition(x, y, z);

      this.data.tileInterpolatorControlled = false;
      this.data.tileMovementActive = false;

      interface NetworkWithTileInterpolator {
        tileInterpolator?: {
          syncPosition?: (
            id: string,
            pos: { x: number; y: number; z: number },
          ) => void;
        };
      }
      const network = this.world.network as NetworkWithTileInterpolator;
      if (network?.tileInterpolator?.syncPosition) {
        network.tileInterpolator.syncPosition(this.data.id, { x, y, z });
      }
    }

    // Unfreeze physics via character controller
    this._characterController.unfreezePhysics();

    console.log(
      "[PlayerLocal] Respawn complete - player can move and act normally",
    );
  }

  override destroy(): void {
    this.active = false;

    // Destroy controllers
    this._characterController.destroy();
    this._inputHandler.destroy();
    this._avatarController.destroy();

    // Remove event listeners
    this.world.off(EventType.PLAYER_HEALTH_UPDATED, this.handleHealthChange);
    this.world.off(EventType.PLAYER_TELEPORT_REQUEST, this.handleTeleport);
    this.world.off(EventType.PLAYER_SET_DEAD, (eventData) => {
      this.handlePlayerSetDead(
        eventData as { playerId: string; isDead: boolean },
      );
    });
    this.world.off(EventType.PLAYER_RESPAWNED, (eventData) => {
      this.handlePlayerRespawned(
        eventData as {
          playerId: string;
          spawnPosition?:
            | { x: number; y: number; z: number }
            | [number, number, number];
        },
      );
    });
    this.world.off(
      EventType.UI_AUTO_RETALIATE_CHANGED,
      this.handleAutoRetaliateChanged,
    );
    this.world.off(EventType.COMBAT_FACE_TARGET, this.handleCombatFaceTarget);
    this.world.off(
      EventType.COMBAT_CLEAR_FACE_TARGET,
      this.handleCombatClearFaceTarget,
    );

    // Clean up UI elements
    if (this.aura) {
      if (this.aura.parent) {
        this.aura.parent.remove(this.aura);
      }
      this.aura = null;
    }

    if (this._healthBarHandle) {
      this._healthBarHandle.destroy();
      this._healthBarHandle = null;
    }

    if (this.bubble) {
      this.bubble.deactivate();
      this.bubble = null;
    }

    if (this.base) {
      if (this.base.parent) {
        this.base.parent.remove(this.base);
      }
      this.base = undefined;
    }

    // Notify systems
    this.world.emit(EventType.PLAYER_DESTROY, { playerId: this.id });
    this.world.setHot(this, false);

    super.destroy();
  }
}
