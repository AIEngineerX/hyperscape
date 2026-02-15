/**
 * WebGPU Context Manager for Decimation
 * Extended with batch cost updates and min reduction
 */

import {
  QUADRIC_METRIC_SHADER,
  EDGE_COST_SHADER,
  BATCH_COST_UPDATE_SHADER,
  MIN_REDUCTION_SHADER,
  EDGE_DELETION_SHADER,
} from "./shaders.js";

// ============================================================================
// TYPES
// ============================================================================

export interface GPUContextOptions {
  powerPreference?: GPUPowerPreference;
}

export interface MeshBuffers {
  positions: GPUBuffer;
  uvs: GPUBuffer;
  faceVertices: GPUBuffer;
  faceTexCoords: GPUBuffer;
}

export interface EdgeBuffers {
  edges: GPUBuffer;
  edgeFaces: GPUBuffer;
}

export interface MetricBuffers {
  faceMetrics: GPUBuffer;
  vertexMetrics: GPUBuffer;
}

export interface CostBuffers {
  edgeCosts: GPUBuffer;
  edgePlacements: GPUBuffer;
}

// ============================================================================
// GPU CONTEXT
// ============================================================================

const MATRIX_SIZE = 36; // 6x6 floats

export class GPUDecimationContext {
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private quadricPipeline: GPUComputePipeline | null = null;
  private costPipeline: GPUComputePipeline | null = null;
  private batchCostPipeline: GPUComputePipeline | null = null;
  private minReductionPipeline: GPUComputePipeline | null = null;
  private edgeDeletionPipeline: GPUComputePipeline | null = null;
  private meshBuffers: MeshBuffers | null = null;
  private edgeBuffers: EdgeBuffers | null = null;
  private metricBuffers: MetricBuffers | null = null;
  private costBuffers: CostBuffers | null = null;
  private initialized = false;

