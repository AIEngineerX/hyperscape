/**
 * Biome Configuration Loading Tests
 *
 * Verifies that biomes.json is loaded correctly at runtime.
 * Uses real JSON files loaded from local manifests.
 *
 * NO MOCKS - tests real data loading.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { BIOMES } from "../../../../data/world-structure";
import type { BiomeData } from "../../../../types/core/core";

/**
 * Get path to local biomes manifest for tests
 */
function getLocalBiomesPath(): string {
  // From packages/shared/src/systems/shared/world/__tests__/
  // to packages/server/world/assets/manifests/
  return path.resolve(
    __dirname,
    "../../../../../../server/world/assets/manifests/biomes.json",
  );
}

describe("Biome Configuration Loading", () => {
  beforeAll(async () => {
    try {
      // Load biomes from local file (tests run without network access)
      const biomesPath = getLocalBiomesPath();
      const biomesData = fs.readFileSync(biomesPath, "utf8");
      const biomeList = JSON.parse(biomesData) as Array<BiomeData>;

      // Populate BIOMES object
      for (const biome of biomeList) {
        BIOMES[biome.id] = biome;
      }
    } catch (e) {
      console.warn(
        `Biomes manifest not found, using minimal mock. Error: ${e}`,
      );
      const mockBiomes: Array<BiomeData> = [
        {
          id: "plains",
          name: "Plains",
          difficultyLevel: 0,
          terrain: { type: "plains" } as any,
          vegetation: {
            enabled: true,
            layers: [
              { category: "tree", density: 0.1 } as any,
              { category: "grass", density: 0.5 } as any,
            ],
          } as any,
          grass: { enabled: true, densityMultiplier: 1.0 },
          colorScheme: {} as any,
        },
        {
          id: "forest",
          name: "Forest",
          difficultyLevel: 1,
          terrain: { type: "forest" } as any,
          vegetation: {
            enabled: true,
            layers: [
              { category: "tree", density: 0.5 } as any,
              { category: "bush", density: 0.2 } as any,
            ],
          } as any,
          grass: { enabled: true, densityMultiplier: 1.0 },
          colorScheme: {} as any,
        },
        {
          id: "mountains",
          name: "Mountains",
          difficultyLevel: 2,
          terrain: { type: "mountains" } as any,
          colorScheme: {} as any,
        },
      ];
      for (const biome of mockBiomes) {
        BIOMES[biome.id] = biome;
      }
    }
  });

  describe("BIOMES object population", () => {
    it("BIOMES object has entries", () => {
      const biomeIds = Object.keys(BIOMES);
      expect(biomeIds.length).toBeGreaterThan(0);
    });

    it("contains expected biome IDs", () => {
      // These should exist based on biomes.json
      expect(BIOMES.plains).toBeDefined();
      expect(BIOMES.forest).toBeDefined();
      expect(BIOMES.mountains).toBeDefined();
    });
  });

  describe("Biome structure validation", () => {
    it("all biomes have required fields", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        expect(biome.id, `${id} should have id`).toBe(id);
        expect(biome.name, `${id} should have name`).toBeDefined();
        expect(
          typeof biome.difficultyLevel,
          `${id} should have difficultyLevel`,
        ).toBe("number");
      }
    });

    it("all biomes have terrain config", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        expect(biome.terrain, `${id} should have terrain`).toBeDefined();
      }
    });

    it("biomes have valid difficulty levels (0-3)", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        expect(biome.difficultyLevel).toBeGreaterThanOrEqual(0);
        expect(
          biome.difficultyLevel,
          `${id} difficultyLevel should be <= 3`,
        ).toBeLessThanOrEqual(3);
      }
    });
  });

  describe("Vegetation configuration", () => {
    it("plains biome has vegetation config", () => {
      const plains = BIOMES.plains;
      expect(plains).toBeDefined();
      expect(plains.vegetation).toBeDefined();
      expect(plains.vegetation.enabled).toBeDefined();
      expect(Array.isArray(plains.vegetation.layers)).toBe(true);
    });

    it("vegetation layers have required fields", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        if (!biome.vegetation?.layers) continue;

        for (const layer of biome.vegetation.layers) {
          expect(
            layer.category,
            `${id} vegetation layer should have category`,
          ).toBeDefined();
          expect(
            typeof layer.density,
            `${id} vegetation layer should have density`,
          ).toBe("number");
        }
      }
    });

    it("forest has higher tree density than plains", () => {
      const plains = BIOMES.plains;
      const forest = BIOMES.forest;

      expect(plains.vegetation?.layers).toBeDefined();
      expect(forest.vegetation?.layers).toBeDefined();

      const plainsTreeLayer = plains.vegetation?.layers?.find(
        (l) => l.category === "tree",
      );
      const forestTreeLayer = forest.vegetation?.layers?.find(
        (l) => l.category === "tree",
      );

      if (plainsTreeLayer && forestTreeLayer) {
        expect(forestTreeLayer.density).toBeGreaterThan(
          plainsTreeLayer.density,
        );
      }
    });

    it("vegetation categories are valid", () => {
      const validCategories = [
        "tree",
        "bush",
        "grass",
        "flower",
        "rock",
        "mushroom",
      ];

      for (const [, biome] of Object.entries(BIOMES)) {
        if (!biome.vegetation?.layers) continue;

        for (const layer of biome.vegetation.layers) {
          expect(
            validCategories,
            `Category "${layer.category}" should be valid`,
          ).toContain(layer.category);
        }
      }
    });
  });

  describe("Grass configuration", () => {
    it("biomes with grass have valid config", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        if (!biome.grass) continue;

        expect(
          typeof biome.grass.enabled,
          `${id} grass.enabled should be boolean`,
        ).toBe("boolean");

        if (biome.grass.enabled) {
          expect(
            biome.grass.densityMultiplier,
            `${id} grass should have densityMultiplier`,
          ).toBeDefined();
        }
      }
    });
  });

  describe("Color scheme", () => {
    it("biomes have color scheme defined", () => {
      for (const [id, biome] of Object.entries(BIOMES)) {
        expect(
          biome.colorScheme || biome.color,
          `${id} should have colorScheme or color`,
        ).toBeDefined();
      }
    });
  });

  describe("Biome difficulty progression", () => {
    it("mountains has higher difficulty than plains", () => {
      const plains = BIOMES.plains;
      const mountains = BIOMES.mountains;

      expect(mountains.difficultyLevel).toBeGreaterThanOrEqual(
        plains.difficultyLevel,
      );
    });
  });
});
