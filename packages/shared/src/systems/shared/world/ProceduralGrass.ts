// @ts-nocheck -- TSL type definitions are incomplete for compute shaders and Fn() callbacks
/**
 * TypeScript checking disabled due to fundamental @types/three TSL limitations:
 *
 * 1. **Fn() callback signatures**: TSL's Fn() uses array destructuring `([a, b]) => {}`
 *    which @types/three interprets as NodeBuilder iterator access
 *
 * 2. **Fn() call arity**: Fn() returns ShaderNodeFn<[ProxiedObject<...>]> expecting 1 arg,
 *    but runtime API uses spread args: `this.setScale(data, value)` vs `this.setScale([data, value])`
 *
 * 3. **Node type narrowing**: Reassigning variables changes types (ConstNode → MathNode)
 *    which TS incorrectly flags: `let x = float(0); x = x.add(1);` // MathNode not assignable to ConstNode
 *
 * 4. **Compute shader API**: `.compute()` method exists at runtime but not in @types/three
 *
 * 5. **Loop() callback types**: Loop expects `(inputs: { i: number })` but TSL passes `{ i: Node }`
 *
 * These are upstream @types/three issues. Fixes require either:
 * - Upstream type definition improvements
 * - A TSL type wrapper library
 * - Runtime-accurate type overrides
 *
 * The code is correct and tested - only the static types are incompatible.
 */

/**
 * ProceduralGrass.ts - GPU Grass System
 *
 * Key architecture:
 * - SpriteNodeMaterial for billboard grass
 * - Two-buffer SSBO (vec4 + float) with bit-packed data
 * - Visibility NOT used for opacity/scale (only for offscreen culling)
 * - Wind stored as vec2 displacement
 * - Heightmap Y offset integration with terrain system
 *
 * **PERFORMANCE OPTIMIZATIONS:**
 * - Heightmap generation uses chunked async processing (no main thread blocking)
 * - Compute shaders pre-initialized during load (no first-frame spike)
 * - All heavy work done before gameplay starts
 *
 * **RELATED MODULES:**
 * - For standalone grass generation (Asset Forge, viewers), see @hyperscape/procgen GrassGen module
 * - GrassGen provides simpler grass geometry/materials without SSBO compute integration
 *
 * @module ProceduralGrass
 */

import THREE, {
  uniform,
  Fn,
  float,
  vec3,
  vec4,
  vec2,
  vertexColor,
  sin,
  cos,
  mix,
  uv,
  floor,
  instanceIndex,
  hash,
  smoothstep,
  clamp,
  remap,
  instancedArray,
  texture,
  fract,
  time,
  max,
  min,
  step,
  normalize,
  dot,
  sqrt,
  viewportCoordinate,
  mod,
  abs,
  add,
  sub,
  mul,
  div,
  select,
  length,
  positionLocal,
  Loop,
} from "../../../extras/three/three";
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from "three/webgpu";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { tslUtils } from "../../../utils/TSLUtils";
import { windManager } from "./Wind";
import { VegetationSsboUtils } from "./VegetationSsboUtils";
import { getNoiseTexture, generateNoiseTexture } from "./TerrainShader";
import {
  clearRoadInfluenceTexture as clearRoadInfluenceMask,
  getRoadInfluenceThreshold as getRoadInfluenceMaskThreshold,
  getRoadInfluenceTexture as getRoadInfluenceMaskTexture,
  getRoadInfluenceTextureState,
  setRoadInfluenceTextureData,
  setRoadInfluenceThreshold as setRoadInfluenceMaskThreshold,
} from "./RoadInfluenceMask";
import {
  GrassGenerator,
  createGrassClumpGeometry,
  type GrassFieldResult,
} from "@hyperscape/procgen/grass";
import {
  GrassExclusionGrid,
  getGrassExclusionGrid,
  disposeGrassExclusionGrid,
} from "./GrassExclusionGrid";
import {
  CharacterInfluenceManager,
  getCharacterInfluenceManager,
  disposeCharacterInfluenceManager,
} from "./CharacterInfluenceManager";

// ============================================================================
// ASYNC UTILITIES - Non-blocking main thread helpers
// ============================================================================

/**
 * Yield to browser event loop - allows rendering and input processing
 * Uses requestIdleCallback when available for better scheduling
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 16 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Check if we should yield based on elapsed time
 * @param startTime - Performance.now() timestamp when work started
 * @param budgetMs - Maximum milliseconds before yielding (default 8ms for 60fps)
 */
