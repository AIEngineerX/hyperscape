/**
 * Tree Impostor Module
 *
 * Tree-specific impostor utilities that wrap @hyperscape/impostor.
 *
 * For core impostor functionality (OctahedralImpostor, ImpostorBaker, etc.),
 * import directly from @hyperscape/impostor.
 *
 * @module TreeImpostor
 */

// Tree-specific impostor API
export {
  TreeImpostor,
  bakeTreeImpostor,
  type TreeImpostorOptions,
  type BakeMode,
} from "./TreeImpostor.js";
