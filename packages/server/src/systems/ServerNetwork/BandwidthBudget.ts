/**
 * BandwidthBudget - Per-connection bandwidth tracking and throttling
 *
 * Tracks bytes-per-second per socket and enforces a configurable cap.
 * When a connection exceeds its budget, lower-priority entity updates are
 * deferred to the next tick. Higher-priority updates (combat, player state)
 * are never dropped.
 *
 * Priority Tiers:
 * - CRITICAL: Combat hits, death, player state changes — never throttled
 * - HIGH: Movement of entities near the player
 * - NORMAL: Entity modifications, cosmetic changes
 * - LOW: Distant entity updates, ambient world state
 *
 * Usage:
 * ```typescript
 * const budget = new BandwidthBudget();
 * // Before sending a packet:
 * if (budget.canSend(socketId, packetBytes, priority)) {
 *   socket.sendPacket(packet);
 *   budget.recordSend(socketId, packetBytes);
 * }
 * // Each tick:
 * budget.tick();
 * ```
 */

/** Priority tiers for bandwidth allocation */
export const enum PacketPriority {
  /** Combat events, death, auth — never throttled */
  CRITICAL = 3,
  /** Player/mob movement nearby */
  HIGH = 2,
  /** General entity updates */
  NORMAL = 1,
  /** Distant entities, cosmetic, ambient */
  LOW = 0,
}

/** Per-connection bandwidth tracking state */
interface ConnectionBudget {
  /** Bytes sent in the current window */
  bytesSent: number;
  /** Timestamp when the current window started */
  windowStart: number;
}

/** Default bandwidth cap per client in bytes/second */
const DEFAULT_MAX_BYTES_PER_SECOND = 64 * 1024; // 64 KB/s

/** Window duration in milliseconds for rolling average */
const WINDOW_MS = 1000;

/**
 * Tracks per-connection bandwidth usage and enforces configurable caps.
 *
 * The budget uses a simple sliding window: bytes sent within the last WINDOW_MS
 * milliseconds are counted against the cap. When a connection is over budget,
 * only CRITICAL-priority packets are allowed through.
 */
export class BandwidthBudget {
  /** Per-socket bandwidth tracking */
  private readonly connections = new Map<string, ConnectionBudget>();

  /** Maximum bytes per second per connection */
  private readonly maxBytesPerSecond: number;

  constructor() {
    const envValue =
      typeof process !== "undefined"
        ? process.env.MAX_BANDWIDTH_PER_CLIENT
        : undefined;
    this.maxBytesPerSecond = envValue
      ? parseInt(envValue, 10)
      : DEFAULT_MAX_BYTES_PER_SECOND;
  }

  /**
   * Check whether a packet of the given size and priority can be sent
   * to the specified connection without exceeding its budget.
   *
   * CRITICAL priority packets always return true.
   */
  canSend(
    socketId: string,
    packetBytes: number,
    priority: PacketPriority,
  ): boolean {
    // Critical packets are never throttled
    if (priority >= PacketPriority.CRITICAL) {
      return true;
    }

    const budget = this.connections.get(socketId);
    if (!budget) {
      return true; // No tracking yet — allow
    }

    const now = performance.now();
    const elapsed = now - budget.windowStart;

    if (elapsed >= WINDOW_MS) {
      // Window expired — reset and allow
      return true;
    }

    // Scale the cap proportionally to how much of the window has elapsed
    const allowedBytes = this.maxBytesPerSecond * (elapsed / WINDOW_MS);
    const headroom = allowedBytes - budget.bytesSent;

    // HIGH priority gets more headroom than NORMAL/LOW
    if (priority >= PacketPriority.HIGH) {
      return headroom + packetBytes * 0.5 > 0; // Allow slight overshoot for HIGH
    }

    return headroom >= packetBytes;
  }

  /**
   * Record that bytes were sent to a connection.
   * Call this after successfully sending a packet.
   */
  recordSend(socketId: string, packetBytes: number): void {
    const now = performance.now();
    let budget = this.connections.get(socketId);

    if (!budget) {
      budget = { bytesSent: 0, windowStart: now };
      this.connections.set(socketId, budget);
    }

    // Reset window if expired
    if (now - budget.windowStart >= WINDOW_MS) {
      budget.bytesSent = 0;
      budget.windowStart = now;
    }

    budget.bytesSent += packetBytes;
  }

  /**
   * Remove tracking for a disconnected socket.
   */
  removeConnection(socketId: string): void {
    this.connections.delete(socketId);
  }

  /**
   * Get current bandwidth usage for a connection (bytes in current window).
   * Useful for monitoring/debugging.
   */
  getUsage(socketId: string): number {
    const budget = this.connections.get(socketId);
    if (!budget) return 0;

    const now = performance.now();
    if (now - budget.windowStart >= WINDOW_MS) {
      return 0; // Window expired
    }
    return budget.bytesSent;
  }

  /**
   * Get the configured max bytes per second.
   */
  getMaxBytesPerSecond(): number {
    return this.maxBytesPerSecond;
  }

  /**
   * Clear all tracking state.
   */
  clear(): void {
    this.connections.clear();
  }
}
