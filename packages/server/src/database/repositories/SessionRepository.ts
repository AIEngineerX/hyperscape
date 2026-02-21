/**
 * SessionRepository - Player session tracking operations
 *
 * Tracks when players log in/out and their total playtime.
 * Used for analytics, idle timeout detection, and player activity monitoring.
 *
 * Responsibilities:
 * - Create new player sessions on login
 * - Update session activity timestamps
 * - End sessions on logout/disconnect
 * - Query active sessions
 *
 * Used by: ServerNetwork, analytics, idle detection systems
 */

import { eq, sql } from "drizzle-orm";
import { BaseRepository } from "./BaseRepository";
import * as schema from "../schema";
import type { PlayerSessionRow } from "../../shared/types";

/**
 * SessionRepository class
 *
 * Provides all session tracking operations.
 */
export class SessionRepository extends BaseRepository {
  /**
   * Create a new player session
   *
   * Records when a player logs in. Session remains active (sessionEnd=null) until
   * they disconnect. Used for tracking playtime and detecting idle players.
   *
   * @param sessionData - Session information (playerId, start time, etc.)
   * @param sessionId - Optional session ID (generated if not provided)
   * @returns The session ID for tracking this session
   */
  async createPlayerSessionAsync(
    sessionData: Omit<PlayerSessionRow, "id" | "sessionId">,
    sessionId?: string,
  ): Promise<string> {
    this.ensureDatabase();

    const id =
      sessionId ||
      `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await this.db.insert(schema.playerSessions).values({
      id,
      playerId: sessionData.playerId,
      sessionStart: sessionData.sessionStart,
      sessionEnd: sessionData.sessionEnd ?? null,
      playtimeMinutes: sessionData.playtimeMinutes ?? 0,
      reason: sessionData.reason ?? null,
      lastActivity: sessionData.lastActivity ?? Date.now(),
    });

    return id;
  }

  /**
   * Update an existing player session
   *
   * Updates session data such as last activity time, playtime, or end time.
   * Used to keep session records current as the player plays.
   *
   * @param sessionId - The session ID to update
   * @param updates - Partial session data to update
   */
  async updatePlayerSessionAsync(
    sessionId: string,
    updates: Partial<PlayerSessionRow>,
  ): Promise<void> {
    if (this.isDestroying) {
      // Gracefully skip during shutdown
      return;
    }

    this.ensureDatabase();

    type SessionUpdate = Partial<typeof schema.playerSessions.$inferInsert>;
    const updateData: SessionUpdate = {};
    if (updates.sessionEnd !== undefined)
      updateData.sessionEnd = updates.sessionEnd;
    if (updates.playtimeMinutes !== undefined)
      updateData.playtimeMinutes = updates.playtimeMinutes;
    if (updates.reason !== undefined) updateData.reason = updates.reason;
    if (updates.lastActivity !== undefined)
      updateData.lastActivity = updates.lastActivity;

    await this.db
      .update(schema.playerSessions)
      .set(updateData)
      .where(eq(schema.playerSessions.id, sessionId));
  }

  /**
   * Batch update lastActivity for multiple sessions in a single query
   *
   * Uses a raw pool query with proper PostgreSQL array parameter syntax
   * ($1::text[]) instead of Drizzle's sql template which expands arrays
   * into individual ROW expression params — hitting PG's 1664-entry limit.
   *
   * @param sessionIds - Array of session IDs to update
   * @param timestamp - The lastActivity timestamp to set
   */
  async batchUpdateLastActivityAsync(
    sessionIds: string[],
    timestamp: number,
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    if (this.isDestroying) return;

    // Use raw pool query — Drizzle's sql`` expands arrays into ROW tuples
    // which crashes PG at >1664 entries. Raw query passes as a native PG array.
    await this.pool.query(
      'UPDATE player_sessions SET "lastActivity" = $1 WHERE id = ANY($2::text[])',
      [timestamp, sessionIds],
    );
  }

  /**
   * Get all active player sessions
   *
   * Retrieves sessions that are still active (sessionEnd is null).
   * Used for idle detection and monitoring connected players.
   *
   * @returns Array of active session records
   */
  async getActivePlayerSessionsAsync(): Promise<PlayerSessionRow[]> {
    this.ensureDatabase();

    const results = await this.db
      .select()
      .from(schema.playerSessions)
      .where(sql`${schema.playerSessions.sessionEnd} IS NULL`);

    return results.map((row) => ({
      ...row,
      id: row.id,
      sessionId: row.id,
      sessionEnd: row.sessionEnd ?? null,
      reason: row.reason ?? null,
    })) as PlayerSessionRow[];
  }

  /**
   * End a player session
   *
   * Marks a session as ended with a timestamp and reason.
   * Called when player logs out or disconnects.
   *
   * @param sessionId - The session ID to end
   * @param reason - Optional reason for session end (e.g., "logout", "disconnect", "timeout")
   */
  async endPlayerSessionAsync(
    sessionId: string,
    reason?: string,
  ): Promise<void> {
    this.ensureDatabase();

    await this.db
      .update(schema.playerSessions)
      .set({
        sessionEnd: Date.now(),
        reason: reason || "normal",
      })
      .where(eq(schema.playerSessions.id, sessionId));
  }

  /**
   * Clean up old sessions
   *
   * Deletes sessions older than the specified number of days.
   * Used for maintenance to keep the database clean.
   *
   * @param daysOld - Delete sessions older than this many days
   * @returns Number of sessions deleted
   */
  async cleanupOldSessionsAsync(daysOld: number): Promise<number> {
    this.ensureDatabase();

    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    // Delete sessions where sessionEnd is set and older than cutoff
    const result = await this.db
      .delete(schema.playerSessions)
      .where(
        sql`${schema.playerSessions.sessionEnd} IS NOT NULL AND ${schema.playerSessions.sessionEnd} < ${cutoffTime}`,
      );

    // PostgreSQL returns rowCount for delete operations
    return result.rowCount ?? 0;
  }

  /**
   * Get count of active sessions
   *
   * Returns the number of sessions that are currently active (no end time).
   *
   * @returns Number of active sessions
   */
  async getActiveSessionCountAsync(): Promise<number> {
    this.ensureDatabase();

    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.playerSessions)
      .where(sql`${schema.playerSessions.sessionEnd} IS NULL`);

    return result[0]?.count ?? 0;
  }
}
