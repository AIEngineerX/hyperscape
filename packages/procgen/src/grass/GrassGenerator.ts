/**
 * Grass Generator
 *
 * High-level API for creating grass patches with all components configured.
 * This is the main entry point for grass generation.
 *
 * @module GrassGenerator
 */

import * as THREE from "three";

import type {
  GrassConfig,
  GrassBladeConfig,
  GrassBiomePreset,
} from "./types.js";
import {
  DEFAULT_GRASS_CONFIG,
  GRASS_BIOME_PRESETS,
  mergeGrassConfig,
} from "./types.js";

import {
  createGrassBladeGeometry,
  createGrassCardGeometry,
  generateGrassPatch,
  attachGrassInstanceAttributes,
  type GrassPatchOptions,
  type GrassPatchResult,
} from "./GrassGeometry.js";

import {
  createGrassMaterial,
  createGrassCardMaterial,
  createGrassUniforms,
  updateGrassTime,
  updateGrassWind,
  updateGrassColors,
  type GrassMaterialOptions,
  type GrassMaterialResult,
} from "./GrassMaterialTSL.js";

/**
 * Options for generating a complete grass field
 */
export interface GrassFieldOptions {
  /** Grass configuration (merged with defaults) */
  config?: Partial<GrassConfig>;
  /** Random seed for deterministic generation */
  seed?: number;
  /** Whether to include LOD1 cards */
  includeLOD1?: boolean;
  /** Material options */
  materialOptions?: GrassMaterialOptions;
}

/**
 * Result of grass field generation
 */
export interface GrassFieldResult {
  /** LOD0: Instanced mesh with individual blades */
  lod0Mesh: THREE.InstancedMesh;
  /** LOD0 material uniforms for animation */
  lod0Uniforms: ReturnType<typeof createGrassUniforms>;
  /** LOD1: Instanced mesh with grass cards (if includeLOD1=true) */
  lod1Mesh?: THREE.InstancedMesh;
  /** LOD1 material uniforms */
  lod1Uniforms?: ReturnType<typeof createGrassUniforms>;
  /** The configuration used */
  config: GrassConfig;
  /** Instance count for LOD0 */
  lod0Count: number;
  /** Instance count for LOD1 */
  lod1Count?: number;
  /** Update function for animation - call each frame with delta time */
  update: (deltaTime: number) => void;
  /** Dispose function to clean up resources */
  dispose: () => void;
}

/**
 * GrassGenerator class for creating grass patches and fields
 *
 * This is a stateless utility class - all methods are static.
 * For runtime grass systems, see ProceduralGrass in packages/shared.
 */
export class GrassGenerator {
  private constructor() {} // Prevent instantiation

