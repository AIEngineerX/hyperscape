/**
 * Worker Pool for Parallel Decimation
 *
 * Manages Web Workers for parallel edge cost computation.
 */

import type {
  WorkerInitMessage,
  WorkerComputeMessage,
  WorkerResponse,
} from "./cost-worker.js";

// ============================================================================
// TYPES
// ============================================================================

export interface WorkerPoolOptions {
  /** Number of workers (defaults to navigator.hardwareConcurrency or 4) */
  numWorkers?: number;
}

export interface BatchComputeResult {
  costs: Float64Array;
  placements: Float32Array;
}

interface PendingRequest {
  resolve: (result: BatchComputeResult) => void;
  reject: (error: Error) => void;
}

// ============================================================================
// INLINE WORKER CODE
// ============================================================================

const WORKER_CODE = `
const NULL_INDEX = -1;
const MATRIX_SIZE = 36;
const MAX_TC = 8;
const INF = Infinity;

let S = null;

function encodeEdge(v0, v1) {
  const min = v0 < v1 ? v0 : v1, max = v0 < v1 ? v1 : v0;
  return (BigInt(min) << 32n) | BigInt(max);
}

function hashEdge(key, cap) {
  let h = key;
  h ^= h >> 33n;
  h *= 0xff51afd7ed558ccdn;
  h ^= h >> 33n;
  return Number(h & BigInt(cap - 1));
}

function isSeamEdge(v0, v1) {
  if (!S) return false;
  const key = encodeEdge(v0, v1);
  let i = hashEdge(key, S.seamCapacity);
  while (S.seamTable[i] !== -1n) {
    if (S.seamTable[i] === key) return true;
    i = (i + 1) & (S.seamCapacity - 1);
  }
  return false;
}

function isSeamVertex(vi) {
  return S && S.seamNeighborCounts[vi] > 0;
}

function getMetricOffset(vi, tci) {
  if (!S) return -1;
  const base = vi * MAX_TC;
  for (let s = 0; s < MAX_TC; s++) {
    if (S.tcIndices[base + s] === tci) return (vi * MAX_TC + s) * MATRIX_SIZE;
  }
  return -1;
}

const M = new Float64Array(MATRIX_SIZE);
const V6 = new Float64Array(6);

function getCombinedMetric(vi1, tci1, vi2, tci2) {
  M.fill(0);
  const o1 = getMetricOffset(vi1, tci1), o2 = getMetricOffset(vi2, tci2);
  if (o1 !== -1) for (let i = 0; i < MATRIX_SIZE; i++) M[i] += S.metrics[o1 + i];
  if (o2 !== -1) for (let i = 0; i < MATRIX_SIZE; i++) M[i] += S.metrics[o2 + i];
}

function quadForm(v, m) {
  let r = 0;
  for (let i = 0; i < 6; i++) {
    const vi = v[i], row = i * 6;
    for (let j = 0; j < 6; j++) r += vi * m[row + j] * v[j];
  }
  return r;
}

function getBundle(ei) {
  const b = { count: 0, faces: [-1, -1], side0: [0,0,0,0], side1: [0,0,0,0] };
  for (let side = 0; side < 2; side++) {
    const fi = S.edgeFaces[ei * 2 + side], opp = S.edgeOpposites[ei * 2 + side];
    if (fi === -1) continue;
    b.faces[side] = fi;
    b.count++;
    const fb = fi * 3, c1 = (opp + 1) % 3, c2 = (opp + 2) % 3;
    const out = side === 0 ? b.side0 : b.side1;
    out[0] = S.faceVertices[fb + c1]; out[1] = S.faceTexCoords[fb + c1];
    out[2] = S.faceVertices[fb + c2]; out[3] = S.faceTexCoords[fb + c2];
  }
  return b;
}

function computeCost(ei) {
  const P = new Float32Array(7);
  if (!S) return { cost: INF, P };

  const b = getBundle(ei);
  if (b.count < 2) return { cost: INF, P };

  const v0 = S.edges[ei * 2], v1 = S.edges[ei * 2 + 1];
  const s0 = isSeamVertex(v0), s1 = isSeamVertex(v1), se = isSeamEdge(v0, v1);
  if (s0 && s1 && !se) return { cost: INF, P };

  const [vi0, tci0, vi1, tci1] = b.side0;
  getCombinedMetric(vi0, tci0, vi1, tci1);

  // Collapse to seam vertex if one exists
  if (s0 && !s1) {
    const pb = vi0 * 3, uvb = tci0 * 2;
    P[0] = S.positions[pb]; P[1] = S.positions[pb+1]; P[2] = S.positions[pb+2];
    P[3] = S.uvs[uvb]; P[4] = S.uvs[uvb+1];
    V6[0]=P[0]; V6[1]=P[1]; V6[2]=P[2]; V6[3]=P[3]; V6[4]=P[4]; V6[5]=1;
    return { cost: quadForm(V6, M), P };
  }
  if (s1 && !s0) {
    const pb = vi1 * 3, uvb = tci1 * 2;
    P[0] = S.positions[pb]; P[1] = S.positions[pb+1]; P[2] = S.positions[pb+2];
    P[3] = S.uvs[uvb]; P[4] = S.uvs[uvb+1];
    V6[0]=P[0]; V6[1]=P[1]; V6[2]=P[2]; V6[3]=P[3]; V6[4]=P[4]; V6[5]=1;
    return { cost: quadForm(V6, M), P };
  }

  // Midpoint
  const p0 = vi0 * 3, p1 = vi1 * 3;
  P[0] = (S.positions[p0] + S.positions[p1]) * 0.5;
  P[1] = (S.positions[p0+1] + S.positions[p1+1]) * 0.5;
  P[2] = (S.positions[p0+2] + S.positions[p1+2]) * 0.5;
  const uv0 = tci0 * 2, uv1 = tci1 * 2;
  P[3] = (S.uvs[uv0] + S.uvs[uv1]) * 0.5;
  P[4] = (S.uvs[uv0+1] + S.uvs[uv1+1]) * 0.5;
  V6[0]=P[0]; V6[1]=P[1]; V6[2]=P[2]; V6[3]=P[3]; V6[4]=P[4]; V6[5]=1;
  return { cost: quadForm(V6, M), P };
}

self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type === 'init') { S = msg.data; return; }
  if (msg.type === 'compute') {
    const { edgeStart, edgeEnd, requestId } = msg.data;
    const n = edgeEnd - edgeStart;
    const costs = new Float64Array(n), placements = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      const r = computeCost(edgeStart + i);
      costs[i] = r.cost;
      placements.set(r.P, i * 7);
    }
    self.postMessage({ type: 'result', data: { requestId, costs, placements } });
  }
};
`;

