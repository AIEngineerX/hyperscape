/**
 * ResourceEntity - Harvestable Resource Entity
 *
 * Represents gatherable resources in the world like trees, rocks, and fishing spots.
 * Players can interact with these to gather materials and gain experience.
 *
 * **Extends**: InteractableEntity (players can harvest resources)
 *
 * **Key Features**:
 *
 * **Resource Types**:
 * - **Trees**: Woodcutting skill (logs, wood)
 * - **Rocks**: Mining skill (ores, gems)
 * - **Fish**: Fishing skill (fish, treasure)
 * - **Herbs**: Herbalism skill (herbs, flowers)
 *
 * **Harvesting System**:
 * - Skill level requirements (can't harvest high-level resources without skill)
 * - Harvest time based on resource and skill level
 * - Resource depletion after harvesting
 * - Respawn timer after depletion
 * - XP rewards based on resource level
 *
 * **Resource State**:
 * - Available: Can be harvested
 * - Depleted: Recently harvested, waiting to respawn
 * - Respawning: Timer counting down to availability
 *
 * **Yield System**:
 * - Item drops on successful harvest
 * - Quantity randomization
 * - Quality based on skill level
 * - Rare resource chances
 *
 * **Visual Feedback**:
 * - Different appearance when depleted
 * - Particle effects on harvest
 * - Interaction prompt shows requirements
 * - Harvest progress bar
 *
 * **Network Sync**:
 * - Resource state broadcasted to all clients
 * - Depletion events trigger visual changes
 * - Respawn events restore resource
 *
 * **Runs on**: Server (authoritative), Client (visual + interaction)
 * **Referenced by**: ResourceSystem, InteractionSystem, SkillsSystem
 *
 * @public
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import type { EntityData } from "../../types";
import {
  InteractableEntity,
  type InteractableConfig,
} from "../InteractableEntity";
import type {
  EntityInteractionData,
  ResourceEntityConfig,
} from "../../types/entities";
import { modelCache } from "../../utils/rendering/ModelCache";
import { EventType } from "../../types/events";
import { CollisionFlag } from "../../systems/shared/movement/CollisionFlags";
import {
  worldToTile,
  type TileCoord,
} from "../../systems/shared/movement/TileSystem";
import { FOOTPRINT_SIZES } from "../../types/game/resource-processing-types";

// Re-export types for external use
export type { ResourceEntityConfig } from "../../types/entities";

// Fishing spot particle layer types
const FISHING_LAYER_SPLASH = 0;
const FISHING_LAYER_BUBBLE = 1;
const FISHING_LAYER_SHIMMER = 2;
const FISHING_PARTICLE_SIZE = 0.055;
const FISHING_BUBBLE_SIZE = 0.09;

// Splash arc animation: y = peakHeight * PARABOLIC_SCALE * t * (1-t), peaks at t=0.5
const SPLASH_PARABOLIC_SCALE = 4;
// How fast splash particles pop in (higher = snappier)
const SPLASH_FADE_IN_RATE = 12;
// Bubble lateral wobble frequency multiplier
const BUBBLE_WOBBLE_FREQ = 4.0;

interface FishingParticleState {
  types: Uint8Array;
  ages: Float32Array;
  lifetimes: Float32Array;
  angles: Float32Array;
  speeds: Float32Array;
  radii: Float32Array;
  directions: Int8Array;
  peakHeights: Float32Array;
  worldX: number;
  worldY: number;
  worldZ: number;
  /** Countdown until next fish activity burst (seconds) */
  burstTimer: number;
  /** Min/max interval between bursts (seconds) */
  burstIntervalMin: number;
  burstIntervalMax: number;
  /** Number of splash particles to fire per burst */
  burstSplashCount: number;
  /** Index range of splash particles [start, end) */
  splashStart: number;
  splashEnd: number;
}

interface FishingSpotVariant {
  color: number;
  rippleSpeed: number;
  rippleCount: number;
  splashCount: number;
  bubbleCount: number;
  shimmerCount: number;
  splashColor: number;
  bubbleColor: number;
  shimmerColor: number;
  burstIntervalMin: number;
  burstIntervalMax: number;
  burstSplashCount: number;
}

