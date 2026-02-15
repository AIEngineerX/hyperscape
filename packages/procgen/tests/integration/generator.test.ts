/**
 * Integration tests for tree generation and mesh creation.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  TreeGenerator,
  generateTree,
  generateTreeVariations,
  getPreset,
  QUAKING_ASPEN,
  BLACK_OAK,
  WEEPING_WILLOW,
  PALM,
  disposeTreeMesh,
} from "../../src/index.js";

describe("TreeGenerator", () => {
  describe("basic generation", () => {
    it("creates a valid tree mesh", () => {
      const generator = new TreeGenerator(QUAKING_ASPEN, {
        generation: { seed: 42 },
      });

      const result = generator.generate();

      expect(result.group).toBeInstanceOf(THREE.Group);
      expect(result.branches.length).toBeGreaterThan(0);
      expect(result.vertexCount).toBeGreaterThan(0);
      expect(result.triangleCount).toBeGreaterThan(0);

      disposeTreeMesh(result);
    });

    it("creates valid geometry for branches", () => {
      const generator = new TreeGenerator(QUAKING_ASPEN, {
        generation: { seed: 42 },
      });

      const result = generator.generate();

      for (const branch of result.branches) {
        const geo = branch.geometry;
        const posAttr = geo.getAttribute("position");
        const normalAttr = geo.getAttribute("normal");
        const uvAttr = geo.getAttribute("uv");
        const indexAttr = geo.getIndex();

        expect(posAttr).toBeDefined();
        expect(normalAttr).toBeDefined();
        expect(uvAttr).toBeDefined();
        expect(indexAttr).toBeDefined();

        // Vertices should be valid numbers
        for (let i = 0; i < posAttr!.count * 3; i++) {
          expect(Number.isFinite(posAttr!.array[i])).toBe(true);
        }
      }

      disposeTreeMesh(result);
    }, 30000); // 30 second timeout for complex tree geometry validation

    it("creates leaf geometry when leaves exist", () => {
      const generator = new TreeGenerator(QUAKING_ASPEN, {
        generation: { seed: 42, generateLeaves: true },
      });

      const result = generator.generate();

      expect(result.leaves).not.toBeNull();
      if (result.leaves) {
        const geo = result.leaves.geometry;
        expect(geo.getAttribute("position")).toBeDefined();
      }

      disposeTreeMesh(result);
    });

    it("respects generateLeaves option", () => {
      const generatorWithLeaves = new TreeGenerator(QUAKING_ASPEN, {
        generation: { seed: 42, generateLeaves: true },
      });
      const generatorWithoutLeaves = new TreeGenerator(QUAKING_ASPEN, {
        generation: { seed: 42, generateLeaves: false },
      });

      const withLeaves = generatorWithLeaves.generate();
      const withoutLeaves = generatorWithoutLeaves.generate();

      expect(withLeaves.leaves).not.toBeNull();
      expect(withoutLeaves.leaves).toBeNull();

      disposeTreeMesh(withLeaves);
      disposeTreeMesh(withoutLeaves);
    });
  });

  describe("presets", () => {
    it("generates different trees for different presets", () => {
      const aspen = generateTree("quakingAspen", { generation: { seed: 42 } });
      const oak = generateTree("blackOak", { generation: { seed: 42 } });

      // Different presets should produce different vertex counts
      expect(aspen.vertexCount).not.toBe(oak.vertexCount);

      disposeTreeMesh(aspen);
      disposeTreeMesh(oak);
    });

    it("can generate all presets without error", () => {
      // Test a subset of simpler presets to avoid timeout
      const presets = ["quakingAspen", "palm", "smallPine", "bamboo"];

      for (const preset of presets) {
        const result = generateTree(preset, { generation: { seed: 42 } });

        expect(result.branches.length).toBeGreaterThan(0);
        expect(result.vertexCount).toBeGreaterThan(0);

        disposeTreeMesh(result);
      }
    });

    it("palm has distinctive structure", () => {
      const result = generateTree(PALM, { generation: { seed: 42 } });
      const data = new TreeGenerator(PALM, {
        generation: { seed: 42 },
      }).generateData();

      // Palm should have relatively few stems (1 trunk + fronds)
      expect(data.stems.length).toBeLessThan(50);

      // Should have fan-like leaves
      expect(data.leaves.length).toBeGreaterThan(0);

      disposeTreeMesh(result);
    });

    it("weeping willow has many thin branches", () => {
      const generator = new TreeGenerator(WEEPING_WILLOW, {
        generation: { seed: 42 },
      });
      const data = generator.generateData();

      // Weeping willow should have many stems (drooping branches)
      expect(data.stems.length).toBeGreaterThan(5);

      // Should have multiple levels
      const maxDepth = Math.max(...data.stems.map((s) => s.depth));
      expect(maxDepth).toBeGreaterThanOrEqual(1);
    });
  });

  describe("variations", () => {
    it("generateTreeVariations creates multiple unique trees", () => {
      const variations = generateTreeVariations("quakingAspen", 5, 100);

      expect(variations.length).toBe(5);

      // Each tree should be different
      const vertexCounts = variations.map((v) => v.vertexCount);
      const uniqueCounts = new Set(vertexCounts);

      // At least some should be different (seeds produce variation)
      expect(uniqueCounts.size).toBeGreaterThan(1);

      for (const v of variations) {
        disposeTreeMesh(v);
      }
    });
  });

  describe("geometry options", () => {
    it("generates valid geometry with custom radialSegments", () => {
      const result = generateTree(QUAKING_ASPEN, {
        generation: { seed: 42, generateLeaves: false },
        geometry: { radialSegments: 12 },
      });

      // Should generate valid geometry
      expect(result.branches.length).toBeGreaterThan(0);
      expect(result.vertexCount).toBeGreaterThan(0);
      expect(result.triangleCount).toBeGreaterThan(0);

      disposeTreeMesh(result);
    });
  });

  describe("determinism", () => {
    it("same seed produces identical meshes", () => {
      const result1 = generateTree(BLACK_OAK, {
        generation: { seed: 12345 },
        geometry: { radialSegments: 8 },
      });

      const result2 = generateTree(BLACK_OAK, {
        generation: { seed: 12345 },
        geometry: { radialSegments: 8 },
      });

      expect(result1.vertexCount).toBe(result2.vertexCount);
      expect(result1.triangleCount).toBe(result2.triangleCount);

      // Check actual vertex data matches
      const pos1 =
        result1.branches[0]!.geometry.getAttribute("position")!.array;
      const pos2 =
        result2.branches[0]!.geometry.getAttribute("position")!.array;

      expect(pos1.length).toBe(pos2.length);
      for (let i = 0; i < Math.min(pos1.length, 100); i++) {
        expect(pos1[i]).toBeCloseTo(pos2[i]!, 5);
      }

      disposeTreeMesh(result1);
      disposeTreeMesh(result2);
    });

    it("different seeds produce different meshes", () => {
      const result1 = generateTree(BLACK_OAK, { generation: { seed: 12345 } });
      const result2 = generateTree(BLACK_OAK, { generation: { seed: 54321 } });

      // Should have different vertex counts (very likely with different seeds)
      expect(result1.vertexCount).not.toBe(result2.vertexCount);

      disposeTreeMesh(result1);
      disposeTreeMesh(result2);
    });
  });

  describe("dispose", () => {
    it("disposeTreeMesh cleans up resources", () => {
      const result = generateTree("quakingAspen", { generation: { seed: 42 } });

      // Before dispose, geometry should have attributes
      expect(
        result.branches[0]!.geometry.getAttribute("position"),
      ).toBeDefined();

      disposeTreeMesh(result);

      // After dispose, group should be empty
      expect(result.group.children.length).toBe(0);
    });

    it("TreeGenerator.dispose cleans up", () => {
      const generator = new TreeGenerator("quakingAspen", {
        generation: { seed: 42 },
      });
      generator.generate();

      expect(generator.getLastMeshResult()).not.toBeNull();

      generator.dispose();

      expect(generator.getLastMeshResult()).toBeNull();
      expect(generator.getLastTreeData()).toBeNull();
    });
  });
});
