/**
 * Building Recipes
 * Predefined building type configurations
 *
 * Each recipe defines a building archetype with parameters for:
 * - Footprint shape and size
 * - Foundation height (variable steps, 0 = flush with ground)
 * - Floor count and upper floor behavior
 * - Openings (doors, windows, arches)
 * - Optional basement
 * - Material and style
 */

import type { BuildingRecipe } from "./types";

export const BUILDING_RECIPES: Record<string, BuildingRecipe> = {
  // ============================================================
  // SMALL RESIDENTIAL
  // ============================================================

  "simple-house": {
    label: "Simple House",
    widthRange: [2, 3],
    depthRange: [2, 3],
    floors: 1,
    entranceCount: 1,
    archBias: 0.25,
    extraConnectionChance: 0.15,
    entranceArchChance: 0.05,
    roomSpanRange: [1, 2],
    minRoomArea: 2,
    windowChance: 0.6,
    carveChance: 0.2,
    carveSizeRange: [1, 1],
    frontSide: "south",
    wallMaterial: "stucco",
    // Simple cottages: 0-1 steps (some sit right on the ground)
    foundationStepsRange: [0, 1],
  },

  "long-house": {
    label: "Long House",
    widthRange: [1, 2],
    depthRange: [4, 6],
    floors: 1,
    entranceCount: 2,
    archBias: 0.45,
    extraConnectionChance: 0.1,
    entranceArchChance: 0.08,
    roomSpanRange: [1, 3],
    minRoomArea: 2,
    windowChance: 0.45,
    carveChance: 0.1,
    carveSizeRange: [1, 2],
    frontSide: "south",
    wallMaterial: "siding",
    // Long houses: 0-1 steps (low profile)
    foundationStepsRange: [0, 1],
  },

  // ============================================================
  // COMMERCIAL
  // ============================================================

  inn: {
    label: "Inn",
    widthRange: [3, 4],
    depthRange: [3, 5],
    floors: 2,
    floorsRange: [1, 2],
    entranceCount: 2,
    archBias: 0.7,
    extraConnectionChance: 0.35,
    entranceArchChance: 0.2,
    roomSpanRange: [1, 3],
    minRoomArea: 3,
    minUpperFloorCells: 3,
    minUpperFloorShrinkCells: 2,
    windowChance: 0.5,
    patioDoorChance: 0.7,
    patioDoorCountRange: [1, 2],
    carveChance: 0.25,
    carveSizeRange: [1, 2],
    upperInsetRange: [1, 2],
    upperCarveChance: 0.2,
    frontSide: "south",
    wallMaterial: "timber",
    // Inns: 1-2 steps (welcoming but slightly raised)
    foundationStepsRange: [1, 2],
    // Inns often have a cellar for storage
    hasBasement: true,
    basementChance: 0.6,
    basementLevels: 1,
    basementCoverage: 0.5,
  },

  bank: {
    label: "Bank",
    widthRange: [3, 4],
    depthRange: [3, 4],
    floors: 2,
    floorsRange: [1, 2],
    entranceCount: 1,
    archBias: 0.8,
    extraConnectionChance: 0.4,
    entranceArchChance: 0.55,
    roomSpanRange: [1, 2],
    minRoomArea: 3,
    minUpperFloorCells: 3,
    minUpperFloorShrinkCells: 2,
    windowChance: 0.35,
    patioDoorChance: 0.6,
    patioDoorCountRange: [1, 1],
    footprintStyle: "foyer",
    foyerDepthRange: [1, 2],
    foyerWidthRange: [1, 2],
    excludeFoyerFromUpper: true,
    upperInsetRange: [1, 2],
    upperCarveChance: 0.1,
    frontSide: "south",
    wallMaterial: "stone",
    // Banks: 2-3 steps (imposing, elevated entrance)
    foundationStepsRange: [2, 3],
    // Banks have vaults below ground
    hasBasement: true,
    basementChance: 0.8,
    basementLevels: 1,
    basementCoverage: 0.7,
  },

  store: {
    label: "Store",
    widthRange: [2, 3],
    depthRange: [2, 4],
    floors: 1,
    entranceCount: 1,
    archBias: 0.2,
    extraConnectionChance: 0.12,
    entranceArchChance: 0.05,
    roomSpanRange: [1, 2],
    minRoomArea: 2,
    windowChance: 0.65,
    carveChance: 0.3,
    carveSizeRange: [1, 2],
    frontSide: "south",
    wallMaterial: "timber",
    // Stores: 0-1 steps (easy access for customers)
    foundationStepsRange: [0, 1],
  },

  smithy: {
    label: "Smithy / Forge",
    widthRange: [2, 3],
    depthRange: [2, 3],
    floors: 1,
    entranceCount: 1,
    archBias: 0.15,
    extraConnectionChance: 0.1,
    entranceArchChance: 0.05,
    roomSpanRange: [1, 2],
    minRoomArea: 2,
    windowChance: 0.5,
    carveChance: 0.2,
    carveSizeRange: [1, 1],
    frontSide: "south",
    wallMaterial: "brick",
    // Smithy: 0 steps (ground level for hauling materials)
    foundationSteps: 0,
  },

  // ============================================================
  // LARGE RESIDENTIAL
  // ============================================================

  mansion: {
    label: "Mansion",
    widthRange: [3, 4],
    depthRange: [4, 6],
    floors: 2,
    floorsRange: [2, 3],
    entranceCount: 2,
    archBias: 0.6,
    extraConnectionChance: 0.3,
    entranceArchChance: 0.4,
    roomSpanRange: [2, 4],
    minRoomArea: 4,
    minUpperFloorCells: 6,
    minUpperFloorShrinkCells: 3,
    windowChance: 0.7,
    patioDoorChance: 0.5,
    patioDoorCountRange: [1, 2],
    // Winged: central block with side wings for a grand silhouette
    footprintStyle: "winged",
    wingDepthRange: [2, 3],
    wingWidthRange: [1, 2],
    wingsOnUpperFloors: true,
    upperInsetRange: [1, 2],
    upperCarveChance: 0.2,
    frontSide: "south",
    wallMaterial: "brick",
    // Mansions: 2-4 steps (grand elevated entrance)
    foundationStepsRange: [2, 4],
    // Wine cellar / storage
    hasBasement: true,
    basementChance: 0.7,
    basementLevels: 1,
    basementCoverage: 0.4,
  },

  manor: {
    label: "Manor House",
    widthRange: [3, 5],
    depthRange: [4, 6],
    floors: 2,
    floorsRange: [2, 3],
    entranceCount: 2,
    archBias: 0.55,
    extraConnectionChance: 0.3,
    entranceArchChance: 0.35,
    roomSpanRange: [2, 3],
    minRoomArea: 3,
    minUpperFloorCells: 5,
    minUpperFloorShrinkCells: 2,
    windowChance: 0.65,
    patioDoorChance: 0.4,
    patioDoorCountRange: [1, 2],
    // Winged style with more modest wings
    footprintStyle: "winged",
    wingDepthRange: [2, 3],
    wingWidthRange: [1, 1],
    wingsOnUpperFloors: false,
    upperInsetRange: [1, 2],
    upperCarveChance: 0.15,
    frontSide: "south",
    wallMaterial: "stone",
    // Manors: 2-3 steps
    foundationStepsRange: [2, 3],
    hasBasement: true,
    basementChance: 0.5,
    basementLevels: 1,
    basementCoverage: 0.5,
  },

  // ============================================================
  // FORTIFICATIONS
  // ============================================================

  keep: {
    label: "Keep",
    widthRange: [4, 5],
    depthRange: [4, 5],
    floors: 2,
    floorsRange: [2, 3],
    entranceCount: 1,
    archBias: 0.3,
    extraConnectionChance: 0.2,
    entranceArchChance: 0.6,
    roomSpanRange: [1, 2],
    minRoomArea: 2,
    minUpperFloorCells: 4,
    minUpperFloorShrinkCells: 0,
    windowChance: 0.25,
    // Towered: rectangular core with corner towers protruding outward
    footprintStyle: "towered",
    towerSizeRange: [2, 2],
    towerExtensionRange: [1, 1],
    patioDoorChance: 0.3,
    patioDoorCountRange: [1, 1],
    frontSide: "south",
    wallMaterial: "stone",
    // Keeps: 3-4 steps (defensive elevation)
    foundationStepsRange: [3, 4],
    // Dungeon / storage below
    hasBasement: true,
    basementChance: 0.8,
    basementLevels: 1,
    basementCoverage: 0.6,
  },

  fortress: {
    label: "Fortress",
    widthRange: [5, 7],
    depthRange: [5, 7],
    floors: 2,
    floorsRange: [2, 3],
    entranceCount: 1,
    archBias: 0.4,
    extraConnectionChance: 0.25,
    entranceArchChance: 0.7,
    roomSpanRange: [2, 3],
    minRoomArea: 3,
    minUpperFloorCells: 8,
    minUpperFloorShrinkCells: 0,
    windowChance: 0.2,
    // Courtyard with an open center — classic fortress layout
    footprintStyle: "courtyard",
    courtyardSizeRange: [2, 3],
    patioDoorChance: 0.4,
    patioDoorCountRange: [1, 2],
    frontSide: "south",
    wallMaterial: "stone",
    // Fortress: 3-4 steps (massive foundation)
    foundationStepsRange: [3, 4],
    // Deep dungeon levels
    hasBasement: true,
    basementChance: 0.9,
    basementLevels: 2,
    basementCoverage: 0.5,
  },

  castle: {
    label: "Castle",
    widthRange: [5, 6],
    depthRange: [5, 6],
    floors: 3,
    floorsRange: [2, 3],
    entranceCount: 1,
    archBias: 0.5,
    extraConnectionChance: 0.3,
    entranceArchChance: 0.75,
    roomSpanRange: [2, 3],
    minRoomArea: 3,
    minUpperFloorCells: 6,
    minUpperFloorShrinkCells: 0,
    windowChance: 0.2,
    // Towered: large core with prominent corner towers
    footprintStyle: "towered",
    towerSizeRange: [2, 3],
    towerExtensionRange: [1, 2],
    patioDoorChance: 0.3,
    patioDoorCountRange: [1, 2],
    frontSide: "south",
    wallMaterial: "stone",
    // Castle: 4 steps (imposing elevation)
    foundationSteps: 4,
    // Dungeon
    hasBasement: true,
    basementChance: 1.0,
    basementLevels: 2,
    basementCoverage: 0.6,
  },

  // ============================================================
  // RELIGIOUS
  // ============================================================

  church: {
    label: "Church",
    widthRange: [2, 3],
    depthRange: [4, 5],
    floors: 1,
    entranceCount: 1,
    archBias: 0.9,
    extraConnectionChance: 0.1,
    entranceArchChance: 0.8,
    roomSpanRange: [2, 4],
    minRoomArea: 4,
    windowChance: 0.8,
    // Apse style: rectangular nave with semicircular chancel at the rear
    footprintStyle: "apse",
    apseDepthRange: [1, 2],
    apseWidthRange: [1, 2],
    frontSide: "south",
    wallMaterial: "stone",
    // Churches: 2-3 steps (elevated, sacred threshold)
    foundationStepsRange: [2, 3],
    // Crypt beneath the church
    hasBasement: true,
    basementChance: 0.3,
    basementLevels: 1,
    basementCoverage: 0.4,
  },

  cathedral: {
    label: "Cathedral",
    widthRange: [3, 4],
    depthRange: [6, 8],
    floors: 1,
    floorsRange: [1, 2],
    entranceCount: 2,
    archBias: 0.95,
    extraConnectionChance: 0.15,
    entranceArchChance: 0.9,
    roomSpanRange: [3, 5],
    minRoomArea: 6,
    minUpperFloorCells: 4,
    minUpperFloorShrinkCells: 2,
    windowChance: 0.9,
    // Cruciform: cross-shaped plan with transept arms
    footprintStyle: "cruciform",
    transeptArmRange: [1, 2],
    transeptDepthRange: [1, 2],
    frontSide: "south",
    wallMaterial: "stone",
    // Cathedrals: 3-4 steps (grand, imposing entrance)
    foundationStepsRange: [3, 4],
    // Crypt / catacomb
    hasBasement: true,
    basementChance: 0.6,
    basementLevels: 1,
    basementCoverage: 0.5,
  },

  chapel: {
    label: "Chapel",
    widthRange: [2, 2],
    depthRange: [3, 4],
    floors: 1,
    entranceCount: 1,
    archBias: 0.85,
    extraConnectionChance: 0.05,
    entranceArchChance: 0.7,
    roomSpanRange: [1, 3],
    minRoomArea: 3,
    windowChance: 0.75,
    frontSide: "south",
    wallMaterial: "stone",
    // Chapels: 1-2 steps (modest but elevated)
    foundationStepsRange: [1, 2],
  },

  // ============================================================
  // CIVIC / GUILD
  // ============================================================

  "guild-hall": {
    label: "Guild Hall",
    widthRange: [4, 6],
    depthRange: [5, 7],
    floors: 2,
    floorsRange: [2, 2],
    entranceCount: 2,
    archBias: 0.8,
    extraConnectionChance: 0.4,
    entranceArchChance: 0.6,
    roomSpanRange: [2, 4],
    minRoomArea: 4,
    minUpperFloorCells: 4,
    minUpperFloorShrinkCells: 3,
    windowChance: 0.6,
    patioDoorChance: 0.3,
    patioDoorCountRange: [1, 1],
    // Gallery: open main hall on ground floor, walkway on upper
    footprintStyle: "gallery",
    galleryWidthRange: [1, 2],
    upperInsetRange: [2, 3],
    upperCarveChance: 0.1,
    frontSide: "south",
    wallMaterial: "wood",
    // Guild halls: 2-3 steps (civic importance)
    foundationStepsRange: [2, 3],
    // Guild storage / meeting rooms below
    hasBasement: true,
    basementChance: 0.5,
    basementLevels: 1,
    basementCoverage: 0.5,
  },

  "town-hall": {
    label: "Town Hall",
    widthRange: [4, 5],
    depthRange: [4, 6],
    floors: 2,
    floorsRange: [2, 3],
    entranceCount: 2,
    archBias: 0.75,
    extraConnectionChance: 0.35,
    entranceArchChance: 0.5,
    roomSpanRange: [2, 3],
    minRoomArea: 4,
    minUpperFloorCells: 5,
    minUpperFloorShrinkCells: 2,
    windowChance: 0.65,
    patioDoorChance: 0.4,
    patioDoorCountRange: [1, 2],
    // Foyer: grand entrance hall extending from the front
    footprintStyle: "foyer",
    foyerDepthRange: [1, 2],
    foyerWidthRange: [2, 3],
    excludeFoyerFromUpper: true,
    upperInsetRange: [1, 2],
    upperCarveChance: 0.15,
    frontSide: "south",
    wallMaterial: "stone",
    // Town halls: 3 steps (government authority)
    foundationSteps: 3,
    hasBasement: true,
    basementChance: 0.4,
    basementLevels: 1,
    basementCoverage: 0.4,
  },
};

/**
 * Get all available building type keys
 */
export function getBuildingTypes(): string[] {
  return Object.keys(BUILDING_RECIPES);
}

/**
 * Get a building recipe by type key
 */
export function getRecipe(typeKey: string): BuildingRecipe | null {
  return BUILDING_RECIPES[typeKey] || null;
}
