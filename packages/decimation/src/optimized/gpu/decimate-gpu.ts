/**
 * GPU-Accelerated Mesh Decimation using WebGPU
 *
 * Falls back to CPU implementation when WebGPU is unavailable.
 * Note: Currently uses GPU for metric computation setup but CPU for main loop.
 */

import {
  OptimizedMeshData,
  OptimizedDecimationOptions,
  OptimizedDecimationResult,
  PlacementBuffer,
} from "../types.js";
import type { StopReason } from "../types.js";
import { buildEdgeFlaps, buildSeamEdges } from "../connectivity.js";
import { computeVertexMetrics } from "../quadric.js";
import { EdgePriorityQueue } from "../priority-queue.js";
import { computeCostAndPlacement } from "../cost-placement.js";
import { tryCollapseEdge } from "../collapse.js";
import { cleanMesh, decimateOptimized } from "../decimate.js";
import { GPUDecimationContext, isWebGPUAvailable } from "./context.js";

// ============================================================================
// OPTIONS
// ============================================================================

export interface GPUDecimationOptions extends OptimizedDecimationOptions {
  /** Force CPU even if WebGPU is available */
  forceCPU?: boolean;
  /** GPU power preference */
  gpuPowerPreference?: GPUPowerPreference;
  /** Minimum edges to use GPU (smaller meshes use CPU) */
  minEdgesForGPU?: number;
}

// ============================================================================
// GPU DECIMATION
// ============================================================================

/**
 * Decimate using WebGPU for initial setup, CPU for main loop.
 * Falls back to CPU if WebGPU unavailable or mesh too small.
 */
export async function decimateGPU(
  mesh: OptimizedMeshData,
  options: GPUDecimationOptions = {},
): Promise<OptimizedDecimationResult> {
  const {
    forceCPU = false,
    minEdgesForGPU = 5000,
    gpuPowerPreference = "high-performance",
  } = options;

  // Fallback conditions
  if (forceCPU || !isWebGPUAvailable()) {
    return decimateOptimized(mesh, options);
  }

  const tempFlaps = buildEdgeFlaps(mesh);
  if (tempFlaps.edgeCount < minEdgesForGPU) {
    return decimateOptimized(mesh, options);
  }

  const gpuContext = new GPUDecimationContext();
  if (!(await gpuContext.initialize({ powerPreference: gpuPowerPreference }))) {
    return decimateOptimized(mesh, options);
  }

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

  // Build connectivity
  const flaps = buildEdgeFlaps(workMesh);
  const { seamEdges, seamVertices } = buildSeamEdges(workMesh, flaps);

  // Upload to GPU (for potential future GPU compute)
  gpuContext.uploadMeshData(
    workMesh.positions,
    workMesh.uvs,
    workMesh.faceVertices,
    workMesh.faceTexCoords,
  );
  gpuContext.uploadEdgeData(flaps.edges, flaps.edgeFaces);
  gpuContext.createMetricBuffers(workMesh.faceCount, workMesh.vertexCount);
  gpuContext.createCostBuffers(flaps.edgeCount);

  // Compute quadric metrics on GPU
  await gpuContext.computeQuadricMetrics(workMesh.faceCount);

  // CPU fallback for vertex metrics (GPU atomic float ops are complex)
  const metrics = computeVertexMetrics(workMesh);

  const pq = new EdgePriorityQueue(flaps.edgeCount);
  const placement = new PlacementBuffer();

  // Initial costs on CPU
  for (let ei = 0; ei < flaps.edgeCount; ei++) {
    pq.setCostDirect(
      ei,
      computeCostAndPlacement(
        ei,
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
  pq.buildHeap(flaps.edgeCount);

  // Main loop
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

  gpuContext.destroy();
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

/** Check if GPU decimation is available and recommended. */
export async function shouldUseGPU(
  edgeCount: number,
  minEdges = 5000,
): Promise<boolean> {
  if (!isWebGPUAvailable() || edgeCount < minEdges) return false;

  const context = new GPUDecimationContext();
  const available = await context.initialize();
  context.destroy();
  return available;
}
