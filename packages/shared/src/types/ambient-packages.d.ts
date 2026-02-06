/**
 * Ambient type declarations for internal packages
 *
 * These declarations allow TypeScript to resolve imports from internal
 * workspace packages during declaration file generation, even when those
 * packages have circular dependencies with shared.
 *
 * At runtime, the actual package implementations are used.
 * These are intentionally permissive to avoid blocking builds.
 */

declare module "@hyperscape/impostor" {
  import type * as THREE from "three";

  export const OctahedronType: {
    readonly HEMI: 0;
    readonly FULL: 1;
  };
  export type OctahedronTypeValue = 0 | 1;

  export const PBRBakeMode: {
    readonly BASIC: 0;
    readonly STANDARD: 1;
    readonly FULL: 2;
    readonly COMPLETE: 3;
  };
  export type PBRBakeModeValue = 0 | 1 | 2 | 3;

  export interface OctahedronMeshData {
    wireframeMesh: THREE.Mesh;
    filledMesh: THREE.Mesh;
    planePoints: number[];
    octPoints: number[];
  }

  export interface ImpostorBakeConfig {
    atlasWidth: number;
    atlasHeight: number;
    gridSizeX: number;
    gridSizeY: number;
    octType: OctahedronTypeValue;
    backgroundColor?: number;
    backgroundAlpha?: number;
    pbrMode?: PBRBakeModeValue;
    depthNear?: number;
    depthFar?: number;
    verticalPacking?: number;
  }

  export interface ImpostorBakeResult {
    atlasTexture: THREE.Texture;
    renderTarget: THREE.RenderTarget;
    normalAtlasTexture?: THREE.Texture;
    normalRenderTarget?: THREE.RenderTarget;
    depthAtlasTexture?: THREE.Texture;
    depthRenderTarget?: THREE.RenderTarget;
    pbrAtlasTexture?: THREE.Texture;
    pbrRenderTarget?: THREE.RenderTarget;
    gridSizeX: number;
    gridSizeY: number;
    octType: OctahedronTypeValue;
    boundingSphere: THREE.Sphere;
    boundingBox?: THREE.Box3;
    octMeshData?: OctahedronMeshData;
    depthNear?: number;
    depthFar?: number;
    pbrMode?: PBRBakeModeValue;
  }

  export interface ImpostorInstance {
    mesh: THREE.Mesh;
    material: THREE.ShaderMaterial;
    update(camera: THREE.Camera): void;
    dispose(): void;
  }

  export interface CompatibleRenderer {
    getRenderTarget(): unknown;
    setRenderTarget(
      target: unknown,
      activeCubeFace?: number,
      activeMipmapLevel?: number,
    ): void;
    getViewport(target: THREE.Vector4): THREE.Vector4;
    setViewport(...args: unknown[]): void;
    setScissorTest(enable: boolean): void;
    setScissor(...args: unknown[]): void;
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
    render(scene: THREE.Object3D, camera: THREE.Camera): void;
    renderAsync?(scene: THREE.Object3D, camera: THREE.Camera): Promise<void>;
    getPixelRatio(): number;
    setPixelRatio(value: number): void;
  }

  /** WebGPU-compatible renderer interface for animated impostor baking */
  export interface WebGPUCompatibleRenderer {
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    setRenderTarget(target: THREE.RenderTarget | null): void;
    getRenderTarget(): unknown;
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    getPixelRatio(): number;
    setPixelRatio(value: number): void;
    readRenderTargetPixelsAsync(...args: unknown[]): Promise<unknown>;
    toneMapping?: number;
    toneMappingExposure?: number;
    autoClear?: boolean;
    outputColorSpace?: string;
  }

  export interface DissolveConfig {
    enabled?: boolean;
    fadeStart?: number;
    fadeEnd?: number;
    playerPos?: THREE.Vector3;
  }

  export interface ImpostorLightingConfig {
    ambientColor: THREE.Vector3;
    ambientIntensity: number;
    directionalLights: Array<{
      direction: THREE.Vector3;
      color: THREE.Vector3;
      intensity: number;
    }>;
    pointLights?: Array<{
      position: THREE.Vector3;
      color: THREE.Vector3;
      intensity: number;
      distance: number;
      decay: number;
    }>;
    specular?: {
      f0: number;
      shininess: number;
      intensity: number;
    };
  }

  export interface CreateInstanceOptions {
    dissolve?: DissolveConfig;
    useTSL?: boolean;
    debugMode?: number;
  }

