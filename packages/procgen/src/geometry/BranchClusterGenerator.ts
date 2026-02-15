/**
 * Branch-Aware Leaf Cluster Generator (SpeedTree Style)
 *
 * Unlike the basic LeafClusterGenerator which uses pure spatial octree clustering,
 * this generator creates clusters based on actual branch structures:
 *
 * SpeedTree Approach:
 * 1. Isolate a branch structure with its leaves
 * 2. Render it orthographically to a texture
 * 3. Use collision detection to remove overlapping leaves in screen space
 * 4. Generate cutout mesh that follows leaf silhouettes
 *
 * This produces much more natural-looking clusters because they represent
 * actual branch+leaf formations rather than arbitrary spatial groupings.
 *
 * Industry references: SpeedTree, Assassin's Creed, Far Cry vegetation
 */

import * as THREE from "three";
import type { LeafData, TreeParams, StemData } from "../types.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended leaf data with branch information for proper clustering.
 */
export interface BranchLeafData extends LeafData {
  /** Index of the stem this leaf belongs to */
  stemIndex: number;
  /** Depth level in tree hierarchy (0=trunk, 1=primary branches, etc.) */
  stemDepth: number;
  /** Parameter along stem (0-1) where leaf is attached */
  stemOffset: number;
}

/**
 * A branch-based cluster representing a real branch structure with leaves.
 */
export interface BranchCluster {
  /** Unique cluster ID */
  id: number;
  /** Stem index this cluster is based on (-1 if combined) */
  stemIndex: number;
  /** Stem depth level */
  stemDepth: number;
  /** Center position of the cluster (world space) */
  center: THREE.Vector3;
  /** Billboard orientation - direction to face (typically away from branch) */
  billboardNormal: THREE.Vector3;
  /** Billboard up vector */
  billboardUp: THREE.Vector3;
  /** Bounding box of the cluster */
  bounds: THREE.Box3;
  /** Indices of leaves in this cluster (into the leaves array) */
  leafIndices: number[];
  /** Billboard width in world units */
  width: number;
  /** Billboard height in world units */
  height: number;
  /** Cluster density (leaves per unit area) */
  density: number;
  /** Average leaf facing direction */
  avgLeafDirection: THREE.Vector3;
  /** Whether leaves have been culled for overlap */
  overlapCulled: boolean;
}

/**
 * Result of branch-based clustering.
 */
export interface BranchClusterResult {
  /** Generated branch clusters */
  clusters: BranchCluster[];
  /** Enhanced leaf data with branch info */
  leaves: BranchLeafData[];
  /** Tree parameters */
  params: TreeParams;
  /** Stem data for reference */
  stems: StemData[];
  /** Statistics */
  stats: {
    totalLeaves: number;
    clusterCount: number;
    avgLeavesPerCluster: number;
    leavesCulledForOverlap: number;
    reductionRatio: number;
  };
}

/**
 * Options for branch-based clustering.
 */
export interface BranchClusterOptions {
  /** Minimum stem depth to create clusters from (default: 2) */
  minStemDepth?: number;
  /** Maximum leaves per cluster before splitting (default: 40) */
  maxLeavesPerCluster?: number;
  /** Minimum leaves to form a cluster (default: 3) */
  minLeavesPerCluster?: number;
  /** Enable overlap culling in screen space (default: true) */
  cullOverlappingLeaves?: boolean;
  /** Overlap threshold for culling (0-1, default: 0.3) */
  overlapThreshold?: number;
  /** Target cluster count (will merge if too many) */
  targetClusterCount?: number;
  /** Texture resolution for baking (affects quality) */
  textureSize?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<BranchClusterOptions> = {
  minStemDepth: 1, // Start from first level branches
  maxLeavesPerCluster: 40,
  minLeavesPerCluster: 3,
  cullOverlappingLeaves: true,
  overlapThreshold: 0.3,
  targetClusterCount: 80,
  textureSize: 256,
};

// ============================================================================
// BRANCH CLUSTER GENERATOR
// ============================================================================

/**
 * Generates leaf clusters based on branch structures (SpeedTree style).
 *
 * Algorithm:
 * 1. Group leaves by their parent stem
 * 2. For each stem with leaves, create a cluster
 * 3. Calculate optimal billboard orientation (perpendicular to branch)
 * 4. Cull overlapping leaves in screen space
 * 5. Merge small clusters, split large ones
 * 6. Calculate final billboard dimensions
 */
export class BranchClusterGenerator {
  private options: Required<BranchClusterOptions>;

