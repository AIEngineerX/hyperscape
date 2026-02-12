import crypto from "node:crypto";
import type { World } from "@hyperscape/shared";
import { EventType } from "@hyperscape/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../database/schema.js";
import type { DatabaseSystem } from "../systems/DatabaseSystem/index.js";
import type { DuelSystem } from "../systems/DuelSystem/index.js";
import {
  DEFAULT_ARENA_RUNTIME_CONFIG,
  type ArenaRuntimeConfig,
  getSolanaArenaConfig,
} from "./config.js";
import {
  parseDecimalToBaseUnits,
  formatBaseUnitsToDecimal,
} from "./amounts.js";
import { SolanaArenaOperator } from "./SolanaArenaOperator.js";
import type {
  ArenaRoundSnapshot,
  ArenaPhase,
  ArenaMarketSnapshot,
  BetQuoteRequest,
  BetQuoteResponse,
  ClaimBuildRequest,
  ClaimBuildResponse,
  ArenaSide,
  ArenaWinReason,
  ArenaWhitelistEntry,
  ArenaWhitelistUpsertInput,
  DepositAddressResponse,
  IngestDepositRequest,
  IngestDepositResponse,
} from "./types.js";

type LiveArenaRound = ArenaRoundSnapshot & {
  phaseDeadlineMs: number | null;
};

interface WhitelistedAgentCandidate {
  characterId: string;
  name: string;
  powerScore: number;
  cooldownUntil: number | null;
}

const MAX_HISTORY = 50;

function nowMs(): number {
  return Date.now();
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function buildRoundSeedHex(roundId: string): string {
  return sha256Hex(`arena:round-seed:${roundId}`);
}

function addDecimalAmounts(
  left: string,
  right: string,
  decimals: number,
): string {
  const leftUnits = parseDecimalToBaseUnits(left, decimals);
  const rightUnits = parseDecimalToBaseUnits(right, decimals);
  return formatBaseUnitsToDecimal(leftUnits + rightUnits, decimals);
}

function pickRandom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index] as T;
}

function computePowerScore(candidate: {
  attackLevel: number | null;
  strengthLevel: number | null;
  defenseLevel: number | null;
  constitutionLevel: number | null;
  rangedLevel: number | null;
  magicLevel: number | null;
  prayerLevel: number | null;
}): number {
  return (
    (candidate.attackLevel ?? 1) +
    (candidate.strengthLevel ?? 1) +
    (candidate.defenseLevel ?? 1) +
    (candidate.constitutionLevel ?? 10) +
    (candidate.rangedLevel ?? 1) +
    (candidate.magicLevel ?? 1) +
    (candidate.prayerLevel ?? 1)
  );
}

function normalizeSide(side: ArenaSide): "A" | "B" {
  return side === "A" ? "A" : "B";
}

const VALID_ARENA_PHASES: ReadonlySet<ArenaPhase> = new Set([
  "PREVIEW_CAMS",
  "BET_OPEN",
  "BET_LOCK",
  "DUEL_ACTIVE",
  "RESULT_SHOW",
  "ORACLE_REPORT",
  "MARKET_RESOLVE",
  "RESTORE",
  "COMPLETE",
]);

const VALID_ARENA_WIN_REASONS: ReadonlySet<ArenaWinReason> = new Set([
  "DEATH",
  "TIME_DAMAGE",
]);

function coerceArenaPhase(value: string): ArenaPhase | null {
  if (VALID_ARENA_PHASES.has(value as ArenaPhase)) {
    return value as ArenaPhase;
  }
  return null;
}

function coerceArenaWinReason(value: string | null): ArenaWinReason | null {
  if (!value) return null;
  if (VALID_ARENA_WIN_REASONS.has(value as ArenaWinReason)) {
    return value as ArenaWinReason;
  }
  return null;
}

export class ArenaService {
  private static instances = new WeakMap<World, ArenaService>();

  public static forWorld(world: World): ArenaService {
    const existing = ArenaService.instances.get(world);
    if (existing) return existing;
    const service = new ArenaService(world);
    ArenaService.instances.set(world, service);
    return service;
  }

  private readonly world: World;
  private readonly config: ArenaRuntimeConfig;
  private readonly solanaConfig = getSolanaArenaConfig();
  private readonly solanaOperator: SolanaArenaOperator | null;

  private started = false;
  private isTicking = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private currentRound: LiveArenaRound | null = null;
  private history: LiveArenaRound[] = [];
  private dbUnavailableLogged = false;
  private tablesUnavailableLogged = false;
  private lastPayoutProcessAt = 0;

  private readonly onDuelCompleted = (payload: unknown): void => {
    const event = payload as {
      duelId?: string;
      winnerId?: string;
      loserId?: string;
    };
    if (!this.currentRound || !event.duelId || !this.currentRound.duelId)
      return;
    if (event.duelId !== this.currentRound.duelId) return;
    if (!event.winnerId) return;

    this.currentRound.winnerId = event.winnerId;
    this.currentRound.winReason = this.currentRound.winReason ?? "DEATH";
    this.currentRound.duelEndsAt = nowMs();
    this.currentRound.phase = "RESULT_SHOW";
    this.currentRound.phaseDeadlineMs =
      nowMs() + this.config.resultShowDurationMs;
    this.touchRound();
    void this.persistRound();
    void this.persistRoundEvent("DUEL_COMPLETED", {
      duelId: event.duelId,
      winnerId: event.winnerId,
      loserId: event.loserId ?? null,
      winReason: this.currentRound.winReason,
    });
  };