function shouldYield(startTime: number, budgetMs = 8): boolean {
  return performance.now() - startTime > budgetMs;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// LOD0: Individual grass blades (near player)
const getConfig = () => {
  const BLADE_WIDTH = 0.08;
  const BLADE_HEIGHT = 0.25;
  const TILE_SIZE = 16; // 8m radius
  const BLADES_PER_SIDE = 408; // ~166k blades (2x thicker near grass)

  return {
    BLADE_WIDTH,
    BLADE_HEIGHT,
    BLADE_BOUNDING_SPHERE_RADIUS: BLADE_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    BLADES_PER_SIDE,
    COUNT: BLADES_PER_SIDE * BLADES_PER_SIDE,
    SPACING: TILE_SIZE / BLADES_PER_SIDE,
    WORKGROUP_SIZE: 256,
    SEGMENTS: 4,
  };
};

const config = getConfig();

/** Quality presets for different devices */
export enum GrassQuality {
  LOW = "low", // Mobile: ~40K blades, 20m range
  MEDIUM = "medium", // Tablet: ~78K blades, 25m range
  HIGH = "high", // Desktop: ~166K blades, full range
}

const QUALITY_PRESETS: Record<
  GrassQuality,
  { bladesPerSide: number; tileSize: number; segments: number }
> = {
  [GrassQuality.LOW]: { bladesPerSide: 200, tileSize: 10, segments: 2 },
  [GrassQuality.MEDIUM]: { bladesPerSide: 280, tileSize: 12, segments: 3 },
  [GrassQuality.HIGH]: { bladesPerSide: 408, tileSize: 16, segments: 4 },
};

// Grass tile settings (matches procgen viewer defaults)
// LOD TRANSITION DIAGRAM (complementary dither crossfade):
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  LOD0 (blades)    ████████████████████░░░░░░                            │
// │                   0m                 10m   13m                          │
// │                                                                         │
// │  LOD1 (tiles)           ░░░░░░░░████████████████████████████████░░░░░░  │
// │                         8m    13m                              40m  50m │
// └─────────────────────────────────────────────────────────────────────────┘
// ░ = heavy dither fade zone, █ = full visibility
// LOD1 fade-in (8-13m) overlaps LOD0 fade-out (10-13m) for seamless crossfade
const GRASS_TILE_SETTINGS = {
  TILE_SIZE: 1.0,
  DENSITY: 64, // Reduced from 128 for perf
  BLADE_HEIGHT: 0.25,
  BLADE_WIDTH: 0.08,
  BLADE_SEGMENTS: 3, // Reduced from 4
  BLADE_TIP_TAPER: 0.3,
  CLUMP_BLADE_COUNT: 4, // Reduced from 5
  CLUMP_SEGMENTS: 3, // Reduced from 4
  CLUMP_CURVATURE: 0.25,
  CLUMP_SPREAD: 0.02,
  CLUMP_HEIGHT_VARIATION: 0.3,
  CLUMP_WIDTH_VARIATION: 0.2,
  // LOD0 (blade grass): 0-13m, fade 10-13m
  LOD0_FADE_START: 10,
  LOD0_FADE_END: 13,
  // LOD1 (instanced tiles): 8-50m
  // Fade in 8-13m overlaps with LOD0 fade-out for seamless crossfade
  LOD1_FADE_IN_START: 8,
  LOD1_FADE_IN_END: 13,
  LOD1_FADE_OUT_START: 40,
  LOD1_FADE_OUT_END: 50,
  // Grid sizes
  FIELD_MIN_GRID_SIZE: 40,
  FIELD_MAX_GRID_SIZE: 140,
  LOD1_SPACING: 0.8, // Increased from 0.5 for fewer tiles
  // Heavy dither for visible effect
  LOD1_DITHER_STRENGTH: 0.6, // Increased from 0.15 for heavy dither effect
  SEED: 1337,
  // Frustum culling - cos(half_angle + margin)
  // For 60° FOV: half_angle=30°, with 15° margin = 45°, cos(45°) ≈ 0.707
  // Using 0.5 gives ~60° half-angle (wider margin for grass at edges)
  FRUSTUM_COS_THRESHOLD: 0.5,
} as const;

// ============================================================================
// SHARED EXCLUSION UV HELPER - Computes UV from world position + center + worldSize
// ============================================================================
// Reduces code duplication across compute shader and GPU LOD1 tile material

const computeExclusionUV = Fn(
  ([
    worldX = float(0),
    worldZ = float(0),
    centerX = float(0),
    centerZ = float(0),
    worldSize = float(0),
  ]) => {
    const halfWorld = worldSize.mul(0.5);
    const uvX = worldX.sub(centerX).add(halfWorld).div(worldSize);
    const uvZ = worldZ.sub(centerZ).add(halfWorld).div(worldSize);
    return vec2(uvX.clamp(0.001, 0.999), uvZ.clamp(0.001, 0.999));
  },
);

// ============================================================================
// BAYER DITHER TEXTURE - 4x4 pattern for efficient GPU lookup
// ============================================================================
// Using texture lookup instead of 16 nested select() statements
// Bayer 4x4 pattern normalized to 0-1:
// [  0/16,  8/16,  2/16, 10/16 ]
// [ 12/16,  4/16, 14/16,  6/16 ]
// [  3/16, 11/16,  1/16,  9/16 ]
// [ 15/16,  7/16, 13/16,  5/16 ]

const bayerData = new Float32Array([
  0 / 16,
  8 / 16,
  2 / 16,
  10 / 16,
  12 / 16,
  4 / 16,
  14 / 16,
  6 / 16,
  3 / 16,
  11 / 16,
  1 / 16,
  9 / 16,
  15 / 16,
  7 / 16,
  13 / 16,
  5 / 16,
]);
const bayerTexture = new THREE.DataTexture(
  bayerData,
  4,
  4,
  THREE.RedFormat,
  THREE.FloatType,
);
bayerTexture.wrapS = THREE.RepeatWrapping;
bayerTexture.wrapT = THREE.RepeatWrapping;
bayerTexture.minFilter = THREE.NearestFilter;
bayerTexture.magFilter = THREE.NearestFilter;
bayerTexture.needsUpdate = true;
const bayerTextureNode = texture(bayerTexture);

// ============================================================================
// GPU-DRIVEN TILE UNIFORMS (LOD1)
// ============================================================================

const tileUniforms = {
  // Camera data
  uTileCameraPos: uniform(new THREE.Vector3(0, 0, 0)),
  uTileCameraForward: uniform(new THREE.Vector3(0, 0, 1)),
  // Grid parameters
  uTileGridSize: uniform(80), // tiles per side
  uTileSpacing: uniform(0.8), // meters between tiles
  // LOD1 fade distances
  uLod1FadeInStart: uniform(GRASS_TILE_SETTINGS.LOD1_FADE_IN_START),
  uLod1FadeInEnd: uniform(GRASS_TILE_SETTINGS.LOD1_FADE_IN_END),
  uLod1FadeOutStart: uniform(GRASS_TILE_SETTINGS.LOD1_FADE_OUT_START),
  uLod1FadeOutEnd: uniform(GRASS_TILE_SETTINGS.LOD1_FADE_OUT_END),
  // Dither strength
  uLod1DitherStrength: uniform(GRASS_TILE_SETTINGS.LOD1_DITHER_STRENGTH),
  // Tile height
  uTileHeight: uniform(0.25),
  // Frustum threshold (cos of half-angle)
  // 0.5 = cos(60°), culls tiles > 60° from view direction
  // Previous -0.3 = cos(107°) was nearly useless (only culled behind camera)
  uFrustumThreshold: uniform(GRASS_TILE_SETTINGS.FRUSTUM_COS_THRESHOLD),
  // Day/night tint (own uniforms — synced from main uniforms in updateUniforms)
  uTileDayColor: uniform(new THREE.Color().setRGB(0.859, 0.82, 0.82)),
  uTileNightColor: uniform(new THREE.Color().setRGB(0.188, 0.231, 0.271)),
  uTileDayNightMix: uniform(1.0),
};

// ============================================================================
// UNIFORMS
// ============================================================================

const uniforms = {
  uPlayerPosition: uniform(new THREE.Vector3(0, 0, 0)), // For trail effect only
  uCameraPosition: uniform(new THREE.Vector3(0, 0, 0)), // For distance culling
  uCameraMatrix: uniform(new THREE.Matrix4()),
  uPlayerDeltaXZ: uniform(new THREE.Vector2(0, 0)),
  uCameraForward: uniform(new THREE.Vector3(0, 0, 1)),
  // Scale
  uBladeMinScale: uniform(0.3),
  uBladeMaxScale: uniform(0.8),
  // Trail - Player grass distortion (0.7m diameter = 0.35m radius)
  uTrailGrowthRate: uniform(0.1), // How fast grass recovers (slower = longer trails)
  uTrailMinScale: uniform(0.1), // Grass flattens to 10% when stepped (very flat)
  uTrailRadius: uniform(0.6),
  uTrailRadiusSquared: uniform(0.6 * 0.6),
  uKDown: uniform(0.6), // Crushing speed (higher = instant flatten)
  // Wind - noise-based natural movement
  uWindStrength: uniform(0.6), // Strong visible wind effect
  uWindSpeed: uniform(0.5), // Dynamic motion speed
  uvWindScale: uniform(1.5), // Scale of wind patterns
  // Color - MATCHES TERRAIN SHADER EXACTLY
  // TerrainShader.ts: grassGreen = vec3(0.3, 0.55, 0.15), grassDark = vec3(0.22, 0.42, 0.1)
  // Use blend of these for base, tips are 10% lighter
  uBaseColor: uniform(new THREE.Color().setRGB(0.26, 0.48, 0.12)), // Matches terrain grass
  uTipColor: uniform(new THREE.Color().setRGB(0.29, 0.53, 0.14)), // 10% lighter tips
  uAoScale: uniform(0.5), // Subtle AO
  uAoRimSmoothness: uniform(5),
  uAoRadius: uniform(25),
  uAoRadiusSquared: uniform(25 * 25),
  uColorMixFactor: uniform(0.85), // Strong base-to-tip gradient
  uColorVariationStrength: uniform(1.5), // Moderate variation
  uWindColorStrength: uniform(0.6),
  uBaseWindShade: uniform(0.5), // Wind darkening
  uBaseShadeHeight: uniform(1.0),
  // Stochastic distance culling - extends grass rendering distance
  // Works WITH fade: grass gradually thins AND fades at the same time
  uR0: uniform(10), // Full density within 10m
  uR1: uniform(13), // Thin to minimum by 13m (3m transition zone)
  uPMin: uniform(0.2), // Heavy dither at edge for visible effect
  // Distance fade - overlaps with stochastic culling for natural falloff
  // Matches LOD1 fade-in (8-13m) for seamless crossfade
  uFadeStart: uniform(10), // Start fading at 10m
  uFadeEnd: uniform(13), // Fully faded by 13m
  // Camera forward bias - extends grass in view direction
  uForwardBias: uniform(15), // More grass in front of camera
  // Rotation
  uBaseBending: uniform(2.0),
  // Bottom fade - dither grass base into ground (0.3 UV = 0.15m on 0.5m blade)
  uBottomFadeHeight: uniform(0.3),
  // Day/Night colors - direct control, lerped by uDayNightMix
  // Day/night tint colors (#DBD1D1 day, #303B45 night)
  uDayColor: uniform(new THREE.Color().setRGB(0.859, 0.82, 0.82)), // #DBD1D1
  uNightColor: uniform(new THREE.Color().setRGB(0.188, 0.231, 0.271)), // #303B45
  uDayNightMix: uniform(1.0), // 1.0 = day, 0.0 = night (set by Environment)
  // Sun direction for terrain-based lighting (normalized, from Environment)
  uSunDirection: uniform(new THREE.Vector3(0.5, 0.7, 0.5).normalize()),
  // Terrain-based lighting parameters
  uTerrainLightAmbient: uniform(0.4), // Minimum ambient light
  uTerrainLightDiffuse: uniform(0.6), // Diffuse contribution
  // Light intensity (shared with LOD1)
  uLightIntensity: uniform(1.0),
  uAmbientIntensity: uniform(0.4),
};

// Noise texture for wind and position variation
let noiseAtlasTexture: THREE.Texture | null = null;

// Heightmap texture for terrain Y offset
let heightmapTexture: THREE.DataTexture | null = null;
let _heightmapMax = 100;

// ============================================================================
// STREAMING HEIGHTMAP CONFIG
// ============================================================================

/**
 * Streaming heightmap configuration.
 * The heightmap follows the player and updates incrementally as terrain loads.
 */
const HEIGHTMAP_CONFIG = {
  /** Texture resolution (power of 2) */
  SIZE: 512,
  /** World size covered by heightmap in meters */
  WORLD_SIZE: 400, // 400m coverage (200m radius around player)
  /** Maximum terrain height for normalization */
  MAX_HEIGHT: 100,
  /** Distance player must move before re-centering heightmap */
  RECENTER_THRESHOLD: 50, // Re-center when player moves 50m from center
  /** Meters per pixel */
  get METERS_PER_PIXEL() {
    return this.WORLD_SIZE / this.SIZE;
  },
} as const;

// ============================================================================
// GRASS SSBO - Three-buffer structure
// ============================================================================
// Buffer1 (vec4):
//   x -> offsetX (local to player)
//   y -> offsetZ (local to player)
//   z -> 0/12 windX - 12/12 windZ
//   w -> 0/8 current scale - 8/8 original scale - 16/1 shadow - 17/1 visibility - 18/6 wind noise factor
//
// Buffer2 (float):
//   0/4 position based noise
//
// Buffer3 (float): HYPERSCAPE ADDITION
//   heightmapY - terrain height at this blade's world position

type InstancedArrayBuffer = ReturnType<typeof instancedArray>;

// Heightmap texture node for compute shader
let heightmapTextureNode: ReturnType<typeof texture> | null = null;
const uHeightmapMax = uniform(100);
const uHeightmapWorldSize = uniform(HEIGHTMAP_CONFIG.WORLD_SIZE);
// Heightmap center position (for streaming heightmap that follows player)
const uHeightmapCenterX = uniform(0);
const uHeightmapCenterZ = uniform(0);

// ============================================================================
// HEIGHTMAP EXPORTS - For flowers and other vegetation systems
// ============================================================================

/**
 * Get the grass heightmap texture node.
 * Flowers and other vegetation should use this instead of VegetationSsboUtils.
 */
export function getGrassHeightmapTextureNode(): ReturnType<
  typeof texture
> | null {
  return heightmapTextureNode;
}

/**
 * Get the grass heightmap uniforms for UV calculation.
 * Use these with the same UV formula as grass for consistent terrain placement.
 */
export function getGrassHeightmapUniforms() {
  return {
    uHeightmapMax,
    uHeightmapWorldSize,
    uHeightmapCenterX,
    uHeightmapCenterZ,
  };
}

// ============================================================================
// EXCLUSION EXPORTS - For flowers and other vegetation systems
// ============================================================================

/**
 * Get the legacy exclusion texture node and uniforms.
 * Used for building/duel arena exclusion.
 */
export function getGrassExclusionTexture() {
  return {
    textureNode: exclusionTextureNode,
    uWorldSize: uExclusionWorldSize,
    uCenterX: uExclusionCenterX,
    uCenterZ: uExclusionCenterZ,
  };
}

/**
 * Get the grid-based exclusion texture node and uniforms.
 * Used for CollisionMatrix-based exclusion (buildings, blocked tiles).
 */
export function getGrassGridExclusionTexture() {
  return {
    textureNode: gridExclusionTextureNode,
    uWorldSize: uGridExclusionWorldSize,
    uCenterX: uGridExclusionCenterX,
    uCenterZ: uGridExclusionCenterZ,
    isEnabled: useGridBasedExclusion,
  };
}

// Road influence texture state (shared across terrain/grass/flowers)
const roadInfluenceState = getRoadInfluenceTextureState();
const roadInfluenceTextureNode = roadInfluenceState.textureNode;
const uRoadInfluenceWorldSize = roadInfluenceState.uWorldSize;
const uRoadInfluenceCenterX = roadInfluenceState.uCenterX;
const uRoadInfluenceCenterZ = roadInfluenceState.uCenterZ;
const uRoadInfluenceThreshold = roadInfluenceState.uThreshold;

/**
 * Get road influence texture and uniforms for use by other vegetation systems (flowers).
 * Allows consistent road exclusion across all vegetation types.
 */
export function getGrassRoadInfluenceTexture() {
  return roadInfluenceState;
}

/**
 * Get grass culling/fade uniforms for use by other vegetation systems (flowers).
 * Using the SAME uniforms ensures flowers fade identically with grass.
 */
export function getGrassCullingUniforms() {
  return {
    uR0: uniforms.uR0, // Full density radius (23m)
    uR1: uniforms.uR1, // Thin to minimum radius (29m)
    uPMin: uniforms.uPMin, // Minimum density at outer edge
    uFadeStart: uniforms.uFadeStart, // Bayer dither start (29m)
    uFadeEnd: uniforms.uFadeEnd, // Bayer dither end (33m)
  };
}

// ============================================================================
// EXCLUSION TEXTURE - GPU-computed from blocker positions
// ============================================================================
// A compute shader stamps circles into this texture for all trees/rocks/resources.
// Grass samples this texture - one read per blade, unlimited blockers.
// Updated once after vegetation loads, not per-blocker.

const EXCLUSION_TEXTURE_SIZE = 512; // 512x512 covers world with ~1m resolution
const EXCLUSION_WORLD_SIZE = 500; // World units covered by texture

/** GPU exclusion texture (R8, 0=grass, 1=excluded) */
// IMPORTANT: Initialize with dummy 1x1 texture so shader includes exclusion sampling code at build time
const dummyExclusionData = new Float32Array([0]); // 0 = not excluded (grass ok)
const exclusionTexture: THREE.DataTexture = new THREE.DataTexture(
  dummyExclusionData,
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType,
);
exclusionTexture.wrapS = THREE.ClampToEdgeWrapping;
exclusionTexture.wrapT = THREE.ClampToEdgeWrapping;
exclusionTexture.minFilter = THREE.LinearFilter;
exclusionTexture.magFilter = THREE.LinearFilter;
exclusionTexture.needsUpdate = true;

const exclusionTextureNode: ReturnType<typeof texture> =
  texture(exclusionTexture);
const uExclusionWorldSize = uniform(EXCLUSION_WORLD_SIZE);
const uExclusionCenterX = uniform(0);
const uExclusionCenterZ = uniform(0);

// ============================================================================
// GRID-BASED EXCLUSION - Uses texture from GrassExclusionGrid
// ============================================================================
// GrassExclusionGrid queries CollisionMatrix/TerrainSystem for blocked tiles.
// ProceduralGrass samples this texture for O(1) per-blade exclusion check.

/** Flag to use grid-based exclusion instead of legacy vegetation exclusion */
let useGridBasedExclusion = true;

/** Grid exclusion texture node (set by GrassExclusionGrid) */
let gridExclusionTextureNode: ReturnType<typeof texture> | null = null;
/** Grid exclusion uniforms */
const uGridExclusionCenterX = uniform(0);
const uGridExclusionCenterZ = uniform(0);
const uGridExclusionWorldSize = uniform(256);

/**
 * Set grid-based exclusion texture for the shader.
 * Called by GrassExclusionGrid when texture is updated.
 */
export function setGridExclusionTexture(
  textureNode: ReturnType<typeof texture> | null,
  centerX: number,
  centerZ: number,
  worldSize: number,
): void {
  gridExclusionTextureNode = textureNode;
  uGridExclusionCenterX.value = centerX;
  uGridExclusionCenterZ.value = centerZ;
  uGridExclusionWorldSize.value = worldSize;
}

/**
 * Enable or disable grid-based exclusion.
 */
export function setUseGridExclusion(use: boolean): void {
  useGridBasedExclusion = use;
}

// ============================================================================
// WATER/SHORELINE CULLING - Gradual fade near water
// ============================================================================

/**
 * Water threshold configuration with gradual fade zone.
 * Grass fades out gradually as it approaches the shoreline.
 */
const WATER_CONFIG = {
  /** Water level in world Y units (from TERRAIN_CONSTANTS) */
  WATER_LEVEL: 9.0, // TERRAIN_CONSTANTS.WATER_THRESHOLD
  /** Hard cutoff - no grass below this height (right at water's edge) */
  HARD_CUTOFF: 1.0, // 1m above water level
  /** Fade zone start - full density above this */
  FADE_START: 4.0, // Full grass 4m above water
  /** Computed thresholds */
  get WATER_HARD_CUTOFF() {
    return this.WATER_LEVEL + this.HARD_CUTOFF; // 10m - absolute minimum
  },
  get WATER_FADE_START() {
    return this.WATER_LEVEL + this.FADE_START; // 13m - full density above this
  },
} as const;

// Uniforms for water culling (gradual fade)
const uWaterHardCutoff = uniform(WATER_CONFIG.WATER_HARD_CUTOFF);
const uWaterFadeStart = uniform(WATER_CONFIG.WATER_FADE_START);

// ============================================================================
// MULTI-CHARACTER BENDING - Uses texture from CharacterInfluenceManager
// ============================================================================
// Characters (players, NPCs, mobs) bend grass as they walk through it.
// CharacterInfluenceManager packs character data into a 64x2 RGBA Float texture.

/** Flag to use multi-character bending instead of single-player trail */
let useMultiCharacterBending = true;

/** Character data texture (64x2: row 0 = pos+radius, row 1 = vel+speed) */
let characterBendingTextureNode: ReturnType<typeof texture> | null = null;
/** Number of active characters */
const uCharacterCount = uniform(0);
/** Texture width (max characters) */
const CHARACTER_TEXTURE_WIDTH = 64;

/**
 * Set multi-character bending texture for the shader.
 * Called by CharacterInfluenceManager when texture is updated.
 */
export function setCharacterBendingTexture(
  textureNode: ReturnType<typeof texture> | null,
  count: number,
): void {
  characterBendingTextureNode = textureNode;
  uCharacterCount.value = count;
}

/**
 * Enable or disable multi-character bending.
 */
export function setUseMultiCharacterBending(use: boolean): void {
  useMultiCharacterBending = use;
}

// Legacy export for backwards compatibility (now a no-op)
export function setCharacterBendingData(
  _posBuffer: ReturnType<typeof instancedArray>,
  _velBuffer: ReturnType<typeof instancedArray>,
  _count: number,
): void {
  console.warn(
    "[ProceduralGrass] setCharacterBendingData is deprecated - use setCharacterBendingTexture instead",
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class GrassSsbo {
  private buffer1: InstancedArrayBuffer;
  private buffer2: InstancedArrayBuffer;
  private buffer3: InstancedArrayBuffer; // heightmapY
  private buffer4: InstancedArrayBuffer; // static visibility (0=culled, 1=visible)

  // Compute shaders - initialized in constructor after buffers
  computeInit: any;
  computeStatic: any;
  computeUpdate: any;

  // Track initialization state
  private _initialized = false;

  constructor() {
    // Create buffers FIRST
    this.buffer1 = instancedArray(config.COUNT, "vec4");
    this.buffer2 = instancedArray(config.COUNT, "float");
    this.buffer3 = instancedArray(config.COUNT, "float");
    this.buffer4 = instancedArray(config.COUNT, "float"); // Static visibility cache

    // Then create compute shaders that reference the buffers
    this.computeInit = this.createComputeInit();
    this.computeStatic = this.createComputeStatic();
    this.computeUpdate = this.createComputeUpdate();

    // NOTE: We DO NOT use onInit callback here anymore!
    // This caused first-frame spikes because computeInit ran during gameplay.
    // Instead, call runInitialization() explicitly during loading.
  }

  /**
   * Run compute initialization explicitly during loading phase.
   * This avoids first-frame spikes by pre-running heavy compute work.
   * @returns Promise that resolves when initialization is complete
   */
  async runInitialization(renderer: THREE.WebGPURenderer): Promise<void> {
    if (this._initialized) return;

    console.log("[ProceduralGrass] Running SSBO compute initialization...");
    const startTime = performance.now();

    // Run compute init - this populates all grass blade positions
    await renderer.computeAsync(this.computeInit);

    this._initialized = true;
    console.log(
      `[ProceduralGrass] SSBO init complete: ${(performance.now() - startTime).toFixed(1)}ms`,
    );
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get computeBuffer1(): InstancedArrayBuffer {
    return this.buffer1;
  }

  get computeBuffer2(): InstancedArrayBuffer {
    return this.buffer2;
  }

  get computeBuffer3(): InstancedArrayBuffer {
    return this.buffer3;
  }

  get computeBuffer4(): InstancedArrayBuffer {
    return this.buffer4;
  }

  // Unpacking functions
  getWind = Fn(([data = vec4(0)]) => {
    const x = tslUtils.unpackUnits(data.z, 0, 12, -2, 2);
    const z = tslUtils.unpackUnits(data.z, 12, 12, -2, 2);
    return vec2(x, z);
  });

  getScale = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnits(
      data.w,
      0,
      8,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  getOriginalScale = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnits(
      data.w,
      8,
      8,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
  });

  getVisibility = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackFlag(data.w, 17);
  });

  getWindNoise = Fn(([data = vec4(0)]) => {
    return tslUtils.unpackUnit(data.w, 18, 6);
  });

  getPositionNoise = Fn(([data = float(0)]) => {
    return tslUtils.unpackUnit(data, 0, 4);
  });

  // Packing functions
  private setWind = Fn(([data = vec4(0), value = vec2(0)]) => {
    data.z = tslUtils.packUnits(data.z, 0, 12, value.x, -2, 2);
    data.z = tslUtils.packUnits(data.z, 12, 12, value.y, -2, 2);
    return data;
  });

  private setScale = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnits(
      data.w,
      0,
      8,
      value,
      uniforms.uTrailMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  private setOriginalScale = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnits(
      data.w,
      8,
      8,
      value,
      uniforms.uBladeMinScale,
      uniforms.uBladeMaxScale,
    );
    return data;
  });

  private setVisibility = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packFlag(data.w, 17, value);
    return data;
  });

  private setWindNoise = Fn(([data = vec4(0), value = float(0)]) => {
    data.w = tslUtils.packUnit(data.w, 18, 6, value);
    return data;
  });

  private setPositionNoise = Fn(([data = float(0), value = float(0)]) => {
    return tslUtils.packUnit(data, 0, 4, value);
  });

  // Compute Init
  private createComputeInit() {
    return Fn(() => {
      const data1 = this.buffer1.element(instanceIndex);
      const data2 = this.buffer2.element(instanceIndex);
      const data3 = this.buffer3.element(instanceIndex);

      // Position XZ in grid
      const row = floor(float(instanceIndex).div(config.BLADES_PER_SIDE));
      const col = float(instanceIndex).mod(config.BLADES_PER_SIDE);
      const randX = hash(instanceIndex.add(4321));
      const randZ = hash(instanceIndex.add(1234));
      const offsetX = col
        .mul(config.SPACING)
        .sub(config.TILE_HALF_SIZE)
        .add(randX.mul(config.SPACING * 0.5));
      const offsetZ = row
        .mul(config.SPACING)
        .sub(config.TILE_HALF_SIZE)
        .add(randZ.mul(config.SPACING * 0.5));

      // ========== MEGA SIMPLIFIED - use per-instance hash instead of tile-scale noise ==========
      // Use instanceIndex-based hash for jitter to avoid 80m tile patterns
      const noiseR = hash(instanceIndex.mul(0.73));
      const noiseB = hash(instanceIndex.mul(0.91));

      // Small per-instance jitter to break up grid pattern
      const jitterX = noiseR.sub(0.5).mul(config.SPACING * 0.8);
      const jitterZ = noiseB.sub(0.5).mul(config.SPACING * 0.8);
      data1.x = offsetX.add(jitterX);
      data1.y = offsetZ.add(jitterZ);

      data2.assign(this.setPositionNoise(data2, noiseR));

      // Scale - random within range (shaped distribution)
      const n = noiseB;
      const shaped = n.mul(n);
      const randomScale = remap(
        shaped,
        0,
        1,
        uniforms.uBladeMinScale,
        uniforms.uBladeMaxScale,
      );
      data1.assign(this.setScale(data1, randomScale));
      data1.assign(this.setOriginalScale(data1, randomScale));

      // Set visibility to 1 initially (visible)
      data1.assign(this.setVisibility(data1, float(1)));

      // Initialize heightmapY to 0 (will be updated in computeUpdate)
      data3.assign(float(0));
    })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
  }

  // Compute Wind - Enhanced with turbulence and gust patches (inspired by Grass_Journey)
  private computeWind = Fn(
    ([prevWindXZ = vec2(0), worldPos = vec3(0), positionNoise = float(0)]) => {
      const intensity = smoothstep(0.2, 0.5, windManager.uIntensity);
      const dir = windManager.uDirection.negate();
      const strength = uniforms.uWindStrength.add(intensity);

      // Gentle per-instance speed jitter (±10%)
      const speed = uniforms.uWindSpeed.mul(
        positionNoise.remap(0, 1, 0.95, 2.05),
      );

      // Base UV + scroll
      const uvBase = worldPos.xz.mul(0.01).mul(uniforms.uvWindScale);
      const scroll = dir.mul(speed).mul(time);

      // Sample noise textures for wind
      const uvA = uvBase.add(scroll);
      const uvB = uvBase.mul(1.37).add(scroll.mul(1.11));

      // Use texture if available, otherwise hash fallback
      const sampleNoise = (uvCoord: ReturnType<typeof vec2>) => {
        if (noiseAtlasTexture) {
          return texture(noiseAtlasTexture, uvCoord).mul(2.0).sub(1.0);
        }
        return vec3(hash(uvCoord.x.add(uvCoord.y.mul(100))))
          .mul(2.0)
          .sub(1.0);
      };

      const nA = sampleNoise(uvA);
      const nB = sampleNoise(uvB);

      // Mix noises
      const mixRand = fract(sin(positionNoise.mul(12.9898)).mul(78.233));
      const mixTime = sin(time.mul(0.4).add(positionNoise.mul(0.1))).mul(0.25);
      const w = clamp(mixRand.add(mixTime), 0.2, 0.8);
      const n = mix(nA, nB, w);

      // ========== GUST PATCHES (like Grass_Journey) ==========
      // Noise threshold creates areas of wind vs calm - like wind "clouds" passing
      const gustNoiseThreshold = float(0.45); // Below this = calm, above = gusty
      const gustMask = smoothstep(
        gustNoiseThreshold,
        gustNoiseThreshold.add(0.2),
        n.x.add(0.5).mul(0.5), // Remap -1..1 to 0..1
      );

      // ========== TURBULENCE LAYER (erratic per-blade movement) ==========
      // Multiple fast sin waves at different frequencies for chaotic motion
      const phase = positionNoise.mul(6.28); // Per-blade phase offset
      const turbulenceTime = time.mul(20.0).add(phase.mul(100.0)); // Fast variation

      // 3 overlapping waves at different frequencies (Grass_Journey style)
      const turb1 = sin(turbulenceTime).mul(0.15);
      const turb2 = sin(turbulenceTime.mul(1.7).add(2.3)).mul(0.12);
      const turb3 = cos(turbulenceTime.mul(0.8).add(phase.mul(50.0))).mul(0.1);
      const turbulenceAmount = turb1.add(turb2).add(turb3);

      // Turbulence scales with global strength (visible everywhere, not just gusts)
      const turbulence = turbulenceAmount.mul(strength).mul(0.6);

      // ========== COMBINE WIND COMPONENTS ==========
      const baseMag = n.x.mul(strength);
      const gustMag = n.y.mul(strength).mul(0.35).mul(gustMask); // Gusts only in gust patches

      // Total wind factor = base + gusts + turbulence
      const windFactor = baseMag.add(gustMag).add(turbulence);

      const target = dir.mul(windFactor);
      const k = mix(0.08, 0.25, n.z.abs());
      const newWind = prevWindXZ.add(target.sub(prevWindXZ).mul(k));

      // Return wind XZ + gust mask (for potential cloud shadow effect)
      return vec3(newWind, gustMask.mul(windFactor.abs()));
    },
  );

  // Compute Trail Scale - grass bends when player walks through
  private computeTrailScale = Fn(
    ([
      originalScale = float(0),
      currentScale = float(0),
      isStepped = float(0),
    ]) => {
      const up = currentScale.add(
        originalScale.sub(currentScale).mul(uniforms.uTrailGrowthRate),
      );
      const down = currentScale.add(
        uniforms.uTrailMinScale.sub(currentScale).mul(uniforms.uKDown),
      );
      const blended = mix(up, down, isStepped);
      return clamp(blended, uniforms.uTrailMinScale, originalScale);
    },
  );

  // Compute Stochastic Keep - Distance-based dithered thinning
  private computeStochasticKeep = Fn(([distSq = float(0)]) => {
    const R0 = uniforms.uR0;
    const R1 = uniforms.uR1;
    const pMin = uniforms.uPMin;
    const R0Sq = R0.mul(R0);
    const R1Sq = R1.mul(R1);

    // t: 0 inside R0, 1 at/after R1
    const t = clamp(
      distSq.sub(R0Sq).div(max(R1Sq.sub(R0Sq), float(0.00001))),
      0.0,
      1.0,
    );

    // Keep probability: 1 at center → pMin at edge
    const p = mix(float(1.0), pMin, t);

    // Deterministic RNG per blade (stable across frames)
    const rnd = hash(float(instanceIndex).mul(0.73));

    // Keep if random < probability
    return step(rnd, p);
  });

  // Compute Distance Fade - OLD SCHOOL BAYER DITHER
  // Creates retro ordered dithering pattern that fades grass into terrain
  // @ts-expect-error TSL array destructuring
  private computeDistanceFade: ReturnType<typeof Fn> = Fn(
    ([distSq = float(0)]) => {
      const fadeStartSq = uniforms.uFadeStart.mul(uniforms.uFadeStart);
      const fadeEndSq = uniforms.uFadeEnd.mul(uniforms.uFadeEnd);

      // Linear fade: 1.0 at fadeStart, 0.0 at fadeEnd
      const linearFade = float(1.0).sub(
        clamp(
          distSq
            .sub(fadeStartSq)
            .div(max(fadeEndSq.sub(fadeStartSq), float(0.001))),
          0.0,
          1.0,
        ),
      );

      // OLD SCHOOL BAYER 8x8 ORDERED DITHERING
      // Use instance index to create screen-like pattern (stable per-blade)
      // This creates the classic retro dither look
      const bayerX = float(instanceIndex).mod(8.0);
      const bayerY = floor(float(instanceIndex).div(8.0)).mod(8.0);

      // Bayer 8x8 matrix threshold calculation (normalized 0-1)
      // Uses bit interleaving pattern for proper Bayer sequence
      const _x = bayerX.toInt();
      const _y = bayerY.toInt();

      // Reconstruct Bayer pattern using bit operations
      // bayer(x,y) = (bit_reverse(x XOR y) / 64)
      // Simplified: use hash of position for deterministic per-pixel threshold
      const bayerPattern = hash(bayerX.add(bayerY.mul(8.0)).add(0.123));

      // Quantize to 8 levels for chunky retro look
      const quantizedThreshold = floor(bayerPattern.mul(8.0)).div(8.0);

      // Compare fade against Bayer threshold
      // This creates the ordered dither pattern - grass either fully visible or culled
      return step(quantizedThreshold, linearFade);
    },
  );

  // Compute Frustum Visibility for a single point
  // Uses generous padding to prevent popping at frustum edges
  private computeVisibility = Fn(([worldPos = vec3(0)]) => {
    const clipPos = uniforms.uCameraMatrix.mul(vec4(worldPos, 1.0));
    const ndc = clipPos.xyz.div(clipPos.w);
    // More generous padding - at least 0.15 NDC units + scaled radius
    const baseRadius = float(config.BLADE_BOUNDING_SPHERE_RADIUS).div(
      max(clipPos.w, float(0.1)),
    );
    const paddingX = max(baseRadius, float(0.15)); // Generous horizontal padding
    const paddingY = max(baseRadius, float(0.2)); // Extra vertical padding (camera tilt)
    const one = float(1);
    const visible = step(one.negate().sub(paddingX), ndc.x)
      .mul(step(ndc.x, one.add(paddingX)))
      .mul(step(one.negate().sub(paddingY), ndc.y))
      .mul(step(ndc.y, one.add(paddingY)))
      .mul(step(float(-0.1), ndc.z)) // Allow slightly behind near plane
      .mul(step(ndc.z, float(1.1))); // Allow slightly beyond far plane
    return visible;
  });

  // ========== STATIC COMPUTE PASS ==========
  // Runs periodically (not every frame) - handles terrain-dependent culling
  // Stores static visibility in buffer4 and heightmapY in buffer3
  private createComputeStatic() {
    return Fn(() => {
      const data1 = this.buffer1.element(instanceIndex);
      const data3 = this.buffer3.element(instanceIndex);
      const data4 = this.buffer4.element(instanceIndex);

      // Read positions (wrapping is handled by the dynamic pass which runs every frame)
      const offsetX = data1.x;
      const offsetZ = data1.y;
      const worldX = offsetX.add(uniforms.uCameraPosition.x);
      const worldZ = offsetZ.add(uniforms.uCameraPosition.z);

      // Heightmap sampling - single sample, read pre-baked slope from G channel
      const halfWorld = uHeightmapWorldSize.mul(0.5);
      const hmUvX = worldX
        .sub(uHeightmapCenterX)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUvZ = worldZ
        .sub(uHeightmapCenterZ)
        .add(halfWorld)
        .div(uHeightmapWorldSize);
      const hmUV = vec2(
        hmUvX.clamp(float(0.001), float(0.999)),
        hmUvZ.clamp(float(0.001), float(0.999)),
      );

      let heightmapY: ReturnType<typeof float>;
      let slope: ReturnType<typeof float>;
      if (heightmapTextureNode) {
        const hmSample = heightmapTextureNode.sample(hmUV);
        heightmapY = hmSample.r.mul(uHeightmapMax);
        slope = hmSample.g; // Pre-baked slope from heightmap G channel
      } else {
        heightmapY = uniforms.uCameraPosition.y;
        slope = float(0);
      }
      data3.assign(heightmapY);

      // === CAMERA-BASED DISTANCE (for stochastic culling) ===
      const toGrassFromCam = vec2(offsetX, offsetZ);
      const camForwardXZ = uniforms.uCameraForward.xz;
      const forwardDot = toGrassFromCam.dot(camForwardXZ);
      const forwardFactor = smoothstep(float(-0.5), float(1.0), forwardDot);
      const biasAmount = uniforms.uForwardBias.mul(forwardFactor);
      const camDist = toGrassFromCam.length();
      const effectiveDist = max(camDist.sub(biasAmount), float(0.0));
      const effectiveDistSq = effectiveDist.mul(effectiveDist);

      // 1. Stochastic distance culling (dithered thinning)
      const _stochasticKeep = this.computeStochasticKeep(effectiveDistSq);

      // 2. Water/shoreline culling - gradual fade near water
      const waterFade = smoothstep(
        uWaterHardCutoff,
        uWaterFadeStart,
        heightmapY,
      );
      const waterDitherRand = hash(float(instanceIndex).mul(3.71));
      const _aboveWater = step(waterDitherRand, waterFade);

      // 3. Dirt/terrain culling - matches TerrainShader.ts
      const TERRAIN_NOISE_SCALE = 0.0008;
      const DIRT_THRESHOLD = 0.5;
      const noiseUV = vec2(worldX, worldZ).mul(TERRAIN_NOISE_SCALE);
      let terrainNoiseValue: ReturnType<typeof float>;
      if (noiseAtlasTexture) {
        terrainNoiseValue = texture(noiseAtlasTexture, noiseUV).r;
      } else {
        terrainNoiseValue = hash(
          worldX
            .mul(TERRAIN_NOISE_SCALE * 1000)
            .add(worldZ.mul(TERRAIN_NOISE_SCALE * 1000)),
        );
      }

      const dirtPatchFactor = smoothstep(
        float(DIRT_THRESHOLD - 0.05),
        float(DIRT_THRESHOLD + 0.15),
        terrainNoiseValue,
      );

      // Use pre-baked slope from heightmap G channel (no extra texture samples needed)
      const flatnessFactor = smoothstep(float(0.3), float(0.05), slope);
      const slopeFactor = smoothstep(float(0.25), float(0.6), slope);

      const _combinedDirtFactor = max(
        dirtPatchFactor.mul(flatnessFactor).mul(0.7),
        slopeFactor.mul(0.6),
      );
      const dirtDitherRand = hash(float(instanceIndex).mul(5.67));
      const _notOnDirt = step(_combinedDirtFactor, dirtDitherRand.mul(0.5));

      // 4. Sand zone (6-10m height on flat ground)
      const sandZone = smoothstep(float(10.0), float(6.0), heightmapY).mul(
        flatnessFactor,
      );
      const sandDitherRand = hash(float(instanceIndex).mul(6.78));
      const _notOnSand = step(sandZone.mul(0.8), sandDitherRand.mul(0.4));

      // 5. Road influence culling
      let _notOnRoad2: ReturnType<typeof float>;
      {
        const hasRoadData = step(float(2), uRoadInfluenceWorldSize);
        const roadHalfWorld = uRoadInfluenceWorldSize.mul(0.5);
        const roadDx = abs(worldX.sub(uRoadInfluenceCenterX));
        const roadDz = abs(worldZ.sub(uRoadInfluenceCenterZ));
        const insideMask = step(roadDx, roadHalfWorld).mul(
          step(roadDz, roadHalfWorld),
        );
        const useMask = hasRoadData.mul(insideMask);
        const roadUV = computeExclusionUV(
          worldX,
          worldZ,
          uRoadInfluenceCenterX,
          uRoadInfluenceCenterZ,
          uRoadInfluenceWorldSize,
        );
        const roadInfluence = roadInfluenceTextureNode.sample(roadUV).r;
        const roadDitherRand = hash(float(instanceIndex).mul(9.12));
        _notOnRoad2 = mix(
          float(1.0),
          step(
            roadInfluence,
            uRoadInfluenceThreshold.add(roadDitherRand.mul(0.15)),
          ),
          useMask,
        );
      }

      // 6. Exclusion zone culling - HYBRID: grid + legacy
      let _notExcluded2: ReturnType<typeof float>;
      {
        const gridNotExcluded = float(1.0).toVar();
        if (useGridBasedExclusion && gridExclusionTextureNode) {
          const gridUV = computeExclusionUV(
            worldX,
            worldZ,
            uGridExclusionCenterX,
            uGridExclusionCenterZ,
            uGridExclusionWorldSize,
          );
          const gridExclusionValue = gridExclusionTextureNode.sample(gridUV).r;

          const exclDitherRand = hash(float(instanceIndex).mul(10.34));
          const exclDitherRand2 = hash(float(instanceIndex).mul(17.89));
          const tileEdgeDist = min(
            min(fract(worldX), float(1).sub(fract(worldX))),
            min(fract(worldZ), float(1).sub(fract(worldZ))),
          );
          const edgeSoftness = smoothstep(float(0), float(0.4), tileEdgeDist);
          const baseNotExcluded = float(1).sub(gridExclusionValue);
          const softEdgeBonus = gridExclusionValue
            .mul(float(1).sub(edgeSoftness))
            .mul(exclDitherRand.lessThan(0.35).select(1, 0))
            .mul(exclDitherRand2.mul(0.5).add(0.5));
          gridNotExcluded.assign(
            baseNotExcluded.add(softEdgeBonus).clamp(0, 1),
          );
        }

        const legacyUV = computeExclusionUV(
          worldX,
          worldZ,
          uExclusionCenterX,
          uExclusionCenterZ,
          uExclusionWorldSize,
        );
        const legacyExclusionValue = exclusionTextureNode.sample(legacyUV).r;
        const legacyDitherRand = hash(float(instanceIndex).mul(11.45));
        const legacyNotExcluded = step(
          legacyExclusionValue,
          float(0.6).add(legacyDitherRand.mul(0.2)),
        );

        _notExcluded2 = gridNotExcluded.mul(legacyNotExcluded);
      }

      // Store combined static visibility in buffer4 (0=culled, 1=visible)
      const staticVisible = _stochasticKeep
        .mul(_aboveWater)
        .mul(_notOnDirt)
        .mul(_notOnSand)
        .mul(_notOnRoad2)
        .mul(_notExcluded2);
      data4.assign(staticVisible);
    })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
  }

  // ========== DYNAMIC COMPUTE PASS ==========
  // Runs every frame - handles camera-dependent culling, wind, and trail
  // Reads static visibility from buffer4, heightmapY from buffer3
  private createComputeUpdate() {
    return Fn(() => {
      const data1 = this.buffer1.element(instanceIndex);
      const data2 = this.buffer2.element(instanceIndex);
      const data3 = this.buffer3.element(instanceIndex);
      const data4 = this.buffer4.element(instanceIndex);

      // Position wrapping - still needed for delta tracking each frame
      const wrappedPos = VegetationSsboUtils.wrapPosition(
        vec2(data1.x, data1.y),
        uniforms.uPlayerDeltaXZ,
        float(config.TILE_SIZE),
      );
      data1.x = wrappedPos.x;
      data1.y = wrappedPos.z;

      const offsetX = wrappedPos.x;
      const offsetZ = wrappedPos.z;
      const worldX = offsetX.add(uniforms.uCameraPosition.x);
      const worldZ = offsetZ.add(uniforms.uCameraPosition.z);

      // Read heightmapY from buffer3 (pre-computed in static pass)
      const heightmapY = data3;
      const worldPos = vec3(worldX, heightmapY, worldZ);

      // Read static visibility from buffer4
      const staticVisible = data4;

      // === CAMERA-BASED DISTANCE CULLING (changes every frame) ===
      const toGrassFromCam = vec2(offsetX, offsetZ);
      const camForwardXZ = uniforms.uCameraForward.xz;
      const forwardDot = toGrassFromCam.dot(camForwardXZ);
      const forwardFactor = smoothstep(float(-0.5), float(1.0), forwardDot);
      const biasAmount = uniforms.uForwardBias.mul(forwardFactor);
      const camDist = toGrassFromCam.length();
      const effectiveDist = max(camDist.sub(biasAmount), float(0.0));
      const effectiveDistSq = effectiveDist.mul(effectiveDist);

      // 1. Per-instance frustum culling (camera-dependent)
      const _frustumVisible = this.computeVisibility(worldPos);

      // 2. Distance fade with Bayer dither (camera-dependent)
      const distanceFade = this.computeDistanceFade(effectiveDistSq);
      const ditherRand = hash(float(instanceIndex).mul(1.31));
      const _ditherVisible = step(ditherRand, distanceFade);

      // Combine: staticVisible * frustumVisible * ditherVisible = final visibility
      const isVisible = staticVisible.mul(_frustumVisible).mul(_ditherVisible);
      data1.assign(this.setVisibility(data1, isVisible));

      // Skip expensive wind/trail for statically culled blades
      // (roads, water, dirt, exclusions - these blades will never be visible)
      const isStaticAlive = step(float(0.5), staticVisible);

      // === BENDING/TRAIL EFFECT ===
      // Either multi-character bending (texture-based) or legacy single-player trail
      let contact: ReturnType<typeof float>;

      if (useMultiCharacterBending && characterBendingTextureNode) {
        // MULTI-CHARACTER BENDING - Sample texture for each character
        const maxContact = float(0).toVar();
        const texWidth = float(CHARACTER_TEXTURE_WIDTH);
        const bendingTexture = characterBendingTextureNode;

        // Early skip: if blade is beyond maximum possible trail radius (3m), skip character loop entirely
        const maxTrailRadius = float(3.0); // No character has radius > 3m
        const bladeDistFromCam = toGrassFromCam.length();
        // Only process trail for blades that are reasonably close (within max view distance for trails)
        const trailRelevant = step(bladeDistFromCam, float(15.0)); // Trails only visible within 15m

        Loop(uCharacterCount, ({ i }) => {
          const charU = float(i).add(0.5).div(texWidth);

          const posUV = vec2(charU, float(0.25));
          const posData = bendingTexture.sample(posUV);
          const charX = posData.x;
          const charY = posData.y;
          const charZ = posData.z;
          const charRadius = posData.w;

          const velUV = vec2(charU, float(0.75));
          const velData = bendingTexture.sample(velUV);
          const charSpeed = velData.w;

          const hasRadius = charRadius.greaterThan(0.01);

          const dx = worldX.sub(charX);
          const dz = worldZ.sub(charZ);
          const distSq = dx.mul(dx).add(dz.mul(dz));
          const radiusSq = charRadius.mul(charRadius);

          const charHeightDiff = charY.sub(heightmapY).abs();
          const isCharGrounded = smoothstep(
            float(5.0),
            float(0.0),
            charHeightDiff,
          );

          const innerRadiusSq = radiusSq.mul(0.2);
          const outerRadiusSq = radiusSq;

          const charContact = float(1.0)
            .sub(smoothstep(innerRadiusSq, outerRadiusSq, distSq))
            .mul(isCharGrounded)
            .mul(hasRadius.select(1, 0));

          const speedFactor = charSpeed.mul(0.5).add(0.5).clamp(0.5, 2.0);
          const boostedContact = charContact.mul(speedFactor);

          maxContact.assign(max(maxContact, boostedContact));
        });

        contact = maxContact.clamp(0, 1).mul(trailRelevant).mul(isStaticAlive);
      } else {
        // LEGACY: SINGLE-PLAYER TRAIL EFFECT
        const playerWorldX = offsetX.add(uniforms.uCameraPosition.x);
        const playerWorldZ = offsetZ.add(uniforms.uCameraPosition.z);
        const diff = vec2(playerWorldX, playerWorldZ).sub(
          uniforms.uPlayerPosition.xz,
        );
        const distSqPlayer = diff.dot(diff);

        const heightDiff = uniforms.uPlayerPosition.y.sub(heightmapY).abs();
        const isPlayerGrounded = smoothstep(float(5.0), float(0.0), heightDiff);

        const innerRadiusSq = uniforms.uTrailRadiusSquared.mul(0.2);
        const outerRadiusSq = uniforms.uTrailRadiusSquared;

        contact = float(1.0)
          .sub(smoothstep(innerRadiusSq, outerRadiusSq, distSqPlayer))
          .mul(isPlayerGrounded);
        contact = contact.mul(isStaticAlive);
      }

      // Trail scale - flatten grass based on contact
      const currentTrailScale = this.getScale(data1);
      const originalScale = this.getOriginalScale(data1);
      const newScale = this.computeTrailScale(
        originalScale,
        currentTrailScale,
        contact,
      );
      data1.assign(this.setScale(data1, newScale));

      // Wind
      const positionNoise = this.getPositionNoise(data2);
      const prevWind = this.getWind(data1);
      const newWind = this.computeWind(prevWind, worldPos, positionNoise);
      data1.assign(
        this.setWind(
          data1,
          vec2(newWind.x.mul(isStaticAlive), newWind.y.mul(isStaticAlive)),
        ),
      );
      data1.assign(this.setWindNoise(data1, newWind.z.mul(isStaticAlive)));
    })().compute(config.COUNT, [config.WORKGROUP_SIZE]);
  }
}

