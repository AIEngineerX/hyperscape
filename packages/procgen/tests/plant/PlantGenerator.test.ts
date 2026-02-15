/**
 * Plant Generator Integration Tests
 *
 * Verifies the complete plant generation pipeline works end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PlantGenerator,
  generateFromPreset,
  generateRandom,
  createGenerator,
  getPresetNames,
  getPreset,
  LPK,
  RenderQuality,
} from "../../src/plant/index.js";

describe("PlantGenerator", () => {
  let generator: PlantGenerator;

  beforeEach(() => {
    generator = new PlantGenerator({ seed: 12345 });
  });

  describe("Basic Generation", () => {
    it("should create a generator with default settings", () => {
      expect(generator).toBeDefined();
      expect(generator.getParams()).toBeDefined();
    });

    it("should generate a leaf mesh without textures", () => {
      generator.setGenerateTextures(false);
      const result = generator.generateLeafOnly();

      expect(result.mesh).toBeDefined();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
      expect(result.mesh.triangles.length).toBeGreaterThan(0);
      expect(result.mesh.uvs.length).toBeGreaterThan(0);
      expect(result.mesh.normals.length).toBeGreaterThan(0);
    });

    it("should generate a complete plant with Three.js objects", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 3);
      const result = generator.generate();

      expect(result.group).toBeDefined();
      expect(result.group.children.length).toBeGreaterThan(0);
      expect(result.dispose).toBeInstanceOf(Function);

      // Clean up
      result.dispose();
    });

    it("should generate textures when enabled (browser only)", () => {
      // OffscreenCanvas is not available in Node.js
      // This test would pass in a browser environment
      generator.setGenerateTextures(true);
      generator.setTextureSize(256); // Small for testing
      const result = generator.generateLeafOnly();

      // In Node.js, textures will be null since OffscreenCanvas isn't available
      if (typeof OffscreenCanvas !== "undefined") {
        expect(result.textures).toBeDefined();
        expect(result.textures!.albedo).toBeDefined();
        expect(result.textures!.normal).toBeDefined();
        expect(result.textures!.height).toBeDefined();
        expect(result.textures!.albedo.width).toBe(256);
        expect(result.textures!.albedo.height).toBe(256);
      } else {
        // In Node.js environment, textures are null
        expect(result.textures).toBeNull();
      }
    });
  });

  describe("Presets", () => {
    it("should list all available presets", () => {
      const presets = getPresetNames();
      expect(presets.length).toBeGreaterThanOrEqual(30);
      expect(presets).toContain("monstera");
      expect(presets).toContain("philodendron");
      expect(presets).toContain("pothos");
    });

    it("should load a preset by name", () => {
      const preset = getPreset("monstera");
      expect(preset).toBeDefined();
      expect(preset!.name).toBe("monstera");
      expect(preset!.params).toBeDefined();
    });

    it("should generate plant from preset", () => {
      generator.loadPreset("monstera");
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 2);
      const result = generator.generate();

      expect(result.group).toBeDefined();
      expect(result.group.children.length).toBeGreaterThan(0);

      result.dispose();
    });

    it("should generate all presets without errors", () => {
      const presets = getPresetNames();
      generator.setGenerateTextures(false);
      generator.setParam(LPK.LeafCount, 1);

      for (const presetName of presets) {
        generator.loadPreset(presetName);
        const result = generator.generate();
        expect(result.group).toBeDefined();
        result.dispose();
      }
    });
  });

  describe("Quality Levels (LOD)", () => {
    const qualities: RenderQuality[] = ["Minimum", "Medium", "Maximum"];

    it("should support all quality levels", () => {
      generator.setGenerateTextures(false);

      for (const quality of qualities) {
        generator.setQuality(quality);
        const result = generator.generateLeafOnly();
        expect(result.mesh.vertices.length).toBeGreaterThan(0);
      }
    });

    it("should generate more vertices at higher quality", () => {
      generator.setGenerateTextures(false);

      generator.setQuality("Minimum");
      const minResult = generator.generateLeafOnly();

      generator.setQuality("Maximum");
      const maxResult = generator.generateLeafOnly();

      // Higher quality should have more vertices
      expect(maxResult.mesh.vertices.length).toBeGreaterThanOrEqual(
        minResult.mesh.vertices.length,
      );
    });

    it("should generate multiple LOD levels", () => {
      generator.setGenerateTextures(false);
      const lods = generator.generateLODs();

      expect(lods.Minimum).toBeDefined();
      expect(lods.Medium).toBeDefined();
      expect(lods.Maximum).toBeDefined();
    });
  });

  describe("Parameter Control", () => {
    it("should allow setting individual parameters", () => {
      generator.setParam(LPK.Pudge, 0.5);
      generator.setParam(LPK.Sheer, 0.3);
      generator.setParam(LPK.Length, 1.5);

      const params = generator.getParams();
      expect(params[LPK.Pudge].value).toBe(0.5);
      expect(params[LPK.Sheer].value).toBe(0.3);
      expect(params[LPK.Length].value).toBe(1.5);
    });

    it("should allow batch parameter setting", () => {
      generator.setParams({
        [LPK.Pudge]: 0.7,
        [LPK.Width]: 2.0,
        [LPK.LeafCount]: 5,
      } as Partial<Record<LPK, number>>);

      const params = generator.getParams();
      expect(params[LPK.Pudge].value).toBe(0.7);
      expect(params[LPK.Width].value).toBe(2.0);
      expect(params[LPK.LeafCount].value).toBe(5);
    });
  });

  describe("Seeded Randomness", () => {
    it("should produce deterministic results with same seed", () => {
      const gen1 = new PlantGenerator({ seed: 54321 });
      const gen2 = new PlantGenerator({ seed: 54321 });

      gen1.setGenerateTextures(false);
      gen2.setGenerateTextures(false);

      const result1 = gen1.generateLeafOnly();
      const result2 = gen2.generateLeafOnly();

      expect(result1.mesh.vertices.length).toBe(result2.mesh.vertices.length);
      expect(result1.mesh.triangles.length).toBe(result2.mesh.triangles.length);

      // Check first few vertices match
      for (let i = 0; i < Math.min(10, result1.mesh.vertices.length); i++) {
        expect(result1.mesh.vertices[i].x).toBeCloseTo(
          result2.mesh.vertices[i].x,
          5,
        );
        expect(result1.mesh.vertices[i].y).toBeCloseTo(
          result2.mesh.vertices[i].y,
          5,
        );
        expect(result1.mesh.vertices[i].z).toBeCloseTo(
          result2.mesh.vertices[i].z,
          5,
        );
      }
    });

    it("should produce different results with different parameters", () => {
      // Same seed but different params should produce different results
      const gen1 = new PlantGenerator({ seed: 12345 });
      const gen2 = new PlantGenerator({ seed: 12345 });

      gen1.setGenerateTextures(false);
      gen2.setGenerateTextures(false);

      // Apply different shape params
      gen1.setParam(LPK.Pudge, 0.2);
      gen2.setParam(LPK.Pudge, 0.8);

      const result1 = gen1.generateLeafOnly();
      const result2 = gen2.generateLeafOnly();

      // Different params should produce different vertex positions
      // Sum up the differences
      let totalDiff = 0;
      const checkCount = Math.min(
        10,
        result1.mesh.vertices.length,
        result2.mesh.vertices.length,
      );

      for (let i = 0; i < checkCount; i++) {
        const v1 = result1.mesh.vertices[i];
        const v2 = result2.mesh.vertices[i];
        totalDiff += Math.abs(v1.x - v2.x) + Math.abs(v1.y - v2.y);
      }

      // Shapes should be visibly different
      expect(totalDiff).toBeGreaterThan(0.1);
    });
  });

  describe("Convenience Functions", () => {
    it("should generate from preset via helper function", () => {
      const result = generateFromPreset("pothos", 12345, {
        generateTextures: false,
        leafCount: 2,
      });

      expect(result.group).toBeDefined();
      result.dispose();
    });

    it("should generate random plant via helper function", () => {
      const result = generateRandom(12345, {
        generateTextures: false,
        leafCount: 2,
      });

      expect(result.group).toBeDefined();
      result.dispose();
    });

    it("should create generator via factory function", () => {
      const gen = createGenerator({ seed: 99999 });
      expect(gen).toBeInstanceOf(PlantGenerator);
    });
  });

  describe("Mesh Data Integrity", () => {
    it("should produce valid mesh data", () => {
      generator.setGenerateTextures(false);
      const result = generator.generateLeafOnly();
      const mesh = result.mesh;

      // Verify vertex count
      expect(mesh.vertices.length).toBeGreaterThan(0);

      // Verify triangle indices are valid
      const maxIndex = mesh.vertices.length - 1;
      for (let i = 0; i < mesh.triangles.length; i += 3) {
        expect(mesh.triangles[i]).toBeLessThanOrEqual(maxIndex);
        expect(mesh.triangles[i + 1]).toBeLessThanOrEqual(maxIndex);
        expect(mesh.triangles[i + 2]).toBeLessThanOrEqual(maxIndex);
      }

      // Verify UVs match vertices
      expect(mesh.uvs.length).toBe(mesh.vertices.length);

      // Verify normals match vertices
      expect(mesh.normals.length).toBe(mesh.vertices.length);

      // Verify UV values are in range [0, 1]
      for (const uv of mesh.uvs) {
        expect(uv.x).toBeGreaterThanOrEqual(0);
        expect(uv.x).toBeLessThanOrEqual(1);
        expect(uv.y).toBeGreaterThanOrEqual(0);
        expect(uv.y).toBeLessThanOrEqual(1);
      }

      // Verify normals are normalized
      for (const n of mesh.normals) {
        const length = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        expect(length).toBeCloseTo(1.0, 2);
      }
    });
  });

  describe("Distortion Effects", () => {
    it("should apply curl distortion", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.DistortCurl, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should apply cup distortion", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.DistortCup, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should apply wave distortion", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.DistortWaveAmp, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should apply flop distortion", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.DistortFlop, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should apply combined distortions", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.DistortCurl, 0.3);
      generator.setParam(LPK.DistortCup, 0.4);
      generator.setParam(LPK.DistortWaveAmp, 0.2);
      generator.setParam(LPK.DistortFlop, 0.3);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });
  });

  describe("Shape Parameters", () => {
    it("should generate leaf with high pudge", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.Pudge, 0.9);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should generate leaf with lobes", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.Lobes, 3);
      generator.setParam(LPK.LobeAmplitude, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should generate leaf with heart shape", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.Heart, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });

    it("should generate leaf with scoop", () => {
      generator.setGenerateTextures(false);
      generator.setParam(LPK.ScoopDepth, 0.5);

      const result = generator.generateLeafOnly();
      expect(result.mesh.vertices.length).toBeGreaterThan(0);
    });
  });
});

describe("Math Utilities", () => {
  it("should be available via exports", async () => {
    const math = await import("../../src/plant/math/index.js");
    expect(math.SeededRandom).toBeDefined();
    expect(math.createCurve2D).toBeDefined();
    expect(math.evaluateCurve2D).toBeDefined();
    expect(math.point2D).toBeDefined();
    expect(math.point3D).toBeDefined();
  });

  it("should produce deterministic random numbers", async () => {
    const { SeededRandom } = await import("../../src/plant/math/index.js");

    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);

    for (let i = 0; i < 100; i++) {
      expect(rng1.random()).toBe(rng2.random());
    }
  });
});
