/**
 * Rock Presets
 *
 * Pre-configured parameters for different rock types and styles.
 */

import type { RockParams, PartialRockParams } from "./types";
import { BaseShape, ColorMode, TexturePattern, UVMethod } from "./types";

// ============================================================================
// DEFAULT PARAMETERS
// ============================================================================

/**
 * Default rock generation parameters
 */
export const DEFAULT_PARAMS: RockParams = {
  baseShape: BaseShape.Icosahedron,
  subdivisions: 5,
  scale: { x: 1.0, y: 0.8, z: 1.0 },
  noise: {
    scale: 1.5,
    amplitude: 0.25,
    octaves: 5,
    lacunarity: 2.0,
    persistence: 0.5,
  },
  cracks: {
    depth: 0.04,
    frequency: 3.0,
  },
  // Scraping creates flat faces characteristic of real rocks
  scrape: {
    count: 5, // 5 scraping planes by default
    minRadius: 0.4,
    maxRadius: 0.8,
    strength: 0.6,
  },
  smooth: {
    iterations: 2,
    strength: 0.5,
  },
  colors: {
    baseColor: "#5a524a",
    secondaryColor: "#7a6e62",
    accentColor: "#3d3832",
    variation: 0.08,
    heightBlend: 0.3,
    slopeBlend: 0.35,
    aoIntensity: 0.25,
  },
  material: {
    roughness: 0.9,
    roughnessVariation: 0.15,
    metalness: 0.0,
  },
  flatShading: false,
  // Use triplanar blend for LOD0 (realistic textures), falls back to vertex for LOD1+
  colorMode: ColorMode.Blend,
  textureBlend: 0.6,
  texture: {
    pattern: TexturePattern.Noise,
    scale: 4.0,
    detail: 4,
    contrast: 1.0,
  },
  uvMethod: UVMethod.Box,
};

// ============================================================================
// SHAPE PRESETS
// ============================================================================

/**
 * Shape/style presets (boulder, pebble, crystal, etc.)
 *
 * Each preset is designed with geologically-accurate characteristics:
 * - Boulders: Weathered, rounded with some flat faces from fracturing
 * - Pebbles: Water-worn, very smooth with minimal features
 * - Crystals: Angular, geometric with minimal noise
 * - Asteroids: Heavily cratered, irregular with deep cracks
 * - Cliffs: Layered, stratified with pronounced horizontal features
 * - Lowpoly: Stylized geometric rocks for performance
 */
