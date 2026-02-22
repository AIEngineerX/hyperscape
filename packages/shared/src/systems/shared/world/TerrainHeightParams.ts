/**
 * Single source of truth for terrain height generation parameters.
 *
 * Both TerrainSystem (main thread) and TerrainWorker (web worker) consume
 * these values. Changing a constant here automatically updates both.
 *
 * The worker receives these as injected values in its inline code string
 * (see TerrainWorker.ts → buildWorkerHeightCode()). TerrainSystem imports
 * them directly as TypeScript constants.
 */

// ---------------------------------------------------------------------------
// Noise layer definitions — drive getBaseHeightAt()
// ---------------------------------------------------------------------------

export interface NoiseLayerDef {
  scale: number;
  weight: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  /** Only for erosion noise */
  iterations?: number;
}

export const CONTINENT_LAYER: NoiseLayerDef = {
  scale: 0.0008,
  octaves: 5,
  persistence: 0.7,
  lacunarity: 2.0,
  weight: 0.35,
};

export const RIDGE_LAYER: NoiseLayerDef = {
  scale: 0.003,
  weight: 0.15,
};

export const HILL_LAYER: NoiseLayerDef = {
  scale: 0.02,
  octaves: 4,
  persistence: 0.6,
  lacunarity: 2.2,
  weight: 0.25,
};

export const EROSION_LAYER: NoiseLayerDef = {
  scale: 0.005,
  iterations: 3,
  weight: 0.1,
};

export const DETAIL_LAYER: NoiseLayerDef = {
  scale: 0.04,
  octaves: 2,
  persistence: 0.3,
  lacunarity: 2.5,
  weight: 0.08,
};

/** Power curve applied after blending noise layers and normalizing to [0,1] */
export const HEIGHT_POWER_CURVE = 1.1;

// ---------------------------------------------------------------------------
// Island configuration
// ---------------------------------------------------------------------------

export const ISLAND_RADIUS = 350;
export const ISLAND_FALLOFF = 100;
export const ISLAND_DEEP_OCEAN_BUFFER = 50;
export const BASE_ELEVATION = 0.42;
export const OCEAN_FLOOR_HEIGHT = 0.05;
/** height = terrain * HEIGHT_TERRAIN_MIX + BASE_ELEVATION * islandMask */
export const HEIGHT_TERRAIN_MIX = 0.2;

// ---------------------------------------------------------------------------
// Pond configuration
// ---------------------------------------------------------------------------

export const POND_RADIUS = 50;
export const POND_DEPTH = 0.55;
export const POND_CENTER_X = -80;
export const POND_CENTER_Z = 60;

// ---------------------------------------------------------------------------
// Coastline noise — varies the island radius for irregular shoreline
// ---------------------------------------------------------------------------

export const COASTLINE_CIRCLE_SAMPLE_RADIUS = 2;

export const COAST_LARGE = {
  octaves: 3,
  persistence: 0.5,
  lacunarity: 2.0,
  weight: 0.2,
};

export const COAST_MEDIUM = {
  freqMultiplier: 3,
  octaves: 2,
  persistence: 0.5,
  lacunarity: 2.0,
  weight: 0.08,
};

export const COAST_SMALL = {
  freqMultiplier: 8,
  weight: 0.02,
};

// ---------------------------------------------------------------------------
// Mountain boost
// ---------------------------------------------------------------------------

export const MOUNTAIN_BOOST_MAX_NORM_DIST = 2.5;
export const MOUNTAIN_BOOST_GAUSSIAN_COEFF = 0.3;

// ---------------------------------------------------------------------------
// Worker code generation helper
// ---------------------------------------------------------------------------

/**
 * Generate the JS source for `getBaseHeightAt()` to be embedded in the
 * inline worker string. All numeric constants are baked in from the exports
 * above, ensuring the worker always matches the main thread.
 */