export class ResourceEntity extends InteractableEntity {
  public config: ResourceEntityConfig;
  private respawnTimer?: NodeJS.Timeout;
  /** Glow indicator mesh for fishing spot visibility from distance (client-only) */
  private glowMesh?: THREE.Mesh;
  /** Ripple rings for animated fishing spot effect (client-only) */
  private rippleRings?: THREE.Mesh[];
  /** Billboard particle meshes for fishing spot effects (client-only, world-space) */
  private particleMeshes: THREE.Mesh[] = [];
  /** Per-particle animation state (typed arrays for zero-allocation updates) */
  private particleState: FishingParticleState | null = null;
  /** Ripple animation speed (stored from variant for clientUpdate use) */
  private fishingRippleSpeed = 1.0;
  /** Shared billboard geometry for fishing particles */
  private static particleGeometry: THREE.CircleGeometry | null = null;
  /** Cache for DataTextures keyed by generation parameters to avoid duplicates */
  private static textureCache = new Map<string, THREE.DataTexture>();
  /** Dispose shared static resources (geometry + texture cache). Call on world teardown. */
  static disposeSharedResources(): void {
    if (ResourceEntity.particleGeometry) {
      ResourceEntity.particleGeometry.dispose();
      ResourceEntity.particleGeometry = null;
    }
    for (const tex of ResourceEntity.textureCache.values()) {
      tex.dispose();
    }
    ResourceEntity.textureCache.clear();
  }

  /** Tiles this resource occupies for collision (cached for cleanup) */
  private collisionTiles: TileCoord[] = [];

  constructor(world: World, config: ResourceEntityConfig) {
    // Convert ResourceEntityConfig to InteractableConfig format
    const interactableConfig: InteractableConfig = {
      ...config,
      interaction: {
        prompt: `${config.harvestSkill} ${config.resourceType}`,
        description: `${config.resourceType} - Level ${config.requiredLevel} ${config.harvestSkill} required`,
        range: 2.0,
        cooldown: config.harvestTime || 3000,
        usesRemaining: config.depleted ? 0 : -1, // -1 = unlimited uses until depleted
        maxUses: -1,
        effect: "harvest",
      },
    };

    super(world, interactableConfig);
    this.config = {
      ...config,
      depleted: config.depleted !== undefined ? config.depleted : false,
      lastHarvestTime:
        config.lastHarvestTime !== undefined ? config.lastHarvestTime : 0,
    };

    // Resources don't have health bars - they're not combatants
    this.health = 0;
    this.maxHealth = 0;

    // Register collision for this resource (server-side only)
    // Fishing spots don't block movement - they're in water
    if (this.world.isServer && config.resourceType !== "fishing_spot") {
      this.registerCollision();
    }
  }

  /**
   * Register this resource's tiles in the collision matrix.
   * Called on construction, tiles remain blocked even when depleted (OSRS-accurate).
   * Uses center-based registration (footprint centered on entity position) for
   * consistency with station entities and tilesWithinRangeOfFootprint() checks.
   */
  private registerCollision(): void {
    // Get center tile from world position
    const centerTile = worldToTile(this.position.x, this.position.z);

    // Get footprint size (defaults to standard 1x1)
    const footprint = this.config.footprint || "standard";
    const size = FOOTPRINT_SIZES[footprint];

    // Calculate offset to center the footprint on the entity
    const offsetX = Math.floor(size.x / 2);
    const offsetZ = Math.floor(size.z / 2);

    // Calculate all tiles this resource occupies (centered on position)
    this.collisionTiles = [];
    for (let dx = 0; dx < size.x; dx++) {
      for (let dz = 0; dz < size.z; dz++) {
        this.collisionTiles.push({
          x: centerTile.x + dx - offsetX,
          z: centerTile.z + dz - offsetZ,
        });
      }
    }

    // Store in config for potential serialization
    this.config.anchorTile = centerTile;
    this.config.occupiedTiles = this.collisionTiles;

    // Add BLOCKED flag to all tiles
    for (const tile of this.collisionTiles) {
      this.world.collision.addFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
    }
  }

  /**
   * Unregister this resource's tiles from the collision matrix.
   * Called on destroy.
   */
  private unregisterCollision(): void {
    for (const tile of this.collisionTiles) {
      this.world.collision.removeFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
    }
    this.collisionTiles = [];
  }

