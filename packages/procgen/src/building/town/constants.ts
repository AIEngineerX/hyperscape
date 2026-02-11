/**
 * Town Generation Constants
 * Default values and configuration for town generation
 */

import type {
  TownGeneratorConfig,
  TownSizeConfig,
  TownSize,
  BuildingConfig,
  TownBuildingType,
  LandmarkConfig,
} from "./types";

// ============================================================
// DEFAULT CONFIGURATION VALUES
// ============================================================

export const DEFAULT_TOWN_COUNT = 25;
export const DEFAULT_WORLD_SIZE = 10000;
export const DEFAULT_MIN_TOWN_SPACING = 800;
export const DEFAULT_FLATNESS_SAMPLE_RADIUS = 40;
export const DEFAULT_FLATNESS_SAMPLE_COUNT = 16;
// IMPORTANT: Water threshold must match TERRAIN_CONSTANTS.WATER_THRESHOLD (9.0)
// This ensures town candidates are placed on actual land, not underwater areas
export const DEFAULT_WATER_THRESHOLD = 9.0;
export const DEFAULT_OPTIMAL_WATER_DISTANCE_MIN = 30;
export const DEFAULT_OPTIMAL_WATER_DISTANCE_MAX = 150;

// ============================================================
// TOWN SIZE CONFIGURATIONS
// ============================================================

export const DEFAULT_TOWN_SIZES: Record<TownSize, TownSizeConfig> = {
  hamlet: {
    buildingCount: { min: 4, max: 6 },
    radius: 35,
    safeZoneRadius: 50,
  },
  village: {
    buildingCount: { min: 7, max: 12 },
    radius: 55,
    safeZoneRadius: 80,
  },
  town: {
    buildingCount: { min: 12, max: 20 },
    radius: 80,
    safeZoneRadius: 120,
  },
};

// ============================================================
// BIOME SUITABILITY SCORES
// ============================================================

export const DEFAULT_BIOME_SUITABILITY: Record<string, number> = {
  plains: 1.0,
  valley: 0.95,
  forest: 0.7,
  tundra: 0.4,
  desert: 0.3,
  swamp: 0.2,
  mountains: 0.15,
  lakes: 0.0,
};

// ============================================================
// BUILDING TYPE CONFIGURATIONS
// ============================================================

/**
 * Building dimensions in meters, aligned to CELL_SIZE (4m) grid.
 * Each building cell is 4m x 4m, so dimensions should be multiples of 4.
 * This ensures buildings align with the movement tile grid (1m tiles).
 *
 * Example: A 3x3 cell bank = 12m x 12m
 */
const CELL_SIZE = 4; // Must match procgen/building/generator/constants.ts

export const DEFAULT_BUILDING_CONFIGS: Record<
  TownBuildingType,
  BuildingConfig
> = {
  // ── Essential services ──
  bank: { width: 3 * CELL_SIZE, depth: 3 * CELL_SIZE, priority: 1 },
  store: { width: 2 * CELL_SIZE, depth: 3 * CELL_SIZE, priority: 2 },
  inn: { width: 3 * CELL_SIZE, depth: 4 * CELL_SIZE, priority: 2 },
  smithy: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 3 },
  anvil: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 3 },
  well: { width: 1 * CELL_SIZE, depth: 1 * CELL_SIZE, priority: 4 },

  // ── Residential ──
  house: { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 5 },
  "simple-house": { width: 2 * CELL_SIZE, depth: 2 * CELL_SIZE, priority: 6 },
  "long-house": { width: 2 * CELL_SIZE, depth: 5 * CELL_SIZE, priority: 6 },
  // Mansion: winged footprint — central 4x6 + wings, ~8x6 cells bounding
  mansion: { width: 6 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 4 },
  // Manor: slightly smaller winged building
  manor: { width: 5 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 4 },

  // ── Religious ──
  // Church: apse style, ~3x6 cells bounding
  church: { width: 3 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 3 },
  // Cathedral: cruciform, ~6x8 cells bounding (nave + transept arms)
  cathedral: { width: 6 * CELL_SIZE, depth: 8 * CELL_SIZE, priority: 2 },
  // Chapel: small rectangular church
  chapel: { width: 2 * CELL_SIZE, depth: 4 * CELL_SIZE, priority: 5 },

  // ── Fortifications ──
  // Keep: towered, ~6x6 cells (core + towers)
  keep: { width: 6 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 2 },
  // Fortress: courtyard, ~8x8 cells
  fortress: { width: 8 * CELL_SIZE, depth: 8 * CELL_SIZE, priority: 1 },
  // Castle: large towered, ~8x8 cells
  castle: { width: 8 * CELL_SIZE, depth: 8 * CELL_SIZE, priority: 1 },

  // ── Civic ──
  "guild-hall": { width: 5 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 3 },
  "town-hall": { width: 5 * CELL_SIZE, depth: 6 * CELL_SIZE, priority: 2 },
};

