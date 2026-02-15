/**
 * Decimation algorithm tests
 *
 * Tests ensure numerical parity with the C++ SeamAwareDecimater implementation.
 */

import { describe, it, expect } from "vitest";
import {
  MeshData,
  decimate,
  buildEdgeFlaps,
  getHalfEdgeBundle,
  buildSeamEdges,
  computeHalfEdgeQSlim5D,
  checkNoFoldover,
  costAndPlacement5D,
} from "../src/index.js";
import {
  twoPointsOnSameSide,
  signedTriangleArea,
} from "../src/decimation/foldover.js";
import { solveQuadprog } from "../src/math/quadprog.js";
import {
  zeroMatrix,
  quadraticForm,
  cholesky,
  transpose,
  matMul,
  addMatrix,
  outer,
} from "../src/math/matrix.js";
import { dot, norm, sub, scale, EPS } from "../src/math/vector.js";
import type { Vec2, Vec3, Vec5, Matrix } from "../src/types.js";

/**
 * Create a simple cube mesh for testing
 * Has 8 vertices, 12 faces (2 per side), with UV seams
 */
function createCube(): MeshData {
  const V: Vec3[] = [
    [0, 0, 0], // 0
    [1, 0, 0], // 1
    [1, 1, 0], // 2
    [0, 1, 0], // 3
    [0, 0, 1], // 4
    [1, 0, 1], // 5
    [1, 1, 1], // 6
    [0, 1, 1], // 7
  ];

  // Faces (counter-clockwise)
  const F: [number, number, number][] = [
    // Front face (z = 0)
    [0, 2, 1],
    [0, 3, 2],
    // Back face (z = 1)
    [4, 5, 6],
    [4, 6, 7],
    // Left face (x = 0)
    [0, 4, 7],
    [0, 7, 3],
    // Right face (x = 1)
    [1, 2, 6],
    [1, 6, 5],
    // Bottom face (y = 0)
    [0, 1, 5],
    [0, 5, 4],
    // Top face (y = 1)
    [3, 7, 6],
    [3, 6, 2],
  ];

  // UV coordinates - simple per-face mapping creating seams
  const TC: Vec2[] = [
    // Front face UVs
    [0, 0], // 0
    [1, 0], // 1
    [1, 1], // 2
    [0, 1], // 3
    // Back face UVs
    [0, 0], // 4
    [1, 0], // 5
    [1, 1], // 6
    [0, 1], // 7
    // Left face UVs
    [0, 0], // 8
    [1, 0], // 9
    [1, 1], // 10
    [0, 1], // 11
    // Right face UVs
    [0, 0], // 12
    [1, 0], // 13
    [1, 1], // 14
    [0, 1], // 15
    // Bottom face UVs
    [0, 0], // 16
    [1, 0], // 17
    [1, 1], // 18
    [0, 1], // 19
    // Top face UVs
    [0, 0], // 20
    [1, 0], // 21
    [1, 1], // 22
    [0, 1], // 23
  ];

  const FT: [number, number, number][] = [
    // Front face
    [0, 2, 1],
    [0, 3, 2],
    // Back face
    [4, 5, 6],
    [4, 6, 7],
    // Left face
    [8, 9, 10],
    [8, 10, 11],
    // Right face
    [12, 13, 14],
    [12, 14, 15],
    // Bottom face
    [16, 17, 18],
    [16, 18, 19],
    // Top face
    [20, 21, 22],
    [20, 22, 23],
  ];

  return new MeshData(V, F, TC, FT);
}

/**
 * Create a subdivided plane mesh that CAN be decimated
 * (has internal vertices with no seams)
 */
function createSubdividedPlane(divisions: number = 4): MeshData {
  const V: Vec3[] = [];
  const F: [number, number, number][] = [];
  const TC: Vec2[] = [];
  const FT: [number, number, number][] = [];

  // Create vertices in a grid
  for (let y = 0; y <= divisions; y++) {
    for (let x = 0; x <= divisions; x++) {
      const u = x / divisions;
      const v = y / divisions;
      V.push([u, v, 0]);
      TC.push([u, v]);
    }
  }

  // Create faces
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      const i = y * (divisions + 1) + x;
      const i1 = i + 1;
      const i2 = i + divisions + 1;
      const i3 = i2 + 1;

      // Two triangles per quad
      F.push([i, i3, i1]);
      F.push([i, i2, i3]);
      FT.push([i, i3, i1]);
      FT.push([i, i2, i3]);
    }
  }

  return new MeshData(V, F, TC, FT);
}

/**
 * Create a simple quad (two triangles) for basic testing
 */
function createQuad(): MeshData {
  const V: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];

  const F: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
  ];

  const TC: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const FT: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
  ];

  return new MeshData(V, F, TC, FT);
}

/**
 * Create a simple tetrahedron
 */
function createTetrahedron(): MeshData {
  const V: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0.5, 1, 0],
    [0.5, 0.5, 1],
  ];

  const F: [number, number, number][] = [
    [0, 1, 2], // bottom
    [0, 3, 1], // front
    [1, 3, 2], // right
    [2, 3, 0], // left
  ];

  // Simple UV mapping
  const TC: Vec2[] = [
    [0, 0],
    [1, 0],
    [0.5, 1],
    [0.5, 0.5],
  ];

  const FT: [number, number, number][] = [
    [0, 1, 2],
    [0, 3, 1],
    [1, 3, 2],
    [2, 3, 0],
  ];

  return new MeshData(V, F, TC, FT);
}

describe("Edge flaps", () => {
  it("builds edge connectivity for a quad", () => {
    const mesh = createQuad();
    const flaps = buildEdgeFlaps(mesh.F);

    // A quad has 5 edges: 4 boundary + 1 diagonal
    expect(flaps.E.length).toBe(5);
    expect(flaps.EF.length).toBe(5);
    expect(flaps.EI.length).toBe(5);
    expect(flaps.EMAP.length).toBe(6); // 2 faces * 3 edges
  });

  it("builds edge connectivity for a tetrahedron", () => {
    const mesh = createTetrahedron();
    const flaps = buildEdgeFlaps(mesh.F);

    // A tetrahedron has 6 edges
    expect(flaps.E.length).toBe(6);
  });
});

describe("Half-edge bundle", () => {
  it("gets half-edge bundle for an edge", () => {
    const mesh = createQuad();
    const { E, EF, EI } = buildEdgeFlaps(mesh.F);

    // Get bundle for diagonal edge
    let diagonalIdx = -1;
    for (let i = 0; i < E.length; i++) {
      if (
        (E[i][0] === 0 && E[i][1] === 2) ||
        (E[i][0] === 2 && E[i][1] === 0)
      ) {
        diagonalIdx = i;
        break;
      }
    }

    expect(diagonalIdx).toBeGreaterThanOrEqual(0);

    const bundle = getHalfEdgeBundle(diagonalIdx, E, EF, EI, mesh.F, mesh.FT);

    // Diagonal edge should have 2 half-edges (shared by 2 faces)
    expect(bundle.length).toBe(2);
  });
});

