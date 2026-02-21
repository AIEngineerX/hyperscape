const DUEL_FOOD_TIERS = [
  { minDiff: 80, itemId: "shark" },
  { minDiff: 60, itemId: "swordfish" },
  { minDiff: 40, itemId: "lobster" },
  { minDiff: 25, itemId: "tuna" },
  { minDiff: 15, itemId: "salmon" },
  { minDiff: 8, itemId: "trout" },
  { minDiff: 0, itemId: "shrimp" },
] as const;

const normalizeLevel = (level: number): number => {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.floor(level));
};

export const DUEL_FOOD_ITEM_IDS = DUEL_FOOD_TIERS.map(
  (tier) => tier.itemId,
) as readonly string[];

/**
 * Pick duel food quality using only level difference:
 * - small gap => weak food
 * - large gap => strong food
 */
export function getDuelFoodItemForLevels(
  levelA: number,
  levelB: number,
): string {
  const diff = Math.abs(normalizeLevel(levelA) - normalizeLevel(levelB));
  for (const tier of DUEL_FOOD_TIERS) {
    if (diff >= tier.minDiff) {
      return tier.itemId;
    }
  }
  return "shrimp";
}

/**
 * Supports direct IDs and note-like variants that may include suffixes.
 */
export function isDuelFoodItemId(
  itemId: string,
  expectedItemId?: string,
): boolean {
  if (expectedItemId) {
    return itemId === expectedItemId || itemId.endsWith(expectedItemId);
  }

  return DUEL_FOOD_ITEM_IDS.some(
    (foodItemId) => itemId === foodItemId || itemId.endsWith(foodItemId),
  );
}
