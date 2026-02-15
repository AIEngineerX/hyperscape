/**
 * RockGenerator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RockGenerator,
  defaultGenerator,
  DEFAULT_PARAMS,
  SHAPE_PRESETS,
  ROCK_TYPE_PRESETS,
  listPresets,
  getPreset,
  mergeParams,
} from "../../src/rock/index.js";

describe("RockGenerator", () => {
  let generator: RockGenerator;

  beforeEach(() => {
    generator = new RockGenerator();
  });

  afterEach(() => {
    generator.dispose();
  });

  describe("generate", () => {
    it("generates a rock with default parameters", () => {
      const result = generator.generate(DEFAULT_PARAMS, "test-seed");

      expect(result).toBeDefined();
      expect(result.mesh).toBeDefined();
      expect(result.stats.vertices).toBeGreaterThan(0);
      expect(result.stats.triangles).toBeGreaterThan(0);
      expect(result.stats.generationTime).toBeGreaterThan(0);
      expect(result.params).toEqual(DEFAULT_PARAMS);
      expect(result.seed).toBe("test-seed");
    });

    it("produces consistent results with same seed", () => {
      const result1 = generator.generate(DEFAULT_PARAMS, "consistent-seed");
      const result2 = generator.generate(DEFAULT_PARAMS, "consistent-seed");

      // Stats should be identical
      expect(result1.stats.vertices).toBe(result2.stats.vertices);
      expect(result1.stats.triangles).toBe(result2.stats.triangles);
      expect(result1.stats.uniqueVertices).toBe(result2.stats.uniqueVertices);
    });

    it("produces different results with different seeds", () => {
      const result1 = generator.generate(DEFAULT_PARAMS, "seed-1");
      const result2 = generator.generate(DEFAULT_PARAMS, "seed-2");

      // Both should generate valid rocks
      expect(result1.stats.vertices).toBeGreaterThan(0);
      expect(result2.stats.vertices).toBeGreaterThan(0);
    });

    it("applies flat shading correctly", () => {
      const flatParams = { ...DEFAULT_PARAMS, flatShading: true };
      const result = generator.generate(flatParams, "flat-test");

      expect(result.mesh.material).toBeDefined();
    });

    it("respects subdivision level", () => {
      const lowRes = { ...DEFAULT_PARAMS, subdivisions: 2 };
      const highRes = { ...DEFAULT_PARAMS, subdivisions: 5 };

      const lowResult = generator.generate(lowRes, "low-res");
      const highResult = generator.generate(highRes, "high-res");

      expect(highResult.stats.vertices).toBeGreaterThan(
        lowResult.stats.vertices,
      );
    });
  });

  describe("generateFromPreset", () => {
    it("generates boulder preset", () => {
      const result = generator.generateFromPreset("boulder", {
        seed: "boulder-test",
      });

      expect(result).not.toBeNull();
      expect(result!.mesh).toBeDefined();
      expect(result!.stats.vertices).toBeGreaterThan(0);
    });

    it("generates pebble preset", () => {
      const result = generator.generateFromPreset("pebble", {
        seed: "pebble-test",
      });

      expect(result).not.toBeNull();
      expect(result!.mesh).toBeDefined();
    });

    it("generates crystal preset", () => {
      const result = generator.generateFromPreset("crystal", {
        seed: "crystal-test",
      });

      expect(result).not.toBeNull();
      // Crystal uses flat shading
      expect(result!.params.flatShading).toBe(true);
    });

    it("generates asteroid preset", () => {
      const result = generator.generateFromPreset("asteroid", {
        seed: "asteroid-test",
      });

      expect(result).not.toBeNull();
    });

    it("generates cliff preset", () => {
      const result = generator.generateFromPreset("cliff", {
        seed: "cliff-test",
      });

      expect(result).not.toBeNull();
    });

    it("generates lowpoly preset", () => {
      const result = generator.generateFromPreset("lowpoly", {
        seed: "lowpoly-test",
      });

      expect(result).not.toBeNull();
      expect(result!.params.flatShading).toBe(true);
      expect(result!.params.subdivisions).toBe(1);
    });

    it("generates all rock type presets", () => {
      const rockTypes = [
        "sandstone",
        "limestone",
        "granite",
        "marble",
        "basalt",
        "slate",
        "obsidian",
        "quartzite",
      ];

      for (const type of rockTypes) {
        const result = generator.generateFromPreset(type, {
          seed: `${type}-test`,
        });
        expect(result).not.toBeNull();
        expect(result!.stats.vertices).toBeGreaterThan(0);
      }
    });

    it("returns null for unknown preset", () => {
      const result = generator.generateFromPreset("unknown-preset");

      expect(result).toBeNull();
    });

    it("allows param overrides with preset", () => {
      const result = generator.generateFromPreset("boulder", {
        seed: "override-test",
        params: { subdivisions: 3 },
      });

      expect(result).not.toBeNull();
      expect(result!.params.subdivisions).toBe(3);
    });
  });

  describe("generateCustom", () => {
    it("generates with custom noise parameters", () => {
      const result = generator.generateCustom({
        noise: {
          scale: 3.0,
          amplitude: 0.5,
          octaves: 3,
        },
      });

      expect(result).toBeDefined();
      expect(result.params.noise.scale).toBe(3.0);
      expect(result.params.noise.amplitude).toBe(0.5);
      expect(result.params.noise.octaves).toBe(3);
    });

    it("generates with custom colors", () => {
      const result = generator.generateCustom({
        colors: {
          baseColor: "#ff0000",
          secondaryColor: "#00ff00",
          accentColor: "#0000ff",
        },
      });

      expect(result).toBeDefined();
      expect(result.params.colors.baseColor).toBe("#ff0000");
    });

    it("generates with custom scale", () => {
      const result = generator.generateCustom({
        scale: { x: 2.0, y: 0.5, z: 1.5 },
      });

      expect(result).toBeDefined();
      expect(result.params.scale.x).toBe(2.0);
      expect(result.params.scale.y).toBe(0.5);
      expect(result.params.scale.z).toBe(1.5);
    });
  });
});

describe("defaultGenerator", () => {
  it("is a RockGenerator instance", () => {
    expect(defaultGenerator).toBeInstanceOf(RockGenerator);
  });

  it("can generate rocks", () => {
    const result = defaultGenerator.generateFromPreset("boulder", {
      seed: "default-test",
    });
    expect(result).not.toBeNull();
  });
});

describe("Presets", () => {
  describe("listPresets", () => {
    it("returns array of preset names", () => {
      const presets = listPresets();

      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets).toContain("boulder");
      expect(presets).toContain("granite");
    });
  });

  describe("getPreset", () => {
    it("returns preset for valid name", () => {
      const preset = getPreset("boulder");

      expect(preset).not.toBeNull();
      expect(preset!.scale).toBeDefined();
    });

    it("uses lowercase keys", () => {
      const preset = getPreset("boulder");

      // Keys are lowercase
      expect(preset).not.toBeNull();
      expect(preset!.baseShape).toBe("icosahedron");
    });

    it("returns null for invalid name", () => {
      const preset = getPreset("nonexistent");

      expect(preset).toBeNull();
    });
  });

  describe("mergeParams", () => {
    it("merges partial params into base", () => {
      const partial = { subdivisions: 3, flatShading: true };
      const merged = mergeParams(DEFAULT_PARAMS, partial);

      expect(merged.subdivisions).toBe(3);
      expect(merged.flatShading).toBe(true);
      expect(merged.baseShape).toBe(DEFAULT_PARAMS.baseShape);
    });

    it("deep merges nested objects", () => {
      const partial = { noise: { scale: 5.0 } };
      const merged = mergeParams(DEFAULT_PARAMS, partial);

      expect(merged.noise.scale).toBe(5.0);
      expect(merged.noise.amplitude).toBe(DEFAULT_PARAMS.noise.amplitude);
    });
  });
});

describe("SHAPE_PRESETS", () => {
  it("contains all expected shape presets", () => {
    const expectedShapes = [
      "boulder",
      "pebble",
      "crystal",
      "asteroid",
      "cliff",
      "lowpoly",
    ];

    for (const shape of expectedShapes) {
      expect(SHAPE_PRESETS[shape]).toBeDefined();
    }
  });
});

describe("ROCK_TYPE_PRESETS", () => {
  it("contains all expected rock type presets", () => {
    const expectedTypes = [
      "sandstone",
      "limestone",
      "granite",
      "marble",
      "basalt",
      "slate",
      "obsidian",
      "quartzite",
    ];

    for (const type of expectedTypes) {
      expect(ROCK_TYPE_PRESETS[type]).toBeDefined();
    }
  });
});
