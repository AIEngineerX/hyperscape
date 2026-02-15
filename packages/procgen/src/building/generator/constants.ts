/**
 * Building Generation Constants
 * Dimensions, colors, and default values
 *
 * **Grid Alignment:**
 * Buildings are designed on a cell grid where each cell is CELL_SIZE (4m) square.
 * This aligns with the game's movement tile system where TILE_SIZE = 1m.
 * - 1 building cell = 4 x 4 = 16 movement tiles
 * - Building positions must be grid-aligned to ensure collision works correctly
 *
 * @see TileSystem.TILE_SIZE for movement tile size (1m)
 */

import * as THREE from "three";

// ============================================================
// GRID ALIGNMENT CONSTANTS
// ============================================================

/**
 * Size of one building cell in meters.
 * Each cell represents one "room" unit in the building grid.
 * This is 4x the movement TILE_SIZE (1m), so 1 cell = 4x4 = 16 tiles.
 */
export const CELL_SIZE = 4;

/**
 * Movement tile size in meters (must match TileSystem.TILE_SIZE).
 * Defined here for reference and grid calculation.
 */
export const MOVEMENT_TILE_SIZE = 1;

/**
 * Number of movement tiles per building cell edge.
 * CELL_SIZE / MOVEMENT_TILE_SIZE = 4 tiles per cell side.
 */
export const TILES_PER_CELL = CELL_SIZE / MOVEMENT_TILE_SIZE;

/**
 * Grid snap unit for building placement.
 * Buildings should snap to CELL_SIZE/2 = 2m intervals.
 * This ensures cell centers align with even-numbered tile boundaries.
 *
 * Example: A building at position (12, 0, 8) has cells centered at
 * (10, 8), (14, 8), etc. - all at tile boundaries divisible by CELL_SIZE/2.
 */
export const BUILDING_GRID_SNAP = CELL_SIZE / 2;

/**
 * Snap a world position to the building grid.
 * Ensures building positions align with the tile grid for proper collision.
 *
 * @param x - World X coordinate
 * @param z - World Z coordinate (optional, only x returned if not provided)
 * @returns Snapped coordinates { x, z }
 */
export function snapToBuildingGrid(
  x: number,
  z: number,
): { x: number; z: number } {
  // Validate inputs
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`[snapToBuildingGrid] Invalid coords: (${x}, ${z})`);
  }

  return {
    x: Math.round(x / BUILDING_GRID_SNAP) * BUILDING_GRID_SNAP,
    z: Math.round(z / BUILDING_GRID_SNAP) * BUILDING_GRID_SNAP,
  };
}

/**
 * Check if a position is grid-aligned.
 * @param x - World X coordinate
 * @param z - World Z coordinate
 * @returns True if position is on the building grid
 */
export function isGridAligned(x: number, z: number): boolean {
  const epsilon = 0.001;
  const xMod = Math.abs(
    ((x % BUILDING_GRID_SNAP) + BUILDING_GRID_SNAP) % BUILDING_GRID_SNAP,
  );
  const zMod = Math.abs(
    ((z % BUILDING_GRID_SNAP) + BUILDING_GRID_SNAP) % BUILDING_GRID_SNAP,
  );
  return (
    (xMod < epsilon || xMod > BUILDING_GRID_SNAP - epsilon) &&
    (zMod < epsilon || zMod > BUILDING_GRID_SNAP - epsilon)
  );
}

// ============================================================
// DIMENSIONS
// ============================================================

export const WALL_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.22;
export const FLOOR_THICKNESS = 0.2;
export const ROOF_THICKNESS = 0.22;
export const FLOOR_HEIGHT = WALL_HEIGHT + FLOOR_THICKNESS;

// ============================================================
// INTERIOR DIMENSIONS
// ============================================================

/**
 * Inset from exterior cell boundary to interior floor/ceiling edge.
 * Interior surfaces should be sized to fit WITHIN the walls, not overlap them.
 *
 * - Walls are WALL_THICKNESS thick, centered on the cell boundary
 * - Interior surfaces should stop at the INNER face of walls
 * - This equals half the wall thickness (wall extends WALL_THICKNESS/2 into the room)
 * - Add small epsilon (2cm) to prevent z-fighting at edges
 */
