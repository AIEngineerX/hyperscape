/**
 * DuelBettingBridge - Connects duel results to Solana prediction markets
 *
 * This bridge listens to DuelScheduler events and:
 * 1. Creates oracle rounds and markets when duels are scheduled
 * 2. Reports outcomes when duels complete
 * 3. Tracks betting statistics
 *
 * Integration with Solana Prediction Market:
 * - Uses SolanaArenaOperator for blockchain operations
 * - Agent 1 = Side A, Agent 2 = Side B
 * - Winner's side receives the pool
 *
 * Enable via DUEL_BETTING_ENABLED=true environment variable
 */

import type { World } from "@hyperscape/shared";
import { createHash } from "node:crypto";
import { Logger } from "../ServerNetwork/services";

// ============================================================================
// Configuration
// ============================================================================

const config = {
  /** Whether duel betting is enabled */
  enabled: process.env.DUEL_BETTING_ENABLED === "true",

  /** Betting window duration after duel is scheduled (ms) */
  bettingWindowMs: parseInt(process.env.DUEL_BETTING_WINDOW_MS || "30000", 10),

  /** Base URL for duel metadata */
  metadataBaseUrl:
    process.env.DUEL_METADATA_BASE_URL || "https://hyperscape.game/api/duels",
};

// ============================================================================
// Types
// ============================================================================

interface DuelMarket {
  duelId: string;
  roundSeedHex: string;
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  createdAt: number;
  bettingClosesAt: number;
  status: "betting" | "locked" | "resolved";
  winnerId?: string;
  winnerSide?: "A" | "B";
}

interface SolanaArenaOperatorInterface {
  isEnabled(): boolean;
  initRound(
    roundSeedHex: string,
    bettingClosesAtMs: number,
  ): Promise<{
    closeSlot: number;
    initOracleSignature: string | null;
    initMarketSignature: string | null;
  } | null>;
  lockMarket(roundSeedHex: string): Promise<string | null>;
  reportAndResolve(params: {
    roundSeedHex: string;
    winnerSide: "A" | "B";
    resultHashHex: string;
    metadataUri: string;
  }): Promise<{
    reportSignature: string | null;
    resolveSignature: string | null;
  } | null>;
}

// ============================================================================
// DuelBettingBridge Class
// ============================================================================

export class DuelBettingBridge {
  private readonly world: World;
  private solanaOperator: SolanaArenaOperatorInterface | null = null;

  /** Active duel markets */
  private activeMarkets: Map<string, DuelMarket> = new Map();

  /** Historical markets for stats */
  private marketHistory: DuelMarket[] = [];

  /** Registered event listeners */
  private readonly eventListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Initialize the betting bridge
   */
  async init(): Promise<void> {
    if (!config.enabled) {
      Logger.info("DuelBettingBridge", "Duel betting is disabled");
      return;
    }

    // Try to get the Solana operator from the world
    this.solanaOperator =
      (
        this.world as unknown as {
          solanaArenaOperator?: SolanaArenaOperatorInterface;
        }
      ).solanaArenaOperator ?? null;

    if (!this.solanaOperator || !this.solanaOperator.isEnabled()) {
      Logger.warn(
        "DuelBettingBridge",
        "SolanaArenaOperator not available or not enabled - betting will be tracked locally only",
      );
    }

    Logger.info("DuelBettingBridge", "Initializing duel betting bridge", {
      bettingWindowMs: config.bettingWindowMs,
      solanaEnabled: this.solanaOperator?.isEnabled() ?? false,
    });

    // Listen for duel scheduled events
    const onDuelScheduled = (payload: unknown) => {
      this.handleDuelScheduled(payload);
    };
    this.world.on("duel:scheduled", onDuelScheduled);
    this.eventListeners.push({
      event: "duel:scheduled",
      fn: onDuelScheduled,
    });

    // Listen for duel result events
    const onDuelResult = (payload: unknown) => {
      this.handleDuelResult(payload);
    };
    this.world.on("duel:result", onDuelResult);
    this.eventListeners.push({
      event: "duel:result",
      fn: onDuelResult,
    });

    // Also listen to direct duel completion events
    const onDuelCompleted = (payload: unknown) => {
      this.handleDuelResult(payload);
    };
    this.world.on("duel:completed", onDuelCompleted);
    this.eventListeners.push({
      event: "duel:completed",
      fn: onDuelCompleted,
    });

    Logger.info("DuelBettingBridge", "Duel betting bridge initialized");
  }

