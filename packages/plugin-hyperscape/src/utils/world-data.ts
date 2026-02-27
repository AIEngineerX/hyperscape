/**
 * World Data — static manifest data loader for deterministic decisions.
 *
 * Lazily loads and caches manifest JSON from the server package.
 * Used by the planner and behavior manager for code-level decisions
 * (NOT for LLM prompts).
 *
 * All reads are wrapped in try/catch — returns empty/defaults on failure
 * so the planner degrades gracefully.
 */

import fs from "fs";
import path from "path";
import { logger } from "@elizaos/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceEntry {
  id: string;
  name: string;
  levelRequired: number;
}

interface FoodEntry {
  id: string;
  name: string;
  healAmount: number;
}

interface ManifestCache {
  woodcutting: ResourceEntry[] | null;
  mining: ResourceEntry[] | null;
  fishing: ResourceEntry[] | null;
  food: FoodEntry[] | null;
  bankPosition: [number, number, number] | null;
  loaded: boolean;
}

// ---------------------------------------------------------------------------
// Module-level cache (parsed once)
// ---------------------------------------------------------------------------

const cache: ManifestCache = {
  woodcutting: null,
  mining: null,
  fishing: null,
  food: null,
  bankPosition: null,
  loaded: false,
};

/**
 * Resolve the base manifests directory.
 * Tries multiple paths to handle different runtime contexts.
 */
function resolveManifestsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "packages/server/world/assets/manifests"),
    path.resolve(
      import.meta.dirname ?? process.cwd(),
      "../../../../server/world/assets/manifests",
    ),
  ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

function readJSON(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Lazy init — parse all manifests once on first access.
 */
function ensureLoaded(): void {
  if (cache.loaded) return;
  cache.loaded = true;

  const dir = resolveManifestsDir();
  if (!dir) {
    logger.warn(
      "[WorldData] Could not find manifests directory — using defaults",
    );
    return;
  }

  try {
    // Woodcutting
    const wc = readJSON(path.join(dir, "gathering/woodcutting.json")) as {
      trees?: Array<{ id: string; name: string; levelRequired: number }>;
    } | null;
    if (wc?.trees) {
      cache.woodcutting = wc.trees.map((t) => ({
        id: t.id,
        name: t.name,
        levelRequired: t.levelRequired ?? 1,
      }));
    }

    // Mining
    const mn = readJSON(path.join(dir, "gathering/mining.json")) as {
      rocks?: Array<{ id: string; name: string; levelRequired: number }>;
    } | null;
    if (mn?.rocks) {
      cache.mining = mn.rocks.map((r) => ({
        id: r.id,
        name: r.name,
        levelRequired: r.levelRequired ?? 1,
      }));
    }

    // Fishing — spots have levelRequired at top level + per-yield
    const fs_ = readJSON(path.join(dir, "gathering/fishing.json")) as {
      spots?: Array<{ id: string; name: string; levelRequired: number }>;
    } | null;
    if (fs_?.spots) {
      cache.fishing = fs_.spots.map((s) => ({
        id: s.id,
        name: s.name,
        levelRequired: s.levelRequired ?? 1,
      }));
    }

    // Food
    const fd = readJSON(path.join(dir, "items/food.json"));
    if (Array.isArray(fd)) {
      cache.food = (
        fd as Array<{ id: string; name: string; healAmount: number }>
      ).map((f) => ({
        id: f.id,
        name: f.name,
        healAmount: f.healAmount ?? 1,
      }));
    }

    // Bank position — first bank NPC in starter town
    const wa = readJSON(path.join(dir, "world-areas.json")) as {
      starterTowns?: Record<
        string,
        {
          npcs?: Array<{
            type: string;
            position: { x: number; y: number; z: number };
          }>;
        }
      >;
    } | null;
    if (wa?.starterTowns) {
      for (const town of Object.values(wa.starterTowns)) {
        const bankNpc = town.npcs?.find((n) => n.type === "bank");
        if (bankNpc?.position) {
          cache.bankPosition = [
            bankNpc.position.x,
            bankNpc.position.y,
            bankNpc.position.z,
          ];
          break;
        }
      }
    }

    logger.info(
      `[WorldData] Loaded manifests: ${cache.woodcutting?.length ?? 0} trees, ${cache.mining?.length ?? 0} rocks, ${cache.fishing?.length ?? 0} fishing spots, ${cache.food?.length ?? 0} food items, bank=${cache.bankPosition ? "yes" : "no"}`,
    );
  } catch (err) {
    logger.warn(
      `[WorldData] Error loading manifests: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get resources available at a given skill level.
 * Returns all resources with levelRequired <= level.
 */
export function getResourcesAtLevel(
  skill: "woodcutting" | "mining" | "fishing",
  level: number,
): ResourceEntry[] {
  ensureLoaded();

  const resources = cache[skill];
  if (!resources) return [];

  return resources.filter((r) => r.levelRequired <= level);
}

/**
 * Get the bank position from world data.
 * Returns [x, y, z] or [8, 0, 5] as hardcoded fallback.
 */
export function getBankPosition(): [number, number, number] {
  ensureLoaded();
  return cache.bankPosition ?? [8, 0, 5];
}

/**
 * Get heal amount for a food item by name (case-insensitive partial match).
 * Returns 0 if not found.
 */
export function getFoodHealAmount(itemName: string): number {
  ensureLoaded();

  if (!cache.food) return 0;
  const lower = itemName.toLowerCase();
  const match = cache.food.find(
    (f) =>
      f.name.toLowerCase() === lower ||
      f.id.toLowerCase() === lower ||
      lower.includes(f.name.toLowerCase()) ||
      lower.includes(f.id.toLowerCase()),
  );
  return match?.healAmount ?? 0;
}
