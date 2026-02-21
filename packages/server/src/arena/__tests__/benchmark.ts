/**
 * Standalone benchmark comparing BEFORE vs AFTER optimizations
 * for DuelCombatAI's findBestFood and findPotion hot-loop methods.
 *
 * Run with: bun run packages/server/src/arena/__tests__/benchmark.ts
 */

import { performance } from "perf_hooks";

// ── Shared data ──────────────────────────────────────────────────────────────

const FOOD_DATA: Record<string, number> = {
  shrimp: 3,
  bread: 5,
  meat: 3,
  trout: 7,
  salmon: 9,
  tuna: 10,
  lobster: 12,
  bass: 13,
  swordfish: 14,
  monkfish: 16,
  karambwan: 18,
  shark: 20,
  manta: 22,
  anglerfish: 22,
  pie: 6,
  cake: 12,
  stew: 11,
  potato: 14,
  cooked: 5,
  fish: 5,
};

const FOOD_PATTERNS = Object.keys(FOOD_DATA);
const FOOD_ENTRIES = Object.entries(FOOD_DATA);

const POTION_PATTERNS = [
  "potion",
  "brew",
  "restore",
  "prayer",
  "super",
  "ranging",
  "magic",
  "antifire",
  "antidote",
  "stamina",
];

type Item = { slot: number; itemId: string; quantity: number };

// 28-slot inventory with mixed food / non-food
const mockInventory: Item[] = Array.from({ length: 28 }, (_, i) => ({
  slot: i,
  itemId: i % 3 === 0 ? "shark" : i % 3 === 1 ? "shrimp" : "bronze_sword",
  quantity: 1,
}));

// ── BEFORE versions (original code) ─────────────────────────────────────────

function findBestFood_BEFORE(inventory: Item[]): Item | null {
  let bestFood: Item | null = null;
  let bestHeal = -1;

  for (const item of inventory) {
    const name = (item.itemId || "").toLowerCase();
    if (!FOOD_PATTERNS.some((pattern) => name.includes(pattern))) continue;

    // BUG: Object.entries called EVERY iteration – creates new array each time
    const heal = Object.entries(FOOD_DATA).reduce(
      (best, [key, val]) => (name.includes(key) && val > best ? val : best),
      1,
    );

    if (heal > bestHeal) {
      bestHeal = heal;
      bestFood = item;
    }
  }
  return bestFood;
}

function findPotion_BEFORE(inventory: Item[]): Item | null {
  for (const item of inventory) {
    const name = (item.itemId || "").toLowerCase();
    if (POTION_PATTERNS.some((pattern) => name.includes(pattern))) {
      return item;
    }
  }
  return null;
}

// ── AFTER versions (optimized code) ─────────────────────────────────────────

function findBestFood_AFTER(inventory: Item[]): Item | null {
  let bestFood: Item | null = null;
  let bestHeal = -1;

  for (let i = 0; i < inventory.length; i++) {
    const item = inventory[i];
    if (!item.itemId) continue;

    const lowerName = item.itemId.toLowerCase();
    let itemHeal = -1;

    for (let j = 0; j < FOOD_ENTRIES.length; j++) {
      const [key, val] = FOOD_ENTRIES[j];
      if (lowerName.includes(key) && val > itemHeal) {
        itemHeal = val;
      }
    }

    if (itemHeal > bestHeal) {
      bestHeal = itemHeal;
      bestFood = item;
    }
  }
  return bestFood;
}

function findPotion_AFTER(inventory: Item[]): Item | null {
  for (let i = 0; i < inventory.length; i++) {
    const item = inventory[i];
    if (!item.itemId) continue;
    const lowerName = item.itemId.toLowerCase();
    for (let j = 0; j < POTION_PATTERNS.length; j++) {
      if (lowerName.includes(POTION_PATTERNS[j])) return item;
    }
  }
  return null;
}

// ── Runner ──────────────────────────────────────────────────────────────────

function bench(label: string, fn: () => void, iterations: number): number {
  // warm up
  for (let i = 0; i < 1000; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  console.log(
    `  ${label}: ${elapsed.toFixed(2)} ms (${iterations} iterations)`,
  );
  return elapsed;
}

const ITER = 100_000;

console.log("\n═══ findBestFood ═══");
const beforeFood = bench(
  "BEFORE",
  () => findBestFood_BEFORE(mockInventory),
  ITER,
);
const afterFood = bench(
  "AFTER ",
  () => findBestFood_AFTER(mockInventory),
  ITER,
);
const foodImprovement = ((1 - afterFood / beforeFood) * 100).toFixed(1);
console.log(`  → ${foodImprovement}% faster\n`);

console.log("═══ findPotion ═══");
const beforePotion = bench(
  "BEFORE",
  () => findPotion_BEFORE(mockInventory),
  ITER,
);
const afterPotion = bench(
  "AFTER ",
  () => findPotion_AFTER(mockInventory),
  ITER,
);
const potionImprovement = ((1 - afterPotion / beforePotion) * 100).toFixed(1);
console.log(`  → ${potionImprovement}% faster\n`);

// Correctness check
const oldResult = findBestFood_BEFORE(mockInventory);
const newResult = findBestFood_AFTER(mockInventory);
console.log("═══ Correctness ═══");
console.log(
  `  BEFORE best food: ${oldResult?.itemId} (slot ${oldResult?.slot})`,
);
console.log(
  `  AFTER  best food: ${newResult?.itemId} (slot ${newResult?.slot})`,
);
console.log(
  `  Match: ${oldResult?.itemId === newResult?.itemId ? "✅ YES" : "❌ NO"}\n`,
);