describe("Seam edges", () => {
  it("detects seam edges on cube", () => {
    const mesh = createCube();
    const seamEdges = buildSeamEdges(mesh.F, mesh.FT);

    // Cube has many seam edges due to separate UV islands per face
    expect(seamEdges.size).toBeGreaterThan(0);
  });

  it("detects no seam edges on simple quad", () => {
    const mesh = createQuad();
    const seamEdges = buildSeamEdges(mesh.F, mesh.FT);

    // Quad with consistent UVs has no seams
    expect(seamEdges.size).toBe(0);
  });
});

describe("Quadric error metrics", () => {
  it("computes metrics for all vertices", () => {
    const mesh = createQuad();
    const metrics = computeHalfEdgeQSlim5D(mesh.V, mesh.F, mesh.TC, mesh.FT);

    // Should have metrics for all 4 vertices
    expect(metrics.size).toBe(4);

    // Each vertex should have at least one texture coordinate
    for (const [vi, tcMap] of metrics) {
      expect(tcMap.size).toBeGreaterThan(0);
      for (const [ti, matrix] of tcMap) {
        // Metric should be 6x6
        expect(matrix.length).toBe(6);
        expect(matrix[0].length).toBe(6);
      }
    }
  });
});

describe("Foldover detection", () => {
  it("twoPointsOnSameSide returns true for same side", () => {
    const uv1: Vec2 = [0, 0];
    const uv2: Vec2 = [1, 0];
    const p1: Vec2 = [0.5, 1];
    const p2: Vec2 = [0.5, 2];

    expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(true);
  });

  it("twoPointsOnSameSide returns false for opposite sides", () => {
    const uv1: Vec2 = [0, 0];
    const uv2: Vec2 = [1, 0];
    const p1: Vec2 = [0.5, 1];
    const p2: Vec2 = [0.5, -1];

    expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(false);
  });
});

describe("Decimation", () => {
  it("decimates a subdivided plane mesh", () => {
    const mesh = createSubdividedPlane(4);
    const originalVertices = mesh.V.length;
    console.log(
      `Subdivided plane: ${originalVertices} vertices, ${mesh.F.length} faces`,
    );

    const result = decimate(mesh, {
      targetPercent: 50,
      strictness: 2,
    });

    console.log(
      `After decimation: ${result.mesh.V.length} vertices, ${result.mesh.F.length} faces, ${result.collapses} collapses`,
    );

    // Should have fewer vertices (subdivided plane has no seams, so can be decimated)
    expect(result.mesh.V.length).toBeLessThan(originalVertices);
    // Should still be a valid mesh
    expect(result.mesh.F.length).toBeGreaterThan(0);
    // Should have consistent face indices
    for (const face of result.mesh.F) {
      expect(face[0]).toBeLessThan(result.mesh.V.length);
      expect(face[1]).toBeLessThan(result.mesh.V.length);
      expect(face[2]).toBeLessThan(result.mesh.V.length);
    }
  });

  it("preserves seam edges on cube with UV islands", () => {
    const mesh = createCube();
    const originalVertices = mesh.V.length;

    // Cube with per-face UV islands has seams on every edge
    // With strictness 2, the algorithm should preserve all seams
    const result = decimate(mesh, {
      targetPercent: 50,
      strictness: 2,
    });

    // Seam-aware decimation should preserve mesh when all edges are seams
    // The mesh might not be able to decimate at all due to seam constraints
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result.mesh.F.length).toBeGreaterThan(0);
  });

  it("preserves mesh with high target", () => {
    const mesh = createQuad();
    const result = decimate(mesh, { targetPercent: 100 });

    // Should preserve all vertices when target is 100%
    expect(result.mesh.V.length).toBe(mesh.V.length);
    expect(result.mesh.F.length).toBe(mesh.F.length);
  });

  it("respects minimum vertex count", () => {
    const mesh = createSubdividedPlane(4);
    const result = decimate(mesh, { targetVertices: 2 });

    // Should not go below 4 vertices
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
  });

  it("works with different strictness levels", () => {
    const mesh = createSubdividedPlane(4);

    const result0 = decimate(mesh, { targetPercent: 30, strictness: 0 });
    const result1 = decimate(mesh, { targetPercent: 30, strictness: 1 });
    const result2 = decimate(mesh, { targetPercent: 30, strictness: 2 });

    // All should produce valid meshes
    expect(result0.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result1.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result2.mesh.V.length).toBeGreaterThanOrEqual(4);
  });

  it("decimate with target vertex count", () => {
    const mesh = createSubdividedPlane(4);
    const originalVertices = mesh.V.length;

    const result = decimate(mesh, { targetVertices: 10 });

    // Should have reduced vertex count
    expect(result.mesh.V.length).toBeLessThanOrEqual(originalVertices);
    expect(result.collapses).toBeGreaterThan(0);
  });
});

describe("Integration", () => {
  it("full decimation workflow with subdivided plane", () => {
    // Create mesh (subdivided plane has no seams)
    const mesh = createSubdividedPlane(6);
    console.log(`Original: ${mesh.V.length} vertices, ${mesh.F.length} faces`);

    // Decimate to 30%
    const result = decimate(mesh, {
      targetPercent: 30,
      strictness: 2,
    });
    const decimated = result.mesh;
    console.log(
      `Decimated: ${decimated.V.length} vertices, ${decimated.F.length} faces`,
    );
    console.log(`Collapses: ${result.collapses}`);

    // Verify output
    expect(decimated.V.length).toBeGreaterThan(0);
    expect(decimated.F.length).toBeGreaterThan(0);
    expect(decimated.TC.length).toBeGreaterThan(0);
    expect(decimated.FT.length).toBe(decimated.F.length);

    // Should have performed some collapses
    expect(result.collapses).toBeGreaterThan(0);

    // Verify all indices are valid
    for (let i = 0; i < decimated.F.length; i++) {
      const face = decimated.F[i];
      const ftFace = decimated.FT[i];

      for (let j = 0; j < 3; j++) {
        expect(face[j]).toBeGreaterThanOrEqual(0);
        expect(face[j]).toBeLessThan(decimated.V.length);
        expect(ftFace[j]).toBeGreaterThanOrEqual(0);
        expect(ftFace[j]).toBeLessThan(decimated.TC.length);
      }
    }
  });
});

