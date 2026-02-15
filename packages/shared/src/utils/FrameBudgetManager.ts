/**
 * FrameBudgetManager - Manages frame time budget to prevent main thread jank
 *
 * Tracks frame time and provides utilities to defer heavy work when the frame
 * budget is exceeded. This helps maintain smooth frame rates by spreading
 * non-critical work across multiple frames.
 *
 * Key Features:
 * - Frame time tracking with budget enforcement
 * - Time-sliced job execution
 * - requestIdleCallback integration for deferred work
 * - Priority-based work queue
 *
 * Usage:
 * ```typescript
 * const budget = FrameBudgetManager.getInstance();
 *
 * // Start of frame
 * budget.beginFrame();
 *
 * // Check if we have budget for heavy work
 * if (budget.hasTimeRemaining(5)) {
 *   doHeavyWork();
 * } else {
 *   budget.deferWork('heavyWork', doHeavyWork, Priority.LOW);
 * }
 *
 * // End of frame
 * budget.endFrame();
 * ```
 */

/** Priority levels for deferred work */
export enum WorkPriority {
  /** Critical work - runs on next frame regardless */
  CRITICAL = 0,
  /** High priority - runs when budget allows, up to 2 frames delay */
  HIGH = 1,
  /** Normal priority - runs during idle time */
  NORMAL = 2,
  /** Low priority - runs when system is idle */
  LOW = 3,
}

/** Deferred work item */
interface DeferredWork {
  id: string;
  callback: () => void | Promise<void>;
  priority: WorkPriority;
  maxDelayFrames: number;
  framesDeferred: number;
  estimatedDurationMs: number;
}

/** Frame timing statistics */
export interface FrameTimingStats {
  /** Current frame time in ms */
  currentFrameTime: number;
  /** Average frame time over last 60 frames */
  averageFrameTime: number;
  /** Maximum frame time in last 60 frames */
  maxFrameTime: number;
  /** Frames over budget in last 60 frames */
  framesOverBudget: number;
  /** Current frame budget in ms */
  frameBudget: number;
  /** Pending deferred work count */
  pendingWorkCount: number;
  /** Work completed via idle callbacks */
  idleWorkCompleted: number;
}

/** Configuration options */
interface FrameBudgetConfig {
  /** Target frame time in ms (default: 16.67 for 60 FPS) */
  targetFrameTime?: number;
  /** Reserve time for rendering in ms (default: 4) */
  renderReserve?: number;
  /** Maximum deferred work items (default: 1000) */
  maxDeferredItems?: number;
  /** Enable idle callback processing (default: true) */
  useIdleCallbacks?: boolean;
  /** Maximum time per idle callback in ms (default: 10) */
  idleCallbackBudget?: number;
}

/**
 * FrameBudgetManager singleton
 * Manages frame time budget and deferred work scheduling
 */
export class FrameBudgetManager {
  private static instance: FrameBudgetManager | null = null;

  // Configuration
  private targetFrameTime: number;
  private renderReserve: number;
  private maxDeferredItems: number;
  private useIdleCallbacks: boolean;
  private idleCallbackBudget: number;

  // Frame timing
  private frameStartTime = 0;
  private lastFrameTime = 0;
  private frameTimeSamples: number[] = [];
  private framesOverBudgetCount = 0;
  private readonly maxSamples = 60;

  // Work queue
  private deferredWork: Map<string, DeferredWork> = new Map();
  private workByPriority: Map<WorkPriority, Set<string>> = new Map();
  private idleWorkCompleted = 0;
  private idleCallbackId: number | null = null;

  // State
  private inFrame = false;
  private enabled = true;

  private constructor(config: FrameBudgetConfig = {}) {
    this.targetFrameTime = config.targetFrameTime ?? 16.67; // 60 FPS
    this.renderReserve = config.renderReserve ?? 4; // Reserve for GPU work
    this.maxDeferredItems = config.maxDeferredItems ?? 1000;
    this.useIdleCallbacks = config.useIdleCallbacks ?? true;
    this.idleCallbackBudget = config.idleCallbackBudget ?? 10;

    // Initialize priority queues
    for (const priority of Object.values(WorkPriority)) {
      if (typeof priority === "number") {
        this.workByPriority.set(priority, new Set());
      }
    }

    // Start idle callback processing
    if (this.useIdleCallbacks && typeof requestIdleCallback !== "undefined") {
      this.scheduleIdleCallback();
    }
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: FrameBudgetConfig): FrameBudgetManager {
    if (!FrameBudgetManager.instance) {
      FrameBudgetManager.instance = new FrameBudgetManager(config);
    }
    return FrameBudgetManager.instance;
  }

