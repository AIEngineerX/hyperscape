/**
 * WorkerPool - Manages a pool of plant generation workers
 *
 * Provides async generation methods that distribute work across
 * multiple web workers for parallel processing.
 *
 * IMPORTANT: This pool uses the real PlantWorker implementation for
 * mesh generation, distortion, and texture generation. The worker code
 * is embedded inline since web workers can't import ES modules directly.
 */

import type {
  LeafParamDict,
  MeshData,
  RenderQuality,
  WorkerMeshRequest,
  WorkerResponse,
} from "../types.js";
import { generateLeafShape } from "../shape/LeafShape.js";
import { generateLeafVeins, getMidrib } from "../veins/LeafVeins.js";
import { triangulateLeaf } from "../mesh/Triangulation.js";
import { extrudeLeafMesh } from "../mesh/Extrusion.js";
import { applyDistortions } from "../distortion/LeafDistortion.js";

// =============================================================================
// WORKER POOL
// =============================================================================

interface PendingTask {
  resolve: (data: MeshData) => void;
  reject: (error: Error) => void;
}

/**
 * Worker pool for parallel plant generation.
 *
 * NOTE: Due to web worker module limitations, this pool provides a synchronous
 * fallback that runs on the main thread. For actual parallel processing,
 * use the PlantWorker.ts file directly with a bundler that supports worker URLs.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private available: Worker[] = [];
  private pending: Map<string, PendingTask> = new Map();
  private taskQueue: WorkerMeshRequest[] = [];
  private nextTaskId = 0;
  private workerUrl: string | null = null;
  private useMainThreadFallback = false;

  constructor(workerCount: number = navigator.hardwareConcurrency || 4) {
    this.workerUrl = null;
    // Workers will be initialized lazily when first used
    this.initWorkerCount = workerCount;
  }

  private initWorkerCount: number;

  /**
   * Initialize workers (called lazily)
   * Falls back to main-thread processing if workers can't be created
   */
  private async initWorkers(): Promise<void> {
    if (this.workers.length > 0 || this.useMainThreadFallback) return;

    try {
      // Attempt to create workers
      for (let i = 0; i < this.initWorkerCount; i++) {
        const worker = await this.createWorker();
        if (worker) {
          this.workers.push(worker);
          this.available.push(worker);
        }
      }
    } catch (error) {
      console.warn(
        "[WorkerPool] Failed to create workers, using main thread fallback:",
        error,
      );
    }

    // If no workers were created successfully, use main thread fallback
    if (this.workers.length === 0) {
      console.warn(
        "[WorkerPool] No workers available, using synchronous main-thread processing",
      );
      this.useMainThreadFallback = true;
    }
  }

  /**
   * Create a single worker
   * Returns null if worker creation fails (allows graceful fallback)
   */
  private async createWorker(): Promise<Worker | null> {
    // Check if Worker is available
    if (typeof Worker === "undefined") {
      console.warn(
        "[WorkerPool] Web Workers not available in this environment",
      );
      return null;
    }

    try {
      // Try to use the PlantWorker module directly if bundler supports it
      // This is the preferred approach with modern bundlers like Vite/esbuild
      const workerUrl = new URL("./PlantWorker.js", import.meta.url);
      const worker = new Worker(workerUrl, { type: "module" });

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(worker, event.data);
      };

      worker.onerror = (error) => {
        console.error("[WorkerPool] Worker error:", error);
      };

      return worker;
    } catch (error) {
      // Bundler doesn't support worker URLs or module workers not available
      console.warn("[WorkerPool] Module worker creation failed:", error);
      return null;
    }
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(worker: Worker, response: WorkerResponse): void {
    const task = this.pending.get(response.id);
    if (!task) return;

    this.pending.delete(response.id);

    if (response.type === "error") {
      task.reject(new Error(response.error ?? "Unknown worker error"));
    } else if (response.data) {
      task.resolve(response.data as MeshData);
    } else {
      task.reject(new Error("No data in worker response"));
    }

    // Return worker to available pool
    this.available.push(worker);

    // Process next task in queue
    this.processQueue();
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0 || this.available.length === 0) return;

    const worker = this.available.pop()!;
    const task = this.taskQueue.shift()!;

    worker.postMessage(task);
  }

  /**
   * Generate a mesh synchronously on the main thread (fallback)
   * This is used when workers are not available
   */
  private generateMeshSync(
    params: LeafParamDict,
    quality: RenderQuality,
    seed: number,
  ): MeshData {
    const lineSteps =
      quality === "Maximum" ? 15 : quality === "Medium" ? 10 : 6;

    // Generate shape
    const shape = generateLeafShape(params);

    // Generate veins
    const veins = generateLeafVeins(shape, params, seed);
    const midrib = getMidrib(veins);

    // Triangulate
    let mesh = triangulateLeaf(shape.curves, {
      lineSteps,
      addInternalPoints: true,
    });

    // Extrude
    mesh = extrudeLeafMesh(mesh, params);

    // Apply distortions if midrib exists
    if (midrib) {
      mesh = applyDistortions(mesh, midrib, params, seed);
    }

    return mesh;
  }

  /**
   * Generate a mesh asynchronously
   * Uses workers if available, falls back to main thread processing
   */
  async generateMesh(
    params: LeafParamDict,
    quality: RenderQuality,
    seed: number,
  ): Promise<MeshData> {
    await this.initWorkers();

    // Use main thread fallback if no workers available
    if (this.useMainThreadFallback) {
      return this.generateMeshSync(params, quality, seed);
    }

    const id = `task_${this.nextTaskId++}`;

    const request: WorkerMeshRequest = {
      type: "generateMesh",
      id,
      params,
      quality,
      seed,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      if (this.available.length > 0) {
        const worker = this.available.pop()!;
        worker.postMessage(request);
      } else {
        this.taskQueue.push(request);
      }
    });
  }

  /**
   * Generate multiple meshes in parallel
   */
  async generateMeshes(
    configs: Array<{
      params: LeafParamDict;
      quality: RenderQuality;
      seed: number;
    }>,
  ): Promise<MeshData[]> {
    return Promise.all(
      configs.map((config) =>
        this.generateMesh(config.params, config.quality, config.seed),
      ),
    );
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.available = [];
    this.pending.clear();
    this.taskQueue = [];

    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }
}

/**
 * Create a worker pool with default settings
 */
export function createWorkerPool(workerCount?: number): WorkerPool {
  return new WorkerPool(workerCount);
}
