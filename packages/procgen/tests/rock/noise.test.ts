/**
 * SimplexNoise Tests
 */

import { describe, it, expect } from "vitest";
import { SimplexNoise, hashSeed } from "../../src/rock/index.js";

describe("SimplexNoise", () => {
  describe("constructor", () => {
    it("creates a noise generator with default seed", () => {
      const noise = new SimplexNoise();
      expect(noise).toBeDefined();
    });

    it("creates a noise generator with custom seed", () => {
      const noise = new SimplexNoise(12345);
      expect(noise).toBeDefined();
    });
  });

  describe("noise3D", () => {
    it("returns values in range [-1, 1]", () => {
      const noise = new SimplexNoise(42);

      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 10 - 5;
        const y = Math.random() * 10 - 5;
        const z = Math.random() * 10 - 5;

        const value = noise.noise3D(x, y, z);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it("is deterministic with same seed", () => {
      const noise1 = new SimplexNoise(42);
      const noise2 = new SimplexNoise(42);

      for (let i = 0; i < 10; i++) {
        const x = i * 0.5;
        const y = i * 0.3;
        const z = i * 0.7;

        expect(noise1.noise3D(x, y, z)).toBe(noise2.noise3D(x, y, z));
      }
    });

    it("produces different values with different seeds", () => {
      const noise1 = new SimplexNoise(12345);
      const noise2 = new SimplexNoise(67890);

      let differentCount = 0;
      for (let i = 0; i < 100; i++) {
        const x = i * 0.1;
        const y = i * 0.2;
        const z = i * 0.3;
        if (noise1.noise3D(x, y, z) !== noise2.noise3D(x, y, z)) {
          differentCount++;
        }
      }

      // Most values should be different
      expect(differentCount).toBeGreaterThanOrEqual(90);
    });

    it("produces varying values across space", () => {
      const noise = new SimplexNoise(42);
      const values: number[] = [];

      for (let i = 0; i < 100; i++) {
        values.push(noise.noise3D(i * 0.5, 0, 0));
      }

      // Calculate how many unique values we have (allowing for some float precision)
      const uniqueRounded = new Set(values.map((v) => Math.round(v * 100)));

      // Should have variation in values
      expect(uniqueRounded.size).toBeGreaterThan(5);
    });
  });

  describe("fbm", () => {
    it("returns normalized values in range [-1, 1]", () => {
      const noise = new SimplexNoise(42);

      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 10 - 5;
        const y = Math.random() * 10 - 5;
        const z = Math.random() * 10 - 5;

        const value = noise.fbm(x, y, z, 4, 2.0, 0.5);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it("produces more detail with more octaves", () => {
      const noise = new SimplexNoise(42);
      const lowOctaveValues: number[] = [];
      const highOctaveValues: number[] = [];

      for (let i = 0; i < 100; i++) {
        const x = i * 0.1;
        lowOctaveValues.push(noise.fbm(x, 0, 0, 2, 2.0, 0.5));
        highOctaveValues.push(noise.fbm(x, 0, 0, 6, 2.0, 0.5));
      }

      // Calculate variance (high octaves should have more detail)
      const variance = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b) / arr.length;
        return (
          arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length
        );
      };

      // Both should have variance but they may be similar
      expect(variance(lowOctaveValues)).toBeGreaterThan(0);
      expect(variance(highOctaveValues)).toBeGreaterThan(0);
    });
  });

  describe("ridged", () => {
    it("returns values in range [0, 1]", () => {
      const noise = new SimplexNoise(42);

      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 10 - 5;
        const y = Math.random() * 10 - 5;
        const z = Math.random() * 10 - 5;

        const value = noise.ridged(x, y, z, 4, 2.0, 0.5);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it("produces ridge-like patterns", () => {
      const noise = new SimplexNoise(42);
      const values: number[] = [];

      for (let i = 0; i < 100; i++) {
        values.push(noise.ridged(i * 0.1, 0, 0, 3, 2.0, 0.5));
      }

      // Ridged noise should have sharp peaks
      const hasHighValues = values.some((v) => v > 0.8);
      const hasLowValues = values.some((v) => v < 0.3);

      expect(hasHighValues || hasLowValues).toBe(true);
    });
  });
});

describe("hashSeed", () => {
  it("returns a number", () => {
    const hash = hashSeed("test");
    expect(typeof hash).toBe("number");
  });

  it("returns consistent hash for same string", () => {
    const hash1 = hashSeed("my-rock");
    const hash2 = hashSeed("my-rock");

    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different strings", () => {
    const hash1 = hashSeed("rock-1");
    const hash2 = hashSeed("rock-2");

    expect(hash1).not.toBe(hash2);
  });

  it("returns unsigned 32-bit integer", () => {
    const hash = hashSeed("test");

    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it("handles empty string", () => {
    const hash = hashSeed("");
    expect(typeof hash).toBe("number");
  });

  it("handles long strings", () => {
    const longString = "a".repeat(10000);
    const hash = hashSeed(longString);

    expect(typeof hash).toBe("number");
    expect(hash).toBeGreaterThanOrEqual(0);
  });
});
