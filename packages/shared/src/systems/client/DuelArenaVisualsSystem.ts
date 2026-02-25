/**
 * DuelArenaVisualsSystem - Procedural Duel Arena Rendering
 *
 * Creates visual geometry for the duel arena without requiring external models.
 * Uses procedural Three.js geometry and TSL shader materials to render:
 * - 6 arena floors with stone tile textures, border trim, and number markers
 * - Stone pillar architecture at corners with torches/fire
 * - Continuous stone fences (fully enclosed, TSL procedural sandstone material)
 * - Colored banners mounted on east/west arena fences
 * - Lobby with textured floor, corner braziers, and benches
 * - Hospital with 3D cross and healing particle glow
 * - Ambient dust particles and decorative border pillars
 *
 * Arena Layout (OSRS-style):
 * - 6 rectangular arenas in a 2x3 grid
 * - Each arena is 20m wide x 24m long
 * - 4m gap between arenas
 * - Base coordinates: x=60, z=80 (near spawn)
 */

import THREE, { MeshStandardNodeMaterial } from "../../extras/three/three";
import {
  Fn,
  positionWorld,
  vec2,
  vec3,
  vec4,
  float,
  floor as tslFloor,
  fract,
  sin,
  dot,
  mix,
  smoothstep,
  min as tslMin,
  mod,
} from "three/tsl";
import { System } from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types/index";
import { getPhysX } from "../../physics/PhysXManager";
import { Layers } from "../../physics/Layers";
import type { Physics } from "../shared/interaction/Physics";
import type { PxRigidStatic } from "../../types/systems/physics";
import type { ParticleSystem } from "../shared/presentation/ParticleSystem";
import type { FlatZone } from "../../types/world/terrain";

// ============================================================================
// Arena Configuration (matches ArenaPoolManager)
// ============================================================================

const ARENA_BASE_X = 60;
const ARENA_BASE_Z = 80;
const ARENA_WIDTH = 20;
const ARENA_LENGTH = 24;
const ARENA_GAP = 4;
const ARENA_COUNT = 6;
// Stone fence configuration
const FENCE_HEIGHT = 1.5;
const FENCE_POST_SPACING = 2.0;
const FENCE_POST_SIZE = 0.2; // Square stone posts
const FENCE_RAIL_HEIGHT = 0.08;
const FENCE_RAIL_DEPTH = 0.08;
const FENCE_RAIL_HEIGHTS = [0.3, 0.75, 1.2]; // Heights of horizontal rails
const FLOOR_THICKNESS = 0.3; // BoxGeometry height for floors
// Floor positioning relative to PROCEDURAL terrain height:
// - heightOffset in JSON = 0.4 (where players stand above procedural terrain)
// - Floor TOP should be at procedural + 0.4 + 0.02 (2cm above terrain mesh to prevent z-fighting)
// - Floor CENTER = procedural + 0.4 + 0.02 - 0.15 = procedural + 0.27
const FLOOR_HEIGHT_OFFSET = 0.27; // Floor center position above procedural terrain

// Lobby configuration
const LOBBY_CENTER_X = 105;
const LOBBY_CENTER_Z = 62;
const LOBBY_WIDTH = 40;
const LOBBY_LENGTH = 25;

// Hospital configuration
const HOSPITAL_CENTER_X = 65;
const HOSPITAL_CENTER_Z = 62;
const HOSPITAL_WIDTH = 30;
const HOSPITAL_LENGTH = 25;

// Colors - OSRS-style tan/brown
const ARENA_FENCE_COLOR = 0x8b7355; // Wood brown for fences
const LOBBY_FLOOR_COLOR = 0xc9b896; // Lighter tan for lobby
const HOSPITAL_FLOOR_COLOR = 0xffffff; // White hospital floor

// Tile texture configuration (used by lobby floor canvas texture)
const TILE_TEXTURE_SIZE = 512;
const TILE_TEXTURE_WORLD_SIZE = 8; // meters the texture covers before repeating

// Lobby tile texture configuration
const LOBBY_TILE_GRID = 3; // 3x3 larger tiles
const LOBBY_TILE_GROUT_WIDTH = 6; // wider grout lines

// Torch configuration
const TORCH_LIGHT_INTENSITY = 0.8;
const TORCH_LIGHT_RANGE = 6;
const TORCH_LIGHT_COLOR = 0xff6600;
const TORCH_BRAZIER_RADIUS = 0.12;

// Forfeit pillar configuration
const FORFEIT_PILLAR_RADIUS = 0.4;
const FORFEIT_PILLAR_HEIGHT = 1.2;
const FORFEIT_PILLAR_COLOR = 0x8b4513; // Saddle brown (wooden trapdoor look)
const FORFEIT_PILLAR_EMISSIVE = 0x4a2510;

// Stone pillar configuration
const PILLAR_BASE_SIZE = 0.5;
const PILLAR_BASE_HEIGHT = 0.1;
const PILLAR_SHAFT_SIZE = 0.35;
const PILLAR_SHAFT_HEIGHT = 2.0;
const PILLAR_CAPITAL_SIZE = 0.45;
const PILLAR_CAPITAL_HEIGHT = 0.12;
const PILLAR_STONE_COLOR = 0x908878;
const PILLAR_TOTAL_HEIGHT =
  PILLAR_BASE_HEIGHT + PILLAR_SHAFT_HEIGHT + PILLAR_CAPITAL_HEIGHT; // ~2.22m

// Floor border trim configuration
const BORDER_HEIGHT = 0.08;
const BORDER_WIDTH = 0.25;
const BORDER_COLOR = 0xa08060;

// Lobby brazier configuration
const LOBBY_BRAZIER_HEIGHT = 1.8;

// Banner configuration
const BANNER_POLE_HEIGHT = 3.0;
const BANNER_POLE_RADIUS = 0.03;
const BANNER_CLOTH_WIDTH = 0.6;
const BANNER_CLOTH_HEIGHT = 1.2;
const BANNER_COLORS: number[] = [
  0xcc3333, 0xcc3333, 0x3366cc, 0x3366cc, 0x33aa44, 0x33aa44,
];

// Arena marker configuration
const MARKER_RADIUS = 0.6;
const MARKER_HEIGHT = 0.06;
const MARKER_DOT_RADIUS = 0.06;
const MARKER_DOT_COLOR = 0xffcc00;

// Marker dot patterns per arena (offsets from pedestal center)
const MARKER_DOT_PATTERNS: number[][][] = [
  [[0, 0]], // 1 dot
  [
    [-0.15, 0],
    [0.15, 0],
  ], // 2 dots
  [
    [0, -0.15],
    [-0.15, 0.1],
    [0.15, 0.1],
  ], // triangle
  [
    [-0.15, -0.15],
    [0.15, -0.15],
    [-0.15, 0.15],
    [0.15, 0.15],
  ], // square
  [
    [0, 0],
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ], // quincunx
  [
    [-0.12, -0.2],
    [0.12, -0.2],
    [-0.12, 0],
    [0.12, 0],
    [-0.12, 0.2],
    [0.12, 0.2],
  ], // 2x3 grid
];

// Bench configuration
const BENCH_SEAT_WIDTH = 2.0;
const BENCH_SEAT_DEPTH = 0.5;
const BENCH_SEAT_THICKNESS = 0.08;
const BENCH_SEAT_HEIGHT = 0.5;
const BENCH_LEG_WIDTH = 0.1;
const BENCH_LEG_DEPTH = 0.4;

// ============================================================================
// TSL Procedural Stone Functions
// ============================================================================

/** Pseudo-random hash for TSL shaders (same pattern as DockMaterialTSL) */
const tslHash = Fn(([p]: [ReturnType<typeof vec2>]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
});

/** 2D Perlin-style noise for TSL shaders */
const tslNoise2D = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const i = tslFloor(p);
  const f = fract(p);
  const smoothF = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

  const a = tslHash(i);
  const b = tslHash(i.add(vec2(1.0, 0.0)));
  const c = tslHash(i.add(vec2(0.0, 1.0)));
  const d = tslHash(i.add(vec2(1.0, 1.0)));

  return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
});

/**
 * Running-bond stone block pattern for sandstone fences.
 * Returns vec4(isStone, blockId.x, blockId.y, bevel).
 */
const sandstoneBlockPattern = Fn(([uvIn]: [ReturnType<typeof vec2>]) => {
  const blockWidth = float(0.6);
  const blockHeight = float(0.3);
  const mortarWidth = float(0.015);

  const scaled = uvIn.div(vec2(blockWidth, blockHeight));
  const row = tslFloor(scaled.y);
  const rowOffset = mod(row, float(2.0)).mul(0.5); // Running bond offset
  const offsetUV = vec2(scaled.x.add(rowOffset), scaled.y);

  const blockId = tslFloor(offsetUV);
  const localUV = fract(offsetUV);

  const mortarU = mortarWidth.div(blockWidth);
  const mortarV = mortarWidth.div(blockHeight);

  // Edge distance for bevel effect (blocks appear raised)
  const edgeDistX = tslMin(localUV.x, float(1.0).sub(localUV.x));
  const edgeDistY = tslMin(localUV.y, float(1.0).sub(localUV.y));
  const bevel = smoothstep(
    float(0.0),
    float(0.06),
    tslMin(edgeDistX, edgeDistY),
  );

  // Anti-aliased mortar detection
  const isStone = smoothstep(mortarU, mortarU.add(float(0.01)), localUV.x)
    .mul(
      smoothstep(mortarU, mortarU.add(float(0.01)), float(1.0).sub(localUV.x)),
    )
    .mul(smoothstep(mortarV, mortarV.add(float(0.01)), localUV.y))
    .mul(
      smoothstep(mortarV, mortarV.add(float(0.01)), float(1.0).sub(localUV.y)),
    );

  return vec4(isStone, blockId.x, blockId.y, bevel);
});

