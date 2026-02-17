/**
 * ParticleManager - Central Particle Manager Router
 *
 * Single entry point for all particle systems. ResourceSystem (and other systems)
 * send events here; the manager routes them to the correct specialised sub-manager
 * based on resource type or particle category.
 *
 * Currently manages:
 *   - WaterParticleManager  (fishing spots: splash, bubble, shimmer, ripple)
 *
 * To add a new particle type (e.g. fire, magic, dust):
 *   1. Create a new sub-manager class in this folder
 *   2. Instantiate it in the ParticleManager constructor
 *   3. Add routing logic in the register / unregister / move / handleEvent methods
 *   4. Call its update() from ParticleManager.update()
 *   5. Call its dispose() from ParticleManager.dispose()
 *
 * @module ParticleManager
 */

import * as THREE from "../../../extras/three/three";
import { WaterParticleManager } from "./WaterParticleManager";

// =============================================================================
// TYPES
// =============================================================================

export interface ParticleSpotConfig {
  entityId: string;
  position: { x: number; y: number; z: number };
  resourceType: string;
  resourceId: string;
}

export interface ParticleResourceEvent {
  id?: string;
  type?: string;
  position?: { x: number; y: number; z: number };
}

// =============================================================================
// PARTICLE MANAGER
// =============================================================================

export class ParticleManager {
  private waterManager: WaterParticleManager;
  // Future managers go here:
  // private fireManager: FireParticleManager;
  // private magicManager: MagicParticleManager;

  constructor(scene: THREE.Scene) {
    this.waterManager = new WaterParticleManager(scene);
    console.log("[ParticleManager] Initialized with WaterParticleManager");
  }

  // ===========================================================================
  // SPOT LIFECYCLE (called by entities)
  // ===========================================================================

  /**
   * Register a particle-emitting spot. Routes to the correct manager
   * based on `config.resourceType`.
   */
  registerSpot(config: ParticleSpotConfig): void {
    if (this.isWaterType(config.resourceType)) {
      this.waterManager.registerSpot({
        entityId: config.entityId,
        position: config.position,
        resourceId: config.resourceId,
      });
      return;
    }
    // Future: route to other managers based on resourceType
  }

  /**
   * Unregister a spot. Tries every manager that could own it.
   */
  unregisterSpot(entityId: string, resourceType: string): void {
    if (this.isWaterType(resourceType)) {
      this.waterManager.unregisterSpot(entityId);
      return;
    }
    // Future: route to other managers
  }

  /**
   * Move an existing spot's position. Called when fishing spots relocate.
   */
  moveSpot(
    entityId: string,
    resourceType: string,
    newPos: { x: number; y: number; z: number },
  ): void {
    if (this.isWaterType(resourceType)) {
      this.waterManager.moveSpot(entityId, newPos);
      return;
    }
    // Future: route to other managers
  }

  // ===========================================================================
  // EVENT ROUTING (called by systems)
  // ===========================================================================

  /**
   * Handle a resource event (e.g. RESOURCE_SPAWNED) and route to the
   * appropriate particle manager. Systems call this instead of knowing
   * about individual managers.
   */
  handleResourceEvent(data: ParticleResourceEvent): void {
    if (!data.id || !data.type || !data.position) return;

    if (this.isWaterType(data.type)) {
      this.waterManager.moveSpot(data.id, data.position);
      return;
    }
    // Future: route to other managers
  }

  // ===========================================================================
  // PER-FRAME UPDATE
  // ===========================================================================

  /**
   * Drive all particle managers. Called once per frame by the owning system.
   */
  update(dt: number, camera: THREE.Camera): void {
    this.waterManager.update(dt, camera);
    // Future: this.fireManager.update(dt, camera);
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  dispose(): void {
    this.waterManager.dispose();
    // Future: this.fireManager.dispose();
    console.log("[ParticleManager] Disposed all particle managers");
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private isWaterType(resourceType: string): boolean {
    return resourceType === "fishing_spot";
  }
}