  /**
   * Destroy the bridge and clean up
   */
  destroy(): void {
    for (const { event, fn } of this.eventListeners) {
      this.world.off(event, fn);
    }
    this.eventListeners.length = 0;
    Logger.info("DuelBettingBridge", "Duel betting bridge destroyed");
  }

  /**
   * Get active markets
   */
  getActiveMarkets(): DuelMarket[] {
    return Array.from(this.activeMarkets.values());
  }

  /**
   * Get market history
   */
  getMarketHistory(): DuelMarket[] {
    return [...this.marketHistory];
  }

  /**
   * Get market by duel ID
   */
  getMarket(duelId: string): DuelMarket | null {
    return this.activeMarkets.get(duelId) ?? null;
  }

  /**
   * Handle duel scheduled event - create betting market
   */
  private async handleDuelScheduled(payload: unknown): Promise<void> {
    const data = payload as {
      duelId?: string;
      agent1Id?: string;
      agent2Id?: string;
      agent1Name?: string;
      agent2Name?: string;
      startTime?: number;
    };

    if (!data.duelId || !data.agent1Id || !data.agent2Id) {
      Logger.warn("DuelBettingBridge", "Invalid duel:scheduled payload", data);
      return;
    }

    // Generate round seed from duel ID
    const roundSeedHex = this.generateRoundSeed(data.duelId);
    const bettingClosesAt = Date.now() + config.bettingWindowMs;

    const market: DuelMarket = {
      duelId: data.duelId,
      roundSeedHex,
      agent1Id: data.agent1Id,
      agent2Id: data.agent2Id,
      agent1Name: data.agent1Name || data.agent1Id,
      agent2Name: data.agent2Name || data.agent2Id,
      createdAt: Date.now(),
      bettingClosesAt,
      status: "betting",
    };

    this.activeMarkets.set(data.duelId, market);

    Logger.info("DuelBettingBridge", "Creating betting market for duel", {
      duelId: data.duelId,
      agent1: market.agent1Name,
      agent2: market.agent2Name,
      roundSeedHex,
      bettingClosesAt: new Date(bettingClosesAt).toISOString(),
    });

    // Create on-chain market if Solana operator is available
    if (this.solanaOperator?.isEnabled()) {
      try {
        const result = await this.solanaOperator.initRound(
          roundSeedHex,
          bettingClosesAt,
        );

        if (result) {
          Logger.info("DuelBettingBridge", "On-chain market created", {
            duelId: data.duelId,
            closeSlot: result.closeSlot,
            oracleSig: result.initOracleSignature,
            marketSig: result.initMarketSignature,
          });
        }
      } catch (error) {
        Logger.error(
          "DuelBettingBridge",
          "Failed to create on-chain market",
          error instanceof Error ? error : null,
          { duelId: data.duelId },
        );
      }
    }

    // Emit market created event for UI
    this.world.emit("betting:market:created", {
      duelId: data.duelId,
      market,
    });

    // Schedule market lock when betting window closes
    setTimeout(() => {
      this.lockMarket(data.duelId!);
    }, config.bettingWindowMs);
  }

  /**
   * Lock the betting market
   */
  private async lockMarket(duelId: string): Promise<void> {
    const market = this.activeMarkets.get(duelId);
    if (!market || market.status !== "betting") {
      return;
    }

    market.status = "locked";
    Logger.info("DuelBettingBridge", "Locking betting market", {
      duelId,
    });

    // Lock on-chain market
    if (this.solanaOperator?.isEnabled()) {
      try {
        const sig = await this.solanaOperator.lockMarket(market.roundSeedHex);
        if (sig) {
          Logger.info("DuelBettingBridge", "On-chain market locked", {
            duelId,
            signature: sig,
          });
        }
      } catch (error) {
        Logger.error(
          "DuelBettingBridge",
          "Failed to lock on-chain market",
          error instanceof Error ? error : null,
          { duelId },
        );
      }
    }

    // Emit market locked event for UI
    this.world.emit("betting:market:locked", {
      duelId,
      market,
    });
  }

