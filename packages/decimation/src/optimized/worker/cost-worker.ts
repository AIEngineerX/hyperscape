/**
 * Web Worker Message Types for Parallel Edge Cost Computation
 *
 * This file defines the message protocol for worker communication.
 * The actual worker code is inlined in worker-pool.ts for bundler compatibility.
 */

// ============================================================================
// WORKER MESSAGE TYPES
// ============================================================================

export interface WorkerInitMessage {
  type: "init";
  data: {
    positions: Float32Array;
    uvs: Float32Array;
    faceVertices: Uint32Array;
    faceTexCoords: Uint32Array;
    edges: Uint32Array;
    edgeFaces: Int32Array;
    edgeOpposites: Int8Array;
    faceToEdge: Int32Array;
    edgeCount: number;
    faceCount: number;
    metrics: Float64Array;
    tcIndices: Int32Array;
    vertexCount: number;
    seamTable: BigInt64Array;
    seamCapacity: number;
    seamNeighbors: Int32Array;
    seamNeighborCounts: Uint8Array;
    strictness: 0 | 1 | 2;
  };
}

export interface WorkerComputeMessage {
  type: "compute";
  data: {
    edgeStart: number;
    edgeEnd: number;
    requestId: number;
  };
}

export interface WorkerResultMessage {
  type: "result";
  data: {
    requestId: number;
    costs: Float64Array;
    placements: Float32Array;
  };
}

export interface WorkerErrorMessage {
  type: "error";
  data: {
    requestId: number;
    message: string;
  };
}

export type WorkerMessage = WorkerInitMessage | WorkerComputeMessage;
export type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;
