/**
 * FrustumQuadtree.ts - 2D Spatial Partitioning for Frustum Culling
 *
 * A lightweight 2D quadtree optimized for frustum-based visibility queries.
 * Designed specifically for vegetation and other ground-based objects.
 *
 * **Why 2D Quadtree (not 3D Octree)?**
 * - Vegetation is placed on the XZ ground plane
 * - 2D queries are faster (4 children vs 8)
 * - Simpler frustum intersection tests
 *
 * **Features:**
 * - Frustum query with early termination (skip entire subtrees outside view)
 * - Distance-based queries for LOD decisions
 * - Efficient insert/remove for dynamic content
 * - Front-to-back ordering for optimal rendering
 *
 * **Performance:**
 * - Frustum query: O(log N) + O(V) where V = visible items
 * - Insert/Remove: O(log N)
 * - Memory: Minimal overhead per chunk
 *
 * **Integration:**
 * Used by VegetationSystem to replace O(N) linear iteration with O(log N) queries.
 */

import THREE from "../../extras/three/three";

// Reusable temporaries to avoid allocations in hot paths
const _box3 = new THREE.Box3();
const _sphere = new THREE.Sphere();

/**
 * Item stored in the quadtree - represents a chunk or other spatial object
 */
export interface QuadtreeItem {
  /** Unique identifier for this item */
  key: string;
  /** Center X position (world space) */
  centerX: number;
  /** Center Z position (world space) */
  centerZ: number;
  /** Bounding radius for frustum intersection */
  radius: number;
  /** Center Y position (for 3D frustum tests) */
  centerY: number;
}

/**
 * Configuration for the quadtree
 */
export interface FrustumQuadtreeConfig {
  /** World bounds center X */
  centerX: number;
  /** World bounds center Z */
  centerZ: number;
  /** Half-size of the world bounds (world is 2*halfSize x 2*halfSize) */
  halfSize: number;
  /** Maximum depth of the tree (default: 8) */
  maxDepth?: number;
  /** Maximum items per leaf node before subdivision (default: 16) */
  maxItemsPerNode?: number;
  /** Minimum Y for frustum intersection (default: -500) */
  yMin?: number;
  /** Maximum Y for frustum intersection (default: 1000) */
  yMax?: number;
}

/**
 * Internal node of the quadtree
 */
class QuadtreeNode {
  /** Center X of this node's bounds */
  centerX: number;
  /** Center Z of this node's bounds */
  centerZ: number;
  /** Half-size of this node's bounds */
  halfSize: number;
  /** Depth level (0 = root) */
  depth: number;
  /** Maximum depth allowed */
  maxDepth: number;
  /** Maximum items before subdivision */
  maxItems: number;
  /** Minimum Y for frustum intersection */
  yMin: number;
  /** Maximum Y for frustum intersection */
  yMax: number;
  /** Items stored in this node (only leaf nodes have items) */
  items: QuadtreeItem[] = [];
  /** Child nodes (NW, NE, SW, SE) or null if leaf */
  children: QuadtreeNode[] | null = null;
  /** Reference to item keys for O(1) lookup during removal */
  itemKeys: Set<string> = new Set();

  constructor(
    centerX: number,
    centerZ: number,
    halfSize: number,
    depth: number,
    maxDepth: number,
    maxItems: number,
    yMin: number,
    yMax: number,
  ) {
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.halfSize = halfSize;
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.maxItems = maxItems;
    this.yMin = yMin;
    this.yMax = yMax;
  }

  /**
   * Check if this node's 2D bounds intersect the frustum.
   * We convert the 2D bounds to a 3D box using the configured Y range.
   */
  intersectsFrustum(frustum: THREE.Frustum): boolean {
    // Create 3D box from 2D bounds with configured Y extent
    _box3.min.set(
      this.centerX - this.halfSize,
      this.yMin,
      this.centerZ - this.halfSize,
    );
    _box3.max.set(
      this.centerX + this.halfSize,
      this.yMax,
      this.centerZ + this.halfSize,
    );
    return frustum.intersectsBox(_box3);
  }