export const SHAPE_PRESETS: Record<string, PartialRockParams> = {
  boulder: {
    // Boulders are weathered rocks with flat faces from natural fracturing
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.75, z: 1.1 },
    noise: {
      scale: 1.8,
      amplitude: 0.22,
      octaves: 5,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.05, frequency: 2.5 },
    // Moderate scraping creates characteristic flat weathered faces
    scrape: { count: 6, minRadius: 0.35, maxRadius: 0.75, strength: 0.55 },
    smooth: { iterations: 2, strength: 0.4 },
    colors: {
      baseColor: "#5a524a",
      secondaryColor: "#7a6e62",
      accentColor: "#3d3832",
      variation: 0.1,
      heightBlend: 0.3,
      slopeBlend: 0.4,
      aoIntensity: 0.35,
    },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.55,
    texture: {
      pattern: TexturePattern.Noise,
      scale: 3.5,
      detail: 4,
      contrast: 1.1,
    },
  },

  pebble: {
    // Pebbles are water-worn, extremely smooth with subtle variation
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.1, y: 0.55, z: 1.0 },
    noise: {
      scale: 3.0,
      amplitude: 0.08,
      octaves: 4,
      lacunarity: 2.2,
      persistence: 0.4,
    },
    cracks: { depth: 0.01, frequency: 5.0 },
    // Minimal scraping - pebbles are smooth from water erosion
    scrape: { count: 2, minRadius: 0.5, maxRadius: 0.9, strength: 0.2 },
    smooth: { iterations: 4, strength: 0.65 },
    colors: {
      baseColor: "#6b6560",
      secondaryColor: "#8a827a",
      accentColor: "#4a4540",
      variation: 0.04,
      heightBlend: 0.2,
      slopeBlend: 0.2,
      aoIntensity: 0.15,
    },
    material: { roughness: 0.7, roughnessVariation: 0.1, metalness: 0.0 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.4,
  },

  crystal: {
    // Crystals are angular, geometric with clean facets - no scraping
    baseShape: BaseShape.Octahedron,
    subdivisions: 2,
    scale: { x: 0.7, y: 1.5, z: 0.7 },
    noise: {
      scale: 3.0,
      amplitude: 0.03,
      octaves: 2,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.0, frequency: 1.0 },
    // No scraping - crystals have clean geometric facets
    scrape: { count: 0, minRadius: 0.5, maxRadius: 0.8, strength: 0.0 },
    smooth: { iterations: 0, strength: 0.0 },
    colors: {
      baseColor: "#4a5568",
      secondaryColor: "#718096",
      accentColor: "#2d3748",
      variation: 0.04,
      heightBlend: 0.6,
      slopeBlend: 0.1,
      aoIntensity: 0.2,
    },
    material: { roughness: 0.3, roughnessVariation: 0.05, metalness: 0.1 },
    flatShading: true,
    colorMode: ColorMode.Vertex, // Crystals look better with flat colors
  },

  asteroid: {
    // Asteroids are heavily cratered with deep impacts and irregular shape
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.9, z: 1.0 },
    noise: {
      scale: 2.2,
      amplitude: 0.35,
      octaves: 6,
      lacunarity: 2.0,
      persistence: 0.55,
    },
    cracks: { depth: 0.1, frequency: 2.0 },
    // Heavy scraping simulates impact craters and fractures
    scrape: { count: 10, minRadius: 0.2, maxRadius: 0.6, strength: 0.7 },
    smooth: { iterations: 1, strength: 0.3 },
    colors: {
      baseColor: "#3d3d3d",
      secondaryColor: "#5a5a5a",
      accentColor: "#252525",
      variation: 0.06,
      heightBlend: 0.4,
      slopeBlend: 0.5,
      aoIntensity: 0.45,
    },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.5,
    texture: {
      pattern: TexturePattern.Cellular,
      scale: 5.0,
      detail: 4,
      contrast: 1.2,
    },
  },

  cliff: {
    // Cliffs have layered stratification with horizontal flat faces
    baseShape: BaseShape.Box,
    subdivisions: 5,
    scale: { x: 1.5, y: 1.0, z: 0.6 },
    noise: {
      scale: 1.4,
      amplitude: 0.25,
      octaves: 6,
      lacunarity: 2.2,
      persistence: 0.5,
    },
    cracks: { depth: 0.07, frequency: 4.0 },
    // Strong scraping creates pronounced flat layered faces
    scrape: { count: 8, minRadius: 0.4, maxRadius: 0.85, strength: 0.65 },
    smooth: { iterations: 1, strength: 0.25 },
    colors: {
      baseColor: "#6b5b4f",
      secondaryColor: "#8a7a6e",
      accentColor: "#4a3f35",
      variation: 0.1,
      heightBlend: 0.5,
      slopeBlend: 0.3,
      aoIntensity: 0.4,
    },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.65,
    texture: {
      pattern: TexturePattern.Layered,
      scale: 6.0,
      detail: 5,
      contrast: 1.15,
    },
  },

  lowpoly: {
    // Stylized low-poly rocks for performance - strong flat shading
    baseShape: BaseShape.Icosahedron,
    subdivisions: 1,
    scale: { x: 1.0, y: 0.8, z: 1.0 },
    noise: {
      scale: 1.0,
      amplitude: 0.35,
      octaves: 2,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.0, frequency: 1.0 },
    // Minimal scraping - the low subdivision creates natural facets
    scrape: { count: 3, minRadius: 0.5, maxRadius: 0.9, strength: 0.4 },
    smooth: { iterations: 0, strength: 0.0 },
    colors: {
      baseColor: "#7a7064",
      secondaryColor: "#9a8e82",
      accentColor: "#5a5044",
      variation: 0.08,
      heightBlend: 0.4,
      slopeBlend: 0.3,
      aoIntensity: 0.2,
    },
    flatShading: true,
    colorMode: ColorMode.Vertex, // Low-poly uses vertex colors only
  },
};

