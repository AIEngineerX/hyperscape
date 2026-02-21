import crypto from "node:crypto";
import type { World } from "@hyperscape/shared";
import { EventType } from "@hyperscape/shared";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
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
  PointsEntry,
  LeaderboardEntry,
  GoldMultiplierInfo,
  InviteSummary,
  InviteRedemptionResult,
  ArenaFeeChain,
  ArenaFeePlatform,
  WalletLinkResult,
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

function normalizeWallet(wallet: string): string {
  const value = wallet.trim();
  if (!value) {
    throw new Error("Wallet is required");
  }
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return value.toLowerCase();
  }
  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on")
    return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return fallback;
}

function readIntegerEnv(
  name: string,
  fallback: number,
  minValue: number,
  maxValue?: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const boundedMin = Math.max(minValue, parsed);
  if (maxValue == null) return boundedMin;
  return Math.min(maxValue, boundedMin);
}

function isLikelyDevelopmentRuntime(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  if (nodeEnv === "development" || nodeEnv === "dev" || nodeEnv === "test") {
    return true;
  }
  const entry = process.argv[1] ?? "";
  return (
    entry.includes(
      `${process.platform === "win32" ? "\\" : "/"}build${process.platform === "win32" ? "\\" : "/"}index.js`,
    ) ||
    entry.includes("/build/index.js") ||
    entry.includes("\\build\\index.js")
  );
}

function isLikelySolanaWallet(walletRaw: string): boolean {
  const wallet = walletRaw.trim();
  if (!wallet) return false;
  if (wallet.startsWith("0x") || wallet.startsWith("0X")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
}

function normalizeInviteCode(inviteCode: string): string {
  const value = inviteCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(value)) {
    throw new Error("Invite code format is invalid");
  }
  return value;
}

function normalizeFeeChain(chainRaw: string): ArenaFeeChain {
  const value = chainRaw.trim().toUpperCase();
  if (value === "SOLANA" || value === "BSC" || value === "BASE") {
    return value;
  }
  throw new Error("Unsupported chain. Expected SOLANA, BSC, or BASE");
}

function normalizeFeePlatform(
  platformRaw: string | null | undefined,
): ArenaFeePlatform {
  if (!platformRaw) return "ALL";
  const value = platformRaw.trim().toUpperCase();
  if (
    value === "ALL" ||
    value === "EVM" ||
    value === "SOLANA" ||
    value === "BSC" ||
    value === "BASE"
  ) {
    return value;
  }
  throw new Error(
    "Unsupported platform. Expected all, evm, solana, bsc, or base",
  );
}

function feeChainsForPlatform(platform: ArenaFeePlatform): ArenaFeeChain[] {
  if (platform === "SOLANA") {
    return ["SOLANA"];
  }
  if (platform === "EVM" || platform === "BSC" || platform === "BASE") {
    return ["BSC", "BASE"];
  }
  return ["SOLANA", "BSC", "BASE"];
}

function walletChainFamily(chain: ArenaFeeChain): "SOLANA" | "EVM" {
  return chain === "SOLANA" ? "SOLANA" : "EVM";
}

function normalizeWalletForChain(
  walletRaw: string,
  chain: ArenaFeeChain,
): string {
  const wallet = normalizeWallet(walletRaw);
  if (chain === "SOLANA") {
    if (!isLikelySolanaWallet(wallet)) {
      throw new Error("Solana wallet must be a valid base58 address");
    }
    return wallet;
  }

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw new Error("EVM wallet must be a valid 0x address");
  }
  return wallet;
}

