/**
 * PlayerCharacterController - PhysX Capsule Movement for Local Player
 *
 * Handles all physics-related character controller logic:
 * - PhysX capsule creation and configuration
 * - Ground detection and terrain validation
 * - Position validation (aggressive bounds checking)
 * - Teleportation
 * - Flying mode toggle
 * - Push forces
 * - Server position reconciliation
 *
 * Extracted from PlayerLocal.ts to reduce file size.
 *
 * @public
 */

import * as THREE from "../../extras/three/three";
import { Layers } from "../../physics/Layers";
import { getPhysX, waitForPhysX } from "../../physics/PhysXManager";
import type { PhysicsHandle } from "../../systems/shared";
import type {
  ActorHandle,
  PxMaterial,
  PxRigidDynamic,
  PxSphereGeometry,
  PxCapsuleGeometry,
  PxShape,
  PxVec3,
} from "../../types/systems/physics";
import { vector3ToPxVec3 } from "../../utils/physics/PhysicsUtils";
import type { World } from "../../core/World";

const UP = new THREE.Vector3(0, 1, 0);

// Pre-allocated temp vector for teleport
const _teleportUp = new THREE.Vector3();
const _teleportQuat = new THREE.Quaternion();

interface PhysXGlobal {
  PHYSX?: {
    PxVec3: new (x: number, y: number, z: number) => unknown;
    PxRigidBodyFlagEnum: { eKINEMATIC: number };
  };
}

/**
 * Context interface that PlayerLocal must satisfy for the character controller.
 */
export interface CharacterControllerContext {
  readonly world: World;
  readonly id: string;
  readonly data: {
    id: string;
    roles?: string[];
    position?: number[];
    tileInterpolatorControlled?: boolean;
    [key: string]: unknown;
  };
  readonly node: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  base?: THREE.Group;

  // Physics fields - owned by PlayerLocal but mutated by this controller
  mass: number;
  gravity: number;
  effectiveGravity: number;
  jumpHeight: number;
  capsuleRadius: number;
  capsuleHeight: number;
  grounded: boolean;
  groundAngle: number;
  groundNormal: THREE.Vector3;
  groundSweepRadius: number;
  groundSweepGeometry: PxSphereGeometry | PxCapsuleGeometry | PxShape | null;
  material: PxMaterial | null;
  capsule: PxRigidDynamic | null;
  capsuleHandle: ActorHandle | null;

  pushForce: THREE.Vector3 | null;
  pushForceInit: boolean;
  slipping: boolean;
  jumped: boolean;
  jumping: boolean;
  justLeftGround: boolean;
  fallTimer: number;
  falling: boolean;
  moveDir: THREE.Vector3;
  moving: boolean;
  lastJumpAt: number;
  flying: boolean;
  flyForce: number;
  flyDrag: number;
  flyDir: THREE.Vector3;
  platform: {
    actor: Record<string, unknown> | null;
    prevTransform: THREE.Matrix4;
  };

  serverPosition: THREE.Vector3;
  lastServerUpdate: number;

  cam: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    rotation: THREE.Euler;
    zoom: number;
  };

  clickMoveTarget: THREE.Vector3 | null;
  running: boolean;
  runMode: boolean;
  stamina: number;
}

export class PlayerCharacterController {
  private ctx: CharacterControllerContext;
  private positionValidationInterval?: NodeJS.Timeout;