  constructor(options: BranchClusterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate branch-based clusters from tree data.
   *
   * @param leaves - Raw leaf data from tree generation
   * @param stems - Stem data from tree generation
   * @param params - Tree parameters
   * @returns Branch cluster result
   */
  generateClusters(
    leaves: LeafData[],
    stems: StemData[],
    params: TreeParams,
  ): BranchClusterResult {
    if (leaves.length === 0) {
      return this.emptyResult(params);
    }

    // Step 1: Enhance leaves with branch information
    const branchLeaves = this.assignLeavesToBranches(leaves, stems);

    // Step 2: Group leaves by stem
    const stemLeafGroups = this.groupLeavesByStems(branchLeaves);

    // Step 3: Create initial clusters from stem groups
    let clusters = this.createClustersFromStemGroups(
      stemLeafGroups,
      branchLeaves,
      stems,
    );

    // Step 4: Cull overlapping leaves within each cluster
    let totalCulled = 0;
    if (this.options.cullOverlappingLeaves) {
      for (const cluster of clusters) {
        const culled = this.cullOverlappingLeaves(cluster, branchLeaves);
        totalCulled += culled;
      }
    }

    // Step 5: Split large clusters
    clusters = this.splitLargeClusters(clusters, branchLeaves);

    // Step 6: Merge small clusters
    clusters = this.mergeSmallClusters(clusters, branchLeaves);

    // Step 7: Finalize clusters with proper dimensions
    clusters = clusters.map((c, i) => this.finalizeCluster(c, i, branchLeaves));

    // Step 8: Sort by distance from tree center (back to front for rendering)
    clusters.sort((a, b) => {
      return b.center.length() - a.center.length();
    });

    return {
      clusters,
      leaves: branchLeaves,
      params,
      stems,
      stats: {
        totalLeaves: branchLeaves.length,
        clusterCount: clusters.length,
        avgLeavesPerCluster:
          clusters.length > 0 ? branchLeaves.length / clusters.length : 0,
        leavesCulledForOverlap: totalCulled,
        reductionRatio:
          clusters.length > 0 ? branchLeaves.length / clusters.length : 0,
      },
    };
  }

  /**
   * Assign each leaf to its parent branch based on position.
   */
  private assignLeavesToBranches(
    leaves: LeafData[],
    stems: StemData[],
  ): BranchLeafData[] {
    return leaves.map((leaf) => {
      // Find the stem closest to this leaf
      let bestStemIndex = 0;
      let bestDistance = Infinity;
      let bestOffset = 0;
      let bestDepth = 0;

      for (let i = 0; i < stems.length; i++) {
        const stem = stems[i];
        const points = stem.points;

        // Check distance to each segment of the stem
        for (let j = 0; j < points.length - 1; j++) {
          const p1 = points[j].position;
          const p2 = points[j + 1].position;

          // Project leaf position onto segment
          const seg = new THREE.Vector3().subVectors(p2, p1);
          const segLen = seg.length();
          if (segLen < 0.001) continue;

          const toLeaf = new THREE.Vector3().subVectors(leaf.position, p1);
          let t = toLeaf.dot(seg) / (segLen * segLen);
          t = Math.max(0, Math.min(1, t));

          const closest = new THREE.Vector3().addVectors(
            p1,
            seg.clone().multiplyScalar(t),
          );
          const dist = leaf.position.distanceTo(closest);

          if (dist < bestDistance) {
            bestDistance = dist;
            bestStemIndex = i;
            bestOffset = (j + t) / (points.length - 1);
            bestDepth = stem.depth;
          }
        }
      }

      return {
        ...leaf,
        stemIndex: bestStemIndex,
        stemDepth: bestDepth,
        stemOffset: bestOffset,
      };
    });
  }

  /**
   * Group leaves by their parent stem.
   */
  private groupLeavesByStems(leaves: BranchLeafData[]): Map<number, number[]> {
    const groups = new Map<number, number[]>();

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const stemIndex = leaf.stemIndex;

      if (!groups.has(stemIndex)) {
        groups.set(stemIndex, []);
      }
      groups.get(stemIndex)!.push(i);
    }

    return groups;
  }

