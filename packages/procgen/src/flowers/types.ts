/**
 * Flower Generation Types
 *
 * Configuration types and presets for procedural flower generation.
 * Used by both the game engine (ProceduralFlowers system) and Asset Forge.
 *
 * @module FlowerTypes
 */

// Note: THREE types are used in FlowerMaterialUniforms which is defined in FlowerMaterialTSL.ts

// ============================================================================
// FLOWER CONFIGURATION
// ============================================================================

/**
 * Configuration for flower appearance
 */
export interface FlowerAppearanceConfig {
  /** Minimum flower scale */
  minScale: number;
  /** Maximum flower scale */
  maxScale: number;
  /** Flower width (for billboard sprites) */
  width: number;
  /** Flower height (for billboard sprites) */
  height: number;
}

/**
 * Flower color configuration
 */
export interface FlowerColorConfig {
  /** Primary tint color 1 */
  color1: { r: number; g: number; b: number };
  /** Primary tint color 2 */
  color2: { r: number; g: number; b: number };
  /** Color strength multiplier */
  colorStrength: number;
  /** Use procedural colors (vs texture) */
  proceduralColors: boolean;
}

/**
 * Procedural flower color palette
 */
export interface FlowerPalette {
  pink: { r: number; g: number; b: number };
  yellow: { r: number; g: number; b: number };
  purple: { r: number; g: number; b: number };
  orange: { r: number; g: number; b: number };
  white: { r: number; g: number; b: number };
  red: { r: number; g: number; b: number };
}

/**
 * Flower LOD configuration
 */
export interface FlowerLODConfig {
  /** Full density radius */
  fullDensityRadius: number;
  /** Falloff radius */
  falloffRadius: number;
  /** Fade start distance */
  fadeStart: number;
  /** Fade end distance */
  fadeEnd: number;
}

/**
 * Complete flower generation configuration
 */
export interface FlowerConfig {
  appearance: FlowerAppearanceConfig;
  color: FlowerColorConfig;
  lod: FlowerLODConfig;
  /** Flowers per tile */
  density: number;
  /** Tile size in world units */
  tileSize: number;
  /** Flowers per side (grid) */
  flowersPerSide: number;
}

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Default flower appearance
 */
export const DEFAULT_FLOWER_APPEARANCE: FlowerAppearanceConfig = {
  minScale: 0.15,
  maxScale: 0.25,
  width: 0.5,
  height: 1.0,
};

/**
 * Default flower colors
 */
export const DEFAULT_FLOWER_COLORS: FlowerColorConfig = {
  color1: { r: 0.02, g: 0.14, b: 0.33 },
  color2: { r: 0.99, g: 0.64, b: 0.0 },
  colorStrength: 0.275,
  proceduralColors: true,
};

/**
 * Default flower palette for procedural generation
 */
export const DEFAULT_FLOWER_PALETTE: FlowerPalette = {
  pink: { r: 1.0, g: 0.3, b: 0.5 },
  yellow: { r: 1.0, g: 0.8, b: 0.2 },
  purple: { r: 0.6, g: 0.3, b: 0.8 },
  orange: { r: 1.0, g: 0.5, b: 0.2 },
  white: { r: 1.0, g: 0.95, b: 0.9 },
  red: { r: 0.9, g: 0.2, b: 0.2 },
};

/**
 * Default flower LOD configuration
 */
export const DEFAULT_FLOWER_LOD: FlowerLODConfig = {
  fullDensityRadius: 8,
  falloffRadius: 18,
  fadeStart: 12,
  fadeEnd: 20,
};

/**
 * Default complete flower configuration
 */
export const DEFAULT_FLOWER_CONFIG: FlowerConfig = {
  appearance: DEFAULT_FLOWER_APPEARANCE,
  color: DEFAULT_FLOWER_COLORS,
  lod: DEFAULT_FLOWER_LOD,
  density: 2300,
  tileSize: 50,
  flowersPerSide: 48,
};

// ============================================================================
// BIOME PRESETS
// ============================================================================

/**
 * Flower biome preset
 */
export interface FlowerBiomePreset {
  name: string;
  description: string;
  config: Partial<FlowerConfig>;
}

/**
 * Flower biome presets
 */
export const FLOWER_BIOME_PRESETS: Record<string, FlowerBiomePreset> = {
  meadow: {
    name: "Meadow",
    description: "Colorful wildflower meadow",
    config: {
      density: 3000,
      color: {
        ...DEFAULT_FLOWER_COLORS,
        colorStrength: 0.4,
      },
    },
  },
  alpine: {
    name: "Alpine",
    description: "Mountain wildflowers (edelweiss-style)",
    config: {
      density: 1500,
      appearance: {
        ...DEFAULT_FLOWER_APPEARANCE,
        minScale: 0.1,
        maxScale: 0.18,
      },
      color: {
        ...DEFAULT_FLOWER_COLORS,
        color1: { r: 0.9, g: 0.9, b: 0.95 },
        color2: { r: 0.8, g: 0.7, b: 0.9 },
      },
    },
  },
  tropical: {
    name: "Tropical",
    description: "Bright tropical flowers",
    config: {
      density: 2500,
      appearance: {
        ...DEFAULT_FLOWER_APPEARANCE,
        minScale: 0.2,
        maxScale: 0.35,
      },
      color: {
        ...DEFAULT_FLOWER_COLORS,
        colorStrength: 0.5,
      },
    },
  },
  desert: {
    name: "Desert",
    description: "Sparse desert blooms",
    config: {
      density: 500,
      appearance: {
        ...DEFAULT_FLOWER_APPEARANCE,
        minScale: 0.08,
        maxScale: 0.15,
      },
      color: {
        ...DEFAULT_FLOWER_COLORS,
        color1: { r: 1.0, g: 0.8, b: 0.3 },
        color2: { r: 0.9, g: 0.3, b: 0.2 },
      },
    },
  },
  forest: {
    name: "Forest",
    description: "Shaded forest floor flowers",
    config: {
      density: 1000,
      appearance: {
        ...DEFAULT_FLOWER_APPEARANCE,
        minScale: 0.1,
        maxScale: 0.2,
      },
      color: {
        ...DEFAULT_FLOWER_COLORS,
        color1: { r: 0.6, g: 0.3, b: 0.6 },
        color2: { r: 0.3, g: 0.5, b: 0.7 },
        colorStrength: 0.25,
      },
    },
  },
};

/**
 * Get a flower biome preset by name
 */
export function getFlowerBiomePreset(
  name: string,
): FlowerBiomePreset | undefined {
  return FLOWER_BIOME_PRESETS[name.toLowerCase()];
}

/**
 * Get all available flower biome preset names
 */
export function getFlowerBiomePresetNames(): string[] {
  return Object.keys(FLOWER_BIOME_PRESETS);
}

/**
 * Merge a partial config with defaults
 */
export function mergeFlowerConfig(
  partial: Partial<FlowerConfig>,
): FlowerConfig {
  return {
    appearance: { ...DEFAULT_FLOWER_APPEARANCE, ...partial.appearance },
    color: { ...DEFAULT_FLOWER_COLORS, ...partial.color },
    lod: { ...DEFAULT_FLOWER_LOD, ...partial.lod },
    density: partial.density ?? DEFAULT_FLOWER_CONFIG.density,
    tileSize: partial.tileSize ?? DEFAULT_FLOWER_CONFIG.tileSize,
    flowersPerSide:
      partial.flowersPerSide ?? DEFAULT_FLOWER_CONFIG.flowersPerSide,
  };
}

// Note: FlowerMaterialUniforms is defined in FlowerMaterialTSL.ts
// as it requires TSL-specific types