  constructor(ctx: CharacterControllerContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize physics-related state on the context.
   * Called during PlayerLocal.init() before capsule creation.
   */
  initPhysicsState(): void {
    const ctx = this.ctx;

    ctx.mass = 1;
    ctx.gravity = 20;
    ctx.effectiveGravity = ctx.gravity * ctx.mass;
    ctx.jumpHeight = 1.5;

    ctx.capsuleRadius = 0.3;
    ctx.capsuleHeight = 1.6;

    ctx.grounded = false;
    ctx.groundAngle = 0;
    ctx.groundNormal.copy(UP);
    ctx.groundSweepRadius = ctx.capsuleRadius - 0.01;

    ctx.pushForce = null;
    ctx.pushForceInit = false;

    ctx.slipping = false;

    ctx.jumped = false;
    ctx.jumping = false;
    ctx.justLeftGround = false;

    ctx.fallTimer = 0;
    ctx.falling = false;

    ctx.moveDir = new THREE.Vector3();
    ctx.moving = false;

    ctx.lastJumpAt = 0;
    ctx.flying = false;
    ctx.flyForce = 100;
    ctx.flyDrag = 300;
    ctx.flyDir = new THREE.Vector3();

    ctx.platform = {
      actor: null,
      prevTransform: new THREE.Matrix4(),
    };
  }

  /**
   * Start aggressive position validation interval.
   * Checks position bounds and terrain every 100ms.
   */
  startPositionValidation(): void {
    let checkCount = 0;
    this.positionValidationInterval = setInterval(() => {
      checkCount++;

      if (checkCount < 50) {
        this.validateTerrainPosition();
      } else if (checkCount % 5 === 0) {
        this.validateTerrainPosition();
      }

      // HARD CRASH if player is falling (Y position too low)
      if (this.ctx.position.y < -10) {
        const errorDetails = {
          clientPosition: {
            x: this.ctx.position.x.toFixed(2),
            y: this.ctx.position.y.toFixed(2),
            z: this.ctx.position.z.toFixed(2),
          },
          serverPosition: this.ctx.serverPosition
            ? {
                x: this.ctx.serverPosition.x.toFixed(2),
                y: this.ctx.serverPosition.y.toFixed(2),
                z: this.ctx.serverPosition.z.toFixed(2),
              }
            : "null",
          basePosition: this.ctx.base
            ? {
                x: this.ctx.base.position.x.toFixed(2),
                y: this.ctx.base.position.y.toFixed(2),
                z: this.ctx.base.position.z.toFixed(2),
              }
            : "null",
          hasCapsule: !!this.ctx.capsule,
          playerId: this.ctx.id,
          timestamp: new Date().toISOString(),
        };

        console.error("[PlayerLocal] FATAL: PLAYER HAS FALLEN BELOW TERRAIN!");
        console.error("[PlayerLocal] Error details:", errorDetails);

        clearInterval(this.positionValidationInterval);

        throw new Error(
          `[PlayerLocal] FATAL: Player has fallen below terrain at Y=${this.ctx.position.y.toFixed(2)}! This indicates a critical movement system failure.\n\nDebug info:\n${JSON.stringify(errorDetails, null, 2)}`,
        );
      }

      // Also crash if Y is unreasonably high
      if (this.ctx.position.y > 200) {
        const errorDetails = {
          clientY: this.ctx.position.y.toFixed(2),
          serverY: this.ctx.serverPosition?.y?.toFixed(2) || "N/A",
          playerId: this.ctx.id,
        };

        clearInterval(this.positionValidationInterval);
        throw new Error(
          `[PlayerLocal] FATAL: Player is too high at Y=${this.ctx.position.y.toFixed(2)}!\n\nDebug: ${JSON.stringify(errorDetails)}`,
        );
      }

      // Check for large divergence from server
      const tileControlled = this.ctx.data?.tileInterpolatorControlled === true;
      if (this.ctx.serverPosition && !tileControlled) {
        const dist = this.ctx.position.distanceTo(this.ctx.serverPosition);
        if (dist > 100) {
          console.warn(
            "[PlayerLocal] WARNING: Very large divergence detected, snapping to server.",
            {
              client: this.ctx.position,
              server: this.ctx.serverPosition,
              distance: dist,
            },
          );
          this.ctx.position.copy(this.ctx.serverPosition);
          if (this.ctx.capsule && getPhysX()) {
            const PHYSX = getPhysX()!;
            const pose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity);
            pose.p.x = this.ctx.serverPosition.x;
            pose.p.y = this.ctx.serverPosition.y;
            pose.p.z = this.ctx.serverPosition.z;
            this.ctx.capsule.setGlobalPose(pose);
          }
        }
      }
    }, 100);
  }

  /**
   * Validate player position against terrain height.
   * Clamps position to terrain to prevent clipping.
   */
  validateTerrainPosition(): void {
    const terrain = this.ctx.world.getSystem("terrain");
    if (!terrain) return;

    const terrainHeight = terrain.getHeightAt(
      this.ctx.position.x,
      this.ctx.position.z,
    );
    if (!Number.isFinite(terrainHeight)) return;

    if (this.ctx.position.y < terrainHeight) {
      this.ctx.position.y = terrainHeight;
    } else if (this.ctx.position.y > terrainHeight + 0.5) {
      this.ctx.position.y = terrainHeight;
    }
  }