/**
 * Square grid tile pattern for arena floors (large flagstones).
 * Returns vec4(isStone, tileId.x, tileId.y, bevel) — same interface as sandstoneBlockPattern.
 * Uses positionWorld.xz for seamless world-space tiling.
 */
const floorTilePattern = Fn(([uvIn]: [ReturnType<typeof vec2>]) => {
  const tileSize = float(1.2); // ~1.2m square flagstones
  const mortarWidth = float(0.02); // thin grout lines

  const scaled = uvIn.div(tileSize);
  const tileId = tslFloor(scaled);
  const localUV = fract(scaled);

  const mortarFrac = mortarWidth.div(tileSize);

  // Edge distance for bevel effect (subtle tile edge darkening)
  const edgeDistX = tslMin(localUV.x, float(1.0).sub(localUV.x));
  const edgeDistY = tslMin(localUV.y, float(1.0).sub(localUV.y));
  const bevel = smoothstep(
    float(0.0),
    float(0.05),
    tslMin(edgeDistX, edgeDistY),
  );

  // Anti-aliased mortar detection
  const isStone = smoothstep(mortarFrac, mortarFrac.add(float(0.01)), localUV.x)
    .mul(
      smoothstep(
        mortarFrac,
        mortarFrac.add(float(0.01)),
        float(1.0).sub(localUV.x),
      ),
    )
    .mul(smoothstep(mortarFrac, mortarFrac.add(float(0.01)), localUV.y))
    .mul(
      smoothstep(
        mortarFrac,
        mortarFrac.add(float(0.01)),
        float(1.0).sub(localUV.y),
      ),
    );

  return vec4(isStone, tileId.x, tileId.y, bevel);
});

// ============================================================================
// DuelArenaVisualsSystem
// ============================================================================

export class DuelArenaVisualsSystem extends System {
  name = "duel-arena-visuals";

  /** Container for all arena geometry */
  private arenaGroup: THREE.Group | null = null;

  /** Materials (cached for cleanup) */
  private materials: THREE.Material[] = [];

  /** Geometries (cached for cleanup) */
  private geometries: THREE.BufferGeometry[] = [];

  /** Textures (cached for cleanup) */
  private textures: THREE.Texture[] = [];

  /** Track if visuals have been created */
  private visualsCreated = false;

  /** Reference to terrain system for height queries */
  private terrainSystem: {
    getHeightAt?: (x: number, z: number) => number;
    getProceduralHeightAt?: (x: number, z: number) => number;
    registerFlatZone?: (zone: FlatZone) => void;
    unregisterFlatZone?: (id: string) => void;
  } | null = null;

  /** Flat zone IDs registered with the terrain system */
  private flatZoneIds: string[] = [];

  /** Reference to physics system for collision bodies */
  private physicsSystem: Physics | null = null;

  /** Physics bodies for cleanup */
  private physicsBodies: PxRigidStatic[] = [];

  /** Torch PointLights for flicker animation + cleanup */
  private torchLights: THREE.PointLight[] = [];

  /** Lobby brazier PointLights for flicker animation + cleanup */
  private lobbyLights: THREE.PointLight[] = [];

  /** All particle emitter IDs for cleanup */
  private particleEmitterIds: string[] = [];

  /** Cached TSL stone fence material (shared across all arenas) */
  private stoneFenceMaterial: MeshStandardNodeMaterial | null = null;

  /** Cached TSL procedural floor material (shared across all arenas — world-space UVs) */
  private arenaFloorMaterial: MeshStandardNodeMaterial | null = null;

  /** Animation time accumulator for torch flicker */
  private animTime = 0;

  constructor(world: World) {
    super(world);
  }

  /**
   * Readiness hook used by spectator loading flow to avoid showing
   * duel contestants before arena floors are spawned.
   */
  isReady(): boolean {
    return this.visualsCreated;
  }

