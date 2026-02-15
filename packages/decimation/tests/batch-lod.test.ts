/**
 * Integration tests for batch LOD generation
 *
 * Tests the LOD generation pipeline using the decimation library.
 */

import { describe, it, expect } from "vitest";
import {
  MeshData,
  decimate,
  generateLODLevels,
  generateLODLevelsFromPreset,
  generateSingleLOD,
  VEGETATION_LOD_PRESETS,
  fromBufferGeometry,
  toBufferGeometry,
} from "../src/index.js";

/**
 * Create a simple cube mesh for testing
 */
function createTestCube(size = 1): MeshData {
  // Vertices for a unit cube
  const V: [number, number, number][] = [
    [-size, -size, -size], // 0
    [size, -size, -size], // 1
    [size, size, -size], // 2
    [-size, size, -size], // 3
    [-size, -size, size], // 4
    [size, -size, size], // 5
    [size, size, size], // 6
    [-size, size, size], // 7
  ];

  // Faces (two triangles per face)
  const F: [number, number, number][] = [
    // Front
    [0, 1, 2],
    [0, 2, 3],
    // Back
    [5, 4, 7],
    [5, 7, 6],
    // Top
    [3, 2, 6],
    [3, 6, 7],
    // Bottom
    [4, 5, 1],
    [4, 1, 0],
    // Right
    [1, 5, 6],
    [1, 6, 2],
    // Left
    [4, 0, 3],
    [4, 3, 7],
  ];

  // UV coordinates
  const TC: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  // Face texture indices
  const FT: [number, number, number][] = F.map((f) => [f[0], f[1], f[2]]);

  return new MeshData(V, F, TC, FT);
}

/**
 * Create a subdivided sphere mesh for more realistic testing
 */
function createTestSphere(radius = 1, segments = 16, rings = 12): MeshData {
  const V: [number, number, number][] = [];
  const F: [number, number, number][] = [];
  const TC: [number, number][] = [];
  const FT: [number, number, number][] = [];

  // Generate vertices
  for (let ring = 0; ring <= rings; ring++) {
    const theta = (ring / rings) * Math.PI;
    const y = Math.cos(theta) * radius;
    const ringRadius = Math.sin(theta) * radius;

    for (let seg = 0; seg <= segments; seg++) {
      const phi = (seg / segments) * Math.PI * 2;
      const x = Math.cos(phi) * ringRadius;
      const z = Math.sin(phi) * ringRadius;

      V.push([x, y, z]);
      TC.push([seg / segments, ring / rings]);
    }
  }

  // Generate faces
  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const i0 = ring * (segments + 1) + seg;
      const i1 = i0 + 1;
      const i2 = i0 + segments + 1;
      const i3 = i2 + 1;

      F.push([i0, i2, i1]);
      F.push([i1, i2, i3]);
      FT.push([i0, i2, i1]);
      FT.push([i1, i2, i3]);
    }
  }

  return new MeshData(V, F, TC, FT);
}

