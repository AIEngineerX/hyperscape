/**
 * LOD (Level of Detail) Asset Bundle Types
 *
 * Defines the structure for managing multi-level LOD assets including:
 * - LOD0: Base high-detail mesh
 * - LOD1: Medium distance mesh (~30% of LOD0)
 * - LOD2: Far distance mesh (~10% of LOD0)
 * - HLOD/Imposter: Billboard/sprite for extreme distances
 */

/**
 * LOD level identifiers
 */
export type LODLevel = "lod0" | "lod1" | "lod2" | "imposter";

/**
 * Individual LOD variant information
 */
export interface LODVariant {
  /** LOD level */
  level: LODLevel;
  /** Path to the model file relative to asset root */
  modelPath: string;
  /** Vertex count */
  vertices: number;
  /** Face/triangle count */
  faces: number;
  /** File size in bytes */
  fileSize: number;
  /** Distance threshold where this LOD activates (meters from camera) */
  distanceThreshold: number;
  /** Target percentage of original (for LOD1/2) */
  targetPercent?: number;
  /** Generation method */
  method: "original" | "decimated" | "baked" | "imposter";
  /** Timestamp of last generation */
  generatedAt?: string;
}

/**
 * Imposter/billboard configuration
 */
export interface ImposterConfig {
  /** Whether to generate an imposter for this asset */
  enabled: boolean;
  /** Imposter type */
  type: "billboard" | "octahedral" | "none";
  /** Resolution of imposter texture */
  resolution: number;
  /** Number of views for octahedral imposter (default: 8) */
  viewCount?: number;
  /** Alpha cutoff for transparency */
  alphaCutoff: number;
  /** Distance at which imposter activates */
  activationDistance: number;
}

/**
 * Per-asset LOD settings that override category defaults
 */
export interface AssetLODSettings {
  /** Override LOD1 distance threshold */
  lod1Distance?: number;
  /** Override LOD2 distance threshold */
  lod2Distance?: number;
  /** Override imposter distance threshold */
  imposterDistance?: number;
  /** Override fade out distance */
  fadeOutDistance?: number;
  /** Override LOD1 target percentage */
  lod1Percent?: number;
  /** Override LOD2 target percentage */
  lod2Percent?: number;
  /** Decimation strictness (0=fast, 1=balanced, 2=seam-aware) */
  strictness?: 0 | 1 | 2;
  /** Whether to generate LOD1 */
  generateLOD1?: boolean;
  /** Whether to generate LOD2 */
  generateLOD2?: boolean;
  /** Imposter configuration */
  imposter?: ImposterConfig;
}

/**
 * LOD Bundle - A collection of LOD variants for a single asset
 */
export interface LODBundle {
  /** Base asset ID */
  assetId: string;
  /** Asset name */
  name: string;
  /** Asset category (tree, bush, rock, etc.) */
  category: string;
  /** LOD variants */
  variants: LODVariant[];
  /** Per-asset LOD settings (overrides category defaults) */
  settings: AssetLODSettings;
  /** Bundle metadata */
  metadata: {
    /** Total disk size of all LOD files */
    totalSize: number;
    /** Whether all LODs are up to date */
    isComplete: boolean;
    /** Which LOD levels are missing */
    missingLevels: LODLevel[];
    /** Last time any LOD was updated */
    lastUpdated?: string;
  };
}

/**
 * Category-level LOD defaults
 */
export interface CategoryLODDefaults {
  /** Category name */
  category: string;
  /** Description */
  description: string;
  /** LOD1 settings */
  lod1: {
    /** Whether to generate */
    enabled: boolean;
    /** Target percentage of LOD0 vertices */
    targetPercent: number;
    /** Distance threshold */
    distance: number;
    /** Minimum vertices to preserve */
    minVertices: number;
  };
  /** LOD2 settings */
  lod2: {
    /** Whether to generate */
    enabled: boolean;
    /** Target percentage of LOD0 vertices */
    targetPercent: number;
    /** Distance threshold */
    distance: number;
    /** Minimum vertices to preserve */
    minVertices: number;
  };
  /** Imposter settings */
  imposter: ImposterConfig;
  /** Fade out distance */
  fadeOutDistance: number;
}

