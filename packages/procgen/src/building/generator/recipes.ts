/**
 * Building Recipes
 * Predefined building type configurations
 */

import type { BuildingRecipe } from "./types";

export const BUILDING_RECIPES: Record<string, BuildingRecipe> = {
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
    wallMaterial: "stucco", // Simple cottages use plain stucco
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
    wallMaterial: "siding", // Horizontal wood siding
  },
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
    wallMaterial: "timber", // Tudor-style timber frame
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
    wallMaterial: "stone", // Formal stone for banks
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
    wallMaterial: "timber", // Tudor-style shops
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
    wallMaterial: "brick", // Fire-resistant brick for forges
  },

  // ============================================================
  // LARGE RESIDENTIAL
  // ============================================================

  mansion: {
    label: "Mansion",
    widthRange: [5, 7],
    depthRange: [5, 7],
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
    carveChance: 0.3,
    carveSizeRange: [1, 2],
    upperInsetRange: [1, 2],
    upperCarveChance: 0.2,
    frontSide: "south",
    wallMaterial: "brick", // Fine brick for mansions
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
    footprintStyle: "courtyard",
    courtyardSizeRange: [1, 2],
    patioDoorChance: 0.3,
    patioDoorCountRange: [1, 1],
    frontSide: "south",
    wallMaterial: "stone", // Fortified stone
  },

  fortress: {
    label: "Fortress",
    widthRange: [6, 8],
    depthRange: [6, 8],
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
    footprintStyle: "courtyard",
    courtyardSizeRange: [2, 3],
    patioDoorChance: 0.4,
    patioDoorCountRange: [1, 2],
    frontSide: "south",
    wallMaterial: "stone", // Massive stone walls
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
    carveChance: 0.0,
    frontSide: "south",
    wallMaterial: "stone", // Sacred stone
  },

  cathedral: {
    label: "Cathedral",
    widthRange: [4, 5],
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
    carveChance: 0.0,
    footprintStyle: "foyer",
    foyerDepthRange: [1, 2],
    foyerWidthRange: [2, 3],
    excludeFoyerFromUpper: true,
    frontSide: "south",
    wallMaterial: "stone", // Grand stone cathedral
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
    footprintStyle: "gallery",
    galleryWidthRange: [1, 2],
    upperInsetRange: [2, 3],
    upperCarveChance: 0.1,
    frontSide: "south",
    wallMaterial: "wood", // Vertical wood panels
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