  /**
   * Wait for terrain system to be ready.
   */
  async waitForTerrain(): Promise<void> {
    const terrainSystem = this.ctx.world.getSystem("terrain");
    if (!terrainSystem) return;
    if (terrainSystem.isReady()) return;

    const maxWaitTime = 10000;
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (terrainSystem.isReady()) {
          clearInterval(checkInterval);
          resolve();
        } else if (elapsed > maxWaitTime) {
          console.warn(
            "[PlayerLocal] Terrain wait timeout after",
            elapsed,
            "ms - proceeding anyway",
          );
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Create and configure the PhysX capsule for the player.
   */
  async initCapsule(): Promise<void> {
    const ctx = this.ctx;

    if (
      isNaN(ctx.position.x) ||
      isNaN(ctx.position.y) ||
      isNaN(ctx.position.z)
    ) {
      console.warn(
        `[PlayerLocal] Invalid position from server: ${ctx.position.x}, ${ctx.position.y}, ${ctx.position.z}`,
      );
      return;
    }

    if (!ctx.base) {
      console.warn(
        "[PlayerLocal] Cannot initialize physics capsule: Base object is null",
      );
      return;
    }

    await waitForPhysX("PlayerLocal", 10000);

    const PHYSX = getPhysX();
    if (!PHYSX) {
      throw new Error(
        "[PlayerLocal] PHYSX global not available - PlayerLocal requires PhysX for physics simulation",
      );
    }

    if (!ctx.world.physics) {
      throw new Error(
        "[PlayerLocal] Physics system not found - PlayerLocal requires physics system",
      );
    }

    if (!ctx.world.physics.scene) {
      throw new Error(
        "[PlayerLocal] Physics scene not initialized - PlayerLocal requires active physics scene",
      );
    }

    ctx.groundSweepGeometry = new PHYSX.PxSphereGeometry(ctx.groundSweepRadius);

    // Force position to server position before creating physics
    ctx.position.copy(ctx.serverPosition);
    if (ctx.node) {
      ctx.node.position.copy(ctx.serverPosition);
    }

    ctx.material = ctx.world.physics.physics.createMaterial(0.4, 0.4, 0.1);
    if (!ctx.material) {
      throw new Error(
        "[PlayerLocal] Failed to create physics material - required for player capsule",
      );
    }

    const geometry = new PHYSX.PxCapsuleGeometry(
      ctx.capsuleRadius,
      ctx.capsuleHeight * 0.5,
    );

    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity);
    ctx.capsule = ctx.world.physics.physics.createRigidDynamic(transform);
    if (!ctx.capsule) {
      throw new Error("[PlayerLocal] Failed to create rigid dynamic body");
    }

    ctx.capsule.setMass(ctx.mass);
    ctx.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true);
    ctx.capsule.setRigidDynamicLockFlag(
      PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_X,
      true,
    );
    ctx.capsule.setRigidDynamicLockFlag(
      PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_Z,
      true,
    );
    ctx.capsule.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true);

    const shape = ctx.world.physics.physics.createShape(
      geometry,
      ctx.material!,
      false,
    );
    if (!shape) {
      throw new Error("[PlayerLocal] Failed to create capsule shape");
    }

    const playerLayer = Layers.player || { group: 0x4, mask: 0x6 };
    const filterData = new PHYSX.PxFilterData(
      playerLayer.group,
      0xffffffff,
      0,
      0,
    );
    shape.setQueryFilterData(filterData);
    shape.setSimulationFilterData(filterData);

    ctx.capsule.attachShape(shape);