/**
 * Default LOD settings by category
 */
export const DEFAULT_CATEGORY_LOD_SETTINGS: Record<
  string,
  CategoryLODDefaults
> = {
  tree: {
    category: "tree",
    description: "Large trees and tree trunks",
    lod1: { enabled: true, targetPercent: 30, distance: 80, minVertices: 200 },
    lod2: { enabled: true, targetPercent: 10, distance: 150, minVertices: 50 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 512,
      viewCount: 8,
      alphaCutoff: 0.5,
      activationDistance: 250,
    },
    fadeOutDistance: 400,
  },
  bush: {
    category: "bush",
    description: "Bushes and shrubs",
    lod1: { enabled: true, targetPercent: 35, distance: 50, minVertices: 100 },
    lod2: { enabled: true, targetPercent: 15, distance: 100, minVertices: 30 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 256,
      alphaCutoff: 0.5,
      activationDistance: 150,
    },
    fadeOutDistance: 250,
  },
  rock: {
    category: "rock",
    description: "Rocks and boulders",
    lod1: { enabled: true, targetPercent: 40, distance: 60, minVertices: 80 },
    lod2: { enabled: true, targetPercent: 15, distance: 120, minVertices: 30 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 256,
      viewCount: 8,
      alphaCutoff: 0.9,
      activationDistance: 200,
    },
    fadeOutDistance: 300,
  },
  fern: {
    category: "fern",
    description: "Ferns and small ground plants",
    lod1: { enabled: true, targetPercent: 40, distance: 40, minVertices: 50 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 128,
      alphaCutoff: 0.5,
      activationDistance: 80,
    },
    fadeOutDistance: 150,
  },
  flower: {
    category: "flower",
    description: "Flowers and small decorative plants",
    lod1: { enabled: true, targetPercent: 50, distance: 25, minVertices: 20 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 64,
      alphaCutoff: 0.5,
      activationDistance: 50,
    },
    fadeOutDistance: 100,
  },
  grass: {
    category: "grass",
    description: "Grass clumps and patches",
    lod1: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 64,
      alphaCutoff: 0.3,
      activationDistance: 30,
    },
    fadeOutDistance: 60,
  },
  mushroom: {
    category: "mushroom",
    description: "Mushrooms and fungi",
    lod1: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 64,
      alphaCutoff: 0.5,
      activationDistance: 20,
    },
    fadeOutDistance: 40,
  },
  building: {
    category: "building",
    description: "Buildings and structures",
    lod1: { enabled: true, targetPercent: 25, distance: 100, minVertices: 500 },
    lod2: { enabled: true, targetPercent: 8, distance: 200, minVertices: 150 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 1024,
      viewCount: 8,
      alphaCutoff: 0.9,
      activationDistance: 400,
    },
    fadeOutDistance: 600,
  },
  prop: {
    category: "prop",
    description: "Props and decorative items",
    lod1: { enabled: true, targetPercent: 35, distance: 40, minVertices: 50 },
    lod2: { enabled: true, targetPercent: 12, distance: 80, minVertices: 20 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 128,
      alphaCutoff: 0.5,
      activationDistance: 120,
    },
    fadeOutDistance: 200,
  },
  mob: {
    category: "mob",
    description: "Hostile creatures and monsters (VRM/GLB animated)",
    lod1: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 256,
      viewCount: 8,
      alphaCutoff: 0.5,
      activationDistance: 80,
    },
    fadeOutDistance: 150,
  },
  character: {
    category: "character",
    description: "Player characters and avatars (VRM animated)",
    lod1: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 256,
      viewCount: 8,
      alphaCutoff: 0.5,
      activationDistance: 100,
    },
    fadeOutDistance: 200,
  },
  npc: {
    category: "npc",
    description:
      "Non-player characters like shopkeepers and quest givers (VRM animated)",
    lod1: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    lod2: { enabled: false, targetPercent: 0, distance: 0, minVertices: 0 },
    imposter: {
      enabled: true,
      type: "octahedral",
      resolution: 256,
      viewCount: 8,
      alphaCutoff: 0.5,
      activationDistance: 80,
    },
    fadeOutDistance: 150,
  },
  default: {
    category: "default",
    description: "Default settings for uncategorized assets",
    lod1: { enabled: true, targetPercent: 30, distance: 50, minVertices: 100 },
    lod2: { enabled: true, targetPercent: 10, distance: 100, minVertices: 30 },
    imposter: {
      enabled: true,
      type: "billboard",
      resolution: 256,
      alphaCutoff: 0.5,
      activationDistance: 150,
    },
    fadeOutDistance: 250,
  },
};