  /**
   * Reset the singleton (useful for tests)
   */
  static reset(): void {
    if (FrameBudgetManager.instance) {
      FrameBudgetManager.instance.destroy();
      FrameBudgetManager.instance = null;
    }
  }

  /**
   * Enable/disable the budget manager
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Update target frame time (e.g., for different refresh rates)
   */
  setTargetFrameTime(ms: number): void {
    this.targetFrameTime = ms;
  }

  /**
   * Call at the start of each frame
   */
  beginFrame(): void {
    this.frameStartTime = performance.now();
    this.inFrame = true;

    // Process critical work that couldn't be deferred further
    this.processCriticalWork();
  }

  /**
   * Call at the end of each frame
   */
  endFrame(): void {
    const frameTime = performance.now() - this.frameStartTime;
    this.lastFrameTime = frameTime;
    this.inFrame = false;

    // Track frame time
    this.frameTimeSamples.push(frameTime);
    if (this.frameTimeSamples.length > this.maxSamples) {
      this.frameTimeSamples.shift();
    }

    // Track over-budget frames
    if (frameTime > this.targetFrameTime) {
      this.framesOverBudgetCount = Math.min(
        this.framesOverBudgetCount + 1,
        this.maxSamples,
      );
    } else if (this.framesOverBudgetCount > 0) {
      this.framesOverBudgetCount--;
    }

    // Age deferred work
    this.ageDeferredWork();
  }

  /**
   * Get remaining time budget for this frame (in ms)
   */
  getTimeRemaining(): number {
    if (!this.enabled || !this.inFrame) {
      return this.targetFrameTime - this.renderReserve;
    }

    const elapsed = performance.now() - this.frameStartTime;
    return Math.max(0, this.targetFrameTime - this.renderReserve - elapsed);
  }

  /**
   * Check if we have at least `ms` milliseconds remaining in the budget
   */
  hasTimeRemaining(ms: number = 1): boolean {
    return this.getTimeRemaining() >= ms;
  }

  /**
   * Check if the current frame is over budget
   */
  isOverBudget(): boolean {
    return this.getTimeRemaining() <= 0;
  }

  /**
   * Get elapsed time in current frame (in ms)
   */
  getElapsedTime(): number {
    if (!this.inFrame) return 0;
    return performance.now() - this.frameStartTime;
  }

  /**
   * Defer work to be executed when budget allows
   *
   * @param id - Unique identifier for this work (duplicate IDs update existing)
   * @param callback - Function to execute
   * @param priority - Priority level
   * @param estimatedDurationMs - Estimated execution time
   * @param maxDelayFrames - Maximum frames to defer (0 = run next frame)
   */
  deferWork(
    id: string,
    callback: () => void | Promise<void>,
    priority: WorkPriority = WorkPriority.NORMAL,
    estimatedDurationMs: number = 5,
    maxDelayFrames: number = 10,
  ): void {
    if (!this.enabled) {
      // When disabled, execute immediately
      callback();
      return;
    }

    // Remove existing work with same ID
    this.cancelWork(id);

    // Check queue limit
    if (this.deferredWork.size >= this.maxDeferredItems) {
      // Force execute oldest low-priority work
      this.evictLowestPriority();
    }

    const work: DeferredWork = {
      id,
      callback,
      priority,
      maxDelayFrames,
      framesDeferred: 0,
      estimatedDurationMs,
    };

    this.deferredWork.set(id, work);
    this.workByPriority.get(priority)?.add(id);
  }

  /**
   * Cancel deferred work by ID
   */
  cancelWork(id: string): boolean {
    const work = this.deferredWork.get(id);
    if (!work) return false;

    this.deferredWork.delete(id);
    this.workByPriority.get(work.priority)?.delete(id);
    return true;
  }

  /**
   * Execute a function if budget allows, otherwise defer it
   *
   * @param id - Unique identifier
   * @param callback - Function to execute
   * @param estimatedDurationMs - Estimated execution time
   * @param priority - Priority if deferred
   * @returns true if executed immediately, false if deferred
   */
  executeOrDefer(
    id: string,
    callback: () => void,
    estimatedDurationMs: number = 5,
    priority: WorkPriority = WorkPriority.NORMAL,
  ): boolean {
    if (!this.enabled || this.hasTimeRemaining(estimatedDurationMs)) {
      callback();
      return true;
    }

    this.deferWork(id, callback, priority, estimatedDurationMs);
    return false;
  }

