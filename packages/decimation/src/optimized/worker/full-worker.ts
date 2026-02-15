/**
 * Full Decimation Worker
 *
 * Runs the ENTIRE decimation algorithm off the main thread.
 * Main thread stays completely free during processing.
 */

// Worker message types
export interface FullWorkerStartMessage {
  type: "start";
  data: {
    positions: Float32Array;
    uvs: Float32Array;
    faceVertices: Uint32Array;
    faceTexCoords: Uint32Array;
    targetVertices?: number;
    targetPercent?: number;
    strictness: 0 | 1 | 2;
  };
}

export interface FullWorkerProgressMessage {
  type: "progress";
  data: {
    currentVertices: number;
    collapses: number;
    percentComplete: number;
  };
}

export interface FullWorkerResultMessage {
  type: "result";
  data: {
    positions: Float32Array;
    uvs: Float32Array;
    faceVertices: Uint32Array;
    faceTexCoords: Uint32Array;
    originalVertices: number;
    finalVertices: number;
    originalFaces: number;
    finalFaces: number;
    collapses: number;
    stopReason: string;
    processingTimeMs: number;
  };
}

export interface FullWorkerErrorMessage {
  type: "error";
  data: { message: string };
}

export type FullWorkerMessage = FullWorkerStartMessage;
export type FullWorkerResponse =
  | FullWorkerProgressMessage
  | FullWorkerResultMessage
  | FullWorkerErrorMessage;