// ============================================================
// NAME GENERATION
// ============================================================

export const NAME_PREFIXES = [
  "Oak",
  "River",
  "Stone",
  "Green",
  "High",
  "Low",
  "North",
  "South",
  "East",
  "West",
  "Iron",
  "Gold",
  "Silver",
  "Crystal",
  "Shadow",
  "Sun",
  "Moon",
  "Star",
  "Thunder",
  "Frost",
  "Fire",
  "Wind",
  "Storm",
  "Cloud",
  "Lake",
];

export const NAME_SUFFIXES = [
  "haven",
  "ford",
  "wick",
  "ton",
  "bridge",
  "vale",
  "hollow",
  "reach",
  "fall",
  "watch",
  "keep",
  "stead",
  "dale",
  "brook",
  "field",
  "grove",
  "hill",
  "cliff",
  "port",
  "gate",
  "marsh",
  "moor",
  "wood",
  "mere",
  "crest",
];

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

export function createDefaultConfig(): TownGeneratorConfig {
  return {
    townCount: DEFAULT_TOWN_COUNT,
    worldSize: DEFAULT_WORLD_SIZE,
    minTownSpacing: DEFAULT_MIN_TOWN_SPACING,
    flatnessSampleRadius: DEFAULT_FLATNESS_SAMPLE_RADIUS,
    flatnessSampleCount: DEFAULT_FLATNESS_SAMPLE_COUNT,
    waterThreshold: DEFAULT_WATER_THRESHOLD,
    optimalWaterDistanceMin: DEFAULT_OPTIMAL_WATER_DISTANCE_MIN,
    optimalWaterDistanceMax: DEFAULT_OPTIMAL_WATER_DISTANCE_MAX,
    townSizes: { ...DEFAULT_TOWN_SIZES },
    biomeSuitability: { ...DEFAULT_BIOME_SUITABILITY },
    buildingTypes: { ...DEFAULT_BUILDING_CONFIGS },
    landmarks: { ...DEFAULT_LANDMARK_CONFIG },
  };
}

// ============================================================
// LANDMARK CONFIGURATION
// ============================================================

/**
 * Default landmark generation configuration
 */
export const DEFAULT_LANDMARK_CONFIG: LandmarkConfig = {
  fencesEnabled: true,
  fenceDensity: 0.7, // 70% of valid corners get fence posts
  fencePostHeight: 1.2, // 1.2m tall fence posts
  lamppostsInVillages: true,
  lamppostSpacing: 15, // 15m between lampposts
  marketStallsEnabled: true,
  decorationsEnabled: true,
};

// ============================================================
// GRID CONFIGURATION
// ============================================================

export const PLACEMENT_GRID_SIZE = 15;
export const BUILDING_PLACEMENT_BUFFER = 2;
export const MAX_BUILDING_PLACEMENT_ATTEMPTS = 50;
export const WATER_CHECK_DIRECTIONS = 8;
export const WATER_CHECK_MAX_DISTANCE = 300;
export const WATER_CHECK_STEP = 20;