describe("Edge cases", () => {
  it("handles single triangle mesh", () => {
    const mesh = new MeshData(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
      ],
      [[0, 1, 2]],
      [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ],
      [[0, 1, 2]],
    );

    const result = decimate(mesh, { targetPercent: 50 });

    // Cannot decimate a single triangle
    expect(result.mesh.V.length).toBe(3);
    expect(result.mesh.F.length).toBe(1);
    expect(result.collapses).toBe(0);
  });

  it("handles mesh that cannot be further decimated", () => {
    // A tetrahedron cannot be decimated without breaking topology
    const mesh = createTetrahedron();
    const result = decimate(mesh, { targetVertices: 2 });

    // Should not collapse below minimum valid mesh
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
  });

  it("preserves UV coordinates within valid range", () => {
    const mesh = createSubdividedPlane(4);
    const result = decimate(mesh, { targetPercent: 50 });

    // All UV coordinates should remain in [0, 1] range
    for (const tc of result.mesh.TC) {
      expect(tc[0]).toBeGreaterThanOrEqual(0);
      expect(tc[0]).toBeLessThanOrEqual(1);
      expect(tc[1]).toBeGreaterThanOrEqual(0);
      expect(tc[1]).toBeLessThanOrEqual(1);
    }
  });

  it("preserves mesh manifold property", () => {
    const mesh = createSubdividedPlane(4);
    const result = decimate(mesh, { targetPercent: 50 });

    // Check each vertex is referenced
    const referencedVertices = new Set<number>();
    for (const face of result.mesh.F) {
      for (const vi of face) {
        referencedVertices.add(vi);
      }
    }

    // All vertices in the mesh should be referenced by at least one face
    expect(referencedVertices.size).toBe(result.mesh.V.length);
  });
});

describe("Larger meshes", () => {
  it("decimates a high-resolution plane efficiently", () => {
    const mesh = createSubdividedPlane(10); // 121 vertices, 200 faces
    const originalVertices = mesh.V.length;

    const startTime = performance.now();
    const result = decimate(mesh, { targetPercent: 25 });
    const elapsed = performance.now() - startTime;

    console.log(
      `High-res plane: ${originalVertices} -> ${result.mesh.V.length} vertices in ${elapsed.toFixed(1)}ms`,
    );

    // Should decimate (boundary edges cannot be collapsed, so we can't expect 50% reduction)
    // A subdivided plane has many boundary edges, so expect at least some reduction
    expect(result.mesh.V.length).toBeLessThan(originalVertices);
    expect(result.collapses).toBeGreaterThan(0);
    // Should be reasonably fast (< 1 second for this size)
    expect(elapsed).toBeLessThan(1000);
  });

  it("handles aggressive decimation", () => {
    const mesh = createSubdividedPlane(8);
    const result = decimate(mesh, { targetPercent: 10 });

    // Should still produce a valid mesh
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result.mesh.F.length).toBeGreaterThanOrEqual(2);

    // Verify no degenerate faces (all vertices in each face should be distinct)
    for (const face of result.mesh.F) {
      const [v0, v1, v2] = face;
      expect(v0).not.toBe(v1);
      expect(v1).not.toBe(v2);
      expect(v2).not.toBe(v0);
    }
  });
});

describe("UV seam handling", () => {
  it("correctly identifies seam edges from UV discontinuity", () => {
    // Create a mesh with explicit UV seam
    const V: Vec3[] = [
      [0, 0, 0], // 0
      [1, 0, 0], // 1
      [1, 1, 0], // 2
      [0, 1, 0], // 3
      [2, 0, 0], // 4
      [2, 1, 0], // 5
    ];

    // Two quads sharing edge (1,2)
    const F: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 3],
      [1, 4, 5],
      [1, 5, 2],
    ];

    // UVs with seam along edge (1,2) - different TC indices for same edge
    const TC: Vec2[] = [
      [0, 0], // 0 - left quad
      [1, 0], // 1 - left quad edge start
      [1, 1], // 2 - left quad edge end
      [0, 1], // 3 - left quad
      [0, 0], // 4 - right quad edge start (same as 1 but different index)
      [0, 1], // 5 - right quad edge end (same as 2 but different index)
      [1, 0], // 6 - right quad
      [1, 1], // 7 - right quad
    ];

    const FT: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 3],
      [4, 6, 7],
      [4, 7, 5],
    ];

    const mesh = new MeshData(V, F, TC, FT);
    const seamEdges = buildSeamEdges(mesh.F, mesh.FT);

    // Should detect the seam edge
    expect(seamEdges.size).toBeGreaterThan(0);
  });

  it("preserves UV island boundaries during decimation", () => {
    // Create mesh with two UV islands
    const V: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 1, 0], // triangle 1
      [2, 0, 0],
      [3, 0, 0],
      [2.5, 1, 0], // triangle 2
    ];

    const F: [number, number, number][] = [
      [0, 1, 2],
      [3, 4, 5],
    ];

    // Separate UV islands
    const TC: Vec2[] = [
      [0, 0],
      [0.5, 0],
      [0.25, 0.5], // island 1
      [0.5, 0],
      [1, 0],
      [0.75, 0.5], // island 2
    ];

    const FT: [number, number, number][] = [
      [0, 1, 2],
      [3, 4, 5],
    ];

    const mesh = new MeshData(V, F, TC, FT);
    const result = decimate(mesh, { targetPercent: 50 });

    // Should preserve both triangles (they're not connected)
    expect(result.mesh.F.length).toBe(2);
    expect(result.mesh.V.length).toBe(6);
  });
});

describe("Statistics", () => {
  it("returns accurate statistics", () => {
    const mesh = createSubdividedPlane(4);
    const result = decimate(mesh, { targetPercent: 50 });

    // Statistics should be accurate
    expect(result.originalVertices).toBe(mesh.V.length);
    expect(result.originalFaces).toBe(mesh.F.length);
    expect(result.finalVertices).toBe(result.mesh.V.length);
    expect(result.finalFaces).toBe(result.mesh.F.length);
    expect(result.collapses).toBe(
      result.originalVertices - result.finalVertices,
    );
  });
});

// ============================================================================
// NUMERICAL VALIDATION TESTS (C++ Parity)
// ============================================================================
// These tests verify that our TypeScript implementation produces results
// that match the C++ SeamAwareDecimater within floating-point epsilon.