  private readonly onEntityDamaged = (payload: unknown): void => {
    if (!this.currentRound || this.currentRound.phase !== "DUEL_ACTIVE") return;
    const data = payload as {
      entityId?: string;
      sourceId?: string;
      damage?: number;
    };
    if (!data.entityId || !data.sourceId || typeof data.damage !== "number") {
      return;
    }

    const round = this.currentRound;
    if (data.sourceId === round.agentAId && data.entityId === round.agentBId) {
      round.damageA += Math.max(0, Math.floor(data.damage));
      round.updatedAt = nowMs();
      return;
    }
    if (data.sourceId === round.agentBId && data.entityId === round.agentAId) {
      round.damageB += Math.max(0, Math.floor(data.damage));
      round.updatedAt = nowMs();
    }
  };

  private constructor(world: World) {
    this.world = world;
    this.config = DEFAULT_ARENA_RUNTIME_CONFIG;
    try {
      this.solanaOperator = new SolanaArenaOperator(this.solanaConfig);
    } catch (error) {
      console.warn(
        "[ArenaService] Solana operator disabled due to invalid config:",
        error,
      );
      this.solanaOperator = null;
    }
  }

  public init(): void {
    if (this.started) return;
    this.started = true;

    this.world.on("duel:completed", this.onDuelCompleted);
    this.world.on(EventType.ENTITY_DAMAGED, this.onEntityDamaged);

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.tickIntervalMs);