// ============================================================================
// ROCK TYPE PRESETS (GEOLOGY)
// ============================================================================

/**
 * Geology/material presets (sandstone, granite, marble, etc.)
 *
 * Each geology type has unique visual characteristics:
 *
 * - SANDSTONE: Sedimentary, layered, porous, warm colors (tan/orange/red)
 *   Forms from compressed sand, has visible horizontal stratification
 *
 * - LIMESTONE: Sedimentary, smooth with dissolution features, cream/gray
 *   Forms from marine organisms, often contains fossil patterns
 *
 * - GRANITE: Igneous, crystalline, speckled with mineral inclusions
 *   Very hard, rounded weathering, gray/pink with black/white spots
 *
 * - MARBLE: Metamorphic, smooth with dramatic veining, polished appearance
 *   Recrystallized limestone, white base with colored veins
 *
 * - BASALT: Igneous, dark, can be columnar with hexagonal joints
 *   Fine-grained volcanic rock, often with vesicles (gas holes)
 *
 * - SLATE: Metamorphic, flat/planar with fine layering, blue-gray
 *   Splits into thin sheets along cleavage planes
 *
 * - OBSIDIAN: Volcanic glass, extremely smooth with conchoidal fractures
 *   Sharp edges, glassy black appearance with flow banding
 *
 * - QUARTZITE: Metamorphic, very hard, granular with subtle sparkle
 *   Recrystallized sandstone, often pink/white/gray
 */
