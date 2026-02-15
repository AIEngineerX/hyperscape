/**
 * PlayerInputHandler - Input Processing for Local Player
 *
 * Handles all client-side input binding:
 * - Touch controls (virtual joystick, pan)
 * - Control priority binding
 * - Camera system registration and target setting
 *
 * Extracted from PlayerLocal.ts to reduce file size.
 *
 * @public
 */

import { EventType } from "../../types/events";
import type { ControlBinding, TouchInfo } from "../../types/index";
import type {
  PlayerStickState,
  PlayerTouch,
} from "../../types/systems/physics";
import { getSystem } from "../../utils/SystemUtils";
import type { World } from "../../core/World";

// Constants for control priorities
const ControlPriorities = {
  PLAYER: 1000,
};

/**
 * Context interface that PlayerLocal must satisfy for the input handler.
 * Keeps the coupling explicit and minimal.
 */
export interface PlayerInputContext {
  readonly world: World;
  readonly data: { id: string; [key: string]: unknown };
  readonly position: { x: number; y: number; z: number };
  stick?: PlayerStickState;
  pan?: PlayerTouch;
  control?: ControlBinding;
}

export class PlayerInputHandler {
  private ctx: PlayerInputContext;

  constructor(ctx: PlayerInputContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize control binding for input handling (touch, stick, pan).
   * Also registers this player as the camera target.
   */
  initControl(): void {
    const ctx = this.ctx;

    if (ctx.world.controls) {
      ctx.control = ctx.world.controls.bind({
        priority: ControlPriorities.PLAYER,
        onTouch: (touch: TouchInfo) => {
          // Convert TouchInfo to PlayerTouch for internal use
          const playerTouch: PlayerTouch = {
            id: touch.id,
            x: touch.position.x,
            y: touch.position.y,
            pressure: 1.0,
            position: { x: touch.position.x, y: touch.position.y },
          };
          if (
            !ctx.stick &&
            playerTouch.position &&
            playerTouch.position.x < (ctx.control?.screen?.width || 0) / 2
          ) {
            ctx.stick = {
              center: { x: playerTouch.position.x, y: playerTouch.position.y },
              touch: playerTouch,
            };
          } else if (!ctx.pan) {
            ctx.pan = playerTouch;
          }
          return true;
        },
        onTouchEnd: (touch: TouchInfo) => {
          const playerTouch: PlayerTouch = {
            id: touch.id,
            x: touch.position.x,
            y: touch.position.y,
            pressure: 1.0,
            position: { x: touch.position.x, y: touch.position.y },
          };
          if (ctx.stick?.touch === playerTouch) {
            ctx.stick = undefined;
          }
          if (ctx.pan === playerTouch) {
            ctx.pan = undefined;
          }
          return true;
        },
      }) as ControlBinding;
    }

    // Initialize camera controls
    const _cameraSystem = getSystem(ctx.world, "client-camera-system");
    // Set ourselves as the camera target
    ctx.world.emit(EventType.CAMERA_SET_TARGET, { target: ctx });
  }

  /**
   * Initialize the camera system registration.
   * Registers with the client-camera-system and emits avatar/camera events.
   */
  initCameraSystem(avatar: unknown, camHeight: number): void {
    const ctx = this.ctx;

    // Register with camera system
    const _cameraSystem = getSystem(ctx.world, "client-camera-system");

    // The camera target expects an object with a THREE.Vector3 position
    ctx.world.emit(EventType.CAMERA_SET_TARGET, { target: ctx });

    // Emit avatar ready event for camera height adjustment
    ctx.world.emit(EventType.PLAYER_AVATAR_READY, {
      playerId: ctx.data.id,
      avatar: avatar,
      camHeight: camHeight,
    });
  }

  /**
   * Clean up control binding.
   */
  destroy(): void {
    if (this.ctx.control) {
      this.ctx.control = undefined;
    }
  }
}