  /**
   * Create initial clusters from stem leaf groups.
   */
  private createClustersFromStemGroups(
    stemGroups: Map<number, number[]>,
    leaves: BranchLeafData[],
    stems: StemData[],
  ): BranchCluster[] {
    const clusters: BranchCluster[] = [];

    for (const [stemIndex, leafIndices] of stemGroups) {
      // Skip stems with too few leaves
      if (leafIndices.length < this.options.minLeavesPerCluster) {
        continue;
      }

      const stem = stems[stemIndex];

      // Skip stems that are too shallow (trunk level)
      if (stem.depth < this.options.minStemDepth) {
        continue;
      }

      // Calculate cluster properties from leaves
      const cluster = this.createClusterFromLeaves(
        leafIndices,
        leaves,
        stem,
        stemIndex,
      );

      if (cluster) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Create a cluster from a set of leaves on a stem.
   */
  private createClusterFromLeaves(
    leafIndices: number[],
    leaves: BranchLeafData[],
    stem: StemData,
    stemIndex: number,
  ): BranchCluster | null {
    if (leafIndices.length === 0) return null;

    // Calculate bounding box and center
    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    const avgDirection = new THREE.Vector3();

    for (const idx of leafIndices) {
      const leaf = leaves[idx];
      bounds.expandByPoint(leaf.position);
      center.add(leaf.position);
      avgDirection.add(leaf.direction);
    }

    center.divideScalar(leafIndices.length);
    avgDirection.normalize();

    // Calculate billboard orientation
    // Billboard should be VERTICAL (Y-up) and face OUTWARD from tree center
    // This matches how tree leaves naturally form clusters that face outward

    // Outward direction from tree center (in XZ plane, ignoring Y)
    const outward = new THREE.Vector3(center.x, 0, center.z);
    if (outward.lengthSq() < 0.001) {
      // If cluster is directly above trunk, use average leaf direction projected to XZ
      outward.set(avgDirection.x, 0, avgDirection.z);
    }
    outward.normalize();

    // Billboard normal faces outward from tree center (horizontal)
    const billboardNormal = outward.clone();

    // Billboard up is always vertical (Y-up)
    // This ensures clusters stand upright like real leaf clusters
    const billboardUp = new THREE.Vector3(0, 1, 0);

    // Calculate size
    const size = new THREE.Vector3();
    bounds.getSize(size);

    return {
      id: 0, // Will be assigned later
      stemIndex,
      stemDepth: stem.depth,
      center,
      billboardNormal,
      billboardUp,
      bounds,
      leafIndices: [...leafIndices],
      width: Math.max(size.x, size.z) * 1.2, // Add padding
      height: size.y * 1.2,
      density: leafIndices.length / Math.max(0.01, size.x * size.z),
      avgLeafDirection: avgDirection,
      overlapCulled: false,
    };
  }

  /**
   * Cull overlapping leaves in screen space (billboard view).
   * Returns number of leaves culled.
   */
  private cullOverlappingLeaves(
    cluster: BranchCluster,
    leaves: BranchLeafData[],
  ): number {
    if (cluster.leafIndices.length < 2) return 0;

    // Create a view matrix looking at the cluster from the billboard normal direction
    const viewMatrix = new THREE.Matrix4();
    const eye = cluster.center
      .clone()
      .add(cluster.billboardNormal.clone().multiplyScalar(10));
    viewMatrix.lookAt(eye, cluster.center, cluster.billboardUp);

    // Project all leaves to 2D screen space
    interface LeafProjection {
      index: number;
      x: number;
      y: number;
      size: number;
    }

    const projections: LeafProjection[] = [];
    const leafSize = 0.15; // Approximate leaf size in world units

    for (const idx of cluster.leafIndices) {
      const leaf = leaves[idx];
      const projected = leaf.position.clone().applyMatrix4(viewMatrix);
      projections.push({
        index: idx,
        x: projected.x,
        y: projected.y,
        size: leafSize,
      });
    }

    // Sort by distance from cluster center (keep outer leaves)
    projections.sort((a, b) => {
      const distA = Math.sqrt(a.x * a.x + a.y * a.y);
      const distB = Math.sqrt(b.x * b.x + b.y * b.y);
      return distB - distA; // Keep outer leaves first
    });

    // Remove overlapping leaves
    const kept = new Set<number>();
    const threshold = this.options.overlapThreshold;

    for (const proj of projections) {
      let overlapping = false;

      // Check against already-kept leaves
      for (const keptIdx of kept) {
        const keptProj = projections.find((p) => p.index === keptIdx);
        if (!keptProj) continue;

        const dx = proj.x - keptProj.x;
        const dy = proj.y - keptProj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < proj.size * threshold) {
          overlapping = true;
          break;
        }
      }

      if (!overlapping) {
        kept.add(proj.index);
      }
    }

    const culled = cluster.leafIndices.length - kept.size;
    cluster.leafIndices = Array.from(kept);
    cluster.overlapCulled = culled > 0;

    return culled;
  }

  /**
   * Split clusters that are too large.
   */
  private splitLargeClusters(
    clusters: BranchCluster[],
    leaves: BranchLeafData[],
  ): BranchCluster[] {
    const result: BranchCluster[] = [];
    const maxLeaves = this.options.maxLeavesPerCluster;

    for (const cluster of clusters) {
      if (cluster.leafIndices.length <= maxLeaves) {
        result.push(cluster);
        continue;
      }

      // Split along the longest axis of the bounding box
      const size = new THREE.Vector3();
      cluster.bounds.getSize(size);

      let splitAxis: "x" | "y" | "z" = "x";
      if (size.y > size.x && size.y > size.z) splitAxis = "y";
      else if (size.z > size.x) splitAxis = "z";

      const splitValue = cluster.center[splitAxis];

      const leftIndices: number[] = [];
      const rightIndices: number[] = [];

      for (const idx of cluster.leafIndices) {
        if (leaves[idx].position[splitAxis] < splitValue) {
          leftIndices.push(idx);
        } else {
          rightIndices.push(idx);
        }
      }

      // Create sub-clusters
      if (leftIndices.length >= this.options.minLeavesPerCluster) {
        const leftCluster = this.createSubCluster(leftIndices, leaves, cluster);
        if (leftCluster) result.push(leftCluster);
      }

      if (rightIndices.length >= this.options.minLeavesPerCluster) {
        const rightCluster = this.createSubCluster(
          rightIndices,
          leaves,
          cluster,
        );
        if (rightCluster) result.push(rightCluster);
      }
    }

    return result;
  }

  /**
   * Create a sub-cluster from parent cluster.
   */
  private createSubCluster(
    leafIndices: number[],
    leaves: BranchLeafData[],
    parent: BranchCluster,
  ): BranchCluster | null {
    if (leafIndices.length === 0) return null;

    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    const avgDirection = new THREE.Vector3();

    for (const idx of leafIndices) {
      const leaf = leaves[idx];
      bounds.expandByPoint(leaf.position);
      center.add(leaf.position);
      avgDirection.add(leaf.direction);
    }

    center.divideScalar(leafIndices.length);
    avgDirection.normalize();

    const size = new THREE.Vector3();
    bounds.getSize(size);

    // Recalculate outward direction for this sub-cluster's center
    const outward = new THREE.Vector3(center.x, 0, center.z);
    if (outward.lengthSq() < 0.001) {
      outward.set(avgDirection.x, 0, avgDirection.z);
    }
    outward.normalize();

    return {
      id: 0,
      stemIndex: parent.stemIndex,
      stemDepth: parent.stemDepth,
      center,
      billboardNormal: outward.clone(),
      billboardUp: new THREE.Vector3(0, 1, 0), // Always vertical
      bounds,
      leafIndices: [...leafIndices],
      width: Math.max(size.x, size.z) * 1.2,
      height: size.y * 1.2,
      density: leafIndices.length / Math.max(0.01, size.x * size.z),
      avgLeafDirection: avgDirection,
      overlapCulled: parent.overlapCulled,
    };
  }

  /**
   * Merge clusters iteratively until we're close to target count.
   */
  private mergeSmallClusters(
    clusters: BranchCluster[],
    leaves: BranchLeafData[],
  ): BranchCluster[] {
    const targetCount = this.options.targetClusterCount;
    const maxIterations = 10;

    let currentClusters = [...clusters];

    // Iteratively merge until we're close to target
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (currentClusters.length <= targetCount * 1.2) {
        break; // Close enough to target
      }

      const merged = this.mergeSinglePass(currentClusters, leaves);

      // If no progress was made, stop
      if (merged.length >= currentClusters.length * 0.95) {
        break;
      }

      currentClusters = merged;
    }

    return currentClusters;
  }