  /**
   * Check if an item's bounding sphere intersects the frustum
   */
  itemIntersectsFrustum(item: QuadtreeItem, frustum: THREE.Frustum): boolean {
    _sphere.center.set(item.centerX, item.centerY, item.centerZ);
    _sphere.radius = item.radius;
    return frustum.intersectsSphere(_sphere);
  }

  /**
   * Insert an item into this node or its children
   */
  insert(item: QuadtreeItem): boolean {
    // Check if item is within this node's bounds (with some tolerance for large items)
    const tolerance = item.radius;
    if (
      item.centerX < this.centerX - this.halfSize - tolerance ||
      item.centerX > this.centerX + this.halfSize + tolerance ||
      item.centerZ < this.centerZ - this.halfSize - tolerance ||
      item.centerZ > this.centerZ + this.halfSize + tolerance
    ) {
      return false;
    }

    // If we have children, insert into the appropriate child
    if (this.children) {
      for (const child of this.children) {
        if (child.insert(item)) {
          return true;
        }
      }
      // Item doesn't fit in any child, store here
      this.items.push(item);
      this.itemKeys.add(item.key);
      return true;
    }

    // Leaf node - add the item
    this.items.push(item);
    this.itemKeys.add(item.key);

    // Check if we should subdivide
    if (this.items.length > this.maxItems && this.depth < this.maxDepth) {
      this.subdivide();
    }

    return true;
  }

  /**
   * Subdivide this leaf node into 4 children
   */
  private subdivide(): void {
    const childHalfSize = this.halfSize / 2;
    const offsets = [
      { x: -childHalfSize, z: -childHalfSize }, // SW
      { x: childHalfSize, z: -childHalfSize }, // SE
      { x: -childHalfSize, z: childHalfSize }, // NW
      { x: childHalfSize, z: childHalfSize }, // NE
    ];

    this.children = offsets.map(
      (offset) =>
        new QuadtreeNode(
          this.centerX + offset.x,
          this.centerZ + offset.z,
          childHalfSize,
          this.depth + 1,
          this.maxDepth,
          this.maxItems,
          this.yMin,
          this.yMax,
        ),
    );

    // Re-insert existing items into children
    const itemsToReinsert = this.items;
    this.items = [];
    this.itemKeys.clear();

    for (const item of itemsToReinsert) {
      let inserted = false;
      for (const child of this.children) {
        if (child.insert(item)) {
          inserted = true;
          break;
        }
      }
      // If item doesn't fit in any child, keep it here
      if (!inserted) {
        this.items.push(item);
        this.itemKeys.add(item.key);
      }
    }
  }

