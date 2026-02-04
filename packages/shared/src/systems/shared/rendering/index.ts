/**
 * Rendering Systems
 *
 * Centralized rendering utilities including:
 * - ImpostorManager: On-demand impostor generation and caching with IndexedDB persistence
 * - AtlasedImpostorManager: Mega-atlas system for trees (16 slots)
 * - AtlasedRockPlantImpostorManager: Mega-atlas system for rocks/plants (16 shared slots)
 * - AnimatedImpostorManager: Walk cycle animated impostors for mobs/NPCs
 * - DynamicBuildingImpostorAtlas: Dynamic slot-based atlas for buildings (16 slots)
 * - LODLevel: Enum for entity LOD states
 * - Types for impostor initialization
 */

export {
  ImpostorManager,
  IMPOSTOR_CONFIG,
  BakePriority,
  LODLevel,
  ImpostorBakeMode,
  type ImpostorOptions,
  type ImpostorInitOptions,
} from "./ImpostorManager";

export {
  AtlasedImpostorManager,
  ATLASED_IMPOSTOR_CONFIG,
} from "./AtlasedImpostorManager";

export {
  AtlasedRockPlantImpostorManager,
  ROCK_PLANT_ATLAS_CONFIG,
} from "./AtlasedRockPlantImpostorManager";

export { AtlasedImpostorDebug } from "./AtlasedImpostorDebug";

export {
  runAtlasedImpostorTests,
  visualTest,
  downloadAllSlots,
} from "./atlasedImpostorTest";

// Animated impostors for mobs/NPCs
export {
  AnimatedImpostorManager,
  ANIMATED_IMPOSTOR_CONFIG,
  ANIMATED_LOD_DISTANCES,
  DEFAULT_ANIMATED_LOD_DISTANCES,
  initEntityAnimatedHLOD,
  updateEntityAnimatedHLOD,
  cleanupEntityAnimatedHLOD,
  type AnimatedHLODState,
  type AnimatedLodDistances,
} from "./AnimatedImpostorManager";

// Mob impostor preloading (pre-bakes all mob types at load time)
export {
  prewarmMobImpostors,
  getMobImpostorStats,
} from "./MobImpostorPreloader";

// Dynamic building impostor atlas
export {
  DynamicBuildingImpostorAtlas,
  DYNAMIC_ATLAS_CONFIG,
  type AtlasBuildingData,
} from "./DynamicBuildingImpostorAtlas";
