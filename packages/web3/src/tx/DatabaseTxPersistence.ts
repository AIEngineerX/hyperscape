/**
 * DatabaseTxPersistence - Concrete FailedTxPersistence implementation using PostgreSQL
 *
 * Persists failed blockchain transactions to the database for recovery on restart.
 * Works with Drizzle ORM and the failed_transactions table.
 *
 * Features:
 * - Persists failed transactions with exponential backoff metadata
 * - Marks permanently failed transactions as dead-letter
 * - Loads pending transactions on startup for recovery
 * - Idempotent operations via dedupeKey
 */

import type { FailedTxPersistence } from "./BatchWriter";
import type { Hex } from "viem";

/**
 * PendingCall interface matching BatchWriter's internal type
 */
interface PendingCall {
  callData: Hex;
  description: string;
  queuedAt: number;
  dedupeKey?: string;
}

/**
 * Database client type - accepts any Drizzle database instance
 */
type DatabaseClient = {
  insert: (table: unknown) => {
    values: (data: unknown) => {
      onConflictDoUpdate: (config: unknown) => Promise<unknown>;
    };
  };
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
  select: () => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown[]>;
    };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<unknown>;
  };
};

/**
 * Configuration for DatabaseTxPersistence
 */
interface DatabaseTxPersistenceConfig {
  /**
   * Function to get the database client.
   * Called lazily to avoid circular dependencies during startup.
   */
  getDb: () => DatabaseClient | null;

  /**
   * The failed_transactions table from schema
   */
  table: unknown;

  /**
   * SQL helper for building queries (from drizzle-orm)
   */
  eq: (column: unknown, value: unknown) => unknown;
}

/**
 * DatabaseTxPersistence implements FailedTxPersistence using PostgreSQL storage.
 *
 * Usage:
 * ```typescript
 * const persistence = new DatabaseTxPersistence({
 *   getDb: () => databaseSystem.getDb(),
 *   table: failedTransactions,
 *   eq: eq,
 * });
 *
 * const batchWriter = new BatchWriter(walletClient, publicClient, {
 *   worldAddress: worldAddress,
 *   persistence: persistence,
 * });
 * ```
 */
export class DatabaseTxPersistence implements FailedTxPersistence {
  private config: DatabaseTxPersistenceConfig;

  constructor(config: DatabaseTxPersistenceConfig) {
    this.config = config;
  }

  /**
   * Persist a failed transaction for later recovery.
   *
   * Uses upsert (INSERT ... ON CONFLICT DO UPDATE) to handle retries
   * without creating duplicate records.
   */
  async persistFailedTx(
    call: PendingCall,
    error: string,
    attemptCount: number,
  ): Promise<void> {
    const db = this.config.getDb();
    if (!db) {
      console.warn(
        "[DatabaseTxPersistence] Database not available, cannot persist failed tx:",
        call.description,
      );
      return;
    }

    const dedupeKey =
      call.dedupeKey ??
      `${call.queuedAt}-${Math.random().toString(36).slice(2)}`;

    try {
      const table = this.config.table as {
        dedupeKey: unknown;
        callData: unknown;
        description: unknown;
        status: unknown;
        attemptCount: unknown;
        lastError: unknown;
        queuedAt: unknown;
        failedAt: unknown;
      };

      await db
        .insert(this.config.table)
        .values({
          dedupeKey,
          callData: call.callData,
          description: call.description,
          status: "pending",
          attemptCount,
          lastError: error,
          queuedAt: call.queuedAt,
          failedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: table.dedupeKey,
          set: {
            attemptCount,
            lastError: error,
            failedAt: Date.now(),
          },
        });

      console.log(
        `[DatabaseTxPersistence] Persisted failed tx: ${call.description} (attempt ${attemptCount})`,
      );
    } catch (err) {
      console.error(
        "[DatabaseTxPersistence] Failed to persist transaction:",
        err,
      );
    }
  }