export const ROCK_TYPE_PRESETS: Record<string, PartialRockParams> = {
  sandstone: {
    // Sedimentary - layered, soft, erodes into rounded shapes with flat beds
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.75, z: 1.0 },
    noise: {
      scale: 2.2,
      amplitude: 0.16,
      octaves: 5,
      lacunarity: 2.0,
      persistence: 0.45,
    },
    cracks: { depth: 0.03, frequency: 2.5 },
    // Moderate scraping - sandstone erodes but retains some flat bed surfaces
    scrape: { count: 5, minRadius: 0.4, maxRadius: 0.8, strength: 0.5 },
    smooth: { iterations: 2, strength: 0.45 },
    colors: {
      baseColor: "#c4a67c",
      secondaryColor: "#d4b896",
      accentColor: "#a08060",
      variation: 0.12,
      heightBlend: 0.55, // Strong height banding for sediment layers
      slopeBlend: 0.2,
      aoIntensity: 0.28,
    },
    material: { roughness: 0.95, roughnessVariation: 0.2, metalness: 0.0 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.65,
    texture: {
      pattern: TexturePattern.Layered,
      scale: 8.0,
      detail: 5,
      contrast: 1.2,
    },
  },

  limestone: {
    // Sedimentary - smooth with dissolution pits, rounded edges
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.85, z: 1.0 },
    noise: {
      scale: 2.0,
      amplitude: 0.18,
      octaves: 5,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.04, frequency: 3.0 },
    // Light scraping - limestone dissolves into smooth rounded shapes
    scrape: { count: 4, minRadius: 0.45, maxRadius: 0.85, strength: 0.4 },
    smooth: { iterations: 3, strength: 0.55 },
    colors: {
      baseColor: "#e8e0d0",
      secondaryColor: "#f0ebe0",
      accentColor: "#c8c0b0",
      variation: 0.08,
      heightBlend: 0.3,
      slopeBlend: 0.25,
      aoIntensity: 0.3,
    },
    material: { roughness: 0.88, roughnessVariation: 0.15, metalness: 0.0 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.5,
    texture: {
      pattern: TexturePattern.Noise,
      scale: 6.0,
      detail: 4,
      contrast: 0.9,
    },
  },

  granite: {
    // Igneous - hard, crystalline, rounded weathering with visible minerals
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.9, z: 1.0 },
    noise: {
      scale: 1.6,
      amplitude: 0.2,
      octaves: 6,
      lacunarity: 2.2,
      persistence: 0.5,
    },
    cracks: { depth: 0.025, frequency: 4.0 },
    // Moderate scraping - granite fractures along crystal boundaries
    scrape: { count: 6, minRadius: 0.35, maxRadius: 0.75, strength: 0.5 },
    smooth: { iterations: 3, strength: 0.5 },
    colors: {
      baseColor: "#8a8580",
      secondaryColor: "#a09a95",
      accentColor: "#605a55",
      variation: 0.18, // High variation for mineral speckles
      heightBlend: 0.2,
      slopeBlend: 0.15,
      aoIntensity: 0.22,
    },
    material: { roughness: 0.78, roughnessVariation: 0.1, metalness: 0.05 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.7,
    texture: {
      pattern: TexturePattern.Speckled,
      scale: 12.0,
      detail: 6,
      contrast: 1.3,
    },
  },

  marble: {
    // Metamorphic - very smooth, polished appearance with dramatic veining
    baseShape: BaseShape.Sphere,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.85, z: 1.0 },
    noise: {
      scale: 1.4,
      amplitude: 0.1,
      octaves: 4,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.015, frequency: 2.0 },
    // Minimal scraping - marble has smooth curved surfaces
    scrape: { count: 3, minRadius: 0.5, maxRadius: 0.9, strength: 0.25 },
    smooth: { iterations: 4, strength: 0.65 },
    colors: {
      baseColor: "#f5f5f5",
      secondaryColor: "#ffffff",
      accentColor: "#b0b0b0",
      variation: 0.05,
      heightBlend: 0.15,
      slopeBlend: 0.1,
      aoIntensity: 0.15,
    },
    material: { roughness: 0.32, roughnessVariation: 0.08, metalness: 0.0 },
    flatShading: false,
    colorMode: ColorMode.Texture, // Marble needs texture for veining
    textureBlend: 0.5,
    texture: {
      pattern: TexturePattern.Veined,
      scale: 4.0,
      detail: 5,
      contrast: 1.5,
    },
  },

  basalt: {
    // Igneous volcanic - dark, angular, can have columnar joints
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.8, z: 1.0 },
    noise: {
      scale: 2.8,
      amplitude: 0.25,
      octaves: 5,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.09, frequency: 3.5 },
    // Strong scraping - basalt fractures into angular columnar shapes
    scrape: { count: 8, minRadius: 0.3, maxRadius: 0.7, strength: 0.65 },
    smooth: { iterations: 1, strength: 0.25 },
    colors: {
      baseColor: "#2a2a2a",
      secondaryColor: "#3a3a3a",
      accentColor: "#1a1a1a",
      variation: 0.05,
      heightBlend: 0.25,
      slopeBlend: 0.35,
      aoIntensity: 0.4,
    },
    material: { roughness: 0.95, roughnessVariation: 0.15, metalness: 0.0 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.55,
    texture: {
      pattern: TexturePattern.Cellular,
      scale: 6.0,
      detail: 4,
      contrast: 1.1,
    },
  },

  slate: {
    // Metamorphic - flat, planar, splits into thin sheets
    baseShape: BaseShape.Box,
    subdivisions: 5,
    scale: { x: 1.2, y: 0.45, z: 1.0 }, // Flatter than before
    noise: {
      scale: 3.5,
      amplitude: 0.12,
      octaves: 4,
      lacunarity: 2.0,
      persistence: 0.45,
    },
    cracks: { depth: 0.06, frequency: 5.0 },
    // Very strong scraping - slate cleaves into flat sheets
    scrape: { count: 10, minRadius: 0.5, maxRadius: 0.95, strength: 0.75 },
    smooth: { iterations: 1, strength: 0.2 },
    colors: {
      baseColor: "#404550",
      secondaryColor: "#505560",
      accentColor: "#303540",
      variation: 0.06,
      heightBlend: 0.4,
      slopeBlend: 0.2,
      aoIntensity: 0.28,
    },
    material: { roughness: 0.75, roughnessVariation: 0.1, metalness: 0.05 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.6,
    texture: {
      pattern: TexturePattern.Layered,
      scale: 10.0,
      detail: 3,
      contrast: 1.0,
    },
  },

  obsidian: {
    // Volcanic glass - smooth with sharp conchoidal fractures
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.9, z: 1.0 },
    noise: {
      scale: 1.8,
      amplitude: 0.12,
      octaves: 4,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.04, frequency: 2.0 },
    // Moderate scraping - conchoidal (curved) fracture surfaces
    scrape: { count: 7, minRadius: 0.35, maxRadius: 0.8, strength: 0.55 },
    smooth: { iterations: 4, strength: 0.6 },
    colors: {
      baseColor: "#0a0a0a",
      secondaryColor: "#151515",
      accentColor: "#050505",
      variation: 0.02,
      heightBlend: 0.1,
      slopeBlend: 0.1,
      aoIntensity: 0.15,
    },
    material: { roughness: 0.12, roughnessVariation: 0.05, metalness: 0.18 },
    flatShading: false,
    colorMode: ColorMode.Texture, // Obsidian needs texture for flow patterns
    textureBlend: 0.5,
    texture: {
      pattern: TexturePattern.Flow,
      scale: 5.0,
      detail: 5,
      contrast: 1.2,
    },
  },

  quartzite: {
    // Metamorphic - very hard, granular, sparkly appearance
    baseShape: BaseShape.Icosahedron,
    subdivisions: 5,
    scale: { x: 1.0, y: 0.85, z: 1.0 },
    noise: {
      scale: 2.2,
      amplitude: 0.18,
      octaves: 5,
      lacunarity: 2.0,
      persistence: 0.5,
    },
    cracks: { depth: 0.045, frequency: 3.5 },
    // Moderate scraping - quartzite fractures irregularly
    scrape: { count: 6, minRadius: 0.4, maxRadius: 0.8, strength: 0.5 },
    smooth: { iterations: 3, strength: 0.5 },
    colors: {
      baseColor: "#e8e0e8",
      secondaryColor: "#f5f0f5",
      accentColor: "#c8c0c8",
      variation: 0.1,
      heightBlend: 0.25,
      slopeBlend: 0.2,
      aoIntensity: 0.22,
    },
    material: { roughness: 0.55, roughnessVariation: 0.12, metalness: 0.12 },
    flatShading: false,
    colorMode: ColorMode.Blend,
    textureBlend: 0.6,
    texture: {
      pattern: TexturePattern.Speckled,
      scale: 8.0,
      detail: 5,
      contrast: 1.1,
    },
  },
};

