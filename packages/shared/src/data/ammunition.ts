/**
 * Ammunition Manifest
 * Defines bow tiers and arrow data for ranged combat.
 * @see https://oldschool.runescape.wiki/w/Ammunition
 */

export interface ArrowData {
  id: string;
  name: string;
  rangedStrength: number;
  requiredRangedLevel: number;
  requiredBowTier: number;
}

/**
 * Bow tier requirements for arrows.
 * Maps bow ID to its tier level — arrows require a bow of equal or higher tier.
 */
export const BOW_TIERS: Record<string, number> = {
  // Shortbows
  shortbow: 1,
  oak_shortbow: 5,
  willow_shortbow: 20,
  maple_shortbow: 30,

  // Longbows (same tier as their shortbow counterpart)
  longbow: 1,
  oak_longbow: 5,
  willow_longbow: 20,
  maple_longbow: 30,
};

/**
 * Arrow strength bonuses and requirements.
 * F2P scope: standard arrows only (no bolts, no thrown weapons).
 */
export const ARROW_DATA: Record<string, ArrowData> = {
  bronze_arrow: {
    id: "bronze_arrow",
    name: "Bronze arrow",
    rangedStrength: 7,
    requiredRangedLevel: 1,
    requiredBowTier: 1,
  },
  iron_arrow: {
    id: "iron_arrow",
    name: "Iron arrow",
    rangedStrength: 10,
    requiredRangedLevel: 1,
    requiredBowTier: 1,
  },
  steel_arrow: {
    id: "steel_arrow",
    name: "Steel arrow",
    rangedStrength: 16,
    requiredRangedLevel: 5,
    requiredBowTier: 5,
  },
  mithril_arrow: {
    id: "mithril_arrow",
    name: "Mithril arrow",
    rangedStrength: 22,
    requiredRangedLevel: 20,
    requiredBowTier: 20,
  },
  adamant_arrow: {
    id: "adamant_arrow",
    name: "Adamant arrow",
    rangedStrength: 31,
    requiredRangedLevel: 30,
    requiredBowTier: 30,
  },
};