// Inline worker code - contains FULL decimation algorithm
const FULL_WORKER_CODE = `
const NULL = -1;
const MATRIX_SIZE = 36;
const MAX_TC = 8;
const INF = Infinity;
const EPS = 1e-8;

// ============================================================================
// MESH DATA
// ============================================================================
class MeshData {
  constructor(positions, uvs, faceVertices, faceTexCoords) {
    this.positions = positions;
    this.uvs = uvs;
    this.faceVertices = faceVertices;
    this.faceTexCoords = faceTexCoords;
    this.vertexCount = positions.length / 3;
    this.texCoordCount = uvs.length / 2;
    this.faceCount = faceVertices.length / 3;
  }
  isFaceDeleted(fi) { return this.faceVertices[fi * 3] === NULL; }
  deleteFace(fi) {
    const b = fi * 3;
    this.faceVertices[b] = this.faceVertices[b+1] = this.faceVertices[b+2] = NULL;
    this.faceTexCoords[b] = this.faceTexCoords[b+1] = this.faceTexCoords[b+2] = NULL;
  }
}

// ============================================================================
// EDGE FLAPS
// ============================================================================
class EdgeFlaps {
  constructor(edgeCount, faceCount) {
    this.edges = new Uint32Array(edgeCount * 2);
    this.edgeFaces = new Int32Array(edgeCount * 2);
    this.edgeOpposites = new Int8Array(edgeCount * 2);
    this.faceToEdge = new Int32Array(faceCount * 3);
    this.edgeCount = edgeCount;
    this.faceCount = faceCount;
    this.edgeFaces.fill(NULL);
    this.edgeOpposites.fill(NULL);
    this.faceToEdge.fill(NULL);
  }
  isEdgeDeleted(ei) { return this.edges[ei * 2] === NULL; }
  deleteEdge(ei) {
    const b = ei * 2;
    this.edges[b] = this.edges[b+1] = NULL;
    this.edgeFaces[b] = this.edgeFaces[b+1] = NULL;
  }
  getEdgeForFaceCorner(fi, corner) {
    return this.faceToEdge[corner * this.faceCount + fi];
  }
}

// ============================================================================
// SEAM DETECTION
// ============================================================================
class SeamSet {
  constructor() {
    this.cap = 1024;
    this.table = new BigInt64Array(this.cap);
    this.table.fill(-1n);
    this.size = 0;
  }
  encode(v0, v1) {
    const min = v0 < v1 ? v0 : v1, max = v0 < v1 ? v1 : v0;
    return (BigInt(min) << 32n) | BigInt(max);
  }
  hash(key) {
    let h = key;
    h ^= h >> 33n;
    h *= 0xff51afd7ed558ccdn;
    h ^= h >> 33n;
    return Number(h & BigInt(this.cap - 1));
  }
  add(v0, v1) {
    if (this.size >= this.cap * 0.7) this.resize();
    const key = this.encode(v0, v1);
    let i = this.hash(key);
    while (this.table[i] !== -1n) {
      if (this.table[i] === key) return;
      i = (i + 1) & (this.cap - 1);
    }
    this.table[i] = key;
    this.size++;
  }
  has(v0, v1) {
    const key = this.encode(v0, v1);
    let i = this.hash(key);
    while (this.table[i] !== -1n) {
      if (this.table[i] === key) return true;
      i = (i + 1) & (this.cap - 1);
    }
    return false;
  }
  resize() {
    const old = this.table;
    this.cap *= 2;
    this.table = new BigInt64Array(this.cap);
    this.table.fill(-1n);
    this.size = 0;
    for (let i = 0; i < old.length; i++) {
      if (old[i] !== -1n && old[i] !== -2n) {
        const max = Number(old[i] & 0xFFFFFFFFn);
        const min = Number(old[i] >> 32n);
        this.add(min, max);
      }
    }
  }
}

class SeamVertices {
  constructor(vertexCount) {
    this.neighbors = new Int32Array(vertexCount * 8);
    this.neighbors.fill(NULL);
    this.counts = new Uint8Array(vertexCount);
  }
  addSeamEdge(v0, v1) {
    this.addNeighbor(v0, v1);
    this.addNeighbor(v1, v0);
  }
  addNeighbor(vi, n) {
    const b = vi * 8, c = this.counts[vi];
    for (let i = 0; i < c; i++) if (this.neighbors[b + i] === n) return;
    if (c < 8) { this.neighbors[b + c] = n; this.counts[vi] = c + 1; }
  }
  isOnSeam(vi) { return this.counts[vi] > 0; }
}

// ============================================================================
// VERTEX METRICS
// ============================================================================
class VertexMetrics {
  constructor(vertexCount) {
    this.metrics = new Float64Array(vertexCount * MAX_TC * MATRIX_SIZE);
    this.tcIndices = new Int32Array(vertexCount * MAX_TC);
    this.tcIndices.fill(NULL);
    this.vertexCount = vertexCount;
  }
  findSlot(vi, tci) {
    const b = vi * MAX_TC;
    for (let s = 0; s < MAX_TC; s++) {
      if (this.tcIndices[b + s] === tci) return s;
      if (this.tcIndices[b + s] === NULL) { this.tcIndices[b + s] = tci; return s; }
    }
    return NULL;
  }
  getOffset(vi, tci) {
    const b = vi * MAX_TC;
    for (let s = 0; s < MAX_TC; s++) if (this.tcIndices[b + s] === tci) return (vi * MAX_TC + s) * MATRIX_SIZE;
    return NULL;
  }
  addMetric(vi, tci, mat) {
    const s = this.findSlot(vi, tci);
    if (s === NULL) return;
    const off = (vi * MAX_TC + s) * MATRIX_SIZE;
    for (let i = 0; i < MATRIX_SIZE; i++) this.metrics[off + i] += mat[i];
  }
}

// ============================================================================
// PRIORITY QUEUE
// ============================================================================
class PriorityQueue {
  constructor(capacity) {
    this.costs = new Float64Array(capacity);
    this.heap = new Uint32Array(capacity);
    this.pos = new Int32Array(capacity);
    this.costs.fill(INF);
    this.pos.fill(NULL);
    this.size = 0;
  }
  setCost(ei, cost) { this.costs[ei] = cost; }
  buildHeap(n) {
    this.size = n;
    for (let i = 0; i < n; i++) { this.heap[i] = i; this.pos[i] = i; }
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) this.siftDown(i);
  }
  siftDown(i) {
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < this.size && this.costs[this.heap[l]] < this.costs[this.heap[smallest]]) smallest = l;
      if (r < this.size && this.costs[this.heap[r]] < this.costs[this.heap[smallest]]) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
  siftUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.costs[this.heap[i]] >= this.costs[this.heap[p]]) break;
      this.swap(i, p);
      i = p;
    }
  }
  swap(i, j) {
    const ei = this.heap[i], ej = this.heap[j];
    this.heap[i] = ej; this.heap[j] = ei;
    this.pos[ei] = j; this.pos[ej] = i;
  }
  extractMin() {
    if (this.size === 0) return null;
    const ei = this.heap[0], cost = this.costs[ei];
    this.size--;
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size];
      this.pos[this.heap[0]] = 0;
      this.siftDown(0);
    }
    this.pos[ei] = NULL;
    return [ei, cost];
  }
  update(ei, cost) {
    const oldCost = this.costs[ei];
    this.costs[ei] = cost;
    const i = this.pos[ei];
    if (i === NULL) { this.insert(ei, cost); return; }
    if (cost < oldCost) this.siftUp(i); else this.siftDown(i);
  }
  insert(ei, cost) {
    this.costs[ei] = cost;
    this.heap[this.size] = ei;
    this.pos[ei] = this.size;
    this.siftUp(this.size);
    this.size++;
  }
  remove(ei) {
    const i = this.pos[ei];
    if (i === NULL) return;
    this.costs[ei] = -INF;
    this.siftUp(i);
    this.extractMin();
  }
}

// ============================================================================
// BUILD CONNECTIVITY
// ============================================================================
function buildEdgeFlaps(mesh) {
  const edgeMap = new Map();
  const faceCount = mesh.faceCount;
  
  for (let fi = 0; fi < faceCount; fi++) {
    if (mesh.isFaceDeleted(fi)) continue;
    const b = fi * 3;
    for (let c = 0; c < 3; c++) {
      const v0 = mesh.faceVertices[b + c];
      const v1 = mesh.faceVertices[b + (c + 1) % 3];
      const key = v0 < v1 ? v0 + ',' + v1 : v1 + ',' + v0;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ fi, corner: (c + 2) % 3 });
    }
  }
  
  const edgeCount = edgeMap.size;
  const flaps = new EdgeFlaps(edgeCount, faceCount);
  let ei = 0;
  
  for (const [key, faces] of edgeMap) {
    const [v0s, v1s] = key.split(',');
    const v0 = parseInt(v0s), v1 = parseInt(v1s);
    flaps.edges[ei * 2] = v0;
    flaps.edges[ei * 2 + 1] = v1;
    
    for (let i = 0; i < Math.min(faces.length, 2); i++) {
      const { fi, corner } = faces[i];
      flaps.edgeFaces[ei * 2 + i] = fi;
      flaps.edgeOpposites[ei * 2 + i] = corner;
      flaps.faceToEdge[corner * faceCount + fi] = ei;
    }
    ei++;
  }
  
  return flaps;
}

function buildSeamEdges(mesh, flaps) {
  const seamEdges = new SeamSet();
  const seamVertices = new SeamVertices(mesh.vertexCount);
  
  for (let ei = 0; ei < flaps.edgeCount; ei++) {
    const f0 = flaps.edgeFaces[ei * 2];
    const f1 = flaps.edgeFaces[ei * 2 + 1];
    if (f0 === NULL || f1 === NULL) continue;
    
    const opp0 = flaps.edgeOpposites[ei * 2];
    const opp1 = flaps.edgeOpposites[ei * 2 + 1];
    
    const b0 = f0 * 3, b1 = f1 * 3;
    const c0a = (opp0 + 1) % 3, c0b = (opp0 + 2) % 3;
    const c1a = (opp1 + 1) % 3, c1b = (opp1 + 2) % 3;
    
    const tc0a = mesh.faceTexCoords[b0 + c0a];
    const tc0b = mesh.faceTexCoords[b0 + c0b];
    const tc1a = mesh.faceTexCoords[b1 + c1a];
    const tc1b = mesh.faceTexCoords[b1 + c1b];
    
    const v0 = flaps.edges[ei * 2];
    const v1 = flaps.edges[ei * 2 + 1];
    
    // Check if UV coordinates differ
    const uv0a = [mesh.uvs[tc0a * 2], mesh.uvs[tc0a * 2 + 1]];
    const uv0b = [mesh.uvs[tc0b * 2], mesh.uvs[tc0b * 2 + 1]];
    const uv1a = [mesh.uvs[tc1a * 2], mesh.uvs[tc1a * 2 + 1]];
    const uv1b = [mesh.uvs[tc1b * 2], mesh.uvs[tc1b * 2 + 1]];
    
    const match = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
    const hasSeam = !(match(uv0a, uv1b) && match(uv0b, uv1a)) && !(match(uv0a, uv1a) && match(uv0b, uv1b));
    
    if (hasSeam) {
      seamEdges.add(v0, v1);
      seamVertices.addSeamEdge(v0, v1);
    }
  }
  
  return { seamEdges, seamVertices };
}

// ============================================================================
// COMPUTE METRICS
// ============================================================================
function computeMetrics(mesh) {
  const metrics = new VertexMetrics(mesh.vertexCount);
  const mat = new Float64Array(MATRIX_SIZE);
  
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (mesh.isFaceDeleted(fi)) continue;
    const b = fi * 3;
    
    const v0 = mesh.faceVertices[b], v1 = mesh.faceVertices[b + 1], v2 = mesh.faceVertices[b + 2];
    const t0 = mesh.faceTexCoords[b], t1 = mesh.faceTexCoords[b + 1], t2 = mesh.faceTexCoords[b + 2];
    
    // Build 5D points
    const p1 = [mesh.positions[v0*3], mesh.positions[v0*3+1], mesh.positions[v0*3+2], mesh.uvs[t0*2], mesh.uvs[t0*2+1]];
    const p2 = [mesh.positions[v1*3], mesh.positions[v1*3+1], mesh.positions[v1*3+2], mesh.uvs[t1*2], mesh.uvs[t1*2+1]];
    const p3 = [mesh.positions[v2*3], mesh.positions[v2*3+1], mesh.positions[v2*3+2], mesh.uvs[t2*2], mesh.uvs[t2*2+1]];
    
    // Edge vectors
    const e1 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2], p2[3]-p1[3], p2[4]-p1[4]];
    const e2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2], p3[3]-p1[3], p3[4]-p1[4]];
    
    const len1 = Math.sqrt(e1[0]*e1[0] + e1[1]*e1[1] + e1[2]*e1[2] + e1[3]*e1[3] + e1[4]*e1[4]);
    if (len1 < EPS) continue;
    
    for (let i = 0; i < 5; i++) e1[i] /= len1;
    
    const dot = e1[0]*e2[0] + e1[1]*e2[1] + e1[2]*e2[2] + e1[3]*e2[3] + e1[4]*e2[4];
    const e2o = [e2[0] - dot*e1[0], e2[1] - dot*e1[1], e2[2] - dot*e1[2], e2[3] - dot*e1[3], e2[4] - dot*e1[4]];
    const len2 = Math.sqrt(e2o[0]*e2o[0] + e2o[1]*e2o[1] + e2o[2]*e2o[2] + e2o[3]*e2o[3] + e2o[4]*e2o[4]);
    if (len2 < EPS) continue;
    
    for (let i = 0; i < 5; i++) e2o[i] /= len2;
    
    // Build 6x6 metric
    const d1 = p1[0]*e1[0] + p1[1]*e1[1] + p1[2]*e1[2] + p1[3]*e1[3] + p1[4]*e1[4];
    const d2 = p1[0]*e2o[0] + p1[1]*e2o[1] + p1[2]*e2o[2] + p1[3]*e2o[3] + p1[4]*e2o[4];
    const c = p1[0]*p1[0] + p1[1]*p1[1] + p1[2]*p1[2] + p1[3]*p1[3] + p1[4]*p1[4] - d1*d1 - d2*d2;
    
    mat.fill(0);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        mat[i * 6 + j] = (i === j ? 1 : 0) - e1[i]*e1[j] - e2o[i]*e2o[j];
      }
      mat[i * 6 + 5] = d1*e1[i] + d2*e2o[i] - p1[i];
      mat[5 * 6 + i] = mat[i * 6 + 5];
    }
    mat[35] = c;
    
    metrics.addMetric(v0, t0, mat);
    metrics.addMetric(v1, t1, mat);
    metrics.addMetric(v2, t2, mat);
  }
  
  return metrics;
}

// ============================================================================
// COST COMPUTATION
// ============================================================================
const M = new Float64Array(MATRIX_SIZE);
const V6 = new Float64Array(6);

function getCombinedMetric(metrics, vi0, tci0, vi1, tci1) {
  M.fill(0);
  const o0 = metrics.getOffset(vi0, tci0);
  const o1 = metrics.getOffset(vi1, tci1);
  if (o0 !== NULL) for (let i = 0; i < MATRIX_SIZE; i++) M[i] += metrics.metrics[o0 + i];
  if (o1 !== NULL) for (let i = 0; i < MATRIX_SIZE; i++) M[i] += metrics.metrics[o1 + i];
}

function quadForm() {
  let r = 0;
  for (let i = 0; i < 6; i++) {
    const row = i * 6;
    for (let j = 0; j < 6; j++) r += V6[i] * M[row + j] * V6[j];
  }
  return r;
}

function computeCost(ei, flaps, mesh, metrics, seamEdges, seamVertices, strictness) {
  if (flaps.isEdgeDeleted(ei)) return INF;
  
  const f0 = flaps.edgeFaces[ei * 2], f1 = flaps.edgeFaces[ei * 2 + 1];
  if (f0 === NULL || f1 === NULL) return INF;
  
  const v0 = flaps.edges[ei * 2], v1 = flaps.edges[ei * 2 + 1];
  const s0 = seamVertices.isOnSeam(v0), s1 = seamVertices.isOnSeam(v1);
  const isSeam = seamEdges.has(v0, v1);
  
  if (s0 && s1 && !isSeam) return INF;
  
  const opp0 = flaps.edgeOpposites[ei * 2];
  const b0 = f0 * 3;
  const c0a = (opp0 + 1) % 3, c0b = (opp0 + 2) % 3;
  
  const vi0 = mesh.faceVertices[b0 + c0a];
  const vi1 = mesh.faceVertices[b0 + c0b];
  const tci0 = mesh.faceTexCoords[b0 + c0a];
  const tci1 = mesh.faceTexCoords[b0 + c0b];
  
  getCombinedMetric(metrics, vi0, tci0, vi1, tci1);
  
  // Compute midpoint
  const px = (mesh.positions[vi0*3] + mesh.positions[vi1*3]) * 0.5;
  const py = (mesh.positions[vi0*3+1] + mesh.positions[vi1*3+1]) * 0.5;
  const pz = (mesh.positions[vi0*3+2] + mesh.positions[vi1*3+2]) * 0.5;
  const tu = (mesh.uvs[tci0*2] + mesh.uvs[tci1*2]) * 0.5;
  const tv = (mesh.uvs[tci0*2+1] + mesh.uvs[tci1*2+1]) * 0.5;
  
  V6[0] = px; V6[1] = py; V6[2] = pz; V6[3] = tu; V6[4] = tv; V6[5] = 1;
  return quadForm();
}

// ============================================================================
// CLEAN MESH
// ============================================================================
function cleanMesh(mesh) {
  let validCount = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (!mesh.isFaceDeleted(fi)) validCount++;
  }
  
  if (validCount === mesh.faceCount) return mesh;
  
  const usedV = new Set(), usedT = new Set();
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (mesh.isFaceDeleted(fi)) continue;
    const b = fi * 3;
    for (let c = 0; c < 3; c++) {
      usedV.add(mesh.faceVertices[b + c]);
      usedT.add(mesh.faceTexCoords[b + c]);
    }
  }
  
  const vRemap = new Int32Array(mesh.vertexCount).fill(NULL);
  const tRemap = new Int32Array(mesh.texCoordCount).fill(NULL);
  
  let newVi = 0;
  for (const vi of usedV) vRemap[vi] = newVi++;
  let newTi = 0;
  for (const ti of usedT) tRemap[ti] = newTi++;
  
  const newPos = new Float32Array(newVi * 3);
  const newUVs = new Float32Array(newTi * 2);
  const newFV = new Uint32Array(validCount * 3);
  const newFT = new Uint32Array(validCount * 3);
  
  for (const vi of usedV) {
    const ni = vRemap[vi];
    newPos[ni*3] = mesh.positions[vi*3];
    newPos[ni*3+1] = mesh.positions[vi*3+1];
    newPos[ni*3+2] = mesh.positions[vi*3+2];
  }
  
  for (const ti of usedT) {
    const ni = tRemap[ti];
    newUVs[ni*2] = mesh.uvs[ti*2];
    newUVs[ni*2+1] = mesh.uvs[ti*2+1];
  }
  
  let newFi = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (mesh.isFaceDeleted(fi)) continue;
    const b = fi * 3, nb = newFi * 3;
    for (let c = 0; c < 3; c++) {
      newFV[nb + c] = vRemap[mesh.faceVertices[b + c]];
      newFT[nb + c] = tRemap[mesh.faceTexCoords[b + c]];
    }
    newFi++;
  }
  
  return new MeshData(newPos, newUVs, newFV, newFT);
}

// ============================================================================
// MAIN DECIMATION
// ============================================================================
function decimate(mesh, targetVertices, strictness) {
  const startTime = performance.now();
  const originalVertices = mesh.vertexCount;
  const originalFaces = mesh.faceCount;
  
  // Build structures
  const flaps = buildEdgeFlaps(mesh);
  const { seamEdges, seamVertices } = buildSeamEdges(mesh, flaps);
  const metrics = computeMetrics(mesh);
  
  // Initialize queue
  const pq = new PriorityQueue(flaps.edgeCount);
  for (let ei = 0; ei < flaps.edgeCount; ei++) {
    pq.setCost(ei, computeCost(ei, flaps, mesh, metrics, seamEdges, seamVertices, strictness));
  }
  pq.buildHeap(flaps.edgeCount);
  
  // Main loop
  let currentVertices = originalVertices;
  let collapses = 0;
  let stopReason = "target_reached";
  let noProgress = 0;
  const maxNoProgress = 1000;
  let lastProgress = performance.now();
  
  while (currentVertices > targetVertices) {
    const entry = pq.extractMin();
    if (!entry) { stopReason = "empty_queue"; break; }
    
    const [ei, cost] = entry;
    if (!Number.isFinite(cost)) {
      if (++noProgress > maxNoProgress) { stopReason = "all_infinite_cost"; break; }
      continue;
    }
    
    if (flaps.isEdgeDeleted(ei)) continue;
    
    // Simplified collapse - just delete faces and update vertex
    const f0 = flaps.edgeFaces[ei * 2], f1 = flaps.edgeFaces[ei * 2 + 1];
    if (f0 === NULL || f1 === NULL) continue;
    
    const v0 = flaps.edges[ei * 2], v1 = flaps.edges[ei * 2 + 1];
    const s = v0 < v1 ? v0 : v1, d = v0 < v1 ? v1 : v0;
    
    // Move d to midpoint
    const px = (mesh.positions[v0*3] + mesh.positions[v1*3]) * 0.5;
    const py = (mesh.positions[v0*3+1] + mesh.positions[v1*3+1]) * 0.5;
    const pz = (mesh.positions[v0*3+2] + mesh.positions[v1*3+2]) * 0.5;
    mesh.positions[s*3] = px; mesh.positions[s*3+1] = py; mesh.positions[s*3+2] = pz;
    
    // Delete faces
    mesh.deleteFace(f0);
    mesh.deleteFace(f1);
    flaps.deleteEdge(ei);
    
    // Update face vertices
    for (let fi = 0; fi < mesh.faceCount; fi++) {
      if (mesh.isFaceDeleted(fi)) continue;
      const b = fi * 3;
      for (let c = 0; c < 3; c++) {
        if (mesh.faceVertices[b + c] === d) mesh.faceVertices[b + c] = s;
      }
    }
    
    collapses++;
    currentVertices--;
    noProgress = 0;
    
    // Send progress every 100ms
    const now = performance.now();
    if (now - lastProgress > 100) {
      self.postMessage({
        type: 'progress',
        data: {
          currentVertices,
          collapses,
          percentComplete: Math.round((1 - currentVertices / originalVertices) * 100)
        }
      });
      lastProgress = now;
    }
  }
  
  // Clean mesh
  const cleaned = cleanMesh(mesh);
  
  return {
    mesh: cleaned,
    originalVertices,
    finalVertices: cleaned.vertexCount,
    originalFaces,
    finalFaces: cleaned.faceCount,
    collapses,
    stopReason,
    processingTimeMs: performance.now() - startTime
  };
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type !== 'start') return;
  
  try {
    const { positions, uvs, faceVertices, faceTexCoords, targetVertices, targetPercent, strictness } = msg.data;
    
    const mesh = new MeshData(positions, uvs, faceVertices, faceTexCoords);
    
    let target;
    if (targetVertices !== undefined) {
      target = targetVertices;
    } else if (targetPercent !== undefined) {
      target = Math.floor(mesh.vertexCount * targetPercent / 100);
    } else {
      target = Math.floor(mesh.vertexCount * 0.5);
    }
    target = Math.max(4, target);
    
    const result = decimate(mesh, target, strictness);
    
    self.postMessage({
      type: 'result',
      data: {
        positions: result.mesh.positions,
        uvs: result.mesh.uvs,
        faceVertices: result.mesh.faceVertices,
        faceTexCoords: result.mesh.faceTexCoords,
        originalVertices: result.originalVertices,
        finalVertices: result.finalVertices,
        originalFaces: result.originalFaces,
        finalFaces: result.finalFaces,
        collapses: result.collapses,
        stopReason: result.stopReason,
        processingTimeMs: result.processingTimeMs
      }
    }, [
      result.mesh.positions.buffer,
      result.mesh.uvs.buffer,
      result.mesh.faceVertices.buffer,
      result.mesh.faceTexCoords.buffer
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', data: { message: err.message || String(err) } });
  }
};
`;

let fullWorkerBlobUrl: string | null = null;

export function getFullWorkerUrl(): string {
  if (!fullWorkerBlobUrl) {
    const blob = new Blob([FULL_WORKER_CODE], {
      type: "application/javascript",
    });
    fullWorkerBlobUrl = URL.createObjectURL(blob);
  }
  return fullWorkerBlobUrl;
}
