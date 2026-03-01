/**
 * Memory Monitoring Infrastructure
 *
 * Provides comprehensive memory monitoring, leak detection, and profiling tools
 * for the Hyperscape server. Features include:
 *
 * - Real-time memory tracking with trend analysis
 * - Collection size monitoring (Maps, Sets, Arrays)
 * - Memory leak detection based on sustained growth
 * - Periodic heap snapshots for profiling
 * - Memory pressure alerts
 */

import type { World } from "@hyperscape/shared";
import v8 from "v8";
import fs from "fs";
import path from "path";

/** Memory sample for trend analysis */
interface MemorySample {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

/** Collection metric for tracking internal data structures */
interface CollectionMetric {
  name: string;
  size: number;
  previousSize: number;
  growthRate: number;
}

/** Memory leak warning */
interface LeakWarning {
  timestamp: number;
  type: "rss" | "heap" | "collection";
  message: string;
  growthMB: number;
  durationMs: number;
}

/** Configuration for the memory monitor */
export interface MemoryMonitorConfig {
  /** Sampling interval in milliseconds (default: 30000) */
  sampleIntervalMs?: number;
  /** Number of samples to keep for trend analysis (default: 60) */
  sampleHistorySize?: number;
  /** Memory growth rate (MB/min) that triggers a warning (default: 10) */
  leakWarningThresholdMBPerMin?: number;
  /** Sustained growth duration (ms) before warning (default: 300000 = 5 min) */
  sustainedGrowthThresholdMs?: number;
  /** Memory limit in GB for soft warnings (default: 12) */
  memoryLimitGB?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Enable collection tracking (default: true) */
  trackCollections?: boolean;
}

/** Accessor interface for tracked collections */
export interface CollectionAccessor {
  name: string;
  getSize: () => number;
}

/**
 * Memory Monitor
 *
 * Central service for monitoring server memory usage and detecting leaks.
 */
export class MemoryMonitor {
  private config: Required<MemoryMonitorConfig>;
  private samples: MemorySample[] = [];
  private collectionMetrics: Map<string, CollectionMetric> = new Map();
  private leakWarnings: LeakWarning[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private world: World | null = null;
  private customCollections: CollectionAccessor[] = [];
  private startTime: number = Date.now();
  private isRunning = false;

  /** Maximum leak warnings to retain */
  private static readonly MAX_LEAK_WARNINGS = 100;

  constructor(config: MemoryMonitorConfig = {}) {
    this.config = {
      sampleIntervalMs: config.sampleIntervalMs ?? 30_000,
      sampleHistorySize: config.sampleHistorySize ?? 60,
      leakWarningThresholdMBPerMin: config.leakWarningThresholdMBPerMin ?? 10,
      sustainedGrowthThresholdMs:
        config.sustainedGrowthThresholdMs ?? 5 * 60 * 1000,
      memoryLimitGB: config.memoryLimitGB ?? 12,
      verbose: config.verbose ?? false,
      trackCollections: config.trackCollections ?? true,
    };
  }

  /**
   * Start the memory monitor
   */
  start(world?: World): void {
    if (this.isRunning) {
      console.warn("[MemoryMonitor] Already running");
      return;
    }

    this.world = world ?? null;
    this.startTime = Date.now();
    this.isRunning = true;

    // Take initial sample
    this.takeSample();

    // Start periodic sampling
    this.timer = setInterval(() => {
      this.takeSample();
      this.analyzeMemoryTrends();
      if (this.config.trackCollections) {
        this.updateCollectionMetrics();
      }
    }, this.config.sampleIntervalMs);

    // Don't keep process alive just for monitoring
    this.timer.unref?.();

    console.log(
      `[MemoryMonitor] Started (interval: ${this.config.sampleIntervalMs}ms, history: ${this.config.sampleHistorySize} samples)`,
    );
  }

  /**
   * Stop the memory monitor
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log("[MemoryMonitor] Stopped");
  }

  /**
   * Register a custom collection to track
   */
  registerCollection(accessor: CollectionAccessor): void {
    this.customCollections.push(accessor);
  }

  /**
   * Unregister a custom collection
   */
  unregisterCollection(name: string): void {
    this.customCollections = this.customCollections.filter(
      (c) => c.name !== name,
    );
    this.collectionMetrics.delete(name);
  }

  /**
   * Take a memory sample
   */
  private takeSample(): void {
    const mem = process.memoryUsage();
    const sample: MemorySample = {
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    };

    this.samples.push(sample);

    // Keep only the configured history size
    while (this.samples.length > this.config.sampleHistorySize) {
      this.samples.shift();
    }

    if (this.config.verbose) {
      const MB = 1024 * 1024;
      console.log(
        `[MemoryMonitor] Sample: RSS=${(sample.rss / MB).toFixed(1)}MB ` +
          `HeapUsed=${(sample.heapUsed / MB).toFixed(1)}MB`,
      );
    }
  }

  /**
   * Analyze memory trends and detect potential leaks
   */
  private analyzeMemoryTrends(): void {
    if (this.samples.length < 2) return;

    const now = Date.now();
    const MB = 1024 * 1024;

    // Find samples within the sustained growth window
    const windowStart = now - this.config.sustainedGrowthThresholdMs;
    const windowSamples = this.samples.filter(
      (s) => s.timestamp >= windowStart,
    );

    if (windowSamples.length < 2) return;

    // Calculate growth rates
    const firstSample = windowSamples[0];
    const lastSample = windowSamples[windowSamples.length - 1];
    const durationMs = lastSample.timestamp - firstSample.timestamp;
    const durationMin = durationMs / 60_000;

    if (durationMin < 1) return; // Need at least 1 minute of data

    // RSS growth rate
    const rssGrowthMB = (lastSample.rss - firstSample.rss) / MB;
    const rssGrowthRate = rssGrowthMB / durationMin;

    // Heap growth rate
    const heapGrowthMB = (lastSample.heapUsed - firstSample.heapUsed) / MB;
    const heapGrowthRate = heapGrowthMB / durationMin;

    // Check for sustained growth
    if (rssGrowthRate > this.config.leakWarningThresholdMBPerMin) {
      this.recordLeakWarning({
        timestamp: now,
        type: "rss",
        message: `Sustained RSS growth: ${rssGrowthRate.toFixed(2)} MB/min over ${durationMin.toFixed(1)} min`,
        growthMB: rssGrowthMB,
        durationMs,
      });
    }

    if (heapGrowthRate > this.config.leakWarningThresholdMBPerMin) {
      this.recordLeakWarning({
        timestamp: now,
        type: "heap",
        message: `Sustained heap growth: ${heapGrowthRate.toFixed(2)} MB/min over ${durationMin.toFixed(1)} min`,
        growthMB: heapGrowthMB,
        durationMs,
      });
    }

    // Check absolute memory limits
    const softLimit = this.config.memoryLimitGB * 1024 * MB * 0.8;
    if (lastSample.rss > softLimit) {
      console.warn(
        `[MemoryMonitor] ⚠️ RSS ${(lastSample.rss / MB).toFixed(1)}MB > 80% of ${this.config.memoryLimitGB}GB limit`,
      );
    }
  }

  /**
   * Record a leak warning
   */
  private recordLeakWarning(warning: LeakWarning): void {
    // Avoid duplicate warnings within the same minute
    const recentSame = this.leakWarnings.find(
      (w) =>
        w.type === warning.type && warning.timestamp - w.timestamp < 60_000,
    );

    if (!recentSame) {
      this.leakWarnings.push(warning);
      console.warn(`[MemoryMonitor] ⚠️ LEAK WARNING: ${warning.message}`);

      // Trim old warnings
      while (this.leakWarnings.length > MemoryMonitor.MAX_LEAK_WARNINGS) {
        this.leakWarnings.shift();
      }
    }
  }

  /**
   * Update collection size metrics
   */
  private updateCollectionMetrics(): void {
    // Track custom registered collections
    for (const accessor of this.customCollections) {
      try {
        const size = accessor.getSize();
        const existing = this.collectionMetrics.get(accessor.name);
        const previousSize = existing?.size ?? size;
        const growthRate = size - previousSize;

        this.collectionMetrics.set(accessor.name, {
          name: accessor.name,
          size,
          previousSize,
          growthRate,
        });

        // Warn on significant collection growth
        if (growthRate > 1000) {
          console.warn(
            `[MemoryMonitor] Collection "${accessor.name}" grew by ${growthRate} entries`,
          );
        }
      } catch {
        // Collection accessor failed - remove it
        this.unregisterCollection(accessor.name);
      }
    }

    // Track world collections if available
    if (this.world) {
      this.trackWorldCollections();
    }
  }

  /**
   * Track collections on the World object
   */
  private trackWorldCollections(): void {
    if (!this.world) return;

    const worldRecord = this.world as {
      entities?: {
        items?: { length?: number; size?: number };
        players?: { length?: number; size?: number };
      };
      systemsByName?: Map<string, unknown>;
    };

    // Track entity counts
    if (worldRecord.entities) {
      this.trackCollectionSize(
        "world.entities.items",
        worldRecord.entities.items,
      );
      this.trackCollectionSize(
        "world.entities.players",
        worldRecord.entities.players,
      );
    }

    // Track ServerNetwork static collections via systemsByName
    const networkSystem = worldRecord.systemsByName?.get("network") as
      | {
          constructor?: {
            characterSockets?: Map<string, unknown>;
            agentGoals?: Map<string, unknown>;
            agentThoughts?: Map<string, unknown>;
          };
        }
      | undefined;

    if (networkSystem?.constructor) {
      const ctor = networkSystem.constructor as {
        characterSockets?: Map<string, unknown>;
        agentGoals?: Map<string, unknown>;
        agentThoughts?: Map<string, unknown>;
      };
      this.trackCollectionSize(
        "ServerNetwork.characterSockets",
        ctor.characterSockets,
      );
      this.trackCollectionSize("ServerNetwork.agentGoals", ctor.agentGoals);
      this.trackCollectionSize(
        "ServerNetwork.agentThoughts",
        ctor.agentThoughts,
      );
    }
  }

  /**
   * Helper to track collection size
   */
  private trackCollectionSize(name: string, collection: unknown): void {
    const size = this.getSize(collection);
    if (size === null) return;

    const existing = this.collectionMetrics.get(name);
    const previousSize = existing?.size ?? size;
    const growthRate = size - previousSize;

    this.collectionMetrics.set(name, {
      name,
      size,
      previousSize,
      growthRate,
    });
  }

  /**
   * Get size of a collection
   */
  private getSize(collection: unknown): number | null {
    if (collection === null || collection === undefined) return null;

    if (collection instanceof Map || collection instanceof Set) {
      return collection.size;
    }

    if (Array.isArray(collection)) {
      return collection.length;
    }

    if (
      typeof collection === "object" &&
      "size" in collection &&
      typeof collection.size === "number"
    ) {
      return collection.size;
    }

    if (
      typeof collection === "object" &&
      "length" in collection &&
      typeof collection.length === "number"
    ) {
      return collection.length;
    }

    return null;
  }

  /**
   * Get current memory statistics
   */
  getStats(): {
    uptime: number;
    currentMemory: MemorySample | null;
    memoryTrend: "stable" | "growing" | "shrinking";
    growthRateMBPerMin: number;
    collectionCount: number;
    leakWarningCount: number;
    recentWarnings: LeakWarning[];
  } {
    const currentMemory = this.samples[this.samples.length - 1] ?? null;
    let memoryTrend: "stable" | "growing" | "shrinking" = "stable";
    let growthRateMBPerMin = 0;

    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const durationMin = (last.timestamp - first.timestamp) / 60_000;

      if (durationMin > 0) {
        const MB = 1024 * 1024;
        growthRateMBPerMin =
          (last.heapUsed - first.heapUsed) / MB / durationMin;

        if (growthRateMBPerMin > 1) {
          memoryTrend = "growing";
        } else if (growthRateMBPerMin < -1) {
          memoryTrend = "shrinking";
        }
      }
    }

    // Get recent warnings (last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentWarnings = this.leakWarnings.filter(
      (w) => w.timestamp > oneHourAgo,
    );