  /**
   * Handle resource interaction - implements InteractableEntity.handleInteraction
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    // Default to harvest interaction if not specified
    if (data.interactionType && data.interactionType !== "harvest") return;

    // Check if resource is depleted
    if (this.config.depleted) {
      return;
    }

    // Send harvest request to resource system
    this.world.emit(EventType.RESOURCE_HARVEST_REQUEST, {
      playerId: data.playerId,
      entityId: this.id,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
    });
  }

  public deplete(): void {
    if (!this.world.isServer) return;

    this.config.depleted = true;
    this.config.lastHarvestTime = Date.now();
    this.markNetworkDirty();

    // Update interaction component to show as depleted
    const interactionComponent = this.getComponent("interaction");
    if (interactionComponent) {
      interactionComponent.data.interactable = false;
      interactionComponent.data.description = `${this.config.resourceType} - Depleted`;
    }

    // Clear any existing timer
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
    }

    // Schedule respawn with tracked timer to prevent memory leaks
    this.respawnTimer = setTimeout(() => {
      this.respawn();
      this.respawnTimer = undefined;
    }, this.config.respawnTime);
  }

  public respawn(): void {
    if (!this.world.isServer) return;

    this.config.depleted = false;
    this.markNetworkDirty();

    // Update interaction component to show as available again
    const interactionComponent = this.getComponent("interaction");
    if (interactionComponent) {
      interactionComponent.data.interactable = true;
      interactionComponent.data.description = `${this.config.resourceType} - Level ${this.config.requiredLevel} ${this.config.harvestSkill} required`;
    }
  }

  private async swapToStump(): Promise<void> {
    if (this.world.isServer || !this.node) return;

    // Check if this resource has a depleted model configured
    // Trees have stumps, rocks have depleted rock models, etc.
    const depletedModelPath = this.config.depletedModelPath;

    // If no depleted model path, just hide the current mesh
    if (!depletedModelPath) {
      if (this.mesh) {
        this.mesh.visible = false;
      }
      return;
    }

    // Remove current mesh
    if (this.mesh) {
      this.node.remove(this.mesh);
      this.mesh = null;
    }
    try {
      const { scene } = await modelCache.loadModel(
        depletedModelPath,
        this.world,
      );

      this.mesh = scene;
      this.mesh.name = `ResourceDepleted_${this.config.resourceType}`;

      // Use scale from config (set by manifest) or fallback to default
      // Apply uniform scale directly (simplified approach matching FurnaceEntity)
      const modelScale = this.config.depletedModelScale ?? 0.3;
      this.mesh.scale.set(modelScale, modelScale, modelScale);

      // Set layers and enable shadows (simple traverse, no scale manipulation)
      this.mesh.layers.set(1);
      this.mesh.traverse((child) => {
        child.layers.set(1);
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Set up userData
      this.mesh.userData = {
        type: "resource",
        entityId: this.id,
        name: `${this.config.name} (Depleted)`,
        interactable: false,
        resourceType: this.config.resourceType,
        depleted: true,
      };

      // Align depleted model to ground (same as createMesh)
      const bbox = new THREE.Box3().setFromObject(this.mesh);
      const minY = bbox.min.y;
      this.mesh.position.set(0, -minY, 0);

      this.node.add(this.mesh);
    } catch (_error) {
      // Fallback: just hide the original mesh
      if (this.mesh) {
        this.mesh.visible = false;
      }
    }
  }

  private async swapToFullModel(): Promise<void> {
    if (this.world.isServer || !this.node) return;

    // Remove current depleted mesh
    if (this.mesh) {
      this.node.remove(this.mesh);
      this.mesh = null;
    }

    // Reload the original model
    await this.createMesh();
  }

  // Override serialize() to include all config data for network sync
  serialize(): EntityData {
    const baseData = super.serialize();
    return {
      ...baseData,
      model: this.config.model,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      depleted: this.config.depleted,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
      respawnTime: this.config.respawnTime,
      interactionDistance: this.config.interactionDistance || 3,
      description: this.config.description,
      modelScale: this.config.modelScale,
      depletedModelScale: this.config.depletedModelScale,
      depletedModelPath: this.config.depletedModelPath,
    } as EntityData;
  }

  public getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();
    return {
      ...baseData,
      model: this.config.model,
      resourceType: this.config.resourceType,
      resourceId: this.config.resourceId,
      depleted: this.config.depleted,
      harvestSkill: this.config.harvestSkill,
      requiredLevel: this.config.requiredLevel,
      harvestTime: this.config.harvestTime,
      harvestYield: this.config.harvestYield,
      respawnTime: this.config.respawnTime,
      modelScale: this.config.modelScale,
      depletedModelScale: this.config.depletedModelScale,
      depletedModelPath: this.config.depletedModelPath,
    };
  }

  public updateFromNetwork(data: Record<string, unknown>): void {
    if (data.depleted !== undefined) {
      const wasDepleted = this.config.depleted;
      this.config.depleted = Boolean(data.depleted);

      // Update visual state based on depletion - swap to depleted model
      if (this.config.depleted && !wasDepleted) {
        // Just became depleted - swap to depleted model
        this.swapToStump();
      } else if (!this.config.depleted && wasDepleted) {
        // Just respawned - swap back to full model
        this.swapToFullModel();
      }
    }
  }

  protected async createMesh(): Promise<void> {
    if (this.world.isServer) {
      return;
    }

    // Try to load 3D model if available
    if (this.config.model && this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(
          this.config.model,
          this.world,
        );

        this.mesh = scene;
        this.mesh.name = `Resource_${this.config.resourceType}`;

        // Use scale from manifest config, with fallback defaults per resource type
        let modelScale = this.config.modelScale ?? 1.0;

        // Fallback defaults if manifest doesn't specify scale
        if (this.config.modelScale === undefined) {
          if (this.config.resourceType === "tree") {
            modelScale = 3.0;
          }
        }

        // Apply uniform scale directly to mesh (same as FurnaceEntity)
        // Do NOT manipulate internal node scales - this causes issues
        this.mesh.scale.set(modelScale, modelScale, modelScale);

        // Set layer for minimap exclusion and enable shadows
        // (Same simple traverse as FurnaceEntity - only for layers/shadows, no scale manipulation)
        this.mesh.layers.set(1);
        this.mesh.traverse((child) => {
          child.layers.set(1);
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Set up userData for interaction detection
        this.mesh.userData = {
          type: "resource",
          entityId: this.id,
          name: this.config.name,
          interactable: true,
          resourceType: this.config.resourceType,
          depleted: this.config.depleted,
        };

        // Calculate bounding box to position mesh correctly on ground
        // The model's pivot might be at center, so we need to offset it
        const bbox = new THREE.Box3().setFromObject(this.mesh);
        const minY = bbox.min.y;

        // Offset mesh so the bottom (minY) is at Y=0 (ground level)
        // Node position is already at terrain height, so mesh Y is relative to that
        this.mesh.position.set(0, -minY, 0);

        this.node.add(this.mesh);
        return;
      } catch (error) {
        // Log failure and fall through to placeholder
        console.warn(
          `Failed to load model for ${this.config.resourceType}:`,
          error,
        );
      }
    }

    // For fishing spots, create particle-based visual instead of placeholder
    if (this.config.resourceType === "fishing_spot") {
      this.createFishingSpotVisual();
      return;
    }

    // Create visible placeholder based on resource type
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;

    if (this.config.resourceType === "tree") {
      geometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
      material = new THREE.MeshStandardMaterial({ color: 0x8b4513 }); // Brown for tree
    } else {
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshStandardMaterial({ color: 0x808080 }); // Gray default
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `Resource_${this.config.resourceType}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = !this.config.depleted;

    // PERFORMANCE: Set placeholder to layer 1 (main camera only, not minimap)
    this.mesh.layers.set(1);

    // Set up userData for interaction detection (placeholder)
    this.mesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
    };

    // Scale for tree - use UNIFORM scale to prevent squishing
    if (this.config.resourceType === "tree") {
      this.mesh.scale.set(3, 3, 3);
    }

    this.node.add(this.mesh);
  }

  /**
   * Create animated visual for fishing spots.
   * Uses expanding ripple rings and a glowing indicator.
   * Different fishing methods have distinct visual variations.
   */
  private createFishingSpotVisual(): void {
    // Get variant-specific settings based on fishing type
    const variant = this.getFishingSpotVariant();
    this.fishingRippleSpeed = variant.rippleSpeed;

    // Create the glow indicator (interaction hitbox + distant visibility)
    this.createGlowIndicator();

    // Create animated ripple rings (animated via clientUpdate)
    this.createRippleRings(variant);

    // Create billboard particle effects (splash, bubble, shimmer)
    this.createFishingSpotParticles(variant);

    // Register for frame updates (ripples + particles)
    this.world.setHot(this, true);
  }