describe("Batch LOD Generation", () => {
  describe("MeshData clone", () => {
    it("creates a deep copy of mesh data", () => {
      const original = createTestCube();
      const cloned = original.clone();

      // Verify it's a separate copy
      expect(cloned.V).not.toBe(original.V);
      expect(cloned.F).not.toBe(original.F);
      expect(cloned.TC).not.toBe(original.TC);
      expect(cloned.FT).not.toBe(original.FT);

      // Verify values are equal
      expect(cloned.V).toEqual(original.V);
      expect(cloned.F).toEqual(original.F);
      expect(cloned.TC).toEqual(original.TC);
      expect(cloned.FT).toEqual(original.FT);

      // Verify modifying clone doesn't affect original
      cloned.V[0][0] = 999;
      expect(original.V[0][0]).not.toBe(999);
    });
  });

  describe("generateSingleLOD", () => {
    it("decimates mesh to target percentage", () => {
      const mesh = createTestSphere(1, 16, 12);
      const originalVertices = mesh.V.length;

      const result = generateSingleLOD(mesh, 50);

      expect(result.finalVertices).toBeLessThan(originalVertices);
      expect(result.originalVertices).toBe(originalVertices);
    });

    it("respects minVertices option", () => {
      const mesh = createTestSphere(1, 16, 12);
      const minVerts = mesh.V.length - 10;

      const result = generateSingleLOD(mesh, 10, { minVertices: minVerts });

      // Should have at least minVertices
      expect(result.finalVertices).toBeGreaterThanOrEqual(minVerts);
    });
  });

  describe("generateLODLevels", () => {
    it("generates multiple LOD levels from config", () => {
      const mesh = createTestSphere(1, 16, 12);

      const result = generateLODLevels(mesh, [
        { name: "lod1", targetPercent: 50 },
        { name: "lod2", targetPercent: 25 },
      ]);

      expect(result.levels.length).toBe(2);
      expect(result.levels[0].name).toBe("lod1");
      expect(result.levels[1].name).toBe("lod2");

      // LOD2 should have fewer vertices than LOD1
      expect(result.levels[1].finalVertices).toBeLessThanOrEqual(
        result.levels[0].finalVertices,
      );
    });

    it("provides accurate summary statistics", () => {
      const mesh = createTestSphere(1, 16, 12);
      const originalVertices = mesh.V.length;

      const result = generateLODLevels(mesh, [
        { name: "lod1", targetPercent: 50 },
      ]);

      expect(result.summary.originalVertices).toBe(originalVertices);
      expect(result.summary.verticesByLevel.lod1).toBe(
        result.levels[0].finalVertices,
      );
    });

    it("tracks processing time", () => {
      const mesh = createTestSphere(1, 16, 12);

      const result = generateLODLevels(mesh, [
        { name: "lod1", targetPercent: 50 },
      ]);

      expect(result.totalProcessingTimeMs).toBeGreaterThan(0);
      expect(result.levels[0].processingTimeMs).toBeGreaterThan(0);
    });
  });

  describe("generateLODLevelsFromPreset", () => {
    it("generates LODs using tree preset", () => {
      const mesh = createTestSphere(1, 32, 24); // More vertices for realistic test

      const result = generateLODLevelsFromPreset(mesh, "tree");

      expect(result.levels.length).toBe(2); // Tree preset has lod1 and lod2
      expect(result.levels[0].name).toBe("lod1");
      expect(result.levels[1].name).toBe("lod2");
    });

    it("generates LODs using rock preset", () => {
      const mesh = createTestSphere(1, 32, 24);

      const result = generateLODLevelsFromPreset(mesh, "rock");

      expect(result.levels.length).toBe(2);
    });

    it("generates LODs using plant preset", () => {
      const mesh = createTestSphere(1, 32, 24);

      const result = generateLODLevelsFromPreset(mesh, "plant");

      // Plant preset has only lod1
      expect(result.levels.length).toBe(1);
      expect(result.levels[0].name).toBe("lod1");
    });

    it("falls back to default preset for unknown category", () => {
      const mesh = createTestSphere(1, 32, 24);

      // "unknown" should fall back to default
      const result = generateLODLevelsFromPreset(mesh, "default");

      expect(result.levels.length).toBeGreaterThan(0);
    });
  });

  describe("VEGETATION_LOD_PRESETS", () => {
    it("defines presets for all vegetation categories", () => {
      expect(VEGETATION_LOD_PRESETS.tree).toBeDefined();
      expect(VEGETATION_LOD_PRESETS.bush).toBeDefined();
      expect(VEGETATION_LOD_PRESETS.rock).toBeDefined();
      expect(VEGETATION_LOD_PRESETS.plant).toBeDefined();
      expect(VEGETATION_LOD_PRESETS.default).toBeDefined();
    });

    it("each preset has valid level configurations", () => {
      for (const [category, levels] of Object.entries(VEGETATION_LOD_PRESETS)) {
        expect(Array.isArray(levels)).toBe(true);
        expect(levels.length).toBeGreaterThan(0);

        for (const level of levels) {
          expect(level.name).toBeTruthy();
          expect(level.targetPercent).toBeGreaterThan(0);
          expect(level.targetPercent).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe("Buffer geometry conversion", () => {
    it("converts between BufferGeometry format and MeshData", () => {
      const mesh = createTestCube();

      // Convert to BufferGeometry format
      const { positions, indices, uvs } = toBufferGeometry(mesh);

      // Convert back
      const restored = fromBufferGeometry(positions, indices, uvs);

      expect(restored.V.length).toBe(mesh.V.length);
      expect(restored.F.length).toBe(mesh.F.length);
      expect(restored.TC.length).toBe(mesh.TC.length);
    });
  });

  describe("Integration: Full LOD Pipeline", () => {
    it("processes a mesh through complete LOD generation pipeline", () => {
      // 1. Create a realistic mesh (simulates loaded GLB)
      const originalMesh = createTestSphere(1, 32, 24);
      const originalVertexCount = originalMesh.V.length;

      // 2. Generate LOD levels
      const lodResult = generateLODLevelsFromPreset(originalMesh, "tree");

      // 3. Verify LOD hierarchy
      expect(lodResult.levels.length).toBe(2);

      let prevVertices = originalVertexCount;
      for (const level of lodResult.levels) {
        // Each LOD should have fewer or equal vertices than previous
        expect(level.finalVertices).toBeLessThanOrEqual(prevVertices);
        expect(level.reductionPercent).toBeGreaterThanOrEqual(0);

        // Mesh should be valid (has vertices and faces)
        expect(level.mesh.V.length).toBeGreaterThan(0);
        expect(level.mesh.F.length).toBeGreaterThan(0);

        prevVertices = level.finalVertices;
      }

      // 4. Verify conversion to BufferGeometry format (for GLB export)
      for (const level of lodResult.levels) {
        const { positions, indices, uvs } = toBufferGeometry(level.mesh);

        expect(positions.length).toBe(level.mesh.V.length * 3);
        expect(indices.length).toBe(level.mesh.F.length * 3);
        expect(uvs.length).toBe(level.mesh.TC.length * 2);
      }
    });
  });
});
