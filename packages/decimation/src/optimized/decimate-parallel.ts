/**
 * Parallel Mesh Decimation using Web Workers
 *
 * Uses a worker pool to compute initial edge costs in parallel.
 */

import {
  OptimizedMeshData,
  OptimizedDecimationOptions,
  OptimizedDecimationResult,
  PlacementBuffer,
  NULL_INDEX,
} from "./types.js";
import type { StopReason } from "./types.js";
import { buildEdgeFlaps, buildSeamEdges } from "./connectivity.js";
import { computeVertexMetrics } from "./quadric.js";
import { EdgePriorityQueue } from "./priority-queue.js";
import { computeCostAndPlacement } from "./cost-placement.js";
import { tryCollapseEdge } from "./collapse.js";
import { cleanMesh } from "./decimate.js";
import { DecimationWorkerPool } from "./worker/worker-pool.js";
import type { WorkerInitMessage } from "./worker/cost-worker.js";

// ============================================================================
// OPTIONS
// ============================================================================

export interface ParallelDecimationOptions extends OptimizedDecimationOptions {
  /** Number of workers (defaults to navigator.hardwareConcurrency) */
  numWorkers?: number;
  /** Minimum edges for parallel processing (default: 1000) */
  minEdgesForParallel?: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function extractSeamVertexData(
  seamVertices: { getSeamNeighbors(vi: number, out: Int32Array): number },
  vertexCount: number,
): { neighbors: Int32Array; neighborCounts: Uint8Array } {
  const maxNeighbors = 8;
  const neighbors = new Int32Array(vertexCount * maxNeighbors);
  neighbors.fill(NULL_INDEX);
  const neighborCounts = new Uint8Array(vertexCount);
  const temp = new Int32Array(maxNeighbors);

  for (let vi = 0; vi < vertexCount; vi++) {
    const count = seamVertices.getSeamNeighbors(vi, temp);
    neighborCounts[vi] = count;
    for (let i = 0; i < count; i++) {
      neighbors[vi * maxNeighbors + i] = temp[i];
    }
  }

  return { neighbors, neighborCounts };
}

// ============================================================================
// PARALLEL DECIMATION
// ============================================================================

/**
 * Decimate using parallel initial cost computation.
 */
export async function decimateParallel(
  mesh: OptimizedMeshData,
  options: ParallelDecimationOptions = {},
): Promise<OptimizedDecimationResult> {
  const startTime = performance.now();
  const workMesh = mesh.clone();

  const originalVertices = workMesh.vertexCount;
  const originalFaces = workMesh.faceCount;

  // Calculate target
  let targetVertices: number;
  if (options.targetVertices !== undefined) {
    targetVertices = options.targetVertices;
  } else if (options.targetPercent !== undefined) {
    targetVertices = Math.floor(
      originalVertices * (options.targetPercent / 100),
    );
  } else {
    targetVertices = Math.floor(originalVertices * 0.5);
  }
  targetVertices = Math.max(4, targetVertices);

  const strictness = options.strictness ?? 2;
  const minEdgesForParallel = options.minEdgesForParallel ?? 1000;

  // Build connectivity
  const flaps = buildEdgeFlaps(workMesh);
  const { seamEdges, seamVertices } = buildSeamEdges(workMesh, flaps);
  const metrics = computeVertexMetrics(workMesh);

  const pq = new EdgePriorityQueue(flaps.edgeCount);
  const placement = new PlacementBuffer();

  // Parallel or sequential initial cost computation
  if (flaps.edgeCount >= minEdgesForParallel) {
    const pool = new DecimationWorkerPool({ numWorkers: options.numWorkers });

    const seamData = extractSeamVertexData(seamVertices, workMesh.vertexCount);
    const seamTable = new BigInt64Array(1024);
    seamTable.fill(BigInt(-1));

    const initData: WorkerInitMessage["data"] = {
      positions: workMesh.positions,
      uvs: workMesh.uvs,
      faceVertices: workMesh.faceVertices,
      faceTexCoords: workMesh.faceTexCoords,
      edges: flaps.edges,
      edgeFaces: flaps.edgeFaces,
      edgeOpposites: flaps.edgeOpposites,
      faceToEdge: flaps.faceToEdge,
      edgeCount: flaps.edgeCount,
      faceCount: flaps.faceCount,
      metrics: metrics.metrics,
      tcIndices: metrics.tcIndices,
      vertexCount: workMesh.vertexCount,
      seamTable,
      seamCapacity: 1024,
      seamNeighbors: seamData.neighbors,
      seamNeighborCounts: seamData.neighborCounts,
      strictness,
    };

    await pool.initialize(initData);
    const result = await pool.computeCosts(0, flaps.edgeCount);
    pool.terminate();

    for (let ei = 0; ei < flaps.edgeCount; ei++) {
      pq.setCostDirect(ei, result.costs[ei]);
    }
  } else {
    for (let ei = 0; ei < flaps.edgeCount; ei++) {
      const cost = computeCostAndPlacement(
        ei,
        flaps,
        workMesh,
        metrics,
        seamEdges,
        seamVertices,
        strictness,
        placement,
      );
      pq.setCostDirect(ei, cost);
    }
  }

  pq.buildHeap(flaps.edgeCount);

  // Main decimation loop
  let currentVertices = originalVertices;
  let collapses = 0;
  let stopReason: StopReason = "target_reached";
  let noProgressCount = 0;
  const maxNoProgress = 1000;

  while (currentVertices > targetVertices) {
    const minEntry = pq.extractMin();
    if (!minEntry) {
      stopReason = "empty_queue";
      break;
    }

    const [ei, cost] = minEntry;

    if (!Number.isFinite(cost)) {
      if (++noProgressCount > maxNoProgress) {
        stopReason = "all_infinite_cost";
        break;
      }
      continue;
    }

    if (flaps.isEdgeDeleted(ei)) continue;

    const freshCost = computeCostAndPlacement(
      ei,
      flaps,
      workMesh,
      metrics,
      seamEdges,
      seamVertices,
      strictness,
      placement,
    );
    if (Math.abs(freshCost - cost) > 1e-6 * Math.max(1, Math.abs(cost))) {
      pq.insert(ei, freshCost);
      continue;
    }

    const result = tryCollapseEdge(
      ei,
      placement,
      workMesh,
      flaps,
      metrics,
      seamEdges,
      seamVertices,
    );
    if (!result.success) {
      if (++noProgressCount > maxNoProgress) {
        stopReason = "no_progress";
        break;
      }
      continue;
    }

    collapses++;
    currentVertices--;
    noProgressCount = 0;

    if (result.killedEdge1 >= 0) pq.remove(result.killedEdge1);
    if (result.killedEdge2 >= 0) pq.remove(result.killedEdge2);

    for (let i = 0; i < result.affectedCount; i++) {
      const aei = result.affectedEdges[i];
      if (!flaps.isEdgeDeleted(aei)) {
        pq.update(
          aei,
          computeCostAndPlacement(
            aei,
            flaps,
            workMesh,
            metrics,
            seamEdges,
            seamVertices,
            strictness,
            placement,
          ),
        );
      }
    }
  }

  const cleanedMesh = cleanMesh(workMesh);

  return {
    mesh: cleanedMesh,
    originalVertices,
    finalVertices: cleanedMesh.vertexCount,
    originalFaces,
    finalFaces: cleanedMesh.faceCount,
    collapses,
    stopReason,
    processingTimeMs: performance.now() - startTime,
  };
}

/** Check if Web Workers are available. */
export function workersAvailable(): boolean {
  return typeof Worker !== "undefined";
}

/** Get recommended worker count for the current system. */
export function getRecommendedWorkerCount(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(1, navigator.hardwareConcurrency - 1);
  }
  return 4;
}