  /**
   * Get visual variant settings based on fishing spot type.
   * Net = calm/gentle, Bait = medium, Fly = more active.
   */
  private getFishingSpotVariant(): FishingSpotVariant {
    const resourceId = this.config.resourceId || "";

    if (resourceId.includes("net")) {
      // Calm, gentle ripples (shallow water fishing)
      return {
        color: 0x88ccff,
        rippleSpeed: 0.8,
        rippleCount: 2,
        splashCount: 4,
        bubbleCount: 3,
        shimmerCount: 3,
        splashColor: 0xddeeff,
        bubbleColor: 0x99ccee,
        shimmerColor: 0xeef4ff,
        burstIntervalMin: 5,
        burstIntervalMax: 10,
        burstSplashCount: 2,
      };
    } else if (resourceId.includes("fly")) {
      // More active (river/moving water)
      return {
        color: 0xaaddff,
        rippleSpeed: 1.5,
        rippleCount: 2,
        splashCount: 8,
        bubbleCount: 5,
        shimmerCount: 5,
        splashColor: 0xeef5ff,
        bubbleColor: 0xaaddee,
        shimmerColor: 0xf5faff,
        burstIntervalMin: 2,
        burstIntervalMax: 5,
        burstSplashCount: 4,
      };
    }
    // Default: bait (medium activity)
    return {
      color: 0x66bbff,
      rippleSpeed: 1.0,
      rippleCount: 2,
      splashCount: 5,
      bubbleCount: 4,
      shimmerCount: 4,
      splashColor: 0xddeeff,
      bubbleColor: 0x88ccee,
      shimmerColor: 0xeef4ff,
      burstIntervalMin: 3,
      burstIntervalMax: 7,
      burstSplashCount: 3,
    };
  }

