/**
 * AtlasedTreeImpostors - Integration layer for tree LOD with atlased impostors
 *
 * Bridges ProcgenTreeInstancer with AtlasedImpostorManager for seamless
 * LOD transitions from mesh rendering to atlased impostors.
 *
 * @module AtlasedTreeImpostors
 *
 * @deprecated NOT CURRENTLY USED - This class is never instantiated. Tree impostors
 * are handled directly by ProcgenTreeInstancer using TSLImpostorMaterial.
 * This class exists for potential future refactoring but is not integrated
 * into the main rendering pipeline.
 */

import THREE from "../../../extras/three/three";
import type { World } from "../../../core/World";
import { AtlasedImpostorManager } from "../rendering/AtlasedImpostorManager";

// ============================================================================
// CONFIGURATION
// ============================================================================

export const ATLASED_TREE_CONFIG = {
  ENABLED: true,
  IMPOSTOR_DISTANCE: 120,
  IMPOSTOR_DISTANCE_SQ: 120 * 120,
  CULL_DISTANCE: 200,
  CULL_DISTANCE_SQ: 200 * 200,
} as const;

// ============================================================================
// TYPES
// ============================================================================

interface TrackedTree {
  id: string;
  presetId: string;
  position: THREE.Vector3;
  rotation: number;
  scale: number;
  isImpostor: boolean;
}

// ============================================================================
// ATLASED TREE IMPOSTORS
// ============================================================================

export class AtlasedTreeImpostors {
  private static instance: AtlasedTreeImpostors | null = null;

  private world: World;
  private atlasManager: AtlasedImpostorManager;
  private initialized = false;
  private trees = new Map<string, TrackedTree>();
  private pendingPresets = new Map<string, THREE.Object3D>();
  private readonly camPos = new THREE.Vector3();

  private stats = {
    treesTracked: 0,
    impostorsVisible: 0,
    presetsRegistered: 0,
  };

  private constructor(world: World) {
    this.world = world;
    this.atlasManager = AtlasedImpostorManager.getInstance(world);
  }

