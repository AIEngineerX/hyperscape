/**
 * PidManager - Player ID shuffle for fair PvP
 *
 * Lower PID attacks first when two players attack same tick.
 * Shuffles every 60-150 seconds so no player has permanent advantage.
 */

import type { EntityID } from "../../../types/core/identifiers";
import type { SeededRandom } from "../../../utils/SeededRandom";

const PID_SHUFFLE_MIN_TICKS = 100;
const PID_SHUFFLE_MAX_TICKS = 250;

export interface PidEntry {
  readonly entityId: EntityID;
  pid: number;
  assignedTick: number;
}

interface HasId {
  readonly id: EntityID | string;
}

export interface PidManagerStats {
  totalEntities: number;
  lastShuffleTick: number;
  nextShuffleTick: number;
  totalShuffles: number;
}

/**
 * Lower PID attacks first on same tick. Shuffles every 60-150s for fairness.
 */
export class PidManager {
  private readonly pids: Map<EntityID, PidEntry> = new Map();
  private nextPid = 0;
  private lastShuffleTick = 0;
  private nextShuffleTick = 0;
  private totalShuffles = 0;
  private readonly rng: SeededRandom;
  private shuffleBuffer: PidEntry[] = [];

  constructor(rng: SeededRandom) {
    this.rng = rng;
    this.scheduleNextShuffle(0);
  }

  assignPid(entityId: EntityID, currentTick: number): number {
    const existing = this.pids.get(entityId);
    if (existing) return existing.pid;

    const pid = this.nextPid++;
    this.pids.set(entityId, { entityId, pid, assignedTick: currentTick });
    return pid;
  }

  removePid(entityId: EntityID): boolean {
    return this.pids.delete(entityId);
  }

  getPid(entityId: EntityID): number | undefined {
    return this.pids.get(entityId)?.pid;
  }

  hasPid(entityId: EntityID): boolean {
    return this.pids.has(entityId);
  }

  /** Lower PID = higher priority = hits first */
  comparePriority(entityA: EntityID, entityB: EntityID): number {
    const pidA = this.getPid(entityA) ?? Infinity;
    const pidB = this.getPid(entityB) ?? Infinity;
    return pidA - pidB;
  }

  /** Returns new array sorted by PID (original unchanged) */
  sortByPid<T extends HasId>(entities: T[]): T[] {
    return [...entities].sort((a, b) => {
      const idA = String(a.id) as EntityID;
      const idB = String(b.id) as EntityID;
      return this.comparePriority(idA, idB);
    });
  }

  getHighestPriority(entityIds: EntityID[]): EntityID | undefined {
    if (entityIds.length === 0) return undefined;

    let bestId = entityIds[0];
    let bestPid = this.getPid(bestId) ?? Infinity;

    for (let i = 1; i < entityIds.length; i++) {
      const pid = this.getPid(entityIds[i]) ?? Infinity;
      if (pid < bestPid) {
        bestPid = pid;
        bestId = entityIds[i];
      }
    }

    return bestId;
  }

  /** Returns true if shuffle was performed */
  update(currentTick: number): boolean {
    if (currentTick < this.nextShuffleTick) return false;
    this.shuffle(currentTick);
    return true;
  }

  forceShuffle(currentTick: number): void {
    this.shuffle(currentTick);
  }

  /** Fisher-Yates shuffle, deterministic from RNG state */
  private shuffle(currentTick: number): void {
    this.shuffleBuffer.length = 0;
    for (const entry of this.pids.values()) {
      this.shuffleBuffer.push(entry);
    }

    const entries = this.shuffleBuffer;
    const n = entries.length;

    if (n < 2) {
      this.lastShuffleTick = currentTick;
      this.scheduleNextShuffle(currentTick);
      this.totalShuffles++;
      return;
    }

    // Shuffle PIDs, not array positions
    for (let i = n - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      const tempPid = entries[i].pid;
      entries[i].pid = entries[j].pid;
      entries[j].pid = tempPid;
    }

    for (const entry of entries) {
      entry.assignedTick = currentTick;
    }

    this.lastShuffleTick = currentTick;
    this.scheduleNextShuffle(currentTick);
    this.totalShuffles++;
  }

  private scheduleNextShuffle(currentTick: number): void {
    const range = PID_SHUFFLE_MAX_TICKS - PID_SHUFFLE_MIN_TICKS;
    const delay = PID_SHUFFLE_MIN_TICKS + this.rng.nextInt(range + 1);
    this.nextShuffleTick = currentTick + delay;
  }

  getStats(): PidManagerStats {
    return {
      totalEntities: this.pids.size,
      lastShuffleTick: this.lastShuffleTick,
      nextShuffleTick: this.nextShuffleTick,
      totalShuffles: this.totalShuffles,
    };
  }

  getAllEntries(): readonly PidEntry[] {
    return Array.from(this.pids.values());
  }

  getTicksUntilShuffle(currentTick: number): number {
    return Math.max(0, this.nextShuffleTick - currentTick);
  }

  clear(): void {
    this.pids.clear();
    this.nextPid = 0;
    this.totalShuffles = 0;
    this.shuffleBuffer.length = 0;
  }

  get size(): number {
    return this.pids.size;
  }
}