  async initialize(options: GPUContextOptions = {}): Promise<boolean> {
    if (!navigator.gpu) return false;

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? "high-performance",
    });
    if (!this.adapter) return false;

    this.device = await this.adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {
        maxStorageBufferBindingSize: 256 * 1024 * 1024,
        maxBufferSize: 256 * 1024 * 1024,
      },
    });
    if (!this.device) return false;

    this.createPipelines();
    this.initialized = true;
    return true;
  }

  private createPipelines(): void {
    if (!this.device) return;

    this.quadricPipeline = this.device.createComputePipeline({
      label: "Quadric Pipeline",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: QUADRIC_METRIC_SHADER }),
        entryPoint: "main",
      },
    });

    this.costPipeline = this.device.createComputePipeline({
      label: "Cost Pipeline",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: EDGE_COST_SHADER }),
        entryPoint: "main",
      },
    });

    this.batchCostPipeline = this.device.createComputePipeline({
      label: "Batch Cost Update Pipeline",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({
          code: BATCH_COST_UPDATE_SHADER,
        }),
        entryPoint: "main",
      },
    });

    this.minReductionPipeline = this.device.createComputePipeline({
      label: "Min Reduction Pipeline",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: MIN_REDUCTION_SHADER }),
        entryPoint: "main",
      },
    });

    this.edgeDeletionPipeline = this.device.createComputePipeline({
      label: "Edge Deletion Pipeline",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: EDGE_DELETION_SHADER }),
        entryPoint: "main",
      },
    });
  }

  private createBuffer(
    label: string,
    data: ArrayBufferView,
    usage: GPUBufferUsageFlags,
  ): GPUBuffer {
    const buffer = this.device!.createBuffer({
      label,
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    buffer.unmap();
    return buffer;
  }

  uploadMeshData(
    positions: Float32Array,
    uvs: Float32Array,
    faceVertices: Uint32Array,
    faceTexCoords: Uint32Array,
  ): void {
    if (!this.device) return;
    this.destroyMeshBuffers();
    this.meshBuffers = {
      positions: this.createBuffer(
        "Positions",
        positions,
        GPUBufferUsage.STORAGE,
      ),
      uvs: this.createBuffer("UVs", uvs, GPUBufferUsage.STORAGE),
      faceVertices: this.createBuffer(
        "FaceVertices",
        faceVertices,
        GPUBufferUsage.STORAGE,
      ),
      faceTexCoords: this.createBuffer(
        "FaceTexCoords",
        faceTexCoords,
        GPUBufferUsage.STORAGE,
      ),
    };
  }

  uploadEdgeData(edges: Uint32Array, edgeFaces: Int32Array): void {
    if (!this.device) return;
    this.destroyEdgeBuffers();
    this.edgeBuffers = {
      edges: this.createBuffer("Edges", edges, GPUBufferUsage.STORAGE),
      edgeFaces: this.createBuffer(
        "EdgeFaces",
        edgeFaces,
        GPUBufferUsage.STORAGE,
      ),
    };
  }

  createMetricBuffers(faceCount: number, vertexCount: number): void {
    if (!this.device) return;
    this.destroyMetricBuffers();
    this.metricBuffers = {
      faceMetrics: this.device.createBuffer({
        label: "FaceMetrics",
        size: faceCount * MATRIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      vertexMetrics: this.device.createBuffer({
        label: "VertexMetrics",
        size: vertexCount * MATRIX_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
    };
  }

  createCostBuffers(edgeCount: number): void {
    if (!this.device) return;
    this.destroyCostBuffers();
    this.costBuffers = {
      edgeCosts: this.device.createBuffer({
        label: "EdgeCosts",
        size: edgeCount * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      edgePlacements: this.device.createBuffer({
        label: "EdgePlacements",
        size: edgeCount * 5 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
    };
  }

  async computeQuadricMetrics(faceCount: number): Promise<void> {
    if (
      !this.device ||
      !this.quadricPipeline ||
      !this.meshBuffers ||
      !this.metricBuffers
    ) {
      throw new Error("GPU context not initialized");
    }

    const uniforms = this.createBuffer(
      "Uniforms",
      new Uint32Array([faceCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM,
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.quadricPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.meshBuffers.positions } },
        { binding: 1, resource: { buffer: this.meshBuffers.uvs } },
        { binding: 2, resource: { buffer: this.meshBuffers.faceVertices } },
        { binding: 3, resource: { buffer: this.meshBuffers.faceTexCoords } },
        { binding: 4, resource: { buffer: this.metricBuffers.faceMetrics } },
        { binding: 5, resource: { buffer: uniforms } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.quadricPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(faceCount / 64));
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    uniforms.destroy();
  }

  async computeEdgeCosts(
    edgeCount: number,
  ): Promise<{ costs: Float32Array; placements: Float32Array }> {
    if (
      !this.device ||
      !this.costPipeline ||
      !this.meshBuffers ||
      !this.edgeBuffers ||
      !this.metricBuffers ||
      !this.costBuffers
    ) {
      throw new Error("GPU context not initialized");
    }

    const uniforms = this.createBuffer(
      "Uniforms",
      new Uint32Array([edgeCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM,
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.costPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.meshBuffers.positions } },
        { binding: 1, resource: { buffer: this.meshBuffers.uvs } },
        { binding: 2, resource: { buffer: this.edgeBuffers.edges } },
        { binding: 3, resource: { buffer: this.edgeBuffers.edgeFaces } },
        { binding: 4, resource: { buffer: this.metricBuffers.vertexMetrics } },
        { binding: 5, resource: { buffer: this.costBuffers.edgeCosts } },
        { binding: 6, resource: { buffer: this.costBuffers.edgePlacements } },
        { binding: 7, resource: { buffer: uniforms } },
      ],
    });

    const costStaging = this.device.createBuffer({
      size: edgeCount * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const placementStaging = this.device.createBuffer({
      size: edgeCount * 5 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.costPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(edgeCount / 64));
    pass.end();

    encoder.copyBufferToBuffer(
      this.costBuffers.edgeCosts,
      0,
      costStaging,
      0,
      edgeCount * 4,
    );
    encoder.copyBufferToBuffer(
      this.costBuffers.edgePlacements,
      0,
      placementStaging,
      0,
      edgeCount * 5 * 4,
    );

    this.device.queue.submit([encoder.finish()]);

    await costStaging.mapAsync(GPUMapMode.READ);
    await placementStaging.mapAsync(GPUMapMode.READ);

    const costs = new Float32Array(costStaging.getMappedRange().slice(0));
    const placements = new Float32Array(
      placementStaging.getMappedRange().slice(0),
    );

    costStaging.unmap();
    placementStaging.unmap();
    costStaging.destroy();
    placementStaging.destroy();
    uniforms.destroy();

    return { costs, placements };
  }

  async readFaceMetrics(faceCount: number): Promise<Float32Array> {
    if (!this.device || !this.metricBuffers)
      throw new Error("GPU context not initialized");

    const size = faceCount * MATRIX_SIZE * 4;
    const staging = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.metricBuffers.faceMetrics,
      0,
      staging,
      0,
      size,
    );
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();

    return data;
  }

  /**
   * Batch update costs for a set of affected edges (GPU-accelerated)
   */
  async batchUpdateCosts(affectedEdges: Uint32Array): Promise<void> {
    if (
      !this.device ||
      !this.batchCostPipeline ||
      !this.meshBuffers ||
      !this.edgeBuffers ||
      !this.metricBuffers ||
      !this.costBuffers
    ) {
      throw new Error("GPU context not initialized");
    }

    const affectedCount = affectedEdges.length;
    if (affectedCount === 0) return;

    const affectedBuffer = this.createBuffer(
      "AffectedEdges",
      affectedEdges,
      GPUBufferUsage.STORAGE,
    );
    const uniforms = this.createBuffer(
      "Uniforms",
      new Uint32Array([affectedCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM,
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.batchCostPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.meshBuffers.positions } },
        { binding: 1, resource: { buffer: this.meshBuffers.uvs } },
        { binding: 2, resource: { buffer: this.edgeBuffers.edges } },
        { binding: 3, resource: { buffer: this.edgeBuffers.edgeFaces } },
        { binding: 4, resource: { buffer: this.metricBuffers.vertexMetrics } },
        { binding: 5, resource: { buffer: affectedBuffer } },
        { binding: 6, resource: { buffer: this.costBuffers.edgeCosts } },
        { binding: 7, resource: { buffer: uniforms } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.batchCostPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(affectedCount / 64));
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    affectedBuffer.destroy();
    uniforms.destroy();
  }

  /**
   * Find minimum cost edge using GPU parallel reduction
   */
  async findMinimumCostEdge(
    edgeCount: number,
  ): Promise<{ edgeIndex: number; cost: number }> {
    if (!this.device || !this.minReductionPipeline || !this.costBuffers) {
      throw new Error("GPU context not initialized");
    }

    const WORKGROUP_SIZE = 256;
    const numWorkgroups = Math.ceil(edgeCount / WORKGROUP_SIZE);

    // Create intermediate buffers for reduction results
    const minCostsBuffer = this.device.createBuffer({
      size: numWorkgroups * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const minIndicesBuffer = this.device.createBuffer({
      size: numWorkgroups * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const uniforms = this.createBuffer(
      "Uniforms",
      new Uint32Array([edgeCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM,
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.minReductionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.costBuffers.edgeCosts } },
        { binding: 1, resource: { buffer: minCostsBuffer } },
        { binding: 2, resource: { buffer: minIndicesBuffer } },
        { binding: 3, resource: { buffer: uniforms } },
      ],
    });

    // First pass: reduce within workgroups
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.minReductionPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(numWorkgroups);
    pass.end();

    // Read back workgroup results
    const costStaging = this.device.createBuffer({
      size: numWorkgroups * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const indexStaging = this.device.createBuffer({
      size: numWorkgroups * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    encoder.copyBufferToBuffer(
      minCostsBuffer,
      0,
      costStaging,
      0,
      numWorkgroups * 4,
    );
    encoder.copyBufferToBuffer(
      minIndicesBuffer,
      0,
      indexStaging,
      0,
      numWorkgroups * 4,
    );

    this.device.queue.submit([encoder.finish()]);

    await costStaging.mapAsync(GPUMapMode.READ);
    await indexStaging.mapAsync(GPUMapMode.READ);

    const costs = new Float32Array(costStaging.getMappedRange().slice(0));
    const indices = new Uint32Array(indexStaging.getMappedRange().slice(0));

    costStaging.unmap();
    indexStaging.unmap();

    // Final reduction on CPU (small array)
    let minCost = Infinity;
    let minIndex = 0;
    for (let i = 0; i < numWorkgroups; i++) {
      if (costs[i] < minCost) {
        minCost = costs[i];
        minIndex = indices[i];
      }
    }

    // Cleanup
    minCostsBuffer.destroy();
    minIndicesBuffer.destroy();
    costStaging.destroy();
    indexStaging.destroy();
    uniforms.destroy();

    return { edgeIndex: minIndex, cost: minCost };
  }

  /**
   * Mark edges as deleted on GPU
   */
  async deleteEdges(edgesToDelete: Uint32Array): Promise<void> {
    if (
      !this.device ||
      !this.edgeDeletionPipeline ||
      !this.edgeBuffers ||
      !this.costBuffers
    ) {
      throw new Error("GPU context not initialized");
    }

    const deleteCount = edgesToDelete.length;
    if (deleteCount === 0) return;

    const deleteBuffer = this.createBuffer(
      "EdgesToDelete",
      edgesToDelete,
      GPUBufferUsage.STORAGE,
    );
    const uniforms = this.createBuffer(
      "Uniforms",
      new Uint32Array([deleteCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM,
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.edgeDeletionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.edgeBuffers.edges } },
        { binding: 1, resource: { buffer: this.costBuffers.edgeCosts } },
        { binding: 2, resource: { buffer: deleteBuffer } },
        { binding: 3, resource: { buffer: uniforms } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.edgeDeletionPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(deleteCount / 64));
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    deleteBuffer.destroy();
    uniforms.destroy();
  }

  private destroyMeshBuffers(): void {
    if (!this.meshBuffers) return;
    this.meshBuffers.positions.destroy();
    this.meshBuffers.uvs.destroy();
    this.meshBuffers.faceVertices.destroy();
    this.meshBuffers.faceTexCoords.destroy();
    this.meshBuffers = null;
  }

  private destroyEdgeBuffers(): void {
    if (!this.edgeBuffers) return;
    this.edgeBuffers.edges.destroy();
    this.edgeBuffers.edgeFaces.destroy();
    this.edgeBuffers = null;
  }

  private destroyMetricBuffers(): void {
    if (!this.metricBuffers) return;
    this.metricBuffers.faceMetrics.destroy();
    this.metricBuffers.vertexMetrics.destroy();
    this.metricBuffers = null;
  }

  private destroyCostBuffers(): void {
    if (!this.costBuffers) return;
    this.costBuffers.edgeCosts.destroy();
    this.costBuffers.edgePlacements.destroy();
    this.costBuffers = null;
  }

  destroy(): void {
    this.destroyMeshBuffers();
    this.destroyEdgeBuffers();
    this.destroyMetricBuffers();
    this.destroyCostBuffers();
    this.quadricPipeline = null;
    this.costPipeline = null;
    this.device = null;
    this.adapter = null;
    this.initialized = false;
  }

  isReady(): boolean {
    return this.initialized && this.device !== null;
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }
}

/** Check if WebGPU is available. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Get WebGPU adapter info. */
export async function getGPUInfo(): Promise<GPUAdapterInfo | null> {
  if (!isWebGPUAvailable()) return null;
  const adapter = await navigator.gpu.requestAdapter();
  return adapter?.info ?? null;
}
