/**
 * Math utilities tests
 */

import { describe, it, expect } from "vitest";
import {
  zeros,
  ones,
  add,
  sub,
  scale,
  dot,
  norm,
  normalize,
  cross,
  midpoint,
  EPS,
} from "../src/math/vector.js";
import {
  zeroMatrix,
  identity,
  addMatrix,
  matVec,
  matMul,
  transpose,
  outer,
  quadraticForm,
  cholesky,
  solveCholesky,
  planeFromThreePoints,
} from "../src/math/matrix.js";
import { solveQuadprog } from "../src/math/quadprog.js";
import type { Vec3, Matrix } from "../src/types.js";

describe("Vector operations", () => {
  it("zeros creates a zero vector", () => {
    const v = zeros(5);
    expect(v).toEqual([0, 0, 0, 0, 0]);
  });

  it("ones creates a vector of ones", () => {
    const v = ones(3);
    expect(v).toEqual([1, 1, 1]);
  });

  it("add adds vectors", () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
  });

  it("sub subtracts vectors", () => {
    expect(sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
  });

  it("scale multiplies vector by scalar", () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it("dot computes dot product", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("norm computes vector length", () => {
    expect(norm([3, 4])).toBe(5);
    expect(norm([1, 0, 0])).toBe(1);
  });

  it("normalize returns unit vector", () => {
    const n = normalize([3, 4, 0] as Vec3);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[1]).toBeCloseTo(0.8);
    expect(n[2]).toBeCloseTo(0);
  });

  it("cross computes cross product", () => {
    const c = cross([1, 0, 0], [0, 1, 0]);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(1);
  });

  it("midpoint computes midpoint", () => {
    expect(midpoint([0, 0], [2, 4])).toEqual([1, 2]);
  });
});

describe("Matrix operations", () => {
  it("zeroMatrix creates zero matrix", () => {
    const m = zeroMatrix(2, 3);
    expect(m).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("identity creates identity matrix", () => {
    const m = identity(3);
    expect(m).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it("addMatrix adds matrices", () => {
    const a: Matrix = [
      [1, 2],
      [3, 4],
    ];
    const b: Matrix = [
      [5, 6],
      [7, 8],
    ];
    expect(addMatrix(a, b)).toEqual([
      [6, 8],
      [10, 12],
    ]);
  });

  it("matVec multiplies matrix by vector", () => {
    const m: Matrix = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const v = [1, 1, 1];
    expect(matVec(m, v)).toEqual([6, 15]);
  });

  it("matMul multiplies matrices", () => {
    const a: Matrix = [
      [1, 2],
      [3, 4],
    ];
    const b: Matrix = [
      [5, 6],
      [7, 8],
    ];
    expect(matMul(a, b)).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it("transpose transposes matrix", () => {
    const m: Matrix = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(transpose(m)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("outer computes outer product", () => {
    expect(outer([1, 2], [3, 4])).toEqual([
      [3, 4],
      [6, 8],
    ]);
  });

  it("quadraticForm computes v^T * M * v", () => {
    const v = [1, 2];
    const m: Matrix = [
      [1, 0],
      [0, 1],
    ];
    expect(quadraticForm(v, m)).toBe(5);
  });

  it("cholesky computes Cholesky decomposition", () => {
    const m: Matrix = [
      [4, 2],
      [2, 5],
    ];
    const L = cholesky(m);
    // L * L^T should equal m
    const LLT = matMul(L, transpose(L));
    expect(LLT[0][0]).toBeCloseTo(4);
    expect(LLT[0][1]).toBeCloseTo(2);
    expect(LLT[1][0]).toBeCloseTo(2);
    expect(LLT[1][1]).toBeCloseTo(5);
  });

  it("solveCholesky solves Ax = b", () => {
    const A: Matrix = [
      [4, 2],
      [2, 5],
    ];
    const b = [8, 11];
    const x = solveCholesky(A, b);
    // Verify Ax = b
    const Ax = matVec(A, x);
    expect(Ax[0]).toBeCloseTo(8);
    expect(Ax[1]).toBeCloseTo(11);
  });

  it("planeFromThreePoints computes plane equation", () => {
    // XY plane through origin
    const v1: Vec3 = [0, 0, 0];
    const v2: Vec3 = [1, 0, 0];
    const v3: Vec3 = [0, 1, 0];
    const [a, b, c, d] = planeFromThreePoints(v1, v2, v3);
    // Normal should be (0, 0, 1) and d = 0
    expect(Math.abs(a)).toBeLessThan(EPS);
    expect(Math.abs(b)).toBeLessThan(EPS);
    expect(Math.abs(c)).toBeCloseTo(1);
    expect(Math.abs(d)).toBeLessThan(EPS);
  });
});

describe("Quadratic programming solver", () => {
  it("solves unconstrained QP", () => {
    // min 0.5 * (x1^2 + x2^2) + x1 + 2*x2
    // Solution: x = [-1, -2]
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [1, 2];
    const CE: Matrix = [];
    const ce0: number[] = [];
    const CI: Matrix = [];
    const ci0: number[] = [];

    const result = solveQuadprog(G, g0, CE, ce0, CI, ci0);
    expect(result.x[0]).toBeCloseTo(-1, 3);
    expect(result.x[1]).toBeCloseTo(-2, 3);
  });

  it("solves QP with equality constraint", () => {
    // min 0.5 * (x1^2 + x2^2)
    // s.t. x1 + x2 = 1
    // Solution: x = [0.5, 0.5]
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [0, 0];
    const CE: Matrix = [[1], [1]];
    const ce0 = [-1];
    const CI: Matrix = [];
    const ci0: number[] = [];

    const result = solveQuadprog(G, g0, CE, ce0, CI, ci0);
    expect(result.x[0]).toBeCloseTo(0.5, 3);
    expect(result.x[1]).toBeCloseTo(0.5, 3);
  });

  it("solves QP with inequality constraints", () => {
    // min 0.5 * (x1^2 + x2^2) - x1 - x2
    // s.t. x1 >= 0, x2 >= 0
    // Solution: x = [1, 1]
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [-1, -1];
    const CE: Matrix = [];
    const ce0: number[] = [];
    const CI: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const ci0 = [0, 0];

    const result = solveQuadprog(G, g0, CE, ce0, CI, ci0);
    expect(result.x[0]).toBeCloseTo(1, 3);
    expect(result.x[1]).toBeCloseTo(1, 3);
  });

  it("solves 6x6 QP with homogeneous constraint (QEM use case)", () => {
    // This mirrors the exact use case in decimation:
    // min 0.5 * x^T * G * x  where x = [x, y, z, u, v, 1]
    // s.t. x[5] = 1
    const G: Matrix = [
      [2.0, 0.1, 0.2, 0.0, 0.0, 0.3],
      [0.1, 2.0, 0.1, 0.0, 0.0, 0.4],
      [0.2, 0.1, 2.0, 0.0, 0.0, 0.5],
      [0.0, 0.0, 0.0, 1.0, 0.0, 0.6],
      [0.0, 0.0, 0.0, 0.0, 1.0, 0.7],
      [0.3, 0.4, 0.5, 0.6, 0.7, 2.0],
    ];

    // Add regularization (as done in C++)
    const w = 1e-6;
    for (let i = 0; i < 6; i++) G[i][i] += w;

    const g0 = [0, 0, 0, 0, 0, 0];
    const CE: Matrix = [[0], [0], [0], [0], [0], [1]];
    const ce0 = [-1];

    const result = solveQuadprog(G, g0, CE, ce0, [], []);

    // Should satisfy constraint
    expect(result.x[5]).toBeCloseTo(1, 6);
    // Should be finite
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  it("matches C++ eiquadprog for box-constrained problem", () => {
    // min 0.5*(x^2 + y^2) - 3x - 2y
    // s.t. 0 <= x <= 2, 0 <= y <= 2
    // Optimal: x=2, y=2 (at boundary)
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [-3, -2];
    // x >= 0, y >= 0, x <= 2, y <= 2
    // CI^T x + ci0 >= 0 means:
    // x >= 0, y >= 0, 2-x >= 0, 2-y >= 0
    const CI: Matrix = [
      [1, 0, -1, 0], // x, 0, -x, 0
      [0, 1, 0, -1], // 0, y, 0, -y
    ];
    const ci0 = [0, 0, 2, 2];

    const result = solveQuadprog(G, g0, [], [], CI, ci0);

    expect(result.x[0]).toBeCloseTo(2, 3);
    expect(result.x[1]).toBeCloseTo(2, 3);
  });
});