/**
 * LOD bake request for a single asset
 */
export interface LODBakeRequest {
  /** Asset ID to bake */
  assetId: string;
  /** Which LOD levels to generate */
  levels: LODLevel[];
  /** Override settings for this bake */
  settings?: Partial<AssetLODSettings>;
  /** Force regenerate even if up to date */
  force?: boolean;
}

/**
 * Batch LOD bake request
 */
export interface BatchLODBakeRequest {
  /** Asset IDs to bake (empty = all in category/all) */
  assetIds?: string[];
  /** Categories to bake (if assetIds not provided) */
  categories?: string[];
  /** Which LOD levels to generate */
  levels: LODLevel[];
  /** Force regenerate even if up to date */
  force?: boolean;
  /** Dry run - don't actually bake, just report what would be done */
  dryRun?: boolean;
}

/**
 * LOD bake job status
 */
export type LODBakeJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Result for a single asset LOD bake
 */
export interface LODBakeAssetResult {
  /** Asset ID */
  assetId: string;
  /** LOD level that was baked */
  level: LODLevel;
  /** Success status */
  success: boolean;
  /** Input file path */
  input: string;
  /** Output file path (if successful) */
  output?: string;
  /** Original vertex count */
  originalVerts: number;
  /** Final vertex count */
  finalVerts?: number;
  /** Reduction percentage */
  reduction?: number;
  /** Error message (if failed) */
  error?: string;
  /** Time taken in milliseconds */
  duration?: number;
}

/**
 * LOD bake job
 */
export interface LODBakeJob {
  /** Unique job ID */
  jobId: string;
  /** Job status */
  status: LODBakeJobStatus;
  /** Overall progress (0-100) */
  progress: number;
  /** Total assets to process */
  totalAssets: number;
  /** Assets processed so far */
  processedAssets: number;
  /** Current asset being processed */
  currentAsset?: string;
  /** Current LOD level being processed */
  currentLevel?: LODLevel;
  /** Results for completed assets */
  results: LODBakeAssetResult[];
  /** Error message (if job failed) */
  error?: string;
  /** Job start time */
  startedAt: string;
  /** Job completion time */
  completedAt?: string;
  /** Estimated time remaining (seconds) */
  estimatedRemaining?: number;
}

/**
 * Octahedral imposter bake configuration
 */
export interface OctahedralImpostorBakeConfig {
  /** Atlas texture width */
  atlasWidth: number;
  /** Atlas texture height */
  atlasHeight: number;
  /** Number of points/cells per row */
  gridSizeX: number;
  /** Number of points/cells per column */
  gridSizeY: number;
  /** Octahedron type: HEMI (hemisphere) or FULL (full sphere) */
  octType: "HEMI" | "FULL";
  /** Background color for atlas cells */
  backgroundColor: number;
  /** Background alpha (0 = transparent) */
  backgroundAlpha: number;
}

/**
 * Default octahedral imposter bake config
 */
export const DEFAULT_OCTAHEDRAL_IMPOSTER_CONFIG: OctahedralImpostorBakeConfig =
  {
    atlasWidth: 2048,
    atlasHeight: 2048,
    gridSizeX: 8,
    gridSizeY: 8,
    octType: "HEMI",
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
  };

/**
 * Imposter metadata stored alongside atlas texture
 */
