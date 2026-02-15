/**
 * Grass Generation Types
 *
 * Configuration types and presets for procedural grass generation.
 * Used by both the game engine (ProceduralGrass system) and Asset Forge.
 *
 * @module GrassTypes
 */

// ============================================================================
// GRASS CONFIGURATION
// ============================================================================

/**
 * Configuration for a single grass blade
 */
export interface GrassBladeConfig {
  /** Height of grass blade in world units */
  height: number;
  /** Width of grass blade at base */
  width: number;
  /** Number of segments for curved blade geometry */
  segments: number;
  /** Width taper from base to tip (0-1, where 1 = full width at tip) */
  tipTaper: number;
}

/**
 * Wind animation configuration
 */
export interface GrassWindConfig {
  /** Overall wind strength multiplier */
  strength: number;
  /** Base wind animation speed */
  speed: number;
  /** Gust overlay speed (slower, large-scale movement) */
  gustSpeed: number;
  /** Flutter intensity at blade tips */
  flutterIntensity: number;
  /** Wind direction (normalized XZ) */
  direction: { x: number; z: number };
}

/**
 * Grass color configuration
 */
export interface GrassColorConfig {
  /** Base color at grass root */
  baseColor: { r: number; g: number; b: number };
  /** Tip color at grass top */
  tipColor: { r: number; g: number; b: number };
  /** Dark/dry variation color */
  darkColor: { r: number; g: number; b: number };
  /** Mix factor for dry/dead grass (0-1) */
  dryColorMix: number;
  /** Ambient occlusion strength at base */
  aoStrength: number;
}

/**
 * LOD (Level of Detail) configuration for grass rendering
 */
export interface GrassLODConfig {
  /** LOD0: Individual blades - full density radius */
  lod0FullDensityRadius: number;
  /** LOD0: Radius where density starts falling off */
  lod0FalloffRadius: number;
  /** LOD0: Fade start distance */
  lod0FadeStart: number;
  /** LOD0: Fade end distance */
  lod0FadeEnd: number;
  /** LOD1: Grass cards fade in start */
  lod1FadeInStart: number;
  /** LOD1: Grass cards fade in end */
  lod1FadeInEnd: number;
  /** LOD1: Grass cards fade out start */
  lod1FadeOutStart: number;
  /** LOD1: Grass cards fade out end */
  lod1FadeOutEnd: number;
}

/**
 * Complete grass generation configuration
 */
export interface GrassConfig {
  blade: GrassBladeConfig;
  wind: GrassWindConfig;
  color: GrassColorConfig;
  lod: GrassLODConfig;
  /** Grass density per square meter */
  density: number;
  /** Patch size in world units */
  patchSize: number;
}

// ============================================================================
// BIOME PRESETS
// ============================================================================

/**
 * Biome preset for grass configuration
 */
export interface GrassBiomePreset {
  name: string;
  description: string;
  config: Partial<GrassConfig>;
}

/**
 * Default grass blade configuration
 */
export const DEFAULT_BLADE_CONFIG: GrassBladeConfig = {
  height: 0.5,
  width: 0.04,
  segments: 4,
  tipTaper: 0.3,
};

/**
 * Default wind configuration
 */
export const DEFAULT_WIND_CONFIG: GrassWindConfig = {
  strength: 1.0,
  speed: 1.2,
  gustSpeed: 0.4,
  flutterIntensity: 0.15,
  direction: { x: 1, z: 0.3 },
};

/**
 * Default color configuration (matches terrain shader)
 */
export const DEFAULT_COLOR_CONFIG: GrassColorConfig = {
  // Matches TerrainShader.ts grassGreen (0.3, 0.55, 0.15)
  baseColor: { r: 0.26, g: 0.48, b: 0.12 },
  tipColor: { r: 0.29, g: 0.53, b: 0.14 },
  darkColor: { r: 0.22, g: 0.42, b: 0.1 },
  dryColorMix: 0.2,
  aoStrength: 0.5,
};

/**
 * Default LOD configuration
 */
