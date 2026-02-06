/** Records combat events for anti-cheat verification and debug */

import type { Position3D } from "../../../types";

/**
 * Combat audit entry structure
 */
export interface CombatAuditEntry {
  readonly timestamp: number;
  readonly tick: number;
  readonly eventType: CombatAuditEventType;
  readonly attackerId: string;
  readonly attackerType: "player" | "mob";
  readonly targetId: string;
  readonly targetType: "player" | "mob";
  readonly damage?: number;
  readonly attackerPosition?: Position3D;
  readonly targetPosition?: Position3D;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Combat audit event types
 */
export enum CombatAuditEventType {
  ATTACK = "attack",
  COMBAT_START = "combat_start",
  COMBAT_END = "combat_end",
  DEATH = "death",
  DAMAGE_DEALT = "damage_dealt",
  VIOLATION = "violation",
}

/**
 * Configuration for the audit log
 */
export interface CombatAuditConfig {
  maxEntries: number;
  maxEntriesPerPlayer: number;
  retentionMs: number;
}

const DEFAULT_AUDIT_CONFIG: CombatAuditConfig = {
  maxEntries: 10000,
  maxEntriesPerPlayer: 500,
  retentionMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * Combat audit log for tracking and analyzing combat events
 */
export class CombatAuditLog {
  // Ring buffer for O(1) insertions (replaces O(n) shift-based pruning)
  private readonly ringBuffer: (CombatAuditEntry | null)[];
  private ringHead = 0; // index of oldest entry
  private ringCount = 0; // number of active entries
  private readonly capacity: number;
  private readonly playerLogs = new Map<string, CombatAuditEntry[]>();
  private readonly config: CombatAuditConfig;

  constructor(config?: Partial<CombatAuditConfig>) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
    this.capacity = this.config.maxEntries;
    this.ringBuffer = new Array<CombatAuditEntry | null>(this.capacity).fill(
      null,
    );
  }

  /**
   * Log an attack event
   */
  logAttack(data: {
    tick: number;
    attackerId: string;
    attackerType: "player" | "mob";
    targetId: string;
    targetType: "player" | "mob";
    damage: number;
    attackerPosition?: Position3D;
    targetPosition?: Position3D;
    metadata?: Record<string, unknown>;
  }): void {
    const entry: CombatAuditEntry = {
      timestamp: Date.now(),
      tick: data.tick,
      eventType: CombatAuditEventType.ATTACK,
      attackerId: data.attackerId,
      attackerType: data.attackerType,
      targetId: data.targetId,
      targetType: data.targetType,
      damage: data.damage,
      attackerPosition: data.attackerPosition,
      targetPosition: data.targetPosition,
      metadata: data.metadata,
    };

    this.addEntry(entry);
  }

  /**
   * Log combat start event
   */
  logCombatStart(data: {
    tick: number;
    attackerId: string;
    attackerType: "player" | "mob";
    targetId: string;
    targetType: "player" | "mob";
    metadata?: Record<string, unknown>;
  }): void {
    const entry: CombatAuditEntry = {
      timestamp: Date.now(),
      tick: data.tick,
      eventType: CombatAuditEventType.COMBAT_START,
      attackerId: data.attackerId,
      attackerType: data.attackerType,
      targetId: data.targetId,
      targetType: data.targetType,
      metadata: data.metadata,
    };

    this.addEntry(entry);
  }

  /**
   * Log combat end event
   */
  logCombatEnd(data: {
    tick: number;
    attackerId: string;
    attackerType: "player" | "mob";
    targetId: string;
    targetType: "player" | "mob";
    reason?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const entry: CombatAuditEntry = {
      timestamp: Date.now(),
      tick: data.tick,
      eventType: CombatAuditEventType.COMBAT_END,
      attackerId: data.attackerId,
      attackerType: data.attackerType,
      targetId: data.targetId,
      targetType: data.targetType,
      metadata: { ...data.metadata, reason: data.reason },
    };

    this.addEntry(entry);
  }

  /**
   * Log death event
   */
  logDeath(data: {
    tick: number;
    attackerId: string;
    attackerType: "player" | "mob";
    targetId: string;
    targetType: "player" | "mob";
    finalDamage: number;
    metadata?: Record<string, unknown>;
  }): void {
    const entry: CombatAuditEntry = {
      timestamp: Date.now(),
      tick: data.tick,
      eventType: CombatAuditEventType.DEATH,
      attackerId: data.attackerId,
      attackerType: data.attackerType,
      targetId: data.targetId,
      targetType: data.targetType,
      damage: data.finalDamage,
      metadata: data.metadata,
    };

    this.addEntry(entry);
  }

  /**
   * Log a violation event (from anti-cheat)
   */
  logViolation(data: {
    tick: number;
    playerId: string;
    violationType: string;
    severity: string;
    details?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const entry: CombatAuditEntry = {
      timestamp: Date.now(),
      tick: data.tick,
      eventType: CombatAuditEventType.VIOLATION,
      attackerId: data.playerId,
      attackerType: "player",
      targetId: "",
      targetType: "mob",
      metadata: {
        ...data.metadata,
        violationType: data.violationType,
        severity: data.severity,
        details: data.details,
      },
    };

    this.addEntry(entry);
  }

  /**
   * Add entry to both global and per-player logs
   */
  private addEntry(entry: CombatAuditEntry): void {
    // Insert into ring buffer at next available slot
    const insertIdx = (this.ringHead + this.ringCount) % this.capacity;
    this.ringBuffer[insertIdx] = entry;
    if (this.ringCount === this.capacity) {
      // Buffer full — overwrite oldest entry, advance head
      this.ringHead = (this.ringHead + 1) % this.capacity;
    } else {
      this.ringCount++;
    }

    // Time-based pruning from head
    this.pruneOldEntries();

    // Add to per-player logs for quick lookup
    if (entry.attackerType === "player") {
      this.addToPlayerLog(entry.attackerId, entry);
    }
    if (entry.targetType === "player" && entry.targetId) {
      this.addToPlayerLog(entry.targetId, entry);
    }
  }

  /**
   * Add entry to a specific player's log
   */
  private addToPlayerLog(playerId: string, entry: CombatAuditEntry): void {
    if (!this.playerLogs.has(playerId)) {
      this.playerLogs.set(playerId, []);
    }

    const playerLog = this.playerLogs.get(playerId)!;
    playerLog.push(entry);

    // Prune per-player logs
    if (playerLog.length > this.config.maxEntriesPerPlayer) {
      playerLog.splice(0, playerLog.length - this.config.maxEntriesPerPlayer);
    }
  }

  /**
   * Remove old entries based on retention policy
   */
  private pruneOldEntries(): void {
    const cutoffTime = Date.now() - this.config.retentionMs;

    // Time-based pruning — advance head past expired entries (O(1) amortized)
    while (this.ringCount > 0) {
      const oldest = this.ringBuffer[this.ringHead];
      if (oldest && oldest.timestamp < cutoffTime) {
        this.ringBuffer[this.ringHead] = null;
        this.ringHead = (this.ringHead + 1) % this.capacity;
        this.ringCount--;
      } else {
        break;
      }
    }
  }

  /** Iterate active entries from oldest to newest */
  private *entries(): Generator<CombatAuditEntry> {
    for (let i = 0; i < this.ringCount; i++) {
      const entry = this.ringBuffer[(this.ringHead + i) % this.capacity];
      if (entry) yield entry;
    }
  }

  /**
   * Get all attacks by a specific player since a timestamp
   */
  getAttacksByPlayer(
    playerId: string,
    since: number = 0,
  ): readonly CombatAuditEntry[] {
    const playerLog = this.playerLogs.get(playerId) || [];
    return playerLog.filter((e) => e.timestamp >= since);
  }

  /**
   * Get all attacks in an area (for investigating multi-player incidents)
   */
  getAttacksInArea(
    position: Position3D,
    radius: number,
    since: number = 0,
  ): readonly CombatAuditEntry[] {
    const radiusSq = radius * radius;
    const result: CombatAuditEntry[] = [];

    for (const entry of this.entries()) {
      if (entry.timestamp < since) continue;

      // Check attacker position
      if (entry.attackerPosition) {
        const dx = entry.attackerPosition.x - position.x;
        const dz = entry.attackerPosition.z - position.z;
        if (dx * dx + dz * dz <= radiusSq) {
          result.push(entry);
          continue;
        }
      }

      // Check target position
      if (entry.targetPosition) {
        const dx = entry.targetPosition.x - position.x;
        const dz = entry.targetPosition.z - position.z;
        if (dx * dx + dz * dz <= radiusSq) {
          result.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Get all violations for a player
   */
  getViolationsByPlayer(
    playerId: string,
    since: number = 0,
  ): readonly CombatAuditEntry[] {
    const playerLog = this.playerLogs.get(playerId) || [];
    return playerLog.filter(
      (e) =>
        e.eventType === CombatAuditEventType.VIOLATION && e.timestamp >= since,
    );
  }

  /**
   * Export combat data for a player (JSON format for admin review)
   */
  exportForReview(playerId: string): string {
    const entries = this.getAttacksByPlayer(playerId);
    const violations = this.getViolationsByPlayer(playerId);

    return JSON.stringify(
      {
        playerId,
        exportTime: new Date().toISOString(),
        totalEntries: entries.length,
        totalViolations: violations.length,
        entries: entries.slice(-100), // Last 100 entries
        violations: violations.slice(-50), // Last 50 violations
      },
      null,
      2,
    );
  }

  /**
   * Get summary statistics for the audit log
   */
  getStats(): {
    totalEntries: number;
    trackedPlayers: number;
    entriesByType: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entriesByType: Record<string, number> = {};
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;

    for (const entry of this.entries()) {
      entriesByType[entry.eventType] =
        (entriesByType[entry.eventType] || 0) + 1;
      if (oldestEntry === null) oldestEntry = entry.timestamp;
      newestEntry = entry.timestamp;
    }

    return {
      totalEntries: this.ringCount,
      trackedPlayers: this.playerLogs.size,
      entriesByType,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Clean up logs for a disconnecting player
   */
  cleanupPlayer(playerId: string): void {
    this.playerLogs.delete(playerId);
  }

  /**
   * Clear all logs (for testing or admin reset)
   */
  clear(): void {
    this.ringBuffer.fill(null);
    this.ringHead = 0;
    this.ringCount = 0;
    this.playerLogs.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<CombatAuditConfig> {
    return this.config;
  }
}
