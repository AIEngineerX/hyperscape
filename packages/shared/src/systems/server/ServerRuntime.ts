import os from "os";
import { System } from "../shared";
import type { World } from "../../types";

// 30Hz tick rate for smooth, consistent gameplay
const TICK_RATE = 1 / 30;
const TICK_INTERVAL_MS = TICK_RATE * 1000;
const MAX_TICKS_PER_FRAME = Math.max(
  1,
  Number.parseInt(process.env.SERVER_RUNTIME_MAX_TICKS_PER_FRAME || "", 10) ||
    4,
);
const MIN_SCHEDULE_DELAY_MS = Math.max(
  1,
  Number.parseInt(process.env.SERVER_RUNTIME_MIN_DELAY_MS || "", 10) || 5,
);

/**
 * Maximum ticks to run per frame to prevent "tick storms" after long pauses.
 * OSRS-style: let ticks stretch under load, but cap catch-up to prevent
 * running dozens of ticks when tab regains focus after being backgrounded.
 */
// Maximum ticks cap removed at user request so we don't drop ticks

/**
 * Threshold for warning about falling behind (in ticks).
 * If we're more than this many ticks behind, log a warning.
 */
const LAG_WARNING_THRESHOLD = 2;

/**
 * Cooldown between repeated lag warnings.
 */
const LAG_LOG_COOLDOWN_MS = 5000;

/**
 * Server Runtime System
 *
 * Manages the server-side game loop with precise timing and performance monitoring.
 *
 * OSRS-Style Tick Handling:
 * - Ticks "stretch" under load (like OSRS worlds with many players)
 * - When behind, run up to MAX_TICKS_PER_FRAME ticks to catch up
 * - If severely behind (e.g., after tab unfocus), skip ahead rather than
 *   running many ticks at once (OSRS "missed tick" behavior)
 * - Performance monitoring with warnings when falling behind
 */
export class ServerRuntime extends System {
  private running = false;
  private lastTickTime = 0;
  private tickAccumulator = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  // Performance monitoring
  private lastStatsTime = 0;
  private statsInterval = 1000; // Cache stats for 1 second
  private cachedStats: {
    maxMemory: number;
    currentMemory: number;
    maxCPU: number;
    currentCPU: number;
  } | null = null;

  // Lag tracking for performance monitoring
  private lagWarningCooldown = 0;

  // TPS profiling
  private ticksProcessedThisSecond = 0;
  private lastTpsLogTime = 0;

  constructor(world: World) {
    super(world);
  }

  start() {
    this.running = true;
    this.lastTickTime = performance.now();
    this.lastTpsLogTime = this.lastTickTime;
    this.scheduleTick();
  }

  private scheduleTick() {
    if (!this.running) return;

    // Schedule close to when the next simulation step is due instead of busy-looping.
    const delay =
      this.tickAccumulator >= TICK_INTERVAL_MS
        ? MIN_SCHEDULE_DELAY_MS
        : Math.max(
            MIN_SCHEDULE_DELAY_MS,
            TICK_INTERVAL_MS - this.tickAccumulator,
          );

    this.tickTimer = setTimeout(() => {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastTickTime;

      // Accumulate time
      this.tickAccumulator += deltaTime;

      // Run every accumulated tick to ensure server processes everything
      let ticksThisFrame = 0;
      let simulatedTickTime = currentTime - this.tickAccumulator;

      while (
        this.tickAccumulator >= TICK_INTERVAL_MS &&
        ticksThisFrame < MAX_TICKS_PER_FRAME
      ) {
        // Advance simulation time in fixed increments. Using current wall-clock
        // time for every tick would produce zero delta for catch-up ticks.
        simulatedTickTime += TICK_INTERVAL_MS;

        // Perform the tick
        try {
          this.world.tick(simulatedTickTime);
        } catch (error) {
          console.error("[ServerRuntime] Tick error:", error);
          // Drop accumulated debt to avoid an error storm.
          this.tickAccumulator = 0;
          break;
        }

        // Subtract the tick interval (keep remainder for precision)
        this.tickAccumulator -= TICK_INTERVAL_MS;
        ticksThisFrame++;
        this.ticksProcessedThisSecond++;
      }

      // Log warning if consistently falling behind (OSRS-style tick stretch)
      // Only warn every 5 seconds to avoid log spam
      const ticksStillBehind = Math.floor(
        this.tickAccumulator / TICK_INTERVAL_MS,
      );
      if (
        ticksStillBehind >= LAG_WARNING_THRESHOLD &&
        this.lagWarningCooldown <= 0
      ) {
        console.warn(
          `[ServerRuntime] Server falling behind: ${ticksStillBehind} ticks behind (ran ${ticksThisFrame} this frame)`,
        );
        this.lagWarningCooldown = LAG_LOG_COOLDOWN_MS;
      }
      this.lagWarningCooldown -= deltaTime;

      // Logic to prevent tick storms by dropping ticks has been removed.
      // Every tick will be processed regardless of how far behind we are.

      // Log TPS every 10 seconds (avoids log spam while still diagnosable)
      if (currentTime - this.lastTpsLogTime >= 10000) {
        const elapsedSec = (currentTime - this.lastTpsLogTime) / 1000;
        const avgTps = Math.round(this.ticksProcessedThisSecond / elapsedSec);
        console.log(
          `[ServerRuntime] TPS: ${avgTps} (over ${elapsedSec.toFixed(1)}s)`,
        );
        this.ticksProcessedThisSecond = 0;
        this.lastTpsLogTime = currentTime;
      }

      this.lastTickTime = currentTime;

      // Schedule next check
      this.scheduleTick();
    });
  }

  /**
   * Get server performance stats with caching to avoid expensive CPU sampling
   */
  async getStats() {
    const now = Date.now();

    // Return cached stats if recent
    if (this.cachedStats && now - this.lastStatsTime < this.statsInterval) {
      return this.cachedStats;
    }

    // Calculate new stats
    const memUsage = process.memoryUsage();
    const startCPU = process.cpuUsage();

    // Sample CPU over 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));

    const endCPU = process.cpuUsage(startCPU);
    const cpuPercent = (endCPU.user + endCPU.system) / 1000 / 100;

    this.cachedStats = {
      maxMemory: Math.round(os.totalmem() / 1024 / 1024),
      currentMemory: Math.round(memUsage.rss / 1024 / 1024),
      maxCPU: os.cpus().length * 100,
      currentCPU: cpuPercent,
    };

    this.lastStatsTime = now;
    return this.cachedStats;
  }

  destroy() {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.cachedStats = null;
  }
}