  /**
   * Yield to main thread using requestIdleCallback or requestAnimationFrame.
   * Use this in async loops to prevent blocking.
   *
   * @param useIdleCallback - If true, uses requestIdleCallback (lower priority, better for background work)
   * @returns Promise that resolves on next idle or animation frame
   *
   * @example
   * ```typescript
   * for (let i = 0; i < 10000; i++) {
   *   doHeavyWork(i);
   *   if (i % 100 === 0) await frameBudget.yieldToMainThread();
   * }
   * ```
   */
  yieldToMainThread(useIdleCallback: boolean = true): Promise<void> {
    return new Promise((resolve) => {
      if (useIdleCallback && typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => resolve(), { timeout: 50 });
      } else {
        // Fall back to setTimeout(0) which yields to next task
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * Execute work in time-sliced batches
   *
   * @param items - Items to process
   * @param processor - Function to process each item
   * @param batchSize - Items per batch (default: 10)
   * @param budgetPerBatch - Max ms per batch (default: 2)
   * @returns Promise that resolves when all items are processed
   */
  async processInBatches<T>(
    items: T[],
    processor: (item: T, index: number) => void,
    batchSize: number = 10,
    budgetPerBatch: number = 2,
  ): Promise<void> {
    let index = 0;

    const processBatch = (): boolean => {
      const batchStart = performance.now();
      const batchEnd = index + batchSize;

      while (index < items.length && index < batchEnd) {
        processor(items[index], index);
        index++;

        // Check time within batch
        if (performance.now() - batchStart > budgetPerBatch) {
          break;
        }
      }

      return index >= items.length;
    };

    // Process batches across frames
    return new Promise((resolve) => {
      const processLoop = () => {
        if (this.hasTimeRemaining(budgetPerBatch)) {
          const done = processBatch();
          if (done) {
            resolve();
            return;
          }
        }

        // Schedule next batch
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => processLoop(), { timeout: 100 });
        } else {
          requestAnimationFrame(() => processLoop());
        }
      };

      processLoop();
    });
  }

  /**
   * Get frame timing statistics
   */
  getStats(): FrameTimingStats {
    const avg =
      this.frameTimeSamples.length > 0
        ? this.frameTimeSamples.reduce((a, b) => a + b, 0) /
          this.frameTimeSamples.length
        : 0;

    const max =
      this.frameTimeSamples.length > 0 ? Math.max(...this.frameTimeSamples) : 0;

    return {
      currentFrameTime: this.lastFrameTime,
      averageFrameTime: avg,
      maxFrameTime: max,
      framesOverBudget: this.framesOverBudgetCount,
      frameBudget: this.targetFrameTime,
      pendingWorkCount: this.deferredWork.size,
      idleWorkCompleted: this.idleWorkCompleted,
    };
  }

  /**
   * Process pending deferred work within budget
   * Call this during update if you want to process deferred work during frame
   *
   * @param maxMs - Maximum time to spend processing (default: remaining budget / 2)
   * @returns Number of work items processed
   */
  processDeferredWork(maxMs?: number): number {
    const budget = maxMs ?? this.getTimeRemaining() / 2;
    if (budget <= 0) return 0;

    const startTime = performance.now();
    let processed = 0;

    // Process by priority (CRITICAL first, then HIGH, etc.)
    for (const priority of [
      WorkPriority.CRITICAL,
      WorkPriority.HIGH,
      WorkPriority.NORMAL,
      WorkPriority.LOW,
    ]) {
      const workIds = this.workByPriority.get(priority);
      if (!workIds || workIds.size === 0) continue;

      for (const id of Array.from(workIds)) {
        // Check budget
        if (performance.now() - startTime > budget) {
          return processed;
        }

        const work = this.deferredWork.get(id);
        if (!work) continue;

        // Check if we have time for this work
        if (performance.now() - startTime + work.estimatedDurationMs > budget) {
          continue;
        }

        // Execute work
        try {
          const result = work.callback();
          if (result instanceof Promise) {
            // Async work - don't wait, just fire and forget
            result.catch((e) =>
              console.error(`[FrameBudget] Async work ${id} failed:`, e),
            );
          }
        } catch (e) {
          console.error(`[FrameBudget] Work ${id} failed:`, e);
        }

        // Remove from queues
        this.deferredWork.delete(id);
        workIds.delete(id);
        processed++;
      }
    }

    return processed;
  }

  /**
   * Destroy the manager and clean up
   */
  destroy(): void {
    if (
      this.idleCallbackId !== null &&
      typeof cancelIdleCallback !== "undefined"
    ) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }

    this.deferredWork.clear();
    for (const set of this.workByPriority.values()) {
      set.clear();
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private processCriticalWork(): void {
    const criticalIds = this.workByPriority.get(WorkPriority.CRITICAL);
    if (!criticalIds || criticalIds.size === 0) return;

    for (const id of Array.from(criticalIds)) {
      const work = this.deferredWork.get(id);
      if (!work) continue;

      // Critical work with maxed delay must run
      if (work.framesDeferred >= work.maxDelayFrames) {
        try {
          const result = work.callback();
          if (result instanceof Promise) {
            result.catch((e) =>
              console.error(`[FrameBudget] Critical work ${id} failed:`, e),
            );
          }
        } catch (e) {
          console.error(`[FrameBudget] Critical work ${id} failed:`, e);
        }

        this.deferredWork.delete(id);
        criticalIds.delete(id);
      }
    }
  }

  private ageDeferredWork(): void {
    // Increment frame count for all deferred work
    for (const work of this.deferredWork.values()) {
      work.framesDeferred++;

      // Promote to higher priority if delayed too long
      if (work.framesDeferred >= work.maxDelayFrames) {
        if (work.priority !== WorkPriority.CRITICAL) {
          this.workByPriority.get(work.priority)?.delete(work.id);
          work.priority = WorkPriority.CRITICAL;
          this.workByPriority.get(WorkPriority.CRITICAL)?.add(work.id);
        }
      } else if (
        work.framesDeferred >= work.maxDelayFrames / 2 &&
        work.priority === WorkPriority.LOW
      ) {
        this.workByPriority.get(WorkPriority.LOW)?.delete(work.id);
        work.priority = WorkPriority.NORMAL;
        this.workByPriority.get(WorkPriority.NORMAL)?.add(work.id);
      }
    }
  }

  private evictLowestPriority(): void {
    // Find and execute oldest lowest-priority work
    for (const priority of [
      WorkPriority.LOW,
      WorkPriority.NORMAL,
      WorkPriority.HIGH,
    ]) {
      const workIds = this.workByPriority.get(priority);
      if (!workIds || workIds.size === 0) continue;

      const id = workIds.values().next().value;
      if (!id) continue;

      const work = this.deferredWork.get(id);
      if (work) {
        try {
          work.callback();
        } catch (e) {
          console.error(`[FrameBudget] Evicted work ${id} failed:`, e);
        }
        this.deferredWork.delete(id);
        workIds.delete(id);
        return;
      }
    }
  }

  private scheduleIdleCallback(): void {
    if (typeof requestIdleCallback === "undefined") return;

    this.idleCallbackId = requestIdleCallback(
      (deadline) => {
        this.processIdleWork(deadline);
        this.scheduleIdleCallback();
      },
      { timeout: 1000 },
    );
  }

  private processIdleWork(deadline: IdleDeadline): void {
    const maxTime = Math.min(deadline.timeRemaining(), this.idleCallbackBudget);
    if (maxTime <= 0) return;

    const startTime = performance.now();

    // Process LOW and NORMAL priority work during idle
    for (const priority of [WorkPriority.LOW, WorkPriority.NORMAL]) {
      const workIds = this.workByPriority.get(priority);
      if (!workIds || workIds.size === 0) continue;

      for (const id of Array.from(workIds)) {
        if (performance.now() - startTime > maxTime) return;

        const work = this.deferredWork.get(id);
        if (!work) continue;

        try {
          const result = work.callback();
          if (result instanceof Promise) {
            result.catch((e) =>
              console.error(`[FrameBudget] Idle work ${id} failed:`, e),
            );
          }
          this.idleWorkCompleted++;
        } catch (e) {
          console.error(`[FrameBudget] Idle work ${id} failed:`, e);
        }

        this.deferredWork.delete(id);
        workIds.delete(id);
      }
    }
  }
}

/**
 * Convenience function to get the budget manager instance
 */
export function getFrameBudget(): FrameBudgetManager {
  return FrameBudgetManager.getInstance();
}

/**
 * Decorator for methods that should respect frame budget
 * Usage: @budgeted(5, WorkPriority.NORMAL)
 */
export function budgeted(
  estimatedMs: number = 5,
  priority: WorkPriority = WorkPriority.NORMAL,
) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value as (...args: unknown[]) => void;

    descriptor.value = function (...args: unknown[]) {
      const budget = FrameBudgetManager.getInstance();
      const id = `${(this as { constructor: { name: string } }).constructor.name}.${propertyKey}`;

      if (budget.hasTimeRemaining(estimatedMs)) {
        return originalMethod.apply(this, args);
      } else {
        budget.deferWork(
          id,
          () => originalMethod.apply(this, args),
          priority,
          estimatedMs,
        );
      }
    };

    return descriptor;
  };
}