export interface ImpostorMetadata {
  /** Asset ID this imposter belongs to */
  assetId: string;
  /** Asset category */
  category: string;
  /** Model path the imposter was generated from */
  modelPath: string;
  /** Grid size X (number of columns in atlas) */
  gridSizeX: number;
  /** Grid size Y (number of rows in atlas) */
  gridSizeY: number;
  /** Octahedron type used */
  octType: "HEMI" | "FULL";
  /** Atlas texture dimensions */
  atlasWidth: number;
  atlasHeight: number;
  /** Bounding sphere radius of the original model */
  boundingSphereRadius: number;
  /** Bounding sphere center Y offset (for ground alignment) */
  boundingSphereCenterY: number;
  /** Animation frame used for capture (0-1, e.g., 0.25 = 25% through idle) */
  animationFrame: number;
  /** Animation name used for capture */
  animationName: string;
  /** Path to the atlas PNG file */
  atlasPath: string;
  /** Timestamp when imposter was generated */
  generatedAt: string;
  /** Version of imposter format */
  version: number;
}

/**
 * Imposter bake request
 */
export interface ImpostorBakeRequest {
  /** Asset ID to bake imposter for */
  assetId: string;
  /** Path to the model file (VRM or GLB) */
  modelPath: string;
  /** Asset category (mob, character, npc, etc.) */
  category: string;
  /** Override bake configuration */
  config?: Partial<OctahedralImpostorBakeConfig>;
  /** Animation name to use for capture (default: "idle") */
  animationName?: string;
  /** Animation frame to capture (0-1, default: 0.25) */
  animationFrame?: number;
  /** Force regenerate even if up to date */
  force?: boolean;
}

/**
 * Batch imposter bake request
 */
export interface BatchImpostorBakeRequest {
  /** Asset IDs to bake (empty = all in category) */
  assetIds?: string[];
  /** Categories to bake (mob, character, npc) */
  categories?: string[];
  /** Override bake configuration for all */
  config?: Partial<OctahedralImpostorBakeConfig>;
  /** Force regenerate even if up to date */
  force?: boolean;
}

/**
 * Result of a single imposter bake operation
 */
export interface ImpostorBakeResult {
  /** Asset ID */
  assetId: string;
  /** Success status */
  success: boolean;
  /** Generated metadata (if successful) */
  metadata?: ImpostorMetadata;
  /** Path to atlas file (if successful) */
  atlasPath?: string;
  /** Error message (if failed) */
  error?: string;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Imposter bake job for batch operations
 */
export interface ImpostorBakeJob {
  /** Unique job ID */
  jobId: string;
  /** Job status */
  status: LODBakeJobStatus;
  /** Overall progress (0-100) */
  progress: number;
  /** Total assets to process */
  totalAssets: number;
  /** Assets processed so far */
  processedAssets: number;
  /** Current asset being processed */
  currentAsset?: string;
  /** Results for completed assets */
  results: ImpostorBakeResult[];
  /** Error message (if job failed) */
  error?: string;
  /** Job start time */
  startedAt: string;
  /** Job completion time */
  completedAt?: string;
}

/**
 * Get category defaults for an asset
 */
export function getCategoryDefaults(category: string): CategoryLODDefaults {
  return (
    DEFAULT_CATEGORY_LOD_SETTINGS[category] ||
    DEFAULT_CATEGORY_LOD_SETTINGS.default
  );
}

/**
 * Merge asset-specific settings with category defaults
 */
export function getMergedLODSettings(
  category: string,
  assetSettings?: AssetLODSettings,
): {
  lod1: CategoryLODDefaults["lod1"];
  lod2: CategoryLODDefaults["lod2"];
  imposter: ImposterConfig;
  fadeOutDistance: number;
} {
  const defaults = getCategoryDefaults(category);

  return {
    lod1: {
      enabled: assetSettings?.generateLOD1 ?? defaults.lod1.enabled,
      targetPercent: assetSettings?.lod1Percent ?? defaults.lod1.targetPercent,
      distance: assetSettings?.lod1Distance ?? defaults.lod1.distance,
      minVertices: defaults.lod1.minVertices,
    },
    lod2: {
      enabled: assetSettings?.generateLOD2 ?? defaults.lod2.enabled,
      targetPercent: assetSettings?.lod2Percent ?? defaults.lod2.targetPercent,
      distance: assetSettings?.lod2Distance ?? defaults.lod2.distance,
      minVertices: defaults.lod2.minVertices,
    },
    imposter: assetSettings?.imposter ?? defaults.imposter,
    fadeOutDistance: assetSettings?.fadeOutDistance ?? defaults.fadeOutDistance,
  };
}
