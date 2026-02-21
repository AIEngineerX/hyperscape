/**
 * ParticleSystem - Standalone system for all GPU-instanced particles.
 *
 * Wraps the unified ParticleManager (water + glow sub-managers) and drives
 * it once per frame. Entities and systems access it via
 * `world.getSystem("particle")`.
 *
 * Registered independently of ResourceSystem so it works even when
 * ResourceSystem is disabled.
 */

import type { World } from "../../../core/World";
import { SystemBase } from "../infrastructure/SystemBase";
import {
  ParticleManager,
  type ParticleConfig,
} from "../../../entities/managers/particleManager";

export class ParticleSystem extends SystemBase {
  public manager?: ParticleManager;

  constructor(world: World) {
    super(world, {
      name: "particle",
      dependencies: { required: [], optional: [] },
      autoCleanup: true,
    });
  }

  async init(options?: any): Promise<void> {
    await super.init(options);
    if (this.world.isServer) return;

    const scene = this.world.stage?.scene;
    if (scene) {
      this.manager = new ParticleManager(scene as any);
    }
  }

  update(dt: number): void {
    if (!this.manager) return;
    const camera = this.world.camera;
    if (camera) {
      this.manager.update(dt, camera);
    }
  }

  register(id: string, config: ParticleConfig): void {
    this.manager?.register(id, config);
  }

  unregister(id: string): void {
    this.manager?.unregister(id);
  }

  move(id: string, newPos: { x: number; y: number; z: number }): void {
    this.manager?.move(id, newPos);
  }

  destroy(): void {
    this.manager?.dispose();
    this.manager = undefined;
    super.destroy();
  }
}