  /**
   * Generate a complete grass field with LOD support
   *
   * Creates instanced meshes ready to be added to a scene.
   *
   * @param options - Field generation options
   * @returns Complete grass field with meshes and update functions
   *
   * @example
   * ```ts
   * const field = GrassGenerator.generateField({
   *   config: { density: 10, patchSize: 30 },
   *   seed: 42,
   * });
   *
   * scene.add(field.lod0Mesh);
   *
   * // In animation loop:
   * field.update(deltaTime);
   *
   * // Cleanup:
   * field.dispose();
   * ```
   */
  static generateField(options: GrassFieldOptions = {}): GrassFieldResult {
    const config = mergeGrassConfig(options.config ?? {});
    const seed = options.seed ?? Date.now();

    // Generate LOD0 (individual blades)
    const bladeGeometry = createGrassBladeGeometry(config.blade);
    const patchData = generateGrassPatch({
      blade: config.blade,
      density: config.density,
      patchSize: config.patchSize,
      seed,
    });

    const instancedGeometry = attachGrassInstanceAttributes(
      bladeGeometry,
      patchData,
    );
    const { material: lod0Material, uniforms: lod0Uniforms } =
      createGrassMaterial({
        config,
        ...options.materialOptions,
      });

    const lod0Mesh = new THREE.InstancedMesh(
      instancedGeometry,
      lod0Material,
      patchData.count,
    );
    lod0Mesh.count = patchData.count;
    lod0Mesh.frustumCulled = false;
    lod0Mesh.name = "GrassField_LOD0";

    // Optional LOD1 (grass cards)
    let lod1Mesh: THREE.InstancedMesh | undefined;
    let lod1Uniforms: ReturnType<typeof createGrassUniforms> | undefined;
    let lod1Count: number | undefined;

    if (options.includeLOD1) {
      const cardGeometry = createGrassCardGeometry();
      const lod1PatchData = generateGrassPatch({
        density: config.density * 0.5, // Fewer cards
        patchSize: config.patchSize * 2, // Larger area
        seed: seed + 1,
      });

      const lod1InstancedGeometry = attachGrassInstanceAttributes(
        cardGeometry,
        lod1PatchData,
      );
      const { material: cardMaterial, uniforms: cardUniforms } =
        createGrassCardMaterial({
          config,
        });

      lod1Mesh = new THREE.InstancedMesh(
        lod1InstancedGeometry,
        cardMaterial,
        lod1PatchData.count,
      );
      lod1Mesh.count = lod1PatchData.count;
      lod1Mesh.frustumCulled = false;
      lod1Mesh.name = "GrassField_LOD1";
      lod1Uniforms = cardUniforms;
      lod1Count = lod1PatchData.count;
    }

    // Animation state
    let elapsedTime = 0;

    // Update function
    const update = (deltaTime: number) => {
      elapsedTime += deltaTime;
      updateGrassTime(lod0Uniforms, elapsedTime);
      if (lod1Uniforms) {
        updateGrassTime(lod1Uniforms, elapsedTime);
      }
    };

    // Dispose function
    const dispose = () => {
      lod0Mesh.geometry.dispose();
      (lod0Mesh.material as THREE.Material).dispose();
      if (lod1Mesh) {
        lod1Mesh.geometry.dispose();
        (lod1Mesh.material as THREE.Material).dispose();
      }
    };

    return {
      lod0Mesh,
      lod0Uniforms,
      lod1Mesh,
      lod1Uniforms,
      config,
      lod0Count: patchData.count,
      lod1Count,
      update,
      dispose,
    };
  }

  /**
   * Generate grass for a specific biome preset
   *
   * @param biomeName - Name of the biome preset
   * @param options - Additional options
   * @returns Grass field configured for the biome
   */
  static generateForBiome(
    biomeName: string,
    options: Omit<GrassFieldOptions, "config"> = {},
  ): GrassFieldResult {
    const preset = GRASS_BIOME_PRESETS[biomeName.toLowerCase()];
    if (!preset) {
      console.warn(`Unknown biome "${biomeName}", using defaults`);
      return GrassGenerator.generateField(options);
    }

    return GrassGenerator.generateField({
      ...options,
      config: preset.config,
    });
  }

  /**
   * Create just the blade geometry
   *
   * Useful when you need custom material handling.
   */
  static createBladeGeometry(
    config?: Partial<GrassBladeConfig>,
  ): THREE.BufferGeometry {
    return createGrassBladeGeometry(config);
  }

  /**
   * Create just the card geometry for LOD1
   */
  static createCardGeometry(
    width?: number,
    height?: number,
  ): THREE.BufferGeometry {
    return createGrassCardGeometry(width, height);
  }

  /**
   * Generate patch instance data without creating meshes
   *
   * Useful for custom rendering pipelines.
   */
  static generatePatchData(options?: GrassPatchOptions): GrassPatchResult {
    return generateGrassPatch(options);
  }

  /**
   * Create grass material without geometry
   *
   * Useful for custom mesh creation.
   */
  static createMaterial(options?: GrassMaterialOptions): GrassMaterialResult {
    return createGrassMaterial(options);
  }

  /**
   * Get all available biome presets
   */
  static getBiomePresets(): Record<string, GrassBiomePreset> {
    return { ...GRASS_BIOME_PRESETS };
  }

  /**
   * Get biome preset names
   */
  static getBiomePresetNames(): string[] {
    return Object.keys(GRASS_BIOME_PRESETS);
  }

  /**
   * Merge partial config with defaults
   */
  static mergeConfig(partial: Partial<GrassConfig>): GrassConfig {
    return mergeGrassConfig(partial);
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): GrassConfig {
    return { ...DEFAULT_GRASS_CONFIG };
  }
}

// Re-export commonly used utilities
export {
  createGrassBladeGeometry,
  createGrassCardGeometry,
  generateGrassPatch,
  attachGrassInstanceAttributes,
  createGrassMaterial,
  createGrassCardMaterial,
  createGrassUniforms,
  updateGrassTime,
  updateGrassWind,
  updateGrassColors,
};