// ============================================================================
// GRASS MATERIAL - SpriteNodeMaterial
// ============================================================================

class GrassMaterial extends SpriteNodeMaterial {
  private ssbo: GrassSsbo;

  constructor(ssbo: GrassSsbo) {
    super();
    this.ssbo = ssbo;
    this.createGrassMaterial();
  }

  private createGrassMaterial(): void {
    // Material settings - transparent for bottom dither dissolve
    this.precision = "mediump";
    this.transparent = true;
    this.alphaTest = 0.1;

    // Get data from SSBO
    const data1 = this.ssbo.computeBuffer1.element(instanceIndex);
    const data2 = this.ssbo.computeBuffer2.element(instanceIndex);
    const data3 = this.ssbo.computeBuffer3.element(instanceIndex);
    const offsetX = data1.x;
    const offsetZ = data1.y;
    const _windXZ = this.ssbo.getWind(data1);
    const _scaleY = this.ssbo.getScale(data1);
    const isVisible = this.ssbo.getVisibility(data1);
    const _windNoiseFactor = this.ssbo.getWindNoise(data1);
    const _positionNoise = this.ssbo.getPositionNoise(data2);

    // Get heightmapY from compute shader
    const heightmapY = data3;

    // Height gradient for blade
    const h = uv().y;

    // BOTTOM DITHER DISSOLVE - fade grass base into ground, 100% above fade zone
    const bottomFade = smoothstep(float(0), uniforms.uBottomFadeHeight, h);
    // Only apply dither noise within the fade zone, full opacity above
    const inFadeZone = float(1.0).sub(step(uniforms.uBottomFadeHeight, h));
    const ditherNoise = hash(instanceIndex.add(h.mul(1000)))
      .mul(0.4)
      .mul(inFadeZone);
    const bottomOpacity = clamp(
      bottomFade.add(ditherNoise.sub(0.2).mul(inFadeZone)),
      0,
      1,
    );

    // BAYER SCREEN-SPACE DITHERING - texture lookup (replaces 12 ALU bit ops)
    const fragCoord = viewportCoordinate;
    const bayerUV = vec2(
      mod(floor(fragCoord.x), float(4.0)).add(0.5).div(4.0),
      mod(floor(fragCoord.y), float(4.0)).add(0.5).div(4.0),
    );
    const bayerThreshold = bayerTextureNode.sample(bayerUV).r;

    // Distance-based opacity fade with Bayer dithering
    const distFromCamSq = data1.x.mul(data1.x).add(data1.y.mul(data1.y));
    const fadeStartSq = uniforms.uFadeStart.mul(uniforms.uFadeStart);
    const fadeEndSq = uniforms.uFadeEnd.mul(uniforms.uFadeEnd);
    const distFade = float(1.0).sub(
      clamp(
        distFromCamSq
          .sub(fadeStartSq)
          .div(max(fadeEndSq.sub(fadeStartSq), float(0.001))),
        0.0,
        1.0,
      ),
    );

    // Apply Bayer dither to distance fade - creates chunky retro dissolve
    const bayerFadeVisible = step(bayerThreshold, distFade);

    this.opacityNode = isVisible.mul(bottomOpacity).mul(bayerFadeVisible);

    // SCALE - use computed scale from SSBO (but keep some height for flattened grass)
    // When flattened, grass is rotated rather than shrunk
    const originalScale = this.ssbo.getOriginalScale(data1);
    const flattenAmount = float(1.0).sub(
      _scaleY.div(max(originalScale, float(0.01))),
    ); // 0 = upright, 1 = fully flattened
    // Keep most of the height, just rotate it down
    const adjustedScale = mix(
      _scaleY,
      originalScale.mul(0.9),
      flattenAmount.mul(0.7),
    );
    this.scaleNode = vec3(0.5, adjustedScale, 1);

    // ========== FLATTEN ROTATION (grass bends away from player) ==========
    // Calculate world position of this blade
    const worldX = uniforms.uCameraPosition.x.add(offsetX);
    const worldZ = uniforms.uCameraPosition.z.add(offsetZ);

    // Direction from player to grass (grass bends AWAY from player)
    const toGrassX = worldX.sub(uniforms.uPlayerPosition.x);
    const toGrassZ = worldZ.sub(uniforms.uPlayerPosition.z);
    const toGrassDist = sqrt(
      toGrassX.mul(toGrassX).add(toGrassZ.mul(toGrassZ)),
    );
    const toGrassDirX = toGrassX.div(max(toGrassDist, float(0.01)));
    const toGrassDirZ = toGrassZ.div(max(toGrassDist, float(0.01)));

    // Flatten angle - up to 80 degrees (1.4 radians) when fully flattened
    const flattenAngle = flattenAmount.mul(1.4);

    // Apply flatten rotation in the direction away from player
    // Rotation around X axis bends forward/back, around Z axis bends left/right
    const flattenRotX = toGrassDirZ.mul(flattenAngle); // Bend in Z direction -> rotate around X
    const flattenRotZ = toGrassDirX.negate().mul(flattenAngle); // Bend in X direction -> rotate around Z

    // ROTATION - combine wind bending + flatten rotation
    // Wind causes grass to lean in wind direction, more at top
    const windBendStrength = h.mul(h).mul(0.5); // Quadratic falloff from tip
    const windRotX = _windXZ.x.mul(windBendStrength);
    const windRotZ = _windXZ.y.mul(windBendStrength);

    // Flatten rotation affects the whole blade, wind affects tips more
    const totalRotX = windRotZ.add(flattenRotX);
    const totalRotZ = windRotX.negate().add(flattenRotZ);
    this.rotationNode = vec3(totalRotX, 0, totalRotZ);

    // POSITION - heightmap Y + wind sway offset
    const offsetY = heightmapY;

    // Wind sway - apply wind offset to position, more at blade top
    const windSwayStrength = h.mul(0.25).mul(_windNoiseFactor.add(0.5));
    const windSwayX = _windXZ.x.mul(windSwayStrength);
    const windSwayZ = _windXZ.y.mul(windSwayStrength);

    const bladePosition = vec3(
      offsetX.add(windSwayX),
      offsetY,
      offsetZ.add(windSwayZ),
    );

    this.positionNode = bladePosition;

    // COLOR - SAMPLE TERRAIN COLOR AT WORLD POSITION
    // worldX and worldZ already calculated above for flatten rotation

    // ========== TERRAIN SLOPE FROM HEIGHTMAP G CHANNEL ==========
    // Pre-baked slope avoids 3 heightmap samples per fragment
    const halfWorld = uHeightmapWorldSize.mul(0.5);
    const bladeHmUvX = worldX
      .sub(uHeightmapCenterX)
      .add(halfWorld)
      .div(uHeightmapWorldSize);
    const bladeHmUvZ = worldZ
      .sub(uHeightmapCenterZ)
      .add(halfWorld)
      .div(uHeightmapWorldSize);
    const bladeHmUV = vec2(
      bladeHmUvX.clamp(0.001, 0.999),
      bladeHmUvZ.clamp(0.001, 0.999),
    );
    let slope: ReturnType<typeof float>;
    if (heightmapTextureNode) {
      slope = heightmapTextureNode.sample(bladeHmUV).g; // Pre-baked slope from G channel
    } else {
      slope = float(0);
    }

    // ========== GRASS COLOR - Simplified (dirt/rock blades already culled by compute) ==========
    const TERRAIN_NOISE_SCALE = 0.0008;
    const noiseUV = vec2(worldX, worldZ).mul(TERRAIN_NOISE_SCALE);
    let terrainNoiseValue: ReturnType<typeof float>;
    if (noiseAtlasTexture) {
      terrainNoiseValue = texture(noiseAtlasTexture, noiseUV).r;
    } else {
      terrainNoiseValue = hash(worldX.mul(0.8).add(worldZ.mul(1.3)));
    }

    // Grass green/dark variation (the only color variation that matters for visible grass)
    const noiseValue2 = sin(terrainNoiseValue.mul(6.28)).mul(0.3).add(0.5);
    const grassGreen = vec3(0.3, 0.55, 0.15);
    const grassDark = vec3(0.22, 0.42, 0.1);
    const grassVariation = smoothstep(float(0.4), float(0.6), noiseValue2);
    let grassColor = mix(grassGreen, grassDark, grassVariation);

    // Simple height gradient: base to tip
    const tipColor = grassColor.mul(1.1);
    const colorProfile = h.mul(uniforms.uColorMixFactor).clamp();
    const baseToTip = mix(grassColor, tipColor, colorProfile);

    // Simple ambient occlusion near camera center
    const r2 = offsetX.mul(offsetX).add(offsetZ.mul(offsetZ));
    const near = float(1).sub(smoothstep(0, uniforms.uAoRadiusSquared, r2));
    const hWeight = float(1).sub(smoothstep(0.1, 0.85, h));
    const ao = float(1).sub(uniforms.uAoScale.mul(0.15).mul(near.mul(hWeight)));

    // Day/night tinting
    const dayNightTint = mix(
      uniforms.uNightColor,
      uniforms.uDayColor,
      uniforms.uDayNightMix,
    );

    // ========== WIND CLOUD SHADOW EFFECT (Grass_Journey style) ==========
    // Grass in gusty areas is slightly darker (like clouds passing over)
    // _windNoiseFactor contains the gust mask * wind intensity from computeWind
    const cloudShadowStrength = float(0.15); // How dark the shadow gets (0-1)
    const cloudShadow = float(1.0).sub(
      _windNoiseFactor.mul(cloudShadowStrength),
    );

    this.colorNode = baseToTip.mul(ao).mul(dayNightTint).mul(cloudShadow);
  }
}

