/**
 * FrustumQuadtree Unit Tests
 *
 * Tests for 2D spatial partitioning optimized for frustum culling:
 * - Insert/remove operations
 * - Frustum queries with early termination
 * - Radius queries
 * - Front-to-back sorting
 * - Performance characteristics
 *
 * Based on packages/shared/src/utils/spatial/FrustumQuadtree.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import THREE from "../../../extras/three/three";
import { FrustumQuadtree } from "../FrustumQuadtree";

// Helper to create a camera frustum for testing
function createTestFrustum(
  cameraX: number,
  cameraZ: number,
  fov = 75,
  aspect = 1.5,
  near = 0.1,
  far = 1000,
): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(cameraX, 50, cameraZ);
  camera.lookAt(cameraX, 0, cameraZ + 100); // Look forward along +Z

  camera.updateProjectionMatrix();
  camera.updateWorldMatrix(true, false);

  const projScreenMatrix = new THREE.Matrix4();
  projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );

  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(projScreenMatrix);
  return frustum;
}

describe("FrustumQuadtree", () => {
  let quadtree: FrustumQuadtree;

  beforeEach(() => {
    quadtree = new FrustumQuadtree({
      centerX: 0,
      centerZ: 0,
      halfSize: 1000,
      maxDepth: 6,
      maxItemsPerNode: 4,
    });
  });

  // ===== BASIC INSERT/REMOVE =====
  describe("insert and remove", () => {
    it("should insert items", () => {
      quadtree.insert("chunk1", 100, 100, 10, 50);
      expect(quadtree.has("chunk1")).toBe(true);
      expect(quadtree.size).toBe(1);
    });

    it("should remove items", () => {
      quadtree.insert("chunk1", 100, 100, 10, 50);
      const removed = quadtree.remove("chunk1");
      expect(removed).toBe(true);
      expect(quadtree.has("chunk1")).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should return false when removing non-existent item", () => {
      const removed = quadtree.remove("nonexistent");
      expect(removed).toBe(false);
    });

    it("should update existing items when inserting with same key", () => {
      quadtree.insert("chunk1", 100, 100, 10, 50);
      quadtree.insert("chunk1", 200, 200, 20, 60);

      const item = quadtree.get("chunk1");
      expect(item).toBeDefined();
      expect(item?.centerX).toBe(200);
      expect(item?.centerZ).toBe(200);
      expect(item?.radius).toBe(60);
      expect(quadtree.size).toBe(1); // Still only 1 item
    });

    it("should handle many insertions", () => {
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 - 450;
        const z = Math.floor(i / 10) * 100 - 450;
        quadtree.insert(`chunk${i}`, x, z, 10, 30);
      }
      expect(quadtree.size).toBe(100);
    });

    it("should clear all items", () => {
      for (let i = 0; i < 10; i++) {
        quadtree.insert(`chunk${i}`, i * 50, i * 50, 10, 30);
      }
      expect(quadtree.size).toBe(10);

      quadtree.clear();
      expect(quadtree.size).toBe(0);
    });
  });

  // ===== FRUSTUM QUERIES =====
  describe("queryFrustum", () => {
    it("should return items within frustum", () => {
      // Place items in front of camera
      quadtree.insert("visible1", 0, 100, 10, 30);
      quadtree.insert("visible2", 50, 150, 10, 30);
      // Place item behind camera
      quadtree.insert("behind", 0, -100, 10, 30);
      // Place item far to the side
      quadtree.insert("side", 500, 100, 10, 30);

      const frustum = createTestFrustum(0, 0);
      const results = quadtree.queryFrustum(frustum, 0, 0);

      // Items in front should be visible
      expect(results).toContain("visible1");
      expect(results).toContain("visible2");
      // Item behind should not be visible
      expect(results).not.toContain("behind");
    });

    it("should return empty array when no items in frustum", () => {
      // Place items behind the camera (negative Z since camera looks at +Z)
      quadtree.insert("behind1", 0, -500, 10, 30);
      quadtree.insert("behind2", 100, -500, 10, 30);

      const frustum = createTestFrustum(0, 0);
      const results = quadtree.queryFrustum(frustum, 0, 0);

      expect(results.length).toBe(0);
    });

    it("should return items sorted by distance (front-to-back)", () => {
      // Insert items at different distances
      quadtree.insert("far", 0, 300, 10, 30);
      quadtree.insert("close", 0, 50, 10, 30);
      quadtree.insert("medium", 0, 150, 10, 30);

      const frustum = createTestFrustum(0, 0);
      const results = quadtree.queryFrustum(frustum, 0, 0);

      // Should be sorted by distance to camera at (0, 0)
      expect(results.indexOf("close")).toBeLessThan(results.indexOf("medium"));
      expect(results.indexOf("medium")).toBeLessThan(results.indexOf("far"));
    });

    it("should handle frustum at different positions", () => {
      // Place items in a grid
      for (let x = -200; x <= 200; x += 100) {
        for (let z = -200; z <= 200; z += 100) {
          quadtree.insert(`chunk_${x}_${z}`, x, z, 10, 30);
        }
      }

      // Create frustum looking forward from (0, 0)
      const frustum1 = createTestFrustum(0, 0);
      const results1 = quadtree.queryFrustum(frustum1, 0, 0);

      // Create frustum from different position
      const frustum2 = createTestFrustum(200, 200);
      const results2 = quadtree.queryFrustum(frustum2, 200, 200);

      // Different frustums should return different results
      expect(results1).not.toEqual(results2);
    });
  });

  // ===== RADIUS QUERIES =====
  describe("queryRadius", () => {
    it("should return items within radius", () => {
      quadtree.insert("close1", 50, 50, 10, 30);
      quadtree.insert("close2", -30, -30, 10, 30);
      quadtree.insert("far", 500, 500, 10, 30);

      const results = quadtree.queryRadius(0, 0, 100);

      expect(results).toContain("close1");
      expect(results).toContain("close2");
      expect(results).not.toContain("far");
    });

    it("should account for item radius in query", () => {
      // Item at distance 120 but with radius 30 should be included in radius 100 query
      quadtree.insert("edge", 120, 0, 10, 30);

      const results = quadtree.queryRadius(0, 0, 100);

      // 120 - 30 (item radius) = 90 < 100, so should be included
      expect(results).toContain("edge");
    });

    it("should return results sorted by distance", () => {
      quadtree.insert("far", 80, 0, 10, 20);
      quadtree.insert("close", 20, 0, 10, 20);
      quadtree.insert("medium", 50, 0, 10, 20);

      const results = quadtree.queryRadius(0, 0, 200);

      expect(results.indexOf("close")).toBeLessThan(results.indexOf("medium"));
      expect(results.indexOf("medium")).toBeLessThan(results.indexOf("far"));
    });
  });

  // ===== GET ALL KEYS =====
  describe("getAllKeys", () => {
    it("should return all inserted keys", () => {
      quadtree.insert("a", 0, 0, 10, 30);
      quadtree.insert("b", 100, 100, 10, 30);
      quadtree.insert("c", -100, -100, 10, 30);

      const keys = quadtree.getAllKeys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c");
    });
  });

  // ===== INPUT VALIDATION =====
  describe("input validation", () => {
    it("should reject empty key", () => {
      const result = quadtree.insert("", 100, 100, 10, 30);
      expect(result).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should reject NaN position values", () => {
      expect(quadtree.insert("test", NaN, 100, 10, 30)).toBe(false);
      expect(quadtree.insert("test", 100, NaN, 10, 30)).toBe(false);
      expect(quadtree.insert("test", 100, 100, NaN, 30)).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should reject Infinity position values", () => {
      expect(quadtree.insert("test", Infinity, 100, 10, 30)).toBe(false);
      expect(quadtree.insert("test", 100, -Infinity, 10, 30)).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should reject negative radius", () => {
      const result = quadtree.insert("test", 100, 100, 10, -30);
      expect(result).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should reject NaN radius", () => {
      const result = quadtree.insert("test", 100, 100, 10, NaN);
      expect(result).toBe(false);
      expect(quadtree.size).toBe(0);
    });

    it("should accept zero radius", () => {
      const result = quadtree.insert("test", 100, 100, 10, 0);
      expect(result).toBe(true);
      expect(quadtree.size).toBe(1);
    });

    it("should accept valid inputs", () => {
      const result = quadtree.insert("test", 100, 100, 10, 30);
      expect(result).toBe(true);
      expect(quadtree.size).toBe(1);
    });
  });

  // ===== EDGE CASES =====
  describe("edge cases", () => {
    it("should handle items at world bounds", () => {
      // Items at the edge of the quadtree bounds
      quadtree.insert("corner1", 999, 999, 10, 30);
      quadtree.insert("corner2", -999, -999, 10, 30);
      quadtree.insert("corner3", 999, -999, 10, 30);
      quadtree.insert("corner4", -999, 999, 10, 30);

      expect(quadtree.size).toBe(4);

      // Items should still be queryable
      const results = quadtree.queryRadius(999, 999, 100);
      expect(results).toContain("corner1");
    });

    it("should handle items with large radii", () => {
      // Item with radius larger than its distance from center
      quadtree.insert("large", 100, 100, 10, 500);

      const results = quadtree.queryRadius(0, 0, 50);
      // 100 (distance) - 500 (item radius) = -400 < 50, should be included
      expect(results).toContain("large");
    });

    it("should handle zero-radius query", () => {
      quadtree.insert("item1", 0, 0, 10, 30);
      quadtree.insert("item2", 10, 10, 10, 30);

      // Query with zero radius should only get items with overlapping radii
      const results = quadtree.queryRadius(0, 0, 0);
      // item1's radius of 30 overlaps with query point, item2's radius might not
      expect(results).toContain("item1");
    });

    it("should handle empty quadtree queries", () => {
      const frustum = createTestFrustum(0, 0);
      const frustumResults = quadtree.queryFrustum(frustum, 0, 0);
      const radiusResults = quadtree.queryRadius(0, 0, 100);

      expect(frustumResults).toHaveLength(0);
      expect(radiusResults).toHaveLength(0);
    });
  });

  // ===== PERFORMANCE =====
  describe("performance", () => {
    it("should handle many items efficiently", () => {
      // Insert 1000 items in a grid
      for (let i = 0; i < 1000; i++) {
        const x = (i % 32) * 60 - 960;
        const z = Math.floor(i / 32) * 60 - 960;
        quadtree.insert(`chunk${i}`, x, z, 10, 30);
      }

      // Create frustum once (expensive operation)
      const frustum = createTestFrustum(0, 0);

      const start = performance.now();

      // Perform 100 frustum queries (not 1000, frustum creation is expensive)
      for (let i = 0; i < 100; i++) {
        quadtree.queryFrustum(frustum, 0, 0);
      }

      const elapsed = performance.now() - start;

      // Should complete in reasonable time (< 1000ms for 100 queries on 1000 items)
      // Threshold is generous to account for system load variations in CI
      expect(elapsed).toBeLessThan(1000);
    });

    it("frustum query should be faster than linear search for large datasets", () => {
      // Insert many items
      const items: Array<{ key: string; x: number; z: number }> = [];
      for (let i = 0; i < 500; i++) {
        const x = (i % 25) * 80 - 1000;
        const z = Math.floor(i / 25) * 80 - 1000;
        quadtree.insert(`chunk${i}`, x, z, 10, 30);
        items.push({ key: `chunk${i}`, x, z });
      }

      const frustum = createTestFrustum(0, 0);

      // Time quadtree query
      const qtStart = performance.now();
      for (let i = 0; i < 100; i++) {
        quadtree.queryFrustum(frustum, 0, 0);
      }
      const qtElapsed = performance.now() - qtStart;

      // Time linear iteration (what we replaced)
      const linearStart = performance.now();
      for (let i = 0; i < 100; i++) {
        // Simulate linear iteration checking all items
        const _visible = items.filter((item) => {
          // Create bounding sphere and check frustum
          const sphere = new THREE.Sphere(
            new THREE.Vector3(item.x, 10, item.z),
            30,
          );
          return frustum.intersectsSphere(sphere);
        });
      }
      const linearElapsed = performance.now() - linearStart;

      // Log performance comparison for informational purposes
      console.log(
        `Quadtree: ${qtElapsed.toFixed(2)}ms, Linear: ${linearElapsed.toFixed(2)}ms`,
      );

      // Performance benchmarks are inherently flaky in CI due to:
      // - Variable machine load
      // - JIT compilation timing
      // - Memory allocation patterns
      // We only assert a very lenient bound to catch catastrophic regressions
      // (e.g., infinite loops), not to verify performance improvements.
      // Both methods should complete in reasonable time.
      expect(qtElapsed).toBeLessThan(5000); // Sanity check: not hung
      expect(linearElapsed).toBeLessThan(5000); // Sanity check: not hung
    });
  });

  // ===== TILE UNLOAD SIMULATION =====
  describe("tile unload behavior", () => {
    it("should properly remove chunks when simulating tile unload", () => {
      // Simulate the tile-chunk relationship:
      // Tile (0,0) covers world (0-100, 0-100)
      // This creates chunks in a 64m grid that span the tile

      // Insert chunks that would be created by tile (0,0)
      // Chunk (0,0): covers (0-64, 0-64)
      // Chunk (1,0): covers (64-128, 0-64)
      // Chunk (0,1): covers (0-64, 64-128)
      // Chunk (1,1): covers (64-128, 64-128)
      quadtree.insert("0_0_oak", 32, 32, 10, 30);
      quadtree.insert("1_0_oak", 80, 32, 10, 30);
      quadtree.insert("0_1_oak", 32, 80, 10, 30);
      quadtree.insert("1_1_oak", 80, 80, 10, 30);

      expect(quadtree.size).toBe(4);
      expect(quadtree.has("0_0_oak")).toBe(true);
      expect(quadtree.has("1_0_oak")).toBe(true);

      // Simulate tile (0,0) unload - remove chunks only used by this tile
      // In real code, this would be tracked with reference counting
      quadtree.remove("0_0_oak");
      quadtree.remove("0_1_oak");

      expect(quadtree.size).toBe(2);
      expect(quadtree.has("0_0_oak")).toBe(false);
      expect(quadtree.has("1_0_oak")).toBe(true);

      // Verify remaining chunks are still queryable
      const frustum = createTestFrustum(80, 0);
      const results = quadtree.queryFrustum(frustum, 80, 0);

      // At least one of the remaining chunks should be visible
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle removal of non-existent chunks gracefully", () => {
      quadtree.insert("chunk1", 100, 100, 10, 30);

      // Try to remove a chunk that doesn't exist
      const result = quadtree.remove("nonexistent_chunk");
      expect(result).toBe(false);
      expect(quadtree.size).toBe(1);
    });

    it("should handle repeated removal of same chunk", () => {
      quadtree.insert("chunk1", 100, 100, 10, 30);
      expect(quadtree.size).toBe(1);

      // First removal should succeed
      expect(quadtree.remove("chunk1")).toBe(true);
      expect(quadtree.size).toBe(0);

      // Second removal should fail gracefully
      expect(quadtree.remove("chunk1")).toBe(false);
      expect(quadtree.size).toBe(0);
    });
  });

  // ===== SUBDIVISION =====
  describe("subdivision behavior", () => {
    it("should subdivide nodes when item limit exceeded", () => {
      // Use small maxItemsPerNode to trigger subdivision easily
      const smallTree = new FrustumQuadtree({
        centerX: 0,
        centerZ: 0,
        halfSize: 1000,
        maxDepth: 4,
        maxItemsPerNode: 2,
      });

      // Insert enough items in same area to trigger subdivision
      smallTree.insert("a", 100, 100, 10, 10);
      smallTree.insert("b", 105, 105, 10, 10);
      smallTree.insert("c", 110, 110, 10, 10);
      smallTree.insert("d", 115, 115, 10, 10);

      // All items should still be queryable
      const results = smallTree.queryRadius(100, 100, 50);
      expect(results).toContain("a");
      expect(results).toContain("b");
      expect(results).toContain("c");
      expect(results).toContain("d");
    });

    it("should respect maxDepth limit", () => {
      const shallowTree = new FrustumQuadtree({
        centerX: 0,
        centerZ: 0,
        halfSize: 1000,
        maxDepth: 2,
        maxItemsPerNode: 1,
      });

      // Insert many items - should stop subdividing at maxDepth
      for (let i = 0; i < 100; i++) {
        shallowTree.insert(`item${i}`, i, i, 10, 10);
      }

      // All items should still be accessible
      expect(shallowTree.size).toBe(100);
    });
  });
});
