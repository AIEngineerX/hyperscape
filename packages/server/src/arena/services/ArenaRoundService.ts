import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../database/schema.js";
import type { ArenaContext } from "../ArenaContext.js";
import {
  nowMs,
  randomId,
  sha256Hex,
  buildRoundSeedHex,
  computePowerScore,
  pickRandom,
  coerceArenaPhase,
  coerceArenaWinReason,
  addDecimalAmounts,
  MAX_HISTORY,
} from "../arena-utils.js";
import type {
  ArenaPhase,
  ArenaRoundSnapshot,
  ArenaMarketSnapshot,
  ArenaSide,
  ArenaWinReason,
  LiveArenaRound,
  WhitelistedAgentCandidate,
} from "../types.js";

// ---------------------------------------------------------------------------
// Dependency interfaces for cross-service calls
// ---------------------------------------------------------------------------

interface PayoutOps {
  queuePayoutJobs(roundId: string, winnerSide: ArenaSide): Promise<void>;
}

interface PointsOps {
  awardWinPoints(round: LiveArenaRound): Promise<void>;
}

// ---------------------------------------------------------------------------
// ArenaRoundService - owns round lifecycle, state, and persistence
// ---------------------------------------------------------------------------

export class ArenaRoundService {
  private readonly ctx: ArenaContext;

  /** The currently active round (null between rounds). */
  public currentRound: LiveArenaRound | null = null;

  /** Recently completed rounds, newest first. */
  public history: LiveArenaRound[] = [];

  private payoutOps: PayoutOps | null = null;
  private pointsOps: PointsOps | null = null;

  constructor(ctx: ArenaContext) {
    this.ctx = ctx;
  }

  /**
   * Wire cross-service dependencies that are not yet available at
   * construction time due to init order.
   */
  public setDeps(payoutOps: PayoutOps, pointsOps: PointsOps): void {
    this.payoutOps = payoutOps;
    this.pointsOps = pointsOps;
  }

  // =========================================================================
  // Round state methods (public)
  // =========================================================================

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

