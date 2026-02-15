/**
 * SIMD Math Tests
 *
 * Tests for WASM SIMD-accelerated math operations and JS fallbacks.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  simdAvailable,
  initSIMD,
  quadform6SIMD,
  batchQuadform6,
  add6x6InplaceSIMD,
} from "../src/optimized/simd/simd-math";
import { quadraticForm6 } from "../src/optimized/math";

describe("SIMD Math", () => {
  describe("availability detection", () => {
    it("simdAvailable returns a boolean", () => {
      const result = simdAvailable();
      expect(typeof result).toBe("boolean");
    });

    it("initSIMD returns a boolean", async () => {
      const result = await initSIMD();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("quadform6SIMD (JS fallback)", () => {
    it("computes quadratic form for identity matrix", () => {
      // Identity matrix 6x6
      const matrix = new Float64Array(36);
      for (let i = 0; i < 6; i++) {
        matrix[i * 6 + i] = 1;
      }

      // Test vector
      const vector = new Float64Array([1, 2, 3, 4, 5, 6]);

      // v^T * I * v = v^T * v = sum of squares
      const result = quadform6SIMD(matrix, 0, vector, 0);
      const expected = 1 + 4 + 9 + 16 + 25 + 36; // 91
      expect(result).toBeCloseTo(expected, 10);
    });

    it("computes quadratic form for scaled identity", () => {
      // 2 * I matrix
      const matrix = new Float64Array(36);
      for (let i = 0; i < 6; i++) {
        matrix[i * 6 + i] = 2;
      }

      const vector = new Float64Array([1, 1, 1, 1, 1, 1]);

      // v^T * (2I) * v = 2 * 6 = 12
      const result = quadform6SIMD(matrix, 0, vector, 0);
      expect(result).toBeCloseTo(12, 10);
    });

    it("computes quadratic form for general symmetric matrix", () => {
      // Create a symmetric positive definite matrix
      const matrix = new Float64Array([
        4, 2, 0, 0, 0, 0, 2, 5, 1, 0, 0, 0, 0, 1, 6, 2, 0, 0, 0, 0, 2, 7, 1, 0,
        0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 2, 9,
      ]);

      const vector = new Float64Array([1, 0, 0, 0, 0, 0]);

      // v^T * M * v = M[0,0] = 4
      const result = quadform6SIMD(matrix, 0, vector, 0);
      expect(result).toBeCloseTo(4, 10);
    });

    it("handles offsets correctly", () => {
      // Two matrices concatenated
      const matrices = new Float64Array(72);
      // First matrix: zeros
      // Second matrix: identity
      for (let i = 0; i < 6; i++) {
        matrices[36 + i * 6 + i] = 1;
      }

      const vectors = new Float64Array(12);
      // First vector: [1,1,1,1,1,1]
      vectors[0] = 1;
      vectors[1] = 1;
      vectors[2] = 1;
      vectors[3] = 1;
      vectors[4] = 1;
      vectors[5] = 1;
      // Second vector: [2,0,0,0,0,0]
      vectors[6] = 2;

      // Test first matrix (zeros) with first vector
      expect(quadform6SIMD(matrices, 0, vectors, 0)).toBeCloseTo(0, 10);

      // Test second matrix (identity) with second vector
      expect(quadform6SIMD(matrices, 36, vectors, 6)).toBeCloseTo(4, 10);
    });

    it("matches reference quadraticForm6 implementation", () => {
      // Random-ish symmetric matrix
      const matrix = new Float64Array([
        5, 1, 0, 0, 0, 0, 1, 4, 1, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 1, 4, 1, 0,
        0, 0, 0, 1, 5, 1, 0, 0, 0, 0, 1, 6,
      ]);

      const vector = new Float64Array([1, 2, 3, 4, 5, 6]);

      const simdResult = quadform6SIMD(matrix, 0, vector, 0);
      // Note: quadraticForm6 has different parameter order: (v, vOffset, m, mOffset)
      const refResult = quadraticForm6(vector, 0, matrix, 0);

      expect(simdResult).toBeCloseTo(refResult, 10);
    });

    it("handles zero vector", () => {
      const matrix = new Float64Array(36).fill(1);
      const vector = new Float64Array(6).fill(0);

      const result = quadform6SIMD(matrix, 0, vector, 0);
      expect(result).toBeCloseTo(0, 10);
    });

    it("handles negative values", () => {
      const matrix = new Float64Array(36);
      matrix[0] = -1; // Negative diagonal
      for (let i = 1; i < 6; i++) {
        matrix[i * 6 + i] = 1;
      }

      const vector = new Float64Array([1, 1, 1, 1, 1, 1]);

      // v^T * M * v = -1 + 1 + 1 + 1 + 1 + 1 = 4
      const result = quadform6SIMD(matrix, 0, vector, 0);
      expect(result).toBeCloseTo(4, 10);
    });
  });

  describe("batchQuadform6", () => {
    it("computes batch of quadratic forms correctly", () => {
      const count = 3;

      // 3 identity matrices
      const metrics = new Float64Array(count * 36);
      for (let k = 0; k < count; k++) {
        for (let i = 0; i < 6; i++) {
          metrics[k * 36 + i * 6 + i] = 1;
        }
      }

      // 3 vectors: [1,0,0,0,0,0], [0,2,0,0,0,0], [0,0,3,0,0,0]
      const vectors = new Float64Array(count * 6);
      vectors[0] = 1;
      vectors[6 + 1] = 2;
      vectors[12 + 2] = 3;

      const costs = new Float64Array(count);
      batchQuadform6(metrics, vectors, costs, count);

      expect(costs[0]).toBeCloseTo(1, 10); // 1^2
      expect(costs[1]).toBeCloseTo(4, 10); // 2^2
      expect(costs[2]).toBeCloseTo(9, 10); // 3^2
    });

    it("handles single item batch", () => {
      const metrics = new Float64Array(36);
      for (let i = 0; i < 6; i++) {
        metrics[i * 6 + i] = 2;
      }

      const vectors = new Float64Array([1, 1, 1, 1, 1, 1]);
      const costs = new Float64Array(1);

      batchQuadform6(metrics, vectors, costs, 1);

      // 2 * 6 = 12
      expect(costs[0]).toBeCloseTo(12, 10);
    });

    it("handles empty batch", () => {
      const metrics = new Float64Array(0);
      const vectors = new Float64Array(0);
      const costs = new Float64Array(0);

      // Should not throw
      expect(() => batchQuadform6(metrics, vectors, costs, 0)).not.toThrow();
    });

    it("matches sequential quadform6SIMD calls", () => {
      const count = 5;

      // Create varied matrices
      const metrics = new Float64Array(count * 36);
      for (let k = 0; k < count; k++) {
        for (let i = 0; i < 6; i++) {
          metrics[k * 36 + i * 6 + i] = k + 1; // Scale by k+1
        }
      }

      // Create varied vectors
      const vectors = new Float64Array(count * 6);
      for (let k = 0; k < count; k++) {
        for (let i = 0; i < 6; i++) {
          vectors[k * 6 + i] = i + 1;
        }
      }

      const costs = new Float64Array(count);
      batchQuadform6(metrics, vectors, costs, count);

      // Verify against sequential calls
      for (let k = 0; k < count; k++) {
        const expected = quadform6SIMD(metrics, k * 36, vectors, k * 6);
        expect(costs[k]).toBeCloseTo(expected, 10);
      }
    });
  });

  describe("add6x6InplaceSIMD", () => {
    it("adds two identity matrices", () => {
      const a = new Float64Array(36);
      const b = new Float64Array(36);
      for (let i = 0; i < 6; i++) {
        a[i * 6 + i] = 1;
        b[i * 6 + i] = 1;
      }

      add6x6InplaceSIMD(a, 0, b, 0);

      // Diagonal should be 2
      for (let i = 0; i < 6; i++) {
        expect(a[i * 6 + i]).toBeCloseTo(2, 10);
      }

      // Off-diagonal should still be 0
      expect(a[1]).toBeCloseTo(0, 10);
      expect(a[6]).toBeCloseTo(0, 10);
    });

    it("adds matrices with offsets", () => {
      const a = new Float64Array(72);
      const b = new Float64Array(72);

      // Set second matrix in a to identity
      for (let i = 0; i < 6; i++) {
        a[36 + i * 6 + i] = 1;
      }

      // Set second matrix in b to 2*identity
      for (let i = 0; i < 6; i++) {
        b[36 + i * 6 + i] = 2;
      }

      add6x6InplaceSIMD(a, 36, b, 36);

      // Second matrix diagonal should be 3
      for (let i = 0; i < 6; i++) {
        expect(a[36 + i * 6 + i]).toBeCloseTo(3, 10);
      }

      // First matrix should be unchanged (all zeros)
      expect(a[0]).toBeCloseTo(0, 10);
    });

    it("handles negative values", () => {
      const a = new Float64Array(36).fill(1);
      const b = new Float64Array(36).fill(-1);

      add6x6InplaceSIMD(a, 0, b, 0);

      // All zeros
      for (let i = 0; i < 36; i++) {
        expect(a[i]).toBeCloseTo(0, 10);
      }
    });

    it("handles large values", () => {
      const a = new Float64Array(36).fill(1e10);
      const b = new Float64Array(36).fill(1e10);

      add6x6InplaceSIMD(a, 0, b, 0);

      for (let i = 0; i < 36; i++) {
        expect(a[i]).toBeCloseTo(2e10, 5);
      }
    });

    it("handles small values", () => {
      const a = new Float64Array(36).fill(1e-15);
      const b = new Float64Array(36).fill(1e-15);

      add6x6InplaceSIMD(a, 0, b, 0);

      for (let i = 0; i < 36; i++) {
        expect(a[i]).toBeCloseTo(2e-15, 25);
      }
    });
  });

  describe("numerical accuracy", () => {
    it("quadform6SIMD maintains precision for typical QEM values", () => {
      // Realistic QEM matrix (from plane equation p^T * p)
      const normal = [0.577, 0.577, 0.577]; // Normalized
      const d = -10;

      // Build 4x4 quadric (embedded in 6x6)
      const matrix = new Float64Array(36);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          matrix[i * 6 + j] = normal[i] * normal[j];
        }
        matrix[i * 6 + 3] = normal[i] * d;
        matrix[3 * 6 + i] = normal[i] * d;
      }
      matrix[3 * 6 + 3] = d * d;

      const point = new Float64Array([5, 5, 5, 1, 0, 0]);

      const error = quadform6SIMD(matrix, 0, point, 0);

      // Expected: distance from point to plane, squared
      // Plane: 0.577x + 0.577y + 0.577z - 10 = 0
      // Point (5,5,5): 0.577*5*3 - 10 = 8.655 - 10 = -1.345
      // Squared: ~1.81
      expect(error).toBeGreaterThan(0);
      expect(error).toBeLessThan(10);
    });

    it("batch and single produce identical results", () => {
      // Use deterministic "random" values
      const metrics = new Float64Array(36 * 10);
      const vectors = new Float64Array(6 * 10);

      let seed = 12345;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed / 0x7fffffff) * 2 - 1; // -1 to 1
      };

      for (let i = 0; i < metrics.length; i++) {
        metrics[i] = rand();
      }
      for (let i = 0; i < vectors.length; i++) {
        vectors[i] = rand();
      }

      const batchCosts = new Float64Array(10);
      batchQuadform6(metrics, vectors, batchCosts, 10);

      for (let k = 0; k < 10; k++) {
        const singleCost = quadform6SIMD(metrics, k * 36, vectors, k * 6);
        expect(batchCosts[k]).toBeCloseTo(singleCost, 10);
      }
    });
  });
});
