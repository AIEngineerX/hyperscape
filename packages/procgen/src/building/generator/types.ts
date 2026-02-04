/**
 * Building Generation Types
 * Core interfaces for procedural building generation
 */

// ============================================================
// RECIPE TYPES
// ============================================================

/**
 * Wall material types for building exteriors
 * Each type has a corresponding procedural pattern in the shader
 */
export type WallMaterialType =
  | "brick" // Red/brown brick with mortar - classic medieval
  | "stone" // Stone ashlar blocks - formal/civic buildings
  | "timber" // Timber frame with stucco infill - Tudor style
  | "stucco" // Plain stucco/plaster - simple cottages
  | "wood" // Vertical wood panels - board-and-batten style
  | "siding" // Horizontal wood planks - clapboard/lap siding
  | "solid"; // Solid color from vertex colors - for trim (window sills, door frames, railings)

/**
 * Material ID encoding for UV2 attribute
 * Shader uses this to select procedural pattern
 */
export const WALL_MATERIAL_IDS: Record<WallMaterialType, number> = {
  brick: 0.0,
  stone: 0.2,
  timber: 0.4,
  stucco: 0.6,
  wood: 0.8, // Vertical panels
  siding: 0.85, // Horizontal planks
  solid: 1.0, // Uses vertex colors directly, no procedural pattern
};

export interface BuildingRecipe {
  label: string;
  widthRange: [number, number];
  depthRange: [number, number];
  floors: number;
  floorsRange?: [number, number];
  entranceCount: number;
  archBias: number;
  extraConnectionChance: number;
  entranceArchChance: number;
  roomSpanRange: [number, number];
  minRoomArea: number;
  windowChance: number;
  carveChance?: number;
  carveSizeRange?: [number, number];
  frontSide: string;
  minUpperFloorCells?: number;
  minUpperFloorShrinkCells?: number;
  patioDoorChance?: number;
  patioDoorCountRange?: [number, number];
  // Wall material type for exterior walls
  wallMaterial?: WallMaterialType;
  // Footprint styles: "foyer" | "courtyard" | "gallery"
  footprintStyle?: string;
  // Foyer style options (extension at front)
  foyerDepthRange?: [number, number];
  foyerWidthRange?: [number, number];
  excludeFoyerFromUpper?: boolean;
  // Courtyard style options (open-air center)
  courtyardSizeRange?: [number, number];
  // Gallery style options (walkway around upper floor overlooking main hall)
  galleryWidthRange?: [number, number];
  // Upper floor options
  upperInsetRange?: [number, number];
  upperCarveChance?: number;
  requireUpperShrink?: boolean;
}

// ============================================================
// LAYOUT TYPES
// ============================================================

export interface Cell {
  col: number;
  row: number;
}

export interface Room {
  id: number;
  area: number;
  cells: Cell[];
  bounds: {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
  };
}

export interface FloorPlan {
  footprint: boolean[][];
  roomMap: number[][];
  rooms: Room[];
  internalOpenings: Map<string, string>;
  externalOpenings: Map<string, string>;
}

export interface StairPlacement {
  col: number;
  row: number;
  direction: string;
  landing: Cell;
}

export interface BuildingLayout {
  width: number;
  depth: number;
  floors: number;
  floorPlans: FloorPlan[];
  stairs: StairPlacement | null;
}

// ============================================================
// STATS AND OUTPUT TYPES
// ============================================================

export interface BuildingStats {
  wallSegments: number;
  doorways: number;
  archways: number;
  windows: number;
  roofPieces: number;
  floorTiles: number;
  stairSteps: number;
  props: number;
  rooms: number;
  footprintCells: number;
  upperFootprintCells: number;
  /** Optimization metrics */
  optimization?: {
    /** Number of merged floor rectangles (greedy meshing) */
    mergedFloorRects: number;
    /** Number of cached geometry hits */
    cacheHits: number;
    /** Estimated triangle count before optimization */
    estimatedTrisBefore: number;
    /** Actual triangle count after optimization */
    actualTrisAfter: number;
    /** Triangle reduction percentage */
    reductionPercent: number;
  };
}

export interface CounterPlacement {
  roomId: number;
  col: number;
  row: number;
  side: string;
  /** Optional second cell for 2-tile counter */
  secondCell?: { col: number; row: number };
}

export interface PropPlacements {
  innBar?: CounterPlacement | null;
  bankCounter?: CounterPlacement | null;
  /** Forge placement for smithy (blacksmith stands near the forge) */
  forge?: { col: number; row: number } | null;
}

// ============================================================
// FOOTPRINT TYPES
// ============================================================

export interface BaseFootprint {
  width: number;
  depth: number;
  cells: boolean[][];
  mainDepth: number;
  foyerCells: Set<number>;
  frontSide: string;
}

// RNG interface is imported from consolidated math/Random.ts
export type { RNG } from "../../math/Random.js";

// ============================================================
// GENERATION OPTIONS
// ============================================================

export interface BuildingGeneratorOptions {
  includeRoof?: boolean;
  seed?: string;
  /** Use optimized greedy meshing for floors/ceilings (default: true) */
  useGreedyMeshing?: boolean;
  /** Generate LOD meshes (default: false) */
  generateLODs?: boolean;
  /** Pre-computed layout to reuse (skips layout generation if provided) */
  cachedLayout?: BuildingLayout;
  /** Enable interior lighting baked into vertex colors (default: true) */
  enableInteriorLighting?: boolean;
  /** Interior light intensity multiplier (default: 1.0) */
  interiorLightIntensity?: number;
}

/** LOD level configuration */
export enum LODLevel {
  FULL = 0, // Full detail - all features
  MEDIUM = 1, // Simplified - merged walls, no window frames
  LOW = 2, // Minimal - single box with color
}

/** LOD mesh with distance threshold */
export interface LODMesh {
  level: LODLevel;
  mesh: THREE.Mesh | THREE.Group;
  /** Distance at which this LOD becomes active */
  distance: number;
}

/**
 * Separate geometry arrays for different material groups
 */
export interface BuildingGeometryArrays {
  /** Wall geometry (uses main wall material) */
  walls: THREE.BufferGeometry[];
  /** Floor geometry */
  floors: THREE.BufferGeometry[];
  /** Roof geometry */
  roofs: THREE.BufferGeometry[];
  /** Window frame geometry (wood/stone) */
  windowFrames: THREE.BufferGeometry[];
  /** Window glass pane geometry (transparent material) */
  windowGlass: THREE.BufferGeometry[];
  /** Door frame/trim geometry */
  doorFrames: THREE.BufferGeometry[];
  /** Shutter geometry */
  shutters: THREE.BufferGeometry[];
}

export interface GeneratedBuilding {
  mesh: THREE.Mesh | THREE.Group;
  layout: BuildingLayout;
  stats: BuildingStats;
  recipe: BuildingRecipe;
  typeKey: string;
  /** Optional LOD meshes for distance-based rendering */
  lods?: LODMesh[];
  /** Optional separate geometry arrays for multi-material rendering */
  geometryArrays?: BuildingGeometryArrays;
  /** Optional prop placements (NPC positions for inn bar, bank counter, etc.) */
  propPlacements?: PropPlacements;
}

// Import THREE types
import type * as THREE from "three";