let workerBlobUrl: string | null = null;

function getWorkerUrl(): string {
  if (!workerBlobUrl) {
    const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
    workerBlobUrl = URL.createObjectURL(blob);
  }
  return workerBlobUrl;
}

// ============================================================================
// WORKER POOL
// ============================================================================

export class DecimationWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private numWorkers: number;
  private initialized = false;

  constructor(options: WorkerPoolOptions = {}) {
    const defaultWorkers =
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4;
    this.numWorkers = options.numWorkers ?? defaultWorkers ?? 4;
  }

  async initialize(data: WorkerInitMessage["data"]): Promise<void> {
    this.terminate();

    const url = getWorkerUrl();

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(url);

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(worker, event.data);
      };

      worker.onerror = (err) => console.error("Worker error:", err);

      // Clone data for each worker
      const initMsg: WorkerInitMessage = {
        type: "init",
        data: {
          positions: new Float32Array(data.positions),
          uvs: new Float32Array(data.uvs),
          faceVertices: new Uint32Array(data.faceVertices),
          faceTexCoords: new Uint32Array(data.faceTexCoords),
          edges: new Uint32Array(data.edges),
          edgeFaces: new Int32Array(data.edgeFaces),
          edgeOpposites: new Int8Array(data.edgeOpposites),
          faceToEdge: new Int32Array(data.faceToEdge),
          edgeCount: data.edgeCount,
          faceCount: data.faceCount,
          metrics: new Float64Array(data.metrics),
          tcIndices: new Int32Array(data.tcIndices),
          vertexCount: data.vertexCount,
          seamTable: new BigInt64Array(data.seamTable),
          seamCapacity: data.seamCapacity,
          seamNeighbors: new Int32Array(data.seamNeighbors),
          seamNeighborCounts: new Uint8Array(data.seamNeighborCounts),
          strictness: data.strictness,
        },
      };

      worker.postMessage(initMsg);
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }

    this.initialized = true;
  }

  async computeCosts(
    edgeStart: number,
    edgeEnd: number,
  ): Promise<BatchComputeResult> {
    if (!this.initialized) throw new Error("Worker pool not initialized");

    const totalEdges = edgeEnd - edgeStart;
    const batchSize = Math.ceil(totalEdges / this.numWorkers);
    const promises: Promise<BatchComputeResult>[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const start = edgeStart + i * batchSize;
      const end = Math.min(start + batchSize, edgeEnd);
      if (start >= edgeEnd) break;
      promises.push(this.computeBatch(start, end));
    }

    const results = await Promise.all(promises);

    // Merge
    const costs = new Float64Array(totalEdges);
    const placements = new Float32Array(totalEdges * 7);
    let offset = 0;
    for (const r of results) {
      costs.set(r.costs, offset);
      placements.set(r.placements, offset * 7);
      offset += r.costs.length;
    }

    return { costs, placements };
  }

  private computeBatch(
    edgeStart: number,
    edgeEnd: number,
  ): Promise<BatchComputeResult> {
    return new Promise((resolve, reject) => {
      const worker = this.availableWorkers.pop();
      if (!worker) {
        // Retry after short delay
        setTimeout(
          () => this.computeBatch(edgeStart, edgeEnd).then(resolve, reject),
          1,
        );
        return;
      }

      const requestId = this.nextRequestId++;
      this.pendingRequests.set(requestId, { resolve, reject });

      const msg: WorkerComputeMessage = {
        type: "compute",
        data: { edgeStart, edgeEnd, requestId },
      };
      worker.postMessage(msg);
    });
  }

  private handleMessage(worker: Worker, response: WorkerResponse): void {
    const { requestId } = response.data;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    this.pendingRequests.delete(requestId);
    this.availableWorkers.push(worker);

    if (response.type === "result") {
      pending.resolve({
        costs: response.data.costs,
        placements: response.data.placements,
      });
    } else {
      pending.reject(new Error(response.data.message));
    }
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.availableWorkers = [];
    this.pendingRequests.clear();
    this.initialized = false;
  }

  isReady(): boolean {
    return this.initialized;
  }

  getWorkerCount(): number {
    return this.numWorkers;
  }
}
