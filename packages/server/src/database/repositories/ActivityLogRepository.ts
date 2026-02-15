/**
 * ActivityLogRepository - Player activity and trade tracking for admin panel
 */

import {
  eq,
  and,
  gte,
  lte,
  inArray,
  or,
  desc,
  sql,
  type SQL,
} from "drizzle-orm";
import { BaseRepository } from "./BaseRepository";
import * as schema from "../schema";
import type {
  ActivityLogRow,
  ActivityLogEntry,
  ActivityLogQueryOptions,
  TradeRow,
  TradeEntry,
  TradeQueryOptions,
  TradeItem,
} from "../../shared/types";

const MS_PER_DAY = 86400000;

export class ActivityLogRepository extends BaseRepository {
  /** Build activity log query conditions from options */
  private buildActivityConditions(
    options: ActivityLogQueryOptions,
  ): SQL<unknown>[] {
    const conditions: SQL<unknown>[] = [];
    if (options.playerId) {
      conditions.push(eq(schema.activityLog.playerId, options.playerId));
    }
    if (options.eventType) {
      conditions.push(eq(schema.activityLog.eventType, options.eventType));
    }
    if (options.eventTypes?.length) {
      conditions.push(
        inArray(schema.activityLog.eventType, options.eventTypes),
      );
    }
    if (options.fromTimestamp) {
      conditions.push(gte(schema.activityLog.timestamp, options.fromTimestamp));
    }
    if (options.toTimestamp) {
      conditions.push(lte(schema.activityLog.timestamp, options.toTimestamp));
    }
    return conditions;
  }

  /** Build trade query conditions from options */
  private buildTradeConditions(options: TradeQueryOptions): SQL<unknown>[] {
    const conditions: SQL<unknown>[] = [];
    if (options.playerId) {
      const playerCondition = or(
        eq(schema.trades.initiatorId, options.playerId),
        eq(schema.trades.receiverId, options.playerId),
      );
      if (playerCondition) conditions.push(playerCondition);
    }
    if (options.status) {
      conditions.push(eq(schema.trades.status, options.status));
    }
    if (options.fromTimestamp) {
      conditions.push(gte(schema.trades.timestamp, options.fromTimestamp));
    }
    if (options.toTimestamp) {
      conditions.push(lte(schema.trades.timestamp, options.toTimestamp));
    }
    return conditions;
  }

  /** Map entry to insert values */
  private toActivityValues(entry: ActivityLogEntry) {
    return {
      playerId: entry.playerId,
      eventType: entry.eventType,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ?? {},
      position: entry.position ?? null,
      timestamp: entry.timestamp,
    };
  }

  async insertActivityAsync(entry: ActivityLogEntry): Promise<number> {
    this.ensureDatabase();
    return this.withRetry(async () => {
      const result = await this.db
        .insert(schema.activityLog)
        .values(this.toActivityValues(entry))
        .returning({ id: schema.activityLog.id });
      return result[0].id;
    }, "insertActivity");
  }

  async insertActivitiesBatchAsync(
    entries: ActivityLogEntry[],
  ): Promise<number> {
    if (entries.length === 0 || this.isDestroying) return 0;
    this.ensureDatabase();
    return this.withRetry(async () => {
      await this.db
        .insert(schema.activityLog)
        .values(entries.map((e) => this.toActivityValues(e)));
      return entries.length;
    }, `insertActivitiesBatch(${entries.length})`);
  }

