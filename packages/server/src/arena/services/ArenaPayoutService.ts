import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../../database/schema.js";
import type { ArenaContext } from "../ArenaContext.js";
import type { ArenaSide } from "../types.js";
import { nowMs, randomId, buildRoundSeedHex } from "../arena-utils.js";

export class ArenaPayoutService {
  private readonly ctx: ArenaContext;
  private readonly persistRoundEvent: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;

  constructor(
    ctx: ArenaContext,
    persistRoundEvent: (
      eventType: string,
      payload: Record<string, unknown>,
    ) => Promise<void>,
  ) {
    this.ctx = ctx;
    this.persistRoundEvent = persistRoundEvent;
  }

  public async listPayoutJobs(params?: {
    limit?: number;
    status?: string;
  }): Promise<
    Array<{
      id: string;
      roundId: string;
      bettorWallet: string;
      status: string;
      attempts: number;
      claimSignature: string | null;
      lastError: string | null;
      nextAttemptAt: number | null;
      createdAt: number;
      updatedAt: number;
    }>
  > {
    const db = this.ctx.getDb();
    if (!db) return [];

    const limit = Math.max(1, Math.min(params?.limit ?? 50, 250));
    try {
      if (params?.status) {
        const rows = await db
          .select()
          .from(schema.solanaPayoutJobs)
          .where(eq(schema.solanaPayoutJobs.status, params.status))
          .orderBy(desc(schema.solanaPayoutJobs.createdAt))
          .limit(limit);
        return rows;
      }
      const rows = await db
        .select()
        .from(schema.solanaPayoutJobs)
        .orderBy(desc(schema.solanaPayoutJobs.createdAt))
        .limit(limit);
      return rows;
    } catch (error) {
      this.ctx.logTableMissingError(error);
      return [];
    }
  }

  public async markPayoutJobResult(params: {
    id: string;
    status: "PENDING" | "PROCESSING" | "PAID" | "FAILED";
    claimSignature?: string | null;
    lastError?: string | null;
    nextAttemptAt?: number | null;
  }): Promise<boolean> {
    const db = this.ctx.getDb();
    if (!db) return false;
    try {
      const current = await db.query.solanaPayoutJobs.findFirst({
        where: eq(schema.solanaPayoutJobs.id, params.id),
      });
      if (!current) return false;

      const attempts =
        params.status === "FAILED" ? current.attempts + 1 : current.attempts;
      const updated = await db
        .update(schema.solanaPayoutJobs)
        .set({
          status: params.status,
          attempts,
          claimSignature: params.claimSignature ?? current.claimSignature,
          lastError: params.lastError ?? null,
          nextAttemptAt: params.nextAttemptAt ?? null,
          updatedAt: nowMs(),
        })
        .where(eq(schema.solanaPayoutJobs.id, params.id))
        .returning({ id: schema.solanaPayoutJobs.id });

      return updated.length > 0;
    } catch (error) {
      this.ctx.logDbWriteError("mark payout job result", error);
      return false;
    }
  }

  public async queuePayoutJobs(
    roundId: string,
    winnerSide: ArenaSide,
  ): Promise<void> {
    const db = this.ctx.getDb();
    if (!db) return;
    try {
      const winningBets = await db
        .select({
          bettorWallet: schema.solanaBets.bettorWallet,
        })
        .from(schema.solanaBets)
        .where(
          and(
            eq(schema.solanaBets.roundId, roundId),
            eq(schema.solanaBets.side, winnerSide),
            inArray(schema.solanaBets.status, ["SUBMITTED", "CONFIRMED"]),
          ),
        );

      const winnerWallets = Array.from(
        new Set(winningBets.map((row) => row.bettorWallet)),
      );
      if (winnerWallets.length === 0) return;

      const existingJobs = await db
        .select({
          bettorWallet: schema.solanaPayoutJobs.bettorWallet,
        })
        .from(schema.solanaPayoutJobs)
        .where(
          and(
            eq(schema.solanaPayoutJobs.roundId, roundId),
            inArray(schema.solanaPayoutJobs.bettorWallet, winnerWallets),
          ),
        );
      const existingWallets = new Set(
        existingJobs.map((row) => row.bettorWallet),
      );

      const toInsert = winnerWallets
        .filter((wallet) => !existingWallets.has(wallet))
        .map((wallet) => ({
          id: randomId("payout"),
          roundId,
          bettorWallet: wallet,
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: nowMs(),
        }));

      if (toInsert.length === 0) return;
      await db.insert(schema.solanaPayoutJobs).values(toInsert);
      await this.persistRoundEvent("PAYOUT_JOBS_QUEUED", {
        roundId,
        winnerSide,
        jobsCreated: toInsert.length,
      });
    } catch (error) {
      this.ctx.logDbWriteError("queue payout jobs", error);
    }
  }

  public async processPayoutJobs(): Promise<void> {
    if (!this.ctx.solanaOperator?.isEnabled()) return;
    const db = this.ctx.getDb();
    if (!db) return;

    try {
      const candidates = await db
        .select()
        .from(schema.solanaPayoutJobs)
        .where(inArray(schema.solanaPayoutJobs.status, ["PENDING", "FAILED"]))
        .orderBy(desc(schema.solanaPayoutJobs.createdAt))
        .limit(25);

      const now = nowMs();
      const ready = candidates
        .filter((job) => !job.nextAttemptAt || job.nextAttemptAt <= now)
        .slice(0, 3);

      for (const job of ready) {
        await this.markPayoutJobResult({
          id: job.id,
          status: "PROCESSING",
          nextAttemptAt: null,
        });

        const roundSeedHex = buildRoundSeedHex(job.roundId);
        try {
          const claimSignature = await this.ctx.solanaOperator.claimFor(
            roundSeedHex,
            job.bettorWallet,
          );

          if (!claimSignature) {
            throw new Error("claim_for returned null signature");
          }

          await this.markPayoutJobResult({
            id: job.id,
            status: "PAID",
            claimSignature,
            nextAttemptAt: null,
            lastError: null,
          });

          await db.insert(schema.arenaRoundEvents).values({
            roundId: job.roundId,
            eventType: "PAYOUT_JOB_PAID",
            payload: {
              jobId: job.id,
              bettorWallet: job.bettorWallet,
              claimSignature,
            },
          });
        } catch (error) {
          const nextAttemptAt =
            now +
            Math.min(10 * 60_000, 30_000 * 2 ** Math.min(job.attempts, 4));

          await this.markPayoutJobResult({
            id: job.id,
            status: "FAILED",
            lastError: error instanceof Error ? error.message : String(error),
            nextAttemptAt,
          });

          await db.insert(schema.arenaRoundEvents).values({
            roundId: job.roundId,
            eventType: "PAYOUT_JOB_FAILED",
            payload: {
              jobId: job.id,
              bettorWallet: job.bettorWallet,
              error: error instanceof Error ? error.message : String(error),
              nextAttemptAt,
            },
          });
        }
      }
    } catch (error) {
      this.ctx.logDbWriteError("process payout jobs", error);
    }
  }
}