export const INTERIOR_INSET = WALL_THICKNESS / 2 + 0.02;

/**
 * Full interior span reduction per axis.
 * When a surface has external walls on BOTH sides of an axis,
 * reduce total span by this amount (double the inset).
 */
export const INTERIOR_SPAN_REDUCTION = INTERIOR_INSET * 2;

// Foundation - elevates building off ground for terrain robustness
export const FOUNDATION_HEIGHT = 0.6; // Raised 0.1m to prevent floor/terrain collision
export const FOUNDATION_OVERHANG = 0.15; // How much foundation extends past walls

/**
 * Z-fighting prevention offset for floor tiles.
 * Floor tile top surface is offset by this amount above the structural base
 * (foundation for ground floor, ceiling for upper floors) to prevent
 * coplanar surface z-fighting.
 */
export const FLOOR_ZFIGHT_OFFSET = 0.01;

// Terrain base - extends foundation below ground to handle uneven terrain
export const TERRAIN_DEPTH = 1.0; // How far foundation extends below ground level

// Entrance steps
export const ENTRANCE_STEP_HEIGHT = 0.3; // Height of each step (2 steps × 0.3 = 0.6m foundation)
export const ENTRANCE_STEP_DEPTH = 0.4; // Depth (horizontal) of each step
export const ENTRANCE_STEP_COUNT = 2; // Steps going UP to foundation
export const TERRAIN_STEP_COUNT = 4; // Additional steps going DOWN into terrain

// Terrace/balcony railings - posts with horizontal rails style
export const RAILING_HEIGHT = 1.0; // Total height of railing
export const RAILING_POST_SIZE = 0.1; // Thickness of vertical posts
export const RAILING_RAIL_HEIGHT = 0.06; // Height of horizontal rails
export const RAILING_RAIL_DEPTH = 0.04; // Depth of horizontal rails
export const RAILING_POST_SPACING = 1.2; // Max distance between posts (meters)
export const RAILING_THICKNESS = 0.08; // Legacy - kept for compatibility

export const DOOR_WIDTH = CELL_SIZE * 0.4;
export const DOOR_HEIGHT = WALL_HEIGHT * 0.7;
export const ARCH_WIDTH = CELL_SIZE * 0.5;
export const WINDOW_WIDTH = CELL_SIZE * 0.35;
export const WINDOW_HEIGHT = WALL_HEIGHT * 0.35;
export const WINDOW_SILL_HEIGHT = WALL_HEIGHT * 0.35;

export const COUNTER_HEIGHT = 1.05;
export const COUNTER_DEPTH = 0.55; // Realistic counter/bar depth (front-to-back)
export const COUNTER_LENGTH = CELL_SIZE * 1.1;
export const NPC_HEIGHT = 1.6;
export const NPC_WIDTH = 0.7;
export const FORGE_SIZE = 1.5;
export const ANVIL_SIZE = 0.75;

// ============================================================
// COUNTER & NPC POSITIONING
// ============================================================

/**
 * Distance from cell center toward the wall for counter center placement.
 * Layout from wall inward: wall -> NPC -> counter -> customer space
 *
 * With CELL_SIZE=4, wall inner face is at 1.89m from center.
 * Counter center at 0.85m leaves room for NPC behind (between counter and wall)
 * and customer space in front (0.575m to cell center).
 */
export const COUNTER_WALL_OFFSET = 0.85;

/**
 * Distance from cell center toward the wall for NPC standing behind counter.
 * NPC stands between the counter's wall-side face and the wall.
 *
 * Calculated as: wallInner - wallGap - NPC_WIDTH/2
 * = (CELL_SIZE/2 - WALL_THICKNESS/2) - 0.05 - NPC_WIDTH/2
 * = 1.89 - 0.05 - 0.35 = 1.49 ≈ 1.5m
 */
export const NPC_BEHIND_COUNTER_OFFSET = 1.5;

// ============================================================
// FURNITURE DIMENSIONS
// ============================================================

// Table dimensions
export const TABLE_WIDTH = 1.2; // Along X
export const TABLE_DEPTH = 0.8; // Along Z
export const TABLE_HEIGHT = 0.75; // Floor to top surface
export const TABLE_TOP_THICKNESS = 0.06; // Slab thickness
export const TABLE_LEG_SIZE = 0.08; // Leg cross-section

