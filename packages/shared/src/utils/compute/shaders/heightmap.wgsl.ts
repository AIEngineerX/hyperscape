/**
 * Heightmap Generation Compute Shaders
 *
 * WGSL compute shaders for GPU-accelerated terrain heightmap generation.
 * Generates 64x64 or larger heightmaps in a single dispatch.
 *
 * ## Features
 * - 5-layer noise composition (continent, ridge, hill, erosion, detail)
 * - Island mask with natural coastline variation
 * - Biome-based height modifiers
 * - Color map generation (parallel to heightmap)
 *
 * ## Usage
 * 1. Upload permutation table and biome centers
 * 2. Set tile parameters (origin, resolution, spacing)
 * 3. Dispatch terrain generation shader
 * 4. Read back heightmap for physics/collision (async)
 * 5. Use heightmap directly for rendering (no read-back)
 */

import { WGSL_NOISE_FUNCTIONS } from "./noise.wgsl";

// ============================================================================
// HEIGHTMAP GENERATION STRUCTS
// ============================================================================

export const WGSL_HEIGHTMAP_STRUCTS = /* wgsl */ `
// Terrain tile generation parameters
struct HeightmapTileParams {
  // Tile origin in world space
  originX: f32,
  originZ: f32,
  // Tile dimensions
  resolution: u32,  // Grid resolution (e.g., 64 for 64x64)
  spacing: f32,     // Distance between vertices
  
  // Height parameters
  maxHeight: f32,
  waterLevel: f32,
  baseElevation: f32,
  _padding: f32,
  
  // Island parameters
  islandRadius: f32,
  islandFalloff: f32,
  islandCenterX: f32,
  islandCenterZ: f32,
}

// Biome colors (RGB, packed as vec4 with padding)
struct BiomeColors {
  plains: vec4<f32>,
  forest: vec4<f32>,
  mountains: vec4<f32>,
  desert: vec4<f32>,
  swamp: vec4<f32>,
  shore: vec4<f32>,
  water: vec4<f32>,
  snow: vec4<f32>,
}
`;

// ============================================================================
// HEIGHTMAP GENERATION SHADER
// ============================================================================

/**
 * Generates a heightmap tile using multi-layer noise composition.
 *
 * Bindings:
 * - 0: heightmap (storage, read_write) - Output heights
 * - 1: params (uniform) - Tile parameters
 * - 2: perm (uniform) - Permutation table for noise
 */