// ============================================================================
// ALL PRESETS COMBINED
// ============================================================================

/**
 * All available presets (shapes + rock types)
 */
export const ALL_PRESETS: Record<string, PartialRockParams> = {
  ...SHAPE_PRESETS,
  ...ROCK_TYPE_PRESETS,
};

/**
 * Get a preset by name
 * @param name - Preset name (case-insensitive)
 * @returns Preset parameters or null if not found
 */
export function getPreset(name: string): PartialRockParams | null {
  const key = name.toLowerCase();
  return ALL_PRESETS[key] ?? null;
}

/**
 * List all available preset names
 */
export function listPresets(): string[] {
  return Object.keys(ALL_PRESETS);
}

/**
 * Merge partial params into complete params
 */
export function mergeParams(
  base: RockParams,
  partial: PartialRockParams,
): RockParams {
  return {
    baseShape: partial.baseShape ?? base.baseShape,
    subdivisions: partial.subdivisions ?? base.subdivisions,
    scale: { ...base.scale, ...partial.scale },
    noise: { ...base.noise, ...partial.noise },
    cracks: { ...base.cracks, ...partial.cracks },
    scrape: { ...base.scrape, ...partial.scrape },
    smooth: { ...base.smooth, ...partial.smooth },
    colors: { ...base.colors, ...partial.colors },
    material: { ...base.material, ...partial.material },
    flatShading: partial.flatShading ?? base.flatShading,
    colorMode: partial.colorMode ?? base.colorMode,
    textureBlend: partial.textureBlend ?? base.textureBlend,
    texture: { ...base.texture, ...partial.texture },
    uvMethod: partial.uvMethod ?? base.uvMethod,
  };
}
