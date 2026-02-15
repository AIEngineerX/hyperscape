/**
 * Tests for Tree generation.
 */

import { describe, it, expect } from "vitest";
import { Tree } from "../../src/core/Tree.js";
import {
  getPreset,
  QUAKING_ASPEN,
  BLACK_OAK,
  PALM,
} from "../../src/params/index.js";
import type { TreeData } from "../../src/types.js";

describe("Tree", () => {
  describe("generation", () => {
    it("generates a tree with stems", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      expect(data.stems.length).toBeGreaterThan(0);
      expect(data.seed).toBe(12345);
    });

    it("generates trunk at depth 0", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      const trunk = data.stems.find((s) => s.depth === 0);
      expect(trunk).toBeDefined();
      expect(trunk!.parentIndex).toBeNull();
    });

    it("generates branches at deeper levels", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      const branches = data.stems.filter((s) => s.depth > 0);
      expect(branches.length).toBeGreaterThan(0);
    });

    it("generates leaves when enabled", () => {
      const tree = new Tree(QUAKING_ASPEN, {
        seed: 12345,
        generateLeaves: true,
      });
      const data = tree.generate();

      expect(data.leaves.length).toBeGreaterThan(0);
    });

    it("does not generate leaves when disabled", () => {
      const tree = new Tree(QUAKING_ASPEN, {
        seed: 12345,
        generateLeaves: false,
      });
      const data = tree.generate();

      expect(data.leaves.length).toBe(0);
    });

    it("stems have valid points", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      for (const stem of data.stems) {
        expect(stem.points.length).toBeGreaterThanOrEqual(2);
        for (const point of stem.points) {
          expect(point.position).toBeDefined();
          expect(point.handleLeft).toBeDefined();
          expect(point.handleRight).toBeDefined();
          expect(point.radius).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("child stems reference valid parents", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      for (const stem of data.stems) {
        if (stem.parentIndex !== null) {
          expect(stem.parentIndex).toBeGreaterThanOrEqual(0);
          expect(stem.parentIndex).toBeLessThan(data.stems.length);
        }
      }
    });
  });

  describe("determinism", () => {
    it("produces identical output for same seed", () => {
      const tree1 = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const tree2 = new Tree(QUAKING_ASPEN, { seed: 12345 });

      const data1 = tree1.generate();
      const data2 = tree2.generate();

      expect(data1.stems.length).toBe(data2.stems.length);
      expect(data1.leaves.length).toBe(data2.leaves.length);
      expect(data1.treeScale).toBe(data2.treeScale);

      // Check first few stem positions match
      for (let i = 0; i < Math.min(5, data1.stems.length); i++) {
        const stem1 = data1.stems[i]!;
        const stem2 = data2.stems[i]!;

        expect(stem1.points.length).toBe(stem2.points.length);
        expect(stem1.depth).toBe(stem2.depth);
        expect(stem1.length).toBeCloseTo(stem2.length, 5);

        const p1 = stem1.points[0]!;
        const p2 = stem2.points[0]!;
        expect(p1.position.x).toBeCloseTo(p2.position.x, 5);
        expect(p1.position.y).toBeCloseTo(p2.position.y, 5);
        expect(p1.position.z).toBeCloseTo(p2.position.z, 5);
      }
    });

    it("produces different output for different seeds", () => {
      const tree1 = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const tree2 = new Tree(QUAKING_ASPEN, { seed: 54321 });

      const data1 = tree1.generate();
      const data2 = tree2.generate();

      // Should produce different number of stems or different positions
      // (technically could be the same by chance, but very unlikely)
      const stem1 = data1.stems[0]!;
      const stem2 = data2.stems[0]!;

      const sameLength = Math.abs(stem1.length - stem2.length) < 0.001;
      const sameRadius = Math.abs(stem1.radius - stem2.radius) < 0.001;

      expect(sameLength && sameRadius).toBe(false);
    });
  });

  describe("presets", () => {
    it("generates valid tree for each preset", () => {
      const presets = [
        "quakingAspen",
        "blackOak",
        "palm",
        "balsamFir",
        "weepingWillow",
      ];

      for (const presetName of presets) {
        const params = getPreset(presetName);
        const tree = new Tree(params, { seed: 42 });
        const data = tree.generate();

        expect(data.stems.length).toBeGreaterThan(0);
        expect(data.stems[0]!.depth).toBe(0); // Has trunk
      }
    });

    it("palm generates 2-level tree", () => {
      const tree = new Tree(PALM, { seed: 42 });
      const data = tree.generate();

      const maxDepth = Math.max(...data.stems.map((s) => s.depth));
      expect(maxDepth).toBeLessThanOrEqual(1); // depth 0 and 1
    });

    it("black oak generates 3-level tree", () => {
      const tree = new Tree(BLACK_OAK, { seed: 42 });
      const data = tree.generate();

      const maxDepth = Math.max(...data.stems.map((s) => s.depth));
      expect(maxDepth).toBe(2); // depth 0, 1, and 2
    });
  });

  describe("structure", () => {
    it("trunk starts near origin", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      const trunk = data.stems.find((s) => s.depth === 0)!;
      const firstPoint = trunk.points[0]!;

      // Trunk should start near z=0
      expect(firstPoint.position.z).toBeCloseTo(0, 1);
    });

    it("trunk grows upward (positive z)", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      const trunk = data.stems.find((s) => s.depth === 0)!;
      const firstPoint = trunk.points[0]!;
      const lastPoint = trunk.points[trunk.points.length - 1]!;

      expect(lastPoint.position.z).toBeGreaterThan(firstPoint.position.z);
    });

    it("radius decreases along trunk", () => {
      const tree = new Tree(QUAKING_ASPEN, { seed: 12345 });
      const data = tree.generate();

      const trunk = data.stems.find((s) => s.depth === 0)!;
      const firstRadius = trunk.points[0]!.radius;
      const lastRadius = trunk.points[trunk.points.length - 1]!.radius;

      // Trunk should taper (get narrower toward top)
      expect(lastRadius).toBeLessThan(firstRadius);
    });
  });
});