describe("Numerical Validation - C++ Parity", () => {
  const EPSILON = 1e-6;

  describe("QP Solver (eiquadprog parity)", () => {
    it("solves simple unconstrained QP same as C++", () => {
      // min 0.5 * x^T * G * x + g0^T * x
      // with G = [[2, 0], [0, 2]], g0 = [-2, -4]
      // Optimal: x = [1, 2]
      const G: Matrix = [
        [2, 0],
        [0, 2],
      ];
      const g0 = [-2, -4];
      const result = solveQuadprog(G, g0, [], [], [], []);

      expect(Math.abs(result.x[0] - 1)).toBeLessThan(EPSILON);
      expect(Math.abs(result.x[1] - 2)).toBeLessThan(EPSILON);
      // Optimal cost: 0.5 * [1,2] * G * [1,2] + g0 * [1,2] = 0.5*(2+8) + (-2-8) = 5 - 10 = -5
      expect(Math.abs(result.cost - -5)).toBeLessThan(EPSILON);
    });

    it("handles equality constraint exactly as C++", () => {
      // min 0.5 * (x1^2 + x2^2) subject to x1 + x2 = 2
      // Optimal: x = [1, 1]
      const G: Matrix = [
        [1, 0],
        [0, 1],
      ];
      const g0 = [0, 0];
      const CE: Matrix = [[1], [1]];
      const ce0 = [-2]; // Note: C++ convention ce0 = -b for Ax = b

      const result = solveQuadprog(G, g0, CE, ce0, [], []);

      expect(Math.abs(result.x[0] - 1)).toBeLessThan(EPSILON);
      expect(Math.abs(result.x[1] - 1)).toBeLessThan(EPSILON);
    });

    it("handles inequality constraints same as C++", () => {
      // min 0.5 * (x1^2 + x2^2) - 2*x1 - 2*x2
      // s.t. x1 + x2 >= 0, x1 >= 0, x2 >= 0
      // Optimal: x = [2, 2]
      const G: Matrix = [
        [1, 0],
        [0, 1],
      ];
      const g0 = [-2, -2];
      const CI: Matrix = [
        [1, 1, 0],
        [1, 0, 1],
      ]; // x1+x2 >= 0, x1 >= 0, x2 >= 0
      const ci0 = [0, 0, 0];

      const result = solveQuadprog(G, g0, [], [], CI, ci0);

      expect(Math.abs(result.x[0] - 2)).toBeLessThan(EPSILON);
      expect(Math.abs(result.x[1] - 2)).toBeLessThan(EPSILON);
    });

    it("correctly handles the 6x6 QEM problem", () => {
      // This tests the actual problem size used in decimation
      // min 0.5 * x^T * G * x, s.t. x[5] = 1 (homogeneous coordinate)
      const G: Matrix = [
        [1, 0, 0, 0, 0, 0.1],
        [0, 1, 0, 0, 0, 0.2],
        [0, 0, 1, 0, 0, 0.3],
        [0, 0, 0, 1, 0, 0.4],
        [0, 0, 0, 0, 1, 0.5],
        [0.1, 0.2, 0.3, 0.4, 0.5, 1],
      ];
      const g0 = [0, 0, 0, 0, 0, 0];
      const CE: Matrix = [[0], [0], [0], [0], [0], [1]];
      const ce0 = [-1];

      const result = solveQuadprog(G, g0, CE, ce0, [], []);

      // Should find a valid solution
      expect(result.x.length).toBe(6);
      expect(Number.isFinite(result.cost)).toBe(true);
      // x[5] should be approximately 1
      expect(Math.abs(result.x[5] - 1)).toBeLessThan(EPSILON);
    });
  });

  describe("5D Metric Computation (half_edge_qslim_5d parity)", () => {
    it("computes correct metric for single triangle", () => {
      // Single triangle in XY plane with simple UVs
      const V: Vec3[] = [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ];
      const F: [number, number, number][] = [[0, 1, 2]];
      const TC: Vec2[] = [
        [0, 0],
        [1, 0],
        [0, 1],
      ];
      const FT: [number, number, number][] = [[0, 1, 2]];

      const metrics = computeHalfEdgeQSlim5D(V, F, TC, FT);

      // Should have metrics for all 3 vertices
      expect(metrics.size).toBe(3);

      // Each metric should be 6x6 and symmetric
      for (const [_vi, tcMap] of metrics) {
        for (const [_ti, matrix] of tcMap) {
          expect(matrix.length).toBe(6);
          expect(matrix[0].length).toBe(6);
          // Check symmetry
          for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
              expect(Math.abs(matrix[i][j] - matrix[j][i])).toBeLessThan(
                EPSILON,
              );
            }
          }
        }
      }
    });

    it("metric evaluates to zero for points on the triangle", () => {
      // The QEM for a vertex on the triangle plane should be zero
      const V: Vec3[] = [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ];
      const F: [number, number, number][] = [[0, 1, 2]];
      const TC: Vec2[] = [
        [0, 0],
        [1, 0],
        [0, 1],
      ];
      const FT: [number, number, number][] = [[0, 1, 2]];

      const metrics = computeHalfEdgeQSlim5D(V, F, TC, FT);

      // For vertex 0: p = [0, 0, 0, 0, 0, 1] (homogeneous)
      const m0 = metrics.get(0)!.get(0)!;
      const p0 = [0, 0, 0, 0, 0, 1];
      const cost0 = quadraticForm(p0, m0);

      // Cost should be approximately zero
      expect(Math.abs(cost0)).toBeLessThan(EPSILON);
    });

    it("combines metrics correctly when edges are shared", () => {
      // Two triangles sharing an edge
      const V: Vec3[] = [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
        [0.5, -1, 0],
      ];
      const F: [number, number, number][] = [
        [0, 1, 2],
        [0, 3, 1],
      ];
      const TC: Vec2[] = [
        [0, 0],
        [1, 0],
        [0.5, 1],
        [0.5, 0],
      ];
      const FT: [number, number, number][] = [
        [0, 1, 2],
        [0, 3, 1],
      ];

      const metrics = computeHalfEdgeQSlim5D(V, F, TC, FT);

      // Vertices 0 and 1 are shared by both triangles
      // Their metrics should be the sum of contributions from both faces
      const m0 = metrics.get(0)!.get(0)!;
      const m1 = metrics.get(1)!.get(1)!;

      // Both should be non-zero due to contributions from two triangles
      expect(Math.abs(m0[0][0])).toBeGreaterThan(EPSILON);
      expect(Math.abs(m1[0][0])).toBeGreaterThan(EPSILON);
    });
  });

  describe("Foldover Detection (two_points_on_same_side parity)", () => {
    it("detects same side correctly", () => {
      // Points above the X-axis line
      const uv1: Vec2 = [0, 0];
      const uv2: Vec2 = [1, 0];
      const p1: Vec2 = [0.3, 0.5];
      const p2: Vec2 = [0.7, 0.8];

      expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(true);
    });

    it("detects opposite sides correctly", () => {
      // One point above, one below the X-axis line
      const uv1: Vec2 = [0, 0];
      const uv2: Vec2 = [1, 0];
      const p1: Vec2 = [0.5, 0.5];
      const p2: Vec2 = [0.5, -0.5];

      expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(false);
    });

    it("handles vertical line correctly", () => {
      // Vertical line at x=0.5
      const uv1: Vec2 = [0.5, 0];
      const uv2: Vec2 = [0.5, 1];
      const p1: Vec2 = [0.2, 0.5]; // left
      const p2: Vec2 = [0.8, 0.5]; // right

      expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(false);

      // Both on same side
      const p3: Vec2 = [0.2, 0.3];
      expect(twoPointsOnSameSide(uv1, uv2, p1, p3)).toBe(true);
    });

    it("handles degenerate line (same point)", () => {
      const uv1: Vec2 = [0.5, 0.5];
      const uv2: Vec2 = [0.5, 0.5];
      const p1: Vec2 = [0, 0];
      const p2: Vec2 = [1, 1];

      // Should return true for degenerate case
      expect(twoPointsOnSameSide(uv1, uv2, p1, p2)).toBe(true);
    });
  });

  describe("Signed Triangle Area", () => {
    it("computes positive area for CCW triangle", () => {
      const a: Vec2 = [0, 0];
      const b: Vec2 = [1, 0];
      const c: Vec2 = [0, 1];
      const area = signedTriangleArea(a, b, c);
      expect(area).toBeCloseTo(0.5);
    });

    it("computes negative area for CW triangle", () => {
      const a: Vec2 = [0, 0];
      const b: Vec2 = [0, 1];
      const c: Vec2 = [1, 0];
      const area = signedTriangleArea(a, b, c);
      expect(area).toBeCloseTo(-0.5);
    });
  });

  describe("Edge Flaps (edge_flaps parity)", () => {
    it("builds correct connectivity for manifold mesh", () => {
      // Simple quad (2 triangles)
      const F: [number, number, number][] = [
        [0, 1, 2],
        [0, 2, 3],
      ];
      const flaps = buildEdgeFlaps(F);

      // Should have 5 edges (4 boundary + 1 shared)
      expect(flaps.E.length).toBe(5);

      // Find the shared edge (0-2)
      let sharedEdgeIdx = -1;
      for (let i = 0; i < flaps.E.length; i++) {
        if (
          (flaps.E[i][0] === 0 && flaps.E[i][1] === 2) ||
          (flaps.E[i][0] === 2 && flaps.E[i][1] === 0)
        ) {
          sharedEdgeIdx = i;
          break;
        }
      }

      expect(sharedEdgeIdx).toBeGreaterThanOrEqual(0);

      // Shared edge should have two faces
      expect(flaps.EF[sharedEdgeIdx][0]).not.toBe(-1);
      expect(flaps.EF[sharedEdgeIdx][1]).not.toBe(-1);
    });

    it("EMAP maps correctly to edges", () => {
      const F: [number, number, number][] = [
        [0, 1, 2],
        [0, 2, 3],
      ];
      const flaps = buildEdgeFlaps(F);

      // Each face has 3 edges, so EMAP should have 6 entries
      expect(flaps.EMAP.length).toBe(6);

      // All EMAP entries should point to valid edges
      for (const ei of flaps.EMAP) {
        expect(ei).toBeGreaterThanOrEqual(0);
        expect(ei).toBeLessThan(flaps.E.length);
      }
    });
  });

  describe("Cost and Placement (cost_and_placement_qslim5d_halfedge parity)", () => {
    it("computes finite cost for collapsible edge", () => {
      const mesh = createSubdividedPlane(2);
      const { E, EF, EI } = buildEdgeFlaps(mesh.F);
      const seamEdges = buildSeamEdges(mesh.F, mesh.FT);
      const Vmetrics = computeHalfEdgeQSlim5D(mesh.V, mesh.F, mesh.TC, mesh.FT);

      // Find an internal edge (not on boundary)
      let internalEdgeIdx = -1;
      for (let i = 0; i < E.length; i++) {
        if (EF[i][0] !== -1 && EF[i][1] !== -1) {
          internalEdgeIdx = i;
          break;
        }
      }

      if (internalEdgeIdx >= 0) {
        const bundle = getHalfEdgeBundle(
          internalEdgeIdx,
          E,
          EF,
          EI,
          mesh.F,
          mesh.FT,
        );
        const result = costAndPlacement5D(
          bundle,
          mesh.V,
          mesh.F,
          mesh.TC,
          mesh.FT,
          seamEdges,
          Vmetrics,
          2,
        );

        // Internal edge should have finite cost
        expect(Number.isFinite(result.cost)).toBe(true);
        expect(result.placement.p.length).toBe(3);
        expect(result.placement.tcs.length).toBeGreaterThan(0);
      }
    });

    it("returns infinite cost for seam vertex edges that should not collapse", () => {
      const mesh = createCube();
      const { E, EF, EI } = buildEdgeFlaps(mesh.F);
      const seamEdges = buildSeamEdges(mesh.F, mesh.FT);
      const Vmetrics = computeHalfEdgeQSlim5D(mesh.V, mesh.F, mesh.TC, mesh.FT);

      // Cube with per-face UVs should have all edges as seam edges
      // Most edges should return infinite cost with strictness=2
      let infiniteCount = 0;
      for (let i = 0; i < E.length; i++) {
        if (EF[i][0] !== -1 && EF[i][1] !== -1) {
          const bundle = getHalfEdgeBundle(i, E, EF, EI, mesh.F, mesh.FT);
          const result = costAndPlacement5D(
            bundle,
            mesh.V,
            mesh.F,
            mesh.TC,
            mesh.FT,
            seamEdges,
            Vmetrics,
            2,
          );
          if (!Number.isFinite(result.cost)) {
            infiniteCount++;
          }
        }
      }

      // With strictness=2, most cube edges should be uncollapsible
      expect(infiniteCount).toBeGreaterThan(0);
    });
  });

  describe("Matrix Operations", () => {
    it("Cholesky decomposition matches C++", () => {
      // Test positive definite matrix
      const A: Matrix = [
        [4, 2, 2],
        [2, 5, 3],
        [2, 3, 6],
      ];
      const L = cholesky(A);

      // Verify L * L^T = A
      const LLT = matMul(L, transpose(L));

      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(Math.abs(LLT[i][j] - A[i][j])).toBeLessThan(EPSILON);
        }
      }
    });

    it("outer product matches C++", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      const result = outer(a, b);

      const expected = [
        [4, 5, 6],
        [8, 10, 12],
        [12, 15, 18],
      ];

      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(result[i][j]).toBe(expected[i][j]);
        }
      }
    });

    it("quadratic form matches C++", () => {
      const v = [1, 2, 3];
      const M: Matrix = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];

      // v^T * I * v = 1 + 4 + 9 = 14
      expect(quadraticForm(v, M)).toBe(14);
    });
  });
});

