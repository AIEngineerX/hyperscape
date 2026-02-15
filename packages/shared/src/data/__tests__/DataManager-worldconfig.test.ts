/**
 * Tests for DataManager world config get/set functionality
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataManager } from "../DataManager";
import type { WorldConfigManifest } from "../../types/world/world-types";

function makeConfig(
  overrides: Partial<WorldConfigManifest> = {},
): WorldConfigManifest {
  return {
    version: 1,
    terrain: {
      tileSize: 100,
      worldSize: 10000,
      maxHeight: 30,
      waterThreshold: 5.4,
    },
    towns: {
      townCount: 25,
      minTownSpacing: 800,
      flatnessSampleRadius: 40,
      flatnessSampleCount: 16,
      waterThreshold: 5.4,
      optimalWaterDistanceMin: 30,
      optimalWaterDistanceMax: 150,
      townSizes: {
        hamlet: {
          minBuildings: 3,
          maxBuildings: 5,
          radius: 25,
          safeZoneRadius: 40,
        },
        village: {
          minBuildings: 6,
          maxBuildings: 10,
          radius: 40,
          safeZoneRadius: 60,
        },
        town: {
          minBuildings: 11,
          maxBuildings: 16,
          radius: 60,
          safeZoneRadius: 80,
        },
      },
      biomeSuitability: {},
    },
    roads: {
      roadWidth: 4,
      pathStepSize: 20,
      maxPathIterations: 10000,
      extraConnectionsRatio: 0.25,
      costBase: 1.0,
      costSlopeMultiplier: 5.0,
      costWaterPenalty: 1000,
      smoothingIterations: 2,
      noiseDisplacementScale: 0.01,
      noiseDisplacementStrength: 3,
      minPointSpacing: 4,
      heuristicWeight: 2.5,
      costBiomeMultipliers: {},
    },
    ...overrides,
  };
}

describe("DataManager WorldConfig", () => {
  let originalConfig: WorldConfigManifest | null = null;

  beforeEach(() => {
    originalConfig = DataManager.getWorldConfig();
  });
  afterEach(() => {
    if (originalConfig) DataManager.setWorldConfig(originalConfig);
  });

  describe("get/set", () => {
    it("returns null-like when cleared", () => {
      DataManager.setWorldConfig(null as unknown as WorldConfigManifest);
      const config = DataManager.getWorldConfig();
      expect(typeof config).toBe("object");
    });

    it("returns config after set", () => {
      DataManager.setWorldConfig(makeConfig());
      const retrieved = DataManager.getWorldConfig();

      expect(retrieved!.version).toBe(1);
      expect(retrieved!.terrain.tileSize).toBe(100);
      expect(retrieved!.towns.townCount).toBe(25);
    });

    it("overwrites previous config", () => {
      DataManager.setWorldConfig(makeConfig({ version: 1 }));
      expect(DataManager.getWorldConfig()!.version).toBe(1);

      DataManager.setWorldConfig(makeConfig({ version: 3 }));
      expect(DataManager.getWorldConfig()!.version).toBe(3);
    });
  });

  describe("value ranges", () => {
    it("accepts zero values", () => {
      DataManager.setWorldConfig(
        makeConfig({
          terrain: {
            tileSize: 100,
            worldSize: 10000,
            maxHeight: 0,
            waterThreshold: 0,
          },
          towns: {
            ...makeConfig().towns,
            townCount: 0,
            minTownSpacing: 0,
          },
          roads: { ...makeConfig().roads, roadWidth: 0 },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.towns.townCount).toBe(0);
      expect(r.terrain.maxHeight).toBe(0);
      expect(r.roads.roadWidth).toBe(0);
    });

    it("accepts large values", () => {
      DataManager.setWorldConfig(
        makeConfig({
          terrain: {
            tileSize: 1000,
            worldSize: 100000,
            maxHeight: 1000,
            waterThreshold: 100,
          },
          towns: { ...makeConfig().towns, townCount: 1000 },
          roads: { ...makeConfig().roads, maxPathIterations: 1000000 },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.towns.townCount).toBe(1000);
      expect(r.terrain.worldSize).toBe(100000);
      expect(r.roads.maxPathIterations).toBe(1000000);
    });

    it("accepts negative values (no validation at storage time)", () => {
      DataManager.setWorldConfig(
        makeConfig({
          terrain: {
            tileSize: -100,
            worldSize: -10000,
            maxHeight: -30,
            waterThreshold: -5.4,
          },
          towns: { ...makeConfig().towns, townCount: -25 },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.towns.townCount).toBe(-25);
      expect(r.terrain.worldSize).toBe(-10000);
    });

    it("accepts decimal values", () => {
      DataManager.setWorldConfig(
        makeConfig({
          terrain: {
            tileSize: 100,
            worldSize: 10000,
            maxHeight: 30.5,
            waterThreshold: 5.45,
          },
          roads: { ...makeConfig().roads, extraConnectionsRatio: 0.333 },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.terrain.maxHeight).toBeCloseTo(30.5, 5);
      expect(r.roads.extraConnectionsRatio).toBeCloseTo(0.333, 5);
    });
  });

  describe("biome configs", () => {
    it("handles minimal biome suitability", () => {
      DataManager.setWorldConfig(
        makeConfig({
          towns: { ...makeConfig().towns, biomeSuitability: { plains: 1.0 } },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.towns.biomeSuitability!.plains).toBe(1.0);
      expect(r.towns.biomeSuitability!.forest).toBeUndefined();
    });

    it("handles custom biome types", () => {
      DataManager.setWorldConfig(
        makeConfig({
          towns: {
            ...makeConfig().towns,
            biomeSuitability: { customBiome: 0.8, extraTerrain: 0.4 },
          },
          roads: {
            ...makeConfig().roads,
            costBiomeMultipliers: { customBiome: 1.5, extraTerrain: 2.0 },
          },
        }),
      );
      const r = DataManager.getWorldConfig()!;

      expect(r.towns.biomeSuitability!.customBiome).toBe(0.8);
      expect(r.roads.costBiomeMultipliers!.customBiome).toBe(1.5);
    });
  });

  describe("immutability", () => {
    it("returns same reference for multiple gets", () => {
      DataManager.setWorldConfig(makeConfig());
      expect(DataManager.getWorldConfig()).toBe(DataManager.getWorldConfig());
    });

    it("modifications to retrieved config affect stored config", () => {
      DataManager.setWorldConfig(makeConfig());
      DataManager.getWorldConfig()!.towns.townCount = 999;
      expect(DataManager.getWorldConfig()!.towns.townCount).toBe(999);
    });
  });
});