    return {
      uptime: Date.now() - this.startTime,
      currentMemory,
      memoryTrend,
      growthRateMBPerMin,
      collectionCount: this.collectionMetrics.size,
      leakWarningCount: this.leakWarnings.length,
      recentWarnings,
    };
  }

  /**
   * Get collection metrics
   */
  getCollectionMetrics(): CollectionMetric[] {
    return Array.from(this.collectionMetrics.values()).sort(
      (a, b) => b.size - a.size,
    );
  }

  /**
   * Get memory samples for graphing/analysis
   */
  getSamples(): MemorySample[] {
    return [...this.samples];
  }

  /**
   * Trigger a manual garbage collection (if available)
   */
  forceGC(): boolean {
    try {
      const globalWithBun = globalThis as typeof globalThis & {
        Bun?: { gc?: (force?: boolean) => void };
      };

      if (globalWithBun.Bun?.gc) {
        globalWithBun.Bun.gc(true);
        return true;
      }

      // Try V8's gc() if exposed via --expose-gc
      const globalWithGC = globalThis as typeof globalThis & {
        gc?: () => void;
      };

      if (globalWithGC.gc) {
        globalWithGC.gc();
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Write a V8 heap snapshot to disk for memory profiling
   * Returns the path to the generated snapshot file
   */
  writeHeapSnapshot(directory?: string): string | null {
    try {
      const snapshotDir =
        directory ?? path.join(process.cwd(), "heap-snapshots");

      // Create directory if it doesn't exist
      if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `heap-${timestamp}.heapsnapshot`;
      const filepath = path.join(snapshotDir, filename);

      // Write the heap snapshot
      console.log(`[MemoryMonitor] Writing heap snapshot to ${filepath}...`);
      const startTime = Date.now();

      // v8.writeHeapSnapshot returns the filename
      const actualPath = v8.writeHeapSnapshot(filepath);

      const duration = Date.now() - startTime;
      const stats = fs.statSync(actualPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

      console.log(
        `[MemoryMonitor] Heap snapshot written: ${actualPath} (${sizeMB}MB, took ${duration}ms)`,
      );

      return actualPath;
    } catch (err) {
      console.error("[MemoryMonitor] Failed to write heap snapshot:", err);
      return null;
    }
  }

  /**
   * Get V8 heap statistics for detailed memory analysis
   */
  getHeapStatistics(): v8.HeapInfo {
    return v8.getHeapStatistics();
  }

  /**
   * Get V8 heap space statistics for per-space analysis
   */
  getHeapSpaceStatistics(): v8.HeapSpaceInfo[] {
    return v8.getHeapSpaceStatistics();
  }

  /**
   * Print detailed V8 heap statistics to console
   */
  printHeapStats(): void {
    const heap = this.getHeapStatistics();
    const spaces = this.getHeapSpaceStatistics();
    const MB = 1024 * 1024;

    console.log("\n" + "=".repeat(60));
    console.log("V8 HEAP STATISTICS");
    console.log("=".repeat(60));
    console.log(
      `Total heap size: ${(heap.total_heap_size / MB).toFixed(1)} MB`,
    );
    console.log(
      `Heap size limit: ${(heap.heap_size_limit / MB).toFixed(1)} MB`,
    );
    console.log(`Used heap size: ${(heap.used_heap_size / MB).toFixed(1)} MB`);
    console.log(
      `External memory: ${(heap.external_memory / MB).toFixed(1)} MB`,
    );
    console.log(
      `Malloced memory: ${(heap.malloced_memory / MB).toFixed(1)} MB`,
    );
    console.log(
      `Peak malloced memory: ${(heap.peak_malloced_memory / MB).toFixed(1)} MB`,
    );
    console.log(`Number of native contexts: ${heap.number_of_native_contexts}`);
    console.log(
      `Number of detached contexts: ${heap.number_of_detached_contexts}`,
    );

    console.log("\nHeap Spaces:");
    for (const space of spaces) {
      const used = (space.space_used_size / MB).toFixed(1);
      const size = (space.space_size / MB).toFixed(1);
      const pct = ((space.space_used_size / space.space_size) * 100).toFixed(0);
      console.log(`  ${space.space_name}: ${used}MB / ${size}MB (${pct}%)`);
    }
    console.log("=".repeat(60) + "\n");
  }

  /**
   * Generate a memory report
   */
  generateReport(): string {
    const stats = this.getStats();
    const MB = 1024 * 1024;
    const lines: string[] = [];

    lines.push("=".repeat(60));
    lines.push("MEMORY MONITOR REPORT");
    lines.push("=".repeat(60));
    lines.push(`Uptime: ${(stats.uptime / 1000 / 60).toFixed(1)} minutes`);
    lines.push(`Memory Trend: ${stats.memoryTrend}`);
    lines.push(`Growth Rate: ${stats.growthRateMBPerMin.toFixed(2)} MB/min`);

    if (stats.currentMemory) {
      lines.push("");
      lines.push("Current Memory:");
      lines.push(`  RSS: ${(stats.currentMemory.rss / MB).toFixed(1)} MB`);
      lines.push(
        `  Heap Used: ${(stats.currentMemory.heapUsed / MB).toFixed(1)} MB`,
      );
      lines.push(
        `  Heap Total: ${(stats.currentMemory.heapTotal / MB).toFixed(1)} MB`,
      );
      lines.push(
        `  External: ${(stats.currentMemory.external / MB).toFixed(1)} MB`,
      );
    }

    const collections = this.getCollectionMetrics();
    if (collections.length > 0) {
      lines.push("");
      lines.push("Top Collections:");
      for (const metric of collections.slice(0, 10)) {
        const growth =
          metric.growthRate > 0
            ? ` (+${metric.growthRate})`
            : metric.growthRate < 0
              ? ` (${metric.growthRate})`
              : "";
        lines.push(`  ${metric.name}: ${metric.size}${growth}`);
      }
    }

    if (stats.recentWarnings.length > 0) {
      lines.push("");
      lines.push("Recent Leak Warnings:");
      for (const warning of stats.recentWarnings.slice(-5)) {
        lines.push(
          `  [${new Date(warning.timestamp).toISOString()}] ${warning.message}`,
        );
      }
    }

    lines.push("=".repeat(60));

    return lines.join("\n");
  }
}

// Singleton instance for easy access
let globalMonitor: MemoryMonitor | null = null;

/**
 * Get the global memory monitor instance
 */
export function getMemoryMonitor(): MemoryMonitor {
  if (!globalMonitor) {
    globalMonitor = new MemoryMonitor();
  }
  return globalMonitor;
}

/**
 * Initialize and start the global memory monitor
 */
export function startMemoryMonitor(
  world?: World,
  config?: MemoryMonitorConfig,
): MemoryMonitor {
  if (globalMonitor) {
    globalMonitor.stop();
  }

  globalMonitor = new MemoryMonitor(config);
  globalMonitor.start(world);
  return globalMonitor;
}

/**
 * Stop the global memory monitor
 */
export function stopMemoryMonitor(): void {
  if (globalMonitor) {
    globalMonitor.stop();
    globalMonitor = null;
  }
}
