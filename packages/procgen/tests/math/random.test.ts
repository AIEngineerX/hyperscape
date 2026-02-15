/**
 * Tests for the SeededRandom class.
 *
 * These tests verify that:
 * 1. The RNG produces deterministic output for the same seed
 * 2. Different seeds produce different sequences
 * 3. State can be saved and restored
 */

import { describe, it, expect } from "vitest";
import { SeededRandom, randInRange } from "../../src/math/Random.js";

describe("SeededRandom", () => {
  describe("determinism", () => {
    it("produces the same sequence for the same seed", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      const values1: number[] = [];
      const values2: number[] = [];

      for (let i = 0; i < 100; i++) {
        values1.push(rng1.random());
        values2.push(rng2.random());
      }

      expect(values1).toEqual(values2);
    });

    it("produces different sequences for different seeds", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(54321);

      const values1: number[] = [];
      const values2: number[] = [];

      for (let i = 0; i < 10; i++) {
        values1.push(rng1.random());
        values2.push(rng2.random());
      }

      expect(values1).not.toEqual(values2);
    });

    it("produces values in [0, 1) range", () => {
      const rng = new SeededRandom(42);

      for (let i = 0; i < 1000; i++) {
        const val = rng.random();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe("uniform", () => {
    it("produces values in [a, b) range", () => {
      const rng = new SeededRandom(42);

      for (let i = 0; i < 100; i++) {
        const val = rng.uniform(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThan(10);
      }
    });

    it("is deterministic", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      for (let i = 0; i < 50; i++) {
        expect(rng1.uniform(-100, 100)).toBe(rng2.uniform(-100, 100));
      }
    });
  });

  describe("randint", () => {
    it("produces integers in [a, b] range", () => {
      const rng = new SeededRandom(42);

      for (let i = 0; i < 100; i++) {
        const val = rng.randint(0, 10);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(10);
      }
    });
  });

  describe("state management", () => {
    it("can save and restore state", () => {
      const rng = new SeededRandom(12345);

      // Generate some values
      for (let i = 0; i < 50; i++) {
        rng.random();
      }

      // Save state
      const state = rng.getState();

      // Generate more values
      const values1: number[] = [];
      for (let i = 0; i < 10; i++) {
        values1.push(rng.random());
      }

      // Restore state
      rng.setState(state);

      // Generate same values again
      const values2: number[] = [];
      for (let i = 0; i < 10; i++) {
        values2.push(rng.random());
      }

      expect(values1).toEqual(values2);
    });

    it("clone produces same sequence", () => {
      const rng1 = new SeededRandom(12345);

      // Advance the state
      for (let i = 0; i < 50; i++) {
        rng1.random();
      }

      // Clone
      const rng2 = rng1.clone();

      // Both should produce same sequence
      for (let i = 0; i < 20; i++) {
        expect(rng1.random()).toBe(rng2.random());
      }
    });
  });

  describe("seed method", () => {
    it("resets the state", () => {
      const rng = new SeededRandom(12345);

      const firstValue = rng.random();

      // Generate more values
      for (let i = 0; i < 100; i++) {
        rng.random();
      }

      // Reset with same seed
      rng.seed(12345);

      // Should get same first value
      expect(rng.random()).toBe(firstValue);
    });
  });
});

describe("randInRange", () => {
  it("produces values in [lower, upper) range", () => {
    const rng = new SeededRandom(42);

    for (let i = 0; i < 100; i++) {
      const val = randInRange(rng, 10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThan(20);
    }
  });
});
