/**
 * Vegetation Module - Procedural vegetation placement without rendering dependencies.
 * @module vegetation
 */

export { VegetationPlacer } from "./VegetationPlacer";

export {
  DEFAULT_PLACER_CONFIG,
  DEFAULT_WATER_THRESHOLD,
  createVegetationTerrainProvider,
} from "./types";

export type {
  VegetationCategory,
  VegetationAsset,
  VegetationLayer,
  BiomeVegetationConfig,
  VegetationPlacement,
  TileVegetationResult,
  VegetationTerrainProvider,
  TerrainGeneratorLike,
  RoadAvoidanceProvider,
  VegetationPlacerConfig,
  TileGenerationOptions,
} from "./types";
