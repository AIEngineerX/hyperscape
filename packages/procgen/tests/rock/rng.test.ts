/**
 * RNG Tests
 */

import { describe, it, expect } from "vitest";
import { createRng } from "../../src/rock/index.js";

describe("createRng", () => {
  describe("next", () => {
    it("returns values in range [0, 1)", () => {
      const rng = createRng("test-seed");

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("is deterministic with same seed", () => {
      const rng1 = createRng("same-seed");
      const rng2 = createRng("same-seed");

      for (let i = 0; i < 10; i++) {
        expect(rng1.next()).toBe(rng2.next());
      }
    });

    it("produces different sequences with different seeds", () => {
      const rng1 = createRng("seed-a");
      const rng2 = createRng("seed-b");

      let allSame = true;
      for (let i = 0; i < 10; i++) {
        if (rng1.next() !== rng2.next()) {
          allSame = false;
          break;
        }
      }

      expect(allSame).toBe(false);
    });

    it("accepts numeric seeds", () => {
      const rng = createRng(12345);
      const value = rng.next();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  describe("int", () => {
    it("returns integers in specified range", () => {
      const rng = createRng("int-test");

      for (let i = 0; i < 100; i++) {
        const value = rng.int(5, 10);
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThanOrEqual(10);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it("handles single value range", () => {
      const rng = createRng("single");
      const value = rng.int(5, 5);

      expect(value).toBe(5);
    });

    it("distributes values across range", () => {
      const rng = createRng("distribution");
      const counts = new Map<number, number>();

      for (let i = 0; i < 1000; i++) {
        const value = rng.int(1, 6);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      // Should hit all values 1-6
      for (let i = 1; i <= 6; i++) {
        expect(counts.get(i)).toBeGreaterThan(0);
      }
    });
  });

  describe("chance", () => {
    it("returns boolean", () => {
      const rng = createRng("chance-test");
      const result = rng.chance(0.5);

      expect(typeof result).toBe("boolean");
    });

    it("respects probability approximately", () => {
      const rng = createRng("probability");
      let trueCount = 0;

      for (let i = 0; i < 1000; i++) {
        if (rng.chance(0.7)) {
          trueCount++;
        }
      }

      // Should be roughly 70% (allow some variance)
      expect(trueCount).toBeGreaterThan(600);
      expect(trueCount).toBeLessThan(800);
    });

    it("always returns false for probability 0", () => {
      const rng = createRng("zero");

      for (let i = 0; i < 10; i++) {
        expect(rng.chance(0)).toBe(false);
      }
    });

    it("almost always returns true for probability 1", () => {
      const rng = createRng("one");
      let allTrue = true;

      for (let i = 0; i < 100; i++) {
        if (!rng.chance(1)) {
          allTrue = false;
          break;
        }
      }

      // Should be true since we're checking < 1 and RNG returns [0, 1)
      expect(allTrue).toBe(true);
    });
  });

  describe("pick", () => {
    it("returns element from array", () => {
      const rng = createRng("pick-test");
      const arr = [1, 2, 3, 4, 5];
      const picked = rng.pick(arr);

      expect(arr).toContain(picked);
    });

    it("returns null for empty array", () => {
      const rng = createRng("empty");
      const result = rng.pick([]);

      expect(result).toBeNull();
    });

    it("picks from all elements over many iterations", () => {
      const rng = createRng("all-elements");
      const arr = ["a", "b", "c", "d", "e"];
      const picked = new Set<string>();

      for (let i = 0; i < 1000; i++) {
        const value = rng.pick(arr);
        if (value) picked.add(value);
      }

      // Should have picked all elements at least once
      expect(picked.size).toBe(arr.length);
    });
  });
});