export const HEIGHTMAP_GENERATION_SHADER = /* wgsl */ `
${WGSL_NOISE_FUNCTIONS}
${WGSL_HEIGHTMAP_STRUCTS}

@group(0) @binding(0) var<storage, read_write> heightmap: array<f32>;
@group(0) @binding(1) var<uniform> params: HeightmapTileParams;
@group(0) @binding(2) var<uniform> perm: array<u32, 512>;

// Island mask with natural coastline variation
fn calculateIslandMask(worldX: f32, worldZ: f32) -> f32 {
  let dx = worldX - params.islandCenterX;
  let dz = worldZ - params.islandCenterZ;
  let distFromCenter = sqrt(dx * dx + dz * dz);
  
  // Natural coastline with noise variation
  let angle = atan2(dz, dx);
  let coastlineNoiseX = cos(angle) * 2.0;
  let coastlineNoiseZ = sin(angle) * 2.0;
  
  // Multi-octave coastline noise
  let coastNoise1 = fractal2D(coastlineNoiseX, coastlineNoiseZ, 3u, 0.5, 2.0, &perm);
  let coastNoise2 = fractal2D(coastlineNoiseX * 3.0, coastlineNoiseZ * 3.0, 2u, 0.5, 2.0, &perm);
  let coastNoise3 = simplex2D(coastlineNoiseX * 8.0, coastlineNoiseZ * 8.0, &perm);
  
  // Combine for natural variation (±30% of radius)
  let coastlineVariation = coastNoise1 * 0.2 + coastNoise2 * 0.08 + coastNoise3 * 0.02;
  let effectiveRadius = params.islandRadius * (1.0 + coastlineVariation);
  
  // Smooth island mask with smoothstep falloff
  var islandMask = 1.0;
  if (distFromCenter > effectiveRadius - params.islandFalloff) {
    let edgeDist = distFromCenter - (effectiveRadius - params.islandFalloff);
    let t = min(1.0, edgeDist / params.islandFalloff);
    let smoothstepVal = t * t * (3.0 - 2.0 * t);
    islandMask = 1.0 - smoothstepVal;
  }
  
  // Deep ocean outside island
  if (distFromCenter > effectiveRadius + 50.0) {
    islandMask = 0.0;
  }
  
  return islandMask;
}

// Generate terrain height at a world position
fn getTerrainHeight(worldX: f32, worldZ: f32) -> f32 {
  var height = 0.0;
  
  // Layer 1: Continent-scale (0.0008 scale)
  height += fractal2D(worldX * 0.0008, worldZ * 0.0008, 5u, 0.7, 2.0, &perm) * 0.35;
  
  // Layer 2: Ridge noise (0.003 scale)
  height += ridgeNoise2D(worldX * 0.003, worldZ * 0.003, &perm) * 0.15;
  
  // Layer 3: Hills (0.02 scale)
  height += fractal2D(worldX * 0.02, worldZ * 0.02, 4u, 0.6, 2.2, &perm) * 0.25;
  
  // Layer 4: Erosion (0.005 scale)
  height += erosionNoise2D(worldX * 0.005, worldZ * 0.005, 3u, &perm) * 0.1;
  
  // Layer 5: Detail (0.04 scale)
  height += fractal2D(worldX * 0.04, worldZ * 0.04, 2u, 0.3, 2.5, &perm) * 0.08;
  
  // Normalize to [0, 1]
  height = (height + 1.0) * 0.5;
  height = clamp(height, 0.0, 1.0);
  
  // Apply power curve
  height = pow(height, 1.1);
  
  // Apply island mask
  let islandMask = calculateIslandMask(worldX, worldZ);
  height = height * islandMask;
  
  // Apply base elevation
  height = height * 0.2 + params.baseElevation * islandMask;
  
  // Ocean floor for masked areas
  if (islandMask == 0.0) {
    height = 0.05;
  }
  
  return height * params.maxHeight;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let z = globalId.y;
  
  if (x >= params.resolution || z >= params.resolution) {
    return;
  }
  
  // Calculate world position
  let worldX = params.originX + f32(x) * params.spacing;
  let worldZ = params.originZ + f32(z) * params.spacing;
  
  // Generate height
  let height = getTerrainHeight(worldX, worldZ);
  
  // Store in heightmap
  let idx = z * params.resolution + x;
  heightmap[idx] = height;
}
`;

// ============================================================================
// HEIGHTMAP + COLORMAP SHADER
// ============================================================================

/**
 * Generates both heightmap and colormap in a single pass.
 * Colors are blended based on biome influences and height.
 */