  /**
   * Single pass of cluster merging.
   */
  private mergeSinglePass(
    clusters: BranchCluster[],
    leaves: BranchLeafData[],
  ): BranchCluster[] {
    const minLeaves = this.options.minLeavesPerCluster;
    const targetCount = this.options.targetClusterCount;

    // Adaptive merge distance based on how far over target we are
    const overTargetRatio = clusters.length / targetCount;
    let mergeDistance: number;
    if (overTargetRatio > 8) {
      mergeDistance = 5.0; // Very aggressive
    } else if (overTargetRatio > 5) {
      mergeDistance = 3.0;
    } else if (overTargetRatio > 3) {
      mergeDistance = 2.0;
    } else if (overTargetRatio > 1.5) {
      mergeDistance = 1.5;
    } else {
      mergeDistance = 0.8;
    }

    const result: BranchCluster[] = [];
    const merged = new Set<number>();

    // Sort by leaf count (merge smallest first)
    const sorted = [...clusters].sort(
      (a, b) => a.leafIndices.length - b.leafIndices.length,
    );

    for (let i = 0; i < sorted.length; i++) {
      if (merged.has(i)) continue;

      const cluster = sorted[i];

      // If cluster is big enough and we're under target, keep it
      if (
        cluster.leafIndices.length >= minLeaves &&
        result.length < targetCount
      ) {
        result.push(cluster);
        merged.add(i);
        continue;
      }

      // Find nearest neighbor to merge with
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (let j = 0; j < sorted.length; j++) {
        if (i === j || merged.has(j)) continue;

        // Prefer merging with clusters on the same stem
        const sameStem = sorted[i].stemIndex === sorted[j].stemIndex;
        const dist = cluster.center.distanceTo(sorted[j].center);
        const adjustedDist = sameStem ? dist * 0.5 : dist;

        if (adjustedDist < nearestDist && adjustedDist < mergeDistance) {
          nearestDist = adjustedDist;
          nearestIdx = j;
        }
      }

      if (nearestIdx >= 0) {
        // Merge clusters
        const neighbor = sorted[nearestIdx];
        const mergedIndices = [...cluster.leafIndices, ...neighbor.leafIndices];

        const mergedCluster = this.createSubCluster(
          mergedIndices,
          leaves,
          cluster,
        );

        if (mergedCluster) {
          // Use the deeper stem's properties
          if (neighbor.stemDepth > cluster.stemDepth) {
            mergedCluster.stemIndex = neighbor.stemIndex;
            mergedCluster.stemDepth = neighbor.stemDepth;
          }

          result.push(mergedCluster);
          merged.add(i);
          merged.add(nearestIdx);
        }
      } else if (cluster.leafIndices.length >= minLeaves) {
        // No neighbor to merge with, keep as-is
        result.push(cluster);
      }
      // Otherwise, discard small isolated clusters
    }

    return result;
  }