  /**
   * Create expanding ripple ring meshes for water effect.
   */
  private createRippleRings(variant: {
    color: number;
    rippleCount: number;
  }): void {
    this.rippleRings = [];

    for (let i = 0; i < variant.rippleCount; i++) {
      const geometry = new THREE.CircleGeometry(0.5, 24);
      const tex = ResourceEntity.createRingTexture(
        variant.color,
        64,
        0.65,
        0.22,
      );
      const material = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });

      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2; // Horizontal
      ring.position.y = 0.1; // Just above water surface
      ring.name = `FishingSpotRipple_${i}`;

      this.node.add(ring);
      this.rippleRings.push(ring);
    }
  }

  /**
   * Create a DataTexture with a radial glow pattern and baked-in color.
   * WebGPU compatible — no material.color tinting needed.
   */
  private static createColoredGlowTexture(
    colorHex: number,
    size: number,
    sharpness: number,
  ): THREE.DataTexture {
    const key = `glow:${colorHex}:${size}:${sharpness}`;
    const cached = ResourceEntity.textureCache.get(key);
    if (cached) return cached;

    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist);
        const strength = Math.pow(falloff, sharpness);
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * strength);
        data[idx + 1] = Math.round(g * strength);
        data[idx + 2] = Math.round(b * strength);
        data[idx + 3] = Math.round(255 * strength);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    ResourceEntity.textureCache.set(key, tex);
    return tex;
  }

  /**
   * Create a DataTexture with a soft Gaussian ring pattern.
   * Used for natural-looking water ripples — transparent center, bright ring
   * band at `ringRadius`, transparent edges with smooth falloff.
   */
  private static createRingTexture(
    colorHex: number,
    size: number,
    ringRadius: number,
    ringWidth: number,
  ): THREE.DataTexture {
    const key = `ring:${colorHex}:${size}:${ringRadius}:${ringWidth}`;
    const cached = ResourceEntity.textureCache.get(key);
    if (cached) return cached;

    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Gaussian falloff around the ring radius
        const ringDist = Math.abs(dist - ringRadius) / ringWidth;
        const strength = Math.exp(-ringDist * ringDist * 4);

        // Soft fade at outer boundary
        const edgeFade = Math.min(Math.max((1 - dist) * 5, 0), 1);

        const alpha = strength * edgeFade;
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * alpha);
        data[idx + 1] = Math.round(g * alpha);
        data[idx + 2] = Math.round(b * alpha);
        data[idx + 3] = Math.round(255 * alpha);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    ResourceEntity.textureCache.set(key, tex);
    return tex;
  }

  /**
   * Create an additive-blended glow material with color baked into the texture.
   */
  private static createFishingGlowMaterial(
    colorHex: number,
    sharpness: number,
    initialOpacity: number,
  ): THREE.MeshBasicMaterial {
    const tex = ResourceEntity.createColoredGlowTexture(
      colorHex,
      64,
      sharpness,
    );

    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: initialOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
  }

  /** Get or create shared unit CircleGeometry for billboard particles */
  private static getFishingParticleGeometry(): THREE.CircleGeometry {
    if (!ResourceEntity.particleGeometry) {
      ResourceEntity.particleGeometry = new THREE.CircleGeometry(0.5, 16);
    }
    return ResourceEntity.particleGeometry;
  }

  /**
   * Create billboard particle effects for a fishing spot.
   * Three layers: splash droplets, bubbles, and surface shimmer.
   */
  private createFishingSpotParticles(variant: FishingSpotVariant): void {
    const scene = this.world.stage?.scene;
    if (!scene) return;

    const pos = this.getPosition();
    const worldX = pos.x;
    const worldY = pos.y;
    const worldZ = pos.z;

    const total =
      variant.splashCount + variant.bubbleCount + variant.shimmerCount;
    const types = new Uint8Array(total);
    const ages = new Float32Array(total);
    const lifetimes = new Float32Array(total);
    const angles = new Float32Array(total);
    const speeds = new Float32Array(total);
    const radii = new Float32Array(total);
    const directions = new Int8Array(total);
    const peakHeights = new Float32Array(total);

    const geomRef = ResourceEntity.getFishingParticleGeometry();
    let idx = 0;
    const splashStart = 0;

    const addParticle = (mat: THREE.MeshBasicMaterial): THREE.Mesh => {
      const particle = new THREE.Mesh(geomRef, mat);
      particle.renderOrder = 999;
      particle.frustumCulled = false;
      particle.layers.set(1);
      scene.add(particle);
      this.particleMeshes.push(particle);
      return particle;
    };

    // --- SPLASH: water droplets popping up in parabolic arcs ---
    for (let i = 0; i < variant.splashCount; i++, idx++) {
      types[idx] = FISHING_LAYER_SPLASH;
      lifetimes[idx] = 0.6 + Math.random() * 0.6;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.3 + Math.random() * 0.4;
      radii[idx] = 0.05 + Math.random() * 0.3;
      directions[idx] = Math.random() > 0.5 ? 1 : -1;
      peakHeights[idx] = 0.12 + Math.random() * 0.2;

      const mat = ResourceEntity.createFishingGlowMaterial(
        variant.splashColor,
        2.5,
        0.8,
      );
      const particle = addParticle(mat);
      particle.scale.set(
        FISHING_PARTICLE_SIZE,
        FISHING_PARTICLE_SIZE,
        FISHING_PARTICLE_SIZE,
      );
    }
    const splashEnd = idx;

    // --- BUBBLE: gentle rise from below water surface ---
    for (let i = 0; i < variant.bubbleCount; i++, idx++) {
      types[idx] = FISHING_LAYER_BUBBLE;
      lifetimes[idx] = 1.2 + Math.random() * 1.3;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.15 + Math.random() * 0.2;
      radii[idx] = 0.04 + Math.random() * 0.2;
      directions[idx] = Math.random() > 0.5 ? 1 : -1;
      peakHeights[idx] = 0.3 + Math.random() * 0.25;

      const mat = ResourceEntity.createFishingGlowMaterial(
        variant.bubbleColor,
        1.8,
        0.6,
      );
      const particle = addParticle(mat);
      particle.scale.set(
        FISHING_BUBBLE_SIZE,
        FISHING_BUBBLE_SIZE,
        FISHING_BUBBLE_SIZE,
      );
    }

    // --- SHIMMER: surface glints on the water plane ---
    for (let i = 0; i < variant.shimmerCount; i++, idx++) {
      types[idx] = FISHING_LAYER_SHIMMER;
      lifetimes[idx] = 1.5 + Math.random() * 1.5;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.1 + Math.random() * 0.15;
      radii[idx] = 0.15 + Math.random() * 0.45;
      directions[idx] = Math.random() > 0.5 ? 1 : -1;
      peakHeights[idx] = 0;

      const mat = ResourceEntity.createFishingGlowMaterial(
        variant.shimmerColor,
        3.5,
        0.7,
      );
      const particle = addParticle(mat);
      particle.scale.set(
        FISHING_PARTICLE_SIZE,
        FISHING_PARTICLE_SIZE,
        FISHING_PARTICLE_SIZE,
      );
    }

    this.particleState = {
      types,
      ages,
      lifetimes,
      angles,
      speeds,
      radii,
      directions,
      peakHeights,
      worldX,
      worldY,
      worldZ,
      burstTimer:
        variant.burstIntervalMin +
        Math.random() * (variant.burstIntervalMax - variant.burstIntervalMin),
      burstIntervalMin: variant.burstIntervalMin,
      burstIntervalMax: variant.burstIntervalMax,
      burstSplashCount: variant.burstSplashCount,
      splashStart,
      splashEnd,
    };
  }

  /**
   * Per-frame animation for fishing spot ripple rings and billboard particles.
   */
  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);
    const now = Date.now();

    // Animate ripple rings with per-ring position jitter
    if (this.rippleRings && this.rippleRings.length > 0) {
      const rippleCount = this.rippleRings.length;
      const cycleDuration = 2000 / this.fishingRippleSpeed;

      for (let i = 0; i < rippleCount; i++) {
        const ring = this.rippleRings[i];
        if (!ring) continue;

        const phase = (now / cycleDuration + i / rippleCount) % 1;

        // Uniform scale for all rings — consistent expansion
        const scale = 0.15 + phase * 1.3;
        ring.scale.set(scale, scale, 1);

        // Centered — no position jitter
        ring.position.x = 0;
        ring.position.z = 0;

        // Smooth fade in/out — brighter peak for visibility
        let opacity: number;
        if (phase < 0.15) {
          opacity = (phase / 0.15) * 0.55;
        } else {
          opacity = 0.55 * Math.pow(1 - (phase - 0.15) / 0.85, 1.5);
        }
        (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
      }
    }

    // Organic glow pulse — two frequencies layered for natural breathing
    if (this.glowMesh) {
      const slow = Math.sin(now * 0.0015) * 0.04;
      const fast = Math.sin(now * 0.004 + 1.3) * 0.02;
      const pulse = 0.18 + slow + fast;
      (this.glowMesh.material as THREE.MeshBasicMaterial).opacity = pulse;
    }

    // Animate fishing spot particles
    if (!this.particleState || this.particleMeshes.length === 0) return;

    const state = this.particleState;
    const {
      types,
      ages,
      lifetimes,
      angles,
      speeds,
      radii,
      directions,
      peakHeights,
      worldX,
      worldY,
      worldZ,
    } = state;
    const count = ages.length;
    const cam = this.world.camera;
    const camQuat = cam?.quaternion;

    // --- Fish activity burst system ---
    state.burstTimer -= deltaTime;
    if (state.burstTimer <= 0) {
      // Reset timer for next burst
      state.burstTimer =
        state.burstIntervalMin +
        Math.random() * (state.burstIntervalMax - state.burstIntervalMin);

      // Fire a cluster of splash particles simultaneously from a random point
      const burstAngle = Math.random() * Math.PI * 2;
      const burstR = 0.05 + Math.random() * 0.15;
      const burstCenterX = Math.cos(burstAngle) * burstR;
      const burstCenterZ = Math.sin(burstAngle) * burstR;
      let fired = 0;

      for (
        let i = state.splashStart;
        i < state.splashEnd && fired < state.burstSplashCount;
        i++
      ) {
        // Pick splash particles that are past 60% of their life (nearly done)
        if (ages[i] / lifetimes[i] > 0.6) {
          ages[i] = 0;
          // Cluster around burst center with slight spread
          const spread = 0.06;
          angles[i] = Math.atan2(
            burstCenterZ + (Math.random() - 0.5) * spread,
            burstCenterX + (Math.random() - 0.5) * spread,
          );
          radii[i] =
            Math.sqrt(
              burstCenterX * burstCenterX + burstCenterZ * burstCenterZ,
            ) +
            (Math.random() - 0.5) * 0.08;
          // Burst splashes are taller
          peakHeights[i] = 0.25 + Math.random() * 0.35;
          lifetimes[i] = 0.5 + Math.random() * 0.4;
          fired++;
        }
      }
    }

    for (let i = 0; i < count; i++) {
      ages[i] += deltaTime;
      const particle = this.particleMeshes[i];
      const mat = particle.material as THREE.MeshBasicMaterial;
      const layer = types[i];

      // Billboard: face the camera
      if (camQuat) {
        particle.quaternion.copy(camQuat);
      }

      // Respawn when lifetime expires
      if (ages[i] >= lifetimes[i]) {
        ages[i] -= lifetimes[i];
        angles[i] = Math.random() * Math.PI * 2;
        if (layer === FISHING_LAYER_SPLASH) {
          radii[i] = 0.05 + Math.random() * 0.3;
          peakHeights[i] = 0.12 + Math.random() * 0.2;
          lifetimes[i] = 0.6 + Math.random() * 0.6;
        } else if (layer === FISHING_LAYER_BUBBLE) {
          radii[i] = 0.04 + Math.random() * 0.2;
          peakHeights[i] = 0.3 + Math.random() * 0.25;
        }
      }

      const t = ages[i] / lifetimes[i];

      if (layer === FISHING_LAYER_SPLASH) {
        const arcY = peakHeights[i] * SPLASH_PARABOLIC_SCALE * t * (1 - t);
        const offsetX = Math.cos(angles[i]) * radii[i];
        const offsetZ = Math.sin(angles[i]) * radii[i];
        particle.position.set(
          worldX + offsetX,
          worldY + 0.08 + arcY,
          worldZ + offsetZ,
        );
        particle.scale.set(
          FISHING_PARTICLE_SIZE,
          FISHING_PARTICLE_SIZE,
          FISHING_PARTICLE_SIZE,
        );
        // Snappy pop-in, smooth fade as it arcs down
        const fadeIn = Math.min(t * SPLASH_FADE_IN_RATE, 1);
        const fadeOut = Math.pow(1 - t, 1.2);
        mat.opacity = 0.9 * fadeIn * fadeOut;
      } else if (layer === FISHING_LAYER_BUBBLE) {
        // Rise gently with wobbly lateral drift
        const riseY = t * peakHeights[i];
        const wobbleFreq = directions[i] * BUBBLE_WOBBLE_FREQ;
        const drift = Math.sin(angles[i] + t * wobbleFreq) * radii[i];
        const driftZ = Math.cos(angles[i] + t * 2.5) * radii[i] * 0.6;
        particle.position.set(
          worldX + drift,
          worldY + 0.03 + riseY,
          worldZ + driftZ,
        );
        particle.scale.set(
          FISHING_BUBBLE_SIZE,
          FISHING_BUBBLE_SIZE,
          FISHING_BUBBLE_SIZE,
        );
        const fadeIn = Math.min(t * 6, 1);
        const fadeOut = Math.pow(1 - t, 1.2);
        mat.opacity = 0.8 * fadeIn * fadeOut;
      } else {
        // Shimmer: sparkle on water surface with fast twinkle
        const wanderX =
          Math.cos(angles[i] + t * speeds[i] * directions[i] * 6) * radii[i];
        const wanderZ =
          Math.sin(angles[i] + t * speeds[i] * directions[i] * 6) * radii[i];
        particle.position.set(
          worldX + wanderX,
          worldY + 0.06,
          worldZ + wanderZ,
        );
        particle.scale.set(
          FISHING_PARTICLE_SIZE,
          FISHING_PARTICLE_SIZE,
          FISHING_PARTICLE_SIZE,
        );
        // Fast twinkle using global time for continuous sparkle
        const twinkle = Math.max(
          0,
          Math.sin(now * 0.008 + angles[i] * 5) *
            Math.sin(now * 0.013 + angles[i] * 3),
        );
        // Lifetime fade envelope
        const envelope = Math.min(t * 4, 1) * Math.min((1 - t) * 4, 1);
        mat.opacity = 0.85 * twinkle * envelope;
      }
    }
  }

  /**
   * Create subtle glow indicator visible from distance when particles aren't.
   */
  private createGlowIndicator(): void {
    const geometry = new THREE.CircleGeometry(0.6, 16);
    const tex = ResourceEntity.createColoredGlowTexture(0x55aaff, 64, 1.0);
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.glowMesh = new THREE.Mesh(geometry, material);
    this.glowMesh.rotation.x = -Math.PI / 2; // Horizontal
    this.glowMesh.position.y = 0.05; // Just above water
    this.glowMesh.name = "FishingSpotGlow";

    // Set up userData for interaction detection
    this.glowMesh.userData = {
      type: "resource",
      entityId: this.id,
      name: this.config.name,
      interactable: true,
      resourceType: this.config.resourceType,
      depleted: this.config.depleted,
    };

    this.node.add(this.glowMesh);
  }

  destroy(local?: boolean): void {
    // Unregister collision tiles (server-side only)
    if (this.world.isServer && this.collisionTiles.length > 0) {
      this.unregisterCollision();
    }

    // Clear respawn timer to prevent memory leaks
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = undefined;
    }

    // Unregister from frame updates (fishing spots use setHot for animation)
    if (this.rippleRings || this.particleMeshes.length > 0) {
      this.world.setHot(this, false);
    }

    // Clean up fishing spot particles (world-space billboard meshes)
    // Note: textures are not disposed here — they are shared via textureCache
    if (this.particleMeshes.length > 0) {
      const scene = this.world.stage?.scene;
      for (const mesh of this.particleMeshes) {
        if (scene) scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      this.particleMeshes = [];
      this.particleState = null;
    }

    // Clean up ripple rings (fishing spots, node-local)
    if (this.rippleRings) {
      for (const ring of this.rippleRings) {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.node.remove(ring);
      }
      this.rippleRings = undefined;
    }

    // Clean up glow mesh (fishing spots, node-local)
    if (this.glowMesh) {
      this.glowMesh.geometry.dispose();
      (this.glowMesh.material as THREE.Material).dispose();
      this.node.remove(this.glowMesh);
      this.glowMesh = undefined;
    }

    // Call parent destroy
    super.destroy(local);
  }
}