  /**
   * Handle duel result event - resolve betting market
   */
  private async handleDuelResult(payload: unknown): Promise<void> {
    const data = payload as {
      duelId?: string;
      winnerId?: string;
      loserId?: string;
      winnerName?: string;
      loserName?: string;
      duration?: number;
    };

    if (!data.winnerId || !data.loserId) {
      return;
    }

    // Find the market by matching winner/loser to agents
    let market: DuelMarket | null = null;

    for (const m of this.activeMarkets.values()) {
      if (
        (m.agent1Id === data.winnerId && m.agent2Id === data.loserId) ||
        (m.agent1Id === data.loserId && m.agent2Id === data.winnerId)
      ) {
        market = m;
        break;
      }
    }

    if (!market) {
      // No market for this duel - might be a non-scheduled duel
      return;
    }

    // Determine winner side (A = agent1, B = agent2)
    const winnerSide: "A" | "B" = data.winnerId === market.agent1Id ? "A" : "B";

    market.status = "resolved";
    market.winnerId = data.winnerId;
    market.winnerSide = winnerSide;

    Logger.info(
      "DuelBettingBridge",
      "Resolving betting market in 15s (stream delay sync)",
      {
        duelId: market.duelId,
        winnerId: data.winnerId,
        winnerSide,
        winnerName: data.winnerName,
      },
    );

    // Move to history immediately to prevent duplicate triggers
    this.marketHistory.push({ ...market });
    this.activeMarkets.delete(market.duelId);

    // Keep history limited
    if (this.marketHistory.length > 100) {
      this.marketHistory.shift();
    }

    // Delay on-chain posting and public websocket event by 15.5 seconds to sync with YouTube stream
    setTimeout(async () => {
      // Report and resolve on-chain
      if (this.solanaOperator?.isEnabled()) {
        try {
          // Generate result hash from duel outcome
          const resultHashHex = this.generateResultHash(
            market!.duelId,
            data.winnerId!,
            data.loserId!,
          );

          const metadataUri = `${config.metadataBaseUrl}/${market!.duelId}`;

          const result = await this.solanaOperator.reportAndResolve({
            roundSeedHex: market!.roundSeedHex,
            winnerSide,
            resultHashHex,
            metadataUri,
          });

          if (result) {
            Logger.info("DuelBettingBridge", "On-chain market resolved", {
              duelId: market!.duelId,
              reportSig: result.reportSignature,
              resolveSig: result.resolveSignature,
            });
          }
        } catch (error) {
          Logger.error(
            "DuelBettingBridge",
            "Failed to resolve on-chain market",
            error instanceof Error ? error : null,
            { duelId: market!.duelId },
          );
        }
      }

      // Emit market resolved event for UI
      this.world.emit("betting:market:resolved", {
        duelId: market!.duelId,
        market,
        winnerId: data.winnerId,
        winnerSide,
        winnerName: data.winnerName,
        loserName: data.loserName,
        duration: data.duration,
      });
    }, 15000);
  }

  /**
   * Generate a 32-byte round seed from duel ID
   */
  private generateRoundSeed(duelId: string): string {
    const hash = createHash("sha256")
      .update(`hyperscape:duel:${duelId}`)
      .digest();
    return hash.toString("hex");
  }

  /**
   * Generate result hash for on-chain verification
   */
  private generateResultHash(
    duelId: string,
    winnerId: string,
    loserId: string,
  ): string {
    const hash = createHash("sha256")
      .update(`hyperscape:result:${duelId}:${winnerId}:${loserId}`)
      .digest();
    return hash.toString("hex");
  }
}

export default DuelBettingBridge;