    const initialPose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity);
    initialPose.p.x = ctx.serverPosition.x;
    initialPose.p.y = ctx.serverPosition.y;
    initialPose.p.z = ctx.serverPosition.z;

    ctx.capsule.setGlobalPose(initialPose);

    const capsuleHandle = {
      tag: "player",
      playerId: ctx.data?.id || "unknown",
      contactedHandles: new Set<PhysicsHandle>(),
      triggeredHandles: new Set<PhysicsHandle>(),
    };
    const physics = ctx.world.physics;
    if (!physics) {
      throw new Error("[PlayerLocal] Physics system is not available");
    }

    ctx.capsuleHandle = physics.addActor(
      ctx.capsule,
      capsuleHandle,
    ) as ActorHandle | null;

    if (!ctx.capsuleHandle) {
      throw new Error("[PlayerLocal] Capsule handle is not available");
    }

    if (ctx.capsuleHandle && ctx.capsuleHandle.snap) {
      ctx.capsuleHandle.snap(initialPose);
    } else {
      console.warn("[PlayerLocal] Capsule handle snap method not available");
    }

    // Validate final positions
    const finalPose = ctx.capsule.getGlobalPose();
    const finalPosition = finalPose.p;

    const positionDelta = new THREE.Vector3(
      Math.abs(finalPosition.x - ctx.position.x),
      Math.abs(finalPosition.y - ctx.position.y),
      Math.abs(finalPosition.z - ctx.position.z),
    );

    if (positionDelta.length() > 0.001) {
      console.warn(
        "[PlayerLocal] Position mismatch between physics and base:",
        positionDelta.length(),
      );
    }
  }

  /**
   * Update server authoritative position for reconciliation.
   */
  updateServerPosition(x: number, y: number, z: number): void {
    const ctx = this.ctx;

    if (!ctx.serverPosition) {
      ctx.serverPosition = new THREE.Vector3();
    }

    if (y < -5) {
      console.error(
        `[PlayerLocal] REJECTING invalid server position! Y=${y} is below terrain!`,
      );
      console.error(
        `[PlayerLocal] Server tried to set position to: (${x}, ${y}, ${z})`,
      );

      const terrain = ctx.world.getSystem("terrain") as {
        getHeightAt?: (x: number, z: number) => number;
      } | null;
      if (terrain?.getHeightAt) {
        const terrainHeight = terrain.getHeightAt(x, z);
        if (Number.isFinite(terrainHeight)) {
          const safeY = terrainHeight as number;
          console.warn(
            `[PlayerLocal] Correcting to safe height: Y=${safeY} (terrain=${terrainHeight})`,
          );
          ctx.serverPosition.set(x, safeY, z);
        } else {
          console.warn(`[PlayerLocal] No terrain data, using default Y=50`);
          ctx.serverPosition.set(x, 50, z);
        }
      } else {
        console.warn(`[PlayerLocal] No terrain system, using default Y=50`);
        ctx.serverPosition.set(x, 50, z);
      }
    } else {
      ctx.serverPosition.set(x, y, z);
    }

    ctx.lastServerUpdate = performance.now();

    if (!Number.isFinite(y) || y > 1000) {
      console.error(
        `[PlayerLocal] WARNING: Received questionable Y position from server: ${y}`,
      );
    }

    if (ctx.base) {
      ctx.base!.updateMatrix();
      ctx.base!.updateMatrixWorld(true);
    }

    if (!ctx.capsule) {
      ctx.position.copy(ctx.serverPosition);
    }
  }

  /**
   * Update server velocity for prediction.
   */
  updateServerVelocity(x: number, y: number, z: number): void {
    if (!this.ctx.velocity) {
      this.ctx.velocity = new THREE.Vector3();
    }
    this.ctx.velocity.set(x, y, z);
  }

  /**
   * Set click-to-move target. Blocks movement during death.
   * @param isDead - true if player is dying/dead (health <= 0 or isDying flag)
   */
  setClickMoveTarget(
    target: { x: number; y: number; z: number } | null,
    isDead: boolean,
  ): void {
    const ctx = this.ctx;

    if (isDead) {
      console.log("[PlayerLocal] Movement blocked - player is dying/dead");
      return;
    }

    if (target) {
      if (!ctx.clickMoveTarget) {
        ctx.clickMoveTarget = new THREE.Vector3();
      }
      ctx.clickMoveTarget.set(target.x, target.y, target.z);
      ctx.running = ctx.runMode && ctx.stamina > 0;
      ctx.moving = true;
    } else {
      ctx.clickMoveTarget = null;
      ctx.moveDir.set(0, 0, 0);
      ctx.moving = false;
    }
  }

  /**
   * Sync physics capsule position to match a new entity position.
   * Called from PlayerLocal.setPosition() override.
   */
  syncCapsulePosition(x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (ctx.capsule) {
      const pose = ctx.capsule.getGlobalPose();
      if (pose && pose.p) {
        pose.p.x = x;
        pose.p.y = y;
        pose.p.z = z;
        if (ctx.capsuleHandle) {
          ctx.capsuleHandle.snap(pose);
        } else {
          ctx.capsule.setGlobalPose(pose);
        }
      }
    }
  }

  /**
   * Toggle flying mode (admin only).
   */
  toggleFlying(): void {
    const ctx = this.ctx;
    const canFly =
      ctx.world.settings.public ||
      (ctx.data.roles && ctx.data.roles.includes("admin"));
    if (!canFly) return;

    ctx.flying = !ctx.flying;
    if (ctx.flying && ctx.capsule) {
      const velocity = ctx.capsule.getLinearVelocity();
      if (velocity) {
        velocity.y = 0;
        ctx.capsule.setLinearVelocity(velocity);
      }
    }
    ctx.lastJumpAt = -999;
  }

  /**
   * Apply a push force to the physics capsule.
   */
  push(force: THREE.Vector3): void {
    if (this.ctx.capsule) {
      const pxForce = vector3ToPxVec3(force);
      if (pxForce) {
        this.ctx.capsule.addForce(
          pxForce,
          getPhysX()?.PxForceModeEnum?.eFORCE || 0,
          true,
        );
      }
    }
  }

  /**
   * Teleport the player to a position with optional rotation.
   */
  teleport(position: THREE.Vector3, rotationY?: number): void {
    const ctx = this.ctx;
    const hasRotation = !isNaN(rotationY!);

    if (!ctx.capsule) return;
    const pose = ctx.capsule.getGlobalPose();
    if (!pose || !pose.p) return;

    pose.p.x = position.x;
    pose.p.y = position.y;
    pose.p.z = position.z;
    ctx.capsuleHandle?.snap(pose);
    ctx.position.copy(position);

    if (hasRotation && ctx.base) {
      _teleportUp.set(0, 1, 0);
      _teleportQuat.setFromAxisAngle(_teleportUp, rotationY!);
      ctx.base.quaternion.copy(_teleportQuat);
      ctx.node.quaternion.copy(ctx.base.quaternion);
    }

    // send network update
    ctx.world.network.send("entityModified", {
      id: ctx.data.id,
      p: [ctx.position.x, ctx.position.y, ctx.position.z],
      q: [
        ctx.base!.quaternion.x,
        ctx.base!.quaternion.y,
        ctx.base!.quaternion.z,
        ctx.base!.quaternion.w,
      ],
      t: true,
    });

    if (hasRotation) ctx.cam.rotation.y = rotationY!;
  }

  /**
   * Handle death physics: freeze capsule, apply death position.
   */
  freezePhysicsForDeath(
    deathPosition?:
      | [number, number, number]
      | { x: number; y: number; z: number },
  ): void {
    const ctx = this.ctx;
    const physXGlobal = globalThis as PhysXGlobal;

    if (ctx.capsule && physXGlobal.PHYSX) {
      const PHYSX = physXGlobal.PHYSX;
      console.log("[PlayerLocal] Freezing physics capsule...");

      const zeroVec = new PHYSX.PxVec3(0, 0, 0) as PxVec3;
      ctx.capsule.setLinearVelocity(zeroVec);
      ctx.capsule.setAngularVelocity(zeroVec);

      // Move capsule to death position BEFORE setting KINEMATIC
      if (deathPosition && getPhysX()) {
        const PHYSX_API = getPhysX()!;
        let x: number, y: number, z: number;
        if (Array.isArray(deathPosition)) {
          [x, y, z] = deathPosition;
        } else {
          x = deathPosition.x;
          y = deathPosition.y;
          z = deathPosition.z;
        }
        const deathPose = new PHYSX_API.PxTransform(
          PHYSX_API.PxIDENTITYEnum.PxIdentity,
        );
        deathPose.p.x = x;
        deathPose.p.y = y;
        deathPose.p.z = z;
        ctx.capsule.setGlobalPose(deathPose);
      }

      ctx.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true);
      console.log("[PlayerLocal] Physics frozen (KINEMATIC mode)");
    } else {
      console.warn("[PlayerLocal] No physics capsule - cannot freeze physics");
    }
  }

  /**
   * Unfreeze physics after respawn.
   */
  unfreezePhysics(): void {
    const ctx = this.ctx;
    const physXGlobal = globalThis as PhysXGlobal;

    if (ctx.capsule && physXGlobal.PHYSX) {
      const PHYSX = physXGlobal.PHYSX;
      ctx.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, false);

      const zeroVec = new PHYSX.PxVec3(0, 0, 0) as PxVec3;
      ctx.capsule.setLinearVelocity(zeroVec);
      ctx.capsule.setAngularVelocity(zeroVec);

      console.log("[PlayerLocal] Physics unfrozen (DYNAMIC mode)");
    }
  }

  /**
   * Update capsule position to a specific coordinate (for respawn teleport).
   */
  setCapsulePosition(x: number, y: number, z: number): void {
    const ctx = this.ctx;
    const physXGlobal = globalThis as PhysXGlobal;

    if (ctx.capsule && physXGlobal.PHYSX) {
      const pose = ctx.capsule.getGlobalPose();
      pose.p.x = x;
      pose.p.y = y;
      pose.p.z = z;
      ctx.capsule.setGlobalPose(pose, true);
    }
  }

  /**
   * Clean up physics resources and intervals.
   */
  destroy(): void {
    if (this.positionValidationInterval) {
      clearInterval(this.positionValidationInterval);
      this.positionValidationInterval = undefined;
    }

    if (this.ctx.capsule && this.ctx.capsuleHandle) {
      this.ctx.world.physics?.removeActor(this.ctx.capsule);
      this.ctx.capsuleHandle = null;
    }
  }
}
