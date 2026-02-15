/**
 * Flower Generator
 *
 * High-level API for creating flower fields with all components configured.
 * This is the main entry point for flower generation.
 *
 * @module FlowerGenerator
 */

import * as THREE from "three";

import type { FlowerConfig, FlowerBiomePreset } from "./types.js";
import {
  DEFAULT_FLOWER_CONFIG,
  FLOWER_BIOME_PRESETS,
  mergeFlowerConfig,
} from "./types.js";

import {
  createFlowerGeometry,
  generateFlowerPatch,
  attachFlowerInstanceAttributes,
  createProceduralPetalTexture,
  createMultiPetalTexture,
  type FlowerPatchOptions,
  type FlowerPatchResult,
} from "./FlowerGeometry.js";

import {
  createFlowerMaterial,
  createFlowerUniforms,
  updateFlowerTime,
  updateFlowerWind,
  updateFlowerColors,
  type FlowerMaterialOptions,
  type FlowerMaterialResult,
} from "./FlowerMaterialTSL.js";

/**
 * Options for generating a complete flower field
 */
export interface FlowerFieldOptions {
  /** Flower configuration (merged with defaults) */
  config?: Partial<FlowerConfig>;
  /** Random seed for deterministic generation */
  seed?: number;
  /** Material options */
  materialOptions?: FlowerMaterialOptions;
}

/**
 * Result of flower field generation
 */
export interface FlowerFieldResult {
  /** Instanced mesh with flowers */
  mesh: THREE.InstancedMesh;
  /** Material uniforms for animation */
  uniforms: ReturnType<typeof createFlowerUniforms>;
  /** The configuration used */
  config: FlowerConfig;
  /** Instance count */
  count: number;
  /** Update function for animation - call each frame with delta time */
  update: (deltaTime: number) => void;
  /** Dispose function to clean up resources */
  dispose: () => void;
}

/**
 * FlowerGenerator class for creating flower patches and fields
 *
 * This is a stateless utility class - all methods are static.
 * For runtime flower systems, see ProceduralFlowers in packages/shared.
 */
export class FlowerGenerator {
  private constructor() {} // Prevent instantiation

  /**
   * Generate a complete flower field
   *
   * Creates an instanced mesh ready to be added to a scene.
   *
   * @param options - Field generation options
   * @returns Complete flower field with mesh and update functions
   *
   * @example
   * ```ts
   * const field = FlowerGenerator.generateField({
   *   config: { density: 2000, tileSize: 30 },
   *   seed: 42,
   * });
   *
   * scene.add(field.mesh);
   *
   * // In animation loop:
   * field.update(deltaTime);
   *
   * // Cleanup:
   * field.dispose();
   * ```
   */
  static generateField(options: FlowerFieldOptions = {}): FlowerFieldResult {
    const config = mergeFlowerConfig(options.config ?? {});
    const seed = options.seed ?? Date.now();

    // Generate instance data
    const patchData = generateFlowerPatch({
      tileSize: config.tileSize,
      flowersPerSide: config.flowersPerSide,
      appearance: config.appearance,
      seed,
    });

    // Create geometry with instance attributes
    const geometry = createFlowerGeometry(
      config.appearance.width,
      config.appearance.height,
    );
    const instancedGeometry = attachFlowerInstanceAttributes(
      geometry,
      patchData,
    );

    // Create material
    const { material, uniforms } = createFlowerMaterial({
      config,
      ...options.materialOptions,
    });

    // Create instanced mesh
    const mesh = new THREE.InstancedMesh(
      instancedGeometry,
      material,
      patchData.count,
    );
    mesh.count = patchData.count;
    mesh.frustumCulled = false;
    mesh.name = "FlowerField";
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Animation state
    let elapsedTime = 0;

    // Update function
    const update = (deltaTime: number) => {
      elapsedTime += deltaTime;
      updateFlowerTime(uniforms, elapsedTime);
    };

    // Dispose function
    const dispose = () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };

    return {
      mesh,
      uniforms,
      config,
      count: patchData.count,
      update,
      dispose,
    };
  }

  /**
   * Generate flowers for a specific biome preset
   *
   * @param biomeName - Name of the biome preset
   * @param options - Additional options
   * @returns Flower field configured for the biome
   */
  static generateForBiome(
    biomeName: string,
    options: Omit<FlowerFieldOptions, "config"> = {},
  ): FlowerFieldResult {
    const preset = FLOWER_BIOME_PRESETS[biomeName.toLowerCase()];
    if (!preset) {
      console.warn(`Unknown biome "${biomeName}", using defaults`);
      return FlowerGenerator.generateField(options);
    }

    return FlowerGenerator.generateField({
      ...options,
      config: preset.config,
    });
  }

  /**
   * Create just the flower geometry
   */
  static createGeometry(width?: number, height?: number): THREE.PlaneGeometry {
    return createFlowerGeometry(width, height);
  }

  /**
   * Generate patch instance data without creating meshes
   *
   * Useful for custom rendering pipelines.
   */
  static generatePatchData(options?: FlowerPatchOptions): FlowerPatchResult {
    return generateFlowerPatch(options);
  }

  /**
   * Create flower material without geometry
   *
   * Useful for custom mesh creation.
   */
  static createMaterial(options?: FlowerMaterialOptions): FlowerMaterialResult {
    return createFlowerMaterial(options);
  }

  /**
   * Create a procedural petal texture
   *
   * @param size - Texture size (power of 2)
   */
  static createPetalTexture(size?: number): THREE.DataTexture {
    return createProceduralPetalTexture(size);
  }

  /**
   * Create a multi-petal flower texture
   *
   * @param size - Texture size
   * @param petalCount - Number of petals
   */
  static createMultiPetalTexture(
    size?: number,
    petalCount?: number,
  ): THREE.DataTexture {
    return createMultiPetalTexture(size, petalCount);
  }

  /**
   * Get all available biome presets
   */
  static getBiomePresets(): Record<string, FlowerBiomePreset> {
    return { ...FLOWER_BIOME_PRESETS };
  }

  /**
   * Get biome preset names
   */
  static getBiomePresetNames(): string[] {
    return Object.keys(FLOWER_BIOME_PRESETS);
  }

  /**
   * Merge partial config with defaults
   */
  static mergeConfig(partial: Partial<FlowerConfig>): FlowerConfig {
    return mergeFlowerConfig(partial);
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): FlowerConfig {
    return { ...DEFAULT_FLOWER_CONFIG };
  }
}

// Re-export commonly used utilities
export {
  createFlowerGeometry,
  generateFlowerPatch,
  attachFlowerInstanceAttributes,
  createProceduralPetalTexture,
  createMultiPetalTexture,
  createFlowerMaterial,
  createFlowerUniforms,
  updateFlowerTime,
  updateFlowerWind,
  updateFlowerColors,
};
