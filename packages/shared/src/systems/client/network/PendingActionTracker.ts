/**
 * PendingActionTracker - Generic optimistic action tracking with rollback
 *
 * Tracks client-side optimistic updates that are awaiting server confirmation.
 * If the server rejects an action or it times out, the tracker provides the
 * original state needed to visually roll back.
 *
 * Usage:
 * ```typescript
 * const tracker = new PendingActionTracker<InventorySnapshot>(5000);
 *
 * // On optimistic action:
 * const txId = tracker.add(originalInventoryState);
 * applyOptimisticChange();
 * sendToServer({ transactionId: txId, ... });
 *
 * // On server confirm:
 * tracker.confirm(txId);
 *
 * // On server reject or timeout:
 * const rollback = tracker.reject(txId);
 * if (rollback) restoreState(rollback);
 * ```
 */

import { uuid } from "../../../utils";

/** A pending optimistic action awaiting server confirmation */
interface PendingAction<T> {
  /** Unique transaction ID sent with the network request */
  transactionId: string;
  /** Snapshot of original state for rollback */
  rollbackState: T;
  /** When this action was created (for timeout detection) */
  createdAt: number;
}

export class PendingActionTracker<T> {
  private readonly pending = new Map<string, PendingAction<T>>();
  private readonly timeoutMs: number;

  /**
   * @param timeoutMs - How long to wait for server confirmation before auto-rollback (default 5000ms)
   */
  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Register a new optimistic action.
   * @param rollbackState - Snapshot of the original state to restore on rejection
   * @returns Transaction ID to include in the network request
   */
  add(rollbackState: T): string {
    const transactionId = uuid();
    this.pending.set(transactionId, {
      transactionId,
      rollbackState,
      createdAt: performance.now(),
    });
    return transactionId;
  }

  /**
   * Server confirmed the action — discard rollback state.
   * @returns true if the action was found and confirmed
   */
  confirm(transactionId: string): boolean {
    return this.pending.delete(transactionId);
  }

  /**
   * Server rejected the action — return the rollback state.
   * @returns The original state snapshot, or undefined if not found
   */
  reject(transactionId: string): T | undefined {
    const action = this.pending.get(transactionId);
    if (!action) return undefined;
    this.pending.delete(transactionId);
    return action.rollbackState;
  }

  /**
   * Check for timed-out actions and return their rollback states.
   * Call this periodically (e.g., each tick) to handle lost confirmations.
   */
  pruneStale(): T[] {
    const now = performance.now();
    const rollbacks: T[] = [];

    for (const [id, action] of this.pending) {
      if (now - action.createdAt > this.timeoutMs) {
        rollbacks.push(action.rollbackState);
        this.pending.delete(id);
      }
    }

    return rollbacks;
  }

  /**
   * Whether any optimistic actions are currently pending.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Number of pending actions.
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Clear all pending actions (e.g., on disconnect).
   */
  clear(): void {
    this.pending.clear();
  }
}