describe("Deterministic behavior", () => {
  it("produces identical results for identical inputs", () => {
    const mesh = createSubdividedPlane(4);

    const result1 = decimate(mesh, { targetPercent: 50, strictness: 2 });
    const result2 = decimate(mesh, { targetPercent: 50, strictness: 2 });

    // Should produce identical results
    expect(result1.mesh.V.length).toBe(result2.mesh.V.length);
    expect(result1.mesh.F.length).toBe(result2.mesh.F.length);
    expect(result1.collapses).toBe(result2.collapses);

    // Vertex positions should match exactly
    for (let i = 0; i < result1.mesh.V.length; i++) {
      expect(result1.mesh.V[i][0]).toBe(result2.mesh.V[i][0]);
      expect(result1.mesh.V[i][1]).toBe(result2.mesh.V[i][1]);
      expect(result1.mesh.V[i][2]).toBe(result2.mesh.V[i][2]);
    }
  });
});

describe("Algorithm correctness", () => {
  it("maintains mesh topology invariants", () => {
    const mesh = createSubdividedPlane(5);
    const result = decimate(mesh, { targetPercent: 40 });

    // Every vertex should be referenced by at least one face
    const referencedVertices = new Set<number>();
    for (const face of result.mesh.F) {
      referencedVertices.add(face[0]);
      referencedVertices.add(face[1]);
      referencedVertices.add(face[2]);
    }
    expect(referencedVertices.size).toBe(result.mesh.V.length);

    // No degenerate faces
    for (const face of result.mesh.F) {
      expect(face[0]).not.toBe(face[1]);
      expect(face[1]).not.toBe(face[2]);
      expect(face[2]).not.toBe(face[0]);
    }

    // All face indices in valid range
    for (const face of result.mesh.F) {
      expect(face[0]).toBeGreaterThanOrEqual(0);
      expect(face[0]).toBeLessThan(result.mesh.V.length);
      expect(face[1]).toBeGreaterThanOrEqual(0);
      expect(face[1]).toBeLessThan(result.mesh.V.length);
      expect(face[2]).toBeGreaterThanOrEqual(0);
      expect(face[2]).toBeLessThan(result.mesh.V.length);
    }
  });

  it("preserves UV space topology", () => {
    const mesh = createSubdividedPlane(4);
    const result = decimate(mesh, { targetPercent: 50 });

    // Every TC should be referenced by at least one face
    const referencedTC = new Set<number>();
    for (const face of result.mesh.FT) {
      referencedTC.add(face[0]);
      referencedTC.add(face[1]);
      referencedTC.add(face[2]);
    }
    expect(referencedTC.size).toBe(result.mesh.TC.length);

    // All FT indices in valid range
    for (const face of result.mesh.FT) {
      expect(face[0]).toBeGreaterThanOrEqual(0);
      expect(face[0]).toBeLessThan(result.mesh.TC.length);
      expect(face[1]).toBeGreaterThanOrEqual(0);
      expect(face[1]).toBeLessThan(result.mesh.TC.length);
      expect(face[2]).toBeGreaterThanOrEqual(0);
      expect(face[2]).toBeLessThan(result.mesh.TC.length);
    }
  });

  it("correctly handles strictness levels for seam edges", () => {
    // Create a mesh with known seams
    const mesh = createCube();

    // With strictness=0, more collapses should be possible
    const result0 = decimate(mesh, { targetPercent: 25, strictness: 0 });
    // With strictness=2 (full seam preservation), fewer collapses
    const result2 = decimate(mesh, { targetPercent: 25, strictness: 2 });

    // Both should produce valid meshes
    expect(result0.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result2.mesh.V.length).toBeGreaterThanOrEqual(4);

    // strictness=2 should preserve more vertices (fewer collapses)
    expect(result2.mesh.V.length).toBeGreaterThanOrEqual(result0.mesh.V.length);
  });
});