  /**
   * Mark a transaction as dead-letter (permanently failed).
   *
   * Dead-letter transactions are kept for manual review but won't be
   * automatically retried.
   */
  async markDeadLetter(call: PendingCall, error: string): Promise<void> {
    const db = this.config.getDb();
    if (!db) {
      console.warn(
        "[DatabaseTxPersistence] Database not available, cannot mark dead-letter:",
        call.description,
      );
      return;
    }

    const dedupeKey =
      call.dedupeKey ??
      `${call.queuedAt}-${Math.random().toString(36).slice(2)}`;

    try {
      const table = this.config.table as {
        dedupeKey: unknown;
        callData: unknown;
        description: unknown;
        status: unknown;
        attemptCount: unknown;
        lastError: unknown;
        queuedAt: unknown;
        failedAt: unknown;
      };

      // First try to update existing record
      await db
        .insert(this.config.table)
        .values({
          dedupeKey,
          callData: call.callData,
          description: call.description,
          status: "dead_letter",
          attemptCount: 0,
          lastError: error,
          queuedAt: call.queuedAt,
          failedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: table.dedupeKey,
          set: {
            status: "dead_letter",
            lastError: error,
            failedAt: Date.now(),
          },
        });

      console.warn(
        `[DatabaseTxPersistence] Marked as dead-letter: ${call.description} - ${error}`,
      );
    } catch (err) {
      console.error("[DatabaseTxPersistence] Failed to mark dead-letter:", err);
    }
  }

  /**
   * Load pending transactions from previous session for recovery.
   *
   * Called during BatchWriter.initialize() to recover any transactions
   * that failed to complete before the previous shutdown.
   */
  async loadPendingTxs(): Promise<PendingCall[]> {
    const db = this.config.getDb();
    if (!db) {
      console.warn(
        "[DatabaseTxPersistence] Database not available, cannot load pending txs",
      );
      return [];
    }

    try {
      const table = this.config.table as { status: unknown };

      const rows = (await db
        .select()
        .from(this.config.table)
        .where(this.config.eq(table.status, "pending"))) as Array<{
        dedupeKey: string;
        callData: string;
        description: string;
        queuedAt: number;
      }>;

      const calls: PendingCall[] = rows.map((row) => ({
        callData: row.callData as Hex,
        description: row.description,
        queuedAt: row.queuedAt,
        dedupeKey: row.dedupeKey,
      }));

      if (calls.length > 0) {
        console.log(
          `[DatabaseTxPersistence] Loaded ${calls.length} pending transactions for recovery`,
        );
      }

      return calls;
    } catch (err) {
      console.error(
        "[DatabaseTxPersistence] Failed to load pending transactions:",
        err,
      );
      return [];
    }
  }

  /**
   * Remove a successfully processed transaction from the recovery queue.
   *
   * Call this after a recovered transaction succeeds to clean up the table.
   */
  async removeTransaction(dedupeKey: string): Promise<void> {
    const db = this.config.getDb();
    if (!db) return;

    try {
      const table = this.config.table as { dedupeKey: unknown };
      await db
        .delete(this.config.table)
        .where(this.config.eq(table.dedupeKey, dedupeKey));
    } catch (err) {
      console.error(
        "[DatabaseTxPersistence] Failed to remove transaction:",
        err,
      );
    }
  }

  /**
   * Get count of pending transactions for monitoring.
   */
  async getPendingCount(): Promise<number> {
    const db = this.config.getDb();
    if (!db) return 0;

    try {
      const table = this.config.table as { status: unknown };
      const rows = await db
        .select()
        .from(this.config.table)
        .where(this.config.eq(table.status, "pending"));
      return rows.length;
    } catch {
      return 0;
    }
  }

  /**
   * Get count of dead-letter transactions for alerting.
   */
  async getDeadLetterCount(): Promise<number> {
    const db = this.config.getDb();
    if (!db) return 0;

    try {
      const table = this.config.table as { status: unknown };
      const rows = await db
        .select()
        .from(this.config.table)
        .where(this.config.eq(table.status, "dead_letter"));
      return rows.length;
    } catch {
      return 0;
    }
  }
}
