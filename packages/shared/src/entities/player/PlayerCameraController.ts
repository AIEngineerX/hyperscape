/**
 * PlayerCameraController - Third-person Camera for Local Player
 *
 * Handles camera state initialization and management:
 * - Camera position and rotation setup
 * - Camera height based on avatar
 * - Camera follow/target events
 * - First-person toggle readiness
 *
 * Extracted from PlayerLocal.ts to reduce file size.
 *
 * @public
 */

import * as THREE from "../../extras/three/three";
import { EventType } from "../../types/events";
import type { World } from "../../core/World";

const DEFAULT_CAM_HEIGHT = 1.2;
const DEG2RAD = Math.PI / 180;

// Rotation binding utility
function bindRotations(quaternion: THREE.Quaternion, euler: THREE.Euler): void {
  quaternion.setFromEuler(euler);
}

/**
 * Context interface that PlayerLocal must satisfy for the camera controller.
 */
export interface CameraControllerContext {
  readonly world: World;
  readonly data: { id: string; [key: string]: unknown };
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  readonly mesh: object | null;
  camHeight: number;
  cam: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    rotation: THREE.Euler;
    zoom: number;
  };
}

export class PlayerCameraController {
  private ctx: CameraControllerContext;

  constructor(ctx: CameraControllerContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize camera state (position, rotation, zoom).
   * Called during PlayerLocal.init().
   */
  initCameraState(): void {
    const ctx = this.ctx;

    ctx.camHeight = DEFAULT_CAM_HEIGHT;

    ctx.cam = {
      position: new THREE.Vector3().copy(ctx.position),
      quaternion: new THREE.Quaternion(),
      rotation: new THREE.Euler(0, 0, 0, "YXZ"),
      zoom: 3.0,
    };
    ctx.cam.position.y += ctx.camHeight;
    bindRotations(ctx.cam.quaternion, ctx.cam.rotation);
    ctx.cam.quaternion.copy(ctx.rotation);
    ctx.cam.rotation.x += -15 * DEG2RAD;
  }

  /**
   * Update camera height based on loaded avatar dimensions.
   */
  updateCameraHeightFromAvatar(avatarHeight: number): void {
    this.ctx.camHeight = Math.max(1.2, avatarHeight * 0.9);
  }

  /**
   * Emit camera follow/target events after avatar is loaded.
   */
  emitCameraFollowEvents(avatar: unknown): void {
    const ctx = this.ctx;

    ctx.world.emit(EventType.CAMERA_FOLLOW_PLAYER, {
      playerId: ctx.data.id,
      entity: { id: ctx.data.id, mesh: ctx.mesh },
      camHeight: ctx.camHeight,
    });

    ctx.world.emit(EventType.CAMERA_SET_TARGET, { target: ctx });
  }

  /**
   * Emit avatar load complete event.
   */
  emitAvatarLoadComplete(playerId: string): void {
    this.ctx.world.emit(EventType.AVATAR_LOAD_COMPLETE, {
      playerId: playerId,
      success: true,
    });
  }

  /**
   * Delayed camera retry initialization (called after a timeout in init).
   */
  retryCameraInit(): void {
    this.ctx.world.emit(EventType.CAMERA_SET_TARGET, { target: this.ctx });
  }
}