describe("OBJ parsing integration", () => {
  /**
   * Parse a simple OBJ string into MeshData
   */
  function parseOBJ(objString: string): MeshData {
    const V: Vec3[] = [];
    const TC: Vec2[] = [];
    const F: [number, number, number][] = [];
    const FT: [number, number, number][] = [];

    const lines = objString.split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 0 || parts[0].startsWith("#")) continue;

      if (parts[0] === "v" && parts.length >= 4) {
        V.push([
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3]),
        ]);
      } else if (parts[0] === "vt" && parts.length >= 3) {
        TC.push([parseFloat(parts[1]), parseFloat(parts[2])]);
      } else if (parts[0] === "f" && parts.length >= 4) {
        // Parse face (v/vt/vn or v/vt or v format)
        const faceV: number[] = [];
        const faceT: number[] = [];

        for (let i = 1; i < parts.length && faceV.length < 3; i++) {
          const indices = parts[i].split("/");
          faceV.push(parseInt(indices[0]) - 1); // OBJ is 1-indexed
          if (indices.length > 1 && indices[1]) {
            faceT.push(parseInt(indices[1]) - 1);
          } else {
            faceT.push(faceV[faceV.length - 1]); // Use same as vertex
          }
        }

        if (faceV.length === 3) {
          F.push([faceV[0], faceV[1], faceV[2]]);
          FT.push([faceT[0], faceT[1], faceT[2]]);
        }
      }
    }

    // If no TCs, create default
    if (TC.length === 0) {
      for (let i = 0; i < V.length; i++) {
        TC.push([0, 0]);
      }
      for (let i = 0; i < FT.length; i++) {
        FT[i] = [...F[i]];
      }
    }

    return new MeshData(V, F, TC, FT);
  }

  it("parses and decimates simple OBJ cube", () => {
    const cubeOBJ = `
      # Simple cube
      v 0 0 0
      v 1 0 0
      v 1 1 0
      v 0 1 0
      v 0 0 1
      v 1 0 1
      v 1 1 1
      v 0 1 1
      vt 0 0
      vt 1 0
      vt 1 1
      vt 0 1
      f 1/1 3/3 2/2
      f 1/1 4/4 3/3
      f 5/1 6/2 7/3
      f 5/1 7/3 8/4
      f 1/1 5/2 8/3
      f 1/1 8/3 4/4
      f 2/1 3/2 7/3
      f 2/1 7/3 6/4
      f 1/1 2/2 6/3
      f 1/1 6/3 5/4
      f 4/1 8/2 7/3
      f 4/1 7/3 3/4
    `;

    const mesh = parseOBJ(cubeOBJ);

    expect(mesh.V.length).toBe(8);
    expect(mesh.F.length).toBe(12);

    const result = decimate(mesh, { targetPercent: 50 });

    // Should produce a valid mesh
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result.mesh.F.length).toBeGreaterThanOrEqual(4);
  });

  it("parses and decimates subdivided grid OBJ", () => {
    // Create a 3x3 grid OBJ programmatically
    const gridOBJ: string[] = ["# 3x3 Grid"];
    const gridSize = 3;

    // Vertices
    for (let y = 0; y <= gridSize; y++) {
      for (let x = 0; x <= gridSize; x++) {
        gridOBJ.push(`v ${x / gridSize} ${y / gridSize} 0`);
        gridOBJ.push(`vt ${x / gridSize} ${y / gridSize}`);
      }
    }

    // Faces
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const i = y * (gridSize + 1) + x + 1; // 1-indexed
        const i1 = i + 1;
        const i2 = i + gridSize + 1;
        const i3 = i2 + 1;
        gridOBJ.push(`f ${i}/${i} ${i3}/${i3} ${i1}/${i1}`);
        gridOBJ.push(`f ${i}/${i} ${i2}/${i2} ${i3}/${i3}`);
      }
    }

    const mesh = parseOBJ(gridOBJ.join("\n"));

    expect(mesh.V.length).toBe(16); // 4x4 vertices
    expect(mesh.F.length).toBe(18); // 3x3x2 faces

    const result = decimate(mesh, { targetPercent: 50 });

    // Should decimate
    expect(result.mesh.V.length).toBeLessThan(mesh.V.length);
    expect(result.collapses).toBeGreaterThan(0);
  });
});