  export class OctahedralImpostor {
    constructor(renderer: CompatibleRenderer);
    bake(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    bakeWithNormals(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    bakeFull(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    createInstance(
      result: ImpostorBakeResult,
      scale?: number,
      options?: CreateInstanceOptions,
    ): ImpostorInstance;
    dispose(): void;
  }

  export class ImpostorBaker {
    constructor(renderer: CompatibleRenderer);
    bake(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    bakeFull(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    bakeWithNormals(
      source: THREE.Object3D,
      config?: Partial<ImpostorBakeConfig>,
    ): Promise<ImpostorBakeResult>;
    createBakingSource(source: THREE.Object3D): THREE.Group;
    dispose(): void;
  }

  export interface TSLImpostorMaterialOptions {
    atlasTexture: THREE.Texture;
    gridSizeX: number;
    gridSizeY: number;
    normalAtlasTexture?: THREE.Texture;
    depthAtlasTexture?: THREE.Texture;
    pbrAtlasTexture?: THREE.Texture;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
    side?: THREE.Side;
    enableLighting?: boolean;
    enableDepthBlending?: boolean;
    enableSpecular?: boolean;
    depthNear?: number;
    depthFar?: number;
    objectScale?: number;
    enableAAA?: boolean;
    debugMode?: number;
    dissolve?: DissolveConfig;
  }

  export interface TSLImpostorMaterial extends THREE.Material {
    atlasTexture: THREE.Texture;
    gridSizeX: number;
    gridSizeY: number;
    impostorUniforms?: Record<string, unknown>;
    updateView?(faceIndices: THREE.Vector3, faceWeights: THREE.Vector3): void;
    updateLighting?(config: ImpostorLightingConfig): void;
  }

  export function createTSLImpostorMaterial(
    options: TSLImpostorMaterialOptions,
  ): TSLImpostorMaterial;

  export function isTSLImpostorMaterial(
    material: THREE.Material,
  ): material is TSLImpostorMaterial;

  export class ImpostorMaterialTSL {
    material: THREE.Material;
    constructor(options?: Record<string, unknown>);
    dispose(): void;
  }

  // ============================================================================
  // ANIMATED IMPOSTOR TYPES
  // ============================================================================

  /** Configuration for animated impostor baking */
  export interface AnimatedBakeConfig {
    atlasSize: number;
    /** @deprecated Use spritesX and spritesY */
    spritesPerSide?: number;
    spritesX?: number;
    spritesY?: number;
    animationFPS: number;
    animationDuration: number;
    hemisphere: boolean;
    backgroundColor?: number;
    backgroundAlpha?: number;
  }

  /** Result of animated impostor baking */
  export interface AnimatedBakeResult {
    atlasArray: THREE.DataArrayTexture;
    frameCount: number;
    /** @deprecated Use spritesX and spritesY */
    spritesPerSide: number;
    spritesX: number;
    spritesY: number;
    animationDuration: number;
    animationFPS: number;
    boundingSphere: THREE.Sphere;
    modelId: string;
    hemisphere: boolean;
  }

  /** Configuration for a single mob variant in the global atlas */
  export interface MobVariantConfig {
    modelId: string;
    frameCount: number;
    baseFrameIndex: number;
    scale: number;
    boundingRadius: number;
  }

  /** Global mob atlas containing all mob variants merged into a single texture array */
  export interface GlobalMobAtlas {
    atlasArray: THREE.DataArrayTexture;
    totalFrames: number;
    variants: Map<string, MobVariantConfig>;
    /** @deprecated Use spritesX and spritesY */
    spritesPerSide: number;
    spritesX: number;
    spritesY: number;
    hemisphere: boolean;
    animationFPS: number;
  }

  export const DEFAULT_ANIMATED_BAKE_CONFIG: AnimatedBakeConfig;

  export class AnimatedImpostorBaker {
    constructor(renderer: WebGPUCompatibleRenderer);
    bakeWalkCycle(
      source: THREE.Object3D,
      mixer: THREE.AnimationMixer,
      clip: THREE.AnimationClip,
      modelId: string,
      config?: Partial<AnimatedBakeConfig>,
    ): Promise<AnimatedBakeResult>;
    bakeIdleFrame(
      source: THREE.Object3D,
      modelId: string,
      config?: Partial<AnimatedBakeConfig>,
    ): Promise<AnimatedBakeResult>;
    dispose(): void;
  }

  // ============================================================================
  // INSTANCED ANIMATED IMPOSTOR
  // ============================================================================

  /** Per-instance data for the instanced renderer */
  export interface MobInstanceData {
    position: THREE.Vector3;
    yaw: number;
    animationOffset: number;
    variantIndex: number;
    scale: number;
    visible: boolean;
  }

  /** Configuration for InstancedAnimatedImpostor */
  export interface InstancedAnimatedImpostorConfig {
    maxInstances: number;
    atlas: GlobalMobAtlas;
    scale?: number;
    alphaClamp?: number;
    /** @deprecated Use spritesX and spritesY from atlas */
    spritesPerSide?: number;
    useHemiOctahedron?: boolean;
  }

  /** Uniforms exposed by the instanced material */
  export interface InstancedAnimatedUniforms {
    frameIndex: { value: number };
    globalScale: { value: number };
    alphaClamp: { value: number };
    /** @deprecated Use spritesX and spritesY */
    spritesPerSide: { value: number };
    spritesX: { value: number };
    spritesY: { value: number };
  }

  export class InstancedAnimatedImpostor extends THREE.InstancedMesh {
    constructor(config: InstancedAnimatedImpostorConfig);
    readonly activeInstanceCount: number;
    readonly activeCount: number;
    readonly maxInstances: number;
    readonly variants: MobVariantConfig[];
    visible: boolean;
    setFrame(value: number): void;
    setScale(value: number): void;
    setAlphaClamp(value: number): void;
    setInstances(instances: MobInstanceData[]): void;
    addInstance(entityId: string, data: MobInstanceData): number;
    updateInstance(
      indexOrEntityId: number | string,
      data: Partial<MobInstanceData>,
    ): number;
    removeInstance(entityId: string): boolean;
    hasInstance(entityId: string): boolean;
    getInstanceIndex(entityId: string): number | undefined;
    randomizeAnimationOffsets(): void;
  }

  // ============================================================================
  // GLOBAL MOB ATLAS
  // ============================================================================

  export class GlobalMobAtlasBuilder {
    addVariant(bakeResult: AnimatedBakeResult): void;
    build(): GlobalMobAtlas;
    readonly variantCount: number;
    clear(): void;
  }

  export class GlobalMobAtlasManager {
    static getInstance(): GlobalMobAtlasManager;
    static reset(): void;
    hasVariant(modelId: string): boolean;
    getVariantConfig(modelId: string): MobVariantConfig | undefined;
    registerVariant(bakeResult: AnimatedBakeResult): void;
    rebuild(): GlobalMobAtlas | null;
    getAtlas(): GlobalMobAtlas | null;
    getVariantIndex(modelId: string): number;
    waitForVariant(modelId: string): Promise<AnimatedBakeResult>;
    getRegisteredModels(): string[];
    getTotalFrames(): number;
    getVariantCount(): number;
    readonly dirty: boolean;
    dispose(): void;
  }

  export function buildOctahedronMesh(
    octType: OctahedronTypeValue,
    gridSizeX: number,
    gridSizeY?: number,
    position?: number[],
    useCellCenters?: boolean,
  ): OctahedronMeshData;

  export function lerpOctahedronGeometry(
    octMeshData: OctahedronMeshData,
    t: number,
  ): void;

  export function getViewDirection(
    camera: THREE.Camera,
    objectMatrix: THREE.Matrix4,
  ): THREE.Vector3;

  export function directionToUV(
    direction: THREE.Vector3,
    octType?: OctahedronTypeValue,
  ): THREE.Vector2;

  export function directionToGridCell(
    direction: THREE.Vector3,
    gridSizeX: number,
    gridSizeY: number,
    octType?: OctahedronTypeValue,
  ): { col: number; row: number };

  export const DEFAULT_BAKE_CONFIG: ImpostorBakeConfig;
}

declare module "@hyperscape/procgen" {
  import type * as THREE from "three";

  /**
   * A branch-based cluster representing a real branch structure with leaves.
   * Matches the actual BranchCluster type from packages/procgen/src/geometry/BranchClusterGenerator.ts
   */
  export interface BranchCluster {
    /** Unique cluster ID */
    id: number;
    /** Stem index this cluster is based on (-1 if combined) */
    stemIndex: number;
    /** Stem depth level */
    stemDepth: number;
    /** Center position of the cluster (world space) */
    center: THREE.Vector3;
    /** Billboard orientation - direction to face (typically away from branch) */
    billboardNormal: THREE.Vector3;
    /** Billboard up vector */
    billboardUp: THREE.Vector3;
    /** Bounding box of the cluster */
    bounds: THREE.Box3;
    /** Indices of leaves in this cluster (into the leaves array) */
    leafIndices: number[];
    /** Billboard width in world units */
    width: number;
    /** Billboard height in world units */
    height: number;
    /** Cluster density (leaves per unit area) */
    density: number;
    /** Average leaf facing direction */
    avgLeafDirection: THREE.Vector3;
    /** Whether leaves have been culled for overlap */
    overlapCulled: boolean;
  }

  export interface LeafData {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    normal?: THREE.Vector3;
    scale?: number;
  }

  export interface BranchLeafData extends LeafData {
    stemIndex: number;
    stemDepth: number;
    stemOffset: number;
  }

  export interface StemData {
    depth: number;
    points: Array<{ position: THREE.Vector3; radius: number }>;
  }

  export interface TreeParams {
    [key: string]: unknown;
  }

  export interface BranchClusterResult {
    clusters: BranchCluster[];
    leaves: BranchLeafData[];
    params: TreeParams;
    stems: StemData[];
    stats: {
      totalLeaves: number;
      clusterCount: number;
      avgLeavesPerCluster: number;
      leavesCulledForOverlap: number;
      reductionRatio: number;
    };
  }

  export interface BranchClusterOptions {
    minStemDepth?: number;
    maxLeavesPerCluster?: number;
    minLeavesPerCluster?: number;
    cullOverlappingLeaves?: boolean;
    overlapThreshold?: number;
    targetClusterCount?: number;
    textureSize?: number;
  }

  export class BranchClusterGenerator {
    constructor(options?: BranchClusterOptions);
    generateClusters(
      leaves: LeafData[],
      stems: StemData[],
      params: TreeParams,
    ): BranchClusterResult;
  }

  export interface GeometryOptions {
    segments?: number;
    trunkSegments?: number;
    branchSegments?: number;
    leafSegments?: number;
    [key: string]: unknown;
  }

  export interface TreeGeneratorOptions {
    generation?: {
      seed?: number;
      [key: string]: unknown;
    };
    geometry?: GeometryOptions;
    mesh?: Record<string, unknown>;
  }

  export interface TreeGeneratorResult {
    group: THREE.Group;
    trunk?: THREE.Mesh;
    leaves?: THREE.Mesh;
    bounds?: THREE.Box3;
  }

  export interface TreeParams {
    [key: string]: unknown;
  }

  export class TreeGenerator {
    constructor(params?: TreeParams | string, options?: TreeGeneratorOptions);
    generate(seed?: number): TreeGeneratorResult;
  }

  export function generateTree(
    options?: TreeGeneratorOptions,
  ): TreeGeneratorResult;

  // Namespace exports
  export namespace PlantGen {
    export function generate(options?: unknown): unknown;
  }

  export namespace RockGen {
    export interface RockGeneratorOptions {
      seed?: number;
      size?: number;
      detail?: number;
      type?: string;
    }

    export interface RockGeneratorResult {
      geometry: THREE.BufferGeometry;
      bounds: THREE.Box3;
    }

    export class RockGenerator {
      constructor(options?: RockGeneratorOptions);
      generate(): RockGeneratorResult;
    }

    export function generateRock(
      options?: RockGeneratorOptions,
    ): RockGeneratorResult;
  }

  export namespace BuildingGen {
    export function generate(options?: unknown): unknown;
  }

  export namespace TerrainGen {
    export function generate(options?: unknown): unknown;
  }

  export namespace VegetationGen {
    export function generate(options?: unknown): unknown;
  }
}

declare module "@hyperscape/procgen/building" {
  import type * as THREE from "three";

  // Grid alignment constants
  export const CELL_SIZE: number;
  export const MOVEMENT_TILE_SIZE: number;
  export const TILES_PER_CELL: number;
  export const BUILDING_GRID_SNAP: number;

  // Dimension constants
  export const WALL_HEIGHT: number;
  export const WALL_THICKNESS: number;
  export const FLOOR_THICKNESS: number;
  export const ROOF_THICKNESS: number;
  export const FLOOR_HEIGHT: number;
  export const INTERIOR_INSET: number;
  export const INTERIOR_SPAN_REDUCTION: number;
  export const FOUNDATION_HEIGHT: number;
  export const FOUNDATION_OVERHANG: number;
  export const FLOOR_ZFIGHT_OFFSET: number;
  export const TERRAIN_DEPTH: number;
  export const ENTRANCE_STEP_HEIGHT: number;
  export const ENTRANCE_STEP_DEPTH: number;
  export const ENTRANCE_STEP_COUNT: number;
  export const TERRAIN_STEP_COUNT: number;
  export const RAILING_HEIGHT: number;
  export const RAILING_POST_SIZE: number;
  export const RAILING_RAIL_HEIGHT: number;
  export const RAILING_RAIL_DEPTH: number;
  export const RAILING_POST_SPACING: number;
  export const RAILING_THICKNESS: number;
  export const DOOR_WIDTH: number;
  export const DOOR_HEIGHT: number;
  export const ARCH_WIDTH: number;
  export const WINDOW_WIDTH: number;
  export const WINDOW_HEIGHT: number;
  export const WINDOW_SILL_HEIGHT: number;
  export const COUNTER_HEIGHT: number;
  export const COUNTER_DEPTH: number;
  export const COUNTER_LENGTH: number;
  export const NPC_HEIGHT: number;
  export const NPC_WIDTH: number;
  export const FORGE_SIZE: number;
  export const ANVIL_SIZE: number;

  // Utility functions
  export function snapToBuildingGrid(
    x: number,
    z: number,
  ): { x: number; z: number };
  export function isGridAligned(x: number, z: number): boolean;
  export function getCellCenter(
    col: number,
    row: number,
    cellSize: number,
    width: number,
    depth: number,
  ): { x: number; z: number };
  export function getSideVector(side: string): { x: number; z: number };
  export function getOppositeSide(side: string): string;

  // Geometry utilities
  export function computeFlatNormals(geometry: THREE.BufferGeometry): void;
  export function computeTangentsForNonIndexed(
    geometry: THREE.BufferGeometry,
  ): THREE.BufferGeometry;

  // Types
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

  export interface CounterPlacement {
    roomId: number;
    col: number;
    row: number;
    side: string;
    secondCell?: { col: number; row: number };
  }

  export interface PropPlacements {
    innBar?: CounterPlacement | null;
    bankCounter?: CounterPlacement | null;
    forge?: { col: number; row: number } | null;
  }

  export interface BuildingConfig {
    width: number;
    depth: number;
    priority: number;
  }

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
    wallMaterial?: string;
    footprintStyle?: string;
    foyerDepthRange?: [number, number];
    foyerWidthRange?: [number, number];
    excludeFoyerFromUpper?: boolean;
    courtyardSizeRange?: [number, number];
    galleryWidthRange?: [number, number];
    upperInsetRange?: [number, number];
    upperCarveChance?: number;
    requireUpperShrink?: boolean;
  }

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
    optimization?: {
      mergedFloorRects: number;
      cacheHits: number;
      estimatedTrisBefore: number;
      actualTrisAfter: number;
      reductionPercent: number;
    };
  }

  export interface BuildingGeneratorOptions {
    includeRoof?: boolean;
    seed?: string;
    useGreedyMeshing?: boolean;
    generateLODs?: boolean;
    cachedLayout?: BuildingLayout;
    enableInteriorLighting?: boolean;
    interiorLightIntensity?: number;
  }

  export enum LODLevel {
    FULL = 0,
    MEDIUM = 1,
    LOW = 2,
  }

  export interface LODMesh {
    level: LODLevel;
    mesh: THREE.Mesh | THREE.Group;
    distance: number;
  }

  export interface GeneratedBuilding {
    mesh: THREE.Mesh | THREE.Group;
    layout: BuildingLayout;
    stats: BuildingStats;
    recipe: BuildingRecipe;
    typeKey: string;
    lods?: LODMesh[];
    propPlacements?: PropPlacements;
  }

  export class BuildingGenerator {
    constructor();
    generate(
      typeKey: string,
      options?: BuildingGeneratorOptions,
    ): GeneratedBuilding | null;
    generateLayout(typeKey: string, seed?: string): BuildingLayout | null;
  }

  // Re-export town types
  export * from "@hyperscape/procgen/building/town";
}

declare module "@hyperscape/procgen/building/town" {
  // Town size types
  export type TownSize = "hamlet" | "village" | "town";
  export type TownLayoutType =
    | "terminus"
    | "throughway"
    | "fork"
    | "crossroads";
  export type TownBuildingType =
    | "bank"
    | "store"
    | "anvil"
    | "house"
    | "well"
    | "inn"
    | "smithy"
    | "simple-house"
    | "long-house";
  export type TownLandmarkType =
    | "well"
    | "fountain"
    | "market_stall"
    | "signpost"
    | "bench"
    | "barrel"
    | "crate"
    | "lamppost"
    | "tree"
    | "planter"
    | "fence_post"
    | "fence_gate";

  // Town entry point
  export interface TownEntryPoint {
    angle: number;
    position: { x: number; z: number };
  }

  // Internal road segment
  export interface TownInternalRoad {
    start: { x: number; z: number };
    end: { x: number; z: number };
    isMain: boolean;
    width?: number;
  }

  // Path from road to building
  export interface TownPath {
    start: { x: number; z: number };
    end: { x: number; z: number };
    width: number;
    buildingId: string;
  }

  // Landmark metadata
  export interface TownLandmarkMetadata {
    destination?: string;
    destinationId?: string;
    lotBuildingId?: string;
    cornerIndex?: number;
  }

  // Landmark
  export interface TownLandmark {
    id: string;
    type: TownLandmarkType;
    position: { x: number; y: number; z: number };
    rotation: number;
    size: { width: number; depth: number; height: number };
    metadata?: TownLandmarkMetadata;
  }

  // Plaza
  export interface TownPlaza {
    position: { x: number; z: number };
    radius: number;
    shape: "circle" | "square" | "octagon";
    material: "cobblestone" | "dirt" | "grass";
  }

  // Building in town
  export interface TownBuilding {
    id: string;
    type: TownBuildingType;
    position: { x: number; y: number; z: number };
    rotation: number;
    size: { width: number; depth: number };
    entrance?: { x: number; z: number };
    roadId?: number;
  }

  // Generated town data
  export interface GeneratedTown {
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    size: TownSize;
    safeZoneRadius: number;
    biome: string;
    buildings: TownBuilding[];
    suitabilityScore: number;
    connectedRoads: string[];
    layoutType?: TownLayoutType;
    entryPoints?: TownEntryPoint[];
    internalRoads?: TownInternalRoad[];
    paths?: TownPath[];
    landmarks?: TownLandmark[];
    plaza?: TownPlaza;
  }

  // Town size configuration
  export interface TownSizeConfig {
    buildingCount: { min: number; max: number };
    radius: number;
    safeZoneRadius: number;
  }

  // Building config (for town generation)
  export interface BuildingConfig {
    width: number;
    depth: number;
    priority: number;
  }

  // Landmark configuration
  export interface LandmarkConfig {
    fencesEnabled: boolean;
    fenceDensity: number;
    fencePostHeight: number;
    lamppostsInVillages: boolean;
    lamppostSpacing: number;
    marketStallsEnabled: boolean;
    decorationsEnabled: boolean;
  }

  // Town generator configuration
  export interface TownGeneratorConfig {
    townCount: number;
    worldSize: number;
    minTownSpacing: number;
    flatnessSampleRadius: number;
    flatnessSampleCount: number;
    waterThreshold: number;
    optimalWaterDistanceMin: number;
    optimalWaterDistanceMax: number;
    townSizes: Record<TownSize, TownSizeConfig>;
    biomeSuitability: Record<string, number>;
    buildingTypes: Record<TownBuildingType, BuildingConfig>;
    landmarks: LandmarkConfig;
  }

  // Town candidate for placement
  export interface TownCandidate {
    x: number;
    z: number;
    flatnessScore: number;
    waterProximityScore: number;
    biomeScore: number;
    totalScore: number;
    biome: string;
  }

  // Terrain provider interface
  export interface TerrainProvider {
    getHeightAt(x: number, z: number): number;
    getBiomeAt?(x: number, z: number): string;
    isUnderwater?(x: number, z: number): boolean;
    getWaterThreshold?(): number;
  }

  // Noise provider interface
  export interface NoiseProvider {
    simplex2D(x: number, y: number): number;
  }

  // Terrain generator interface
  export interface TerrainGeneratorLike {
    getHeightAt(worldX: number, worldZ: number): number;
    getBiomeAtTile?(tileX: number, tileZ: number): string;
    isUnderwater?(worldX: number, worldZ: number): boolean;
    getWaterThreshold?(): number;
    queryPoint?(worldX: number, worldZ: number): { biome: string };
  }

  // Town generation options
  export interface TownGenerationOptions {
    seed?: number;
    terrain?: TerrainProvider;
    noise?: NoiseProvider;
    config?: Partial<TownGeneratorConfig>;
  }

  // Town generation result
  export interface TownGenerationResult {
    towns: GeneratedTown[];
    stats: TownGenerationStats;
  }

  // Generation statistics
  export interface TownGenerationStats {
    totalTowns: number;
    hamlets: number;
    villages: number;
    towns: number;
    totalBuildings: number;
    buildingCounts: Record<TownBuildingType, number>;
    candidatesEvaluated: number;
    generationTime: number;
  }

  // Town generator class
  export class TownGenerator {
    constructor(options?: TownGenerationOptions);
    static fromTerrainGenerator(
      terrainGenerator: TerrainGeneratorLike,
      options?: Omit<TownGenerationOptions, "terrain">,
    ): TownGenerator;
    generate(existingTowns?: GeneratedTown[]): TownGenerationResult;
    generateSingleTown(
      x: number,
      z: number,
      size: TownSize,
      options?: { id?: string; name?: string; layoutType?: TownLayoutType },
    ): GeneratedTown;
    generateTownLayout(town: GeneratedTown, layoutType?: TownLayoutType): void;
    setTerrain(terrain: TerrainProvider): void;
    setNoise(noise: NoiseProvider): void;
    setConfig(config: Partial<TownGeneratorConfig>): void;
    getConfig(): TownGeneratorConfig;
    setSeed(seed: number): void;
  }

  export const defaultTownGenerator: TownGenerator;

  // Helper function
  export function createTerrainProviderFromGenerator(
    generator: TerrainGeneratorLike,
  ): TerrainProvider;

  // Default configurations
  export const DEFAULT_TOWN_COUNT: number;
  export const DEFAULT_WORLD_SIZE: number;
  export const DEFAULT_MIN_TOWN_SPACING: number;
  export const DEFAULT_FLATNESS_SAMPLE_RADIUS: number;
  export const DEFAULT_FLATNESS_SAMPLE_COUNT: number;
  export const DEFAULT_WATER_THRESHOLD: number;
  export const DEFAULT_OPTIMAL_WATER_DISTANCE_MIN: number;
  export const DEFAULT_OPTIMAL_WATER_DISTANCE_MAX: number;
  export const DEFAULT_TOWN_SIZES: Record<TownSize, TownSizeConfig>;
  export const DEFAULT_BIOME_SUITABILITY: Record<string, number>;
  export const DEFAULT_BUILDING_CONFIGS: Record<
    TownBuildingType,
    BuildingConfig
  >;
  export const DEFAULT_LANDMARK_CONFIG: LandmarkConfig;
  export function createDefaultConfig(): TownGeneratorConfig;
  export const PLACEMENT_GRID_SIZE: number;
  export const BUILDING_PLACEMENT_BUFFER: number;
  export const MAX_BUILDING_PLACEMENT_ATTEMPTS: number;
  export const WATER_CHECK_DIRECTIONS: number;
  export const WATER_CHECK_MAX_DISTANCE: number;
  export const WATER_CHECK_STEP: number;
  export const NAME_PREFIXES: string[];
  export const NAME_SUFFIXES: string[];
}

declare module "@hyperscape/procgen/terrain" {
  import type * as THREE from "three";

  export interface BiomeDefinition {
    id: string;
    name: string;
    color: number;
    terrainMultiplier: number;
    difficultyLevel: number;
    heightRange?: [number, number];
    maxSlope?: number;
    resourceDensity?: number;
  }

  export interface NoiseLayerConfig {
    scale: number;
    weight: number;
    octaves?: number;
    persistence?: number;
    lacunarity?: number;
  }

  export interface TerrainNoiseConfig {
    continent: NoiseLayerConfig;
    ridge: NoiseLayerConfig;
    hill: NoiseLayerConfig;
    erosion: NoiseLayerConfig;
    detail: NoiseLayerConfig;
  }

  export interface BiomeConfig {
    gridSize: number;
    jitter: number;
    minInfluence: number;
    maxInfluence: number;
    gaussianCoeff: number;
    boundaryNoiseScale: number;
    boundaryNoiseAmount: number;
    mountainHeightThreshold: number;
    mountainWeightBoost: number;
    valleyHeightThreshold: number;
    valleyWeightBoost: number;
    mountainHeightBoost: number;
  }

  export interface IslandConfig {
    enabled: boolean;
    maxWorldSizeTiles: number;
    falloffTiles: number;
    edgeNoiseScale: number;
    edgeNoiseStrength: number;
  }

  export interface ShorelineConfig {
    waterLevelNormalized: number;
    threshold: number;
    colorStrength: number;
    minSlope: number;
    slopeSampleDistance: number;
    landBand: number;
    landMaxMultiplier: number;
    underwaterBand: number;
    underwaterDepthMultiplier: number;
  }

  export interface TerrainConfig {
    tileSize: number;
    worldSize: number;
    tileResolution: number;
    maxHeight: number;
    waterThreshold: number;
    seed: number;
    noise: TerrainNoiseConfig;
    biomes: BiomeConfig;
    island: IslandConfig;
    shoreline: ShorelineConfig;
  }

  export interface TerrainResult {
    geometry: THREE.BufferGeometry;
    heightMap: Float32Array;
    normalMap?: Float32Array;
  }

  export class TerrainGenerator {
    constructor(
      config?: Partial<TerrainConfig>,
      biomeDefinitions?: Record<string, BiomeDefinition>,
    );
    generate(biome?: BiomeDefinition): TerrainResult;
    getHeightAt(x: number, z: number): number;
    getNormalAt(x: number, z: number): THREE.Vector3;
  }
}

declare module "@hyperscape/procgen/rock" {
  import type * as THREE from "three";

  // Enums
  export const BaseShape: {
    readonly Icosahedron: "icosahedron";
    readonly Sphere: "sphere";
    readonly Box: "box";
    readonly Dodecahedron: "dodecahedron";
    readonly Octahedron: "octahedron";
  };
  export type BaseShapeType =
    | "icosahedron"
    | "sphere"
    | "box"
    | "dodecahedron"
    | "octahedron";

  export const RockCategory: {
    readonly Boulder: "boulder";
    readonly Pebble: "pebble";
    readonly Crystal: "crystal";
    readonly Asteroid: "asteroid";
    readonly Cliff: "cliff";
    readonly LowPoly: "lowpoly";
  };
  export type RockCategoryType =
    | "boulder"
    | "pebble"
    | "crystal"
    | "asteroid"
    | "cliff"
    | "lowpoly";

  export const RockType: {
    readonly Sandstone: "sandstone";
    readonly Limestone: "limestone";
    readonly Granite: "granite";
    readonly Marble: "marble";
    readonly Basalt: "basalt";
    readonly Slate: "slate";
    readonly Obsidian: "obsidian";
    readonly Quartzite: "quartzite";
  };
  export type RockTypeType =
    | "sandstone"
    | "limestone"
    | "granite"
    | "marble"
    | "basalt"
    | "slate"
    | "obsidian"
    | "quartzite";

  export const ColorMode: {
    readonly Vertex: "vertex";
    readonly Texture: "texture";
    readonly Blend: "blend";
  };
  export type ColorModeType = "vertex" | "texture" | "blend";

  export const UVMethod: {
    readonly Box: "box";
    readonly Spherical: "spherical";
    readonly Unwrap: "unwrap";
  };
  export type UVMethodType = "box" | "spherical" | "unwrap";

  export const TexturePattern: {
    readonly Noise: "noise";
    readonly Layered: "layered";
    readonly Speckled: "speckled";
    readonly Veined: "veined";
    readonly Cellular: "cellular";
    readonly Flow: "flow";
  };
  export type TexturePatternType =
    | "noise"
    | "layered"
    | "speckled"
    | "veined"
    | "cellular"
    | "flow";

  // Parameter types
  export type HexColor = string;

  export type Scale3D = {
    x: number;
    y: number;
    z: number;
  };

  export type NoiseParams = {
    scale: number;
    amplitude: number;
    octaves: number;
    lacunarity: number;
    persistence: number;
  };

  export type CrackParams = {
    depth: number;
    frequency: number;
  };

  export type SmoothParams = {
    iterations: number;
    strength: number;
  };

  export type ScrapeParams = {
    count: number;
    minRadius: number;
    maxRadius: number;
    strength: number;
  };

  export type ColorParams = {
    baseColor: HexColor;
    secondaryColor: HexColor;
    accentColor: HexColor;
    variation: number;
    heightBlend: number;
    slopeBlend: number;
    aoIntensity: number;
  };

  export type MaterialParams = {
    roughness: number;
    roughnessVariation: number;
    metalness: number;
  };

  export type TextureParams = {
    pattern: TexturePatternType;
    scale: number;
    detail: number;
    contrast: number;
  };

  export type RockParams = {
    baseShape: BaseShapeType;
    subdivisions: number;
    scale: Scale3D;
    noise: NoiseParams;
    cracks: CrackParams;
    scrape: ScrapeParams;
    smooth: SmoothParams;
    colors: ColorParams;
    material: MaterialParams;
    flatShading: boolean;
    colorMode: ColorModeType;
    textureBlend: number;
    texture: TextureParams;
    uvMethod: UVMethodType;
  };

  export type PartialRockParams = {
    baseShape?: BaseShapeType;
    subdivisions?: number;
    scale?: Partial<Scale3D>;
    noise?: Partial<NoiseParams>;
    cracks?: Partial<CrackParams>;
    scrape?: Partial<ScrapeParams>;
    smooth?: Partial<SmoothParams>;
    colors?: Partial<ColorParams>;
    material?: Partial<MaterialParams>;
    flatShading?: boolean;
    colorMode?: ColorModeType;
    textureBlend?: number;
    texture?: Partial<TextureParams>;
    uvMethod?: UVMethodType;
  };

  export type RockStats = {
    vertices: number;
    triangles: number;
    uniqueVertices: number;
    generationTime: number;
  };

  export type GeneratedRock = {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    stats: RockStats;
    params: RockParams;
    seed: string | number;
  };

  export type RockGenerationOptions = {
    seed?: string | number;
    params?: PartialRockParams;
  };

  // Default parameters
  export const DEFAULT_PARAMS: RockParams;

  // Presets
  export const SHAPE_PRESETS: Record<string, PartialRockParams>;
  export const ROCK_TYPE_PRESETS: Record<string, PartialRockParams>;
  export const ALL_PRESETS: Record<string, PartialRockParams>;
  export function getPreset(name: string): PartialRockParams | undefined;
  export function listPresets(): string[];
  export function mergeParams(
    base: RockParams,
    override: PartialRockParams,
  ): RockParams;

  // Generator
  export class RockGenerator {
    constructor();
    generateFromPreset(
      presetName: string,
      options?: RockGenerationOptions,
    ): GeneratedRock | null;
    generateCustom(
      params: PartialRockParams,
      options?: RockGenerationOptions,
    ): GeneratedRock;
    dispose(): void;
  }
  export const defaultGenerator: RockGenerator;

  // Utilities
  export class SimplexNoise {
    constructor(seed?: number);
    noise2D(x: number, y: number): number;
    noise3D(x: number, y: number, z: number): number;
  }
  export function createRng(seed: string | number): { random(): number };
  export function hashSeed(seed: string | number): number;

  // TSL Material
  export interface RockMaterialUniforms {
    [key: string]: unknown;
  }
  export interface RockMaterialResult {
    material: THREE.Material;
    uniforms: RockMaterialUniforms;
  }
  export function createRockMaterial(
    options?: Record<string, unknown>,
  ): RockMaterialResult;
  export function createVertexColorRockMaterial(
    options?: Record<string, unknown>,
  ): RockMaterialResult;
  export function updateRockColors(
    result: RockMaterialResult,
    colors: Partial<ColorParams>,
  ): void;
  export function updateRockTexture(
    result: RockMaterialResult,
    texture: THREE.Texture,
  ): void;

  // Texture utilities
  export interface BakedTexture {
    texture: THREE.Texture;
    canvas: HTMLCanvasElement;
  }
  export function generateUVs(
    geometry: THREE.BufferGeometry,
    method?: UVMethodType,
  ): void;
  export function samplePattern(
    pattern: TexturePatternType,
    u: number,
    v: number,
    scale?: number,
  ): number;
  export function bakeTexture(
    geometry: THREE.BufferGeometry,
    size?: number,
  ): BakedTexture;
  export function exportTexturePNG(
    bakedTexture: BakedTexture,
    filename?: string,
  ): void;

  // Export utilities
  export interface ExportOptions {
    filename?: string;
    binary?: boolean;
  }
  export interface ExportResult {
    blob: Blob;
    url: string;
  }
  export interface GeometryData {
    positions: Float32Array;
    normals: Float32Array;
    colors?: Float32Array;
    uvs?: Float32Array;
    indices?: Uint32Array;
  }
  export function exportToGLB(
    mesh: THREE.Mesh,
    options?: ExportOptions,
  ): Promise<ExportResult>;
  export function exportToOBJ(
    mesh: THREE.Mesh,
    options?: ExportOptions,
  ): Promise<ExportResult>;
  export function extractGeometryData(
    geometry: THREE.BufferGeometry,
  ): GeometryData;
  export function createMeshFromData(data: GeometryData): THREE.Mesh;
}

declare module "@hyperscape/procgen/plant" {
  import type * as THREE from "three";

  // Render quality enum
  export const RenderQuality: {
    readonly Low: "Low";
    readonly Medium: "Medium";
    readonly High: "High";
    readonly Maximum: "Maximum";
  };
  export { RenderQuality as RenderQualityEnum };
  export type RenderQualityType = "Low" | "Medium" | "High" | "Maximum";

  // Types
  export interface Point2D {
    x: number;
    y: number;
  }

  export interface Point3D {
    x: number;
    y: number;
    z: number;
  }

  export interface FloatRange {
    min: number;
    max: number;
  }

  export interface HSLColor {
    h: number;
    s: number;
    l: number;
  }

  export interface PlantPreset {
    name: string;
    params: Record<string, unknown>;
  }

  export type PlantPresetName = string;

  export interface PlantGenerationOptions {
    seed?: number;
    quality?: RenderQualityType;
    distortionInstances?: number;
    generateTextures?: boolean;
    textureSize?: number;
  }

  export interface LeafBundle {
    mesh: THREE.Mesh;
    leafCount: number;
  }

  export interface PlantGenerationResult {
    group: THREE.Group;
    leafBundles: LeafBundle[];
    trunkMesh: THREE.BufferGeometry;
    textures: {
      albedo: ImageData | null;
      normal: ImageData | null;
      height: ImageData | null;
    };
    stats: {
      vertexCount: number;
      triangleCount: number;
      leafCount: number;
      generationTimeMs: number;
    };
    dispose: () => void;
  }

  export interface QualitySettings {
    subdivSteps: number;
    renderLineSteps: number;
    textureDownsample: number;
    meshDensity: number;
  }

  export interface StumpGenerationResult {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    stats: {
      vertexCount: number;
      triangleCount: number;
      generationTimeMs: number;
    };
  }

  // Stump generation
  export const STUMP_HEIGHT: number;
  export function generateStumpMesh(
    params?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): StumpGenerationResult;
  export function generateStumpFromParams(
    params: Record<string, unknown>,
    stumpHeight?: number,
    seed?: number,
    segments?: number,
  ): StumpGenerationResult;

  // Preset functions
  export const PRESETS: Record<string, PlantPreset>;
  export function getPreset(name: string): PlantPreset | undefined;
  export function getPresetNames(): string[];
  export function createParamsFromPreset(
    presetName: string,
  ): Record<string, unknown>;
  export function createDefaultParams(): Record<string, unknown>;

  // Generator class
  export class PlantGenerator {
    constructor(options?: PlantGenerationOptions);
    loadPreset(name: string): PlantGenerator;
    setQuality(quality: RenderQualityType): PlantGenerator;
    setParam(key: string, value: unknown): PlantGenerator;
    setSeed(seed: number): PlantGenerator;
    generate(): PlantGenerationResult;
  }

  // Convenience functions
  export function generateFromPreset(
    presetName: string,
    seed?: number,
  ): PlantGenerationResult;
  export function generateRandom(seed?: number): PlantGenerationResult;
  export function createGenerator(
    options?: PlantGenerationOptions,
  ): PlantGenerator;

  // GLB export
  export interface PlantGLBExportOptions {
    filename?: string;
    binary?: boolean;
  }
  export interface PlantGLBExportResult {
    blob: Blob;
    url: string;
  }
  export function exportPlantToGLB(
    result: PlantGenerationResult,
    options?: PlantGLBExportOptions,
  ): Promise<PlantGLBExportResult>;
  export function exportPlantToGLBFile(
    result: PlantGenerationResult,
    filename?: string,
  ): Promise<void>;
  export function generateAndExportPlant(
    presetName: string,
    seed?: number,
    options?: PlantGLBExportOptions,
  ): Promise<PlantGLBExportResult>;
}

declare module "@hyperscape/procgen/items" {
  import type * as THREE from "three";

  // Shared types
  export interface WorldPosition {
    x: number;
    y: number;
    z: number;
  }

  export interface Direction2D {
    x: number;
    z: number;
  }

  export const WoodType: {
    readonly Weathered: "weathered";
    readonly Fresh: "fresh";
    readonly Dark: "dark";
    readonly Mossy: "mossy";
  };
  export type WoodTypeValue = "weathered" | "fresh" | "dark" | "mossy";

  export interface ItemRecipeBase {
    label: string;
    woodType: WoodTypeValue;
  }

  export interface GeneratedItemBase {
    mesh: THREE.Mesh | THREE.Group;
    position: WorldPosition;
  }

  export interface ItemCollisionData {
    walkableTiles: Array<{ x: number; z: number }>;
    blockedEdges: Array<{
      tileX: number;
      tileZ: number;
      direction: "north" | "south" | "east" | "west";
    }>;
  }

  export interface ItemStats {
    vertices: number;
    triangles: number;
    generationTime: number;
  }

  export interface ShorelinePoint {
    position: WorldPosition;
    landwardNormal: Direction2D;
    waterwardNormal: Direction2D;
    height: number;
    slope: number;
    distanceFromCenter: number;
  }

  export interface WaterBody {
    id: string;
    type: "pond" | "lake" | "ocean";
    center: { x: number; z: number };
    radius: number;
  }

  // Namespaced dock exports
  export namespace DockGen {
    export * from "@hyperscape/procgen/items/dock";
  }
}

declare module "@hyperscape/procgen/items/dock" {
  import type * as THREE from "three";
  import type {
    WoodTypeValue,
    WorldPosition,
    Direction2D,
    ItemCollisionData,
    ItemStats,
    ItemRecipeBase,
    GeneratedItemBase,
    ShorelinePoint,
  } from "@hyperscape/procgen/items";

  // Dock style enum
  export const DockStyle: {
    readonly Pier: "pier";
    readonly TShaped: "t-shaped";
    readonly LShaped: "l-shaped";
  };
  export type DockStyleValue = "pier" | "t-shaped" | "l-shaped";

  // Dock recipe/params - matches actual types from procgen/items/dock/types.ts
  export interface DockRecipe extends ItemRecipeBase {
    style: DockStyleValue;
    lengthRange: [number, number];
    widthRange: [number, number];
    plankWidth: number;
    plankGap: number;
    postSpacing: number;
    postRadius: number;
    deckHeight: number;
    hasRailing: boolean;
    railingHeight: number;
    railingPostSpacing: number;
    hasMooring: boolean;
    tSectionWidthRange?: [number, number];
    lSectionLengthRange?: [number, number];
  }

  export type PartialDockRecipe = Partial<DockRecipe>;

  // Layout data
  export interface PlankData {
    position: { x: number; y: number; z: number };
    rotation: number;
    width: number;
    length: number;
    thickness: number;
    weathering: number;
  }

  export interface PostData {
    position: { x: number; y: number; z: number };
    radius: number;
    height: number;
    submergedHeight: number;
  }

  export interface RailingData {
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    posts: Array<{ x: number; y: number; z: number }>;
    height: number;
  }

  export interface MooringData {
    position: { x: number; y: number; z: number };
    radius: number;
    height: number;
  }

  export interface DockLayout {
    position: WorldPosition;
    direction: Direction2D;
    rotation: number;
    length: number;
    width: number;
    deckHeight: number;
    planks: PlankData[];
    posts: PostData[];
    railings: RailingData[];
    moorings: MooringData[];
    tSection?: {
      width: number;
      planks: PlankData[];
      posts: PostData[];
      railings: RailingData[];
    };
    lSection?: {
      length: number;
      direction: Direction2D;
      planks: PlankData[];
      posts: PostData[];
      railings: RailingData[];
    };
  }

  // Generated dock result - extends GeneratedItemBase
  export interface GeneratedDock extends GeneratedItemBase {
    layout: DockLayout;
    recipe: DockRecipe;
    collision: ItemCollisionData;
    stats: ItemStats;
    geometryArrays: DockGeometryArrays;
  }

  export interface DockGeometryArrays {
    planks: THREE.BufferGeometry[];
    posts: THREE.BufferGeometry[];
    railingPosts: THREE.BufferGeometry[];
    railingRails: THREE.BufferGeometry[];
    moorings: THREE.BufferGeometry[];
  }

  export interface DockGenerationOptions {
    seed?: string | number;
    params?: PartialDockRecipe;
    waterLevel?: number;
    waterFloorDepth?: number;
  }

  // Presets
  export const DEFAULT_DOCK_PARAMS: DockRecipe;
  export const DOCK_PRESETS: Record<string, PartialDockRecipe>;
  export function getDockPreset(name: string): PartialDockRecipe | null;
  export function getDockPresetNames(): string[];
  export function mergeDockParams(
    base: DockRecipe,
    override: PartialDockRecipe,
  ): DockRecipe;

  // Generator class
  export class DockGenerator {
    constructor();
    generateFromPreset(
      presetName: string,
      shorelinePoint: ShorelinePoint,
      options?: DockGenerationOptions,
    ): GeneratedDock | null;
    generateCustom(
      customParams: PartialDockRecipe,
      shorelinePoint: ShorelinePoint,
      options?: DockGenerationOptions,
    ): GeneratedDock;
    generate(
      recipe: DockRecipe,
      shorelinePoint: ShorelinePoint,
      options?: DockGenerationOptions,
    ): GeneratedDock;
  }
  export const dockGenerator: DockGenerator;

  // Geometry functions
  export function createPlankGeometries(
    planks: PlankData[],
  ): THREE.BufferGeometry[];
  export function createPostGeometries(
    posts: PostData[],
  ): THREE.BufferGeometry[];
  export function createRailingGeometries(
    railings: RailingData[],
  ): THREE.BufferGeometry[];
  export function createMooringGeometries(
    moorings: MooringData[],
  ): THREE.BufferGeometry[];
  export function computeFlatNormals(geometry: THREE.BufferGeometry): void;

  // Material
  export interface DockMaterialUniforms {
    [key: string]: unknown;
  }
  export interface DockMaterialResult {
    material: THREE.Material;
    uniforms: DockMaterialUniforms;
  }
  export function createDockMaterial(
    options?: Record<string, unknown>,
  ): DockMaterialResult;
  export function createSimpleDockMaterial(
    woodType?: WoodTypeValue,
  ): THREE.Material;
  export function updateDockMaterialWaterLevel(
    result: DockMaterialResult,
    waterLevel: number,
  ): void;
}