// ============================================================================
// GPU-DRIVEN TILE MATERIAL - All culling in vertex shader
// ============================================================================

/**
 * Creates a GPU-driven material for grass tiles (LOD1).
 * ALL tile positioning, frustum culling, distance fading, and dithering
 * happens in the vertex shader - NO CPU loops needed.
 *
 * How it works:
 * 1. Fixed number of instances covers maximum view distance
 * 2. Vertex shader computes tile position from instanceIndex + camera position
 * 3. Vertex shader does frustum culling by moving invisible tiles off-screen
 * 4. Vertex shader applies heavy dither for LOD transitions
 * 5. GPU handles everything - zero CPU iteration
 */
function createGpuDrivenTileMaterial(
  baseGeometry: THREE.BufferGeometry,
): MeshBasicNodeMaterial {
  // LOD1 fade uniforms
  const fadeInStart = tileUniforms.uLod1FadeInStart;
  const fadeInEnd = tileUniforms.uLod1FadeInEnd;
  const fadeOutStart = tileUniforms.uLod1FadeOutStart;
  const fadeOutEnd = tileUniforms.uLod1FadeOutEnd;
  const ditherStrength = tileUniforms.uLod1DitherStrength;

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.DoubleSide;

  // GPU-driven position computation in vertex shader
  // Includes heightmap sampling, road exclusion, frustum culling, LOD fading, and Bayer dithering
  material.positionNode = Fn(() => {
    const idx = instanceIndex;
    const gridSize = tileUniforms.uTileGridSize;
    const spacing = tileUniforms.uTileSpacing;
    const camPos = tileUniforms.uTileCameraPos;
    const camFwd = tileUniforms.uTileCameraForward;

    // Compute grid position from instance index
    const gridX = idx.mod(gridSize);
    const gridZ = idx.div(gridSize);
    const halfGrid = gridSize.sub(1).mul(spacing).mul(0.5);

    // Anchor to camera position (snapped to spacing grid)
    const anchorX = floor(camPos.x.div(spacing)).mul(spacing);
    const anchorZ = floor(camPos.z.div(spacing)).mul(spacing);

    // World position of this tile
    const tileX = gridX.mul(spacing).sub(halfGrid).add(anchorX);
    const tileZ = gridZ.mul(spacing).sub(halfGrid).add(anchorZ);

    // ========== HEIGHTMAP SAMPLING ==========
    // Sample heightmap for terrain Y position
    const halfWorld = uHeightmapWorldSize.mul(0.5);
    const hmUvX = tileX
      .sub(uHeightmapCenterX)
      .add(halfWorld)
      .div(uHeightmapWorldSize);
    const hmUvZ = tileZ
      .sub(uHeightmapCenterZ)
      .add(halfWorld)
      .div(uHeightmapWorldSize);
    const hmUV = vec2(hmUvX.clamp(0.001, 0.999), hmUvZ.clamp(0.001, 0.999));

    // Sample heightmap - use 0 if texture not available yet
    let terrainY: ReturnType<typeof float>;
    let hmSampleFull: ReturnType<typeof vec4> | null = null;
    if (heightmapTextureNode) {
      hmSampleFull = heightmapTextureNode.sample(hmUV);
      terrainY = hmSampleFull.r.mul(uHeightmapMax);
    } else {
      terrainY = float(0);
    }

    // ========== ROAD INFLUENCE EXCLUSION ==========
    // Sample road influence texture - hide grass on roads (uses shared UV helper)
    const roadUV = computeExclusionUV(
      tileX,
      tileZ,
      uRoadInfluenceCenterX,
      uRoadInfluenceCenterZ,
      uRoadInfluenceWorldSize,
    );

    // Sample road influence (0 = no road, 1 = full road)
    const roadInfluence = roadInfluenceTextureNode.sample(roadUV).r;
    // Road visibility: 0 if on road (influence > threshold), 1 if clear
    const roadVisible = select(
      roadInfluence.greaterThan(uRoadInfluenceThreshold),
      float(0),
      float(1),
    );

    // ========== GRID-BASED EXCLUSION (BUILDINGS, BLOCKED TILES) ==========
    // Sample collision matrix exclusion texture (uses shared UV helper)
    let gridVisible: ReturnType<typeof float>;
    if (gridExclusionTextureNode && useGridBasedExclusion) {
      const gridUV = computeExclusionUV(
        tileX,
        tileZ,
        uGridExclusionCenterX,
        uGridExclusionCenterZ,
        uGridExclusionWorldSize,
      );
      const gridExclusion = gridExclusionTextureNode.sample(gridUV).r;
      // Grid visibility: 0 if excluded, 1 if clear
      gridVisible = select(gridExclusion.greaterThan(0.5), float(0), float(1));
    } else {
      gridVisible = float(1);
    }

    // ========== LEGACY EXCLUSION (TREES, ROCKS, BUILDINGS) ==========
    const legacyUV = computeExclusionUV(
      tileX,
      tileZ,
      uExclusionCenterX,
      uExclusionCenterZ,
      uExclusionWorldSize,
    );
    const legacyExclusion = exclusionTextureNode.sample(legacyUV).r;
    const legacyVisible = select(
      legacyExclusion.greaterThan(0.5),
      float(0),
      float(1),
    );

    // ========== WATER CULLING ==========
    // Hide grass below water level
    const waterVisible = select(
      terrainY.lessThan(uWaterHardCutoff),
      float(0),
      select(
        terrainY.lessThan(uWaterFadeStart),
        smoothstep(uWaterHardCutoff, uWaterFadeStart, terrainY),
        float(1),
      ),
    );

    // Variation: rotation and mirror based on tile hash (moved up for dirt/sand dither)
    const tileHash = gridX.mul(374761393).add(gridZ.mul(668265263));

    // ========== DIRT/SAND CULLING ==========
    // Match LOD0 compute shader terrain checks for consistent appearance
    const dirtNoiseScale = float(0.0008);
    const dirtNoiseUV = vec2(tileX, tileZ).mul(dirtNoiseScale);

    let terrainNoiseVal: ReturnType<typeof float>;
    if (noiseAtlasTexture) {
      terrainNoiseVal = texture(noiseAtlasTexture, dirtNoiseUV).r;
    } else {
      terrainNoiseVal = hash(tileX.mul(0.8).add(tileZ.mul(1.3)));
    }

    // Dirt patches (same thresholds as LOD0)
    const dirtFactor = smoothstep(float(0.45), float(0.65), terrainNoiseVal);

    // Slope from heightmap G channel (pre-baked slope)
    let slopeVal: ReturnType<typeof float>;
    if (hmSampleFull) {
      slopeVal = hmSampleFull.g; // Pre-baked slope from cached sample
    } else {
      slopeVal = float(0);
    }
    const flatness = smoothstep(float(0.3), float(0.05), slopeVal);
    const slopeCull = smoothstep(float(0.25), float(0.6), slopeVal);
    const combinedDirt = max(
      dirtFactor.mul(flatness).mul(0.7),
      slopeCull.mul(0.6),
    );

    // Use tile hash for deterministic dither (no per-frame randomness needed)
    const dirtDither = hash(tileHash.add(float(567)));
    const dirtVisible = select(
      combinedDirt.greaterThan(dirtDither.mul(0.5)),
      float(0),
      float(1),
    );

    // Sand zone (6-10m height on flat ground)
    const sandZone = smoothstep(float(10.0), float(6.0), terrainY).mul(
      flatness,
    );
    const sandDither = hash(tileHash.add(float(789)));
    const sandVisible = select(
      sandZone.mul(0.8).greaterThan(sandDither.mul(0.4)),
      float(0),
      float(1),
    );

    // Distance from camera (use squared where possible to avoid sqrt)
    const dx = tileX.sub(camPos.x);
    const dz = tileZ.sub(camPos.z);
    const distSq = dx.mul(dx).add(dz.mul(dz));

    // Only compute sqrt when needed for smoothstep (which requires linear distance)
    const dist = sqrt(distSq);

    // Frustum culling: dot product with camera forward (XZ plane only)
    // Optimized: precompute inverse length, avoid redundant normalization
    const invDist = select(
      distSq.greaterThan(0.001),
      float(1).div(dist),
      float(0),
    );
    const dirX = dx.mul(invDist);
    const dirZ = dz.mul(invDist);

    // Camera forward is already normalized, just use XZ components
    // Note: camFwd comes from camera.getWorldDirection() which is normalized
    const frustumDot = dirX.mul(camFwd.x).add(dirZ.mul(camFwd.z));

    // Frustum check: cull if outside FOV (dot < threshold) AND far enough to matter
    // Threshold of 0.5 = cos(60°), culls ~50% of tiles outside view
    const nearDistSq = float(25); // 5m squared - don't cull very close tiles
    const frustumVisible = select(
      distSq.lessThan(nearDistSq),
      float(1),
      select(
        frustumDot.greaterThan(tileUniforms.uFrustumThreshold),
        float(1),
        float(0),
      ),
    );

    // Distance-based LOD fade (smoothstep needs linear distance)
    const fadeIn = smoothstep(fadeInStart, fadeInEnd, dist);
    const fadeOut = smoothstep(fadeOutStart, fadeOutEnd, dist);
    const visibility = fadeIn.mul(float(1).sub(fadeOut));

    // Bayer dithering - OPTIMIZED: texture lookup instead of 16 nested selects
    // UV wraps automatically due to RepeatWrapping, so just use grid coords directly
    const bayerUV = vec2(
      gridX.add(float(0.5)).div(4.0), // +0.5 for texel center
      gridZ.add(float(0.5)).div(4.0),
    );
    const bayerValue = bayerTextureNode.sample(bayerUV).r;

    // Apply dither threshold
    const ditherThreshold = bayerValue.mul(ditherStrength);
    const ditherVisible = select(
      visibility.greaterThan(ditherThreshold),
      float(1),
      float(0),
    );

    // Final visibility: combine all checks
    // frustum * road * grid * legacy * water * dirt * sand * dither
    const finalVisible = frustumVisible
      .mul(roadVisible)
      .mul(gridVisible)
      .mul(legacyVisible)
      .mul(waterVisible)
      .mul(dirtVisible)
      .mul(sandVisible)
      .mul(ditherVisible);

    // Tile height (terrain Y + half tile height)
    const tileY = terrainY.add(tileUniforms.uTileHeight.mul(0.5));

    // Get local vertex position
    const localPos = positionLocal;

    // Rotation and mirror from tileHash (defined above, before dirt/sand section)
    const rotIdx = tileHash.mod(4);
    const mirrorX = select(tileHash.mod(8).greaterThan(3), float(-1), float(1));

    // Rotation angles: 0, 90, 180, 270 degrees
    const angle = select(
      rotIdx.equal(0),
      float(0),
      select(
        rotIdx.equal(1),
        float(Math.PI * 0.5),
        select(rotIdx.equal(2), float(Math.PI), float(Math.PI * 1.5)),
      ),
    );

    // Rotate local position
    const cosA = cos(angle);
    const sinA = sin(angle);
    const rotatedX = localPos.x
      .mul(cosA)
      .sub(localPos.z.mul(sinA))
      .mul(mirrorX);
    const rotatedZ = localPos.x.mul(sinA).add(localPos.z.mul(cosA));

    // ========== WIND ANIMATION ==========
    // Simple tile-wide wind sway for visual continuity with LOD0 blades
    const windTime = time;
    const windScale = float(0.01); // World-space frequency
    const windUvX = tileX.mul(windScale);
    const windUvZ = tileZ.mul(windScale);

    // Two-frequency wind for natural movement
    const windPhase1 = sin(
      windUvX.add(windUvZ.mul(0.7)).add(windTime.mul(0.5)),
    ).mul(0.08);
    const windPhase2 = sin(
      windUvX.mul(1.3).sub(windUvZ).add(windTime.mul(0.8)),
    ).mul(0.05);
    const windSway = windPhase1.add(windPhase2);

    // Only apply wind to upper portions of the tile (grass tips sway more)
    const heightFactor = localPos.y.div(tileUniforms.uTileHeight).clamp(0, 1);
    const windDisplacement = windSway.mul(heightFactor.mul(heightFactor)); // Quadratic profile

    // Scale: 0 for invisible, 1 for visible
    const scaleVal = finalVisible;

    // Final world position (with wind displacement)
    return vec3(
      tileX.add(rotatedX.mul(scaleVal)).add(windDisplacement.mul(scaleVal)),
      tileY.add(localPos.y.mul(scaleVal)),
      tileZ
        .add(rotatedZ.mul(scaleVal))
        .add(windDisplacement.mul(0.3).mul(scaleVal)),
    );
  })();

  // Color with day/night tint
  const dayNightTint = mix(
    tileUniforms.uTileNightColor,
    tileUniforms.uTileDayColor,
    tileUniforms.uTileDayNightMix,
  );
  material.colorNode = mul(vertexColor("color"), dayNightTint);

  return material;
}

/**
 * Create a GPU-driven grass tile instanced mesh.
 * Zero CPU iteration - all positioning and culling happens in vertex shader.
 */
function createGpuDrivenTileMesh(
  geometry: THREE.BufferGeometry,
  gridSize: number,
): THREE.InstancedMesh {
  const material = createGpuDrivenTileMaterial(geometry);
  const instanceCount = gridSize * gridSize;

  const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
  mesh.frustumCulled = false; // We do frustum culling in shader
  mesh.count = instanceCount; // Fixed count - shader handles visibility via scale=0
  mesh.name = "GrassLOD1_GPU";

  // Identity matrices - positioning is done entirely in shader
  const identity = new THREE.Matrix4();
  for (let i = 0; i < instanceCount; i++) {
    mesh.setMatrixAt(i, identity);
  }
  mesh.instanceMatrix.needsUpdate = true;

  return mesh;
}

// ============================================================================
// MAIN GRASS SYSTEM
// ============================================================================

export class ProceduralGrassSystem extends System {
  // LOD0 - Individual blades
  private mesh: THREE.InstancedMesh | null = null;
  private ssbo: GrassSsbo | null = null;

  private useBladeGrass = true;
  private quality: GrassQuality = GrassQuality.HIGH;

  // GPU-driven LOD1 (instanced tiles at distance)
  private gpuLod1Mesh: THREE.InstancedMesh | null = null;

  private grassTileHeightScale = 1;

  private renderer: THREE.WebGPURenderer | null = null;
  private grassInitialized = false;
  private loggedHeightSampleError = false;
  private noiseTexture: THREE.Texture | null = null;

  // Position tracking for world-stable grass
  private lastCameraX = 0;
  private lastCameraZ = 0;

  // Static compute tracking - only re-run when player moves significantly
  private lastStaticComputeX = 0;
  private lastStaticComputeZ = 0;
  private static readonly STATIC_COMPUTE_THRESHOLD = 2; // Re-run static pass when player moves 2m
  private staticComputeInitialized = false;

  // ========== STREAMING HEIGHTMAP STATE ==========
  /** Center of the heightmap in world coordinates */
  private heightmapCenterX = 0;
  private heightmapCenterZ = 0;
  /** Raw heightmap data (RGBA float, R=height) */
  private heightmapData: Float32Array | null = null;
  /** Terrain system reference for height queries */
  private terrainSystem: TerrainSystemInterface | null = null;
  /** Bound event handlers for cleanup */
  private onTileGeneratedBound:
    | ((data: { tileX: number; tileZ: number }) => void)
    | null = null;
  private onRoadsGeneratedBound: (() => void) | null = null;
  private onRoadMaskReadyBound:
    | ((data: RoadInfluenceTextureData) => void)
    | null = null;
  /** Track if initial heightmap has been generated */
  private heightmapInitialized = false;

  // ========== STREAMING EXCLUSION TEXTURE STATE (DEPRECATED) ==========
  // NOTE: Texture-based exclusion is being replaced by grid-based exclusion (GrassExclusionGrid)
  // These fields are kept for backwards compatibility during transition
  /** Center of the exclusion texture in world coordinates (follows player) */
  private exclusionCenterX = 0;
  private exclusionCenterZ = 0;
  /** Track if exclusion texture has been generated at least once */
  private exclusionInitialized = false;
  /** Threshold for re-centering (meters from center) */
  private static readonly EXCLUSION_RECENTER_THRESHOLD = 100; // Re-center when player moves 100m from texture center

  // ========== NEW GRID-BASED EXCLUSION SYSTEM ==========
  /** Grid-based exclusion manager (replaces texture-based exclusion) */
  private exclusionGrid: GrassExclusionGrid | null = null;
  /** Whether to use the new grid-based exclusion (true) or legacy texture (false) */
  private useGridExclusion = true;

  // ========== ROAD EXCLUSION POLLING ==========
  /** Whether road influence texture has been loaded */
  private roadTextureLoaded = false;
  /** Whether roads generation has completed */
  private roadsGenerated = false;
  /** Counter for road polling (check periodically, not every frame) */
  private roadPollCounter = 0;

