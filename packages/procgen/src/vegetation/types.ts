/**
 * Vegetation Placement Types
 *
 * Pure data types for procedural vegetation placement.
 * No rendering dependencies - usable by game engine and tools.
 */

/** Vegetation category for classification and LOD behavior */
export type VegetationCategory =
  | "tree"
  | "bush"
  | "fern"
  | "rock"
  | "fallen_tree"
  | "flower"
  | "mushroom"
  | "grass";

/**
 * A vegetation asset definition (loaded from vegetation.json)
 */
export interface VegetationAsset {
  /** Unique asset ID */
  id: string;
  /** Category (tree, bush, grass, etc.) */
  category: VegetationCategory;
  /** Path to the GLB model file */
  model: string;
  /** Path to LOD1 model (optional, inferred if not provided) */
  lod1Model?: string;
  /** Base scale multiplier */
  baseScale: number;
  /** Scale variation range [min, max] */
  scaleVariation: [number, number];
  /** Selection weight for weighted random */
  weight: number;
  /** Whether to rotate randomly around Y axis */
  randomRotation: boolean;
  /** Whether to align to terrain normal */
  alignToNormal?: boolean;
  /** Y offset to adjust placement height */
  yOffset?: number;
  /** Minimum slope this asset can appear on */
  minSlope?: number;
  /** Maximum slope this asset can appear on */
  maxSlope?: number;
  /** Biomes this asset can appear in (empty = all biomes) */
  biomes?: string[];
}

/** Vegetation layer - placement rules for a category (from biomes.json) */
export interface VegetationLayer {
  /** Category of vegetation (tree, bush, etc.) */
  category: VegetationCategory;
  /** Target density (instances per 100x100m tile) */
  density: number;
  /** Minimum spacing between instances (meters) */
  minSpacing: number;
  /** Noise scale for placement variation */
  noiseScale?: number;
  /** Noise threshold (0-1, higher = more selective) */
  noiseThreshold?: number;
  /** Whether to enable clustering */
  clustering?: boolean;
  /** Number of instances per cluster */
  clusterSize?: number;
  /** Minimum terrain height for this layer */
  minHeight?: number;
  /** Maximum terrain height for this layer */
  maxHeight?: number;
  /** Whether to avoid steep slopes */
  avoidSteepSlopes?: boolean;
  /** Whether to avoid water (default: true) */
  avoidWater?: boolean;
}

/** Biome vegetation configuration */
export interface BiomeVegetationConfig {
  /** Biome ID */
  biomeId: string;
  /** Biome display name */
  name: string;
  /** Vegetation layers for this biome */
  layers: VegetationLayer[];
}

/** A placed vegetation instance */
export interface VegetationPlacement {
  /** Unique instance ID */
  id: string;
  /** Asset ID to use */
  assetId: string;
  /** Vegetation category */
  category: VegetationCategory;
  /** World position */
  position: { x: number; y: number; z: number };
  /** Rotation (radians) */
  rotation: { x: number; y: number; z: number };
  /** Scale factor */
  scale: number;
  /** Tile key this instance belongs to */
  tileKey: string;
}

/** Result of vegetation placement for a tile */
export interface TileVegetationResult {
  /** Tile key (format: "tileX_tileZ") */
  tileKey: string;
  /** Tile X index */
  tileX: number;
  /** Tile Z index */
  tileZ: number;
  /** Biome ID for this tile */
  biome: string;
  /** Placed vegetation instances */
  placements: VegetationPlacement[];
}

/** Terrain provider for vegetation placement (TerrainGenerator or TerrainSystem) */
export interface VegetationTerrainProvider {
  /** Get terrain height at world position */
  getHeightAt(x: number, z: number): number;

  /** Get terrain normal at world position (optional) */
  getNormalAt?(x: number, z: number): { x: number; y: number; z: number };

  /** Get biome at world position */
  getBiomeAt(x: number, z: number): string;

  /** Get water threshold height */
  getWaterThreshold(): number;
}

/** Road avoidance interface (optional) */
export interface RoadAvoidanceProvider {
  /** Check if position is on a road */
  isOnRoad(x: number, z: number): boolean;
}

/** Configuration for the vegetation placer */
export interface VegetationPlacerConfig {
  /** World seed for deterministic placement */
  seed: number;
  /** Tile size in meters (default: 100) */
  tileSize: number;
  /** Water edge buffer distance (default: 6.0) */
  waterEdgeBuffer: number;
  /** Slope threshold for "steep" (default: 0.6) */
  steepSlopeThreshold: number;
}

/** Options for generating vegetation on a tile */
export interface TileGenerationOptions {
  /** Tile X index */
  tileX: number;
  /** Tile Z index */
  tileZ: number;
  /** Override biome (uses terrain provider if not specified) */
  biome?: string;
  /** Subset of categories to generate (all if not specified) */
  categories?: VegetationCategory[];
}

/** Default placer configuration values */
export const DEFAULT_PLACER_CONFIG: VegetationPlacerConfig = {
  seed: 0,
  tileSize: 100,
  waterEdgeBuffer: 6.0,
  steepSlopeThreshold: 0.6,
};

/** Default water threshold when not provided */
export const DEFAULT_WATER_THRESHOLD = 5.4;

/** Generator-like interface for terrain provider adapter */
export interface TerrainGeneratorLike {
  getHeightAt(x: number, z: number): number;
  queryPoint?(x: number, z: number): { biome: string };
  getBiomeAtTile?(tileX: number, tileZ: number): string;
  getWaterThreshold?(): number;
  getNormalAt?(x: number, z: number): { x: number; y: number; z: number };
}

/** Adapt a TerrainGenerator-like object into a VegetationTerrainProvider */
export function createVegetationTerrainProvider(
  gen: TerrainGeneratorLike,
  tileSize = 100,
): VegetationTerrainProvider {
  return {
    getHeightAt: (x, z) => gen.getHeightAt(x, z),
    getNormalAt: gen.getNormalAt?.bind(gen),
    getBiomeAt: (x, z) =>
      gen.queryPoint?.(x, z).biome ??
      gen.getBiomeAtTile?.(
        Math.floor(x / tileSize),
        Math.floor(z / tileSize),
      ) ??
      "plains",
    getWaterThreshold: () =>
      gen.getWaterThreshold?.() ?? DEFAULT_WATER_THRESHOLD,
  };
}
