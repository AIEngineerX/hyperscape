/**
 * Tree Generator
 *
 * High-level API for generating tree meshes.
 * Combines tree generation, geometry creation, and mesh building.
 */

import * as THREE from "three";
import { Tree } from "../core/Tree.js";
import type {
  TreeParams,
  TreeData,
  TreeGenerationOptions,
  GeometryOptions,
} from "../types.js";
import {
  generateTreeMesh,
  disposeTreeMesh,
  type TreeMeshOptions,
  type TreeMeshResult,
} from "./TreeMesh.js";
import { getPreset, QUAKING_ASPEN } from "../params/index.js";
import {
  exportToGLB,
  exportToGLBFile,
  type GLBExportOptions,
  type GLBExportResult,
} from "../export/index.js";

/**
 * Options for the tree generator.
 */
export type TreeGeneratorOptions = {
  /** Generation options */
  generation?: TreeGenerationOptions;
  /** Geometry options */
  geometry?: GeometryOptions;
  /** Mesh options */
  mesh?: Omit<TreeMeshOptions, "geometry">;
};

/**
 * High-level tree generator that combines generation and mesh creation.
 */
export class TreeGenerator {
  /** Current tree parameters */
  private params: TreeParams;

  /** Current generation options */
  private options: TreeGeneratorOptions;

  /** Last generated tree data */
  private lastTreeData: TreeData | null = null;

  /** Last generated mesh result */
  private lastMeshResult: TreeMeshResult | null = null;

  /**
   * Create a new tree generator.
   *
   * @param params - Tree parameters or preset name
   * @param options - Generator options
   */
  constructor(
    params: TreeParams | string = QUAKING_ASPEN,
    options: TreeGeneratorOptions = {},
  ) {
    this.params = typeof params === "string" ? getPreset(params) : params;
    this.options = options;
  }

  /**
   * Set tree parameters.
   *
   * @param params - Tree parameters or preset name
   */
  setParams(params: TreeParams | string): void {
    this.params = typeof params === "string" ? getPreset(params) : params;
  }

  /**
   * Get current tree parameters.
   */
  getParams(): TreeParams {
    return this.params;
  }

  /**
   * Set generator options.
   *
   * @param options - New options (merged with existing)
   */
  setOptions(options: Partial<TreeGeneratorOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      generation: { ...this.options.generation, ...options.generation },
      geometry: { ...this.options.geometry, ...options.geometry },
      mesh: { ...this.options.mesh, ...options.mesh },
    };
  }

  /**
   * Generate tree data without creating meshes.
   *
   * @param seed - Optional random seed (overrides options)
   * @returns Generated tree data
   */
  generateData(seed?: number): TreeData {
    const tree = new Tree(this.params, {
      ...this.options.generation,
      seed: seed ?? this.options.generation?.seed,
    });

    this.lastTreeData = tree.generate();
    return this.lastTreeData;
  }

  /**
   * Generate a complete tree mesh.
   *
   * @param seed - Optional random seed (overrides options)
   * @returns Tree mesh result
   */
  generate(seed?: number): TreeMeshResult {
    // Clean up previous result if exists
    if (this.lastMeshResult) {
      disposeTreeMesh(this.lastMeshResult);
    }

    // Generate tree data
    const data = this.generateData(seed);

    // Generate mesh
    this.lastMeshResult = generateTreeMesh(data, {
      ...this.options.mesh,
      geometry: this.options.geometry,
    });

    return this.lastMeshResult;
  }

  /**
   * Get the last generated tree data.
   */
  getLastTreeData(): TreeData | null {
    return this.lastTreeData;
  }

  /**
   * Get the last generated mesh result.
   */
  getLastMeshResult(): TreeMeshResult | null {
    return this.lastMeshResult;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.lastMeshResult) {
      disposeTreeMesh(this.lastMeshResult);
      this.lastMeshResult = null;
    }
    this.lastTreeData = null;
  }

  /**
   * Export the last generated tree to GLB format.
   *
   * @param options - Export options
   * @returns Promise resolving to export result
   * @throws Error if no tree has been generated
   */
  async exportToGLB(options: GLBExportOptions = {}): Promise<GLBExportResult> {
    if (!this.lastMeshResult) {
      throw new Error("No tree generated. Call generate() first.");
    }

    return exportToGLB(this.lastMeshResult.group, {
      filename: options.filename || "tree",
      ...options,
    });
  }

  /**
   * Export the last generated tree to a GLB file.
   *
   * @param outputPath - Full path to output file
   * @param options - Export options
   * @returns Promise resolving to export result
   * @throws Error if no tree has been generated
   */
  async exportToGLBFile(
    outputPath: string,
    options: Omit<GLBExportOptions, "download"> = {},
  ): Promise<GLBExportResult> {
    if (!this.lastMeshResult) {
      throw new Error("No tree generated. Call generate() first.");
    }

    return exportToGLBFile(this.lastMeshResult.group, outputPath, options);
  }

  /**
   * Generate a tree and immediately export it to GLB.
   *
   * @param seed - Optional random seed
   * @param options - Export options
   * @returns Promise resolving to export result
   */
  async generateAndExport(
    seed?: number,
    options: GLBExportOptions = {},
  ): Promise<{ mesh: TreeMeshResult; glb: GLBExportResult }> {
    const mesh = this.generate(seed);
    const glb = await this.exportToGLB(options);
    return { mesh, glb };
  }
}