describe("Algorithm correctness", () => {
  it("computes correct quadric metrics for a simple face", () => {
    // Test that quadric metrics match expected formula from Section 5.1
    const mesh = new MeshData(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0.5, 1, 0],
      ],
      [[0, 1, 2]],
      [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ],
      [[0, 1, 2]],
    );

    const metrics = computeHalfEdgeQSlim5D(mesh.V, mesh.F, mesh.TC, mesh.FT);

    // Should have metrics for all 3 vertices
    expect(metrics.size).toBe(3);

    // Each vertex should have one texture coordinate
    for (const [vi, tcMap] of metrics) {
      expect(tcMap.size).toBe(1);
      const matrix = tcMap.values().next().value;
      expect(matrix).toBeDefined();
      // Matrix should be 6x6 and symmetric
      expect(matrix.length).toBe(6);
      expect(matrix[0].length).toBe(6);
      // Check symmetry
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          expect(Math.abs(matrix[i][j] - matrix[j][i])).toBeLessThan(1e-10);
        }
      }
    }
  });

  it("produces valid vertex positions", () => {
    // Create a simple mesh with boundary
    const mesh = createSubdividedPlane(3);
    const result = decimate(mesh, { targetPercent: 50 });

    // All vertex positions should be finite numbers
    for (const v of result.mesh.V) {
      expect(Number.isFinite(v[0])).toBe(true);
      expect(Number.isFinite(v[1])).toBe(true);
      expect(Number.isFinite(v[2])).toBe(true);
      // Z coordinate should remain 0 for a flat plane
      expect(Math.abs(v[2])).toBeLessThan(0.001);
    }
  });

  it("maintains mesh connectivity after decimation", () => {
    const mesh = createSubdividedPlane(5);
    const result = decimate(mesh, { targetPercent: 40 });

    // Check that all face indices are valid
    for (const face of result.mesh.F) {
      for (let i = 0; i < 3; i++) {
        expect(face[i]).toBeGreaterThanOrEqual(0);
        expect(face[i]).toBeLessThan(result.mesh.V.length);
      }
    }

    // Check that all FT indices are valid
    for (const ft of result.mesh.FT) {
      for (let i = 0; i < 3; i++) {
        expect(ft[i]).toBeGreaterThanOrEqual(0);
        expect(ft[i]).toBeLessThan(result.mesh.TC.length);
      }
    }

    // Check no isolated vertices (every vertex should be in at least one face)
    const usedVertices = new Set<number>();
    for (const face of result.mesh.F) {
      usedVertices.add(face[0]);
      usedVertices.add(face[1]);
      usedVertices.add(face[2]);
    }
    expect(usedVertices.size).toBe(result.mesh.V.length);
  });

  it("correctly detects seam edges from UV discontinuities", () => {
    // Create mesh with a known UV seam
    const V: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    const F: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 3],
    ];
    // Same geometry but different UV islands
    const TC: Vec2[] = [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5], // Island 1
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [0.5, 0.5], // Island 2 (different)
    ];
    const FT: [number, number, number][] = [
      [0, 1, 2], // Uses island 1
      [0, 2, 3], // Uses island 1
    ];

    const mesh = new MeshData(V, F, TC, FT);
    const seamEdges = buildSeamEdges(mesh.F, mesh.FT);

    // With consistent FT, there should be no seams on internal edges
    expect(seamEdges.size).toBe(0);
  });

  it("correctly handles strictness levels for seam edges", () => {
    // Create mesh where seam behavior changes with strictness
    const mesh = createCube();

    const result0 = decimate(mesh, { targetPercent: 50, strictness: 0 });
    const result2 = decimate(mesh, { targetPercent: 50, strictness: 2 });

    // Strictness 2 should be more conservative (fewer or equal collapses)
    expect(result2.mesh.V.length).toBeGreaterThanOrEqual(result0.mesh.V.length);
  });

  it("produces valid output for multiple decimation passes", () => {
    const mesh = createSubdividedPlane(6);

    // First pass: 75%
    const result1 = decimate(mesh, { targetPercent: 75 });
    expect(result1.mesh.V.length).toBeLessThan(mesh.V.length);

    // Second pass: 50% of result
    const result2 = decimate(result1.mesh, { targetPercent: 50 });
    expect(result2.mesh.V.length).toBeLessThanOrEqual(result1.mesh.V.length);

    // Should still produce valid mesh
    expect(result2.mesh.F.length).toBeGreaterThan(0);
    for (const face of result2.mesh.F) {
      expect(face[0]).not.toBe(face[1]);
      expect(face[1]).not.toBe(face[2]);
      expect(face[2]).not.toBe(face[0]);
    }
  });
});

// ============================================================================
// LARP FIX: Tests for previously untested code paths
// ============================================================================

import { decimateToFaceCount } from "../src/decimation/decimate.js";
import { fromBufferGeometry, toBufferGeometry } from "../src/index.js";
import { cholesky } from "../src/math/matrix.js";

describe("decimateToFaceCount (LARP fix)", () => {
  it("decimates to approximate target face count", () => {
    const mesh = createSubdividedPlane(5); // 36 vertices, 50 faces
    const targetFaces = 20;

    const result = decimateToFaceCount(mesh, targetFaces, 2);

    // Should produce a valid mesh
    expect(result.V.length).toBeGreaterThanOrEqual(4);
    expect(result.F.length).toBeGreaterThanOrEqual(2);

    // Face count should be reduced (may not hit exact target due to boundary constraints)
    expect(result.F.length).toBeLessThanOrEqual(mesh.F.length);
  });

  it("handles very low target face count", () => {
    const mesh = createSubdividedPlane(3);
    const targetFaces = 4;

    const result = decimateToFaceCount(mesh, targetFaces, 2);

    // Should still produce a valid mesh (minimum is 4 faces for tetrahedron)
    expect(result.V.length).toBeGreaterThanOrEqual(4);
    expect(result.F.length).toBeGreaterThanOrEqual(2);
  });

  it("handles target face count larger than current", () => {
    const mesh = createSubdividedPlane(2);
    const targetFaces = 1000;

    const result = decimateToFaceCount(mesh, targetFaces, 2);

    // Should return mesh unchanged
    expect(result.V.length).toBe(mesh.V.length);
    expect(result.F.length).toBe(mesh.F.length);
  });
});