  // ========== MULTI-CHARACTER BENDING SYSTEM ==========
  /** Character influence manager for multi-character grass bending */
  private characterInfluence: CharacterInfluenceManager | null = null;
  /** Whether to use multi-character bending (true) or legacy single-player trail (false) */
  private useMultiCharacterBending = true;

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: [], optional: ["graphics", "terrain"] };
  }

  async start(): Promise<void> {
    if (!this.world.isClient || typeof window === "undefined") return;

    this.renderer =
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    await this.initializeGrass();
  }

  private async loadTextures(): Promise<void> {
    // Get terrain system for height sampling
    this.terrainSystem =
      (this.world.getSystem("terrain") as unknown as
        | TerrainSystemInterface
        | undefined) ?? null;

    if (!this.useBladeGrass) {
      return;
    }

    if (
      this.terrainSystem &&
      typeof this.terrainSystem.getHeightAt === "function"
    ) {
      // Initialize streaming heightmap (player-centered, updates as you walk)
      console.log("[ProceduralGrass] Initializing streaming heightmap...");
      await this.initStreamingHeightmap();

      // Listen for terrain tile events to update heightmap incrementally
      this.setupTerrainListeners();
    } else {
      console.log(
        "[ProceduralGrass] No terrain system - grass will be at player Y level",
      );
    }

    // Listen for roads:generated event to set up road influence texture
    this.setupRoadListeners();

    // Setup exclusion manager for buildings, trees, rocks, objects
    // This is async but we don't need to await it - the texture will be generated
    // when buildings are added via the GrassExclusionManager callback
    await this.setupExclusionManager();

    // Use the SAME noise texture as TerrainShader for consistent dirt/grass boundary
    // This ensures grass respects the same dirt patches that the terrain displays
    let terrainNoise = getNoiseTexture();
    if (!terrainNoise) {
      // Generate it if terrain hasn't yet (shouldn't happen normally)
      terrainNoise = generateNoiseTexture();
    }
    if (terrainNoise) {
      this.noiseTexture = terrainNoise;
      noiseAtlasTexture = terrainNoise;
      console.log(
        "[ProceduralGrass] Using terrain's noise texture for consistent dirt patches",
      );
    } else {
      console.log(
        "[ProceduralGrass] Using hash fallback for noise (terrain noise unavailable)",
      );
    }
  }

  // ============================================================================
  // STREAMING HEIGHTMAP - Player-centered, updates as you walk
  // ============================================================================

  /**
   * Initialize the streaming heightmap texture.
   * Creates a player-centered heightmap that updates incrementally.
   */
  private async initStreamingHeightmap(): Promise<void> {
    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;

    // Create heightmap data buffer (RGBA float)
    this.heightmapData = new Float32Array(SIZE * SIZE * 4);

    // Initialize to zero height
    for (let i = 0; i < SIZE * SIZE; i++) {
      const idx = i * 4;
      this.heightmapData[idx + 0] = 0; // R = height (normalized)
      this.heightmapData[idx + 1] = 0; // G = slope (0=flat, 1=steep) - pre-baked
      this.heightmapData[idx + 2] = 0; // B = unused
      this.heightmapData[idx + 3] = 1.0; // A = 1
    }

    // Get initial player position (or default to origin)
    const camera = this.world.camera;
    const playerX = camera?.position.x ?? 0;
    const playerZ = camera?.position.z ?? 0;

    // Set heightmap center to player position
    this.heightmapCenterX = playerX;
    this.heightmapCenterZ = playerZ;

    // Create THREE.js texture
    const hmTexture = new THREE.DataTexture(
      this.heightmapData,
      SIZE,
      SIZE,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    hmTexture.wrapS = THREE.ClampToEdgeWrapping;
    hmTexture.wrapT = THREE.ClampToEdgeWrapping;
    hmTexture.magFilter = THREE.LinearFilter;
    hmTexture.minFilter = THREE.LinearFilter;
    hmTexture.needsUpdate = true;

    // Set module-level variables
    heightmapTexture = hmTexture;
    heightmapTextureNode = texture(hmTexture);
    _heightmapMax = MAX_HEIGHT;
    uHeightmapMax.value = MAX_HEIGHT;
    uHeightmapWorldSize.value = WORLD_SIZE;
    uHeightmapCenterX.value = playerX;
    uHeightmapCenterZ.value = playerZ;

    // Generate initial heightmap around player (chunked async)
    console.log(
      `[ProceduralGrass] Generating initial heightmap at (${playerX.toFixed(0)}, ${playerZ.toFixed(0)})...`,
    );
    await this.regenerateHeightmapAroundPoint(playerX, playerZ);

    this.heightmapInitialized = true;
    console.log("[ProceduralGrass] Streaming heightmap ready");
  }

  /**
   * Set up listeners for terrain tile events.
   * Updates heightmap when new terrain tiles load.
   */
  private setupTerrainListeners(): void {
    // Listen for terrain tile generation to update heightmap incrementally
    this.onTileGeneratedBound = (data: unknown) => {
      const tileData = data as { tileX: number; tileZ: number };
      this.onTerrainTileGenerated(tileData.tileX, tileData.tileZ);
      // Schedule exclusion texture refresh (debounced)
      this.scheduleExclusionRefresh();
    };

    this.world.on("terrain:tile:generated", this.onTileGeneratedBound);
  }

  /** Timer for debounced exclusion texture refresh */
  private exclusionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Schedule an exclusion texture refresh centered at current camera position.
   * Debounced to 2 seconds - allows batch tile loading to complete first.
   */
  private scheduleExclusionRefresh(): void {
    if (this.exclusionRefreshTimer) {
      clearTimeout(this.exclusionRefreshTimer);
    }
    this.exclusionRefreshTimer = setTimeout(() => {
      this.exclusionRefreshTimer = null;
      // Get current camera position for centering
      const camera = this.world.camera;
      const centerX = camera?.position.x ?? 0;
      const centerZ = camera?.position.z ?? 0;
      this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
    }, 2000); // 2 second debounce
  }

  /**
   * Set up road network listeners to automatically cull grass on roads.
   */
  private setupRoadListeners(): void {
    // Listen for roads:generated event
    this.onRoadsGeneratedBound = () => {
      this.onRoadsGenerated();
    };

    this.world.on("roads:generated", this.onRoadsGeneratedBound);

    // Listen for road mask ready event (GPU authoritative mask)
    this.onRoadMaskReadyBound = (data: RoadInfluenceTextureData) => {
      this.setRoadInfluenceTexture(
        data.data,
        data.width,
        data.height,
        data.worldSize,
        data.centerX,
        data.centerZ,
      );
    };
    this.world.on("roads:mask:ready", this.onRoadMaskReadyBound);

    // Also check if roads already exist (in case grass system starts after roads)
    this.checkExistingRoads();
  }

  /**
   * Wait for road influence texture to be ready (loader phase).
   * Prevents grass from rendering on roads during initial load.
   */
  private async waitForRoadInfluenceTexture(timeoutMs = 12000): Promise<void> {
    if (this.roadTextureLoaded) return;

    const startTime = performance.now();
    while (!this.roadTextureLoaded) {
      this.checkExistingRoads();
      if (this.roadTextureLoaded) return;

      if (performance.now() - startTime > timeoutMs) {
        console.warn(
          "[ProceduralGrass] Road influence texture not ready (timeout), continuing",
        );
        return;
      }

      // Yield to main thread to avoid blocking loader
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Check if roads already exist and set up road influence texture.
   */
  private checkExistingRoads(): void {
    const roadSystem = this.world.getSystem(
      "roads",
    ) as unknown as RoadNetworkSystemInterface | null;
    const roadCount = roadSystem?.getRoads
      ? roadSystem.getRoads().length
      : null;
    console.log(
      "[ProceduralGrass] checkExistingRoads - roadSystem:",
      roadSystem ? "found" : "NOT FOUND",
    );

    if (roadSystem) {
      const maskData = roadSystem.getRoadInfluenceTextureData?.();
      if (maskData) {
        this.setRoadInfluenceTexture(
          maskData.data,
          maskData.width,
          maskData.height,
          maskData.worldSize,
          maskData.centerX,
          maskData.centerZ,
        );
        console.log(
          "[ProceduralGrass] ✅ Road influence mask received from road system",
        );
        return;
      }

      if (typeof roadSystem.generateRoadInfluenceTexture === "function") {
        // Generate road texture with tight edge (0.5m blend beyond road edge)
        const result = roadSystem.generateRoadInfluenceTexture(
          512,
          undefined,
          0.5,
        );
        console.log(
          "[ProceduralGrass] Road influence texture result:",
          result
            ? `${result.width}x${result.height}, worldSize=${result.worldSize}`
            : "NULL (no roads?)",
        );

        if (result) {
          this.setRoadInfluenceTexture(
            result.data,
            result.width,
            result.height,
            result.worldSize,
          );
          console.log(
            "[ProceduralGrass] ✅ Road influence texture set up successfully",
          );
        } else if (this.roadsGenerated && roadCount === 0) {
          // Roads generation finished but no roads exist - stop polling
          this.roadTextureLoaded = true;
          console.log(
            "[ProceduralGrass] No roads generated - skipping road influence texture",
          );
        }
      } else {
        console.log(
          "[ProceduralGrass] ⚠️ Road system missing generateRoadInfluenceTexture",
        );
      }
    } else {
      console.log("[ProceduralGrass] ⚠️ Road system not available");
    }
  }

  /**
   * Handle roads:generated event - update road influence texture.
   */
  private onRoadsGenerated(): void {
    console.log(
      "[ProceduralGrass] 🛣️ roads:generated event received, updating road influence texture...",
    );
    this.roadsGenerated = true;
    this.checkExistingRoads();
  }

  /**
   * Unsubscribe function for GrassExclusionManager callback.
   */
  private exclusionManagerUnsubscribe: (() => void) | null = null;

  /**
   * Set up exclusion texture system.
   * Texture is generated via compute shader from tree/rock/resource positions.
   * Also subscribes to GrassExclusionManager for building changes.
   */
  private async setupExclusionManager(): Promise<void> {
    // Update existing exclusion texture to proper size (preserves shader node reference)
    // The dummy 1x1 texture was created at module level for shader compilation
    const emptyData = new Float32Array(
      EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
    );
    exclusionTexture.image = {
      data: emptyData,
      width: EXCLUSION_TEXTURE_SIZE,
      height: EXCLUSION_TEXTURE_SIZE,
    };
    exclusionTexture.needsUpdate = true;
    // NOTE: exclusionTextureNode was created at module level with dummy - keep same reference

    // Subscribe to GrassExclusionManager for building/object changes
    // This ensures grass exclusion is updated when buildings are added
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const exclusionManager = getGrassExclusionManager();

    console.log(
      `[ProceduralGrass] 🔗 setupExclusionManager: Subscribing to GrassExclusionManager`,
    );

    // Check if buildings were already registered before we subscribed
    const existingBlockers = exclusionManager.getRectangularBlockers();
    console.log(
      `[ProceduralGrass] Found ${existingBlockers.length} pre-existing building blockers`,
    );

    if (existingBlockers.length > 0) {
      console.log(`[ProceduralGrass] Will refresh texture in 100ms...`);
      // Schedule initial refresh with current camera position
      setTimeout(() => {
        const camera = this.world.camera;
        const centerX = camera?.position.x ?? 0;
        const centerZ = camera?.position.z ?? 0;
        console.log(
          `[ProceduralGrass] ⏰ Initial exclusion refresh at camera (${centerX.toFixed(0)}, ${centerZ.toFixed(0)})`,
        );
        this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
      }, 100);
    } else {
      console.log(
        `[ProceduralGrass] No pre-existing blockers, will wait for onBlockersChanged callback`,
      );
    }

    // Debounce refresh to avoid excessive updates
    this.exclusionManagerUnsubscribe = exclusionManager.onBlockersChanged(
      () => {
        console.log(
          `[ProceduralGrass] 📣 onBlockersChanged callback fired! Current blockers: ${exclusionManager.getRectangularBlockers().length}`,
        );

        // Clear existing timer
        if (this.exclusionRefreshTimer) {
          clearTimeout(this.exclusionRefreshTimer);
        }

        // Debounce: wait 500ms after last change before refreshing
        this.exclusionRefreshTimer = setTimeout(() => {
          const blockerCount = exclusionManager.getRectangularBlockers().length;
          console.log(
            `[ProceduralGrass] ⏰ Debounced refresh triggered, ${blockerCount} blockers registered`,
          );
          // Get current camera position for centering
          const camera = this.world.camera;
          const centerX = camera?.position.x ?? this.exclusionCenterX;
          const centerZ = camera?.position.z ?? this.exclusionCenterZ;
          this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
        }, 500);
      },
    );

    console.log(
      `[ProceduralGrass] ✅ setupExclusionManager complete, subscribed to changes`,
    );
  }

  // ============================================================================
  // EXCLUSION TEXTURE GENERATION - GPU compute from tree/rock positions
  // ============================================================================

  /** Pending blockers to be rendered to texture */
  private pendingBlockers: Array<{ x: number; z: number; radius: number }> = [];
  /** Dirty flag - true if texture needs regeneration */
  private exclusionTextureDirty = false;
  /** GPU storage buffer for blocker data */
  private exclusionBlockerBuffer: ReturnType<typeof instancedArray> | null =
    null;
  /** GPU storage buffer for output texture data */
  private exclusionOutputBuffer: ReturnType<typeof instancedArray> | null =
    null;
  /** Compiled compute shader for exclusion texture generation */
  private exclusionComputeNode: ReturnType<typeof Fn> | null = null;

  /**
   * Register a blocker (tree trunk, rock, resource).
   * Call refreshExclusionTexture() after all blockers are registered.
   */
  addExclusionBlocker(x: number, z: number, radius: number): void {
    this.pendingBlockers.push({ x, z, radius });
    this.exclusionTextureDirty = true;
  }

  /**
   * Clear all registered blockers.
   */
  clearExclusionBlockers(): void {
    this.pendingBlockers = [];
    this.exclusionTextureDirty = true;
  }

  /**
   * Create the GPU compute shader for exclusion texture generation.
   * One thread per texel, loops through all blockers using TSL Loop.
   */
  private createExclusionComputeShader(
    blockerBuffer: ReturnType<typeof instancedArray>,
    outputBuffer: ReturnType<typeof instancedArray>,
    blockerCountUniform: ReturnType<typeof uniform>,
    centerXUniform: ReturnType<typeof uniform>,
    centerZUniform: ReturnType<typeof uniform>,
  ): ReturnType<typeof Fn> {
    const SIZE = EXCLUSION_TEXTURE_SIZE;
    const WORLD_SIZE = EXCLUSION_WORLD_SIZE;
    const halfWorld = WORLD_SIZE / 2;
    const unitsPerTexel = WORLD_SIZE / SIZE;

    // Per-texel compute: each thread handles one output texel
    return Fn(() => {
      // Each thread handles one texel
      const texelIdx = instanceIndex;
      // CRITICAL: Convert to float BEFORE division to avoid WGSL floor(uint) error
      // WGSL's floor() only accepts float types, not uint
      const texelX = float(texelIdx).mod(float(SIZE));
      const texelY = floor(float(texelIdx).div(float(SIZE)));

      // Convert texel to world position (center of texel)
      // CRITICAL: Add the texture center offset so coordinates match world space
      const worldX = texelX
        .add(float(0.5))
        .mul(float(unitsPerTexel))
        .sub(float(halfWorld))
        .add(centerXUniform);
      const worldZ = texelY
        .add(float(0.5))
        .mul(float(unitsPerTexel))
        .sub(float(halfWorld))
        .add(centerZUniform);

      // Initialize maximum exclusion value
      const maxExclusion = float(0).toVar();

      // Loop through all blockers using TSL Loop
      // @ts-expect-error TSL Loop callback types
      Loop(blockerCountUniform, ({ i }) => {
        // Get blocker data (x, z, radius, _padding)
        const blockerData = blockerBuffer.element(i);
        const bx = blockerData.x;
        const bz = blockerData.y;
        const br = blockerData.z;

        // Distance from texel world position to blocker center
        const dx = worldX.sub(bx);
        const dz = worldZ.sub(bz);
        const distSq = dx.mul(dx).add(dz.mul(dz));
        const radiusSq = br.mul(br);

        // Check if within radius
        const dist = sqrt(distSq);

        // Soft fade (1.0 at center, 0.0 at edge)
        const fade = float(1.0).sub(dist.div(br).clamp(0, 1));

        // Only count if within radius
        const contribution = fade.mul(step(distSq, radiusSq));

        // Keep maximum
        maxExclusion.assign(max(maxExclusion, contribution));
      });

      // Write to output buffer
      outputBuffer.element(texelIdx).assign(maxExclusion);
    });
  }

  /**
   * Regenerate the exclusion texture from all registered blockers.
   * Uses GPU compute shader for maximum performance - no main thread blocking.
   * Call this once after vegetation finishes loading.
   */
  async refreshExclusionTexture(): Promise<void> {
    if (!this.exclusionTextureDirty && this.pendingBlockers.length === 0)
      return;

    const blockerCount = this.pendingBlockers.length;
    if (blockerCount === 0) {
      // Clear texture
      const clearData = new Float32Array(
        EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
      );
      exclusionTexture.image = {
        data: clearData,
        width: EXCLUSION_TEXTURE_SIZE,
        height: EXCLUSION_TEXTURE_SIZE,
      };
      exclusionTexture.needsUpdate = true;
      this.exclusionTextureDirty = false;
      console.log("[ProceduralGrass] Exclusion texture cleared (no blockers)");
      return;
    }

    // Check if we have a renderer for GPU compute
    if (!this.renderer) {
      console.warn("[ProceduralGrass] No renderer - falling back to CPU");
      await this.refreshExclusionTextureCPU();
      return;
    }

    console.log(
      `[ProceduralGrass] GPU: Generating exclusion texture for ${blockerCount} blockers...`,
    );
    const startTime = performance.now();

    // Create blocker data array (vec4: x, z, radius, padding)
    const blockerData = new Float32Array(blockerCount * 4);
    for (let i = 0; i < blockerCount; i++) {
      const b = this.pendingBlockers[i];
      blockerData[i * 4 + 0] = b.x;
      blockerData[i * 4 + 1] = b.z;
      blockerData[i * 4 + 2] = b.radius;
      blockerData[i * 4 + 3] = 0;
    }

    // Create GPU buffer for blockers
    const blockerBuffer = instancedArray(blockerData, "vec4");

    // Create output buffer (one float per texel)
    const totalTexels = EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE;
    const outputData = new Float32Array(totalTexels);
    const outputBuffer = instancedArray(outputData, "float");

    // Create uniforms for compute shader
    const uBlockerCount = uniform(blockerCount);
    const uCenterX = uniform(this.exclusionCenterX);
    const uCenterZ = uniform(this.exclusionCenterZ);

    // Build the compute shader with center position
    const computeShader = this.createExclusionComputeShader(
      blockerBuffer,
      outputBuffer,
      uBlockerCount,
      uCenterX,
      uCenterZ,
    );
    const computeNode = computeShader().compute(totalTexels, [64]);

    try {
      // Run the compute shader
      await this.renderer.computeAsync(computeNode);

      // Read back the output buffer using Three.js WebGPU API
      // instancedArray returns a StorageBufferNode, which extends BufferNode -> UniformNode
      // The 'value' property IS the StorageInstancedBufferAttribute directly
      const storageBufferAttribute = (
        outputBuffer as unknown as { value: THREE.StorageBufferAttribute }
      ).value;

      if (
        !storageBufferAttribute ||
        typeof storageBufferAttribute.array === "undefined"
      ) {
        console.warn(
          "[ProceduralGrass] GPU compute: Cannot access output buffer, falling back to CPU",
        );
        await this.refreshExclusionTextureCPU();
        return;
      }

      const resultArrayBuffer = await this.renderer.getArrayBufferAsync(
        storageBufferAttribute,
      );
      const resultData = new Float32Array(resultArrayBuffer);

      // Update the texture (preserves shader node reference)
      exclusionTexture.image = {
        data: resultData,
        width: EXCLUSION_TEXTURE_SIZE,
        height: EXCLUSION_TEXTURE_SIZE,
      };
      exclusionTexture.needsUpdate = true;

      // Debug stats
      let nonZeroCount = 0;
      let maxVal = 0;
      for (let i = 0; i < resultData.length; i++) {
        if (resultData[i] > 0) nonZeroCount++;
        if (resultData[i] > maxVal) maxVal = resultData[i];
      }

      this.exclusionTextureDirty = false;
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.log(
        `[ProceduralGrass] GPU: ${blockerCount} blockers, ` +
          `${nonZeroCount} texels (${((nonZeroCount / totalTexels) * 100).toFixed(2)}%), ` +
          `max=${maxVal.toFixed(2)}, ${elapsed}ms`,
      );
    } catch (error) {
      console.warn("[ProceduralGrass] GPU compute failed, using CPU:", error);
      await this.refreshExclusionTextureCPU();
    }
  }

  /**
   * CPU fallback for exclusion texture generation.
   * Used when GPU compute is not available or fails.
   */
  private async refreshExclusionTextureCPU(): Promise<void> {
    const blockerCount = this.pendingBlockers.length;
    console.log(
      `[ProceduralGrass] CPU: Generating exclusion texture for ${blockerCount} blockers...`,
    );
    const startTime = performance.now();

    const textureData = new Float32Array(
      EXCLUSION_TEXTURE_SIZE * EXCLUSION_TEXTURE_SIZE,
    );
    const texelsPerUnit = EXCLUSION_TEXTURE_SIZE / EXCLUSION_WORLD_SIZE;
    const halfWorld = EXCLUSION_WORLD_SIZE / 2;

    // Use the current exclusion center for coordinate transformation
    const centerX = this.exclusionCenterX;
    const centerZ = this.exclusionCenterZ;

    // Debug: Log texture generation parameters
    console.log(
      `[ProceduralGrass] CPU texture params: center=(${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), halfWorld=${halfWorld}, texelsPerUnit=${texelsPerUnit.toFixed(3)}`,
    );

    // Debug: Log first few blockers
    if (blockerCount > 0) {
      console.log(`[ProceduralGrass] First 3 blockers being processed:`);
      for (let i = 0; i < Math.min(3, blockerCount); i++) {
        const b = this.pendingBlockers[i];
        const uvU = (b.x - centerX + halfWorld) * texelsPerUnit;
        const uvV = (b.z - centerZ + halfWorld) * texelsPerUnit;
        console.log(
          `  [${i}] world=(${b.x.toFixed(1)}, ${b.z.toFixed(1)}), r=${b.radius.toFixed(1)}, texel=(${uvU.toFixed(1)}, ${uvV.toFixed(1)})`,
        );
      }
    }

    // Process in chunks to avoid blocking main thread
    const BLOCKERS_PER_CHUNK = 100;

    for (
      let chunkStart = 0;
      chunkStart < blockerCount;
      chunkStart += BLOCKERS_PER_CHUNK
    ) {
      const chunkEnd = Math.min(chunkStart + BLOCKERS_PER_CHUNK, blockerCount);

      for (let i = chunkStart; i < chunkEnd; i++) {
        const blocker = this.pendingBlockers[i];
        // Convert blocker world position to texture UV space (relative to texture center)
        const centerU = (blocker.x - centerX + halfWorld) * texelsPerUnit;
        const centerV = (blocker.z - centerZ + halfWorld) * texelsPerUnit;
        const radiusTexels = blocker.radius * texelsPerUnit;
        const radiusSq = radiusTexels * radiusTexels;

        const minU = Math.max(0, Math.floor(centerU - radiusTexels));
        const maxU = Math.min(
          EXCLUSION_TEXTURE_SIZE - 1,
          Math.ceil(centerU + radiusTexels),
        );
        const minV = Math.max(0, Math.floor(centerV - radiusTexels));
        const maxV = Math.min(
          EXCLUSION_TEXTURE_SIZE - 1,
          Math.ceil(centerV + radiusTexels),
        );

        for (let v = minV; v <= maxV; v++) {
          for (let u = minU; u <= maxU; u++) {
            const dx = u - centerU;
            const dz = v - centerV;
            const distSq = dx * dx + dz * dz;
            if (distSq <= radiusSq) {
              const dist = Math.sqrt(distSq);
              const fade = 1.0 - Math.min(1.0, dist / radiusTexels);
              const idx = v * EXCLUSION_TEXTURE_SIZE + u;
              textureData[idx] = Math.max(textureData[idx], fade);
            }
          }
        }
      }

      // Yield to main thread between chunks
      if (chunkEnd < blockerCount) {
        await yieldToMain();
      }
    }

    // Update the texture image data (preserves shader node reference)
    exclusionTexture.image = {
      data: textureData,
      width: EXCLUSION_TEXTURE_SIZE,
      height: EXCLUSION_TEXTURE_SIZE,
    };
    exclusionTexture.needsUpdate = true;

    // Debug: count non-zero pixels
    let nonZeroCount = 0;
    let maxVal = 0;
    for (let i = 0; i < textureData.length; i++) {
      if (textureData[i] > 0) nonZeroCount++;
      if (textureData[i] > maxVal) maxVal = textureData[i];
    }

    this.exclusionTextureDirty = false;
    const elapsed = (performance.now() - startTime).toFixed(1);

    // Verify texture state
    const texW = exclusionTexture.image.width;
    const texH = exclusionTexture.image.height;
    const texLen = (exclusionTexture.image.data as Float32Array).length;

    console.log(
      `[ProceduralGrass] ✅ Exclusion texture CPU updated: ${blockerCount} blockers, ` +
        `${nonZeroCount}/${texLen} non-zero texels (${((nonZeroCount / texLen) * 100).toFixed(2)}%), ` +
        `max=${maxVal.toFixed(2)}, size=${texW}x${texH}, ` +
        `center=(${this.exclusionCenterX.toFixed(0)}, ${this.exclusionCenterZ.toFixed(0)}), ` +
        `uniformCenter=(${uExclusionCenterX.value.toFixed(0)}, ${uExclusionCenterZ.value.toFixed(0)}), ` +
        `${elapsed}ms`,
    );
  }

  /**
   * Check if exclusion texture needs re-centering based on player movement.
   * Called from update() to keep exclusion texture centered on player.
   */
  private checkExclusionRecenter(playerX: number, playerZ: number): void {
    if (!this.exclusionInitialized) return;

    const dx = playerX - this.exclusionCenterX;
    const dz = playerZ - this.exclusionCenterZ;
    const distSq = dx * dx + dz * dz;
    const threshold = ProceduralGrassSystem.EXCLUSION_RECENTER_THRESHOLD;
    const thresholdSq = threshold * threshold;

    if (distSq > thresholdSq) {
      // Player moved too far from exclusion texture center - regenerate
      console.log(
        `[ProceduralGrass] Re-centering exclusion texture (player moved ${Math.sqrt(distSq).toFixed(0)}m)`,
      );
      this.regenerateExclusionTextureAroundPoint(playerX, playerZ);
    }
  }

  /**
   * Regenerate exclusion texture centered around a point (usually player position).
   * Collects all blockers within range and generates the GPU texture.
   */
  async regenerateExclusionTextureAroundPoint(
    centerX: number,
    centerZ: number,
  ): Promise<void> {
    console.log(
      `[ProceduralGrass] 🔄 regenerateExclusionTextureAroundPoint called: center=(${centerX.toFixed(0)}, ${centerZ.toFixed(0)})`,
    );

    // Update center
    this.exclusionCenterX = centerX;
    this.exclusionCenterZ = centerZ;

    // Update uniforms for GPU shader sampling
    uExclusionCenterX.value = centerX;
    uExclusionCenterZ.value = centerZ;

    console.log(
      `[ProceduralGrass] Updated uniforms: uExclusionCenterX=${uExclusionCenterX.value}, uExclusionCenterZ=${uExclusionCenterZ.value}, uExclusionWorldSize=${uExclusionWorldSize.value}`,
    );

    // Collect and refresh
    await this.collectAndRefreshExclusionTexture();

    this.exclusionInitialized = true;
    console.log(
      `[ProceduralGrass] ✅ Exclusion texture regeneration complete, exclusionInitialized=true`,
    );
  }

  /**
   * Collect blockers from tree and rock instancers, then regenerate texture.
   * Also collects building exclusion zones from GrassExclusionManager.
   * Only includes blockers within EXCLUSION_WORLD_SIZE/2 of the current center.
   */
  async collectAndRefreshExclusionTexture(): Promise<void> {
    this.clearExclusionBlockers();

    const halfWorld = EXCLUSION_WORLD_SIZE / 2;
    const centerX = this.exclusionCenterX;
    const centerZ = this.exclusionCenterZ;

    let treeCount = 0;
    let rockCount = 0;
    let buildingBlockerCount = 0;
    let includedTrees = 0;
    let includedRocks = 0;
    let includedBuildings = 0;

    // Get tree instancer via singleton
    const { ProcgenTreeInstancer } = await import("./ProcgenTreeInstancer");
    const treeInstancer = ProcgenTreeInstancer.getInstance(this.world);

    if (treeInstancer) {
      const treeInstances = treeInstancer.getInstancesForGrassExclusion();
      for (const data of treeInstances) {
        const pos = data.position;
        treeCount++;

        // Only include blockers within texture range
        const dx = pos.x - centerX;
        const dz = pos.z - centerZ;
        if (Math.abs(dx) <= halfWorld + 5 && Math.abs(dz) <= halfWorld + 5) {
          // Tree trunk exclusion - 30% of tree radius, minimum 0.6m
          // This should cover the visible trunk base where grass shouldn't grow
          const trunkRadius = Math.max(data.radius * 0.3, 0.6);
          this.addExclusionBlocker(pos.x, pos.z, trunkRadius);
          includedTrees++;
        }
      }
    }

    // Get rock instancer via singleton
    const { ProcgenRockInstancer } = await import("./ProcgenRockInstancer");
    const rockInstancer = ProcgenRockInstancer.getInstance(this.world);

    if (rockInstancer) {
      const rockInstances = rockInstancer.getInstancesForGrassExclusion();
      for (const data of rockInstances) {
        rockCount++;

        // Only include blockers within texture range
        const dx = data.position.x - centerX;
        const dz = data.position.z - centerZ;
        if (Math.abs(dx) <= halfWorld + 5 && Math.abs(dz) <= halfWorld + 5) {
          // Rock exclusion - use full radius plus small buffer
          // Rocks should have no grass growing through them
          const rockRadius = Math.max(data.radius * 1.2, 0.5);
          this.addExclusionBlocker(
            data.position.x,
            data.position.z,
            rockRadius,
          );
          includedRocks++;
        }
      }
    }

    // Collect building exclusion zones from GrassExclusionManager
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const exclusionManager = getGrassExclusionManager();
    const rectBlockers = exclusionManager.getRectangularBlockers();

    for (const blocker of rectBlockers) {
      // Check if building is within texture range (rough check using center)
      const dx = blocker.centerX - centerX;
      const dz = blocker.centerZ - centerZ;
      const buildingHalfDiag =
        Math.sqrt(
          blocker.width * blocker.width + blocker.depth * blocker.depth,
        ) / 2;

      if (
        Math.abs(dx) <= halfWorld + buildingHalfDiag &&
        Math.abs(dz) <= halfWorld + buildingHalfDiag
      ) {
        // Convert rectangular blocker to multiple circular blockers
        // Use tighter grid with larger radius to ensure full coverage with fade
        const cos = Math.cos(blocker.rotation);
        const sin = Math.sin(blocker.rotation);
        const halfW = blocker.width / 2;
        const halfD = blocker.depth / 2;

        // Use consistent spacing and radius for reliable coverage across all building sizes
        // The exclusion texture resolution is ~1m/texel, so spacing should be at most 1m
        // to ensure every texel within the building gets strong exclusion
        const spacing = 0.8; // 0.8 meter spacing for denser coverage

        // Radius must ensure overlap zones have exclusion value > 0.9 (strong exclusion)
        // Extra 0.2m padding beyond building edge ensures no grass grows within 0.1m of footprint
        // At midpoint between circles (0.4m): value = 1 - 0.4/radius
        // Want 0.9 = 1 - 0.4/radius => radius = 0.4 / 0.1 = 4.0m
        const circleRadius = 3.0; // Strong overlap + 0.1m padding beyond building edge

        const stepsX = Math.ceil(blocker.width / spacing);
        const stepsZ = Math.ceil(blocker.depth / spacing);

        for (let ix = 0; ix <= stepsX; ix++) {
          for (let iz = 0; iz <= stepsZ; iz++) {
            const localX = -halfW + (blocker.width * ix) / stepsX;
            const localZ = -halfD + (blocker.depth * iz) / stepsZ;

            const worldX = blocker.centerX + localX * cos - localZ * sin;
            const worldZ = blocker.centerZ + localX * sin + localZ * cos;

            this.addExclusionBlocker(worldX, worldZ, circleRadius);
            buildingBlockerCount++;
          }
        }
        includedBuildings++;
      }
    }

    // Log detailed building info for debugging
    if (rectBlockers.length > 0) {
      const sample = rectBlockers.slice(0, 5);
      console.log(
        `[ProceduralGrass] 🏠 Registered buildings (${rectBlockers.length} total):`,
      );
      sample.forEach((b, i) => {
        const dx = b.centerX - centerX;
        const dz = b.centerZ - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const inRange = dist < halfWorld + 50;
        console.log(
          `  [${i}] ${b.id}: center=(${b.centerX.toFixed(0)},${b.centerZ.toFixed(0)}), size=${b.width.toFixed(0)}x${b.depth.toFixed(0)}, dist=${dist.toFixed(0)}m ${inRange ? "✓ IN RANGE" : "✗ OUT OF RANGE"}`,
        );
      });
    } else {
      console.log(
        `[ProceduralGrass] ⚠️ NO BUILDINGS REGISTERED in GrassExclusionManager!`,
      );
    }

    console.log(
      `[ProceduralGrass] 📊 Exclusion centered at (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), ` +
        `texture covers ±${(EXCLUSION_WORLD_SIZE / 2).toFixed(0)}m: ` +
        `${includedTrees}/${treeCount} trees, ${includedRocks}/${rockCount} rocks, ` +
        `${includedBuildings}/${rectBlockers.length} buildings (${buildingBlockerCount} circles). ` +
        `Total blockers: ${this.pendingBlockers.length}`,
    );

    // Regenerate texture
    await this.refreshExclusionTexture();
  }

  /**
   * Handle terrain tile generation - update heightmap for this tile region.
   */
  private onTerrainTileGenerated(tileX: number, tileZ: number): void {
    if (
      !this.heightmapInitialized ||
      !this.terrainSystem ||
      !this.heightmapData
    )
      return;

    // Get terrain tile size
    const tileSize =
      (this.terrainSystem as { getTileSize?: () => number }).getTileSize?.() ??
      100;

    // Calculate tile world bounds
    const tileWorldX = tileX * tileSize;
    const tileWorldZ = tileZ * tileSize;

    // Update the heightmap region that overlaps with this tile
    this.updateHeightmapRegion(tileWorldX, tileWorldZ, tileSize, tileSize);
  }

  /**
   * Update a region of the heightmap by sampling terrain.
   * Called when terrain tiles load or when re-centering.
   */
  private updateHeightmapRegion(
    worldMinX: number,
    worldMinZ: number,
    worldWidth: number,
    worldHeight: number,
  ): void {
    if (!this.terrainSystem || !this.heightmapData) return;

    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;
    const halfWorld = WORLD_SIZE / 2;
    const metersPerPixel = WORLD_SIZE / SIZE;

    // Convert world region to heightmap pixel coordinates
    // Heightmap UV: (worldX - centerX + halfWorld) / WORLD_SIZE
    const pixelMinX = Math.floor(
      ((worldMinX - this.heightmapCenterX + halfWorld) / WORLD_SIZE) * SIZE,
    );
    const pixelMinZ = Math.floor(
      ((worldMinZ - this.heightmapCenterZ + halfWorld) / WORLD_SIZE) * SIZE,
    );
    const pixelMaxX = Math.ceil(
      ((worldMinX + worldWidth - this.heightmapCenterX + halfWorld) /
        WORLD_SIZE) *
        SIZE,
    );
    const pixelMaxZ = Math.ceil(
      ((worldMinZ + worldHeight - this.heightmapCenterZ + halfWorld) /
        WORLD_SIZE) *
        SIZE,
    );

    // Clamp to valid range
    const startX = Math.max(0, pixelMinX);
    const startZ = Math.max(0, pixelMinZ);
    const endX = Math.min(SIZE, pixelMaxX);
    const endZ = Math.min(SIZE, pixelMaxZ);

    // Skip if region is entirely outside heightmap
    if (startX >= SIZE || startZ >= SIZE || endX <= 0 || endZ <= 0) return;

    // Update pixels in this region
    let updated = 0;
    for (let pz = startZ; pz < endZ; pz++) {
      for (let px = startX; px < endX; px++) {
        // Convert pixel to world position
        const worldX =
          this.heightmapCenterX - halfWorld + (px + 0.5) * metersPerPixel;
        const worldZ =
          this.heightmapCenterZ - halfWorld + (pz + 0.5) * metersPerPixel;

        // Sample terrain height
        let height = 0;
        try {
          height = this.terrainSystem.getHeightAt(worldX, worldZ);
        } catch (err) {
          if (!this.loggedHeightSampleError) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              "[ProceduralGrass] Height sample failed; using fallback height:",
              message,
            );
            this.loggedHeightSampleError = true;
          }
          height = 0;
        }

        // Normalize and store
        const normalizedHeight = Math.max(0, Math.min(1, height / MAX_HEIGHT));
        const idx = (pz * SIZE + px) * 4;
        this.heightmapData[idx + 0] = normalizedHeight;

        // Pre-bake slope into G channel
        // Sample neighbor heights for gradient computation
        let heightRight = height;
        let heightForward = height;
        try {
          heightRight = this.terrainSystem.getHeightAt(
            worldX + metersPerPixel,
            worldZ,
          );
        } catch {
          /* use center height as fallback */
        }
        try {
          heightForward = this.terrainSystem.getHeightAt(
            worldX,
            worldZ + metersPerPixel,
          );
        } catch {
          /* use center height as fallback */
        }
        const slopeDx = (heightRight - height) / metersPerPixel;
        const slopeDz = (heightForward - height) / metersPerPixel;
        const slopeValue = Math.min(
          1,
          Math.sqrt(slopeDx * slopeDx + slopeDz * slopeDz),
        );
        this.heightmapData[idx + 1] = slopeValue; // G = pre-baked slope (0=flat, 1=steep)

        updated++;
      }
    }

    // Mark texture for GPU upload
    if (heightmapTexture && updated > 0) {
      heightmapTexture.needsUpdate = true;
    }
  }

  /**
   * Regenerate entire heightmap centered on a point.
   * Used for initial generation and when player moves far from center.
   */
  private async regenerateHeightmapAroundPoint(
    centerX: number,
    centerZ: number,
  ): Promise<void> {
    if (!this.terrainSystem || !this.heightmapData) return;

    const { SIZE, WORLD_SIZE, MAX_HEIGHT } = HEIGHTMAP_CONFIG;
    const halfWorld = WORLD_SIZE / 2;
    const metersPerPixel = WORLD_SIZE / SIZE;

    // Update center
    this.heightmapCenterX = centerX;
    this.heightmapCenterZ = centerZ;

    // Update uniforms for GPU shader (heightmap is now centered at new position)
    uHeightmapCenterX.value = centerX;
    uHeightmapCenterZ.value = centerZ;

    const startTime = performance.now();
    const ROWS_PER_CHUNK = 32;

    let minH = Infinity;
    let maxH = -Infinity;

    // Process in chunks to avoid blocking
    for (let zStart = 0; zStart < SIZE; zStart += ROWS_PER_CHUNK) {
      const chunkStart = performance.now();
      const zEnd = Math.min(zStart + ROWS_PER_CHUNK, SIZE);

      for (let pz = zStart; pz < zEnd; pz++) {
        for (let px = 0; px < SIZE; px++) {
          // Convert pixel to world position
          const worldX = centerX - halfWorld + (px + 0.5) * metersPerPixel;
          const worldZ = centerZ - halfWorld + (pz + 0.5) * metersPerPixel;

          // Sample terrain height
          let height = 0;
          try {
            height = this.terrainSystem.getHeightAt(worldX, worldZ);
          } catch (err) {
            if (!this.loggedHeightSampleError) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(
                "[ProceduralGrass] Height sample failed; using fallback height:",
                message,
              );
              this.loggedHeightSampleError = true;
            }
            height = 0;
          }

          if (height < minH) minH = height;
          if (height > maxH) maxH = height;

          // Normalize and store
          const normalizedHeight = Math.max(
            0,
            Math.min(1, height / MAX_HEIGHT),
          );
          const idx = (pz * SIZE + px) * 4;
          this.heightmapData[idx + 0] = normalizedHeight;

          // Pre-bake slope into G channel
          let heightRight = height;
          let heightForward = height;
          try {
            heightRight = this.terrainSystem.getHeightAt(
              worldX + metersPerPixel,
              worldZ,
            );
          } catch {
            /* use center height as fallback */
          }
          try {
            heightForward = this.terrainSystem.getHeightAt(
              worldX,
              worldZ + metersPerPixel,
            );
          } catch {
            /* use center height as fallback */
          }
          const slopeDx = (heightRight - height) / metersPerPixel;
          const slopeDz = (heightForward - height) / metersPerPixel;
          const slopeValue = Math.min(
            1,
            Math.sqrt(slopeDx * slopeDx + slopeDz * slopeDz),
          );
          this.heightmapData[idx + 1] = slopeValue; // G = pre-baked slope (0=flat, 1=steep)
        }
      }

      // Yield between chunks
      if (shouldYield(chunkStart, 8) && zStart + ROWS_PER_CHUNK < SIZE) {
        await yieldToMain();
      }
    }

    // Mark texture for GPU upload
    if (heightmapTexture) {
      heightmapTexture.needsUpdate = true;
    }

    const totalTime = performance.now() - startTime;
    console.log(
      `[ProceduralGrass] Heightmap regenerated at (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}): ` +
        `${minH.toFixed(1)} to ${maxH.toFixed(1)} in ${totalTime.toFixed(1)}ms`,
    );
  }

  /**
   * Check if heightmap needs re-centering based on player movement.
   * Called from update() to keep heightmap centered on player.
   */
  private checkHeightmapRecenter(playerX: number, playerZ: number): void {
    if (!this.heightmapInitialized) return;

    const dx = playerX - this.heightmapCenterX;
    const dz = playerZ - this.heightmapCenterZ;
    const distSq = dx * dx + dz * dz;
    const thresholdSq =
      HEIGHTMAP_CONFIG.RECENTER_THRESHOLD * HEIGHTMAP_CONFIG.RECENTER_THRESHOLD;

    if (distSq > thresholdSq) {
      // Player moved too far from heightmap center - regenerate
      // This is async but we don't await - it will update in background
      console.log(
        `[ProceduralGrass] Re-centering heightmap (player moved ${Math.sqrt(distSq).toFixed(0)}m)`,
      );
      this.regenerateHeightmapAroundPoint(playerX, playerZ);
    }
  }

  private async initializeGrass(): Promise<void> {
    if (this.grassInitialized) return;

    const stage = this.world.stage as { scene?: THREE.Scene } | null;
    if (!stage?.scene) {
      setTimeout(() => this.initializeGrass(), 100);
      return;
    }

    this.renderer ??=
      (
        this.world.getSystem("graphics") as {
          renderer?: THREE.WebGPURenderer;
        } | null
      )?.renderer ?? null;

    if (!this.renderer) {
      console.warn("[ProceduralGrass] No WebGPU renderer available");
      return;
    }

    try {
      const initStartTime = performance.now();
      console.log("[ProceduralGrass] Starting async initialization...");

      // STEP 1: Load heightmap texture (chunked async - no blocking)
      await this.loadTextures();

      // STEP 1.2: Wait for road influence texture so grass loads correctly on roads
      if (this.useBladeGrass) {
        await this.waitForRoadInfluenceTexture();
      }

      console.log(
        "[ProceduralGrass] After loadTextures - heightmapTextureNode:",
        heightmapTextureNode ? "SET" : "NULL",
      );

      // STEP 1.5: Initialize new grid-based exclusion system
      if (this.useBladeGrass && this.useGridExclusion) {
        this.exclusionGrid = getGrassExclusionGrid(this.world);
        this.exclusionGrid.initialize();
        console.log(
          "[ProceduralGrass] Grid-based exclusion system initialized",
        );
      }

      // STEP 1.6: Initialize multi-character bending system
      if (this.useBladeGrass && this.useMultiCharacterBending) {
        this.characterInfluence = getCharacterInfluenceManager(this.world);
        this.characterInfluence.initialize();
        console.log(
          "[ProceduralGrass] Multi-character bending system initialized",
        );
      }

      // STEP 2: Create SSBO and meshes
      if (this.useBladeGrass) {
        this.ssbo = new GrassSsbo();

        // Create geometry
        const geometry = this.createGeometry(config.SEGMENTS);

        // Create material
        const material = new GrassMaterial(this.ssbo);

        // Create instanced mesh
        this.mesh = new THREE.InstancedMesh(geometry, material, config.COUNT);
        this.mesh.frustumCulled = false;
        this.mesh.name = "ProceduralGrass_GPU";

        // CRITICAL: Render order 76 = after silhouette (50), before player (100)
        // This prevents silhouette from showing through grass
        this.mesh.renderOrder = 76;

        // Layer 1 = main camera only (matches other vegetation)
        this.mesh.layers.set(1);

        stage.scene.add(this.mesh);
      } else {
        this.mesh = null;
        this.ssbo = null;
      }

      // STEP 3: Pre-run GPU compute initialization during loading
      // This is the KEY OPTIMIZATION - run heavy compute BEFORE gameplay starts
      // Previously this ran via onInit callback causing first-frame spikes
      if (this.useBladeGrass && this.ssbo) {
        console.log(
          "[ProceduralGrass] Pre-running GPU compute initialization...",
        );

        // Run LOD0 SSBO initialization only (LOD1 disabled)
        await this.ssbo.runInitialization(this.renderer);

        // Yield to ensure GPU work is flushed
        await yieldToMain();

        // STEP 3.5: Prime visibility with a compute pass (roads/exclusion/distance)
        // This ensures the first rendered frame already respects roads and culling.
        const camPos = this.world.camera?.position;
        if (camPos) {
          uniforms.uCameraPosition.value.copy(camPos);
          uniforms.uPlayerPosition.value.copy(camPos);
          uniforms.uPlayerDeltaXZ.value.set(0, 0);
        }
        // Run static pass first (terrain-dependent culling), then dynamic pass (frustum/wind)
        await this.renderer.computeAsync(this.ssbo.computeStatic);
        await this.renderer.computeAsync(this.ssbo.computeUpdate);
        this.staticComputeInitialized = true;
        this.lastStaticComputeX = camPos?.x ?? 0;
        this.lastStaticComputeZ = camPos?.z ?? 0;
        await yieldToMain();
      }

      this.grassInitialized = true;

      // Initialize grass LOD1 tiles in background (far-field grass)
      void this.initializeGrassLOD1(stage.scene);

      const totalTime = performance.now() - initStartTime;
      console.log(
        `[ProceduralGrass] Initialization complete: ${totalTime.toFixed(1)}ms total\n` +
          `  LOD0: ${this.useBladeGrass ? `${config.COUNT.toLocaleString()} blades with Bayer dither fade` : "DISABLED (tile instancing)"}\n` +
          `  LOD1: Tile instances (async bake)`,
      );
    } catch (error) {
      console.error("[ProceduralGrass] ERROR:", error);
    }
  }

  private createGrassTileBakingSource(
    grassField: GrassFieldResult,
  ): THREE.Group {
    const group = new THREE.Group();
    const mesh = grassField.lod0Mesh;
    const geometry = mesh.geometry;
    const config = grassField.config;

    const instancePosition = geometry.getAttribute("instancePosition");
    const instanceVariation = geometry.getAttribute("instanceVariation");

    if (
      !(instancePosition instanceof THREE.InstancedBufferAttribute) ||
      !(instanceVariation instanceof THREE.InstancedBufferAttribute)
    ) {
      console.warn("[ProceduralGrass] Grass mesh missing instance attributes");
      return group;
    }

    const instanceCount = grassField.lod0Count;
    const bladeHeight = config.blade.height;
    const bladeWidth = config.blade.width;
    const baseColor = new THREE.Color(
      config.color.baseColor.r,
      config.color.baseColor.g,
      config.color.baseColor.b,
    );
    const tipColor = new THREE.Color(
      config.color.tipColor.r,
      config.color.tipColor.g,
      config.color.tipColor.b,
    );

    const clumpGeometry = createGrassClumpGeometry(config.blade, {
      bladeCount: GRASS_TILE_SETTINGS.CLUMP_BLADE_COUNT,
      segments: GRASS_TILE_SETTINGS.CLUMP_SEGMENTS,
      curvature: GRASS_TILE_SETTINGS.CLUMP_CURVATURE,
      spread: GRASS_TILE_SETTINGS.CLUMP_SPREAD,
      heightVariation: GRASS_TILE_SETTINGS.CLUMP_HEIGHT_VARIATION,
      widthVariation: GRASS_TILE_SETTINGS.CLUMP_WIDTH_VARIATION,
    });

    const clumpPositions = clumpGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const clumpNormals = clumpGeometry.getAttribute(
      "normal",
    ) as THREE.BufferAttribute;
    const clumpUvs = clumpGeometry.getAttribute("uv") as
      | THREE.BufferAttribute
      | undefined;
    const clumpIndex = clumpGeometry.getIndex();

    const clumpVertexCount = clumpPositions.count;
    const clumpIndexCount = clumpIndex ? clumpIndex.count : 0;

    const mergedPositions = new Float32Array(
      instanceCount * clumpVertexCount * 3,
    );
    const mergedNormals = new Float32Array(
      instanceCount * clumpVertexCount * 3,
    );
    const mergedColors = new Float32Array(instanceCount * clumpVertexCount * 3);
    const mergedIndices: number[] = [];

    for (let i = 0; i < instanceCount; i++) {
      const worldX = instancePosition.getX(i);
      const worldY = instancePosition.getY(i);
      const worldZ = instancePosition.getZ(i);
      const heightScale = instancePosition.getW(i);

      const rotation = instanceVariation.getX(i);
      const widthScale = instanceVariation.getY(i);

      const positionNoise =
        ((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const finalWidthScale = widthScale * (positionNoise + 0.5);

      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);

      const vertexOffset = i * clumpVertexCount;

      for (let v = 0; v < clumpVertexCount; v++) {
        const bx = clumpPositions.getX(v);
        const by = clumpPositions.getY(v);
        const bz = clumpPositions.getZ(v);

        const scaledX = bx * bladeWidth * finalWidthScale;
        const scaledY = by * bladeHeight * heightScale;
        const scaledZ = bz * bladeWidth * finalWidthScale;

        const rotX = scaledX * cosR - scaledZ * sinR;
        const rotZ = scaledX * sinR + scaledZ * cosR;

        const finalX = rotX + worldX;
        const finalY = scaledY + worldY;
        const finalZ = rotZ + worldZ;

        const idx = (vertexOffset + v) * 3;
        mergedPositions[idx + 0] = finalX;
        mergedPositions[idx + 1] = finalY;
        mergedPositions[idx + 2] = finalZ;

        const nx = clumpNormals.getX(v);
        const ny = clumpNormals.getY(v);
        const nz = clumpNormals.getZ(v);
        const rotNx = nx * cosR - nz * sinR;
        const rotNz = nx * sinR + nz * cosR;
        mergedNormals[idx + 0] = rotNx;
        mergedNormals[idx + 1] = ny;
        mergedNormals[idx + 2] = rotNz;

        const t = clumpUvs ? clumpUvs.getY(v) : by;
        const gradientColor = baseColor.clone().lerp(tipColor, t * 0.6);
        const ao = Math.max(0.65, 0.65 + t * 0.35);
        mergedColors[idx + 0] = gradientColor.r * ao;
        mergedColors[idx + 1] = gradientColor.g * ao;
        mergedColors[idx + 2] = gradientColor.b * ao;
      }

      if (clumpIndex) {
        for (let j = 0; j < clumpIndexCount; j++) {
          mergedIndices.push(clumpIndex.getX(j) + vertexOffset);
        }
      }
    }

    clumpGeometry.dispose();

    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mergedPositions, 3),
    );
    mergedGeometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(mergedNormals, 3),
    );
    mergedGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(mergedColors, 3),
    );
    if (mergedIndices.length > 0) {
      mergedGeometry.setIndex(mergedIndices);
    }
    mergedGeometry.computeBoundingSphere();
    mergedGeometry.computeBoundingBox();

    const material = new MeshBasicNodeMaterial();
    material.colorNode = vertexColor("color");
    material.side = THREE.DoubleSide;

    const bakedMesh = new THREE.Mesh(mergedGeometry, material);
    group.add(bakedMesh);

    return group;
  }

  private disposeGrassTileBakingSource(source: THREE.Group): void {
    source.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const material = node.material;
        if (material instanceof THREE.Material) {
          material.dispose();
        } else if (Array.isArray(material)) {
          material.forEach((mat) => mat.dispose());
        }
      }
    });
  }

  private async initializeGrassLOD1(scene: THREE.Scene): Promise<void> {
    if (!this.renderer || this.gpuLod1Mesh) {
      return;
    }

    try {
      const grassField = GrassGenerator.generateField({
        config: {
          density: GRASS_TILE_SETTINGS.DENSITY,
          patchSize: GRASS_TILE_SETTINGS.TILE_SIZE,
          blade: {
            height: GRASS_TILE_SETTINGS.BLADE_HEIGHT,
            width: GRASS_TILE_SETTINGS.BLADE_WIDTH,
            segments: GRASS_TILE_SETTINGS.BLADE_SEGMENTS,
            tipTaper: GRASS_TILE_SETTINGS.BLADE_TIP_TAPER,
          },
        },
        seed: GRASS_TILE_SETTINGS.SEED,
        includeLOD1: false,
      });

      const bakingSource = this.createGrassTileBakingSource(grassField);
      const bakingMesh =
        bakingSource.children[0] instanceof THREE.Mesh
          ? (bakingSource.children[0] as THREE.Mesh)
          : null;
      grassField.dispose();

      const heightScale = Math.max(
        0.1,
        Math.min(
          1,
          (uniforms.uBladeMinScale.value + uniforms.uBladeMaxScale.value) * 0.5,
        ),
      );
      this.grassTileHeightScale = heightScale;

      // Set up tile height for GPU-driven system
      if (bakingMesh?.geometry.boundingBox) {
        const size = new THREE.Vector3();
        bakingMesh.geometry.boundingBox.getSize(size);
        const tileHeight = Math.max(GRASS_TILE_SETTINGS.BLADE_HEIGHT, size.y);
        tileUniforms.uTileHeight.value = tileHeight * heightScale;
      }

      // ========== GPU-DRIVEN LOD1 (instanced tiles) ==========
      if (bakingMesh) {
        const nearGeometry = bakingMesh.geometry.clone();
        nearGeometry.computeBoundingBox();

        // Calculate grid size to cover LOD1 range
        const lod1Spacing = GRASS_TILE_SETTINGS.LOD1_SPACING;
        const lod1Range = GRASS_TILE_SETTINGS.LOD1_FADE_OUT_END;
        const lod1GridSize = Math.ceil((lod1Range * 2) / lod1Spacing) + 1;

        // Set GPU uniforms for LOD1
        tileUniforms.uTileGridSize.value = lod1GridSize;
        tileUniforms.uTileSpacing.value = lod1Spacing;

        // Create GPU-driven mesh (all culling in vertex shader)
        this.gpuLod1Mesh = createGpuDrivenTileMesh(nearGeometry, lod1GridSize);
        this.gpuLod1Mesh.renderOrder = 76;
        this.gpuLod1Mesh.layers.set(1);
        scene.add(this.gpuLod1Mesh);

        console.log(
          `[ProceduralGrass] GPU-driven LOD1 ready: ${lod1GridSize}x${lod1GridSize} = ${lod1GridSize * lod1GridSize} instances (GPU culled)`,
        );
      }

      this.disposeGrassTileBakingSource(bakingSource);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[ProceduralGrass] LOD1 initialization failed:", message);
    }
  }

  private getRoadInfluenceAtPoint(
    worldX: number,
    worldZ: number,
  ): number | null {
    const worldSize = roadInfluenceState.uWorldSize.value;
    if (worldSize > 1) {
      const tex = getRoadInfluenceMaskTexture();
      const image = tex.image as {
        data: Float32Array;
        width: number;
        height: number;
      };
      const data = image.data;
      if (data && image.width > 0 && image.height > 0) {
        const halfWorld = worldSize * 0.5;
        const u =
          (worldX - roadInfluenceState.uCenterX.value + halfWorld) / worldSize;
        const v =
          (worldZ - roadInfluenceState.uCenterZ.value + halfWorld) / worldSize;
        if (u > 0 && u < 1 && v > 0 && v < 1) {
          const x = Math.min(
            image.width - 1,
            Math.max(0, Math.floor(u * image.width)),
          );
          const y = Math.min(
            image.height - 1,
            Math.max(0, Math.floor(v * image.height)),
          );
          return data[y * image.width + x];
        }
        return 0;
      }
    }

    const roadSystem = this.world.getSystem(
      "roads",
    ) as RoadNetworkSystemInterface | null;
    if (roadSystem?.getRoadInfluenceAt) {
      return roadSystem.getRoadInfluenceAt(worldX, worldZ, 0.5);
    }

    return null;
  }

  /**
   * Smoothstep interpolation for fade transitions.
   * Returns 0 when x <= edge0, 1 when x >= edge1, smooth transition between.
   */
  private smoothstep(edge0: number, edge1: number, x: number): number {
    if (edge0 === edge1) {
      return x < edge0 ? 0 : 1;
    }
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  /**
   * Smootherstep (C2 continuous) for extra-smooth LOD transitions.
   * Less abrupt at edges than regular smoothstep.
   */
  private smootherstep(edge0: number, edge1: number, x: number): number {
    if (edge0 === edge1) {
      return x < edge0 ? 0 : 1;
    }
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private createGeometry(nSegments: number): THREE.BufferGeometry {
    // Geometry creation
    const segments = Math.max(1, Math.floor(nSegments));
    const height = config.BLADE_HEIGHT;
    const halfWidthBase = config.BLADE_WIDTH * 0.5;

    const rowCount = segments;
    const vertexCount = rowCount * 2 + 1;
    const quadCount = Math.max(0, rowCount - 1);
    const indexCount = quadCount * 6 + 3;

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint8Array(indexCount);

    const taper = (t: number) => halfWidthBase * (1.0 - 0.7 * t);

    let idx = 0;
    for (let row = 0; row < rowCount; row++) {
      const v = row / segments;
      const y = v * height;
      const halfWidth = taper(v);

      const left = row * 2;
      const right = left + 1;

      positions[3 * left + 0] = -halfWidth;
      positions[3 * left + 1] = y;
      positions[3 * left + 2] = 0;

      positions[3 * right + 0] = halfWidth;
      positions[3 * right + 1] = y;
      positions[3 * right + 2] = 0;

      uvs[2 * left + 0] = 0.0;
      uvs[2 * left + 1] = v;
      uvs[2 * right + 0] = 1.0;
      uvs[2 * right + 1] = v;

      if (row > 0) {
        const prevLeft = (row - 1) * 2;
        const prevRight = prevLeft + 1;

        indices[idx++] = prevLeft;
        indices[idx++] = prevRight;
        indices[idx++] = right;

        indices[idx++] = prevLeft;
        indices[idx++] = right;
        indices[idx++] = left;
      }
    }

    const tip = rowCount * 2;
    positions[3 * tip + 0] = 0;
    positions[3 * tip + 1] = height;
    positions[3 * tip + 2] = 0;
    uvs[2 * tip + 0] = 0.5;
    uvs[2 * tip + 1] = 1.0;

    const lastLeft = (rowCount - 1) * 2;
    const lastRight = lastLeft + 1;
    indices[idx++] = lastLeft;
    indices[idx++] = lastRight;
    indices[idx++] = tip;

    const geom = new THREE.BufferGeometry();

    const posAttribute = new THREE.BufferAttribute(positions, 3);
    posAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("position", posAttribute);

    const uvAttribute = new THREE.BufferAttribute(uvs, 2);
    uvAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setAttribute("uv", uvAttribute);

    const indexAttribute = new THREE.BufferAttribute(indices, 1);
    indexAttribute.setUsage(THREE.StaticDrawUsage);
    geom.setIndex(indexAttribute);

    return geom;
  }

  update(_deltaTime: number): void {
    if (!this.grassInitialized || !this.renderer) return;

    const camera = this.world.camera;
    if (!camera) return;

    const cameraPos = camera.position;

    // Get actual player position for trail effect (may differ from camera in 3rd person)
    // Use player.node.position (the 3D mesh position) not player.position (entity data)
    const players = this.world.getPlayers?.() as
      | { node?: { position?: THREE.Vector3 } }[]
      | undefined;
    const player = players?.[0];
    const playerPos = player?.node?.position ?? cameraPos;

    // Get camera forward direction for frustum culling
    const cameraForward = new THREE.Vector3();
    camera.getWorldDirection(cameraForward);

    // ========== GPU-DRIVEN TILE UPDATE ==========
    // Update shared tile uniforms (used by vertex shader for all tile positioning/culling)
    // This is the ONLY per-frame work needed - everything else happens in shaders
    tileUniforms.uTileCameraPos.value.copy(cameraPos);
    tileUniforms.uTileCameraForward.value.copy(cameraForward);

    if (!this.useBladeGrass || !this.mesh || !this.ssbo) {
      return;
    }

    // Calculate camera movement delta for position wrapping
    const deltaX = cameraPos.x - this.lastCameraX;
    const deltaZ = cameraPos.z - this.lastCameraZ;
    this.lastCameraX = cameraPos.x;
    this.lastCameraZ = cameraPos.z;

    // ========== STREAMING HEIGHTMAP UPDATE ==========
    // Check if heightmap needs re-centering based on player movement
    this.checkHeightmapRecenter(cameraPos.x, cameraPos.z);

    // ========== GRID-BASED EXCLUSION UPDATE ==========
    // Update grid-based exclusion (for collision-blocked tiles: rocks, trees)
    if (this.useGridExclusion && this.exclusionGrid) {
      this.exclusionGrid.update(cameraPos.x, cameraPos.z);
    }

    // ========== ROAD EXCLUSION POLLING ==========
    // Poll for road data if not yet loaded (handles timing issues with road generation)
    if (!this.roadTextureLoaded) {
      this.roadPollCounter++;
      // Check every 10 frames (~167ms at 60fps) for faster response
      if (this.roadPollCounter >= 10) {
        this.roadPollCounter = 0;
        this.checkExistingRoads();
      }
    }

    // ========== LEGACY EXCLUSION TEXTURE UPDATE ==========
    // ALWAYS update legacy texture (for buildings, duel arenas that don't set collision flags)
    // This runs in ADDITION to grid-based, not instead of
    this.checkExclusionRecenter(cameraPos.x, cameraPos.z);

    // ========== MULTI-CHARACTER BENDING UPDATE ==========
    // Update character influence manager for multi-character grass bending
    if (this.useMultiCharacterBending && this.characterInfluence) {
      this.characterInfluence.updateFromWorld(cameraPos);
    }

    // Update uniforms
    uniforms.uCameraPosition.value.copy(cameraPos); // For distance culling
    uniforms.uPlayerPosition.value.copy(playerPos); // For trail effect only
    uniforms.uPlayerDeltaXZ.value.set(deltaX, deltaZ); // For position wrapping

    // Update heightmap center for GPU shader sampling
    // The shader needs to know where the heightmap is centered to sample correctly
    uHeightmapCenterX.value = this.heightmapCenterX;
    uHeightmapCenterZ.value = this.heightmapCenterZ;

    // NOTE: Lighting is controlled by Environment.updateGrassLighting()
    // via setLightIntensity(). DO NOT override here - let Environment
    // be the authoritative source for day/night cycle.

    // Camera frustum data
    const proj = camera.projectionMatrix;
    uniforms.uCameraMatrix.value.copy(proj).multiply(camera.matrixWorldInverse);
    camera.getWorldDirection(uniforms.uCameraForward.value);

    // Move grass meshes to follow CAMERA (density is camera-based)
    this.mesh.position.set(cameraPos.x, 0, cameraPos.z);

    // ========== STATIC COMPUTE PASS ==========
    // Run static pass (heightmap, exclusions, dirt, water) only when player moves significantly
    // This avoids re-running expensive terrain checks every frame
    const staticDx = cameraPos.x - this.lastStaticComputeX;
    const staticDz = cameraPos.z - this.lastStaticComputeZ;
    const staticDistSq = staticDx * staticDx + staticDz * staticDz;
    const thresholdSq =
      ProceduralGrassSystem.STATIC_COMPUTE_THRESHOLD *
      ProceduralGrassSystem.STATIC_COMPUTE_THRESHOLD;

    if (!this.staticComputeInitialized || staticDistSq > thresholdSq) {
      this.renderer.computeAsync(this.ssbo.computeStatic);
      this.lastStaticComputeX = cameraPos.x;
      this.lastStaticComputeZ = cameraPos.z;
      this.staticComputeInitialized = true;
    }

    // ========== DYNAMIC COMPUTE PASS ==========
    // Run dynamic pass every frame (wind, trail, frustum, distance fade)
    this.renderer.computeAsync(this.ssbo.computeUpdate);
  }

  // Public API
  getMesh(): THREE.InstancedMesh | null {
    return this.mesh;
  }

  getLOD1Mesh(): THREE.InstancedMesh | null {
    return this.gpuLod1Mesh;
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
    if (this.gpuLod1Mesh) this.gpuLod1Mesh.visible = visible;
  }

  isVisible(): boolean {
    return this.mesh?.visible ?? this.gpuLod1Mesh?.visible ?? false;
  }

  /**
   * Set road influence texture for grass culling on roads.
   * Call this after roads are generated to prevent grass from growing on roads.
   *
   * @param data - Float32Array of road influence values (0-1)
   * @param width - Texture width
   * @param height - Texture height
   * @param worldSize - World size in meters covered by the texture
   * @param centerX - World center X (default 0)
   * @param centerZ - World center Z (default 0)
   */
  setRoadInfluenceTexture(
    data: Float32Array,
    width: number,
    height: number,
    worldSize: number,
    centerX: number = 0,
    centerZ: number = 0,
  ): void {
    // Update shared road mask texture and uniforms
    // This preserves the texture node reference compiled into shaders
    setRoadInfluenceTextureData(
      data,
      width,
      height,
      worldSize,
      centerX,
      centerZ,
    );

    // Mark road texture as loaded to stop polling
    this.roadTextureLoaded = true;

    // Force SSBO to recalculate visibility on next frame
    // This ensures grass is culled immediately after road texture is set
    if (this.ssbo) {
      // Touch the camera position to trigger a visibility update
      uniforms.uCameraPosition.value.x += 0.001;
      uniforms.uCameraPosition.value.x -= 0.001;
    }

    console.log(
      `[ProceduralGrass] ✅ Road influence texture updated: ${width}x${height}, ` +
        `${worldSize}m coverage, center (${centerX}, ${centerZ})`,
    );
  }

  /** Clear road influence texture (grass will grow everywhere) */
  clearRoadInfluenceTexture(): void {
    // Reset shared road mask to dummy (0 = no road influence)
    clearRoadInfluenceMask();
    // Reset flag to allow re-polling
    this.roadTextureLoaded = false;
    this.roadPollCounter = 0;
    console.log(
      "[ProceduralGrass] Road influence texture cleared (reset to empty)",
    );
  }

  /** Set road influence culling threshold (0-1). Lower = more aggressive culling */
  setRoadInfluenceThreshold(threshold: number): void {
    setRoadInfluenceMaskThreshold(threshold);
  }

  /** Get current road influence culling threshold */
  getRoadInfluenceThreshold(): number {
    return getRoadInfluenceMaskThreshold();
  }

  static getConfig(): typeof config {
    return config;
  }

  /** Set grass quality preset. Must be called BEFORE initialization. */
  setQuality(quality: GrassQuality): void {
    this.quality = quality;
  }

  /** Get current quality preset */
  getQuality(): GrassQuality {
    return this.quality;
  }

  // ============================================================================
  // DEBUG API - Color pickers and parameter controls
  // Call from console: world.getSystem("proceduralGrass").setBaseColor(r, g, b)
  // ============================================================================

  /** Set grass base color (at root). RGB values 0-1 */
  setBaseColor(r: number, g: number, b: number): void {
    uniforms.uBaseColor.value.setRGB(r, g, b);
  }

  getBaseColor(): { r: number; g: number; b: number } {
    const c = uniforms.uBaseColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set grass tip color (at top). RGB values 0-1 */
  setTipColor(r: number, g: number, b: number): void {
    uniforms.uTipColor.value.setRGB(r, g, b);
  }

  getTipColor(): { r: number; g: number; b: number } {
    const c = uniforms.uTipColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set day/night mix. 0 = night, 1 = day */
  setDayNightMix(mix: number): void {
    uniforms.uDayNightMix.value = mix;
    tileUniforms.uTileDayNightMix.value = mix;
  }

  /** Set sun direction for terrain-based lighting (normalized vector) */
  setSunDirection(x: number, y: number, z: number): void {
    uniforms.uSunDirection.value.set(x, y, z).normalize();
  }

  /** Get sun direction for terrain-based lighting */
  getSunDirection(): { x: number; y: number; z: number } {
    const d = uniforms.uSunDirection.value;
    return { x: d.x, y: d.y, z: d.z };
  }

  /** Set terrain lighting parameters */
  setTerrainLighting(ambient: number, diffuse: number): void {
    uniforms.uTerrainLightAmbient.value = ambient;
    uniforms.uTerrainLightDiffuse.value = diffuse;
  }

  /** Set day color multiplier (RGB 0-1). Default is white (1,1,1) for full brightness */
  setDayColor(r: number, g: number, b: number): void {
    uniforms.uDayColor.value.setRGB(r, g, b);
    tileUniforms.uTileDayColor.value.setRGB(r, g, b);
  }

  /** Get current day color */
  getDayColor(): { r: number; g: number; b: number } {
    const c = uniforms.uDayColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Debug: Print exclusion system state to console */
  async debugExclusionState(): Promise<void> {
    console.group("[ProceduralGrass] 🔍 EXCLUSION DEBUG STATE");

    // Module-level state
    console.log("Module-level textures:");
    const roadTex = getRoadInfluenceMaskTexture();
    console.log(
      `  roadInfluenceTexture: ${roadTex ? `${roadTex.image.width}x${roadTex.image.height}` : "NULL"}`,
    );
    console.log(
      `  roadInfluenceTextureNode: ${roadInfluenceTextureNode ? "SET" : "NULL"}`,
    );
    console.log(
      `  exclusionTexture: ${exclusionTexture ? `${exclusionTexture.image.width}x${exclusionTexture.image.height}` : "NULL"}`,
    );
    console.log(
      `  exclusionTextureNode: ${exclusionTextureNode ? "SET" : "NULL"}`,
    );
    console.log(
      `  gridExclusionTextureNode: ${gridExclusionTextureNode ? "SET" : "NULL"}`,
    );
    console.log(`  useGridBasedExclusion: ${useGridBasedExclusion}`);

    // Uniforms
    console.log("Exclusion uniforms:");
    console.log(`  uExclusionCenterX: ${uExclusionCenterX.value}`);
    console.log(`  uExclusionCenterZ: ${uExclusionCenterZ.value}`);
    console.log(`  uExclusionWorldSize: ${uExclusionWorldSize.value}`);
    console.log(`  uGridExclusionCenterX: ${uGridExclusionCenterX.value}`);
    console.log(`  uGridExclusionCenterZ: ${uGridExclusionCenterZ.value}`);
    console.log(`  uGridExclusionWorldSize: ${uGridExclusionWorldSize.value}`);

    // Instance state
    console.log("Instance state:");
    console.log(`  exclusionCenterX: ${this.exclusionCenterX}`);
    console.log(`  exclusionCenterZ: ${this.exclusionCenterZ}`);
    console.log(`  exclusionInitialized: ${this.exclusionInitialized}`);
    console.log(`  pendingBlockers.length: ${this.pendingBlockers.length}`);
    console.log(`  exclusionTextureDirty: ${this.exclusionTextureDirty}`);

    // Check texture data
    if (exclusionTexture && exclusionTexture.image.data) {
      const data = exclusionTexture.image.data as Float32Array;
      let nonZero = 0;
      let maxVal = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > 0) nonZero++;
        if (data[i] > maxVal) maxVal = data[i];
      }
      console.log(
        `  Exclusion texture stats: ${nonZero}/${data.length} non-zero (${((nonZero / data.length) * 100).toFixed(2)}%), max=${maxVal.toFixed(3)}`,
      );
    }

    // Check GrassExclusionManager
    const { getGrassExclusionManager } = await import(
      "./GrassExclusionManager"
    );
    const manager = getGrassExclusionManager();
    const rectBlockers = manager.getRectangularBlockers();
    const circBlockers = manager.getCircularBlockers();
    console.log("GrassExclusionManager:");
    console.log(`  Rectangular blockers: ${rectBlockers.length}`);
    console.log(`  Circular blockers: ${circBlockers.length}`);
    if (rectBlockers.length > 0) {
      console.log("  First 3 rect blockers:");
      rectBlockers.slice(0, 3).forEach((b) => {
        console.log(
          `    ${b.id}: center=(${b.centerX.toFixed(0)}, ${b.centerZ.toFixed(0)}), size=${b.width.toFixed(0)}x${b.depth.toFixed(0)}`,
        );
      });
    }

    console.groupEnd();
  }

  /** Force refresh exclusion texture now (useful for debugging) */
  async forceRefreshExclusion(): Promise<void> {
    console.log(
      "[ProceduralGrass] 🔃 Force refresh exclusion texture requested",
    );
    const camera = this.world.camera;
    const centerX = camera?.position.x ?? 0;
    const centerZ = camera?.position.z ?? 0;
    await this.regenerateExclusionTextureAroundPoint(centerX, centerZ);
  }

  /** Set night color multiplier (RGB 0-1). Tints grass at night */
  setNightColor(r: number, g: number, b: number): void {
    uniforms.uNightColor.value.setRGB(r, g, b);
    tileUniforms.uTileNightColor.value.setRGB(r, g, b);
  }

  /** Get current night color */
  getNightColor(): { r: number; g: number; b: number } {
    const c = uniforms.uNightColor.value;
    return { r: c.r, g: c.g, b: c.b };
  }

  /** Set wind strength. 0-2 typical range */
  setWindStrength(strength: number): void {
    uniforms.uWindStrength.value = strength;
  }

  /** Get wind strength */
  getWindStrength(): number {
    return uniforms.uWindStrength.value;
  }

  /** Set wind speed. 0-1 typical range */
  setWindSpeed(speed: number): void {
    uniforms.uWindSpeed.value = speed;
  }

  /** Get wind speed */
  getWindSpeed(): number {
    return uniforms.uWindSpeed.value;
  }

  /** Set color mix factor (how much tip color shows). 0-1 */
  setColorMixFactor(factor: number): void {
    uniforms.uColorMixFactor.value = factor;
  }

  /** Set color variation strength. 0-3 typical range */
  setColorVariation(strength: number): void {
    uniforms.uColorVariationStrength.value = strength;
  }

  /** Set AO (ambient occlusion) scale. 0-2 typical range */
  setAoScale(scale: number): void {
    uniforms.uAoScale.value = scale;
  }

  /** Set wind shade strength (darkening when wind bends grass). 0-1 */
  setWindShade(strength: number): void {
    uniforms.uBaseWindShade.value = strength;
  }

  /** Set trail radius for player distortion (meters) */
  setTrailRadius(radius: number): void {
    uniforms.uTrailRadius.value = radius;
    uniforms.uTrailRadiusSquared.value = radius * radius;
  }

  /** Get trail radius. Meters */
  getTrailRadius(): number {
    return uniforms.uTrailRadius.value;
  }

  /** Set wind scale (affects wind pattern size). Higher = larger waves */
  setWindScale(scale: number): void {
    uniforms.uvWindScale.value = scale;
  }

  /** Get wind scale */
  getWindScale(): number {
    return uniforms.uvWindScale.value;
  }

  /** Set stochastic culling inner radius (full density within this). Meters */
  setCullingR0(radius: number): void {
    uniforms.uR0.value = radius;
  }

  /** Get stochastic culling inner radius. Meters */
  getCullingR0(): number {
    return uniforms.uR0.value;
  }

  /** Set stochastic culling outer radius (thin to minimum at this). Meters */
  setCullingR1(radius: number): void {
    uniforms.uR1.value = radius;
  }

  /** Get stochastic culling outer radius. Meters */
  getCullingR1(): number {
    return uniforms.uR1.value;
  }

  /** Set minimum density at outer culling radius. 0-1 (0 = cull all, 1 = keep all) */
  setCullingPMin(pMin: number): void {
    uniforms.uPMin.value = pMin;
  }

  /** Get minimum density at outer culling radius */
  getCullingPMin(): number {
    return uniforms.uPMin.value;
  }

  /** Set distance fade start (begin fading at this distance). Meters */
  setFadeStart(distance: number): void {
    uniforms.uFadeStart.value = distance;
  }

  /** Get distance fade start. Meters */
  getFadeStart(): number {
    return uniforms.uFadeStart.value;
  }

  /** Set distance fade end (fully faded at this distance). Meters */
  setFadeEnd(distance: number): void {
    uniforms.uFadeEnd.value = distance;
  }

  /** Get distance fade end. Meters */
  getFadeEnd(): number {
    return uniforms.uFadeEnd.value;
  }

  // ========== LOD1 FADE CONTROLS ==========

  /** Set LOD1 fade in start (begin appearing at this distance). Meters */
  setLOD1FadeInStart(distance: number): void {
    tileUniforms.uLod1FadeInStart.value = distance;
  }

  /** Get LOD1 fade in start. Meters */
  getLOD1FadeInStart(): number {
    return tileUniforms.uLod1FadeInStart.value;
  }

  /** Set LOD1 fade in end (fully visible at this distance). Meters */
  setLOD1FadeInEnd(distance: number): void {
    tileUniforms.uLod1FadeInEnd.value = distance;
  }

  /** Get LOD1 fade in end. Meters */
  getLOD1FadeInEnd(): number {
    return tileUniforms.uLod1FadeInEnd.value;
  }

  /** Set LOD1 fade out start (begin fading at this distance). Meters */
  setLOD1FadeOutStart(distance: number): void {
    tileUniforms.uLod1FadeOutStart.value = distance;
  }

  /** Get LOD1 fade out start. Meters */
  getLOD1FadeOutStart(): number {
    return tileUniforms.uLod1FadeOutStart.value;
  }

  /** Set LOD1 fade out end (fully invisible at this distance). Meters */
  setLOD1FadeOutEnd(distance: number): void {
    tileUniforms.uLod1FadeOutEnd.value = distance;
  }

  /** Get LOD1 fade out end. Meters */
  getLOD1FadeOutEnd(): number {
    return tileUniforms.uLod1FadeOutEnd.value;
  }

  /** Get day/night mix value. 0 = night, 1 = day */
  getDayNightMix(): number {
    return uniforms.uDayNightMix.value;
  }

  /** Get all current uniform values for debugging */
  getDebugInfo(): Record<string, number | { r: number; g: number; b: number }> {
    return {
      baseColor: this.getBaseColor(),
      tipColor: this.getTipColor(),
      dayColor: this.getDayColor(),
      nightColor: this.getNightColor(),
      dayNightMix: uniforms.uDayNightMix.value,
      windStrength: uniforms.uWindStrength.value,
      windSpeed: uniforms.uWindSpeed.value,
      colorMixFactor: uniforms.uColorMixFactor.value,
      colorVariation: uniforms.uColorVariationStrength.value,
      aoScale: uniforms.uAoScale.value,
      windShade: uniforms.uBaseWindShade.value,
      trailRadius: uniforms.uTrailRadius.value,
      cullingR0: uniforms.uR0.value,
      cullingR1: uniforms.uR1.value,
      fadeStart: uniforms.uFadeStart.value,
      fadeEnd: uniforms.uFadeEnd.value,
    };
  }

  /** Static access to uniforms for external debug panels */
  static getUniforms() {
    return uniforms;
  }

  static getLOD1Uniforms() {
    return tileUniforms;
  }

  stop(): void {
    // Remove terrain event listeners
    if (this.onTileGeneratedBound) {
      // Type cast needed for EventEmitter compatibility
      this.world.off(
        "terrain:tile:generated",
        this.onTileGeneratedBound as (...args: unknown[]) => void,
      );
      this.onTileGeneratedBound = null;
    }

    // Remove road event listeners
    if (this.onRoadsGeneratedBound) {
      this.world.off("roads:generated", this.onRoadsGeneratedBound);
      this.onRoadsGeneratedBound = null;
    }
    if (this.onRoadMaskReadyBound) {
      this.world.off("roads:mask:ready", this.onRoadMaskReadyBound);
      this.onRoadMaskReadyBound = null;
    }

    // LOD0 cleanup
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh = null;
    this.ssbo = null;

    // GPU-driven LOD1 cleanup
    if (this.gpuLod1Mesh) {
      this.gpuLod1Mesh.removeFromParent();
      this.gpuLod1Mesh.geometry.dispose();
      (this.gpuLod1Mesh.material as THREE.Material)?.dispose();
      this.gpuLod1Mesh = null;
    }

    // Streaming heightmap cleanup
    this.heightmapData = null;
    this.terrainSystem = null;
    this.heightmapInitialized = false;

    this.grassInitialized = false;
    this.noiseTexture?.dispose();
    noiseAtlasTexture = null;
    heightmapTexture?.dispose();
    heightmapTexture = null;
    heightmapTextureNode = null;

    // Road influence texture cleanup - reset shared mask to dummy
    clearRoadInfluenceMask();
    this.roadTextureLoaded = false;
    this.roadPollCounter = 0;

    // Exclusion texture cleanup - reset to dummy but don't nullify (shader holds reference)
    const dummyExcl = new Float32Array([0]);
    exclusionTexture.image = { data: dummyExcl, width: 1, height: 1 };
    exclusionTexture.needsUpdate = true;
    uExclusionWorldSize.value = 1;
    uExclusionCenterX.value = 0;
    uExclusionCenterZ.value = 0;
    this.pendingBlockers = [];
    this.exclusionTextureDirty = false;
    this.exclusionBlockerBuffer = null;
    this.exclusionOutputBuffer = null;
    this.exclusionComputeNode = null;
    if (this.exclusionRefreshTimer) {
      clearTimeout(this.exclusionRefreshTimer);
      this.exclusionRefreshTimer = null;
    }

    // Unsubscribe from GrassExclusionManager
    if (this.exclusionManagerUnsubscribe) {
      this.exclusionManagerUnsubscribe();
      this.exclusionManagerUnsubscribe = null;
    }

    // Cleanup new grid-based exclusion system
    if (this.exclusionGrid) {
      disposeGrassExclusionGrid();
      this.exclusionGrid = null;
    }

    // Cleanup multi-character bending system
    if (this.characterInfluence) {
      disposeCharacterInfluenceManager();
      this.characterInfluence = null;
    }
  }
}

// ============================================================================
// TERRAIN SYSTEM INTERFACE
// ============================================================================

interface TerrainSystemInterface {
  getHeightAt(worldX: number, worldZ: number): number;
  isInFlatZone?(worldX: number, worldZ: number): boolean;
}

// ============================================================================
// ROAD NETWORK SYSTEM INTERFACE
// ============================================================================

interface RoadInfluenceTextureData {
  data: Float32Array;
  width: number;
  height: number;
  worldSize: number;
  centerX: number;
  centerZ: number;
}

interface RoadNetworkSystemInterface {
  generateRoadInfluenceTexture(
    textureSize?: number,
    worldSize?: number,
    extraBlendWidth?: number,
  ): {
    data: Float32Array;
    width: number;
    height: number;
    worldSize: number;
  } | null;
  getRoadInfluenceTextureData?: () => RoadInfluenceTextureData | null;
  getRoads?: () => Array<{ id: string }>;
  getRoadInfluenceAt?(
    worldX: number,
    worldZ: number,
    extraBlendWidth?: number,
  ): number;
}