  public async hydrateRecentRounds(limit = 20): Promise<void> {
    const db = this.ctx.getDb();
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
      this.ctx.logTableMissingError(error);
    }
  }

  // =========================================================================
  // Event handlers (public - registered/unregistered by facade)
  // =========================================================================

  public readonly onDuelCompleted = (payload: unknown): void => {
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
      nowMs() + this.ctx.config.resultShowDurationMs;
    this.touchRound();
    void this.persistRound();
    void this.persistRoundEvent("DUEL_COMPLETED", {
      duelId: event.duelId,
      winnerId: event.winnerId,
      loserId: event.loserId ?? null,
      winReason: this.currentRound.winReason,
    });
  };

  public readonly onEntityDamaged = (payload: unknown): void => {
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

  // =========================================================================
  // Round lifecycle methods (public - called by facade tick loop)
  // =========================================================================

  public async maybeCreateRound(): Promise<void> {
    const agents = await this.getEligibleAgents();
    if (agents.length < this.ctx.config.minWhitelistedAgents) {
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
    const bettingOpensAt = created + this.ctx.config.previewDurationMs;
    const bettingClosesAt =
      bettingOpensAt + this.ctx.config.bettingOpenDurationMs;
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

    if (this.ctx.solanaOperator?.isEnabled()) {
      try {
        const initResult = await this.ctx.solanaOperator.initRound(
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

  public async startRoundDuel(): Promise<void> {
    const round = this.currentRound;
    if (!round) return;

    if (round.market && round.market.status === "BETTING") {
      round.market.status = "LOCKED";
      this.touchRound();
      await this.persistRound();
      await this.persistMarket();
    }

    if (this.ctx.solanaOperator?.isEnabled()) {
      try {
        const lockSignature = await this.ctx.solanaOperator.lockMarket(
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

    const duelSystem = this.ctx.getDuelSystem();
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

  public async resolveTimeoutDuel(): Promise<void> {
    const round = this.currentRound;
    if (!round || !round.duelId) return;
    if (round.winnerId) return;

    const winnerId = this.pickTimeoutWinner(round);
    const loserId =
      winnerId === round.agentAId ? round.agentBId : round.agentAId;
    round.winnerId = winnerId;
    round.winReason = "TIME_DAMAGE";

    const duelSystem = this.ctx.getDuelSystem();
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
    const resultShowDeadline = nowMs() + this.ctx.config.resultShowDurationMs;
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

  public async publishOracleOutcome(): Promise<void> {
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

  public async resolveMarketSnapshot(): Promise<void> {
    const round = this.currentRound;
    if (!round?.market || !round.winnerId) return;

    const winnerSide: ArenaSide = round.winnerId === round.agentAId ? "A" : "B";
    let reportSignature: string | null = null;
    let resolveSignature: string | null = null;
    if (this.ctx.solanaOperator?.isEnabled() && round.resultHash) {
      try {
        const result = await this.ctx.solanaOperator.reportAndResolve({
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
      this.ctx.solanaOperator?.isEnabled() && !resolveSignature
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

    await this.payoutOps!.queuePayoutJobs(round.id, winnerSide);

    void this.pointsOps!.awardWinPoints(round);
  }

  public async finishCurrentRound(): Promise<void> {
    if (!this.currentRound) return;
    const round = this.currentRound;
    round.phase = "COMPLETE";
    this.touchRound();
    await this.persistRound();

    const cooldownUntil = nowMs() + this.ctx.config.participantCooldownMs;
    await this.applyParticipantCooldown(round.agentAId, cooldownUntil);
    await this.applyParticipantCooldown(round.agentBId, cooldownUntil);

    this.history.unshift(this.cloneRound(round) as LiveArenaRound);
    this.history = this.history.slice(0, MAX_HISTORY);
    this.currentRound = null;
  }

  public async moveToPhase(nextPhase: ArenaPhase): Promise<void> {
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

  public async setRoundPhaseDeadline(phaseDeadlineMs: number): Promise<void> {
    if (!this.currentRound) return;
    this.currentRound.phaseDeadlineMs = phaseDeadlineMs;
    this.touchRound();
    await this.persistRound();
  }

  // =========================================================================
  // Called by betting service to update pool amounts
  // =========================================================================

  public async updateCurrentRoundPool(
    roundId: string,
    side: "A" | "B",
    goldAmount: string,
  ): Promise<void> {
    if (this.currentRound?.id === roundId && this.currentRound.market) {
      if (side === "A") {
        this.currentRound.market.poolA = addDecimalAmounts(
          this.currentRound.market.poolA,
          goldAmount,
          6,
        );
      } else {
        this.currentRound.market.poolB = addDecimalAmounts(
          this.currentRound.market.poolB,
          goldAmount,
          6,
        );
      }
      this.touchRound();
      await this.persistRound();
      await this.persistMarket();
    }
  }

  // =========================================================================
  // Persistence methods (public - used by betting service)
  // =========================================================================

  public async persistRound(): Promise<void> {
    const round = this.currentRound;
    if (!round) return;
    const db = this.ctx.getDb();
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
      this.ctx.logDbWriteError("persist round", error);
    }
  }

  public async persistMarket(): Promise<void> {
    const round = this.currentRound;
    if (!round?.market) return;
    const db = this.ctx.getDb();
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
      this.ctx.logDbWriteError("persist market", error);
    }
  }

  public async persistRoundEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const round = this.currentRound;
    if (!round) return;
    const db = this.ctx.getDb();
    if (!db) return;
    try {
      await db.insert(schema.arenaRoundEvents).values({
        roundId: round.id,
        eventType,
        payload,
      });
    } catch (error) {
      this.ctx.logDbWriteError("persist round event", error);
    }
  }

  // =========================================================================
  // Internal methods (private)
  // =========================================================================

  private createInitialMarket(
    roundId: string,
    roundSeedHex: string,
  ): ArenaMarketSnapshot {
    const derived = this.ctx.solanaOperator?.deriveRoundAddresses(roundSeedHex);
    return {
      roundId,
      roundSeedHex,
      programId:
        this.ctx.solanaOperator?.getProgramId() ??
        this.ctx.solanaConfig.marketProgramId,
      mint: this.ctx.solanaConfig.goldMint,
      tokenProgram: this.ctx.solanaConfig.goldTokenProgramId,
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
      feeBps: this.ctx.solanaConfig.feeBps,
    };
  }

  private async getEligibleAgents(): Promise<WhitelistedAgentCandidate[]> {
    const db = this.ctx.getDb();
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

      const activePlayers = this.ctx.world.entities.players;
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
      this.ctx.logTableMissingError(error);
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

  private pickTimeoutWinner(round: LiveArenaRound): string {
    if (round.damageA > round.damageB) return round.agentAId;
    if (round.damageB > round.damageA) return round.agentBId;
    return Math.random() < 0.5 ? round.agentAId : round.agentBId;
  }

  private async getCharacterNameAndCombat(characterId: string): Promise<{
    name: string;
    combatLevel: number;
  }> {
    const player = this.ctx.world.entities.players?.get(characterId) as
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
    const db = this.ctx.getDb();
    if (!db) return;
    try {
      await db
        .update(schema.arenaAgentWhitelist)
        .set({ cooldownUntil, updatedAt: nowMs() })
        .where(eq(schema.arenaAgentWhitelist.characterId, characterId));
    } catch (error) {
      this.ctx.logDbWriteError("apply cooldown", error);
    }
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
}
