/**
 * Geometry generation for trees.
 */

export {
  generateLeafGeometry,
  generateSeparateLeafGeometry,
  // Instanced rendering (optimized)
  generateInstancedLeaves,
  generateInstancedLeavesAndBlossoms,
  createLeafCardGeometry,
  // NOTE: createInstancedLeafMaterial (GLSL) removed - use createInstancedLeafMaterialTSL instead
  type InstancedLeafResult,
  type InstancedLeafOptions,
  type ProceduralLeafShape,
} from "./LeafGeometry.js";

// TSL (WebGPU) instanced leaf material
export {
  createInstancedLeafMaterialTSL,
  type TSLInstancedLeafMaterial,
  type TSLInstancedLeafMaterialOptions,
  type TSLLeafShape,
} from "./LeafMaterialTSL.js";
export {
  generateBranchGeometry,
  generateBranchGeometryByDepth,
} from "./BranchGeometry.js";
export {
  getLeafShape,
  getBlossomShape,
  ALL_LEAF_SHAPES,
  ALL_BLOSSOM_SHAPES,
} from "./LeafShapes.js";
export {
  computeVertexAO,
  computeQuickVertexAO,
  enableVertexColorMaterials,
  type VertexAOOptions,
} from "./VertexAO.js";

// ============================================================================
// LEAF CARD CLUSTERS (AAA LOD Optimization)
// ============================================================================

export {
  LeafClusterGenerator,
  createClusterBillboardGeometry,
  createClusterTransforms,
  calculateClusterDensities,
  type LeafCluster,
  type LeafClusterResult,
  type LeafClusterOptions,
  type ClusterDensityInfo,
  type ClusterMaterialOptions,
} from "./LeafClusterGenerator.js";

export {
  LeafClusterBaker,
  // NOTE: createClusterAtlasMaterial removed - GLSL not WebGPU compatible
  // Use GlobalLeafClusterInstancer TSL material from ProcgenTreeInstancer instead
  type BakedCluster,
  type ClusterAtlas,
  type ClusterBakeOptions,
} from "./LeafClusterBaker.js";

// ============================================================================
// BRANCH-AWARE CLUSTERING (SpeedTree Style)
// ============================================================================

export {
  BranchClusterGenerator,
  type BranchLeafData,
  type BranchCluster,
  type BranchClusterResult,
  type BranchClusterOptions,
} from "./BranchClusterGenerator.js";

// NOTE: LeafClusterInstancer removed - GLSL not WebGPU compatible
// Use GlobalLeafClusterInstancer from packages/shared/src/systems/shared/world/ProcgenTreeInstancer.ts instead

// ============================================================================
// LEAF VISIBILITY CULLING (View-Dependent Optimization)
// ============================================================================

export {
  bakeLeafVisibility,
  createVisibilityBufferAttribute,
  visibilityMaskToString,
  type LeafVisibilityData,
  type LeafVisibilityBakeOptions,
  type LeafVisibilityBakeResult,
} from "./LeafVisibilityBaker.js";