// Chair dimensions
export const CHAIR_WIDTH = 0.42;
export const CHAIR_DEPTH = 0.42;
export const CHAIR_SEAT_HEIGHT = 0.45;
export const CHAIR_BACK_HEIGHT = 0.5; // Height of backrest above seat
export const CHAIR_BACK_THICKNESS = 0.06;
export const CHAIR_TABLE_GAP = 0.15; // Gap between chair edge and table edge

// Bookshelf dimensions
export const BOOKSHELF_WIDTH = 1.0;
export const BOOKSHELF_DEPTH = 0.35;
export const BOOKSHELF_HEIGHT = 2.2; // Nearly wall height for imposing look
export const BOOKSHELF_SHELF_THICKNESS = 0.04;
export const BOOKSHELF_SIDE_THICKNESS = 0.05;

// Barrel dimensions
export const BARREL_DIAMETER = 0.55;
export const BARREL_HEIGHT = 0.75;

// Crate dimensions
export const CRATE_SIZE = 0.5;

// Wall sconce visible fixture dimensions
export const SCONCE_BRACKET_WIDTH = 0.08;
export const SCONCE_BRACKET_HEIGHT = 0.12;
export const SCONCE_BRACKET_DEPTH = 0.15;
export const SCONCE_CANDLE_SIZE = 0.04;
export const SCONCE_CANDLE_HEIGHT = 0.15;
export const SCONCE_MOUNT_HEIGHT = WALL_HEIGHT * 0.65; // Height on wall

// ============================================================
// COLORS
// ============================================================

export const palette = {
  // Walls
  wallOuter: new THREE.Color(0x8f8376), // Exterior wall - lighter stone
  wallInner: new THREE.Color(0x7a6f68), // Interior wall - slightly darker
  wallCorner: new THREE.Color(0x8f8376), // Corner posts - match exterior

  // Surfaces
  floor: new THREE.Color(0x5e534a), // Floor tiles - dark wood/stone
  ceiling: new THREE.Color(0x6e6358), // Ceiling tiles - slightly lighter
  roof: new THREE.Color(0x523c33), // Roof pieces - dark shingles
  patio: new THREE.Color(0x3f444c), // Terrace/patio - slate gray
  foundation: new THREE.Color(0x5a524a), // Foundation - darker stone

  // Trim and details
  trim: new THREE.Color(0x6e5d52), // Railings, skirts - darker accent
  stairs: new THREE.Color(0x6e6258), // Stair treads

  // Furniture - counters
  counter: new THREE.Color(0x4b3a2f), // Bank counter - dark wood
  bar: new THREE.Color(0x3a2b22), // Bar counter - darker wood

  // Furniture - interior items
  table: new THREE.Color(0x5a4a3f), // Table - medium-dark wood
  chair: new THREE.Color(0x6b5c4f), // Chair - slightly lighter wood
  bookshelf: new THREE.Color(0x3d2e23), // Bookshelf - dark stained wood
  barrel: new THREE.Color(0x5c4535), // Barrel - warm brown wood
  crate: new THREE.Color(0x7a6a58), // Crate - raw/lighter wood
  sconceBracket: new THREE.Color(0x3a3a3a), // Sconce bracket - dark iron
  sconceCandle: new THREE.Color(0xfff8e7), // Candle - cream/ivory

  // NPCs (placeholder colors)
  banker: new THREE.Color(0xff3b30), // Banker NPC
  innkeeper: new THREE.Color(0x4cc9f0), // Innkeeper NPC

  // Forge props
  forge: new THREE.Color(0x7f1d1d), // Forge - dark red/brick
  anvil: new THREE.Color(0x4b5563), // Anvil - gray metal
};

// ============================================================
// DIRECTION UTILITIES
// ============================================================

export function getSideVector(side: string): { x: number; z: number } {
  switch (side) {
    case "north":
      return { x: 0, z: -1 };
    case "south":
      return { x: 0, z: 1 };
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    default:
      return { x: 0, z: 1 };
  }
}

export function getOppositeSide(side: string): string {
  switch (side) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "east":
      return "west";
    case "west":
      return "east";
    default:
      return "north";
  }
}