  /**
   * Remove an item from this node or its children
   */
  remove(key: string): boolean {
    // Check if item is in this node
    if (this.itemKeys.has(key)) {
      const idx = this.items.findIndex((item) => item.key === key);
      if (idx !== -1) {
        this.items.splice(idx, 1);
        this.itemKeys.delete(key);
        return true;
      }
    }

    // Check children
    if (this.children) {
      for (const child of this.children) {
        if (child.remove(key)) {
          // Check if we should collapse children
          this.checkCollapse();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if children should be collapsed back into this node
   */
  private checkCollapse(): void {
    if (!this.children) return;

    // Count total items in all children
    let totalItems = this.items.length;
    let allLeaves = true;

    for (const child of this.children) {
      totalItems += child.getTotalItemCount();
      if (child.children) {
        allLeaves = false;
      }
    }

    // Collapse if all children are leaves and total items is small
    if (allLeaves && totalItems <= this.maxItems / 2) {
      for (const child of this.children) {
        for (const item of child.items) {
          this.items.push(item);
          this.itemKeys.add(item.key);
        }
      }
      this.children = null;
    }
  }

  /**
   * Get total number of items in this node and all descendants
   */
  getTotalItemCount(): number {
    let count = this.items.length;
    if (this.children) {
      for (const child of this.children) {
        count += child.getTotalItemCount();
      }
    }
    return count;
  }

  /**
   * Query items that intersect the frustum
   * @param frustum - Camera frustum to test against
   * @param results - Array to collect results
   * @param cameraX - Camera X position for distance sorting
   * @param cameraZ - Camera Z position for distance sorting
   */
  queryFrustum(
    frustum: THREE.Frustum,
    results: QuadtreeItem[],
    cameraX: number,
    cameraZ: number,
  ): void {
    // Early termination: if this node's bounds don't intersect frustum, skip entire subtree
    if (!this.intersectsFrustum(frustum)) {
      return;
    }

    // Add items from this node that intersect the frustum
    for (const item of this.items) {
      if (this.itemIntersectsFrustum(item, frustum)) {
        results.push(item);
      }
    }

    // Recursively query children
    if (this.children) {
      // Sort children by distance to camera for front-to-back traversal
      // This helps with early termination in depth-limited queries
      const sortedChildren = [...this.children].sort((a, b) => {
        const distA = (a.centerX - cameraX) ** 2 + (a.centerZ - cameraZ) ** 2;
        const distB = (b.centerX - cameraX) ** 2 + (b.centerZ - cameraZ) ** 2;
        return distA - distB;
      });

      for (const child of sortedChildren) {
        child.queryFrustum(frustum, results, cameraX, cameraZ);
      }
    }
  }

  /**
   * Query items within a radius of a point
   */
  queryRadius(
    centerX: number,
    centerZ: number,
    radius: number,
    results: QuadtreeItem[],
  ): void {
    // Check if this node's bounds intersect the query circle
    const closestX = Math.max(
      this.centerX - this.halfSize,
      Math.min(centerX, this.centerX + this.halfSize),
    );
    const closestZ = Math.max(
      this.centerZ - this.halfSize,
      Math.min(centerZ, this.centerZ + this.halfSize),
    );
    const distSq = (closestX - centerX) ** 2 + (closestZ - centerZ) ** 2;

    if (distSq > radius * radius) {
      return; // Node doesn't intersect query circle
    }

    // Add items from this node within radius
    for (const item of this.items) {
      const itemDistSq =
        (item.centerX - centerX) ** 2 + (item.centerZ - centerZ) ** 2;
      const totalRadius = radius + item.radius;
      if (itemDistSq <= totalRadius * totalRadius) {
        results.push(item);
      }
    }

    // Recursively query children
    if (this.children) {
      for (const child of this.children) {
        child.queryRadius(centerX, centerZ, radius, results);
      }
    }
  }

  /**
   * Get all items in this subtree
   */
  getAllItems(results: QuadtreeItem[]): void {
    for (const item of this.items) {
      results.push(item);
    }
    if (this.children) {
      for (const child of this.children) {
        child.getAllItems(results);
      }
    }
  }
}

/**
 * FrustumQuadtree - 2D spatial index optimized for frustum culling
 */
export class FrustumQuadtree {
  private root: QuadtreeNode;
  private itemLocations: Map<string, QuadtreeItem> = new Map();
  private yMin: number;
  private yMax: number;

  constructor(config: FrustumQuadtreeConfig) {
    const maxDepth = config.maxDepth ?? 8;
    const maxItems = config.maxItemsPerNode ?? 16;
    this.yMin = config.yMin ?? -500;
    this.yMax = config.yMax ?? 1000;

    this.root = new QuadtreeNode(
      config.centerX,
      config.centerZ,
      config.halfSize,
      0,
      maxDepth,
      maxItems,
      this.yMin,
      this.yMax,
    );
  }

  /**
   * Insert or update an item in the quadtree.
   * Returns true if the item was successfully inserted, false if outside bounds or invalid input.
   */
  insert(
    key: string,
    centerX: number,
    centerZ: number,
    centerY: number,
    radius: number,
  ): boolean {
    // Validate inputs
    if (!key || key.length === 0) {
      console.warn("[FrustumQuadtree] Cannot insert item with empty key");
      return false;
    }
    if (
      !Number.isFinite(centerX) ||
      !Number.isFinite(centerZ) ||
      !Number.isFinite(centerY)
    ) {
      console.warn(
        `[FrustumQuadtree] Cannot insert item ${key}: invalid position (${centerX}, ${centerY}, ${centerZ})`,
      );
      return false;
    }
    if (!Number.isFinite(radius) || radius < 0) {
      console.warn(
        `[FrustumQuadtree] Cannot insert item ${key}: invalid radius ${radius}`,
      );
      return false;
    }

    // Remove existing item if updating
    if (this.itemLocations.has(key)) {
      this.remove(key);
    }

    const item: QuadtreeItem = {
      key,
      centerX,
      centerZ,
      centerY,
      radius,
    };

    const inserted = this.root.insert(item);
    if (inserted) {
      this.itemLocations.set(key, item);
    }
    return inserted;
  }

  /**
   * Remove an item from the quadtree.
   * Returns true if the item existed and was removed.
   */
  remove(key: string): boolean {
    if (!this.itemLocations.has(key)) {
      return false;
    }

    // Always remove from itemLocations to maintain consistency
    // Even if tree removal fails (shouldn't happen), we clean up the tracking map
    this.itemLocations.delete(key);

    // Attempt tree removal - should always succeed if item was in itemLocations
    const removedFromTree = this.root.remove(key);
    if (!removedFromTree) {
      // This indicates a bug - item was in itemLocations but not in tree
      console.warn(
        `[FrustumQuadtree] Item ${key} was in tracking map but not in tree`,
      );
    }

    return true;
  }

  /**
   * Check if an item exists in the quadtree
   */
  has(key: string): boolean {
    return this.itemLocations.has(key);
  }

  /**
   * Get an item by key
   */
  get(key: string): QuadtreeItem | undefined {
    return this.itemLocations.get(key);
  }

  /**
   * Query all items that intersect the camera frustum.
   * Returns items sorted by distance to camera (front-to-back).
   *
   * @param frustum - Three.js frustum to test against
   * @param cameraX - Camera X position for distance sorting
   * @param cameraZ - Camera Z position for distance sorting
   * @returns Array of item keys that intersect the frustum
   */
  queryFrustum(
    frustum: THREE.Frustum,
    cameraX: number,
    cameraZ: number,
  ): string[] {
    const results: QuadtreeItem[] = [];
    this.root.queryFrustum(frustum, results, cameraX, cameraZ);

    // Sort by distance to camera (front-to-back)
    results.sort((a, b) => {
      const distA = (a.centerX - cameraX) ** 2 + (a.centerZ - cameraZ) ** 2;
      const distB = (b.centerX - cameraX) ** 2 + (b.centerZ - cameraZ) ** 2;
      return distA - distB;
    });

    return results.map((item) => item.key);
  }

  /**
   * Query all items within a radius of a point.
   * Returns items sorted by distance.
   *
   * @param centerX - Query center X
   * @param centerZ - Query center Z
   * @param radius - Query radius
   * @returns Array of item keys within radius
   */
  queryRadius(centerX: number, centerZ: number, radius: number): string[] {
    const results: QuadtreeItem[] = [];
    this.root.queryRadius(centerX, centerZ, radius, results);

    // Sort by distance
    results.sort((a, b) => {
      const distA = (a.centerX - centerX) ** 2 + (a.centerZ - centerZ) ** 2;
      const distB = (b.centerX - centerX) ** 2 + (b.centerZ - centerZ) ** 2;
      return distA - distB;
    });

    return results.map((item) => item.key);
  }

  /**
   * Get all items in the quadtree
   */
  getAllKeys(): string[] {
    return Array.from(this.itemLocations.keys());
  }

  /**
   * Get the total number of items
   */
  get size(): number {
    return this.itemLocations.size;
  }

  /**
   * Clear all items from the quadtree
   */
  clear(): void {
    this.root = new QuadtreeNode(
      this.root.centerX,
      this.root.centerZ,
      this.root.halfSize,
      0,
      this.root.maxDepth,
      this.root.maxItems,
      this.yMin,
      this.yMax,
    );
    this.itemLocations.clear();
  }
}