export function buildGetBaseHeightAtJS(): string {
  return `
  function getBaseHeightAt(worldX, worldZ) {
    var cN = noise.fractal2D(worldX * ${CONTINENT_LAYER.scale}, worldZ * ${CONTINENT_LAYER.scale}, ${CONTINENT_LAYER.octaves}, ${CONTINENT_LAYER.persistence}, ${CONTINENT_LAYER.lacunarity});
    var rN = noise.ridgeNoise2D(worldX * ${RIDGE_LAYER.scale}, worldZ * ${RIDGE_LAYER.scale});
    var hN = noise.fractal2D(worldX * ${HILL_LAYER.scale}, worldZ * ${HILL_LAYER.scale}, ${HILL_LAYER.octaves}, ${HILL_LAYER.persistence}, ${HILL_LAYER.lacunarity});
    var eN = noise.erosionNoise2D(worldX * ${EROSION_LAYER.scale}, worldZ * ${EROSION_LAYER.scale}, ${EROSION_LAYER.iterations});
    var dN = noise.fractal2D(worldX * ${DETAIL_LAYER.scale}, worldZ * ${DETAIL_LAYER.scale}, ${DETAIL_LAYER.octaves}, ${DETAIL_LAYER.persistence}, ${DETAIL_LAYER.lacunarity});

    var height = 0;
    height += cN * ${CONTINENT_LAYER.weight};
    height += rN * ${RIDGE_LAYER.weight};
    height += hN * ${HILL_LAYER.weight};
    height += eN * ${EROSION_LAYER.weight};
    height += dN * ${DETAIL_LAYER.weight};
    height = (height + 1) * 0.5;
    height = Math.max(0, Math.min(1, height));
    height = Math.pow(height, ${HEIGHT_POWER_CURVE});

    var distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);
    var angle = Math.atan2(worldZ, worldX);
    var cnx = Math.cos(angle) * ${COASTLINE_CIRCLE_SAMPLE_RADIUS};
    var cnz = Math.sin(angle) * ${COASTLINE_CIRCLE_SAMPLE_RADIUS};
    var cst1 = noise.fractal2D(cnx, cnz, ${COAST_LARGE.octaves}, ${COAST_LARGE.persistence}, ${COAST_LARGE.lacunarity});
    var cst2 = noise.fractal2D(cnx * ${COAST_MEDIUM.freqMultiplier}, cnz * ${COAST_MEDIUM.freqMultiplier}, ${COAST_MEDIUM.octaves}, ${COAST_MEDIUM.persistence}, ${COAST_MEDIUM.lacunarity});
    var cst3 = noise.simplex2D(cnx * ${COAST_SMALL.freqMultiplier}, cnz * ${COAST_SMALL.freqMultiplier});
    var coastVar = cst1 * ${COAST_LARGE.weight} + cst2 * ${COAST_MEDIUM.weight} + cst3 * ${COAST_SMALL.weight};
    var effectiveRadius = ${ISLAND_RADIUS} * (1 + coastVar);

    var islandMask = 1.0;
    if (distFromCenter > effectiveRadius - ${ISLAND_FALLOFF}) {
      var edgeDist = distFromCenter - (effectiveRadius - ${ISLAND_FALLOFF});
      var t = Math.min(1.0, edgeDist / ${ISLAND_FALLOFF});
      var smoothstep = t * t * (3 - 2 * t);
      islandMask = 1.0 - smoothstep;
    }
    if (distFromCenter > effectiveRadius + ${ISLAND_DEEP_OCEAN_BUFFER}) {
      islandMask = 0;
    }

    var distFromPond = Math.sqrt(
      (worldX - (${POND_CENTER_X})) * (worldX - (${POND_CENTER_X})) +
      (worldZ - ${POND_CENTER_Z}) * (worldZ - ${POND_CENTER_Z})
    );
    var pondDepression = 0;
    if (distFromPond < ${POND_RADIUS} * 2) {
      var pondFactor = 1.0 - distFromPond / (${POND_RADIUS} * 2);
      pondDepression = pondFactor * pondFactor * ${POND_DEPTH};
    }

    height = height * islandMask;
    height = height * ${HEIGHT_TERRAIN_MIX} + ${BASE_ELEVATION} * islandMask;
    height -= pondDepression;
    if (islandMask === 0) { height = ${OCEAN_FLOOR_HEIGHT}; }
    return height * MAX_HEIGHT;
  }`;
}