  static getInstance(world: World): AtlasedTreeImpostors {
    return (AtlasedTreeImpostors.instance ??= new AtlasedTreeImpostors(world));
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async init(): Promise<boolean> {
    if (this.initialized) return true;

    if (!(await this.atlasManager.init())) {
      console.warn(
        "[AtlasedTreeImpostors] Failed to init AtlasedImpostorManager",
      );
      return false;
    }

    // Register queued presets
    for (const [id, mesh] of this.pendingPresets) {
      await this.atlasManager.registerPreset(id, mesh);
    }
    this.pendingPresets.clear();

    this.initialized = true;
    console.log("[AtlasedTreeImpostors] Initialized");
    return true;
  }

  isEnabled(): boolean {
    return ATLASED_TREE_CONFIG.ENABLED && this.initialized;
  }

  // ============================================================================
  // PRESET MANAGEMENT
  // ============================================================================

  async registerPreset(
    presetId: string,
    sourceMesh: THREE.Object3D,
  ): Promise<void> {
    if (!this.initialized) {
      this.pendingPresets.set(presetId, sourceMesh);
      return;
    }
    await this.atlasManager.registerPreset(presetId, sourceMesh);
    this.stats.presetsRegistered++;
  }

  hasPreset(presetId: string): boolean {
    return (
      this.atlasManager.hasSlot(presetId) || this.pendingPresets.has(presetId)
    );
  }

  // ============================================================================
  // INSTANCE MANAGEMENT
  // ============================================================================

  trackTree(
    presetId: string,
    treeId: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
  ): void {
    if (this.trees.has(treeId)) return;
    this.trees.set(treeId, {
      id: treeId,
      presetId,
      position: position.clone(),
      rotation,
      scale,
      isImpostor: false,
    });
    this.stats.treesTracked++;
  }

  untrackTree(treeId: string): void {
    const tree = this.trees.get(treeId);
    if (!tree) return;

    if (tree.isImpostor) {
      this.atlasManager.removeInstance(treeId);
      this.stats.impostorsVisible--;
    }
    this.trees.delete(treeId);
    this.stats.treesTracked--;
  }

  showInstance(
    presetId: string,
    treeId: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
  ): boolean {
    if (!this.initialized) return false;

    if (!this.trees.has(treeId)) {
      this.trackTree(presetId, treeId, position, rotation, scale);
    }

    const tree = this.trees.get(treeId)!;
    if (tree.isImpostor) return true;

    if (
      this.atlasManager.addInstance(presetId, treeId, position, rotation, scale)
    ) {
      tree.isImpostor = true;
      this.stats.impostorsVisible++;
      return true;
    }
    return false;
  }

  hideInstance(treeId: string): void {
    const tree = this.trees.get(treeId);
    if (!tree?.isImpostor) return;

    this.atlasManager.removeInstance(treeId);
    tree.isImpostor = false;
    this.stats.impostorsVisible--;
  }

  updateInstance(
    treeId: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
  ): void {
    const tree = this.trees.get(treeId);
    if (!tree) return;

    tree.position.copy(position);
    tree.rotation = rotation;
    tree.scale = scale;

    if (tree.isImpostor) {
      this.atlasManager.removeInstance(treeId);
      this.atlasManager.addInstance(
        tree.presetId,
        treeId,
        position,
        rotation,
        scale,
      );
    }
  }

  // ============================================================================
  // UPDATE
  // ============================================================================

  // Lighting sync state
  private _lightDir = new THREE.Vector3(0.5, 0.8, 0.3);
  private _lightColor = new THREE.Vector3(1, 1, 1);
  private _ambientColor = new THREE.Vector3(0.5, 0.55, 0.65);
  private _lastLightUpdate = 0;
  private _lightingLoggedOnce = false;

  update(camera?: THREE.Camera): void {
    if (!this.initialized) return;
    const cam = camera ?? this.world.camera;
    if (!cam) return;

    cam.getWorldPosition(this.camPos);
    this.atlasManager.update(cam);
    this.syncLighting();
  }

  /**
   * Sync impostor lighting with scene's sun light.
   */
  private syncLighting(): void {
    const now = performance.now();
    // Only update lighting once per frame (~16ms)
    if (now - this._lastLightUpdate < 16) return;
    this._lastLightUpdate = now;

    // Get environment system for sun light and hemisphere light
    const env = this.world.getSystem("environment") as {
      sunLight?: THREE.DirectionalLight;
      lightDirection?: THREE.Vector3;
      hemisphereLight?: THREE.HemisphereLight;
    } | null;

    if (!env?.sunLight) {
      if (!this._lightingLoggedOnce) {
        console.warn(
          "[AtlasedTreeImpostors] No sunLight in environment - using default lighting",
        );
        this._lightingLoggedOnce = true;
      }
      return;
    }

    const sun = env.sunLight;
    // Light direction is negated (light goes FROM direction TO target)
    if (env.lightDirection) {
      this._lightDir.copy(env.lightDirection).negate();
    } else {
      this._lightDir.set(0.5, 0.8, 0.3);
    }

    // Scale light color by intensity
    this._lightColor.set(
      sun.color.r * sun.intensity,
      sun.color.g * sun.intensity,
      sun.color.b * sun.intensity,
    );

    // Get ambient from hemisphere light
    if (env.hemisphereLight) {
      const hemi = env.hemisphereLight;
      this._ambientColor.set(
        hemi.color.r * hemi.intensity * 0.5,
        hemi.color.g * hemi.intensity * 0.5,
        hemi.color.b * hemi.intensity * 0.5,
      );
    } else {
      this._ambientColor.set(0.5, 0.55, 0.65);
    }

    // Diagnostic: log once when lighting is connected
    if (!this._lightingLoggedOnce) {
      console.log(
        `[AtlasedTreeImpostors] Lighting connected: dir=(${this._lightDir.x.toFixed(2)}, ${this._lightDir.y.toFixed(2)}, ${this._lightDir.z.toFixed(2)}), ` +
          `color=(${this._lightColor.x.toFixed(2)}, ${this._lightColor.y.toFixed(2)}, ${this._lightColor.z.toFixed(2)}), ` +
          `ambient=(${this._ambientColor.x.toFixed(2)}, ${this._ambientColor.y.toFixed(2)}, ${this._ambientColor.z.toFixed(2)})`,
      );
      this._lightingLoggedOnce = true;
    }

    // Update atlased impostor manager lighting
    this.atlasManager.updateLighting(
      this._lightDir,
      this._lightColor,
      this._ambientColor,
    );
  }

  private getDistanceSq(position: THREE.Vector3): number {
    const dx = position.x - this.camPos.x;
    const dz = position.z - this.camPos.z;
    return dx * dx + dz * dz;
  }

  shouldBeImpostor(position: THREE.Vector3): boolean {
    const distSq = this.getDistanceSq(position);
    return (
      distSq >= ATLASED_TREE_CONFIG.IMPOSTOR_DISTANCE_SQ &&
      distSq < ATLASED_TREE_CONFIG.CULL_DISTANCE_SQ
    );
  }

  shouldBeCulled(position: THREE.Vector3): boolean {
    return this.getDistanceSq(position) >= ATLASED_TREE_CONFIG.CULL_DISTANCE_SQ;
  }

  // ============================================================================
  // AUTO LOD
  // ============================================================================

  updateLODForAllTrees(
    onShowMesh?: (treeId: string, presetId: string) => void,
    onHideMesh?: (treeId: string, presetId: string) => void,
  ): void {
    if (!this.initialized) return;

    for (const tree of this.trees.values()) {
      const cull = this.shouldBeCulled(tree.position);
      const impostor = !cull && this.shouldBeImpostor(tree.position);

      if (cull || impostor) {
        onHideMesh?.(tree.id, tree.presetId);
      }

      if (cull) {
        if (tree.isImpostor) this.hideInstance(tree.id);
      } else if (impostor) {
        if (!tree.isImpostor) {
          this.showInstance(
            tree.presetId,
            tree.id,
            tree.position,
            tree.rotation,
            tree.scale,
          );
        }
      } else {
        if (tree.isImpostor) this.hideInstance(tree.id);
        onShowMesh?.(tree.id, tree.presetId);
      }
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  getStats() {
    return { ...this.stats, atlasStats: this.atlasManager.getStats() };
  }

  dispose(): void {
    this.atlasManager.dispose();
    this.trees.clear();
    this.pendingPresets.clear();
    AtlasedTreeImpostors.instance = null;
    console.log("[AtlasedTreeImpostors] Disposed");
  }
}

export default AtlasedTreeImpostors;
