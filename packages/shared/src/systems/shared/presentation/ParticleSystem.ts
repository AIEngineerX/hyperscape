/**
 * ParticleSystem - Standalone system for all GPU-instanced particles.
 *
 * Wraps the unified ParticleManager (water + glow sub-managers) and drives
 * it once per frame. Entities and systems access it via
 * `world.getSystem("particle")`.
 *
 * This is the single authoritative ParticleManager owner in the codebase.
 * Entities register/unregister via world.getSystem("particle").
 */

import type { World } from "../../../core/World";
import { SystemBase } from "../infrastructure/SystemBase";
import { EventType } from "../../../types/events";
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

    this.subscribe(
      EventType.RESOURCE_SPAWNED,
      (data: {
        id?: string;
        type?: string;
        position?: { x: number; y: number; z: number };
      }) => {
        this.manager?.handleResourceEvent(data);
      },
    );
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

  destroy(): void {
    this.manager?.dispose();
    this.manager = undefined;
    super.destroy();
  }
}