  /**
   * Get terrain height at world position (includes flat zone adjustments)
   */
  private getTerrainHeight(x: number, z: number): number {
    if (this.terrainSystem?.getHeightAt) {
      try {
        const height = this.terrainSystem.getHeightAt(x, z);
        return height ?? 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * Get PROCEDURAL terrain height (bypasses flat zones).
   * Used to position floors above the actual terrain mesh.
   */
  private getProceduralTerrainHeight(x: number, z: number): number {
    if (this.terrainSystem?.getProceduralHeightAt) {
      try {
        const height = this.terrainSystem.getProceduralHeightAt(x, z);
        return height ?? 0;
      } catch {
        return 0;
      }
    }
    // Fallback to regular terrain height
    return this.getTerrainHeight(x, z);
  }

  async init(options?: WorldOptions): Promise<void> {
    await super.init(options as WorldOptions);
    console.log(
      "[DuelArenaVisualsSystem] init() called, isClient:",
      this.world.isClient,
    );
  }

  /**
   * Called after all systems are initialized and world is ready
   */
  start(): void {
    // Get terrain system for height queries
    this.terrainSystem = this.world.getSystem("terrain") as {
      getHeightAt?: (x: number, z: number) => number;
      getProceduralHeightAt?: (x: number, z: number) => number;
      registerFlatZone?: (zone: FlatZone) => void;
      unregisterFlatZone?: (id: string) => void;
    } | null;

    if (!this.terrainSystem?.getHeightAt) {
      console.warn(
        "[DuelArenaVisualsSystem] TerrainSystem not available, using fallback heights",
      );
    }

    // Get physics system for collision bodies
    this.physicsSystem = this.world.getSystem("physics") as Physics | null;
    if (!this.physicsSystem) {
      console.warn(
        "[DuelArenaVisualsSystem] Physics system not available, floors will have no collision",
      );
    }

    // Register flat zones so terrain height queries return floor-level values
    // (prevents players sinking into floors and grass growing through them)
    this.registerArenaFlatZones();

    console.log(
      "[DuelArenaVisualsSystem] start() called, creating arena visuals...",
    );
    this.createArenaVisuals();
  }

  /**
   * Register flat zones with the terrain system for all duel arena floors.
   * This ensures getHeightAt() returns the floor-level height so players
   * stand ON the floors (not sinking through) and terrain mesh is flattened
   * to prevent grass from growing through floor surfaces.
   */
  private registerArenaFlatZones(): void {
    if (!this.terrainSystem?.registerFlatZone) {
      console.warn(
        "[DuelArenaVisualsSystem] TerrainSystem.registerFlatZone not available, skipping flat zone registration",
      );
      return;
    }

    const FLAT_ZONE_HEIGHT_OFFSET = 0.4; // Where players stand above procedural terrain
    const BLEND_RADIUS = 1.0;
    const CARVE_INSET = 1.0;

    // Register flat zones for all 6 arenas
    for (let i = 0; i < ARENA_COUNT; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const centerX =
        ARENA_BASE_X + col * (ARENA_WIDTH + ARENA_GAP) + ARENA_WIDTH / 2;
      const centerZ =
        ARENA_BASE_Z + row * (ARENA_LENGTH + ARENA_GAP) + ARENA_LENGTH / 2;

      const proceduralHeight = this.getProceduralTerrainHeight(
        centerX,
        centerZ,
      );
      const zoneId = `duel_arena_floor_${i + 1}`;

      const zone: FlatZone = {
        id: zoneId,
        centerX,
        centerZ,
        width: ARENA_WIDTH,
        depth: ARENA_LENGTH,
        height: proceduralHeight + FLAT_ZONE_HEIGHT_OFFSET,
        blendRadius: BLEND_RADIUS,
        carveInset: CARVE_INSET,
      };

      this.terrainSystem.registerFlatZone(zone);
      this.flatZoneIds.push(zoneId);
    }

    // Register flat zone for lobby
    {
      const proceduralHeight = this.getProceduralTerrainHeight(
        LOBBY_CENTER_X,
        LOBBY_CENTER_Z,
      );
      const zoneId = "duel_lobby_floor";

      const zone: FlatZone = {
        id: zoneId,
        centerX: LOBBY_CENTER_X,
        centerZ: LOBBY_CENTER_Z,
        width: LOBBY_WIDTH,
        depth: LOBBY_LENGTH,
        height: proceduralHeight + FLAT_ZONE_HEIGHT_OFFSET,
        blendRadius: BLEND_RADIUS,
        carveInset: CARVE_INSET,
      };

      this.terrainSystem.registerFlatZone(zone);
      this.flatZoneIds.push(zoneId);
    }

    // Register flat zone for hospital
    {
      const proceduralHeight = this.getProceduralTerrainHeight(
        HOSPITAL_CENTER_X,
        HOSPITAL_CENTER_Z,
      );
      const zoneId = "duel_hospital_floor";

      const zone: FlatZone = {
        id: zoneId,
        centerX: HOSPITAL_CENTER_X,
        centerZ: HOSPITAL_CENTER_Z,
        width: HOSPITAL_WIDTH,
        depth: HOSPITAL_LENGTH,
        height: proceduralHeight + FLAT_ZONE_HEIGHT_OFFSET,
        blendRadius: BLEND_RADIUS,
        carveInset: CARVE_INSET,
      };

      this.terrainSystem.registerFlatZone(zone);
      this.flatZoneIds.push(zoneId);
    }

    console.log(
      `[DuelArenaVisualsSystem] Registered ${this.flatZoneIds.length} flat zones (${ARENA_COUNT} arenas + lobby + hospital)`,
    );
  }

  /**
   * Create all arena visual geometry
   */
  private createArenaVisuals(): void {
    if (this.visualsCreated) {
      console.log("[DuelArenaVisualsSystem] Visuals already created, skipping");
      return;
    }

    if (this.world.isClient) {
      this.arenaGroup = new THREE.Group();
      this.arenaGroup.name = "DuelArenaVisuals";
    }

    // Create lobby floor with braziers and benches
    this.createLobbyFloor();

    // Create hospital floor
    this.createHospitalFloor();

    // Create border pillars at lobby/hospital corners
    this.createBorderPillars();

    // Create 6 arena floors, walls, and features
    for (let i = 0; i < ARENA_COUNT; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;

      const centerX =
        ARENA_BASE_X + col * (ARENA_WIDTH + ARENA_GAP) + ARENA_WIDTH / 2;
      const centerZ =
        ARENA_BASE_Z + row * (ARENA_LENGTH + ARENA_GAP) + ARENA_LENGTH / 2;

      this.createArenaFloor(centerX, centerZ, i + 1);
      this.createArenaWalls(centerX, centerZ);
      this.createForfeitPillars(centerX, centerZ, i + 1);
      this.createCornerPillars(centerX, centerZ, i + 1);
      this.createBanners(centerX, centerZ, i + 1);
    }

    // Add to scene (client-only)
    if (this.world.isClient) {
      if (this.world.stage?.scene) {
        this.world.stage.scene.add(this.arenaGroup!);
        this.visualsCreated = true;
        console.log(
          `[DuelArenaVisualsSystem] Added arena visuals to scene at x=${ARENA_BASE_X}, z=${ARENA_BASE_Z}`,
        );
        console.log(
          `[DuelArenaVisualsSystem] Created ${ARENA_COUNT} arenas, lobby at (${LOBBY_CENTER_X}, ${LOBBY_CENTER_Z}), hospital at (${HOSPITAL_CENTER_X}, ${HOSPITAL_CENTER_Z})`,
        );
        console.log(
          `[DuelArenaVisualsSystem] Total meshes in group: ${this.arenaGroup!.children.length}, geometries: ${this.geometries.length}, materials: ${this.materials.length}`,
        );

        // Register duel areas with grass exclusion manager
        this.registerGrassExclusions();
      } else {
        console.warn(
          "[DuelArenaVisualsSystem] No stage/scene available, cannot add arena visuals",
        );
      }
    } else {
      // On server, visuals are considered "created" once physics are set up
      this.visualsCreated = true;
    }
  }

  /**
   * Register all duel arena areas with the grass exclusion manager
   * to prevent grass from growing through arena floors
   */
  private async registerGrassExclusions(): Promise<void> {
    try {
      const { getGrassExclusionManager } =
        await import("../../systems/shared/world/GrassExclusionManager");
      const exclusionManager = getGrassExclusionManager();

      if (!exclusionManager) {
        console.warn(
          "[DuelArenaVisualsSystem] GrassExclusionManager not available",
        );
        return;
      }

      const margin = 1.0; // Extra margin around floors

      // Register each arena floor
      for (let i = 0; i < ARENA_COUNT; i++) {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const centerX =
          ARENA_BASE_X + col * (ARENA_WIDTH + ARENA_GAP) + ARENA_WIDTH / 2;
        const centerZ =
          ARENA_BASE_Z + row * (ARENA_LENGTH + ARENA_GAP) + ARENA_LENGTH / 2;

        exclusionManager.addRectangularBlocker(
          `duel_arena_${i + 1}`,
          centerX,
          centerZ,
          ARENA_WIDTH + margin * 2,
          ARENA_LENGTH + margin * 2,
          0, // No rotation
          0.5, // Soft fade at edges
        );
      }

      // Register lobby floor
      exclusionManager.addRectangularBlocker(
        "duel_lobby",
        LOBBY_CENTER_X,
        LOBBY_CENTER_Z,
        LOBBY_WIDTH + margin * 2,
        LOBBY_LENGTH + margin * 2,
        0,
        0.5,
      );

      // Register hospital floor
      exclusionManager.addRectangularBlocker(
        "duel_hospital",
        HOSPITAL_CENTER_X,
        HOSPITAL_CENTER_Z,
        HOSPITAL_WIDTH + margin * 2,
        HOSPITAL_LENGTH + margin * 2,
        0,
        0.5,
      );

      console.log(
        `[DuelArenaVisualsSystem] Registered ${ARENA_COUNT + 2} grass exclusion zones (arenas + lobby + hospital)`,
      );
    } catch (error) {
      console.warn(
        "[DuelArenaVisualsSystem] Failed to register grass exclusions:",
        error,
      );
    }
  }

  /**
   * Generate a lobby-specific tile texture with larger 3x3 tiles,
   * lighter sandstone colors, and wider grout lines.
   */
  private generateLobbyTileTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_TEXTURE_SIZE;
    canvas.height = TILE_TEXTURE_SIZE;
    const ctx = canvas.getContext("2d")!;

    const tileSize = TILE_TEXTURE_SIZE / LOBBY_TILE_GRID;

    // Lighter grout for lobby
    ctx.fillStyle = "#8a7a5e";
    ctx.fillRect(0, 0, TILE_TEXTURE_SIZE, TILE_TEXTURE_SIZE);

    for (let row = 0; row < LOBBY_TILE_GRID; row++) {
      for (let col = 0; col < LOBBY_TILE_GRID; col++) {
        const x = col * tileSize + LOBBY_TILE_GROUT_WIDTH / 2;
        const y = row * tileSize + LOBBY_TILE_GROUT_WIDTH / 2;
        const w = tileSize - LOBBY_TILE_GROUT_WIDTH;
        const h = tileSize - LOBBY_TILE_GROUT_WIDTH;

        // Lighter sandstone for lobby
        const rBase = 200 + Math.floor(Math.random() * 25);
        const gBase = 175 + Math.floor(Math.random() * 20);
        const bBase = 140 + Math.floor(Math.random() * 20);
        ctx.fillStyle = `rgb(${rBase},${gBase},${bBase})`;
        ctx.fillRect(x, y, w, h);

        // Fine speckle noise
        for (let s = 0; s < 100; s++) {
          const sx = x + Math.random() * w;
          const sy = y + Math.random() * h;
          const brightness = Math.random() * 30 - 15;
          const r = Math.min(255, Math.max(0, rBase + brightness));
          const g = Math.min(255, Math.max(0, gBase + brightness));
          const b = Math.min(255, Math.max(0, bBase + brightness));
          ctx.fillStyle = `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)},0.35)`;
          ctx.fillRect(sx, sy, 2 + Math.random() * 3, 2 + Math.random() * 3);
        }

        // Edge darkening
        ctx.strokeStyle = "rgba(0,0,0,0.06)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  // ============================================================================
  // Arena Floor & Border
  // ============================================================================

  /**
   * Create a single arena floor - snapped to terrain height
   */
  private createArenaFloor(
    centerX: number,
    centerZ: number,
    arenaId: number,
  ): void {
    // Get PROCEDURAL terrain height (not flat zone height) to position floor above actual terrain mesh
    const terrainY = this.getProceduralTerrainHeight(centerX, centerZ);
    const floorY = terrainY + FLOOR_HEIGHT_OFFSET;

    const floorWidth = ARENA_WIDTH - 1;
    const floorLength = ARENA_LENGTH - 1;

    if (this.world.isClient) {
      const geometry = new THREE.BoxGeometry(
        floorWidth,
        FLOOR_THICKNESS,
        floorLength,
      );

      // Lazily create shared TSL procedural floor material
      if (!this.arenaFloorMaterial) {
        this.arenaFloorMaterial = this.createArenaFloorMaterial();
        this.materials.push(this.arenaFloorMaterial);
      }

      const floor = new THREE.Mesh(geometry, this.arenaFloorMaterial);
      floor.position.set(centerX, floorY, centerZ);
      floor.name = `ArenaFloor_${arenaId}`;

      // Layer 2 for click-to-move raycasting (walkable surface)
      // Layer 0 so minimap camera (layer 0 only) can see floors where terrain is carved
      floor.layers.set(2);
      floor.layers.enable(0);
      floor.userData = {
        type: "arena-floor",
        walkable: true,
        arenaId,
      };

      console.log(
        `[DuelArenaVisualsSystem] Created floor ${arenaId} at (${centerX}, ${floorY.toFixed(1)}, ${centerZ}) - terrain=${terrainY.toFixed(1)}`,
      );

      this.geometries.push(geometry);
      this.arenaGroup!.add(floor);

      // Add raised stone border trim around the floor
      this.createFloorBorder(centerX, centerZ, floorY, floorWidth, floorLength);
    }

    // Create physics collision body for the floor
    this.createFloorCollision(
      centerX,
      floorY,
      centerZ,
      floorWidth,
      floorLength,
      `arena_floor_${arenaId}`,
    );
  }

  /**
   * Create raised stone border trim strips around an arena floor.
   * 4 BoxGeometry strips forming a raised lip (8cm high, 25cm wide).
   */
  private createFloorBorder(
    centerX: number,
    centerZ: number,
    floorY: number,
    floorWidth: number,
    floorLength: number,
  ): void {
    const borderMaterial = new MeshStandardNodeMaterial({
      color: BORDER_COLOR,
      roughness: 0.85,
    });
    this.materials.push(borderMaterial);

    const borderY = floorY + FLOOR_THICKNESS / 2 + BORDER_HEIGHT / 2;
    const halfW = floorWidth / 2;
    const halfL = floorLength / 2;

    // North strip (full width)
    const northGeom = new THREE.BoxGeometry(
      floorWidth,
      BORDER_HEIGHT,
      BORDER_WIDTH,
    );
    this.geometries.push(northGeom);
    const north = new THREE.Mesh(northGeom, borderMaterial);
    north.position.set(centerX, borderY, centerZ - halfL + BORDER_WIDTH / 2);
    north.layers.set(1);
    this.arenaGroup!.add(north);

    // South strip (full width)
    const south = new THREE.Mesh(northGeom, borderMaterial);
    south.position.set(centerX, borderY, centerZ + halfL - BORDER_WIDTH / 2);
    south.layers.set(1);
    this.arenaGroup!.add(south);

    // West strip (shortened to avoid corner overlap)
    const sideGeom = new THREE.BoxGeometry(
      BORDER_WIDTH,
      BORDER_HEIGHT,
      floorLength - 2 * BORDER_WIDTH,
    );
    this.geometries.push(sideGeom);
    const west = new THREE.Mesh(sideGeom, borderMaterial);
    west.position.set(centerX - halfW + BORDER_WIDTH / 2, borderY, centerZ);
    west.layers.set(1);
    this.arenaGroup!.add(west);

    // East strip
    const east = new THREE.Mesh(sideGeom, borderMaterial);
    east.position.set(centerX + halfW - BORDER_WIDTH / 2, borderY, centerZ);
    east.layers.set(1);
    this.arenaGroup!.add(east);
  }

  // ============================================================================
  // Stone Fences (fully enclosed, no gaps)
  // ============================================================================

  /**
   * Create TSL procedural stone material for fence posts and rails.
   * GPU-computed sandstone block pattern with per-block color variation,
   * mortar grooves, and normal-mapped raised blocks.
   */
  private createStoneFenceMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Color node: world-space UVs → sandstone block pattern
    material.colorNode = Fn(() => {
      const worldPos = positionWorld;
      // Use x+z for horizontal, y for vertical — seamless on any wall orientation
      const uvCoord = vec2(worldPos.x.add(worldPos.z), worldPos.y).mul(2.0);

      const pattern = sandstoneBlockPattern(uvCoord);
      const isStone = pattern.x;
      const blockId = vec2(pattern.y, pattern.z);
      const bevel = pattern.w;

      // Per-block color variation in warm sandstone range
      const hashVal = tslHash(blockId);
      const r = float(0.62).add(hashVal.mul(0.1)); // 0.62-0.72
      const g = float(0.52).add(hashVal.mul(0.08)); // 0.52-0.60
      const b = float(0.38).add(hashVal.mul(0.08)); // 0.38-0.46
      const stoneColor = vec3(r, g, b);

      // Surface noise for grain texture
      const grain = tslNoise2D(uvCoord.mul(15.0)).mul(0.08);
      const grainedStone = stoneColor.add(vec3(grain, grain, grain));

      // Mortar color (dark earth brown)
      const mortarColor = vec3(0.35, 0.28, 0.2);

      // Blend stone faces (with bevel darkening) and mortar grooves
      const baseColor = mix(mortarColor, grainedStone.mul(bevel), isStone);

      return vec4(baseColor, 1.0);
    })();

    // Roughness node: stone faces smoother, mortar grooves rougher
    material.roughnessNode = Fn(() => {
      const worldPos = positionWorld;
      const uvCoord = vec2(worldPos.x.add(worldPos.z), worldPos.y).mul(2.0);

      const pattern = sandstoneBlockPattern(uvCoord);
      const isStone = pattern.x;
      const blockId = vec2(pattern.y, pattern.z);

      const stoneRough = float(0.72).add(
        tslHash(blockId.add(vec2(5.0, 3.0))).mul(0.1),
      ); // 0.72-0.82
      const mortarRough = float(0.92);

      return mix(mortarRough, stoneRough, isStone);
    })();

    return material;
  }

  /**
   * Create TSL procedural floor material for arena floors.
   * GPU-computed square flagstone pattern with per-tile color variation,
   * mortar grout lines, surface grain, and bevel edge darkening.
   * Uses world-space UVs so each arena looks unique despite sharing the material.
   */
  private createArenaFloorMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();

    // Color node: world-space xz → floor tile pattern → per-tile sandstone color
    material.colorNode = Fn(() => {
      const worldPos = positionWorld;
      const uvCoord = vec2(worldPos.x, worldPos.z);

      const pattern = floorTilePattern(uvCoord);
      const isStone = pattern.x;
      const tileId = vec2(pattern.y, pattern.z);
      const bevel = pattern.w;

      // Per-tile color variation in warm sand-earth range
      const hashVal = tslHash(tileId);
      const r = float(0.68).add(hashVal.mul(0.12)); // 0.68-0.80
      const g = float(0.54).add(hashVal.mul(0.1)); // 0.54-0.64
      const b = float(0.36).add(hashVal.mul(0.08)); // 0.36-0.44
      const stoneColor = vec3(r, g, b);

      // Surface grain noise for stone texture
      const grain = tslNoise2D(uvCoord.mul(12.0)).mul(0.06);
      const grainedStone = stoneColor.add(vec3(grain, grain, grain));

      // Dark grout color
      const groutColor = vec3(0.4, 0.32, 0.22);

      // Blend stone faces (with bevel darkening at edges) and grout
      const baseColor = mix(groutColor, grainedStone.mul(bevel), isStone);

      return vec4(baseColor, 1.0);
    })();

    // Roughness node: tile faces worn smooth, grout rougher
    material.roughnessNode = Fn(() => {
      const worldPos = positionWorld;
      const uvCoord = vec2(worldPos.x, worldPos.z);

      const pattern = floorTilePattern(uvCoord);
      const isStone = pattern.x;
      const tileId = vec2(pattern.y, pattern.z);

      const stoneRough = float(0.6).add(
        tslHash(tileId.add(vec2(7.0, 11.0))).mul(0.12),
      ); // 0.60-0.72
      const groutRough = float(0.9);

      return mix(groutRough, stoneRough, isStone);
    })();

    return material;
  }

  /**
   * Create continuous stone fence boundaries around a single arena.
   * All 4 sides are fully enclosed — no entrance gaps.
   */
  private createArenaWalls(centerX: number, centerZ: number): void {
    const terrainY = this.getTerrainHeight(centerX, centerZ);

    if (this.world.isClient) {
      // Lazily create shared stone fence material
      if (!this.stoneFenceMaterial) {
        this.stoneFenceMaterial = this.createStoneFenceMaterial();
        this.materials.push(this.stoneFenceMaterial);
      }
    }

    const halfW = ARENA_WIDTH / 2;
    const halfL = ARENA_LENGTH / 2;

    // North fence — continuous (runs along X axis)
    this.createFence(
      centerX - halfW,
      centerZ - halfL,
      ARENA_WIDTH,
      "x",
      this.stoneFenceMaterial,
      terrainY,
    );
    // South fence — continuous
    this.createFence(
      centerX - halfW,
      centerZ + halfL,
      ARENA_WIDTH,
      "x",
      this.stoneFenceMaterial,
      terrainY,
    );
    // West fence — continuous (runs along Z axis)
    this.createFence(
      centerX - halfW,
      centerZ - halfL,
      ARENA_LENGTH,
      "z",
      this.stoneFenceMaterial,
      terrainY,
    );
    // East fence — continuous
    this.createFence(
      centerX + halfW,
      centerZ - halfL,
      ARENA_LENGTH,
      "z",
      this.stoneFenceMaterial,
      terrainY,
    );
  }

  /**
   * Create a fence segment: square stone posts with flat caps + horizontal stone rails.
   * Uses TSL procedural sandstone material for GPU-computed block texture.
   */
  private createFence(
    startX: number,
    startZ: number,
    length: number,
    axis: "x" | "z",
    material: THREE.Material | null,
    terrainY: number,
  ): void {
    if (!this.world.isClient || !material) return;

    const postCount = Math.max(2, Math.floor(length / FENCE_POST_SPACING) + 1);
    const actualSpacing = length / (postCount - 1);

    // Square stone post geometry
    const postGeom = new THREE.BoxGeometry(
      FENCE_POST_SIZE,
      FENCE_HEIGHT,
      FENCE_POST_SIZE,
    );
    this.geometries.push(postGeom);

    // Flat stone cap on top of each post (slightly wider)
    const capSize = FENCE_POST_SIZE + 0.06;
    const capGeom = new THREE.BoxGeometry(capSize, 0.06, capSize);
    this.geometries.push(capGeom);

    // Create posts with flat stone caps
    for (let i = 0; i < postCount; i++) {
      const offset = i * actualSpacing;
      const px = axis === "x" ? startX + offset : startX;
      const pz = axis === "z" ? startZ + offset : startZ;

      const post = new THREE.Mesh(postGeom, material);
      post.position.set(px, terrainY + FENCE_HEIGHT / 2, pz);
      post.castShadow = true;
      post.receiveShadow = true;
      post.layers.set(1);
      post.userData = { type: "arena-fence", walkable: false };
      this.arenaGroup!.add(post);

      // Flat stone cap
      const cap = new THREE.Mesh(capGeom, material);
      cap.position.set(px, terrainY + FENCE_HEIGHT + 0.03, pz);
      cap.layers.set(1);
      this.arenaGroup!.add(cap);
    }

    // Create horizontal stone rails between posts
    const railLength = length;
    for (const railY of FENCE_RAIL_HEIGHTS) {
      const railGeom = new THREE.BoxGeometry(
        axis === "x" ? railLength : FENCE_RAIL_DEPTH,
        FENCE_RAIL_HEIGHT,
        axis === "z" ? railLength : FENCE_RAIL_DEPTH,
      );
      this.geometries.push(railGeom);

      const rail = new THREE.Mesh(railGeom, material);
      const railCenterX = axis === "x" ? startX + length / 2 : startX;
      const railCenterZ = axis === "z" ? startZ + length / 2 : startZ;
      rail.position.set(railCenterX, terrainY + railY, railCenterZ);
      rail.castShadow = true;
      rail.receiveShadow = true;
      rail.layers.set(1);
      rail.userData = { type: "arena-fence", walkable: false };
      this.arenaGroup!.add(rail);
    }
  }

  // ============================================================================
  // Lobby Floor, Braziers & Benches
  // ============================================================================

  /**
   * Create the lobby floor with tile texture, corner braziers, and benches.
   */
  private createLobbyFloor(): void {
    const terrainY = this.getProceduralTerrainHeight(
      LOBBY_CENTER_X,
      LOBBY_CENTER_Z,
    );
    const floorY = terrainY + FLOOR_HEIGHT_OFFSET;

    if (this.world.isClient) {
      const geometry = new THREE.BoxGeometry(
        LOBBY_WIDTH,
        FLOOR_THICKNESS,
        LOBBY_LENGTH,
      );

      const tileTexture = this.generateLobbyTileTexture();
      tileTexture.repeat.set(
        LOBBY_WIDTH / TILE_TEXTURE_WORLD_SIZE,
        LOBBY_LENGTH / TILE_TEXTURE_WORLD_SIZE,
      );

      const material = new MeshStandardNodeMaterial({
        color: LOBBY_FLOOR_COLOR,
        map: tileTexture,
        emissive: LOBBY_FLOOR_COLOR,
        emissiveIntensity: 0.3,
      });

      const floor = new THREE.Mesh(geometry, material);
      floor.position.set(LOBBY_CENTER_X, floorY, LOBBY_CENTER_Z);
      floor.name = "LobbyFloor";

      // Layer 2 for click-to-move raycasting (walkable surface)
      // Layer 0 so minimap camera (layer 0 only) can see floors where terrain is carved
      floor.layers.set(2);
      floor.layers.enable(0);
      floor.userData = {
        type: "lobby-floor",
        walkable: true,
      };

      console.log(
        `[DuelArenaVisualsSystem] Created lobby floor at (${LOBBY_CENTER_X}, ${floorY.toFixed(1)}, ${LOBBY_CENTER_Z}) - terrain=${terrainY.toFixed(1)}`,
      );

      this.geometries.push(geometry);
      this.materials.push(material);
      this.arenaGroup!.add(floor);

      // Add corner braziers with fire particles
      this.createLobbyBraziers(terrainY);
    }

    // Create physics collision body
    this.createFloorCollision(
      LOBBY_CENTER_X,
      floorY,
      LOBBY_CENTER_Z,
      LOBBY_WIDTH,
      LOBBY_LENGTH,
      "lobby_floor",
    );
  }

  /**
   * Create 4 tall brazier stands at lobby corners with fire particles and lights.
   */
  private createLobbyBraziers(terrainY: number): void {
    const particleSystem = this.world.getSystem("particle") as
      | ParticleSystem
      | undefined;

    const standMaterial = new MeshStandardNodeMaterial({
      color: 0x555555,
      roughness: 0.7,
    });
    this.materials.push(standMaterial);

    const bowlMaterial = new MeshStandardNodeMaterial({
      color: 0x555555,
      roughness: 0.7,
      emissive: 0xff4400,
      emissiveIntensity: 0.3,
    });
    this.materials.push(bowlMaterial);

    const standGeom = new THREE.CylinderGeometry(
      0.08,
      0.1,
      LOBBY_BRAZIER_HEIGHT,
      6,
    );
    this.geometries.push(standGeom);

    const bowlGeom = new THREE.CylinderGeometry(0.08, 0.15, 0.12, 6);
    this.geometries.push(bowlGeom);

    const inset = 2.5;
    const corners = [
      {
        x: LOBBY_CENTER_X - LOBBY_WIDTH / 2 + inset,
        z: LOBBY_CENTER_Z - LOBBY_LENGTH / 2 + inset,
        label: "nw",
      },
      {
        x: LOBBY_CENTER_X + LOBBY_WIDTH / 2 - inset,
        z: LOBBY_CENTER_Z - LOBBY_LENGTH / 2 + inset,
        label: "ne",
      },
      {
        x: LOBBY_CENTER_X - LOBBY_WIDTH / 2 + inset,
        z: LOBBY_CENTER_Z + LOBBY_LENGTH / 2 - inset,
        label: "sw",
      },
      {
        x: LOBBY_CENTER_X + LOBBY_WIDTH / 2 - inset,
        z: LOBBY_CENTER_Z + LOBBY_LENGTH / 2 - inset,
        label: "se",
      },
    ];

    for (const corner of corners) {
      const topY = terrainY + LOBBY_BRAZIER_HEIGHT;

      // Stand
      const stand = new THREE.Mesh(standGeom, standMaterial);
      stand.position.set(
        corner.x,
        terrainY + LOBBY_BRAZIER_HEIGHT / 2,
        corner.z,
      );
      stand.castShadow = true;
      stand.layers.set(1);
      this.arenaGroup!.add(stand);

      // Bowl
      const bowl = new THREE.Mesh(bowlGeom, bowlMaterial);
      bowl.position.set(corner.x, topY, corner.z);
      bowl.layers.set(1);
      this.arenaGroup!.add(bowl);

      // PointLight
      const light = new THREE.PointLight(
        TORCH_LIGHT_COLOR,
        TORCH_LIGHT_INTENSITY,
        TORCH_LIGHT_RANGE,
      );
      light.position.set(corner.x, topY + 0.15, corner.z);
      this.arenaGroup!.add(light);
      this.lobbyLights.push(light);

      // Fire particle emitter (18 particles each from riseSpread pool)
      if (particleSystem) {
        const emitterId = `fire_lobby_${corner.label}`;
        particleSystem.register(emitterId, {
          type: "glow",
          preset: "fire",
          position: { x: corner.x, y: topY + 0.1, z: corner.z },
        });
        this.particleEmitterIds.push(emitterId);
      }
    }
  }

  /**
   * Create 4 wooden benches along lobby edges.
   * Each bench: seat plank + 2 legs (3-box construction).
   */
  private createLobbyBenches(terrainY: number): void {
    const benchMaterial = new MeshStandardNodeMaterial({
      color: ARENA_FENCE_COLOR,
      roughness: 0.9,
    });
    this.materials.push(benchMaterial);

    const seatGeom = new THREE.BoxGeometry(
      BENCH_SEAT_WIDTH,
      BENCH_SEAT_THICKNESS,
      BENCH_SEAT_DEPTH,
    );
    this.geometries.push(seatGeom);

    const legGeom = new THREE.BoxGeometry(
      BENCH_LEG_WIDTH,
      BENCH_SEAT_HEIGHT,
      BENCH_LEG_DEPTH,
    );
    this.geometries.push(legGeom);

    const edgeInset = 1.5;
    const benchPositions = [
      // North edge (2 benches)
      {
        x: LOBBY_CENTER_X - 6,
        z: LOBBY_CENTER_Z - LOBBY_LENGTH / 2 + edgeInset,
        rotated: false,
      },
      {
        x: LOBBY_CENTER_X + 6,
        z: LOBBY_CENTER_Z - LOBBY_LENGTH / 2 + edgeInset,
        rotated: false,
      },
      // South edge (2 benches)
      {
        x: LOBBY_CENTER_X - 6,
        z: LOBBY_CENTER_Z + LOBBY_LENGTH / 2 - edgeInset,
        rotated: false,
      },
      {
        x: LOBBY_CENTER_X + 6,
        z: LOBBY_CENTER_Z + LOBBY_LENGTH / 2 - edgeInset,
        rotated: false,
      },
    ];

    for (const pos of benchPositions) {
      const seatY = terrainY + BENCH_SEAT_HEIGHT;

      // Seat plank
      const seat = new THREE.Mesh(seatGeom, benchMaterial);
      seat.position.set(pos.x, seatY, pos.z);
      if (pos.rotated) seat.rotation.y = Math.PI / 2;
      seat.castShadow = true;
      seat.receiveShadow = true;
      seat.layers.set(1);
      this.arenaGroup!.add(seat);

      // Leg positions relative to bench orientation
      const legOffsetX = pos.rotated ? 0 : BENCH_SEAT_WIDTH / 2 - 0.15;
      const legOffsetZ = pos.rotated ? BENCH_SEAT_WIDTH / 2 - 0.15 : 0;
      const legY = terrainY + BENCH_SEAT_HEIGHT / 2;

      // Left leg
      const leg1 = new THREE.Mesh(legGeom, benchMaterial);
      leg1.position.set(pos.x - legOffsetX, legY, pos.z - legOffsetZ);
      if (pos.rotated) leg1.rotation.y = Math.PI / 2;
      leg1.castShadow = true;
      leg1.layers.set(1);
      this.arenaGroup!.add(leg1);

      // Right leg
      const leg2 = new THREE.Mesh(legGeom, benchMaterial);
      leg2.position.set(pos.x + legOffsetX, legY, pos.z + legOffsetZ);
      if (pos.rotated) leg2.rotation.y = Math.PI / 2;
      leg2.castShadow = true;
      leg2.layers.set(1);
      this.arenaGroup!.add(leg2);
    }
  }

  // ============================================================================
  // Hospital Floor & Cross
  // ============================================================================

  /**
   * Create the hospital floor - positioned above procedural terrain
   */
  private createHospitalFloor(): void {
    const terrainY = this.getProceduralTerrainHeight(
      HOSPITAL_CENTER_X,
      HOSPITAL_CENTER_Z,
    );
    const floorY = terrainY + FLOOR_HEIGHT_OFFSET;

    if (this.world.isClient) {
      const geometry = new THREE.BoxGeometry(
        HOSPITAL_WIDTH,
        FLOOR_THICKNESS,
        HOSPITAL_LENGTH,
      );

      const material = new MeshStandardNodeMaterial({
        color: HOSPITAL_FLOOR_COLOR,
        emissive: HOSPITAL_FLOOR_COLOR,
        emissiveIntensity: 0.3,
      });

      const floor = new THREE.Mesh(geometry, material);
      floor.position.set(HOSPITAL_CENTER_X, floorY, HOSPITAL_CENTER_Z);
      floor.name = "HospitalFloor";

      // Layer 2 for click-to-move raycasting (walkable surface)
      // Layer 0 so minimap camera (layer 0 only) can see floors where terrain is carved
      floor.layers.set(2);
      floor.layers.enable(0);
      floor.userData = {
        type: "hospital-floor",
        walkable: true,
      };

      console.log(
        `[DuelArenaVisualsSystem] Created hospital floor at (${HOSPITAL_CENTER_X}, ${floorY.toFixed(1)}, ${HOSPITAL_CENTER_Z}) - terrain=${terrainY.toFixed(1)}`,
      );

      // Add a 3D red cross marker with healing glow
      this.createHospitalCross(HOSPITAL_CENTER_X, HOSPITAL_CENTER_Z, floorY);

      this.geometries.push(geometry);
      this.materials.push(material);
      this.arenaGroup!.add(floor);
    }

    // Create physics collision body
    this.createFloorCollision(
      HOSPITAL_CENTER_X,
      floorY,
      HOSPITAL_CENTER_Z,
      HOSPITAL_WIDTH,
      HOSPITAL_LENGTH,
      "hospital_floor",
    );
  }

  /**
   * Create a 3D raised red cross on the hospital floor with healing particle glow.
   * Uses BoxGeometry for 3D depth instead of flat planes.
   */
  private createHospitalCross(x: number, z: number, floorY: number): void {
    const crossHeight = 0.08;
    const crossTopY = floorY + FLOOR_THICKNESS / 2 + crossHeight / 2 + 0.01;

    const crossMaterial = new MeshStandardNodeMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    this.materials.push(crossMaterial);

    // Vertical bar of cross (3D box)
    const vertGeom = new THREE.BoxGeometry(2, crossHeight, 8);
    const vertBar = new THREE.Mesh(vertGeom, crossMaterial);
    vertBar.position.set(x, crossTopY, z);
    this.geometries.push(vertGeom);
    this.arenaGroup!.add(vertBar);

    // Horizontal bar of cross (3D box)
    const horizGeom = new THREE.BoxGeometry(8, crossHeight, 2);
    const horizBar = new THREE.Mesh(horizGeom, crossMaterial);
    horizBar.position.set(x, crossTopY, z);
    this.geometries.push(horizGeom);
    this.arenaGroup!.add(horizBar);

    // Healing glow particles (altar preset with blue-white colors)
    const particleSystem = this.world.getSystem("particle") as
      | ParticleSystem
      | undefined;
    if (particleSystem) {
      const emitterId = "healing_glow_hospital";
      particleSystem.register(emitterId, {
        type: "glow",
        preset: "altar",
        position: { x, y: crossTopY + 0.1, z },
        color: { core: 0xffffff, mid: 0x88ccff, outer: 0x44aaff },
      });
      this.particleEmitterIds.push(emitterId);
    }
  }

  // ============================================================================
  // Forfeit Pillars
  // ============================================================================

  /**
   * Create forfeit pillars (trapdoors) in opposite corners of an arena.
   * Players can click these during an active duel to surrender.
   */
  private createForfeitPillars(
    centerX: number,
    centerZ: number,
    arenaId: number,
  ): void {
    // Get terrain height at arena center
    const terrainY = this.getTerrainHeight(centerX, centerZ);

    // Place pillars in opposite corners (SW and NE)
    // This ensures both players have access to a nearby forfeit option
    const cornerOffset = {
      x: ARENA_WIDTH / 2 - 2, // 2 units from wall
      z: ARENA_LENGTH / 2 - 2,
    };

    // Southwest corner pillar
    this.createForfeitPillar(
      centerX - cornerOffset.x,
      terrainY,
      centerZ + cornerOffset.z,
      `forfeit_pillar_${arenaId}_sw`,
    );

    // Northeast corner pillar
    this.createForfeitPillar(
      centerX + cornerOffset.x,
      terrainY,
      centerZ - cornerOffset.z,
      `forfeit_pillar_${arenaId}_ne`,
    );
  }

  /**
   * Create a single forfeit pillar (trapdoor visual)
   * Uses a cylinder with proper userData for raycasting
   */
  private createForfeitPillar(
    x: number,
    terrainY: number,
    z: number,
    entityId: string,
  ): void {
    if (this.world.isClient) {
      // Create cylinder geometry for the pillar
      const geometry = new THREE.CylinderGeometry(
        FORFEIT_PILLAR_RADIUS,
        FORFEIT_PILLAR_RADIUS,
        FORFEIT_PILLAR_HEIGHT,
        8, // radial segments
      );

      const material = new MeshStandardNodeMaterial({
        color: FORFEIT_PILLAR_COLOR,
        emissive: FORFEIT_PILLAR_EMISSIVE,
        emissiveIntensity: 0.2,
        roughness: 0.8,
      });

      const pillar = new THREE.Mesh(geometry, material);
      // Position pillar so bottom is at terrain level
      pillar.position.set(x, terrainY + FORFEIT_PILLAR_HEIGHT / 2, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      pillar.name = entityId;

      // CRITICAL: Set userData for raycast detection
      // This enables the interaction system to identify and route clicks
      pillar.userData = {
        entityId,
        type: "forfeit_pillar",
        name: "Trapdoor",
      };

      // Enable layer 1 for raycasting (entities are on layer 1)
      pillar.layers.enable(1);

      this.geometries.push(geometry);
      this.materials.push(material);
      this.arenaGroup!.add(pillar);

      console.log(
        `[DuelArenaVisualsSystem] Created forfeit pillar ${entityId} at (${x.toFixed(1)}, ${(terrainY + FORFEIT_PILLAR_HEIGHT / 2).toFixed(1)}, ${z.toFixed(1)})`,
      );
    }
  }

  // ============================================================================
  // Stone Corner Pillars (with torches)
  // ============================================================================

  /**
   * Create stone pillar architecture at the 4 corners of an arena.
   * Each pillar: stepped base → square shaft → capital cap → brazier bowl + fire.
   * Replaces the simpler torch-post design with proper stone architecture.
   */
  private createCornerPillars(
    centerX: number,
    centerZ: number,
    arenaIndex: number,
  ): void {
    if (!this.world.isClient) return;

    const terrainY = this.getTerrainHeight(centerX, centerZ);
    const halfW = ARENA_WIDTH / 2;
    const halfL = ARENA_LENGTH / 2;

    const corners = [
      { x: centerX - halfW, z: centerZ - halfL, label: "nw" },
      { x: centerX + halfW, z: centerZ - halfL, label: "ne" },
      { x: centerX - halfW, z: centerZ + halfL, label: "sw" },
      { x: centerX + halfW, z: centerZ + halfL, label: "se" },
    ];

    // Stone pillar material
    const pillarMaterial = new MeshStandardNodeMaterial({
      color: PILLAR_STONE_COLOR,
      roughness: 0.85,
    });
    this.materials.push(pillarMaterial);

    // Brazier material (sits on top of pillar)
    const brazierMaterial = new MeshStandardNodeMaterial({
      color: 0x555555,
      roughness: 0.7,
      emissive: 0xff4400,
      emissiveIntensity: 0.3,
    });
    this.materials.push(brazierMaterial);

    // Shared geometries for pillar components
    const baseGeom = new THREE.BoxGeometry(
      PILLAR_BASE_SIZE,
      PILLAR_BASE_HEIGHT,
      PILLAR_BASE_SIZE,
    );
    this.geometries.push(baseGeom);

    const shaftGeom = new THREE.BoxGeometry(
      PILLAR_SHAFT_SIZE,
      PILLAR_SHAFT_HEIGHT,
      PILLAR_SHAFT_SIZE,
    );
    this.geometries.push(shaftGeom);

    const capitalGeom = new THREE.BoxGeometry(
      PILLAR_CAPITAL_SIZE,
      PILLAR_CAPITAL_HEIGHT,
      PILLAR_CAPITAL_SIZE,
    );
    this.geometries.push(capitalGeom);

    const brazierGeom = new THREE.CylinderGeometry(
      TORCH_BRAZIER_RADIUS * 0.6,
      TORCH_BRAZIER_RADIUS,
      0.1,
      6,
    );
    this.geometries.push(brazierGeom);

    const particleSystem = this.world.getSystem("particle") as
      | ParticleSystem
      | undefined;

    for (const corner of corners) {
      // Build pillar stack from bottom to top
      this.createDecorativePillar(
        corner.x,
        corner.z,
        terrainY,
        pillarMaterial,
        baseGeom,
        shaftGeom,
        capitalGeom,
      );

      const pillarTopY = terrainY + PILLAR_TOTAL_HEIGHT;

      // Brazier bowl on top of pillar
      const brazier = new THREE.Mesh(brazierGeom, brazierMaterial);
      brazier.position.set(corner.x, pillarTopY + 0.05, corner.z);
      brazier.layers.set(1);
      this.arenaGroup!.add(brazier);

      // PointLight for warm glow (positioned above brazier)
      const light = new THREE.PointLight(
        TORCH_LIGHT_COLOR,
        TORCH_LIGHT_INTENSITY,
        TORCH_LIGHT_RANGE,
      );
      light.position.set(corner.x, pillarTopY + 0.25, corner.z);
      this.arenaGroup!.add(light);
      this.torchLights.push(light);

      // Torch particle emitter on top of pillar
      if (particleSystem) {
        const emitterId = `torch_arena${arenaIndex}_${corner.label}`;
        particleSystem.register(emitterId, {
          type: "glow",
          preset: "torch",
          position: { x: corner.x, y: pillarTopY + 0.15, z: corner.z },
        });
        this.particleEmitterIds.push(emitterId);
      }
    }
  }

  /**
   * Create a decorative stone pillar (base + shaft + capital) without fire.
   * Reusable by corner pillars (which add brazier on top) and border pillars.
   */
  private createDecorativePillar(
    x: number,
    z: number,
    terrainY: number,
    material: THREE.Material,
    baseGeom: THREE.BoxGeometry,
    shaftGeom: THREE.BoxGeometry,
    capitalGeom: THREE.BoxGeometry,
  ): void {
    // Stepped base
    const base = new THREE.Mesh(baseGeom, material);
    base.position.set(x, terrainY + PILLAR_BASE_HEIGHT / 2, z);
    base.castShadow = true;
    base.receiveShadow = true;
    base.layers.set(1);
    this.arenaGroup!.add(base);

    // Square shaft
    const shaft = new THREE.Mesh(shaftGeom, material);
    shaft.position.set(
      x,
      terrainY + PILLAR_BASE_HEIGHT + PILLAR_SHAFT_HEIGHT / 2,
      z,
    );
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    shaft.layers.set(1);
    this.arenaGroup!.add(shaft);

    // Capital cap
    const capital = new THREE.Mesh(capitalGeom, material);
    capital.position.set(
      x,
      terrainY +
        PILLAR_BASE_HEIGHT +
        PILLAR_SHAFT_HEIGHT +
        PILLAR_CAPITAL_HEIGHT / 2,
      z,
    );
    capital.castShadow = true;
    capital.receiveShadow = true;
    capital.layers.set(1);
    this.arenaGroup!.add(capital);
  }

  // ============================================================================
  // Arena Number Markers
  // ============================================================================

  /**
   * Create a small circular stone pedestal inside each arena near the north wall
   * with emissive gold dots arranged in recognizable patterns (1-6).
   */
  private createArenaMarker(
    centerX: number,
    centerZ: number,
    arenaId: number,
  ): void {
    if (!this.world.isClient) return;

    const terrainY = this.getTerrainHeight(centerX, centerZ);
    const halfL = ARENA_LENGTH / 2;
    const floorTopY =
      this.getProceduralTerrainHeight(centerX, centerZ) +
      FLOOR_HEIGHT_OFFSET +
      FLOOR_THICKNESS / 2;

    // Position inside arena, flush on floor near north wall
    const markerX = centerX;
    const markerZ = centerZ - halfL + 1.5;
    const markerTopY = floorTopY + 0.01 + MARKER_HEIGHT;

    // Stone pedestal flush with floor
    const pedestalMaterial = new MeshStandardNodeMaterial({
      color: PILLAR_STONE_COLOR,
      roughness: 0.8,
    });
    this.materials.push(pedestalMaterial);

    const pedestalGeom = new THREE.CylinderGeometry(
      MARKER_RADIUS,
      MARKER_RADIUS,
      MARKER_HEIGHT,
      12,
    );
    this.geometries.push(pedestalGeom);

    const pedestal = new THREE.Mesh(pedestalGeom, pedestalMaterial);
    pedestal.position.set(
      markerX,
      floorTopY + 0.01 + MARKER_HEIGHT / 2,
      markerZ,
    );
    pedestal.layers.set(1);
    this.arenaGroup!.add(pedestal);

    // Emissive gold dot material
    const dotMaterial = new MeshStandardNodeMaterial({
      color: MARKER_DOT_COLOR,
      emissive: MARKER_DOT_COLOR,
      emissiveIntensity: 0.8,
    });
    this.materials.push(dotMaterial);

    const dotGeom = new THREE.SphereGeometry(MARKER_DOT_RADIUS, 6, 4);
    this.geometries.push(dotGeom);

    // Place dots in pattern for this arena number
    const dotPattern = MARKER_DOT_PATTERNS[arenaId - 1];
    if (dotPattern) {
      for (const [dx, dz] of dotPattern) {
        const dot = new THREE.Mesh(dotGeom, dotMaterial);
        dot.position.set(
          markerX + dx,
          markerTopY + MARKER_DOT_RADIUS * 0.5,
          markerZ + dz,
        );
        dot.layers.set(1);
        this.arenaGroup!.add(dot);
      }
    }
  }

  // ============================================================================
  // Ambient Dust Particles
  // ============================================================================

  /**
   * Create subtle dust wisps floating above an arena floor.
   * Uses "torch" preset with sandy color override at floor level.
   */
  private createAmbientDust(
    centerX: number,
    centerZ: number,
    arenaIndex: number,
  ): void {
    const particleSystem = this.world.getSystem("particle") as
      | ParticleSystem
      | undefined;
    if (!particleSystem) return;

    const terrainY = this.getTerrainHeight(centerX, centerZ);

    const emitterId = `dust_arena${arenaIndex}`;
    particleSystem.register(emitterId, {
      type: "glow",
      preset: "torch",
      position: { x: centerX, y: terrainY + 0.3, z: centerZ },
      color: 0xc9a060, // Sandy dust color
    });
    this.particleEmitterIds.push(emitterId);
  }

  // ============================================================================
  // Decorative Banners
  // ============================================================================

  /**
   * Create 2 banner poles mounted against east and west arena fences.
   * Iron pole with colored cloth panel. Row-colored: red, blue, green.
   */
  private createBanners(
    centerX: number,
    centerZ: number,
    arenaId: number,
  ): void {
    if (!this.world.isClient) return;

    const terrainY = this.getTerrainHeight(centerX, centerZ);
    const halfW = ARENA_WIDTH / 2;
    const bannerColor = BANNER_COLORS[arenaId - 1];

    // Iron pole material
    const poleMaterial = new MeshStandardNodeMaterial({
      color: 0x444444,
      roughness: 0.6,
      metalness: 0.4,
    });
    this.materials.push(poleMaterial);

    // Cloth panel material (emissive for visibility)
    const clothMaterial = new MeshStandardNodeMaterial({
      color: bannerColor,
      emissive: bannerColor,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
    });
    this.materials.push(clothMaterial);

    const poleGeom = new THREE.CylinderGeometry(
      BANNER_POLE_RADIUS,
      BANNER_POLE_RADIUS,
      BANNER_POLE_HEIGHT,
      6,
    );
    this.geometries.push(poleGeom);

    const clothGeom = new THREE.PlaneGeometry(
      BANNER_CLOTH_WIDTH,
      BANNER_CLOTH_HEIGHT,
    );
    this.geometries.push(clothGeom);

    // One banner on west fence, one on east fence (centered on wall)
    const positions = [
      { x: centerX - halfW + 0.2, z: centerZ, rotY: Math.PI / 2 },
      { x: centerX + halfW - 0.2, z: centerZ, rotY: Math.PI / 2 },
    ];

    for (const pos of positions) {
      // Pole resting against fence face
      const pole = new THREE.Mesh(poleGeom, poleMaterial);
      pole.position.set(pos.x, terrainY + BANNER_POLE_HEIGHT / 2, pos.z);
      pole.castShadow = true;
      pole.layers.set(1);
      this.arenaGroup!.add(pole);

      // Cloth panel hanging near top of pole, rotated to face into arena
      const cloth = new THREE.Mesh(clothGeom, clothMaterial);
      cloth.position.set(
        pos.x,
        terrainY + BANNER_POLE_HEIGHT - BANNER_CLOTH_HEIGHT / 2 - 0.1,
        pos.z,
      );
      cloth.rotation.y = pos.rotY;
      cloth.layers.set(1);
      this.arenaGroup!.add(cloth);
    }
  }

  // ============================================================================
  // Border Pillars (lobby & hospital corners)
  // ============================================================================

  /**
   * Create stone pillars at lobby and hospital corners (no fire/particles).
   * Same geometry as arena corner pillars but purely decorative.
   */
  private createBorderPillars(): void {
    if (!this.world.isClient) return;

    const pillarMaterial = new MeshStandardNodeMaterial({
      color: PILLAR_STONE_COLOR,
      roughness: 0.85,
    });
    this.materials.push(pillarMaterial);

    // Shared pillar component geometries
    const baseGeom = new THREE.BoxGeometry(
      PILLAR_BASE_SIZE,
      PILLAR_BASE_HEIGHT,
      PILLAR_BASE_SIZE,
    );
    this.geometries.push(baseGeom);

    const shaftGeom = new THREE.BoxGeometry(
      PILLAR_SHAFT_SIZE,
      PILLAR_SHAFT_HEIGHT,
      PILLAR_SHAFT_SIZE,
    );
    this.geometries.push(shaftGeom);

    const capitalGeom = new THREE.BoxGeometry(
      PILLAR_CAPITAL_SIZE,
      PILLAR_CAPITAL_HEIGHT,
      PILLAR_CAPITAL_SIZE,
    );
    this.geometries.push(capitalGeom);

    // Lobby corner positions
    const lobbyHalfW = LOBBY_WIDTH / 2;
    const lobbyHalfL = LOBBY_LENGTH / 2;
    const lobbyCorners = [
      { x: LOBBY_CENTER_X - lobbyHalfW, z: LOBBY_CENTER_Z - lobbyHalfL },
      { x: LOBBY_CENTER_X + lobbyHalfW, z: LOBBY_CENTER_Z - lobbyHalfL },
      { x: LOBBY_CENTER_X - lobbyHalfW, z: LOBBY_CENTER_Z + lobbyHalfL },
      { x: LOBBY_CENTER_X + lobbyHalfW, z: LOBBY_CENTER_Z + lobbyHalfL },
    ];

    for (const corner of lobbyCorners) {
      const terrainY = this.getTerrainHeight(corner.x, corner.z);
      this.createDecorativePillar(
        corner.x,
        corner.z,
        terrainY,
        pillarMaterial,
        baseGeom,
        shaftGeom,
        capitalGeom,
      );
    }

    // Hospital corner positions
    const hospitalHalfW = HOSPITAL_WIDTH / 2;
    const hospitalHalfL = HOSPITAL_LENGTH / 2;
    const hospitalCorners = [
      {
        x: HOSPITAL_CENTER_X - hospitalHalfW,
        z: HOSPITAL_CENTER_Z - hospitalHalfL,
      },
      {
        x: HOSPITAL_CENTER_X + hospitalHalfW,
        z: HOSPITAL_CENTER_Z - hospitalHalfL,
      },
      {
        x: HOSPITAL_CENTER_X - hospitalHalfW,
        z: HOSPITAL_CENTER_Z + hospitalHalfL,
      },
      {
        x: HOSPITAL_CENTER_X + hospitalHalfW,
        z: HOSPITAL_CENTER_Z + hospitalHalfL,
      },
    ];

    for (const corner of hospitalCorners) {
      const terrainY = this.getTerrainHeight(corner.x, corner.z);
      this.createDecorativePillar(
        corner.x,
        corner.z,
        terrainY,
        pillarMaterial,
        baseGeom,
        shaftGeom,
        capitalGeom,
      );
    }
  }

  // ============================================================================
  // Physics Collision
  // ============================================================================

  /**
   * Create a physics collision body for a floor
   */
  private createFloorCollision(
    centerX: number,
    centerY: number,
    centerZ: number,
    width: number,
    length: number,
    tag: string,
  ): void {
    const PHYSX = getPhysX();
    if (!PHYSX || !this.physicsSystem) {
      return;
    }

    // Access physics system internals (typed as unknown to avoid strict type checking)
    const physicsInternal = this.physicsSystem as unknown as {
      physics?: unknown;
      scene?: unknown;
    };

    const physxCore = physicsInternal.physics as
      | {
          createMaterial: (sf: number, df: number, r: number) => unknown;
          createShape: (
            g: unknown,
            m: unknown,
            exclusive: boolean,
            flags: unknown,
          ) => unknown;
          createRigidStatic: (t: unknown) => PxRigidStatic;
        }
      | undefined;

    const physxScene = physicsInternal.scene as
      | {
          addActor: (a: unknown) => void;
          removeActor: (a: unknown) => void;
        }
      | undefined;

    if (!physxCore || !physxScene) {
      return;
    }

    try {
      // Create box geometry for the floor (half extents)
      const halfExtents = new PHYSX.PxVec3(
        width / 2,
        FLOOR_THICKNESS / 2,
        length / 2,
      );
      const geometry = new PHYSX.PxBoxGeometry(
        halfExtents.x,
        halfExtents.y,
        halfExtents.z,
      );

      // Create material with some friction
      const material = physxCore.createMaterial(0.6, 0.6, 0.1);

      // Create shape flags for collision and scene queries
      const flags = new PHYSX.PxShapeFlags(
        PHYSX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE |
          PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE,
      );

      const shape = physxCore.createShape(geometry, material, true, flags) as {
        setQueryFilterData: (f: unknown) => void;
        setSimulationFilterData: (f: unknown) => void;
      };

      // Use environment layer so players collide with the floor
      const layer = Layers.environment || { group: 4, mask: 31 };
      const filterData = new PHYSX.PxFilterData(layer.group, layer.mask, 0, 0);
      shape.setQueryFilterData(filterData);
      shape.setSimulationFilterData(filterData);

      // Create transform at the floor position
      const transform = new PHYSX.PxTransform(
        new PHYSX.PxVec3(centerX, centerY, centerZ),
        new PHYSX.PxQuat(0, 0, 0, 1),
      );

      // Create static rigid body
      const body = physxCore.createRigidStatic(transform);
      body.attachShape(shape as any);

      // Add to physics scene
      physxScene.addActor(body);
      this.physicsBodies.push(body);

      console.log(
        `[DuelArenaVisualsSystem] Created physics collision for ${tag} at (${centerX}, ${centerY.toFixed(1)}, ${centerZ})`,
      );
    } catch (error) {
      console.warn(
        `[DuelArenaVisualsSystem] Failed to create physics collision for ${tag}:`,
        error,
      );
    }
  }

  // ============================================================================
  // Update & Destroy
  // ============================================================================

  /**
   * Update (called each frame) - animate torch and brazier light flicker
   */
  update(deltaTime: number): void {
    if (this.torchLights.length === 0 && this.lobbyLights.length === 0) return;

    this.animTime += deltaTime;

    // Torch light flicker
    for (let i = 0; i < this.torchLights.length; i++) {
      const light = this.torchLights[i];
      light.intensity =
        TORCH_LIGHT_INTENSITY +
        Math.sin(this.animTime * 10 + i * 1.7) * 0.15 +
        Math.random() * 0.05;
    }

    // Lobby brazier light flicker (slightly different frequency)
    for (let i = 0; i < this.lobbyLights.length; i++) {
      const light = this.lobbyLights[i];
      light.intensity =
        TORCH_LIGHT_INTENSITY +
        Math.sin(this.animTime * 8 + i * 2.3) * 0.2 +
        Math.random() * 0.05;
    }
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    // Unregister flat zones from terrain system
    if (this.terrainSystem?.unregisterFlatZone) {
      for (const id of this.flatZoneIds) {
        this.terrainSystem.unregisterFlatZone(id);
      }
    }
    this.flatZoneIds = [];

    // Unregister all particle emitters
    const particleSystem = this.world.getSystem("particle") as
      | ParticleSystem
      | undefined;
    if (particleSystem) {
      for (const id of this.particleEmitterIds) {
        particleSystem.unregister(id);
      }
    }
    this.particleEmitterIds = [];

    // Dispose torch lights
    for (const light of this.torchLights) {
      light.dispose();
    }
    this.torchLights = [];

    // Dispose lobby lights
    for (const light of this.lobbyLights) {
      light.dispose();
    }
    this.lobbyLights = [];

    // Remove physics bodies from scene
    if (this.physicsSystem && this.physicsBodies.length > 0) {
      const physicsInternal = this.physicsSystem as unknown as {
        scene?: unknown;
      };
      const physxScene = physicsInternal.scene as
        | {
            removeActor: (a: unknown) => void;
          }
        | undefined;

      if (physxScene) {
        for (const body of this.physicsBodies) {
          try {
            physxScene.removeActor(body);
            body.release();
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
    this.physicsBodies = [];

    // Remove from scene
    if (this.arenaGroup && this.world.stage?.scene) {
      this.world.stage?.scene.remove(this.arenaGroup);
    }

    // Dispose geometries
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    this.geometries = [];

    // Dispose textures
    for (const texture of this.textures) {
      texture.dispose();
    }
    this.textures = [];

    // Dispose materials
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials = [];

    this.arenaGroup = null;
    this.stoneFenceMaterial = null;
    this.arenaFloorMaterial = null;
    this.visualsCreated = false;
    this.physicsSystem = null;
    super.destroy();
  }
}