/**
 * Generate a tree mesh with a single function call.
 *
 * @param params - Tree parameters or preset name
 * @param options - Generation options
 * @returns Tree mesh result
 */
export function generateTree(
  params: TreeParams | string = QUAKING_ASPEN,
  options: TreeGeneratorOptions = {},
): TreeMeshResult {
  const generator = new TreeGenerator(params, options);
  return generator.generate();
}

/**
 * Generate multiple variations of a tree with different seeds.
 *
 * @param params - Tree parameters or preset name
 * @param count - Number of variations to generate
 * @param startSeed - Starting seed (subsequent seeds are startSeed + 1, + 2, etc.)
 * @param options - Generation options
 * @returns Array of tree mesh results
 */
export function generateTreeVariations(
  params: TreeParams | string,
  count: number,
  startSeed = 0,
  options: TreeGeneratorOptions = {},
): TreeMeshResult[] {
  const results: TreeMeshResult[] = [];
  const resolvedParams =
    typeof params === "string" ? getPreset(params) : params;

  for (let i = 0; i < count; i++) {
    const generator = new TreeGenerator(resolvedParams, {
      ...options,
      generation: {
        ...options.generation,
        seed: startSeed + i,
      },
    });
    results.push(generator.generate());
  }

  return results;
}

/**
 * Generate a tree and add it to a scene.
 *
 * @param scene - Three.js scene to add the tree to
 * @param params - Tree parameters or preset name
 * @param position - Position for the tree (default: origin)
 * @param options - Generation options
 * @returns Tree mesh result
 */
export function addTreeToScene(
  scene: THREE.Scene | THREE.Group,
  params: TreeParams | string = QUAKING_ASPEN,
  position: THREE.Vector3 = new THREE.Vector3(),
  options: TreeGeneratorOptions = {},
): TreeMeshResult {
  const result = generateTree(params, options);
  result.group.position.copy(position);
  scene.add(result.group);
  return result;
}

/**
 * Export a tree mesh result to GLB format.
 *
 * @param result - Tree mesh result to export
 * @param options - Export options
 * @returns Promise resolving to export result
 */
export async function exportTreeToGLB(
  result: TreeMeshResult,
  options: GLBExportOptions = {},
): Promise<GLBExportResult> {
  return exportToGLB(result.group, {
    filename: options.filename || "tree",
    ...options,
  });
}

/**
 * Export a tree mesh result to a GLB file.
 *
 * @param result - Tree mesh result to export
 * @param outputPath - Full path to output file
 * @param options - Export options
 * @returns Promise resolving to export result
 */
export async function exportTreeToGLBFile(
  result: TreeMeshResult,
  outputPath: string,
  options: Omit<GLBExportOptions, "download"> = {},
): Promise<GLBExportResult> {
  return exportToGLBFile(result.group, outputPath, options);
}

/**
 * Generate a tree and export it directly to GLB.
 *
 * @param params - Tree parameters or preset name
 * @param options - Generator and export options
 * @returns Promise resolving to mesh result and GLB data
 */
export async function generateAndExportTree(
  params: TreeParams | string = QUAKING_ASPEN,
  options: TreeGeneratorOptions & GLBExportOptions = {},
): Promise<{ mesh: TreeMeshResult; glb: GLBExportResult }> {
  const mesh = generateTree(params, options);
  const glb = await exportToGLB(mesh.group, {
    filename: options.filename || "tree",
    download: options.download,
    bakeTransforms: options.bakeTransforms,
    forceIndexedGeometry: options.forceIndexedGeometry,
  });
  return { mesh, glb };
}

// Re-export GLB types for convenience
export type { GLBExportOptions, GLBExportResult };