export const HEIGHTMAP_COLOR_GENERATION_SHADER = /* wgsl */ `
${WGSL_NOISE_FUNCTIONS}
${WGSL_HEIGHTMAP_STRUCTS}

@group(0) @binding(0) var<storage, read_write> heightmap: array<f32>;
@group(0) @binding(1) var<storage, read_write> colormap: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: HeightmapTileParams;
@group(0) @binding(3) var<uniform> perm: array<u32, 512>;
@group(0) @binding(4) var<uniform> biomeColors: BiomeColors;

fn calculateIslandMask(worldX: f32, worldZ: f32) -> f32 {
  let dx = worldX - params.islandCenterX;
  let dz = worldZ - params.islandCenterZ;
  let distFromCenter = sqrt(dx * dx + dz * dz);
  
  let angle = atan2(dz, dx);
  let coastlineNoiseX = cos(angle) * 2.0;
  let coastlineNoiseZ = sin(angle) * 2.0;
  
  let coastNoise1 = fractal2D(coastlineNoiseX, coastlineNoiseZ, 3u, 0.5, 2.0, &perm);
  let coastNoise2 = fractal2D(coastlineNoiseX * 3.0, coastlineNoiseZ * 3.0, 2u, 0.5, 2.0, &perm);
  let coastNoise3 = simplex2D(coastlineNoiseX * 8.0, coastlineNoiseZ * 8.0, &perm);
  
  let coastlineVariation = coastNoise1 * 0.2 + coastNoise2 * 0.08 + coastNoise3 * 0.02;
  let effectiveRadius = params.islandRadius * (1.0 + coastlineVariation);
  
  var islandMask = 1.0;
  if (distFromCenter > effectiveRadius - params.islandFalloff) {
    let edgeDist = distFromCenter - (effectiveRadius - params.islandFalloff);
    let t = min(1.0, edgeDist / params.islandFalloff);
    islandMask = 1.0 - t * t * (3.0 - 2.0 * t);
  }
  
  if (distFromCenter > effectiveRadius + 50.0) {
    islandMask = 0.0;
  }
  
  return islandMask;
}

fn getTerrainHeight(worldX: f32, worldZ: f32) -> f32 {
  var height = 0.0;
  height += fractal2D(worldX * 0.0008, worldZ * 0.0008, 5u, 0.7, 2.0, &perm) * 0.35;
  height += ridgeNoise2D(worldX * 0.003, worldZ * 0.003, &perm) * 0.15;
  height += fractal2D(worldX * 0.02, worldZ * 0.02, 4u, 0.6, 2.2, &perm) * 0.25;
  height += erosionNoise2D(worldX * 0.005, worldZ * 0.005, 3u, &perm) * 0.1;
  height += fractal2D(worldX * 0.04, worldZ * 0.04, 2u, 0.3, 2.5, &perm) * 0.08;
  
  height = (height + 1.0) * 0.5;
  height = clamp(height, 0.0, 1.0);
  height = pow(height, 1.1);
  
  let islandMask = calculateIslandMask(worldX, worldZ);
  height = height * islandMask;
  height = height * 0.2 + params.baseElevation * islandMask;
  
  if (islandMask == 0.0) {
    height = 0.05;
  }
  
  return height * params.maxHeight;
}

// Determine terrain color based on height and position
fn getTerrainColor(worldX: f32, worldZ: f32, height: f32, normalizedHeight: f32) -> vec4<f32> {
  // Water
  if (height < params.waterLevel) {
    return biomeColors.water;
  }
  
  // Shore tint
  let shoreThreshold = params.waterLevel * 1.4;
  if (height < shoreThreshold) {
    let shoreFactor = 1.0 - (height - params.waterLevel) / (shoreThreshold - params.waterLevel);
    return mix(biomeColors.plains, biomeColors.shore, shoreFactor * 0.4);
  }
  
  // Height-based biome blending
  if (normalizedHeight > 0.7) {
    // Mountain/snow
    let snowFactor = (normalizedHeight - 0.7) / 0.3;
    return mix(biomeColors.mountains, biomeColors.snow, snowFactor);
  } else if (normalizedHeight > 0.4) {
    // Forest/mountain transition
    let mountainFactor = (normalizedHeight - 0.4) / 0.3;
    return mix(biomeColors.forest, biomeColors.mountains, mountainFactor);
  } else {
    // Plains/forest transition
    let forestFactor = normalizedHeight / 0.4;
    return mix(biomeColors.plains, biomeColors.forest, forestFactor);
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let z = globalId.y;
  
  if (x >= params.resolution || z >= params.resolution) {
    return;
  }
  
  let worldX = params.originX + f32(x) * params.spacing;
  let worldZ = params.originZ + f32(z) * params.spacing;
  
  let height = getTerrainHeight(worldX, worldZ);
  let normalizedHeight = height / params.maxHeight;
  
  let idx = z * params.resolution + x;
  heightmap[idx] = height;
  colormap[idx] = getTerrainColor(worldX, worldZ, height, normalizedHeight);
}
`;

// ============================================================================
// EXPORTS
// ============================================================================

export const HEIGHTMAP_SHADERS = {
  structs: WGSL_HEIGHTMAP_STRUCTS,
  generation: HEIGHTMAP_GENERATION_SHADER,
  generationWithColor: HEIGHTMAP_COLOR_GENERATION_SHADER,
} as const;
