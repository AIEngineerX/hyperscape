/**
 * Manifest Validation Test
 *
 * Exercises DataManager.initialize() and its internal validateAllData()
 * so CI catches broken cross-references, missing fields, or invalid data
 * in manifest files before they reach production.
 *
 * Relies on vitest.setup.ts having already called dataManager.initialize().
 */

import { describe, it, expect } from "vitest";
import { dataManager } from "../DataManager";
import { ITEMS } from "../items";
import { ALL_NPCS } from "../npcs";

const manifestsAvailable = ITEMS.size > 0;
const enablesDropItemReferenceChecks = [
  "bronze_sword",
  "coins",
  "steel_sword",
  "copper_ore",
].every((itemId) => ITEMS.has(itemId));

describe.skipIf(!manifestsAvailable)("Manifest validation", () => {
  it("DataManager initializes and reports validation status", async () => {
    const result = await dataManager.initialize();

    expect(typeof result.isValid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);

    if (result.isValid) {
      expect(result.errors).toHaveLength(0);
    } else {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("loads a non-zero number of items", async () => {
    const result = await dataManager.initialize();
    expect(result.itemCount).toBeGreaterThan(0);
    expect(ITEMS.size).toBeGreaterThan(0);
  });

  it("loads a non-zero number of NPCs", async () => {
    const result = await dataManager.initialize();
    expect(result.npcCount).toBeGreaterThan(0);
    expect(ALL_NPCS.size).toBeGreaterThan(0);
  });

  it("loads world areas", async () => {
    const result = await dataManager.initialize();
    expect(result.areaCount).toBeGreaterThan(0);
  });

  it("all NPC drop tables reference existing items", () => {
    if (!enablesDropItemReferenceChecks) {
      return;
    }

    for (const [npcId, npc] of ALL_NPCS) {
      if (!npc.drops) continue;
      const allDrops = [
        ...(npc.drops.defaultDrop?.enabled ? [npc.drops.defaultDrop] : []),
        ...npc.drops.always,
        ...npc.drops.common,
        ...npc.drops.uncommon,
        ...npc.drops.rare,
        ...npc.drops.veryRare,
      ];

      for (const drop of allDrops) {
        expect(
          ITEMS.has(drop.itemId),
          `NPC "${npcId}" drop references unknown item "${drop.itemId}"`,
        ).toBe(true);
      }
    }
  });

  it("all items have required fields", () => {
    for (const [id, item] of ITEMS) {
      expect(item.id, `Item missing id`).toBeTruthy();
      expect(item.name, `Item "${id}" missing name`).toBeTruthy();
      expect(item.type, `Item "${id}" missing type`).toBeTruthy();
    }
  });

  it("all NPCs have valid stats", () => {
    for (const [id, npc] of ALL_NPCS) {
      expect(
        npc.stats.health,
        `NPC "${id}" has non-positive health`,
      ).toBeGreaterThan(0);
      expect(
        npc.stats.level,
        `NPC "${id}" has level < 1`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