function walletLinkPairKey(params: {
  leftWallet: string;
  leftPlatform: ArenaFeeChain;
  rightWallet: string;
  rightPlatform: ArenaFeeChain;
}): string {
  const left = `${walletChainFamily(params.leftPlatform)}:${params.leftWallet}`;
  const right = `${walletChainFamily(params.rightPlatform)}:${params.rightWallet}`;
  return [left, right].sort().join("|");
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
  private static readonly IS_PLAYWRIGHT_TEST =
    process.env.PLAYWRIGHT_TEST === "true";
  private static readonly IS_DEVELOPMENT_RUNTIME = isLikelyDevelopmentRuntime();

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
  private stakingAccrualDisabled = false;
  private stakingAccrualDisabledLogged = false;
  private lastPayoutProcessAt = 0;
  private lastStakingSweepAt = 0;
  private lastFailedAwardProcessAt = 0;

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
      const amountGoldUnits = parseDecimalToBaseUnits(sourceAmount, 6);
      if (amountGoldUnits <= 0n) {
        throw new Error("sourceAmount converted to zero");
      }
      return {
        roundId: round.id,
        side,
        sourceAsset,
        sourceAmount,
        expectedGoldAmount: formatBaseUnitsToDecimal(amountGoldUnits, 6),
        minGoldAmount: formatBaseUnitsToDecimal(amountGoldUnits, 6),
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
    skipPoints?: boolean;
    inviteCode?: string | null;
    verifiedForPoints?: boolean;
    chain?: ArenaFeeChain;
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
    const bettorWallet = normalizeWallet(params.bettorWallet);
    try {
      await db.insert(schema.solanaBets).values({
        id,
        roundId: params.roundId,
        bettorWallet,
        side: normalizedSide,
        sourceAsset: params.sourceAsset,
        sourceAmount: params.sourceAmount,
        goldAmount: params.goldAmount,
        quoteJson: params.quoteJson ?? null,
        txSignature: params.txSignature ?? null,
        status: params.txSignature ? "SUBMITTED" : "PENDING",
      });

      const referral = await this.resolveReferralForWallet({
        wallet: bettorWallet,
        betId: id,
        inviteCode: params.inviteCode ?? null,
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
        bettorWallet,
        side: normalizedSide,
        sourceAsset: params.sourceAsset,
        sourceAmount: params.sourceAmount,
        goldAmount: params.goldAmount,
        txSignature: params.txSignature ?? null,
        inviteCode: referral?.inviteCode ?? null,
        inviterWallet: referral?.inviterWallet ?? null,
      });

      const feeShareRecorded = await this.recordFeeShare({
        roundId: params.roundId,
        betId: id,
        bettorWallet,
        goldAmount: params.goldAmount,
        feeBps: round.market.feeBps,
        chain: params.chain ?? "SOLANA",
        referral,
      });

      if (!feeShareRecorded) {
        return id;
      }

      if (!params.skipPoints) {
        void this.awardPoints({
          wallet: bettorWallet,
          roundId: params.roundId,
          roundSeedHex: round.roundSeedHex,
          betId: id,
          sourceAsset: params.sourceAsset,
          goldAmount: params.goldAmount,
          txSignature: params.txSignature ?? null,
          side: normalizedSide,
          verifiedForPoints: params.verifiedForPoints === true,
          referral,
        });
      }
    } catch (error) {
      this.logDbWriteError("record bet", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
    return id;
  }

  public async recordExternalBet(params: {
    bettorWallet: string;
    chain: ArenaFeeChain;
    sourceAsset: "GOLD" | "SOL" | "USDC";
    sourceAmount: string;
    goldAmount: string;
    feeBps: number;
    txSignature?: string | null;
    inviteCode?: string | null;
    externalBetRef?: string | null;
    marketPda?: string | null;
    skipPoints?: boolean;
  }): Promise<string> {
    const goldUnits = parseDecimalToBaseUnits(params.goldAmount, 6);
    if (goldUnits <= 0n) {
      throw new Error("goldAmount must be > 0");
    }

    const db = this.getDb();
    if (!db) return randomId("bet");

    const chain = normalizeFeeChain(params.chain);
    const bettorWallet = normalizeWalletForChain(params.bettorWallet, chain);
    const txSignature = params.txSignature?.trim() || null;
    if (!txSignature) {
      throw new Error("txSignature is required for external bet tracking");
    }
    const idempotencyKey = txSignature || params.externalBetRef?.trim() || null;
    const id = idempotencyKey
      ? `bet_ext_${sha256Hex(`external:${chain}:${idempotencyKey}`).slice(0, 24)}`
      : randomId("bet");

    const canAwardExternalPoints = !params.skipPoints && txSignature !== null;
    const queueExternalPointsAward = (
      referral: { inviteCode: string; inviterWallet: string } | null,
    ): void => {
      if (!canAwardExternalPoints) return;
      void (async () => {
        try {
          const existingPoints = await db.query.arenaPoints.findFirst({
            where: eq(schema.arenaPoints.betId, id),
          });
          if (existingPoints) return;
        } catch (error: unknown) {
          this.logTableMissingError(error);
          return;
        }

        void this.awardPoints({
          wallet: bettorWallet,
          roundId: null,
          roundSeedHex: null,
          betId: id,
          sourceAsset: params.sourceAsset,
          goldAmount: params.goldAmount,
          txSignature,
          side: "A",
          verifiedForPoints: chain !== "SOLANA",
          referral,
        }).catch((err) => {
          console.warn(
            `[ArenaService] Failed to award points for external bet ${id}:`,
            err,
          );
        });
      })();
    };

    if (idempotencyKey) {
      const existing = await db.query.arenaFeeShares.findFirst({
        where: eq(schema.arenaFeeShares.betId, id),
      });
      if (existing) {
        queueExternalPointsAward(
          existing.inviteCode && existing.inviterWallet
            ? {
                inviteCode: existing.inviteCode,
                inviterWallet: existing.inviterWallet,
              }
            : null,
        );
        return id;
      }
    }

    try {
      const referral = await this.resolveReferralForWallet({
        wallet: bettorWallet,
        betId: id,
        inviteCode: params.inviteCode ?? null,
      });
      const normalizedFeeBps = Math.max(0, Math.floor(params.feeBps));

      const feeShareRecorded = await this.recordFeeShare({
        roundId: null,
        betId: id,
        bettorWallet,
        goldAmount: params.goldAmount,
        feeBps: normalizedFeeBps,
        chain,
        referral,
      });

      if (!feeShareRecorded) {
        return id;
      }

      queueExternalPointsAward(referral);

      return id;
    } catch (error) {
      this.logDbWriteError("record external bet", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
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
    if (!inspected.memo) {
      throw new Error(
        `Inbound transfer memo is required. Expected memo: ${expectedMemo}`,
      );
    }
    if (
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
      verifiedForPoints: true,
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
      if (
        now - this.lastStakingSweepAt >=
        ArenaService.STAKING_SWEEP_INTERVAL_MS
      ) {
        this.lastStakingSweepAt = now;
        await this.processStakingAccrualSweep();
      }
      if (now - this.lastFailedAwardProcessAt >= 30_000) {
        this.lastFailedAwardProcessAt = now;
        await this.processFailedAwards();
        await this.voidExpiredPendingBonuses();
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
            const betLockDeadline = now + this.config.bettingLockBufferMs;
            await this.moveToPhase("BET_LOCK");
            await this.setRoundPhaseDeadline(betLockDeadline);
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
          } else if (
            round.updatedAt !== null &&
            round.duelStartsAt !== null &&
            now >= round.duelStartsAt + 15_000 && // Wait 15s after start
            now >= round.updatedAt + 20_000 // 20s stalemate without damage
          ) {
            console.warn(
              `[ArenaService] Resolving stalemated duel ${round.duelId} due to 20s of no damage.`,
            );
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
        case "MARKET_RESOLVE": {
          const restoreDeadline = now + this.config.restoreDurationMs;
          await this.moveToPhase("RESTORE");
          await this.setRoundPhaseDeadline(restoreDeadline);
          break;
        }
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

    const [previewA, previewB] = this.pickPreviewPair(agents, [
      duelA.characterId,
      duelB.characterId,
    ]);
    if (!previewA || !previewB) {
      return;
    }

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
    const session = duelSystem?.getDuelSession?.(round.duelId);
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
    const resultShowDeadline = nowMs() + this.config.resultShowDurationMs;
    await this.moveToPhase("RESULT_SHOW");
    await this.setRoundPhaseDeadline(resultShowDeadline);
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

    void this.awardWinPoints(round);
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

  private async setRoundPhaseDeadline(phaseDeadlineMs: number): Promise<void> {
    if (!this.currentRound) return;
    this.currentRound.phaseDeadlineMs = phaseDeadlineMs;
    this.touchRound();
    await this.persistRound();
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

  private pickPreviewPair(
    candidates: WhitelistedAgentCandidate[],
    excludeCharacterIds: string[],
  ): [WhitelistedAgentCandidate | null, WhitelistedAgentCandidate | null] {
    if (candidates.length < 2) {
      return [null, null];
    }

    const excluded = new Set(excludeCharacterIds);
    const externalCandidates = candidates.filter(
      (candidate) => !excluded.has(candidate.characterId),
    );
    const source =
      externalCandidates.length >= 2 ? externalCandidates : candidates;

    const first = pickRandom(source);
    const secondCandidates = source.filter(
      (candidate) => candidate.characterId !== first.characterId,
    );
    const second =
      secondCandidates.length > 0 ? pickRandom(secondCandidates) : null;

    if (second) {
      return [first, second];
    }

    if (source.length < 2) {
      return [null, null];
    }

    const fallbackCandidates = candidates.filter(
      (candidate) => candidate.characterId !== first.characterId,
    );
    if (fallbackCandidates.length === 0) return [null, null];
    return [first, pickRandom(fallbackCandidates)];
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

  private async processStakingAccrualSweep(): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const wallets: string[] = [];
    const seen = new Set<string>();
    const appendWallet = (walletRaw: string | null | undefined): void => {
      if (!walletRaw || !isLikelySolanaWallet(walletRaw)) return;
      const wallet = normalizeWallet(walletRaw);
      if (seen.has(wallet)) return;
      seen.add(wallet);
      wallets.push(wallet);
    };

    try {
      const staleWalletRows = await db
        .select({
          wallet: schema.arenaStakingPoints.wallet,
          latestPeriodEndAt:
            sql<number>`MAX(${schema.arenaStakingPoints.periodEndAt})`.as(
              "latestPeriodEndAt",
            ),
        })
        .from(schema.arenaStakingPoints)
        .groupBy(schema.arenaStakingPoints.wallet)
        .orderBy(
          sql<number>`MAX(${schema.arenaStakingPoints.periodEndAt}) ASC`,
          schema.arenaStakingPoints.wallet,
        )
        .limit(ArenaService.STAKING_SWEEP_BATCH_SIZE);

      for (const row of staleWalletRows) {
        appendWallet(row.wallet);
      }
    } catch (error: unknown) {
      this.logTableMissingError(error);
    }

    if (wallets.length < ArenaService.STAKING_SWEEP_BATCH_SIZE) {
      try {
        const recentPointsWalletRows = await db
          .select({
            wallet: schema.arenaPoints.wallet,
          })
          .from(schema.arenaPoints)
          .orderBy(desc(schema.arenaPoints.createdAt))
          .limit(ArenaService.STAKING_SWEEP_BATCH_SIZE * 3);

        for (const row of recentPointsWalletRows) {
          appendWallet(row.wallet);
          if (wallets.length >= ArenaService.STAKING_SWEEP_BATCH_SIZE) break;
        }
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }
    }

    if (wallets.length < ArenaService.STAKING_SWEEP_BATCH_SIZE) {
      try {
        const recentFeeWalletRows = await db
          .select({
            wallet: schema.arenaFeeShares.bettorWallet,
          })
          .from(schema.arenaFeeShares)
          .orderBy(desc(schema.arenaFeeShares.createdAt))
          .limit(ArenaService.STAKING_SWEEP_BATCH_SIZE * 3);

        for (const row of recentFeeWalletRows) {
          appendWallet(row.wallet);
          if (wallets.length >= ArenaService.STAKING_SWEEP_BATCH_SIZE) break;
        }
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }
    }

    for (const wallet of wallets.slice(
      0,
      ArenaService.STAKING_SWEEP_BATCH_SIZE,
    )) {
      await this.accrueStakingPointsIfDue(wallet);
    }
  }

  private logDbWriteError(action: string, error: unknown): void {
    this.logTableMissingError(error);
    if (ArenaService.IS_PLAYWRIGHT_TEST) {
      if (action === "accrue staking points" || action === "record fee share") {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      if (message.includes("this.dialect")) {
        return;
      }
    }
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

  // ============================================================================
  // Points System
  // ============================================================================

  /** GOLD thresholds for multiplier tiers (in human-readable units, not base units) */
  private static readonly GOLD_TIER_0 = 1_000; // 1× multiplier floor
  private static readonly GOLD_TIER_1 = 100_000; // 2× multiplier
  private static readonly GOLD_TIER_2 = 1_000_000; // 3× multiplier
  private static readonly GOLD_HOLD_DAYS_BONUS = 10; // +1× bonus for 100k+/1m+ tiers
  private static readonly GOLD_DECIMALS = 6;
  private static readonly REFERRAL_FEE_SHARE_BPS = 1_000; // 10% of fee amount
  private static readonly WALLET_LINK_BONUS_POINTS = 100;
  private static readonly STAKING_POINTS_PER_GOLD_PER_DAY = 0.001;
  private static readonly ONE_DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly STAKING_SWEEP_ENABLED = readBooleanEnv(
    "ARENA_STAKING_SWEEP_ENABLED",
    !ArenaService.IS_DEVELOPMENT_RUNTIME,
  );
  private static readonly STAKING_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
  private static readonly STAKING_SWEEP_BATCH_SIZE = readIntegerEnv(
    "ARENA_STAKING_SWEEP_BATCH_SIZE",
    100,
    1,
    1_000,
  );
  private static readonly HOLD_DAYS_SCAN_ENABLED = readBooleanEnv(
    "ARENA_HOLD_DAYS_SCAN_ENABLED",
    !ArenaService.IS_DEVELOPMENT_RUNTIME,
  );
  private static readonly HOLD_DAYS_SCAN_MAX_PAGES = readIntegerEnv(
    "ARENA_HOLD_DAYS_SCAN_MAX_PAGES",
    ArenaService.IS_DEVELOPMENT_RUNTIME ? 0 : 4,
    0,
    50,
  );
  private static readonly HOLD_DAYS_SCAN_PAGE_SIZE = readIntegerEnv(
    "ARENA_HOLD_DAYS_SCAN_PAGE_SIZE",
    1_000,
    1,
    1_000,
  );
  private static readonly SOLANA_RPC_TIMEOUT_MS = readIntegerEnv(
    "ARENA_SOLANA_RPC_TIMEOUT_MS",
    ArenaService.IS_DEVELOPMENT_RUNTIME ? 3_000 : 8_000,
    500,
    60_000,
  );

  private static readonly SIGNUP_BONUS_REFERRER = 50;
  private static readonly SIGNUP_BONUS_REFEREE = 25;
  private static readonly WIN_BONUS_MULTIPLIER = 2;
  private static readonly REFERRAL_WIN_SHARE = 0.1; // 10% of win bonus
  private static readonly REFERRAL_VELOCITY_MAX_PER_DAY = 10;
  private static readonly SIGNUP_BONUS_PENDING_EXPIRY_MS =
    30 * 24 * 60 * 60 * 1000; // 30 days

  /**
   * Award points for a recorded bet. Wrapped in a transaction to ensure
   * arena_points + arena_referral_points + ledger entries are atomic.
   * On failure, enqueues to arena_failed_awards for retry.
   */
  private async awardPoints(params: {
    wallet: string;
    roundId: string | null;
    roundSeedHex: string | null;
    betId: string;
    sourceAsset: "GOLD" | "SOL" | "USDC";
    goldAmount: string;
    txSignature: string | null;
    side: "A" | "B";
    verifiedForPoints: boolean;
    referral: { inviteCode: string; inviterWallet: string } | null;
  }): Promise<void> {
    const verifiedGoldAmount =
      await this.resolveVerifiedGoldAmountForPoints(params);
    if (!verifiedGoldAmount) {
      console.warn(
        `[ArenaService] Skipping points for bet ${params.betId}: missing verified bet evidence`,
      );
      return;
    }

    const db = this.getDb();
    if (!db) return;

    const amount = Number(verifiedGoldAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const basePoints = Math.max(1, Math.round(amount * 0.001));

    const position = await this.fetchGoldPositionForWallet(params.wallet);
    await this.accrueStakingPointsIfDue(params.wallet, position);

    const multiplier = this.computeGoldMultiplier(
      position.goldBalance,
      position.goldHoldDays,
    );
    const totalPoints = basePoints * multiplier;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.arenaPoints).values({
          wallet: params.wallet,
          roundId: params.roundId,
          betId: params.betId,
          side: params.side,
          basePoints,
          multiplier,
          totalPoints,
          goldBalance: position.goldBalance.toString(),
          goldHoldDays: position.goldHoldDays,
        });

        const ledgerKey = `BET_PLACED:${params.betId}:${params.wallet}`;
        await tx
          .insert(schema.arenaPointLedger)
          .values({
            wallet: params.wallet,
            eventType: "BET_PLACED",
            basePoints,
            multiplier,
            totalPoints,
            referenceType: "bet",
            referenceId: params.betId,
            idempotencyKey: ledgerKey,
            metadata: {
              roundId: params.roundId,
              side: params.side,
              goldAmount: verifiedGoldAmount,
            },
          })
          .onConflictDoNothing({
            target: [schema.arenaPointLedger.idempotencyKey],
          });

        if (params.referral) {
          let referrerMultiplier = multiplier;
          try {
            const referrerPosition = await this.fetchGoldPositionForWallet(
              params.referral.inviterWallet,
            );
            referrerMultiplier = this.computeGoldMultiplier(
              referrerPosition.goldBalance,
              referrerPosition.goldHoldDays,
            );
          } catch {
            // Fall back to bettor's multiplier if referrer lookup fails
          }
          const diminishingFactor = await this.getReferralDiminishingFactor(
            params.referral.inviterWallet,
          );
          const referralTotalPoints = Math.max(
            1,
            Math.round(basePoints * referrerMultiplier * diminishingFactor),
          );

          await tx.insert(schema.arenaReferralPoints).values({
            roundId: params.roundId,
            betId: params.betId,
            inviteCode: params.referral.inviteCode,
            inviterWallet: params.referral.inviterWallet,
            invitedWallet: params.wallet,
            basePoints,
            multiplier: referrerMultiplier,
            totalPoints: referralTotalPoints,
          });

          const refLedgerKey = `REFERRAL_BET:${params.betId}:${params.referral.inviterWallet}`;
          await tx
            .insert(schema.arenaPointLedger)
            .values({
              wallet: params.referral.inviterWallet,
              eventType: "REFERRAL_BET",
              basePoints,
              multiplier: referrerMultiplier,
              totalPoints: referralTotalPoints,
              referenceType: "bet",
              referenceId: params.betId,
              relatedWallet: params.wallet,
              idempotencyKey: refLedgerKey,
              metadata: {
                roundId: params.roundId,
                inviteCode: params.referral.inviteCode,
              },
            })
            .onConflictDoNothing({
              target: [schema.arenaPointLedger.idempotencyKey],
            });

          await this.confirmPendingSignupBonus(
            tx,
            params.referral.inviterWallet,
            params.wallet,
          );
        }
      });
    } catch (error: unknown) {
      this.logDbWriteError("award points", error);
      await this.enqueueFailedAward("BET_PLACED", params, error);
    }
  }

  private async resolveVerifiedGoldAmountForPoints(params: {
    wallet: string;
    roundId: string | null;
    roundSeedHex: string | null;
    side: "A" | "B";
    sourceAsset: "GOLD" | "SOL" | "USDC";
    goldAmount: string;
    txSignature: string | null;
    verifiedForPoints: boolean;
  }): Promise<string | null> {
    if (params.verifiedForPoints) {
      return params.goldAmount;
    }

    if (!params.txSignature || !this.solanaOperator?.isEnabled()) {
      return null;
    }

    let expectedGoldAmount: bigint;
    try {
      expectedGoldAmount = parseDecimalToBaseUnits(
        params.goldAmount,
        ArenaService.GOLD_DECIMALS,
      );
    } catch {
      return null;
    }

    if (params.roundSeedHex) {
      try {
        const marketTx = await this.solanaOperator.inspectMarketBetTransaction(
          params.txSignature,
          params.roundSeedHex,
        );
        if (marketTx) {
          if (
            !marketTx.bettorWallet ||
            marketTx.bettorWallet !== params.wallet
          ) {
            return null;
          }
          if (marketTx.amountBaseUnits !== expectedGoldAmount) {
            return null;
          }
          return marketTx.amountGold;
        }
      } catch {
        // Fall through to inbound transfer inspection if market-tx parsing fails.
      }
    }

    try {
      const inspected = await this.solanaOperator.inspectInboundGoldTransfer(
        params.txSignature,
      );
      if (!inspected?.fromWallet) {
        return null;
      }
      if (inspected.fromWallet !== params.wallet) {
        return null;
      }
      if (inspected.amountBaseUnits !== expectedGoldAmount) {
        return null;
      }

      // For memo-enabled clients, enforce round/side consistency when present.
      const expectedMemo =
        params.roundId !== null
          ? `ARENA:${params.roundId}:${params.side}`
          : null;
      const memoMatches = Boolean(
        expectedMemo &&
        inspected.memo &&
        (inspected.memo === expectedMemo ||
          inspected.memo.includes(expectedMemo)),
      );
      if (params.sourceAsset === "GOLD" && expectedMemo && !memoMatches) {
        return null;
      }
      if (expectedMemo && inspected.memo && !memoMatches) {
        return null;
      }

      return inspected.amountGold;
    } catch {
      return null;
    }
  }

  private async recordFeeShare(params: {
    roundId: string | null;
    betId: string;
    bettorWallet: string;
    goldAmount: string;
    feeBps: number;
    chain: ArenaFeeChain;
    referral: { inviteCode: string; inviterWallet: string } | null;
  }): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;

    try {
      const feeBps = Math.max(0, Math.floor(params.feeBps));
      const wagerGoldUnits = parseDecimalToBaseUnits(
        params.goldAmount,
        ArenaService.GOLD_DECIMALS,
      );
      const totalFeeUnits = (wagerGoldUnits * BigInt(feeBps)) / 10_000n;
      const inviterFeeUnits = params.referral
        ? (totalFeeUnits * BigInt(ArenaService.REFERRAL_FEE_SHARE_BPS)) /
          10_000n
        : 0n;
      const treasuryFeeUnits = totalFeeUnits - inviterFeeUnits;

      const values = {
        roundId: params.roundId,
        betId: params.betId,
        bettorWallet: params.bettorWallet,
        inviterWallet: params.referral?.inviterWallet ?? null,
        inviteCode: params.referral?.inviteCode ?? null,
        chain: normalizeFeeChain(params.chain),
        feeBps,
        totalFeeGold: formatBaseUnitsToDecimal(
          totalFeeUnits,
          ArenaService.GOLD_DECIMALS,
        ),
        inviterFeeGold: formatBaseUnitsToDecimal(
          inviterFeeUnits,
          ArenaService.GOLD_DECIMALS,
        ),
        treasuryFeeGold: formatBaseUnitsToDecimal(
          treasuryFeeUnits,
          ArenaService.GOLD_DECIMALS,
        ),
      };

      type FeeShareInsertResult = {
        returning?: (fields: {
          id: typeof schema.arenaFeeShares.id;
        }) => Promise<Array<{ id: number }>>;
        onConflictDoNothing?: (options: {
          target: Array<typeof schema.arenaFeeShares.betId>;
        }) => FeeShareInsertResult | Promise<unknown>;
      } & PromiseLike<unknown>;

      const insertQuery = db.insert(schema.arenaFeeShares).values(values) as
        | FeeShareInsertResult
        | Promise<unknown>;
      const conflictHandler = (insertQuery as FeeShareInsertResult)
        .onConflictDoNothing;
      const queryWithConflictGuard =
        typeof conflictHandler === "function"
          ? conflictHandler({
              target: [schema.arenaFeeShares.betId],
            })
          : insertQuery;

      const guardedQuery = queryWithConflictGuard as FeeShareInsertResult;
      if (typeof guardedQuery.returning === "function") {
        const inserted = await guardedQuery.returning({
          id: schema.arenaFeeShares.id,
        });
        return inserted.length > 0;
      }

      await queryWithConflictGuard;
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message.toLowerCase()
          : String(error ?? "").toLowerCase();
      if (
        errorMessage.includes("duplicate") ||
        errorMessage.includes("unique")
      ) {
        return false;
      }
      this.logDbWriteError("record fee share", error);
      return false;
    }
  }

  private buildInviteCode(wallet: string, attempt = 0): string {
    const digest = sha256Hex(`arena:invite:${wallet}:${attempt}`)
      .slice(0, 10)
      .toUpperCase();
    return `DUEL${digest}`;
  }

  private async getOrCreateInviteCode(walletRaw: string): Promise<string> {
    const db = this.getDb();
    if (!db) {
      return this.buildInviteCode(normalizeWallet(walletRaw), 0);
    }

    const wallet = normalizeWallet(walletRaw);
    const existing = await db.query.arenaInviteCodes.findFirst({
      where: eq(schema.arenaInviteCodes.inviterWallet, wallet),
    });
    if (existing) return existing.code;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.buildInviteCode(wallet, attempt);
      try {
        await db.insert(schema.arenaInviteCodes).values({
          code,
          inviterWallet: wallet,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
        return code;
      } catch (error) {
        const codeConflict =
          error instanceof Error &&
          (error.message.includes("duplicate") ||
            error.message.includes("unique"));
        if (!codeConflict) throw error;
      }
    }

    throw new Error("Failed to allocate invite code");
  }

  private async listLinkedWallets(walletRaw: string): Promise<string[]> {
    const db = this.getDb();
    if (!db) return [];

    const wallet = normalizeWallet(walletRaw);
    const discovered = new Set<string>([wallet]);
    const queue: string[] = [wallet];

    while (queue.length > 0 && discovered.size < 256) {
      const current = queue.shift();
      if (!current) break;

      let cursorId = 0;
      while (discovered.size < 256) {
        let rows: Array<{ id: number; walletA: string; walletB: string }> = [];
        try {
          rows = await db
            .select({
              id: schema.arenaWalletLinks.id,
              walletA: schema.arenaWalletLinks.walletA,
              walletB: schema.arenaWalletLinks.walletB,
            })
            .from(schema.arenaWalletLinks)
            .where(
              and(
                or(
                  eq(schema.arenaWalletLinks.walletA, current),
                  eq(schema.arenaWalletLinks.walletB, current),
                ),
                gt(schema.arenaWalletLinks.id, cursorId),
              ),
            )
            .orderBy(asc(schema.arenaWalletLinks.id))
            .limit(256);
        } catch (error) {
          this.logTableMissingError(error);
          return [];
        }

        if (rows.length === 0) break;

        for (const row of rows) {
          const candidates = [row.walletA, row.walletB];
          for (const candidate of candidates) {
            if (discovered.size >= 256) break;
            if (!discovered.has(candidate)) {
              discovered.add(candidate);
              queue.push(candidate);
            }
          }
          if (discovered.size >= 256) break;
        }

        cursorId = rows[rows.length - 1]?.id ?? cursorId;
        if (rows.length < 256) break;
      }
    }

    discovered.delete(wallet);
    return [...discovered];
  }

  private async listIdentityWallets(walletRaw: string): Promise<string[]> {
    const wallet = normalizeWallet(walletRaw);
    const discovered = new Set<string>([wallet]);
    const linkedWallets = await this.listLinkedWallets(wallet);
    for (const linkedWallet of linkedWallets) {
      discovered.add(normalizeWallet(linkedWallet));
    }
    return [...discovered].slice(0, 256);
  }

  private async isSelfReferralIdentity(
    walletRaw: string,
    inviterWalletRaw: string,
  ): Promise<boolean> {
    const wallet = normalizeWallet(walletRaw);
    const inviterWallet = normalizeWallet(inviterWalletRaw);
    if (wallet === inviterWallet) return true;

    try {
      const identityWallets = await this.listIdentityWallets(wallet);
      return identityWallets.some(
        (candidateWallet) => normalizeWallet(candidateWallet) === inviterWallet,
      );
    } catch (error: unknown) {
      this.logTableMissingError(error);
      return false;
    }
  }

  private assertSingleWalletPerChainFamily(identityWallets: string[]): void {
    const solanaWallets = new Set<string>();
    const evmWallets = new Set<string>();

    for (const candidateRaw of identityWallets) {
      const candidate = normalizeWallet(candidateRaw);
      if (candidate.startsWith("0x")) {
        evmWallets.add(candidate);
      } else {
        solanaWallets.add(candidate);
      }
    }

    if (solanaWallets.size > 1 || evmWallets.size > 1) {
      throw new Error(
        "A linked identity can only contain one Solana wallet and one EVM wallet",
      );
    }
  }

  private async hasWalletLinkBonusInIdentity(
    identityWalletsRaw: string[],
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !db.query?.arenaPoints?.findFirst) return false;

    const identityWallets = [
      ...new Set(identityWalletsRaw.map((wallet) => normalizeWallet(wallet))),
    ].slice(0, 256);
    if (identityWallets.length === 0) return false;

    const walletWhere =
      identityWallets.length === 1
        ? eq(schema.arenaPoints.wallet, identityWallets[0]!)
        : inArray(schema.arenaPoints.wallet, identityWallets);

    try {
      const existingBonus = await db.query.arenaPoints.findFirst({
        where: and(
          walletWhere,
          sql`${schema.arenaPoints.betId} LIKE 'wallet-link:%'`,
        ),
      });
      return Boolean(existingBonus);
    } catch (error: unknown) {
      this.logTableMissingError(error);
      return false;
    }
  }

  private async findReferralMappingForWalletNetwork(
    walletRaw: string,
  ): Promise<{
    id: number;
    inviteCode: string;
    inviterWallet: string;
    invitedWallet: string;
    firstBetId: string | null;
  } | null> {
    const db = this.getDb();
    if (!db) return null;

    const wallet = normalizeWallet(walletRaw);
    const direct = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });
    if (direct) return direct;

    const linkedWallets = await this.listLinkedWallets(wallet);
    if (linkedWallets.length === 0) return null;

    const linkedRows = await db
      .select()
      .from(schema.arenaInvitedWallets)
      .where(inArray(schema.arenaInvitedWallets.invitedWallet, linkedWallets))
      .limit(128);

    if (linkedRows.length === 0) return null;

    const uniqueCodes = new Set(linkedRows.map((row) => row.inviteCode));
    if (uniqueCodes.size > 1) {
      throw new Error(
        "Linked wallets are already associated with different invite codes",
      );
    }

    return linkedRows[0] ?? null;
  }

  private async ensureWalletInviteMapping(params: {
    wallet: string;
    inviteCode: string;
    inviterWallet: string;
    firstBetId: string | null;
  }): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const wallet = normalizeWallet(params.wallet);
    const existing = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });

    if (existing) {
      if (existing.inviteCode !== params.inviteCode) {
        throw new Error("Wallet is already linked to a different invite code");
      }
      if (!existing.firstBetId && params.firstBetId) {
        await db
          .update(schema.arenaInvitedWallets)
          .set({
            firstBetId: params.firstBetId,
            updatedAt: nowMs(),
          })
          .where(eq(schema.arenaInvitedWallets.id, existing.id));
      }
      return;
    }

    try {
      await db.insert(schema.arenaInvitedWallets).values({
        inviteCode: params.inviteCode,
        inviterWallet: params.inviterWallet,
        invitedWallet: wallet,
        firstBetId: params.firstBetId,
      });
    } catch (error) {
      const mappingConflict =
        error instanceof Error &&
        (error.message.includes("duplicate") ||
          error.message.includes("unique") ||
          error.message.includes("constraint"));
      if (!mappingConflict) {
        throw error;
      }

      // Concurrent insert race: reload and enforce consistency.
      const concurrent = await db.query.arenaInvitedWallets.findFirst({
        where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
      });
      if (!concurrent) {
        throw error;
      }
      if (concurrent.inviteCode !== params.inviteCode) {
        throw new Error("Wallet is already linked to a different invite code");
      }
      if (!concurrent.firstBetId && params.firstBetId) {
        await db
          .update(schema.arenaInvitedWallets)
          .set({
            firstBetId: params.firstBetId,
            updatedAt: nowMs(),
          })
          .where(eq(schema.arenaInvitedWallets.id, concurrent.id));
      }
    }
  }

  private async resolveReferralForWallet(params: {
    wallet: string;
    betId: string;
    inviteCode: string | null;
  }): Promise<{ inviteCode: string; inviterWallet: string } | null> {
    const db = this.getDb();
    if (!db) return null;

    const wallet = normalizeWallet(params.wallet);

    if (params.inviteCode?.trim()) {
      const code = normalizeInviteCode(params.inviteCode);
      const invite = await db.query.arenaInviteCodes.findFirst({
        where: eq(schema.arenaInviteCodes.code, code),
      });
      if (!invite) {
        throw new Error("Invite code not found");
      }
      if (await this.isSelfReferralIdentity(wallet, invite.inviterWallet)) {
        throw new Error("You cannot use your own invite code");
      }
      if (await this.areWalletsLinked(wallet, invite.inviterWallet)) {
        throw new Error("You cannot use an invite code from a linked wallet");
      }

      const existing = await this.findReferralMappingForWalletNetwork(wallet);
      if (existing && existing.inviteCode !== code) {
        throw new Error(
          "Referral bindings are permanent and cannot be changed",
        );
      }

      await this.ensureWalletInviteMapping({
        wallet,
        inviteCode: code,
        inviterWallet: invite.inviterWallet,
        firstBetId: params.betId,
      });

      return {
        inviteCode: code,
        inviterWallet: invite.inviterWallet,
      };
    }

    const existing = await this.findReferralMappingForWalletNetwork(wallet);
    if (!existing) return null;

    await this.ensureWalletInviteMapping({
      wallet,
      inviteCode: existing.inviteCode,
      inviterWallet: existing.inviterWallet,
      firstBetId: existing.firstBetId ?? params.betId,
    });

    return {
      inviteCode: existing.inviteCode,
      inviterWallet: existing.inviterWallet,
    };
  }

  private async fetchStakedGoldBalanceAndHoldDays(wallet: string): Promise<{
    balance: number;
    holdDays: number;
    source: string;
  }> {
    const parseValue = (value: unknown): number => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    };

    const asObject = (value: unknown): Record<string, unknown> | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      return value as Record<string, unknown>;
    };

    const endpoint = this.solanaConfig.stakingIndexerUrl?.trim();
    if (endpoint) {
      const buildIndexerUrl = (): string => {
        if (endpoint.includes("{wallet}")) {
          return endpoint.replace("{wallet}", encodeURIComponent(wallet));
        }
        const url = new URL(endpoint);
        url.searchParams.set("wallet", wallet);
        return url.toString();
      };

      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };
        if (this.solanaConfig.stakingIndexerAuthHeader?.trim()) {
          headers.Authorization = this.solanaConfig.stakingIndexerAuthHeader;
        }

        const response = await fetch(buildIndexerUrl(), {
          method: "GET",
          headers,
        });
        if (response.ok) {
          const payload = (await response.json()) as Record<string, unknown>;
          const stakedBalance = Math.max(
            0,
            parseValue(
              payload.stakedGoldBalance ??
                payload.stakedBalance ??
                payload.balance ??
                "0",
            ),
          );
          const holdDays = Math.max(
            0,
            Math.floor(
              parseValue(
                payload.stakedGoldHoldDays ??
                  payload.stakedHoldDays ??
                  payload.holdDays ??
                  "0",
              ),
            ),
          );

          return { balance: stakedBalance, holdDays, source: "INDEXER" };
        }
      } catch {
        // Fall through to Birdeye fallback.
      }
    }

    const birdeyeApiKey = this.solanaConfig.birdeyeApiKey?.trim();
    if (!birdeyeApiKey) {
      return {
        balance: 0,
        holdDays: 0,
        source: endpoint ? "INDEXER_ERROR" : "NONE",
      };
    }

    try {
      const birdeyeBaseUrl =
        this.solanaConfig.birdeyeBaseUrl?.trim() ||
        "https://public-api.birdeye.so";
      const endpointUrl = new URL(
        "v1/wallet/token_balance",
        birdeyeBaseUrl.endsWith("/") ? birdeyeBaseUrl : `${birdeyeBaseUrl}/`,
      );
      endpointUrl.searchParams.set("wallet", wallet);
      endpointUrl.searchParams.set("address", this.solanaConfig.goldMint);

      const response = await fetch(endpointUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-KEY": birdeyeApiKey,
          "x-chain": "solana",
        },
      });
      if (!response.ok) {
        return {
          balance: 0,
          holdDays: 0,
          source: endpoint ? "INDEXER_ERROR_BIRDEYE_ERROR" : "BIRDEYE_ERROR",
        };
      }

      const payload = (await response.json()) as unknown;
      const root = asObject(payload) ?? {};
      const data = asObject(root.data) ?? root;

      const stakedBalance = Math.max(
        0,
        parseValue(
          data.stakedGoldBalance ??
            data.stakedBalance ??
            data.stakedAmount ??
            root.stakedGoldBalance ??
            root.stakedBalance ??
            root.stakedAmount ??
            "0",
        ),
      );
      const holdDays = Math.max(
        0,
        Math.floor(
          parseValue(
            data.stakedGoldHoldDays ??
              data.stakedHoldDays ??
              data.holdDays ??
              root.stakedGoldHoldDays ??
              root.stakedHoldDays ??
              root.holdDays ??
              "0",
          ),
        ),
      );

      if (stakedBalance > 0 || holdDays > 0) {
        return { balance: stakedBalance, holdDays, source: "BIRDEYE_STAKED" };
      }

      const totalBalance = Math.max(
        0,
        parseValue(
          data.balance ??
            data.uiAmount ??
            data.ui_amount ??
            data.amount ??
            root.balance ??
            root.uiAmount ??
            root.ui_amount ??
            root.amount ??
            "0",
        ),
      );
      if (totalBalance > 0) {
        // This endpoint can represent total wallet token balance; callers
        // must de-duplicate against liquid wallet balance before using it.
        return {
          balance: totalBalance,
          holdDays: 0,
          source: "BIRDEYE_TOTAL_BALANCE",
        };
      }

      return { balance: 0, holdDays: 0, source: "BIRDEYE" };
    } catch {
      return {
        balance: 0,
        holdDays: 0,
        source: endpoint ? "INDEXER_ERROR_BIRDEYE_ERROR" : "BIRDEYE_ERROR",
      };
    }
  }

  private async fetchGoldPositionForWallet(wallet: string): Promise<{
    liquidGoldBalance: number;
    stakedGoldBalance: number;
    goldBalance: number;
    liquidGoldHoldDays: number;
    stakedGoldHoldDays: number;
    goldHoldDays: number;
    stakingSource: string;
  }> {
    const [liquid, staked] = await Promise.all([
      this.fetchGoldBalanceAndHoldDays(wallet),
      this.fetchStakedGoldBalanceAndHoldDays(wallet),
    ]);

    const liquidGoldBalance = Math.max(0, liquid.balance);
    let stakedGoldBalance = Math.max(0, staked.balance);
    const liquidGoldHoldDays = Math.max(0, Math.floor(liquid.holdDays));
    let stakedGoldHoldDays = Math.max(0, Math.floor(staked.holdDays));

    if (staked.source === "BIRDEYE_TOTAL_BALANCE") {
      stakedGoldBalance = Math.max(0, stakedGoldBalance - liquidGoldBalance);
      stakedGoldHoldDays = 0;
    }

    return {
      liquidGoldBalance,
      stakedGoldBalance,
      goldBalance: liquidGoldBalance + stakedGoldBalance,
      liquidGoldHoldDays,
      stakedGoldHoldDays,
      goldHoldDays: Math.max(liquidGoldHoldDays, stakedGoldHoldDays),
      stakingSource: staked.source,
    };
  }

  private async accrueStakingPointsIfDue(
    walletRaw: string,
    position?:
      | {
          liquidGoldBalance: number;
          stakedGoldBalance: number;
          goldBalance: number;
          liquidGoldHoldDays: number;
          stakedGoldHoldDays: number;
          goldHoldDays: number;
          stakingSource: string;
        }
      | undefined,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const wallet = normalizeWallet(walletRaw);
    const now = nowMs();
    const currentDayStart =
      Math.floor(now / ArenaService.ONE_DAY_MS) * ArenaService.ONE_DAY_MS;

    try {
      const currentPosition =
        position ?? (await this.fetchGoldPositionForWallet(wallet));
      const currentMultiplier = this.computeGoldMultiplier(
        currentPosition.goldBalance,
        currentPosition.goldHoldDays,
      );

      const parseNonNegativeNumber = (value: unknown): number => {
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.max(0, value);
        }
        if (typeof value === "string" && value.trim()) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
          }
        }
        return 0;
      };

      const latest = await db
        .select({
          id: schema.arenaStakingPoints.id,
          createdAt: schema.arenaStakingPoints.createdAt,
          periodEndAt: schema.arenaStakingPoints.periodEndAt,
          multiplier: schema.arenaStakingPoints.multiplier,
          liquidGoldBalance: schema.arenaStakingPoints.liquidGoldBalance,
          stakedGoldBalance: schema.arenaStakingPoints.stakedGoldBalance,
          goldBalance: schema.arenaStakingPoints.goldBalance,
          goldHoldDays: schema.arenaStakingPoints.goldHoldDays,
          source: schema.arenaStakingPoints.source,
        })
        .from(schema.arenaStakingPoints)
        .where(eq(schema.arenaStakingPoints.wallet, wallet))
        .orderBy(
          desc(schema.arenaStakingPoints.periodEndAt),
          desc(schema.arenaStakingPoints.createdAt),
          desc(schema.arenaStakingPoints.id),
        )
        .limit(1);

      const latestRow = latest[0];
      if (latestRow?.periodEndAt) {
        const periodStartAt = latestRow.periodEndAt;
        const elapsedDays = Math.max(
          0,
          Math.floor(
            (currentDayStart - periodStartAt) / ArenaService.ONE_DAY_MS,
          ),
        );

        if (elapsedDays > 0) {
          const snapshotStakedGoldBalance = parseNonNegativeNumber(
            latestRow.stakedGoldBalance,
          );
          const dailyBasePoints = Math.max(
            0,
            Math.round(
              snapshotStakedGoldBalance *
                ArenaService.STAKING_POINTS_PER_GOLD_PER_DAY,
            ),
          );
          const basePoints = dailyBasePoints * elapsedDays;
          const snapshotMultiplier = Math.max(
            0,
            Math.floor(parseNonNegativeNumber(latestRow.multiplier)),
          );
          const totalPoints = basePoints * snapshotMultiplier;

          await db
            .insert(schema.arenaStakingPoints)
            .values({
              wallet,
              basePoints,
              multiplier: snapshotMultiplier,
              totalPoints,
              daysAccrued: elapsedDays,
              liquidGoldBalance: latestRow.liquidGoldBalance,
              stakedGoldBalance: latestRow.stakedGoldBalance,
              goldBalance: latestRow.goldBalance,
              goldHoldDays: latestRow.goldHoldDays,
              periodStartAt,
              periodEndAt: currentDayStart,
              source: latestRow.source,
            })
            .onConflictDoNothing({
              target: [
                schema.arenaStakingPoints.wallet,
                schema.arenaStakingPoints.periodStartAt,
                schema.arenaStakingPoints.periodEndAt,
              ],
            });
        }
      }

      // Anchor today's snapshot so future accruals use current balances/multiplier.
      await db
        .insert(schema.arenaStakingPoints)
        .values({
          wallet,
          basePoints: 0,
          multiplier: currentMultiplier,
          totalPoints: 0,
          daysAccrued: 0,
          liquidGoldBalance: currentPosition.liquidGoldBalance.toString(),
          stakedGoldBalance: currentPosition.stakedGoldBalance.toString(),
          goldBalance: currentPosition.goldBalance.toString(),
          goldHoldDays: currentPosition.goldHoldDays,
          periodStartAt: currentDayStart,
          periodEndAt: currentDayStart,
          source: currentPosition.stakingSource,
        })
        .onConflictDoUpdate({
          target: [
            schema.arenaStakingPoints.wallet,
            schema.arenaStakingPoints.periodStartAt,
            schema.arenaStakingPoints.periodEndAt,
          ],
          set: {
            basePoints: 0,
            multiplier: currentMultiplier,
            totalPoints: 0,
            daysAccrued: 0,
            liquidGoldBalance: currentPosition.liquidGoldBalance.toString(),
            stakedGoldBalance: currentPosition.stakedGoldBalance.toString(),
            goldBalance: currentPosition.goldBalance.toString(),
            goldHoldDays: currentPosition.goldHoldDays,
            source: currentPosition.stakingSource,
          },
        });
    } catch (error: unknown) {
      this.logDbWriteError("accrue staking points", error);
    }
  }

  /**
   * Compute the GOLD multiplier from balance and hold duration.
   */
  private computeGoldMultiplier(goldBalance: number, holdDays: number): number {
    if (goldBalance < ArenaService.GOLD_TIER_0) {
      return 0;
    }

    let multiplier = 1;
    if (goldBalance >= ArenaService.GOLD_TIER_2) {
      multiplier = 3;
    } else if (goldBalance >= ArenaService.GOLD_TIER_1) {
      multiplier = 2;
    }
    if (
      goldBalance >= ArenaService.GOLD_TIER_1 &&
      holdDays >= ArenaService.GOLD_HOLD_DAYS_BONUS
    ) {
      multiplier += 1;
    }
    return multiplier;
  }

  // ============================================================================
  // Failed Award Queue
  // ============================================================================

  private async enqueueFailedAward(
    eventType: string,
    payload: Record<string, unknown>,
    error: unknown,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.insert(schema.arenaFailedAwards).values({
        eventType,
        payload,
        errorMessage:
          error instanceof Error ? error.message : String(error ?? "unknown"),
        nextAttemptAt: nowMs() + 30_000,
      });
    } catch (enqueueErr) {
      console.error(
        "[ArenaService] Failed to enqueue failed award:",
        enqueueErr,
      );
    }
  }

  private async processFailedAwards(): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    try {
      const now = nowMs();
      const jobs = await db
        .select()
        .from(schema.arenaFailedAwards)
        .where(
          and(
            sql`${schema.arenaFailedAwards.resolvedAt} IS NULL`,
            sql`${schema.arenaFailedAwards.nextAttemptAt} <= ${now}`,
            sql`${schema.arenaFailedAwards.attempts} < ${schema.arenaFailedAwards.maxAttempts}`,
          ),
        )
        .orderBy(asc(schema.arenaFailedAwards.nextAttemptAt))
        .limit(20);

      for (const job of jobs) {
        try {
          const payload = job.payload as Record<string, unknown>;
          if (job.eventType === "BET_PLACED") {
            await this.awardPoints(
              payload as Parameters<typeof this.awardPoints>[0],
            );
          } else if (job.eventType === "BET_WON") {
            await this.processWinPointsForRound(
              payload.roundId as string,
              payload.winnerSide as "A" | "B",
            );
          }
          await db
            .update(schema.arenaFailedAwards)
            .set({ resolvedAt: nowMs() })
            .where(eq(schema.arenaFailedAwards.id, job.id));
        } catch (retryErr) {
          const backoffMs = Math.min(
            300_000,
            30_000 * Math.pow(2, job.attempts),
          );
          await db
            .update(schema.arenaFailedAwards)
            .set({
              attempts: job.attempts + 1,
              nextAttemptAt: nowMs() + backoffMs,
              errorMessage:
                retryErr instanceof Error ? retryErr.message : String(retryErr),
            })
            .where(eq(schema.arenaFailedAwards.id, job.id));
        }
      }
    } catch (error) {
      this.logTableMissingError(error);
    }
  }

  // ============================================================================
  // Signup Bonus
  // ============================================================================

  private async awardSignupBonusReferee(
    wallet: string,
    inviteCode: string,
    inviterWallet: string,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const idempKey = `SIGNUP_REFEREE:${inviteCode}:${wallet}`;
    try {
      await db
        .insert(schema.arenaPointLedger)
        .values({
          wallet,
          eventType: "SIGNUP_REFEREE",
          basePoints: ArenaService.SIGNUP_BONUS_REFEREE,
          multiplier: 1,
          totalPoints: ArenaService.SIGNUP_BONUS_REFEREE,
          referenceType: "referral",
          referenceId: inviteCode,
          relatedWallet: inviterWallet,
          idempotencyKey: idempKey,
        })
        .onConflictDoNothing({
          target: [schema.arenaPointLedger.idempotencyKey],
        });

      const betId = `signup-referee:${inviteCode}:${wallet}`;
      await db
        .insert(schema.arenaPoints)
        .values({
          wallet,
          roundId: null,
          betId,
          basePoints: ArenaService.SIGNUP_BONUS_REFEREE,
          multiplier: 1,
          totalPoints: ArenaService.SIGNUP_BONUS_REFEREE,
          goldBalance: null,
          goldHoldDays: 0,
        })
        .onConflictDoNothing({ target: [schema.arenaPoints.betId] });
    } catch (error: unknown) {
      this.logDbWriteError("award signup bonus (referee)", error);
    }
  }

  private async awardSignupBonusReferrer(
    inviterWallet: string,
    invitedWallet: string,
    inviteCode: string,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const idempKey = `SIGNUP_REFERRER:${inviteCode}:${invitedWallet}`;
    try {
      await db
        .insert(schema.arenaPointLedger)
        .values({
          wallet: inviterWallet,
          eventType: "SIGNUP_REFERRER",
          status: "PENDING",
          basePoints: ArenaService.SIGNUP_BONUS_REFERRER,
          multiplier: 1,
          totalPoints: ArenaService.SIGNUP_BONUS_REFERRER,
          referenceType: "referral",
          referenceId: inviteCode,
          relatedWallet: invitedWallet,
          idempotencyKey: idempKey,
        })
        .onConflictDoNothing({
          target: [schema.arenaPointLedger.idempotencyKey],
        });
    } catch (error: unknown) {
      this.logDbWriteError("award signup bonus (referrer pending)", error);
    }
  }

  /**
   * Confirm a PENDING signup bonus for a referrer when the referee places
   * their first bet. Called after the awardPoints transaction completes.
   */
  private async confirmPendingSignupBonus(
    _tx: unknown,
    inviterWallet: string,
    invitedWallet: string,
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      const pending = await db
        .select()
        .from(schema.arenaPointLedger)
        .where(
          and(
            eq(schema.arenaPointLedger.wallet, inviterWallet),
            eq(schema.arenaPointLedger.eventType, "SIGNUP_REFERRER"),
            eq(schema.arenaPointLedger.status, "PENDING"),
            eq(schema.arenaPointLedger.relatedWallet, invitedWallet),
          ),
        )
        .limit(1);

      if (pending.length > 0) {
        const entry = pending[0]!;
        await db
          .update(schema.arenaPointLedger)
          .set({
            status: "CONFIRMED",
            confirmedAt: nowMs(),
          })
          .where(eq(schema.arenaPointLedger.id, entry.id));

        const betId = `signup-referrer:${entry.referenceId}:${invitedWallet}`;
        await db
          .insert(schema.arenaPoints)
          .values({
            wallet: inviterWallet,
            roundId: null,
            betId,
            basePoints: entry.basePoints,
            multiplier: 1,
            totalPoints: entry.totalPoints,
            goldBalance: null,
            goldHoldDays: 0,
          })
          .onConflictDoNothing({ target: [schema.arenaPoints.betId] });
      }
    } catch (error: unknown) {
      this.logDbWriteError("confirm signup bonus", error);
    }
  }

  // ============================================================================
  // Win Prediction Points
  // ============================================================================

  /**
   * Award bonus points to all bettors who predicted correctly,
   * plus referral win bonuses to their referrers.
   */
  private async awardWinPoints(round: LiveArenaRound): Promise<void> {
    if (!round.winnerId || !round.market?.winnerSide) return;
    try {
      await this.processWinPointsForRound(round.id, round.market.winnerSide);
    } catch (error: unknown) {
      this.logDbWriteError("award win points", error);
      await this.enqueueFailedAward(
        "BET_WON",
        { roundId: round.id, winnerSide: round.market.winnerSide },
        error,
      );
    }
  }

  private async processWinPointsForRound(
    roundId: string,
    winnerSide: "A" | "B",
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const winningBets = await db
      .select()
      .from(schema.arenaPoints)
      .where(
        and(
          eq(schema.arenaPoints.roundId, roundId),
          eq(schema.arenaPoints.side, winnerSide),
          gt(schema.arenaPoints.totalPoints, 0),
        ),
      );

    if (winningBets.length === 0) return;

    await db.transaction(async (tx) => {
      for (const bet of winningBets) {
        const winBonus = Math.round(
          bet.totalPoints * ArenaService.WIN_BONUS_MULTIPLIER,
        );
        if (winBonus <= 0) continue;

        const winKey = `BET_WON:${roundId}:${bet.wallet}:${bet.betId}`;
        await tx
          .insert(schema.arenaPointLedger)
          .values({
            wallet: bet.wallet,
            eventType: "BET_WON",
            basePoints: winBonus,
            multiplier: 1,
            totalPoints: winBonus,
            referenceType: "round",
            referenceId: roundId,
            idempotencyKey: winKey,
            metadata: {
              betId: bet.betId,
              originalPoints: bet.totalPoints,
              side: winnerSide,
            },
          })
          .onConflictDoNothing({
            target: [schema.arenaPointLedger.idempotencyKey],
          });

        const referral = await this.findReferralMappingForWalletNetwork(
          bet.wallet,
        );
        if (referral) {
          const refWinBonus = Math.max(
            1,
            Math.round(winBonus * ArenaService.REFERRAL_WIN_SHARE),
          );
          const refWinKey = `REFERRAL_WIN:${roundId}:${bet.wallet}:${referral.inviterWallet}`;
          await tx
            .insert(schema.arenaPointLedger)
            .values({
              wallet: referral.inviterWallet,
              eventType: "REFERRAL_WIN",
              basePoints: refWinBonus,
              multiplier: 1,
              totalPoints: refWinBonus,
              referenceType: "round",
              referenceId: roundId,
              relatedWallet: bet.wallet,
              idempotencyKey: refWinKey,
              metadata: {
                betId: bet.betId,
                bettorWinBonus: winBonus,
                inviteCode: referral.inviteCode,
              },
            })
            .onConflictDoNothing({
              target: [schema.arenaPointLedger.idempotencyKey],
            });
        }
      }
    });
  }

  // ============================================================================
  // Self-Referral Prevention
  // ============================================================================

  /**
   * Compute the referral point multiplier based on diminishing returns.
   * First 20: 100%, 21-50: 50%, 51+: 25%.
   */
  private async getReferralDiminishingFactor(
    inviterWallet: string,
  ): Promise<number> {
    const db = this.getDb();
    if (!db) return 1;
    try {
      const countRows = await db
        .select({ count: sql<number>`COUNT(*)`.as("count") })
        .from(schema.arenaInvitedWallets)
        .where(eq(schema.arenaInvitedWallets.inviterWallet, inviterWallet));
      const count = Number(countRows[0]?.count ?? 0);
      if (count <= 20) return 1;
      if (count <= 50) return 0.5;
      return 0.25;
    } catch {
      return 1;
    }
  }

  /**
   * Void expired PENDING signup bonuses (older than 30 days without a bet).
   * Called periodically from the tick loop.
   */
  private async voidExpiredPendingBonuses(): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      const expiryThreshold =
        nowMs() - ArenaService.SIGNUP_BONUS_PENDING_EXPIRY_MS;
      await db
        .update(schema.arenaPointLedger)
        .set({ status: "VOIDED" })
        .where(
          and(
            eq(schema.arenaPointLedger.eventType, "SIGNUP_REFERRER"),
            eq(schema.arenaPointLedger.status, "PENDING"),
            sql`${schema.arenaPointLedger.createdAt} < ${expiryThreshold}`,
          ),
        );
    } catch (error: unknown) {
      this.logTableMissingError(error);
    }
  }

  /**
   * Check if two wallets belong to the same identity via the linked wallet graph.
   * Returns true if they are the same identity (self-referral attempt).
   */
  private async areWalletsLinked(
    walletA: string,
    walletB: string,
  ): Promise<boolean> {
    if (walletA === walletB) return true;
    try {
      const linkedWallets = await this.listLinkedWallets(walletA);
      return linkedWallets.includes(walletB);
    } catch {
      return false;
    }
  }

  /**
   * Fetch wallet's GOLD balance via Solana RPC (getTokenAccountsByOwner).
   * Also estimates holding duration from the token account data.
   */
  private async fetchGoldBalanceAndHoldDays(
    wallet: string,
  ): Promise<{ balance: number; holdDays: number }> {
    try {
      const rpcUrl = this.solanaConfig.rpcUrl;
      const goldMint = this.solanaConfig.goldMint;

      // Use getTokenAccountsByOwner to find all GOLD token accounts
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [wallet, { mint: goldMint }, { encoding: "jsonParsed" }],
        }),
      });

      if (!response.ok) return { balance: 0, holdDays: 0 };

      const data = (await response.json()) as {
        result?: {
          value?: Array<{
            pubkey: string;
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: {
                      uiAmount: number;
                      amount: string;
                    };
                  };
                };
              };
            };
          }>;
        };
      };

      const accounts = data.result?.value ?? [];
      if (accounts.length === 0) return { balance: 0, holdDays: 0 };

      let totalBalance = 0;
      for (const account of accounts) {
        const uiAmount =
          account.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        totalBalance += uiAmount;
      }

      // Estimate hold days from the highest-balance token account.
      let holdDays = 0;
      try {
        const sortedAccounts = [...accounts].sort((a, b) => {
          const aAmount =
            a.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
          const bAmount =
            b.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
          return bAmount - aAmount;
        });
        const candidateAccount = sortedAccounts[0];

        if (candidateAccount) {
          let before: string | undefined;
          let oldestBlockTime: number | null = null;

          for (let page = 0; page < 20; page += 1) {
            const sigResponse = await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "getSignaturesForAddress",
                params: [
                  candidateAccount.pubkey,
                  before ? { limit: 1_000, before } : { limit: 1_000 },
                ],
              }),
            });

            if (!sigResponse.ok) break;

            const sigData = (await sigResponse.json()) as {
              result?: Array<{ signature?: string; blockTime?: number }>;
            };
            const signatures = sigData.result ?? [];
            if (signatures.length === 0) break;

            for (const signature of signatures) {
              if (
                typeof signature.blockTime === "number" &&
                Number.isFinite(signature.blockTime)
              ) {
                if (
                  oldestBlockTime === null ||
                  signature.blockTime < oldestBlockTime
                ) {
                  oldestBlockTime = signature.blockTime;
                }
              }
            }

            if (signatures.length < 1_000) break;
            before = signatures[signatures.length - 1]?.signature;
            if (!before) break;
          }

          if (oldestBlockTime) {
            const ageMs = Date.now() - oldestBlockTime * 1000;
            holdDays = Math.max(0, Math.floor(ageMs / ArenaService.ONE_DAY_MS));
          }
        }
      } catch {
        // Fall back to 0 hold days — don't fail award
      }

      return { balance: totalBalance, holdDays };
    } catch {
      return { balance: 0, holdDays: 0 };
    }
  }

  public async redeemInviteCode(params: {
    wallet: string;
    inviteCode: string;
  }): Promise<InviteRedemptionResult> {
    const db = this.getDb();
    if (!db) {
      throw new Error("Database unavailable");
    }

    const wallet = normalizeWallet(params.wallet);
    const inviteCode = normalizeInviteCode(params.inviteCode);

    const invite = await db.query.arenaInviteCodes.findFirst({
      where: eq(schema.arenaInviteCodes.code, inviteCode),
    });
    if (!invite) {
      throw new Error("Invite code not found");
    }
    if (await this.isSelfReferralIdentity(wallet, invite.inviterWallet)) {
      throw new Error("You cannot use your own invite code");
    }
    if (await this.areWalletsLinked(wallet, invite.inviterWallet)) {
      throw new Error("You cannot use an invite code from a linked wallet");
    }

    const existing = await this.findReferralMappingForWalletNetwork(wallet);
    if (existing && existing.inviteCode !== inviteCode) {
      throw new Error("Referral bindings are permanent and cannot be changed");
    }

    const oneDayAgo = nowMs() - ArenaService.ONE_DAY_MS;
    const recentReferrals = await db
      .select({ count: sql<number>`COUNT(*)`.as("count") })
      .from(schema.arenaInvitedWallets)
      .where(
        and(
          eq(schema.arenaInvitedWallets.inviterWallet, invite.inviterWallet),
          gt(schema.arenaInvitedWallets.createdAt, oneDayAgo),
        ),
      );
    if (
      Number(recentReferrals[0]?.count ?? 0) >=
      ArenaService.REFERRAL_VELOCITY_MAX_PER_DAY
    ) {
      throw new Error(
        "This referrer has reached the maximum referrals for today. Please try again later.",
      );
    }

    const direct = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });
    if (direct) {
      return {
        wallet,
        inviteCode: direct.inviteCode,
        inviterWallet: direct.inviterWallet,
        alreadyLinked: true,
        signupBonus: 0,
      };
    }

    await this.ensureWalletInviteMapping({
      wallet,
      inviteCode,
      inviterWallet: invite.inviterWallet,
      firstBetId: null,
    });

    await this.awardSignupBonusReferee(
      wallet,
      inviteCode,
      invite.inviterWallet,
    );
    await this.awardSignupBonusReferrer(
      invite.inviterWallet,
      wallet,
      inviteCode,
    );

    return {
      wallet,
      inviteCode,
      inviterWallet: invite.inviterWallet,
      alreadyLinked: false,
      signupBonus: ArenaService.SIGNUP_BONUS_REFEREE,
    };
  }

  private async awardFlatPoints(params: {
    wallet: string;
    points: number;
    betId: string;
    referral: { inviteCode: string; inviterWallet: string } | null;
  }): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const points = Math.max(0, Math.floor(params.points));
    if (points <= 0) return;

    try {
      await db.insert(schema.arenaPoints).values({
        wallet: params.wallet,
        roundId: null,
        betId: params.betId,
        basePoints: points,
        multiplier: 1,
        totalPoints: points,
        goldBalance: null,
        goldHoldDays: 0,
      });

      if (params.referral) {
        await db.insert(schema.arenaReferralPoints).values({
          roundId: null,
          betId: params.betId,
          inviteCode: params.referral.inviteCode,
          inviterWallet: params.referral.inviterWallet,
          invitedWallet: params.wallet,
          basePoints: points,
          multiplier: 1,
          totalPoints: points,
        });
      }
    } catch (error: unknown) {
      this.logDbWriteError("award flat points", error);
    }
  }

  public async linkWallets(params: {
    wallet: string;
    walletPlatform: ArenaFeeChain;
    linkedWallet: string;
    linkedWalletPlatform: ArenaFeeChain;
  }): Promise<WalletLinkResult> {
    const db = this.getDb();
    if (!db) {
      throw new Error("Database unavailable");
    }

    const walletPlatform = normalizeFeeChain(params.walletPlatform);
    const linkedWalletPlatform = normalizeFeeChain(params.linkedWalletPlatform);
    const wallet = normalizeWalletForChain(params.wallet, walletPlatform);
    const linkedWallet = normalizeWalletForChain(
      params.linkedWallet,
      linkedWalletPlatform,
    );

    if (wallet === linkedWallet) {
      throw new Error("Cannot link the same wallet");
    }
    if (
      walletChainFamily(walletPlatform) ===
      walletChainFamily(linkedWalletPlatform)
    ) {
      throw new Error("Wallet links only support EVM↔Solana connections");
    }

    const pairKey = walletLinkPairKey({
      leftWallet: wallet,
      leftPlatform: walletPlatform,
      rightWallet: linkedWallet,
      rightPlatform: linkedWalletPlatform,
    });

    const existingLink = await db.query.arenaWalletLinks.findFirst({
      where: eq(schema.arenaWalletLinks.pairKey, pairKey),
    });
    if (existingLink) {
      return {
        wallet,
        walletPlatform,
        linkedWallet,
        linkedWalletPlatform,
        alreadyLinked: true,
        awardedPoints: 0,
        propagatedInviteCode: null,
        inviterWallet: null,
      };
    }

    const leftReferral = await this.findReferralMappingForWalletNetwork(wallet);
    const rightReferral =
      await this.findReferralMappingForWalletNetwork(linkedWallet);

    if (
      leftReferral &&
      rightReferral &&
      leftReferral.inviteCode !== rightReferral.inviteCode
    ) {
      throw new Error(
        "Linked wallets are associated with different invite codes",
      );
    }

    const propagatedReferral = leftReferral ?? rightReferral;

    const inserted = await db
      .insert(schema.arenaWalletLinks)
      .values({
        walletA: wallet,
        walletAPlatform: walletPlatform,
        walletB: linkedWallet,
        walletBPlatform: linkedWalletPlatform,
        pairKey,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })
      .onConflictDoNothing({
        target: [schema.arenaWalletLinks.pairKey],
      })
      .returning({
        id: schema.arenaWalletLinks.id,
      });
    if (inserted.length === 0) {
      return {
        wallet,
        walletPlatform,
        linkedWallet,
        linkedWalletPlatform,
        alreadyLinked: true,
        awardedPoints: 0,
        propagatedInviteCode: null,
        inviterWallet: null,
      };
    }

    if (propagatedReferral) {
      await this.ensureWalletInviteMapping({
        wallet,
        inviteCode: propagatedReferral.inviteCode,
        inviterWallet: propagatedReferral.inviterWallet,
        firstBetId: propagatedReferral.firstBetId ?? null,
      });
      await this.ensureWalletInviteMapping({
        wallet: linkedWallet,
        inviteCode: propagatedReferral.inviteCode,
        inviterWallet: propagatedReferral.inviterWallet,
        firstBetId: propagatedReferral.firstBetId ?? null,
      });
    }

    let awardedPoints = ArenaService.WALLET_LINK_BONUS_POINTS;
    if (db.query?.arenaPoints?.findFirst) {
      try {
        const existingBonus = await db.query.arenaPoints.findFirst({
          where: and(
            eq(schema.arenaPoints.wallet, wallet),
            sql`${schema.arenaPoints.betId} LIKE 'wallet-link:%'`,
          ),
        });
        if (existingBonus) {
          awardedPoints = 0;
        }
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }
    }

    if (awardedPoints > 0) {
      const initiatorReferral =
        await this.findReferralMappingForWalletNetwork(wallet);
      const betId = `wallet-link:${pairKey}:${wallet}`;
      await this.awardFlatPoints({
        wallet,
        points: awardedPoints,
        betId,
        referral: initiatorReferral
          ? {
              inviteCode: initiatorReferral.inviteCode,
              inviterWallet: initiatorReferral.inviterWallet,
            }
          : null,
      });
    }

    return {
      wallet,
      walletPlatform,
      linkedWallet,
      linkedWalletPlatform,
      alreadyLinked: false,
      awardedPoints,
      propagatedInviteCode: propagatedReferral?.inviteCode ?? null,
      inviterWallet: propagatedReferral?.inviterWallet ?? null,
    };
  }

  public async getInviteSummary(
    walletRaw: string,
    platformRaw?: string | null,
  ): Promise<InviteSummary> {
    const wallet = normalizeWallet(walletRaw);
    const platformView = normalizeFeePlatform(platformRaw);
    const feeChains = feeChainsForPlatform(platformView);
    const db = this.getDb();

    if (!db) {
      return {
        wallet,
        platformView,
        inviteCode: this.buildInviteCode(wallet, 0),
        invitedWalletCount: 0,
        invitedWallets: [],
        invitedWalletsTruncated: false,
        pointsFromReferrals: 0,
        feeShareFromReferralsGold: "0",
        treasuryFeesFromReferredBetsGold: "0",
        referredByWallet: null,
        referredByCode: null,
        activeReferralCount: 0,
        pendingSignupBonuses: 0,
        totalReferralWinPoints: 0,
      };
    }

    const inviteCode = await this.getOrCreateInviteCode(wallet);

    const [links, invitedCountRows, referralPointRows, feeRows, referredBy] =
      await Promise.all([
        db.query.arenaInvitedWallets.findMany({
          where: eq(schema.arenaInvitedWallets.inviterWallet, wallet),
          orderBy: desc(schema.arenaInvitedWallets.createdAt),
          limit: 500,
        }),
        db
          .select({
            count: sql<number>`COUNT(*)`.as("count"),
          })
          .from(schema.arenaInvitedWallets)
          .where(eq(schema.arenaInvitedWallets.inviterWallet, wallet)),
        db
          .select({
            totalPoints:
              sql<number>`COALESCE(SUM(${schema.arenaReferralPoints.totalPoints}), 0)`.as(
                "totalPoints",
              ),
          })
          .from(schema.arenaReferralPoints)
          .where(eq(schema.arenaReferralPoints.inviterWallet, wallet)),
        db
          .select({
            inviterFeeGold:
              sql<string>`COALESCE(SUM((${schema.arenaFeeShares.inviterFeeGold})::numeric), 0)::text`.as(
                "inviterFeeGold",
              ),
            treasuryFeeGold:
              sql<string>`COALESCE(SUM((${schema.arenaFeeShares.treasuryFeeGold})::numeric), 0)::text`.as(
                "treasuryFeeGold",
              ),
          })
          .from(schema.arenaFeeShares)
          .where(
            and(
              eq(schema.arenaFeeShares.inviterWallet, wallet),
              inArray(schema.arenaFeeShares.chain, feeChains),
            ),
          ),
        this.findReferralMappingForWalletNetwork(wallet),
      ]);

    const invitedWalletCount = Number(invitedCountRows[0]?.count ?? 0);
    const pointsFromReferrals = Number(referralPointRows[0]?.totalPoints ?? 0);
    const feeShareFromReferralsGold = feeRows[0]?.inviterFeeGold ?? "0";
    const treasuryFeesFromReferredBetsGold = feeRows[0]?.treasuryFeeGold ?? "0";

    let activeReferralCount = 0;
    let pendingSignupBonuses = 0;
    let totalReferralWinPoints = 0;
    try {
      const activeRows = await db
        .select({
          count:
            sql<number>`COUNT(DISTINCT ${schema.arenaInvitedWallets.invitedWallet})`.as(
              "count",
            ),
        })
        .from(schema.arenaInvitedWallets)
        .where(
          and(
            eq(schema.arenaInvitedWallets.inviterWallet, wallet),
            sql`${schema.arenaInvitedWallets.firstBetId} IS NOT NULL`,
          ),
        );
      activeReferralCount = Number(activeRows[0]?.count ?? 0);

      const pendingRows = await db
        .select({
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(schema.arenaPointLedger)
        .where(
          and(
            eq(schema.arenaPointLedger.wallet, wallet),
            eq(schema.arenaPointLedger.eventType, "SIGNUP_REFERRER"),
            eq(schema.arenaPointLedger.status, "PENDING"),
          ),
        );
      pendingSignupBonuses = Number(pendingRows[0]?.count ?? 0);

      const winRefRows = await db
        .select({
          totalPoints:
            sql<number>`COALESCE(SUM(${schema.arenaPointLedger.totalPoints}), 0)`.as(
              "totalPoints",
            ),
        })
        .from(schema.arenaPointLedger)
        .where(
          and(
            eq(schema.arenaPointLedger.wallet, wallet),
            eq(schema.arenaPointLedger.eventType, "REFERRAL_WIN"),
            eq(schema.arenaPointLedger.status, "CONFIRMED"),
          ),
        );
      totalReferralWinPoints = Number(winRefRows[0]?.totalPoints ?? 0);
    } catch (error: unknown) {
      this.logTableMissingError(error);
    }

    return {
      wallet,
      platformView,
      inviteCode,
      invitedWalletCount,
      invitedWallets: links.map((row) => row.invitedWallet),
      invitedWalletsTruncated: invitedWalletCount > links.length,
      pointsFromReferrals,
      feeShareFromReferralsGold,
      treasuryFeesFromReferredBetsGold,
      referredByWallet: referredBy?.inviterWallet ?? null,
      referredByCode: referredBy?.inviteCode ?? null,
      activeReferralCount,
      pendingSignupBonuses,
      totalReferralWinPoints,
    };
  }

  /**
   * Get total accumulated points for a wallet.
   */
  public async getWalletPoints(
    walletRaw: string,
    options?: { scope?: "wallet" | "linked" },
  ): Promise<PointsEntry> {
    const wallet = normalizeWallet(walletRaw);
    const scope: PointsEntry["pointsScope"] =
      options?.scope === "linked" ? "LINKED" : "WALLET";

    let identityWallets = [wallet];
    if (scope === "LINKED") {
      try {
        const linkedWallets = await this.listLinkedWallets(wallet);
        const uniqueWallets = new Set<string>([wallet]);
        for (const linkedWallet of linkedWallets) {
          uniqueWallets.add(linkedWallet);
        }
        identityWallets = [...uniqueWallets].slice(0, 256);
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }
    }

    const buildDefaultEntry = (wallets: string[]): PointsEntry => ({
      wallet,
      pointsScope: scope,
      identityWalletCount: wallets.length,
      identityWallets: wallets,
      totalPoints: 0,
      selfPoints: 0,
      winPoints: 0,
      referralPoints: 0,
      stakingPoints: 0,
      multiplier: 0,
      goldBalance: null,
      liquidGoldBalance: null,
      stakedGoldBalance: null,
      goldHoldDays: 0,
      liquidGoldHoldDays: 0,
      stakedGoldHoldDays: 0,
      invitedWalletCount: 0,
      referredBy: null,
    });

    const db = this.getDb();
    if (!db) return buildDefaultEntry(identityWallets);

    try {
      const emptyPosition = {
        liquidGoldBalance: 0,
        stakedGoldBalance: 0,
        goldBalance: 0,
        liquidGoldHoldDays: 0,
        stakedGoldHoldDays: 0,
        goldHoldDays: 0,
        stakingSource: "NONE",
      };
      let position = emptyPosition;

      const solanaWallets = identityWallets.filter(isLikelySolanaWallet);
      if (solanaWallets.length > 0) {
        let liquidGoldBalance = 0;
        let stakedGoldBalance = 0;
        let liquidGoldHoldDays = 0;
        let stakedGoldHoldDays = 0;

        for (const candidateWallet of solanaWallets) {
          const candidatePosition =
            await this.fetchGoldPositionForWallet(candidateWallet);
          await this.accrueStakingPointsIfDue(
            candidateWallet,
            candidatePosition,
          );

          liquidGoldBalance += candidatePosition.liquidGoldBalance;
          stakedGoldBalance += candidatePosition.stakedGoldBalance;
          liquidGoldHoldDays = Math.max(
            liquidGoldHoldDays,
            candidatePosition.liquidGoldHoldDays,
          );
          stakedGoldHoldDays = Math.max(
            stakedGoldHoldDays,
            candidatePosition.stakedGoldHoldDays,
          );
        }

        position = {
          liquidGoldBalance,
          stakedGoldBalance,
          goldBalance: liquidGoldBalance + stakedGoldBalance,
          liquidGoldHoldDays,
          stakedGoldHoldDays,
          goldHoldDays: Math.max(liquidGoldHoldDays, stakedGoldHoldDays),
          stakingSource:
            solanaWallets.length > 1 ? "LINKED_AGGREGATE" : "PRIMARY",
        };
      }

      const selfWhere =
        identityWallets.length === 1
          ? eq(schema.arenaPoints.wallet, identityWallets[0]!)
          : inArray(schema.arenaPoints.wallet, identityWallets);
      const referralWhere =
        identityWallets.length === 1
          ? eq(schema.arenaReferralPoints.inviterWallet, identityWallets[0]!)
          : inArray(schema.arenaReferralPoints.inviterWallet, identityWallets);
      const invitedWhere =
        identityWallets.length === 1
          ? eq(schema.arenaInvitedWallets.inviterWallet, identityWallets[0]!)
          : inArray(schema.arenaInvitedWallets.inviterWallet, identityWallets);
      const stakingWhere =
        identityWallets.length === 1
          ? eq(schema.arenaStakingPoints.wallet, identityWallets[0]!)
          : inArray(schema.arenaStakingPoints.wallet, identityWallets);

      const selfRows = await db
        .select({
          totalPoints:
            sql<number>`COALESCE(SUM(${schema.arenaPoints.totalPoints}), 0)`.as(
              "totalPoints",
            ),
        })
        .from(schema.arenaPoints)
        .where(selfWhere);

      const referralRows = await db
        .select({
          totalPoints:
            sql<number>`COALESCE(SUM(${schema.arenaReferralPoints.totalPoints}), 0)`.as(
              "totalPoints",
            ),
        })
        .from(schema.arenaReferralPoints)
        .where(referralWhere);

      const invitedRows = await db
        .select({
          count:
            sql<number>`COUNT(DISTINCT ${schema.arenaInvitedWallets.invitedWallet})`.as(
              "count",
            ),
        })
        .from(schema.arenaInvitedWallets)
        .where(invitedWhere);

      const selfPoints = Number(selfRows[0]?.totalPoints ?? 0);
      const referralPoints = Number(referralRows[0]?.totalPoints ?? 0);
      let stakingPoints = 0;
      try {
        const stakingRows = await db
          .select({
            totalPoints:
              sql<number>`COALESCE(SUM(${schema.arenaStakingPoints.totalPoints}), 0)`.as(
                "totalPoints",
              ),
          })
          .from(schema.arenaStakingPoints)
          .where(stakingWhere);
        stakingPoints = Number(stakingRows[0]?.totalPoints ?? 0);
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }

      let winPoints = 0;
      try {
        const ledgerWhere =
          identityWallets.length === 1
            ? eq(schema.arenaPointLedger.wallet, identityWallets[0]!)
            : inArray(schema.arenaPointLedger.wallet, identityWallets);
        const winRows = await db
          .select({
            totalPoints:
              sql<number>`COALESCE(SUM(${schema.arenaPointLedger.totalPoints}), 0)`.as(
                "totalPoints",
              ),
          })
          .from(schema.arenaPointLedger)
          .where(
            and(
              ledgerWhere,
              eq(schema.arenaPointLedger.eventType, "BET_WON"),
              eq(schema.arenaPointLedger.status, "CONFIRMED"),
            ),
          );
        winPoints = Number(winRows[0]?.totalPoints ?? 0);
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }

      const totalPoints =
        selfPoints + winPoints + referralPoints + stakingPoints;
      const multiplier = this.computeGoldMultiplier(
        position.goldBalance,
        position.goldHoldDays,
      );

      let referredBy: PointsEntry["referredBy"] = null;
      try {
        const referralMapping =
          await this.findReferralMappingForWalletNetwork(wallet);
        if (referralMapping) {
          referredBy = {
            wallet: referralMapping.inviterWallet,
            code: referralMapping.inviteCode,
          };
        }
      } catch {
        // Non-critical
      }

      return {
        wallet,
        pointsScope: scope,
        identityWalletCount: identityWallets.length,
        identityWallets,
        totalPoints,
        selfPoints,
        winPoints,
        referralPoints,
        stakingPoints,
        multiplier,
        goldBalance: position.goldBalance.toString(),
        liquidGoldBalance: position.liquidGoldBalance.toString(),
        stakedGoldBalance: position.stakedGoldBalance.toString(),
        goldHoldDays: position.goldHoldDays,
        liquidGoldHoldDays: position.liquidGoldHoldDays,
        stakedGoldHoldDays: position.stakedGoldHoldDays,
        invitedWalletCount: Number(invitedRows[0]?.count ?? 0),
        referredBy,
      };
    } catch (error: unknown) {
      this.logTableMissingError(error);
      return buildDefaultEntry(identityWallets);
    }
  }

  /**
   * Get the points leaderboard (top wallets by total points).
   */
  public async getPointsLeaderboard(
    limit = 20,
    options?: {
      scope?: "wallet" | "linked";
      offset?: number;
      timeWindow?: "daily" | "weekly" | "monthly" | "alltime";
    },
  ): Promise<LeaderboardEntry[]> {
    const db = this.getDb();
    if (!db) return [];

    const scope = options?.scope === "linked" ? "LINKED" : "WALLET";
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const boundedOffset = Math.max(0, options?.offset ?? 0);
    const parsePoints = (value: unknown): number => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof value === "bigint") return Number(value);
      return 0;
    };

    const queryLeaderboard = (includeStaking: boolean, applyLimit: boolean) =>
      sql<{
        wallet: string;
        total_points: number | string | bigint;
      }>`
        WITH combined AS (
          SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points FROM "arena_points"
          UNION ALL
          SELECT "inviterWallet" AS wallet, ("totalPoints")::bigint AS points FROM "arena_referral_points"
          ${
            includeStaking
              ? sql`UNION ALL
                  SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points
                  FROM "arena_staking_points"`
              : sql``
          }
          UNION ALL
          SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points
          FROM "arena_point_ledger"
          WHERE "status" = 'CONFIRMED'
          AND "eventType" IN ('BET_WON', 'REFERRAL_WIN', 'SIGNUP_REFERRER', 'SIGNUP_REFEREE')
        )
        SELECT
          wallet,
          SUM(points)::bigint AS total_points
        FROM combined
        GROUP BY wallet
        ORDER BY total_points DESC, wallet ASC
        ${applyLimit ? sql`LIMIT ${boundedLimit}` : sql``}
      `;

    const fetchRows = async (
      includeStaking: boolean,
      applyLimit: boolean,
    ): Promise<
      Array<{ wallet: string; total_points: number | string | bigint }>
    > => {
      const result = await db.execute(
        queryLeaderboard(includeStaking, applyLimit),
      );
      return (result.rows ?? []) as Array<{
        wallet: string;
        total_points: number | string | bigint;
      }>;
    };

    if (scope === "LINKED") {
      let walletRows: Array<{
        wallet: string;
        total_points: number | string | bigint;
      }> = [];
      try {
        walletRows = await fetchRows(true, false);
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }
      if (walletRows.length === 0) {
        try {
          walletRows = await fetchRows(false, false);
        } catch (error: unknown) {
          this.logTableMissingError(error);
        }
      }
      if (walletRows.length === 0) return [];

      const parent = new Map<string, string>();
      const ensureWallet = (value: string): void => {
        if (!parent.has(value)) parent.set(value, value);
      };
      const findWallet = (value: string): string => {
        const currentParent = parent.get(value);
        if (!currentParent || currentParent === value) {
          parent.set(value, value);
          return value;
        }
        const root = findWallet(currentParent);
        parent.set(value, root);
        return root;
      };
      const unionWallets = (left: string, right: string): void => {
        const leftRoot = findWallet(left);
        const rightRoot = findWallet(right);
        if (leftRoot === rightRoot) return;
        if (leftRoot < rightRoot) {
          parent.set(rightRoot, leftRoot);
        } else {
          parent.set(leftRoot, rightRoot);
        }
      };

      for (const row of walletRows) {
        ensureWallet(row.wallet);
      }

      try {
        let cursorId = 0;
        while (true) {
          const linkRows = await db
            .select({
              id: schema.arenaWalletLinks.id,
              walletA: schema.arenaWalletLinks.walletA,
              walletB: schema.arenaWalletLinks.walletB,
            })
            .from(schema.arenaWalletLinks)
            .where(gt(schema.arenaWalletLinks.id, cursorId))
            .orderBy(asc(schema.arenaWalletLinks.id))
            .limit(5_000);

          if (linkRows.length === 0) break;

          for (const row of linkRows) {
            ensureWallet(row.walletA);
            ensureWallet(row.walletB);
            unionWallets(row.walletA, row.walletB);
          }

          cursorId = linkRows[linkRows.length - 1]?.id ?? cursorId;
          if (linkRows.length < 5_000) break;
        }
      } catch (error: unknown) {
        this.logTableMissingError(error);
      }

      const groupTotals = new Map<string, number>();
      const groupWallets = new Map<string, Set<string>>();
      for (const row of walletRows) {
        const root = findWallet(row.wallet);
        const points = parsePoints(row.total_points);
        groupTotals.set(root, (groupTotals.get(root) ?? 0) + points);
        const wallets = groupWallets.get(root) ?? new Set<string>();
        wallets.add(row.wallet);
        groupWallets.set(root, wallets);
      }

      const collapsed = [...groupTotals.entries()]
        .map(([root, totalPoints]) => {
          const wallets = [
            ...(groupWallets.get(root) ?? new Set([root])),
          ].sort();
          return {
            wallet: wallets[0] ?? root,
            totalPoints,
          };
        })
        .sort(
          (a, b) =>
            b.totalPoints - a.totalPoints || a.wallet.localeCompare(b.wallet),
        )
        .slice(boundedOffset, boundedOffset + boundedLimit);

      return collapsed.map((row, index) => ({
        rank: boundedOffset + index + 1,
        wallet: row.wallet,
        totalPoints: row.totalPoints,
      }));
    }

    try {
      const rows = await fetchRows(true, true);
      return rows.map((row, index) => ({
        rank: boundedOffset + index + 1,
        wallet: row.wallet,
        totalPoints: parsePoints(row.total_points),
      }));
    } catch (error: unknown) {
      this.logTableMissingError(error);
    }

    try {
      const rows = await fetchRows(false, true);
      return rows.map((row, index) => ({
        rank: boundedOffset + index + 1,
        wallet: row.wallet,
        totalPoints: parsePoints(row.total_points),
      }));
    } catch (error: unknown) {
      this.logTableMissingError(error);
    }

    return [];
  }

  /**
   * Get a specific wallet's rank on the leaderboard.
   */
  public async getWalletRank(
    walletRaw: string,
  ): Promise<{ wallet: string; rank: number; totalPoints: number }> {
    const wallet = normalizeWallet(walletRaw);
    const db = this.getDb();
    if (!db) return { wallet, rank: 0, totalPoints: 0 };

    try {
      const result = await db.execute(
        sql`
          WITH combined AS (
            SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points FROM "arena_points"
            UNION ALL
            SELECT "inviterWallet" AS wallet, ("totalPoints")::bigint AS points FROM "arena_referral_points"
            UNION ALL
            SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points FROM "arena_staking_points"
            UNION ALL
            SELECT "wallet" AS wallet, ("totalPoints")::bigint AS points
            FROM "arena_point_ledger"
            WHERE "status" = 'CONFIRMED'
            AND "eventType" IN ('BET_WON', 'REFERRAL_WIN', 'SIGNUP_REFERRER', 'SIGNUP_REFEREE')
          ),
          totals AS (
            SELECT wallet, SUM(points)::bigint AS total_points
            FROM combined
            GROUP BY wallet
          ),
          ranked AS (
            SELECT wallet, total_points,
              ROW_NUMBER() OVER (ORDER BY total_points DESC, wallet ASC) AS rank
            FROM totals
          )
          SELECT wallet, total_points, rank
          FROM ranked
          WHERE wallet = ${wallet}
          LIMIT 1
        `,
      );
      const row = (result.rows ?? [])[0] as
        | {
            wallet: string;
            total_points: number | string | bigint;
            rank: number | string | bigint;
          }
        | undefined;
      if (!row) return { wallet, rank: 0, totalPoints: 0 };
      return {
        wallet,
        rank: Number(row.rank),
        totalPoints: Number(row.total_points),
      };
    } catch (error: unknown) {
      this.logTableMissingError(error);
      return { wallet, rank: 0, totalPoints: 0 };
    }
  }

  /**
   * Get point mutation history for a wallet from the ledger.
   */
  public async getPointsHistory(
    walletRaw: string,
    options?: { limit?: number; offset?: number; eventType?: string },
  ): Promise<{
    entries: Array<{
      id: number;
      eventType: string;
      status: string;
      totalPoints: number;
      referenceType: string | null;
      referenceId: string | null;
      relatedWallet: string | null;
      createdAt: number;
    }>;
    total: number;
  }> {
    const wallet = normalizeWallet(walletRaw);
    const db = this.getDb();
    if (!db) return { entries: [], total: 0 };

    const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      const conditions = [eq(schema.arenaPointLedger.wallet, wallet)];
      if (options?.eventType) {
        conditions.push(
          eq(schema.arenaPointLedger.eventType, options.eventType),
        );
      }
      const where = and(...conditions);

      const [rows, countRows] = await Promise.all([
        db
          .select({
            id: schema.arenaPointLedger.id,
            eventType: schema.arenaPointLedger.eventType,
            status: schema.arenaPointLedger.status,
            totalPoints: schema.arenaPointLedger.totalPoints,
            referenceType: schema.arenaPointLedger.referenceType,
            referenceId: schema.arenaPointLedger.referenceId,
            relatedWallet: schema.arenaPointLedger.relatedWallet,
            createdAt: schema.arenaPointLedger.createdAt,
          })
          .from(schema.arenaPointLedger)
          .where(where)
          .orderBy(desc(schema.arenaPointLedger.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)`.as("count") })
          .from(schema.arenaPointLedger)
          .where(where),
      ]);

      return {
        entries: rows,
        total: Number(countRows[0]?.count ?? 0),
      };
    } catch (error: unknown) {
      this.logTableMissingError(error);
      return { entries: [], total: 0 };
    }
  }

  /**
   * Get the GOLD multiplier info for a wallet (live on-chain check).
   */
  public async getWalletGoldMultiplier(
    wallet: string,
  ): Promise<GoldMultiplierInfo> {
    const position = await this.fetchGoldPositionForWallet(wallet);
    const multiplier = this.computeGoldMultiplier(
      position.goldBalance,
      position.goldHoldDays,
    );

    let tier: GoldMultiplierInfo["tier"] = "NONE";
    let nextTierThreshold: number | null = ArenaService.GOLD_TIER_0;

    if (position.goldBalance >= ArenaService.GOLD_TIER_2) {
      tier =
        position.goldHoldDays >= ArenaService.GOLD_HOLD_DAYS_BONUS
          ? "DIAMOND"
          : "GOLD";
      nextTierThreshold = null;
    } else if (position.goldBalance >= ArenaService.GOLD_TIER_1) {
      tier = "SILVER";
      nextTierThreshold = ArenaService.GOLD_TIER_2;
    } else if (position.goldBalance >= ArenaService.GOLD_TIER_0) {
      tier = "BRONZE";
      nextTierThreshold = ArenaService.GOLD_TIER_1;
    }

    return {
      wallet,
      goldBalance: position.goldBalance.toString(),
      liquidGoldBalance: position.liquidGoldBalance.toString(),
      stakedGoldBalance: position.stakedGoldBalance.toString(),
      goldHoldDays: position.goldHoldDays,
      liquidGoldHoldDays: position.liquidGoldHoldDays,
      stakedGoldHoldDays: position.stakedGoldHoldDays,
      multiplier,
      tier,
      nextTierThreshold,
    };
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