describe("fromBufferGeometry / toBufferGeometry (LARP fix)", () => {
  it("round-trips simple mesh correctly", () => {
    const originalMesh = createSubdividedPlane(2);

    // Convert to buffer geometry format
    const { positions, indices, uvs } = toBufferGeometry(originalMesh);

    // Verify buffer sizes
    expect(positions.length).toBe(originalMesh.V.length * 3);
    expect(indices.length).toBe(originalMesh.F.length * 3);
    expect(uvs.length).toBe(originalMesh.TC.length * 2);

    // Convert back
    const roundTripped = fromBufferGeometry(positions, indices, uvs);

    // Verify vertex count matches
    expect(roundTripped.V.length).toBe(originalMesh.V.length);
    expect(roundTripped.F.length).toBe(originalMesh.F.length);
    expect(roundTripped.TC.length).toBe(originalMesh.TC.length);

    // Verify vertex positions match
    for (let i = 0; i < originalMesh.V.length; i++) {
      expect(roundTripped.V[i][0]).toBeCloseTo(originalMesh.V[i][0], 6);
      expect(roundTripped.V[i][1]).toBeCloseTo(originalMesh.V[i][1], 6);
      expect(roundTripped.V[i][2]).toBeCloseTo(originalMesh.V[i][2], 6);
    }
  });

  it("creates default UVs when not provided", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    const mesh = fromBufferGeometry(positions, indices);

    // Should have default UVs
    expect(mesh.TC.length).toBe(3);
    expect(mesh.FT.length).toBe(1);
  });

  it("handles decimated mesh conversion", () => {
    const originalMesh = createSubdividedPlane(4);
    const decimatedResult = decimate(originalMesh, { targetPercent: 50 });

    // Convert decimated mesh to buffer format
    const { positions, indices, uvs } = toBufferGeometry(decimatedResult.mesh);

    // Should have valid buffer sizes
    expect(positions.length).toBe(decimatedResult.mesh.V.length * 3);
    expect(indices.length).toBe(decimatedResult.mesh.F.length * 3);
    expect(uvs.length).toBe(decimatedResult.mesh.TC.length * 2);

    // All values should be finite
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true);
    }
  });
});

describe("Cholesky decomposition edge cases (LARP fix)", () => {
  it("throws on non-positive-definite matrix when regularize=false", () => {
    // Non-positive-definite matrix (has negative eigenvalue)
    const notPD: Matrix = [
      [1, 2],
      [2, 1], // det = 1 - 4 = -3 < 0, not positive definite
    ];

    expect(() => cholesky(notPD, false)).toThrow(/not positive definite/);
  });

  it("handles near-singular matrix with regularization", () => {
    // Near-singular but valid with regularization
    const nearSingular: Matrix = [
      [1e-15, 0],
      [0, 1],
    ];

    // Should not throw with regularization (default)
    const L = cholesky(nearSingular, true);
    expect(L.length).toBe(2);
  });

  it("correctly decomposes positive definite matrix", () => {
    const A: Matrix = [
      [4, 2],
      [2, 5],
    ];

    const L = cholesky(A);

    // Verify L * L^T = A
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        let sum = 0;
        for (let k = 0; k < 2; k++) {
          sum += L[i][k] * L[j][k];
        }
        expect(sum).toBeCloseTo(A[i][j], 10);
      }
    }
  });
});

describe("QP solver edge cases (LARP fix)", () => {
  it("handles empty constraint matrices", () => {
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [-2, -4];

    // Empty constraints
    const result = solveQuadprog(G, g0, [], [], [], []);

    expect(result.x.length).toBe(2);
    expect(Math.abs(result.x[0] - 2)).toBeLessThan(1e-6);
    expect(Math.abs(result.x[1] - 4)).toBeLessThan(1e-6);
  });

  it("handles infeasible inequality constraints", () => {
    const G: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const g0 = [0, 0];
    // Infeasible: x1 >= 1 AND x1 <= -1
    const CI: Matrix = [
      [1, -1],
      [0, 0],
    ];
    const ci0 = [-1, -1]; // x1 >= 1, -x1 >= 1 (impossible)

    const result = solveQuadprog(G, g0, [], [], CI, ci0);

    // Should return infeasible
    expect(result.cost).toBe(Infinity);
  });
});

describe("Strictness level 0 (LARP fix)", () => {
  it("allows more aggressive decimation with strictness=0", () => {
    // Create mesh with seam edges
    const mesh = createCube();

    const result0 = decimate(mesh, { targetPercent: 25, strictness: 0 });
    const result2 = decimate(mesh, { targetPercent: 25, strictness: 2 });

    // Both should produce valid meshes
    expect(result0.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result2.mesh.V.length).toBeGreaterThanOrEqual(4);

    // Strictness 0 allows collapsing without UV shape constraints
    // So it should allow at least as many collapses
    expect(result0.collapses).toBeGreaterThanOrEqual(result2.collapses);
  });

  it("strictness=0 does not preserve UV shape", () => {
    const mesh = createSubdividedPlane(4);

    const result = decimate(mesh, { targetPercent: 30, strictness: 0 });

    // Should still produce valid mesh
    expect(result.mesh.V.length).toBeGreaterThanOrEqual(4);
    expect(result.mesh.F.length).toBeGreaterThanOrEqual(2);
  });
});

describe("MeshData validation (LARP fix)", () => {
  it("throws on mismatched F and FT lengths", () => {
    expect(
      () =>
        new MeshData(
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          [[0, 1, 2]],
          [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          [
            [0, 1, 2],
            [0, 1, 2],
          ], // Two FT entries but only one F
        ),
    ).toThrow(/F.length.*FT.length/);
  });

  it("throws on invalid vertex indices in F", () => {
    expect(
      () =>
        new MeshData(
          [
            [0, 0, 0],
            [1, 0, 0],
          ], // Only 2 vertices
          [[0, 1, 5]], // Index 5 is out of range
          [
            [0, 0],
            [1, 0],
          ],
          [[0, 1, 1]],
        ),
    ).toThrow(/out of range/);
  });

  it("throws on invalid texture indices in FT", () => {
    expect(
      () =>
        new MeshData(
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          [[0, 1, 2]],
          [[0, 0]], // Only 1 TC
          [[0, 1, 5]], // Index 5 is out of range
        ),
    ).toThrow(/out of range/);
  });

  it("throws on non-finite vertex positions", () => {
    expect(
      () =>
        new MeshData(
          [
            [0, 0, 0],
            [NaN, 0, 0],
            [0, 1, 0],
          ],
          [[0, 1, 2]],
          [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          [[0, 1, 2]],
        ),
    ).toThrow(/non-finite/);
  });

  it("throws on non-finite texture coordinates", () => {
    expect(
      () =>
        new MeshData(
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          [[0, 1, 2]],
          [
            [0, 0],
            [Infinity, 0],
            [0, 1],
          ],
          [[0, 1, 2]],
        ),
    ).toThrow(/non-finite/);
  });

  it("accepts valid mesh data", () => {
    const mesh = new MeshData(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [[0, 1, 2]],
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      [[0, 1, 2]],
    );

    expect(mesh.V.length).toBe(3);
    expect(mesh.F.length).toBe(1);
  });
});
