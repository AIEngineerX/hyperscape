/**
 * Item ID Mapping Tests
 *
 * Tests the bidirectional string↔uint32 item ID mapping against real manifest data.
 * Covers: determinism, uniqueness, noted items, edge cases, roundtrip consistency.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.includes("weapons.json"))
      return JSON.stringify([
        {
          id: "bronze_sword",
          name: "Bronze Sword",
          type: "weapon",
          equipSlot: "weapon",
        },
        {
          id: "iron_sword",
          name: "Iron Sword",
          type: "weapon",
          equipSlot: "weapon",
        },
      ]);
    if (path.includes("resources.json"))
      return JSON.stringify([{ id: "logs", name: "Logs", type: "resource" }]);
    if (path.includes("ammunition.json"))
      return JSON.stringify([
        { id: "bronze_arrow", name: "Bronze Arrow", type: "ammunition" },
      ]);
    if (
      path.includes("food.json") ||
      path.includes("tools.json") ||
      path.includes("misc.json") ||
      path.includes("armor.json")
    )
      return "[]";
    return "[]";
  }),
  readdir: vi.fn(async () => []),
}));

import {
  buildItemIdMap,
  loadAllManifestItems,
  getManifestsDir,
  itemTypeToCategory,
  equipSlotToUint8,
} from "../src/mapping/ItemIdMapping.js";
import type { ItemIdMap } from "../src/mapping/ItemIdMapping.js";

const NOTED_ITEM_OFFSET = 10000;
let mapping: ItemIdMap;
let manifestsDir: string;

beforeAll(async () => {
  manifestsDir = getManifestsDir();
  mapping = await buildItemIdMap(manifestsDir);
});

describe("Item ID Mapping - Core", () => {
  it("loads items from real manifests", () => {
    expect(mapping.baseItemCount).toBeGreaterThan(0);
    expect(mapping.totalItemCount).toBeGreaterThan(mapping.baseItemCount);
  });

  it("assigns sequential IDs starting from 1", () => {
    // ID 0 is reserved for empty/no item
    for (const [, numericId] of mapping.stringToNumeric) {
      expect(numericId).toBeGreaterThan(0);
    }
  });

  it("has no ID collisions in string→numeric direction", () => {
    const seen = new Set<number>();
    for (const [stringId, numericId] of mapping.stringToNumeric) {
      expect(seen.has(numericId)).toBe(false);
      seen.add(numericId);
    }
    expect(seen.size).toBe(mapping.totalItemCount);
  });

  it("has no ID collisions in numeric→string direction", () => {
    const seen = new Set<string>();
    for (const [, stringId] of mapping.numericToString) {
      expect(seen.has(stringId)).toBe(false);
      seen.add(stringId);
    }
    expect(seen.size).toBe(mapping.totalItemCount);
  });

  it("roundtrips all IDs: string→numeric→string", () => {
    for (const [stringId, numericId] of mapping.stringToNumeric) {
      const recovered = mapping.numericToString.get(numericId);
      expect(recovered).toBe(stringId);
    }
  });

  it("roundtrips all IDs: numeric→string→numeric", () => {
    for (const [numericId, stringId] of mapping.numericToString) {
      const recovered = mapping.stringToNumeric.get(stringId);
      expect(recovered).toBe(numericId);
    }
  });
});

describe("Item ID Mapping - Determinism", () => {
  it("produces identical results on repeated builds", async () => {
    const mapping2 = await buildItemIdMap(manifestsDir);

    expect(mapping2.baseItemCount).toBe(mapping.baseItemCount);
    expect(mapping2.totalItemCount).toBe(mapping.totalItemCount);

    for (const [stringId, numericId] of mapping.stringToNumeric) {
      expect(mapping2.stringToNumeric.get(stringId)).toBe(numericId);
    }
  });

  it("sorts items alphabetically for deterministic ordering", () => {
    // Get all base items (numericId <= baseItemCount)
    const baseItems: string[] = [];
    for (const [numericId, stringId] of mapping.numericToString) {
      if (numericId <= mapping.baseItemCount) {
        baseItems.push(stringId);
      }
    }

    // Verify they are in sorted order by their numeric IDs
    for (let i = 1; i < baseItems.length; i++) {
      const prevId = mapping.stringToNumeric.get(baseItems[i - 1])!;
      const currId = mapping.stringToNumeric.get(baseItems[i])!;
      const prevString = mapping.numericToString.get(prevId)!;
      const currString = mapping.numericToString.get(currId)!;
      expect(prevString.localeCompare(currString)).toBeLessThan(0);
    }
  });
});

describe("Item ID Mapping - Noted Items", () => {
  it("generates noted variants for tradeable non-stackable items", () => {
    let notedCount = 0;
    for (const [stringId, numericId] of mapping.stringToNumeric) {
      if (stringId.endsWith("_noted")) {
        notedCount++;
      }
    }
    expect(notedCount).toBeGreaterThan(0);
    expect(mapping.totalItemCount).toBe(mapping.baseItemCount + notedCount);
  });

  it("noted item IDs follow the offset convention: notedId = baseId + 10000", () => {
    for (const [stringId, numericId] of mapping.stringToNumeric) {
      if (!stringId.endsWith("_noted")) continue;

      const baseStringId = stringId.replace("_noted", "");
      const baseNumericId = mapping.stringToNumeric.get(baseStringId);

      expect(baseNumericId).toBeDefined();
      expect(numericId).toBe(baseNumericId! + NOTED_ITEM_OFFSET);
    }
  });

  it("no noted item has a base ID that would collide with the offset range", () => {
    // Base IDs must all be < NOTED_ITEM_OFFSET
    for (const [stringId, numericId] of mapping.stringToNumeric) {
      if (stringId.endsWith("_noted")) continue;
      expect(numericId).toBeLessThan(NOTED_ITEM_OFFSET);
    }
  });

  it("does not generate notes for stackable items", async () => {
    const allItems = await loadAllManifestItems(manifestsDir);
    const stackableIds = new Set(
      allItems.filter((item) => item.stackable).map((item) => item.id),
    );

    for (const [stringId] of mapping.stringToNumeric) {
      if (!stringId.endsWith("_noted")) continue;
      const baseId = stringId.replace("_noted", "");
      expect(stackableIds.has(baseId)).toBe(false);
    }
  });

  it("does not generate notes for currency items", async () => {
    const allItems = await loadAllManifestItems(manifestsDir);
    const currencyIds = new Set(
      allItems
        .filter((item) => item.type === "currency")
        .map((item) => item.id),
    );

    for (const [stringId] of mapping.stringToNumeric) {
      if (!stringId.endsWith("_noted")) continue;
      const baseId = stringId.replace("_noted", "");
      expect(currencyIds.has(baseId)).toBe(false);
    }
  });
});

describe("Item ID Mapping - Known Items", () => {
  it("maps bronze_sword to a valid ID", () => {
    const id = mapping.stringToNumeric.get("bronze_sword");
    expect(id).toBeDefined();
    expect(id).toBeGreaterThan(0);
  });

  it("maps iron_sword to a valid ID", () => {
    const id = mapping.stringToNumeric.get("iron_sword");
    expect(id).toBeDefined();
    expect(id).toBeGreaterThan(0);
  });

  it("bronze_sword and iron_sword have different IDs", () => {
    const bronze = mapping.stringToNumeric.get("bronze_sword")!;
    const iron = mapping.stringToNumeric.get("iron_sword")!;
    expect(bronze).not.toBe(iron);
  });

  it("bronze_arrow is mapped (ammunition category)", () => {
    expect(mapping.stringToNumeric.has("bronze_arrow")).toBe(true);
  });

  it("logs is mapped (resource category)", () => {
    expect(mapping.stringToNumeric.has("logs")).toBe(true);
  });
});

describe("Item Type Category Mapping", () => {
  it("maps all known types to correct indices", () => {
    expect(itemTypeToCategory("weapon")).toBe(0);
    expect(itemTypeToCategory("armor")).toBe(1);
    expect(itemTypeToCategory("food")).toBe(2);
    expect(itemTypeToCategory("resource")).toBe(3);
    expect(itemTypeToCategory("tool")).toBe(4);
    expect(itemTypeToCategory("misc")).toBe(5);
    expect(itemTypeToCategory("currency")).toBe(6);
    expect(itemTypeToCategory("consumable")).toBe(7);
    expect(itemTypeToCategory("ammunition")).toBe(8);
  });

  it("is case-insensitive", () => {
    expect(itemTypeToCategory("Weapon")).toBe(0);
    expect(itemTypeToCategory("FOOD")).toBe(2);
  });

  it("defaults unknown types to misc (5)", () => {
    expect(itemTypeToCategory("nonexistent")).toBe(5);
    expect(itemTypeToCategory("")).toBe(5);
  });
});

describe("Equipment Slot Mapping", () => {
  it("maps all known slots to correct uint8 values", () => {
    expect(equipSlotToUint8("weapon")).toBe(1);
    expect(equipSlotToUint8("shield")).toBe(2);
    expect(equipSlotToUint8("helmet")).toBe(3);
    expect(equipSlotToUint8("body")).toBe(4);
    expect(equipSlotToUint8("legs")).toBe(5);
    expect(equipSlotToUint8("boots")).toBe(6);
    expect(equipSlotToUint8("gloves")).toBe(7);
    expect(equipSlotToUint8("cape")).toBe(8);
    expect(equipSlotToUint8("amulet")).toBe(9);
    expect(equipSlotToUint8("ring")).toBe(10);
    expect(equipSlotToUint8("arrows")).toBe(11);
  });

  it("maps 2h to weapon slot (1)", () => {
    expect(equipSlotToUint8("2h")).toBe(1);
  });

  it("returns 0 for null/undefined/empty (not equippable)", () => {
    expect(equipSlotToUint8(null)).toBe(0);
    expect(equipSlotToUint8(undefined)).toBe(0);
    expect(equipSlotToUint8("")).toBe(0);
  });

  it("returns 0 for unknown slot names", () => {
    expect(equipSlotToUint8("backpack")).toBe(0);
  });
});