    void this.tick();
    console.log("[ArenaService] Initialized streamed duel arena loop");
  }

  public destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.world.off("duel:completed", this.onDuelCompleted);
    this.world.off(EventType.ENTITY_DAMAGED, this.onEntityDamaged);
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  public getCurrentRound(): ArenaRoundSnapshot | null {
    return this.currentRound ? this.cloneRound(this.currentRound) : null;
  }

  public getRound(roundId: string): ArenaRoundSnapshot | null {
    if (this.currentRound?.id === roundId)
      return this.cloneRound(this.currentRound);
    const fromHistory = this.history.find((r) => r.id === roundId);
    return fromHistory ? this.cloneRound(fromHistory) : null;
  }

  public listRecentRounds(limit = 20): ArenaRoundSnapshot[] {
    return this.history
      .slice(0, Math.max(1, Math.min(limit, this.history.length)))
      .map((round) => this.cloneRound(round));
  }

  public async listWhitelist(limit = 200): Promise<ArenaWhitelistEntry[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const rows = await db
        .select()
        .from(schema.arenaAgentWhitelist)
        .orderBy(
          desc(schema.arenaAgentWhitelist.priority),
          desc(schema.arenaAgentWhitelist.updatedAt),
        )
        .limit(Math.max(1, Math.min(limit, 1_000)));
      return rows.map((row) => ({
        characterId: row.characterId,
        enabled: row.enabled,
        minPowerScore: row.minPowerScore,
        maxPowerScore: row.maxPowerScore,
        priority: row.priority,
        cooldownUntil: row.cooldownUntil,
        notes: row.notes,
        updatedAt: row.updatedAt,
      }));
    } catch (error) {
      this.logTableMissingError(error);
      return [];
    }
  }

  public async upsertWhitelist(
    input: ArenaWhitelistUpsertInput,
  ): Promise<ArenaWhitelistEntry> {
    const db = this.getDb();
    const now = nowMs();
    const value = {
      characterId: input.characterId,
      enabled: input.enabled ?? true,
      minPowerScore: input.minPowerScore ?? 0,
      maxPowerScore: input.maxPowerScore ?? 10_000,
      priority: input.priority ?? 0,
      cooldownUntil: input.cooldownUntil ?? null,
      notes: input.notes ?? null,
      updatedAt: now,
    };

    if (!db) {
      return value;
    }

    try {
      await db
        .insert(schema.arenaAgentWhitelist)
        .values(value)
        .onConflictDoUpdate({
          target: schema.arenaAgentWhitelist.characterId,
          set: {
            enabled: value.enabled,
            minPowerScore: value.minPowerScore,
            maxPowerScore: value.maxPowerScore,
            priority: value.priority,
            cooldownUntil: value.cooldownUntil,
            notes: value.notes,
            updatedAt: value.updatedAt,
          },
        });

      const row = await db.query.arenaAgentWhitelist.findFirst({
        where: eq(schema.arenaAgentWhitelist.characterId, input.characterId),
      });
      if (!row) return value;
      return {
        characterId: row.characterId,
        enabled: row.enabled,
        minPowerScore: row.minPowerScore,
        maxPowerScore: row.maxPowerScore,
        priority: row.priority,
        cooldownUntil: row.cooldownUntil,
        notes: row.notes,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      this.logDbWriteError("upsert whitelist entry", error);
      return value;
    }
  }

  public async removeWhitelist(characterId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;
    try {
      const deleted = await db
        .delete(schema.arenaAgentWhitelist)
        .where(eq(schema.arenaAgentWhitelist.characterId, characterId))
        .returning({ characterId: schema.arenaAgentWhitelist.characterId });
      return deleted.length > 0;
    } catch (error) {
      this.logDbWriteError("remove whitelist entry", error);
      return false;
    }
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
    const db = this.getDb();
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
      this.logTableMissingError(error);
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
    const db = this.getDb();
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
      this.logDbWriteError("mark payout job result", error);
      return false;
    }
  }

  public async buildBetQuote(
    request: BetQuoteRequest,
  ): Promise<BetQuoteResponse> {
    const round = this.getRound(request.roundId);
    if (!round) {
      throw new Error("Round not found");
    }
    if (!round.market) {
      throw new Error("Market not initialized for round");
    }

    if (round.phase !== "BET_OPEN" && round.phase !== "BET_LOCK") {
      throw new Error("Betting is currently closed");
    }

    const side = normalizeSide(request.side);
    const sourceAsset = request.sourceAsset;
    const sourceAmount = request.sourceAmount.trim();
    if (!sourceAmount || Number(sourceAmount) <= 0) {
      throw new Error("sourceAmount must be > 0");
    }

    if (sourceAsset === "GOLD") {
      const goldUnits = parseDecimalToBaseUnits(sourceAmount, 6);
      return {
        roundId: round.id,
        side,
        sourceAsset,
        sourceAmount,
        expectedGoldAmount: formatBaseUnitsToDecimal(goldUnits, 6),
        minGoldAmount: formatBaseUnitsToDecimal(goldUnits, 6),
        swapQuote: null,
        market: round.market,
      };
    }

    const inputMint =
      sourceAsset === "SOL"
        ? this.solanaConfig.solMint
        : this.solanaConfig.usdcMint;
    const decimals = sourceAsset === "SOL" ? 9 : 6;
    const amountRaw = parseDecimalToBaseUnits(sourceAmount, decimals);
    if (amountRaw <= 0n) throw new Error("sourceAmount converted to zero");

    const quoteUrl = new URL(this.solanaConfig.jupiterQuoteUrl);
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", this.solanaConfig.goldMint);
    quoteUrl.searchParams.set("amount", amountRaw.toString());
    quoteUrl.searchParams.set("slippageBps", "100");

    const response = await fetch(quoteUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.status}`);
    }

    const quote = (await response.json()) as Record<string, unknown> & {
      outAmount?: string;
      otherAmountThreshold?: string;
    };
    const outAmount = BigInt(quote.outAmount ?? "0");
    const minAmount = BigInt(quote.otherAmountThreshold ?? "0");
    if (outAmount <= 0n) {
      throw new Error("No GOLD output available for selected asset");
    }

    return {
      roundId: round.id,
      side,
      sourceAsset,
      sourceAmount,
      expectedGoldAmount: formatBaseUnitsToDecimal(outAmount, 6),
      minGoldAmount: formatBaseUnitsToDecimal(minAmount, 6),
      swapQuote: quote,
      market: round.market,
    };
  }

  public async recordBet(params: {
    roundId: string;
    bettorWallet: string;
    side: ArenaSide;
    sourceAsset: "GOLD" | "SOL" | "USDC";
    sourceAmount: string;
    goldAmount: string;
    txSignature?: string | null;
    quoteJson?: Record<string, unknown> | null;
  }): Promise<string> {
    const round = this.getRound(params.roundId);
    if (!round || !round.market) {
      throw new Error("Round or market not found");
    }
    if (round.phase !== "BET_OPEN" && round.phase !== "BET_LOCK") {
      throw new Error("Betting is currently closed");
    }

    const goldUnits = parseDecimalToBaseUnits(params.goldAmount, 6);
    if (goldUnits <= 0n) {
      throw new Error("goldAmount must be > 0");
    }

    const db = this.getDb();
    if (!db) return randomId("bet");

    const id = randomId("bet");
    const normalizedSide = normalizeSide(params.side);
    try {
      await db.insert(schema.solanaBets).values({
        id,
        roundId: params.roundId,
        bettorWallet: params.bettorWallet,
        side: normalizedSide,
        sourceAsset: params.sourceAsset,
        sourceAmount: params.sourceAmount,
        goldAmount: params.goldAmount,
        quoteJson: params.quoteJson ?? null,
        txSignature: params.txSignature ?? null,
        status: params.txSignature ? "SUBMITTED" : "PENDING",
      });

      if (
        this.currentRound?.id === params.roundId &&
        this.currentRound.market
      ) {
        if (normalizedSide === "A") {
          this.currentRound.market.poolA = addDecimalAmounts(
            this.currentRound.market.poolA,
            params.goldAmount,
            6,
          );
        } else {
          this.currentRound.market.poolB = addDecimalAmounts(
            this.currentRound.market.poolB,
            params.goldAmount,
            6,
          );
        }
        this.touchRound();
        await this.persistRound();
        await this.persistMarket();
      }

      await this.persistRoundEvent("BET_RECORDED", {
        roundId: params.roundId,
        betId: id,
        bettorWallet: params.bettorWallet,
        side: normalizedSide,
        sourceAsset: params.sourceAsset,
        sourceAmount: params.sourceAmount,
        goldAmount: params.goldAmount,
        txSignature: params.txSignature ?? null,
      });
    } catch (error) {
      this.logDbWriteError("record bet", error);
    }
    return id;
  }

  public buildClaimInfo(request: ClaimBuildRequest): ClaimBuildResponse {
    const round = this.getRound(request.roundId);
    if (!round?.market) {
      throw new Error("Round or market not found");
    }
    const positionPda = this.solanaOperator
      ? this.solanaOperator.derivePositionPda(
          round.roundSeedHex,
          request.bettorWallet,
        )
      : `position_${sha256Hex(
          `${round.market.marketPda}:${request.bettorWallet}`,
        ).slice(0, 40)}`;
    return {
      roundId: request.roundId,
      roundSeedHex: round.roundSeedHex,
      programId: round.market.programId,
      mint: round.market.mint,
      tokenProgram: round.market.tokenProgram,
      marketPda: round.market.marketPda,
      vaultAta: round.market.vaultAta,
      positionPda,
      winnerSide: round.market.winnerSide,
      bettorWallet: request.bettorWallet,
      manualClaimEnabled: true,
      message:
        "Manual claim is always enabled. Use claim instruction with market/bettor PDAs.",
    };
  }

  public buildDepositAddress(params: {
    roundId: string;
    side: ArenaSide;
  }): DepositAddressResponse {
    const round = this.getRound(params.roundId);
    if (!round?.market) {
      throw new Error("Round or market not found");
    }
    const custodyWallet = this.solanaOperator?.getCustodyWallet();
    const custodyAta = this.solanaOperator?.getCustodyAta();
    if (!custodyWallet || !custodyAta) {
      throw new Error("Custody wallet is not configured");
    }
    const side = normalizeSide(params.side);
    return {
      roundId: round.id,
      side,
      custodyWallet,
      custodyAta,
      mint: round.market.mint,
      tokenProgram: round.market.tokenProgram,
      memoTemplate: `ARENA:${round.id}:${side}`,
    };
  }

  public async ingestDepositBySignature(
    request: IngestDepositRequest,
  ): Promise<IngestDepositResponse> {
    const round = this.getRound(request.roundId);
    if (!round?.market) {
      throw new Error("Round or market not found");
    }
    if (round.phase !== "BET_OPEN" && round.phase !== "BET_LOCK") {
      throw new Error("Betting is currently closed");
    }
    if (!this.solanaOperator?.isEnabled()) {
      throw new Error("Solana operator is not configured");
    }

    const db = this.getDb();
    if (db) {
      const existing = await db.query.solanaBets.findFirst({
        where: eq(schema.solanaBets.txSignature, request.txSignature),
      });
      if (existing) {
        const quote = (existing.quoteJson ?? {}) as {
          settleSignature?: string;
          memo?: string | null;
        };
        return {
          roundId: existing.roundId,
          side: existing.side as ArenaSide,
          txSignature: request.txSignature,
          settleSignature: quote.settleSignature ?? request.txSignature,
          bettorWallet: existing.bettorWallet,
          goldAmount: existing.goldAmount,
          betId: existing.id,
        };
      }
    }

    const inspected = await this.solanaOperator.inspectInboundGoldTransfer(
      request.txSignature,
    );
    if (!inspected) {
      throw new Error("Unable to inspect inbound transfer");
    }
    if (!inspected.fromWallet) {
      throw new Error("Inbound transfer source wallet could not be resolved");
    }
    const side = normalizeSide(request.side);
    const expectedMemo = `ARENA:${round.id}:${side}`;
    if (
      inspected.memo &&
      inspected.memo !== expectedMemo &&
      !inspected.memo.includes(expectedMemo)
    ) {
      throw new Error(
        `Inbound transfer memo does not match expected value: ${expectedMemo}`,
      );
    }

    const settleSignature = await this.solanaOperator.placeBetFor({
      roundSeedHex: round.roundSeedHex,
      bettorWallet: inspected.fromWallet,
      side,
      amountGoldBaseUnits: inspected.amountBaseUnits,
    });
    if (!settleSignature) {
      throw new Error("Failed to settle inbound transfer into market");
    }

    const betId = await this.recordBet({
      roundId: round.id,
      bettorWallet: inspected.fromWallet,
      side,
      sourceAsset: "GOLD",
      sourceAmount: inspected.amountGold,
      goldAmount: inspected.amountGold,
      txSignature: request.txSignature,
      quoteJson: {
        sourceTxSignature: request.txSignature,
        settleSignature,
        memo: inspected.memo,
        sourceWallet: inspected.fromWallet,
        custodyWallet: inspected.toWallet,
      },
    });

    await this.persistRoundEvent("DEPOSIT_INGESTED", {
      roundId: round.id,
      side,
      sourceTxSignature: request.txSignature,
      settleSignature,
      bettorWallet: inspected.fromWallet,
      goldAmount: inspected.amountGold,
      memo: inspected.memo,
      betId,
    });

    return {
      roundId: round.id,
      side,
      txSignature: request.txSignature,
      settleSignature,
      bettorWallet: inspected.fromWallet,
      goldAmount: inspected.amountGold,
      betId,
    };
  }

  private async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const now = nowMs();
      if (now - this.lastPayoutProcessAt >= 5_000) {
        this.lastPayoutProcessAt = now;
        await this.processPayoutJobs();
      }

      if (!this.currentRound) {
        await this.maybeCreateRound();
        return;
      }

      const round = this.currentRound;
      switch (round.phase) {
        case "PREVIEW_CAMS":
          if (now >= round.bettingOpensAt) {
            await this.moveToPhase("BET_OPEN");
          }
          break;
        case "BET_OPEN":
          if (now >= round.bettingClosesAt) {
            round.phaseDeadlineMs = now + this.config.bettingLockBufferMs;
            await this.moveToPhase("BET_LOCK");
          }
          break;
        case "BET_LOCK":
          if (round.phaseDeadlineMs !== null && now >= round.phaseDeadlineMs) {
            await this.startRoundDuel();
          }
          break;
        case "DUEL_ACTIVE":
          if (
            round.duelStartsAt !== null &&
            now >= round.duelStartsAt + this.config.duelMaxDurationMs
          ) {
            await this.resolveTimeoutDuel();
          }
          break;
        case "RESULT_SHOW":
          if (round.phaseDeadlineMs !== null && now >= round.phaseDeadlineMs) {
            await this.moveToPhase("ORACLE_REPORT");
            await this.publishOracleOutcome();
          }
          break;
        case "ORACLE_REPORT":
          await this.moveToPhase("MARKET_RESOLVE");
          await this.resolveMarketSnapshot();
          break;
        case "MARKET_RESOLVE":
          round.phaseDeadlineMs = now + this.config.restoreDurationMs;
          await this.moveToPhase("RESTORE");
          break;
        case "RESTORE":
          if (round.phaseDeadlineMs !== null && now >= round.phaseDeadlineMs) {
            await this.finishCurrentRound();
          }
          break;
        case "COMPLETE":
          await this.finishCurrentRound();
          break;
      }
    } catch (error) {
      console.error("[ArenaService] Tick error:", error);
    } finally {
      this.isTicking = false;
    }
  }

  private async maybeCreateRound(): Promise<void> {
    const agents = await this.getEligibleAgents();
    if (agents.length < this.config.minWhitelistedAgents) {
      return;
    }

    const { duelA, duelB } = this.pickMatchPair(agents);
    if (!duelA || !duelB) return;

    const previewPool = agents.filter(
      (candidate) =>
        candidate.characterId !== duelA.characterId &&
        candidate.characterId !== duelB.characterId,
    );
    if (previewPool.length < 2) {
      return;
    }

    const previewA = pickRandom(previewPool);
    const previewRemaining = previewPool.filter(
      (candidate) => candidate.characterId !== previewA.characterId,
    );
    const previewB = pickRandom(previewRemaining);

    const created = nowMs();
    const roundId = randomId("round");
    const roundSeedHex = buildRoundSeedHex(roundId);
    const bettingOpensAt = created + this.config.previewDurationMs;
    const bettingClosesAt = bettingOpensAt + this.config.bettingOpenDurationMs;
    const market = this.createInitialMarket(roundId, roundSeedHex);

    this.currentRound = {
      id: roundId,
      roundSeedHex,
      phase: "PREVIEW_CAMS",
      createdAt: created,
      updatedAt: created,
      scheduledAt: created,
      bettingOpensAt,
      bettingClosesAt,
      duelStartsAt: null,
      duelEndsAt: null,
      agentAId: duelA.characterId,
      agentBId: duelB.characterId,
      previewAgentAId: previewA.characterId,
      previewAgentBId: previewB.characterId,
      duelId: null,
      winnerId: null,
      winReason: null,
      damageA: 0,
      damageB: 0,
      metadataUri: null,
      resultHash: null,
      market,
      phaseDeadlineMs: bettingOpensAt,
    };

    if (this.solanaOperator?.isEnabled()) {
      try {
        const initResult = await this.solanaOperator.initRound(
          roundSeedHex,
          bettingClosesAt,
        );
        if (initResult && this.currentRound?.market) {
          this.currentRound.market.closeSlot = initResult.closeSlot;
          this.touchRound();
          await this.persistRound();
          await this.persistMarket();
          await this.persistRoundEvent("SOLANA_MARKET_INITIALIZED", {
            roundId,
            roundSeedHex,
            closeSlot: initResult.closeSlot,
            initOracleSignature: initResult.initOracleSignature,
            initMarketSignature: initResult.initMarketSignature,
            marketPda: initResult.addresses.marketPda.toBase58(),
            oraclePda: initResult.addresses.oraclePda.toBase58(),
            vaultAta: initResult.addresses.vaultAta.toBase58(),
            feeVaultAta: initResult.addresses.feeVaultAta.toBase58(),
          });
        }
      } catch (error) {
        console.warn(
          "[ArenaService] Failed to initialize on-chain round:",
          error,
        );
        await this.persistRoundEvent("SOLANA_MARKET_INIT_FAILED", {
          roundId,
          roundSeedHex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.persistRound();
    await this.persistMarket();
    await this.persistRoundEvent("ROUND_CREATED", {
      roundId,
      phase: "PREVIEW_CAMS",
      agentAId: duelA.characterId,
      agentBId: duelB.characterId,
      previewAgentAId: previewA.characterId,
      previewAgentBId: previewB.characterId,
    });
  }

  private async startRoundDuel(): Promise<void> {
    const round = this.currentRound;
    if (!round) return;

    if (round.market && round.market.status === "BETTING") {
      round.market.status = "LOCKED";
      this.touchRound();
      await this.persistRound();
      await this.persistMarket();
    }

    if (this.solanaOperator?.isEnabled()) {
      try {
        const lockSignature = await this.solanaOperator.lockMarket(
          round.roundSeedHex,
        );
        if (lockSignature) {
          await this.persistRoundEvent("SOLANA_MARKET_LOCKED", {
            roundId: round.id,
            lockSignature,
            marketPda: round.market?.marketPda ?? null,
          });
        }
      } catch (error) {
        await this.persistRoundEvent("SOLANA_MARKET_LOCK_FAILED", {
          roundId: round.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const duelSystem = this.getDuelSystem();
    if (!duelSystem) {
      console.warn(
        "[ArenaService] DuelSystem unavailable; cannot start round duel",
      );
      return;
    }

    const agentA = await this.getCharacterNameAndCombat(round.agentAId);
    const agentB = await this.getCharacterNameAndCombat(round.agentBId);

    const challenge = duelSystem.createChallenge(
      round.agentAId,
      agentA.name,
      `arena:${round.id}`,
      agentA.combatLevel,
      round.agentBId,
      agentB.name,
    );
    if (!challenge.success || !challenge.challengeId) {
      console.warn(
        "[ArenaService] Failed to create duel challenge:",
        challenge,
      );
      return;
    }

    const accepted = duelSystem.respondToChallenge(
      challenge.challengeId,
      round.agentBId,
      true,
    );
    if (!accepted.success || !accepted.duelId) {
      console.warn("[ArenaService] Failed to accept duel challenge:", accepted);
      return;
    }

    const duelId = accepted.duelId;
    const acceptSequence = [
      duelSystem.acceptRules(duelId, round.agentAId),
      duelSystem.acceptRules(duelId, round.agentBId),
      duelSystem.acceptStakes(duelId, round.agentAId),
      duelSystem.acceptStakes(duelId, round.agentBId),
      duelSystem.acceptFinal(duelId, round.agentAId),
      duelSystem.acceptFinal(duelId, round.agentBId),
    ];

    const failed = acceptSequence.find((result) => !result.success);
    if (failed) {
      console.warn("[ArenaService] Failed duel auto-accept sequence:", failed);
      return;
    }

    round.duelId = duelId;
    round.duelStartsAt = nowMs();
    round.phaseDeadlineMs = round.duelStartsAt + this.config.duelMaxDurationMs;
    await this.moveToPhase("DUEL_ACTIVE");
    await this.persistRoundEvent("DUEL_STARTED", {
      roundId: round.id,
      duelId,
      agentAId: round.agentAId,
      agentBId: round.agentBId,
    });
  }

  private async resolveTimeoutDuel(): Promise<void> {
    const round = this.currentRound;
    if (!round || !round.duelId) return;
    if (round.winnerId) return;

    const winnerId = this.pickTimeoutWinner(round);
    const loserId =
      winnerId === round.agentAId ? round.agentBId : round.agentAId;
    round.winnerId = winnerId;
    round.winReason = "TIME_DAMAGE";

    const duelSystem = this.getDuelSystem();
    const session = duelSystem?.getDuelSession(round.duelId);
    if (duelSystem && session) {
      const unsafe = duelSystem as unknown as {
        resolveDuel?: (
          sessionArg: unknown,
          winner: string,
          loser: string,
          reason: string,
        ) => void;
      };
      if (typeof unsafe.resolveDuel === "function") {
        unsafe.resolveDuel(session, winnerId, loserId, "timeout_damage");
      }
    }

    round.duelEndsAt = nowMs();
    round.phaseDeadlineMs = nowMs() + this.config.resultShowDurationMs;
    await this.moveToPhase("RESULT_SHOW");
    await this.persistRoundEvent("DUEL_TIMEOUT_RESOLVED", {
      roundId: round.id,
      duelId: round.duelId,
      winnerId,
      loserId,
      damageA: round.damageA,
      damageB: round.damageB,
    });
  }

  private pickTimeoutWinner(round: LiveArenaRound): string {
    if (round.damageA > round.damageB) return round.agentAId;
    if (round.damageB > round.damageA) return round.agentBId;
    return Math.random() < 0.5 ? round.agentAId : round.agentBId;
  }

  private async publishOracleOutcome(): Promise<void> {
    const round = this.currentRound;
    if (!round || !round.winnerId) return;

    const winnerSide: ArenaSide = round.winnerId === round.agentAId ? "A" : "B";
    const payload = {
      roundId: round.id,
      winnerId: round.winnerId,
      winnerSide,
      winReason: round.winReason as ArenaWinReason,
      damageA: round.damageA,
      damageB: round.damageB,
      duelId: round.duelId,
      duelStartsAt: round.duelStartsAt,
      duelEndsAt: round.duelEndsAt,
    };

    const resultHash = `0x${sha256Hex(JSON.stringify(payload))}`;
    round.resultHash = resultHash;
    round.metadataUri = `arena://prediction/${round.id}`;
    this.touchRound();
    await this.persistRound();
    await this.persistRoundEvent("ORACLE_PUBLISHED", {
      ...payload,
      resultHash,
      metadataUri: round.metadataUri,
    });
  }

  private async resolveMarketSnapshot(): Promise<void> {
    const round = this.currentRound;
    if (!round?.market || !round.winnerId) return;

    const winnerSide: ArenaSide = round.winnerId === round.agentAId ? "A" : "B";
    let reportSignature: string | null = null;
    let resolveSignature: string | null = null;
    if (this.solanaOperator?.isEnabled() && round.resultHash) {
      try {
        const result = await this.solanaOperator.reportAndResolve({
          roundSeedHex: round.roundSeedHex,
          winnerSide,
          resultHashHex: round.resultHash,
          metadataUri: round.metadataUri ?? "",
        });
        reportSignature = result?.reportSignature ?? null;
        resolveSignature = result?.resolveSignature ?? null;
      } catch (error) {
        console.warn(
          "[ArenaService] Failed to report/resolve on-chain:",
          error,
        );
        await this.persistRoundEvent("SOLANA_MARKET_RESOLVE_FAILED", {
          roundId: round.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    round.market.status =
      this.solanaOperator?.isEnabled() && !resolveSignature
        ? "SETTLING"
        : "RESOLVED";
    round.market.winnerSide = winnerSide;
    round.market.resolvedSlot = Math.floor(nowMs() / 1000);
    this.touchRound();
    await this.persistRound();
    await this.persistMarket();
    await this.persistRoundEvent("MARKET_RESOLVED", {
      roundId: round.id,
      winnerSide,
      marketPda: round.market.marketPda,
      oraclePda: round.market.oraclePda,
      resultHash: round.resultHash,
      reportSignature,
      resolveSignature,
    });

    await this.queuePayoutJobs(round.id, winnerSide);
  }

  private async finishCurrentRound(): Promise<void> {
    if (!this.currentRound) return;
    const round = this.currentRound;
    round.phase = "COMPLETE";
    this.touchRound();
    await this.persistRound();

    const cooldownUntil = nowMs() + this.config.participantCooldownMs;
    await this.applyParticipantCooldown(round.agentAId, cooldownUntil);
    await this.applyParticipantCooldown(round.agentBId, cooldownUntil);

    this.history.unshift(this.cloneRound(round) as LiveArenaRound);
    this.history = this.history.slice(0, MAX_HISTORY);
    this.currentRound = null;
  }

  private async moveToPhase(nextPhase: ArenaPhase): Promise<void> {
    if (!this.currentRound) return;
    this.currentRound.phase = nextPhase;
    this.currentRound.phaseDeadlineMs = null;
    this.touchRound();
    await this.persistRound();
    await this.persistMarket();
    await this.persistRoundEvent("PHASE_CHANGED", {
      roundId: this.currentRound.id,
      phase: nextPhase,
    });
  }

  private createInitialMarket(
    roundId: string,
    roundSeedHex: string,
  ): ArenaMarketSnapshot {
    const derived = this.solanaOperator?.deriveRoundAddresses(roundSeedHex);
    return {
      roundId,
      roundSeedHex,
      programId:
        this.solanaOperator?.getProgramId() ??
        this.solanaConfig.marketProgramId,
      mint: this.solanaConfig.goldMint,
      tokenProgram: this.solanaConfig.goldTokenProgramId,
      marketPda:
        derived?.marketPda.toBase58() ??
        `market_${sha256Hex(`market:${roundId}`).slice(0, 40)}`,
      oraclePda:
        derived?.oraclePda.toBase58() ??
        `oracle_${sha256Hex(`oracle:${roundId}`).slice(0, 40)}`,
      vaultAta:
        derived?.vaultAta.toBase58() ??
        `vault_${sha256Hex(`vault:${roundId}`).slice(0, 40)}`,
      feeVaultAta:
        derived?.feeVaultAta.toBase58() ??
        `fee_${sha256Hex(`fee:${roundId}`).slice(0, 40)}`,
      status: "BETTING",
      closeSlot: null,
      resolvedSlot: null,
      winnerSide: null,
      poolA: "0",
      poolB: "0",
      feeBps: this.solanaConfig.feeBps,
    };
  }

  private async getEligibleAgents(): Promise<WhitelistedAgentCandidate[]> {
    const db = this.getDb();
    if (!db) return [];

    const now = nowMs();
    try {
      const rows = await db
        .select({
          characterId: schema.arenaAgentWhitelist.characterId,
          cooldownUntil: schema.arenaAgentWhitelist.cooldownUntil,
          minPowerScore: schema.arenaAgentWhitelist.minPowerScore,
          maxPowerScore: schema.arenaAgentWhitelist.maxPowerScore,
          name: schema.characters.name,
          attackLevel: schema.characters.attackLevel,
          strengthLevel: schema.characters.strengthLevel,
          defenseLevel: schema.characters.defenseLevel,
          constitutionLevel: schema.characters.constitutionLevel,
          rangedLevel: schema.characters.rangedLevel,
          magicLevel: schema.characters.magicLevel,
          prayerLevel: schema.characters.prayerLevel,
        })
        .from(schema.arenaAgentWhitelist)
        .innerJoin(
          schema.characters,
          eq(schema.characters.id, schema.arenaAgentWhitelist.characterId),
        )
        .where(
          and(
            eq(schema.arenaAgentWhitelist.enabled, true),
            eq(schema.characters.isAgent, 1),
          ),
        );

      const activePlayers = this.world.entities.players;
      return rows
        .filter((row) => {
          if (!activePlayers?.has(row.characterId)) return false;
          if (row.cooldownUntil && row.cooldownUntil > now) return false;
          const powerScore = computePowerScore(row);
          if (powerScore < row.minPowerScore) return false;
          if (powerScore > row.maxPowerScore) return false;
          return true;
        })
        .map((row) => {
          const powerScore = computePowerScore(row);
          return {
            characterId: row.characterId,
            name: row.name,
            powerScore,
            cooldownUntil: row.cooldownUntil,
          };
        });
    } catch (error) {
      this.logTableMissingError(error);
      return [];
    }
  }

  private pickMatchPair(agents: WhitelistedAgentCandidate[]): {
    duelA: WhitelistedAgentCandidate | null;
    duelB: WhitelistedAgentCandidate | null;
  } {
    if (agents.length < 2) return { duelA: null, duelB: null };

    let bestPair:
      | [WhitelistedAgentCandidate, WhitelistedAgentCandidate]
      | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < agents.length; i += 1) {
      for (let j = i + 1; j < agents.length; j += 1) {
        const a = agents[i] as WhitelistedAgentCandidate;
        const b = agents[j] as WhitelistedAgentCandidate;
        const diff = Math.abs(a.powerScore - b.powerScore);
        const jitter = Math.random() * 0.25;
        const score = diff + jitter;
        if (score < bestScore) {
          bestScore = score;
          bestPair = [a, b];
        }
      }
    }

    if (!bestPair) return { duelA: null, duelB: null };
    return {
      duelA: bestPair[0],
      duelB: bestPair[1],
    };
  }

  private async getCharacterNameAndCombat(characterId: string): Promise<{
    name: string;
    combatLevel: number;
  }> {
    const player = this.world.entities.players?.get(characterId) as
      | {
          name?: string;
          combatLevel?: number;
          data?: { name?: string; combatLevel?: number };
        }
      | undefined;
    const name =
      player?.name ?? player?.data?.name ?? `Agent-${characterId.slice(0, 6)}`;
    const combatLevel = player?.combatLevel ?? player?.data?.combatLevel ?? 50;
    return { name, combatLevel };
  }

  private async applyParticipantCooldown(
    characterId: string,
    cooldownUntil: number,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db
        .update(schema.arenaAgentWhitelist)
        .set({ cooldownUntil, updatedAt: nowMs() })
        .where(eq(schema.arenaAgentWhitelist.characterId, characterId));
    } catch (error) {
      this.logDbWriteError("apply cooldown", error);
    }
  }

  private getDuelSystem(): DuelSystem | null {
    const duel = this.world.getSystem("duel") as DuelSystem | undefined;
    return duel ?? null;
  }

  private getDb() {
    const dbSystem = this.world.getSystem("database") as
      | DatabaseSystem
      | undefined;
    const db = dbSystem?.getDb() ?? null;
    if (!db && !this.dbUnavailableLogged) {
      console.warn(
        "[ArenaService] Database unavailable; arena persistence disabled",
      );
      this.dbUnavailableLogged = true;
    }
    return db;
  }

  private cloneRound(round: LiveArenaRound): ArenaRoundSnapshot {
    return {
      ...round,
      market: round.market ? { ...round.market } : null,
    };
  }

  private touchRound(): void {
    if (!this.currentRound) return;
    this.currentRound.updatedAt = nowMs();
  }

  private async persistRound(): Promise<void> {
    const round = this.currentRound;
    if (!round) return;
    const db = this.getDb();
    if (!db) return;

    try {
      await db
        .insert(schema.arenaRounds)
        .values({
          id: round.id,
          phase: round.phase,
          agentAId: round.agentAId,
          agentBId: round.agentBId,
          previewAgentAId: round.previewAgentAId,
          previewAgentBId: round.previewAgentBId,
          duelId: round.duelId,
          scheduledAt: round.scheduledAt,
          bettingOpensAt: round.bettingOpensAt,
          bettingClosesAt: round.bettingClosesAt,
          duelStartsAt: round.duelStartsAt,
          duelEndsAt: round.duelEndsAt,
          winnerId: round.winnerId,
          winReason: round.winReason,
          damageA: round.damageA,
          damageB: round.damageB,
          metadataUri: round.metadataUri,
          resultHash: round.resultHash,
          createdAt: round.createdAt,
          updatedAt: round.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.arenaRounds.id,
          set: {
            phase: round.phase,
            previewAgentAId: round.previewAgentAId,
            previewAgentBId: round.previewAgentBId,
            duelId: round.duelId,
            duelStartsAt: round.duelStartsAt,
            duelEndsAt: round.duelEndsAt,
            winnerId: round.winnerId,
            winReason: round.winReason,
            damageA: round.damageA,
            damageB: round.damageB,
            metadataUri: round.metadataUri,
            resultHash: round.resultHash,
            updatedAt: round.updatedAt,
          },
        });
    } catch (error) {
      this.logDbWriteError("persist round", error);
    }
  }

  private async persistMarket(): Promise<void> {
    const round = this.currentRound;
    if (!round?.market) return;
    const db = this.getDb();
    if (!db) return;

    try {
      await db
        .insert(schema.solanaMarkets)
        .values({
          roundId: round.id,
          marketPda: round.market.marketPda,
          oraclePda: round.market.oraclePda,
          mint: round.market.mint,
          vault: round.market.vaultAta,
          feeVault: round.market.feeVaultAta,
          closeSlot: round.market.closeSlot,
          resolvedSlot: round.market.resolvedSlot,
          status: round.market.status,
          winnerSide: round.market.winnerSide,
          createdAt: round.createdAt,
          updatedAt: round.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.solanaMarkets.roundId,
          set: {
            vault: round.market.vaultAta,
            feeVault: round.market.feeVaultAta,
            status: round.market.status,
            closeSlot: round.market.closeSlot,
            resolvedSlot: round.market.resolvedSlot,
            winnerSide: round.market.winnerSide,
            updatedAt: round.updatedAt,
          },
        });
    } catch (error) {
      this.logDbWriteError("persist market", error);
    }
  }

  private async persistRoundEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const round = this.currentRound;
    if (!round) return;
    const db = this.getDb();
    if (!db) return;
    try {
      await db.insert(schema.arenaRoundEvents).values({
        roundId: round.id,
        eventType,
        payload,
      });
    } catch (error) {
      this.logDbWriteError("persist round event", error);
    }
  }

  private async queuePayoutJobs(
    roundId: string,
    winnerSide: ArenaSide,
  ): Promise<void> {
    const db = this.getDb();
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
      this.logDbWriteError("queue payout jobs", error);
    }
  }

  private async processPayoutJobs(): Promise<void> {
    if (!this.solanaOperator?.isEnabled()) return;
    const db = this.getDb();
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
          const claimSignature = await this.solanaOperator.claimFor(
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
      this.logDbWriteError("process payout jobs", error);
    }
  }

  private logDbWriteError(action: string, error: unknown): void {
    this.logTableMissingError(error);
    console.warn(`[ArenaService] Failed to ${action}:`, error);
  }

  private logTableMissingError(error: unknown): void {
    if (this.tablesUnavailableLogged) return;
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    if (
      message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("undefined_table")
    ) {
      this.tablesUnavailableLogged = true;
      console.warn(
        "[ArenaService] Arena tables appear missing. Run database migrations before enabling streamed arena betting.",
      );
    }
  }

  public async hydrateRecentRounds(limit = 20): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      const rows = await db
        .select()
        .from(schema.arenaRounds)
        .orderBy(desc(schema.arenaRounds.createdAt))
        .limit(limit);

      const roundIds = rows.map((row) => row.id);
      const marketRows =
        roundIds.length > 0
          ? await db
              .select()
              .from(schema.solanaMarkets)
              .where(inArray(schema.solanaMarkets.roundId, roundIds))
          : [];
      const marketByRoundId = new Map(
        marketRows.map((row) => [row.roundId, row] as const),
      );

      const history: LiveArenaRound[] = [];
      for (const row of rows) {
        const phase = coerceArenaPhase(row.phase);
        if (!phase) continue;
        const roundSeedHex = buildRoundSeedHex(row.id);
        const marketRow = marketByRoundId.get(row.id);
        const fallbackMarket = this.createInitialMarket(row.id, roundSeedHex);
        history.push({
          ...row,
          roundSeedHex,
          phase,
          winReason: coerceArenaWinReason(row.winReason),
          market: marketRow
            ? {
                ...fallbackMarket,
                status: marketRow.status as ArenaMarketSnapshot["status"],
                closeSlot: marketRow.closeSlot,
                resolvedSlot: marketRow.resolvedSlot,
                winnerSide:
                  marketRow.winnerSide === "A" || marketRow.winnerSide === "B"
                    ? marketRow.winnerSide
                    : null,
                vaultAta: marketRow.vault ?? fallbackMarket.vaultAta,
                feeVaultAta: marketRow.feeVault ?? fallbackMarket.feeVaultAta,
              }
            : fallbackMarket,
          phaseDeadlineMs: null,
        });
      }
      this.history = history;
    } catch (error) {
      this.logTableMissingError(error);
    }
  }
}