  async queryActivitiesAsync(
    options: ActivityLogQueryOptions,
  ): Promise<ActivityLogRow[]> {
    this.ensureDatabase();
    const conditions = this.buildActivityConditions(options);

    let query = this.db
      .select()
      .from(schema.activityLog)
      .orderBy(desc(schema.activityLog.timestamp));

    if (conditions.length)
      query = query.where(and(...conditions)) as typeof query;
    if (options.limit) query = query.limit(options.limit) as typeof query;
    if (options.offset) query = query.offset(options.offset) as typeof query;

    const results = await query;
    return results.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      eventType: row.eventType,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details as Record<string, unknown>,
      position: row.position as { x: number; y: number; z: number } | null,
      timestamp: row.timestamp,
    }));
  }

  async countActivitiesAsync(
    options: ActivityLogQueryOptions,
  ): Promise<number> {
    this.ensureDatabase();
    const conditions = this.buildActivityConditions(options);

    let query = this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.activityLog);

    if (conditions.length)
      query = query.where(and(...conditions)) as typeof query;
    const result = await query;
    return result[0]?.count ?? 0;
  }

  async getEventTypesAsync(): Promise<string[]> {
    this.ensureDatabase();
    const results = await this.db
      .selectDistinct({ eventType: schema.activityLog.eventType })
      .from(schema.activityLog)
      .orderBy(schema.activityLog.eventType);
    return results.map((row) => row.eventType);
  }

  async insertTradeAsync(entry: TradeEntry): Promise<number> {
    this.ensureDatabase();
    const result = await this.db
      .insert(schema.trades)
      .values({
        initiatorId: entry.initiatorId,
        receiverId: entry.receiverId,
        status: entry.status,
        initiatorItems: entry.initiatorItems,
        receiverItems: entry.receiverItems,
        initiatorCoins: entry.initiatorCoins,
        receiverCoins: entry.receiverCoins,
        timestamp: entry.timestamp,
      })
      .returning({ id: schema.trades.id });
    return result[0].id;
  }

  async queryTradesAsync(options: TradeQueryOptions): Promise<TradeRow[]> {
    this.ensureDatabase();
    const conditions = this.buildTradeConditions(options);

    let query = this.db
      .select()
      .from(schema.trades)
      .orderBy(desc(schema.trades.timestamp));

    if (conditions.length)
      query = query.where(and(...conditions)) as typeof query;
    if (options.limit) query = query.limit(options.limit) as typeof query;
    if (options.offset) query = query.offset(options.offset) as typeof query;

    const results = await query;
    return results.map((row) => ({
      id: row.id,
      initiatorId: row.initiatorId,
      receiverId: row.receiverId,
      status: row.status as "completed" | "cancelled" | "declined",
      initiatorItems: row.initiatorItems as TradeItem[],
      receiverItems: row.receiverItems as TradeItem[],
      initiatorCoins: row.initiatorCoins,
      receiverCoins: row.receiverCoins,
      timestamp: row.timestamp,
    }));
  }

  async countTradesAsync(options: TradeQueryOptions): Promise<number> {
    this.ensureDatabase();
    const conditions = this.buildTradeConditions(options);

    let query = this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.trades);

    if (conditions.length)
      query = query.where(and(...conditions)) as typeof query;
    const result = await query;
    return result[0]?.count ?? 0;
  }

  async cleanupOldActivitiesAsync(daysOld: number = 90): Promise<number> {
    this.ensureDatabase();
    const cutoffTime = Date.now() - daysOld * MS_PER_DAY;
    const result = await this.db
      .delete(schema.activityLog)
      .where(lte(schema.activityLog.timestamp, cutoffTime));
    return result.rowCount ?? 0;
  }

  async cleanupOldTradesAsync(daysOld: number = 90): Promise<number> {
    this.ensureDatabase();
    const cutoffTime = Date.now() - daysOld * MS_PER_DAY;
    const result = await this.db
      .delete(schema.trades)
      .where(lte(schema.trades.timestamp, cutoffTime));
    return result.rowCount ?? 0;
  }

  async getPlayerActivitySummaryAsync(
    playerId: string,
  ): Promise<Record<string, number>> {
    this.ensureDatabase();
    const results = await this.db
      .select({
        eventType: schema.activityLog.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.activityLog)
      .where(eq(schema.activityLog.playerId, playerId))
      .groupBy(schema.activityLog.eventType);

    return Object.fromEntries(results.map((r) => [r.eventType, r.count]));
  }
}