  /**
   * Finalize cluster with proper ID and dimensions.
   */
  private finalizeCluster(
    cluster: BranchCluster,
    id: number,
    leaves: BranchLeafData[],
  ): BranchCluster {
    cluster.id = id;

    // Recalculate bounds tightly
    const bounds = new THREE.Box3();
    for (const idx of cluster.leafIndices) {
      bounds.expandByPoint(leaves[idx].position);
    }
    cluster.bounds = bounds;

    // Recalculate center
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    cluster.center = center;

    // Calculate billboard dimensions with padding
    const size = new THREE.Vector3();
    bounds.getSize(size);

    // Add padding for leaves that extend beyond their position
    const padding = 0.15;
    cluster.width = Math.max(0.3, Math.max(size.x, size.z) + padding * 2);
    cluster.height = Math.max(0.3, size.y + padding * 2);

    // Update density
    cluster.density =
      cluster.leafIndices.length /
      Math.max(0.01, cluster.width * cluster.height);

    return cluster;
  }

  /**
   * Return empty result.
   */
  private emptyResult(params: TreeParams): BranchClusterResult {
    return {
      clusters: [],
      leaves: [],
      params,
      stems: [],
      stats: {
        totalLeaves: 0,
        clusterCount: 0,
        avgLeavesPerCluster: 0,
        leavesCulledForOverlap: 0,
        reductionRatio: 0,
      },
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default BranchClusterGenerator;