export const DEFAULT_LOD_CONFIG: GrassLODConfig = {
  lod0FullDensityRadius: 8,
  lod0FalloffRadius: 18,
  lod0FadeStart: 12,
  lod0FadeEnd: 20,
  lod1FadeInStart: 5,
  lod1FadeInEnd: 10,
  lod1FadeOutStart: 35,
  lod1FadeOutEnd: 100,
};

/**
 * Default complete grass configuration
 */
export const DEFAULT_GRASS_CONFIG: GrassConfig = {
  blade: DEFAULT_BLADE_CONFIG,
  wind: DEFAULT_WIND_CONFIG,
  color: DEFAULT_COLOR_CONFIG,
  lod: DEFAULT_LOD_CONFIG,
  density: 8,
  patchSize: 20,
};

/**
 * Biome presets for different environments
 */
export const GRASS_BIOME_PRESETS: Record<string, GrassBiomePreset> = {
  plains: {
    name: "Plains",
    description: "Open grassland with moderate wind",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.45 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 1.2 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        baseColor: { r: 0.3, g: 0.55, b: 0.15 },
        tipColor: { r: 0.38, g: 0.62, b: 0.22 },
        dryColorMix: 0.15,
      },
      density: 10,
    },
  },
  forest: {
    name: "Forest",
    description: "Shorter grass under tree canopy",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.35 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 0.6 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        baseColor: { r: 0.22, g: 0.42, b: 0.1 },
        tipColor: { r: 0.3, g: 0.55, b: 0.15 },
        dryColorMix: 0.1,
      },
      density: 5,
    },
  },
  hills: {
    name: "Hills",
    description: "Windswept hillside grass",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.38 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 1.5 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        dryColorMix: 0.25,
      },
      density: 7,
    },
  },
  swamp: {
    name: "Swamp",
    description: "Tall, wet marsh grass",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.55 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 0.4 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        baseColor: { r: 0.22, g: 0.42, b: 0.1 },
        tipColor: { r: 0.3, g: 0.55, b: 0.15 },
        dryColorMix: 0.05,
      },
      density: 6,
    },
  },
  savanna: {
    name: "Savanna",
    description: "Tall, dry savanna grass",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.7 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 1.8 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        baseColor: { r: 0.42, g: 0.55, b: 0.23 },
        tipColor: { r: 0.55, g: 0.66, b: 0.32 },
        dryColorMix: 0.4,
      },
      density: 4,
    },
  },
  tundra: {
    name: "Tundra",
    description: "Short, sparse arctic grass",
    config: {
      blade: { ...DEFAULT_BLADE_CONFIG, height: 0.2 },
      wind: { ...DEFAULT_WIND_CONFIG, strength: 2.0 },
      color: {
        ...DEFAULT_COLOR_CONFIG,
        baseColor: { r: 0.35, g: 0.45, b: 0.25 },
        tipColor: { r: 0.45, g: 0.55, b: 0.35 },
        dryColorMix: 0.3,
      },
      density: 3,
    },
  },
};

/**
 * Get a biome preset by name
 */
export function getGrassBiomePreset(
  name: string,
): GrassBiomePreset | undefined {
  return GRASS_BIOME_PRESETS[name.toLowerCase()];
}

/**
 * Get all available biome preset names
 */
export function getGrassBiomePresetNames(): string[] {
  return Object.keys(GRASS_BIOME_PRESETS);
}

/**
 * Merge a partial config with defaults
 */
export function mergeGrassConfig(partial: Partial<GrassConfig>): GrassConfig {
  return {
    blade: { ...DEFAULT_BLADE_CONFIG, ...partial.blade },
    wind: { ...DEFAULT_WIND_CONFIG, ...partial.wind },
    color: { ...DEFAULT_COLOR_CONFIG, ...partial.color },
    lod: { ...DEFAULT_LOD_CONFIG, ...partial.lod },
    density: partial.density ?? DEFAULT_GRASS_CONFIG.density,
    patchSize: partial.patchSize ?? DEFAULT_GRASS_CONFIG.patchSize,
  };
}
