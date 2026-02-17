/**
 * DuelMatchmaker - Orchestrates continuous agent-vs-agent duels
 *
 * Manages a pool of DuelBots and pairs them for matches:
 * - Spawns and manages bot connections
 * - Pairs idle bots for duels
 * - Tracks match history and statistics
 * - Emits events for betting/spectator integration
 * - Runs continuously until stopped
 */

import { EventEmitter } from "events";
import { DuelBot, type DuelBotConfig, type DuelBotMetrics } from "./DuelBot";

export type DuelMatchmakerConfig = {
  wsUrl: string;
  /** Number of dueling bots to spawn */
  botCount: number;
  /** Delay between bot connections during startup (ms) */
  rampUpDelayMs?: number;
  /** Connection timeout per bot (ms) */
  connectTimeoutMs?: number;
  /** Bot name prefix */
  namePrefix?: string;
  /** Delay between scheduling new matches (ms) */
  matchIntervalMs?: number;
  /** Countdown time before fight starts (ms) */
  countdownMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
};

export type MatchResult = {
  matchId: string;
  bot1Name: string;
  bot2Name: string;
  bot1Id: string;
  bot2Id: string;
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type MatchmakerStats = {
  totalBots: number;
  connectedBots: number;
  idleBots: number;
  duelsInProgress: number;
  totalMatchesCompleted: number;
  matchHistory: MatchResult[];
  botStats: Map<string, DuelBotMetrics>;
  uptime: number;
};

type ActiveMatch = {
  matchId: string;
  bot1: DuelBot;
  bot2: DuelBot;
  startedAt: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DuelMatchmaker extends EventEmitter {
  private config: Required<DuelMatchmakerConfig>;
  private bots: DuelBot[] = [];
  private activeMatches: Map<string, ActiveMatch> = new Map();
  private matchHistory: MatchResult[] = [];
  private totalMatchesCompleted = 0;
  private isRunning = false;
  private startTime = 0;
  private matchSchedulerTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private matchIdCounter = 0;

  constructor(config: DuelMatchmakerConfig) {
    super();
    this.config = {
      rampUpDelayMs: 200,
      connectTimeoutMs: 15000,
      namePrefix: "DuelBot",
      matchIntervalMs: 5000,
      countdownMs: 3000,
      verbose: false,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) throw new Error("Matchmaker is already running");

    this.isRunning = true;
    this.startTime = Date.now();
    this.bots = [];
    this.activeMatches.clear();
    this.matchHistory = [];
    this.totalMatchesCompleted = 0;

    console.log(
      `[DuelMatchmaker] Starting ${this.config.botCount} duel bots...`,
    );

    // Spawn bots
    await this.spawnBots();

    // Start match scheduler
    this.startMatchScheduler();

    // Start stats logger
    this.statsTimer = setInterval(() => this.logStats(), 10000);

    console.log(
      `[DuelMatchmaker] Ready. ${this.getConnectedBots().length}/${this.config.botCount} bots connected.`,
    );
    this.emit("ready", {
      connectedBots: this.getConnectedBots().length,
      totalBots: this.config.botCount,
    });
  }

  private async spawnBots(): Promise<void> {
    const { botCount, wsUrl, rampUpDelayMs, namePrefix, connectTimeoutMs } =
      this.config;

    for (let i = 0; i < botCount && this.isRunning; i++) {
      const botConfig: DuelBotConfig = {
        wsUrl,
        name: `${namePrefix}-${String(i + 1).padStart(3, "0")}`,
        autoAcceptChallenges: true,
        autoConfirmScreens: true,
        connectTimeoutMs,
      };

      const bot = new DuelBot(botConfig);
      this.setupBotListeners(bot);
      this.bots.push(bot);

      try {
        await bot.connect();
        console.log(`[DuelMatchmaker] ${bot.name} connected`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[DuelMatchmaker] ${bot.name} failed: ${error.message}`);
      }

      if (rampUpDelayMs > 0 && i < botCount - 1) {
        await sleep(rampUpDelayMs);
      }
    }
  }

  private setupBotListeners(bot: DuelBot): void {
    bot.on("connected", (data) => {
      this.emit("botConnected", data);
    });

    bot.on("disconnected", (data) => {
      this.emit("botDisconnected", data);
      // Remove from active matches if involved
      for (const [matchId, match] of this.activeMatches) {
        if (match.bot1 === bot || match.bot2 === bot) {
          this.activeMatches.delete(matchId);
          console.log(
            `[DuelMatchmaker] Match ${matchId} cancelled: bot disconnected`,
          );
        }
      }
    });

    bot.on("challengeReceived", (data) => {
      if (this.config.verbose) {
        console.log(
          `[DuelMatchmaker] ${data.botName} received challenge from ${data.challengerName}`,
        );
      }
    });

    bot.on("duelStarted", (data) => {
      if (this.config.verbose) {
        console.log(
          `[DuelMatchmaker] ${data.botName} started duel ${data.duelId}`,
        );
      }
    });

    bot.on("duelEnded", (data) => {
      this.handleDuelEnded(bot, data);
    });
  }

  private handleDuelEnded(
    bot: DuelBot,
    data: {
      botName: string;
      duelId: string;
      won: boolean;
      winnerId: string;
      loserId: string;
    },
  ): void {
    // Find the active match for this duel
    let matchResult: ActiveMatch | null = null;
    for (const [matchId, match] of this.activeMatches) {
      if (match.bot1 === bot || match.bot2 === bot) {
        matchResult = match;
        this.activeMatches.delete(matchId);
        break;
      }
    }

    if (matchResult) {
      const winner =
        matchResult.bot1.getId() === data.winnerId
          ? matchResult.bot1
          : matchResult.bot2;
      const loser =
        matchResult.bot1.getId() === data.loserId
          ? matchResult.bot1
          : matchResult.bot2;

      const result: MatchResult = {
        matchId: matchResult.matchId,
        bot1Name: matchResult.bot1.name,
        bot2Name: matchResult.bot2.name,
        bot1Id: matchResult.bot1.getId() || "",
        bot2Id: matchResult.bot2.getId() || "",
        winnerId: data.winnerId,
        winnerName: winner.name,
        loserId: data.loserId,
        loserName: loser.name,
        startedAt: matchResult.startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - matchResult.startedAt,
      };

      this.matchHistory.push(result);
      this.totalMatchesCompleted++;

      console.log(
        `[DuelMatchmaker] Match ${result.matchId} complete: ${result.winnerName} defeated ${result.loserName} (${Math.round(result.durationMs / 1000)}s)`,
      );

      this.emit("matchComplete", result);
    }
  }

  private startMatchScheduler(): void {
    if (this.matchSchedulerTimer) return;

    this.matchSchedulerTimer = setInterval(() => {
      this.scheduleMatches();
    }, this.config.matchIntervalMs);

    // Initial scheduling
    setTimeout(() => this.scheduleMatches(), 1000);
  }

  private scheduleMatches(): void {
    if (!this.isRunning) return;

    const idleBots = this.getIdleBots();

    // Need at least 2 idle bots for a match
    while (idleBots.length >= 2) {
      const bot1 = idleBots.shift()!;
      const bot2 = idleBots.shift()!;

      this.startMatch(bot1, bot2);
    }
  }

  private startMatch(bot1: DuelBot, bot2: DuelBot): void {
    const matchId = `match-${++this.matchIdCounter}`;

    console.log(
      `[DuelMatchmaker] Scheduling ${matchId}: ${bot1.name} vs ${bot2.name}`,
    );

    const match: ActiveMatch = {
      matchId,
      bot1,
      bot2,
      startedAt: Date.now(),
    };

    this.activeMatches.set(matchId, match);

    this.emit("matchScheduled", {
      matchId,
      bot1Name: bot1.name,
      bot1Id: bot1.getId(),
      bot2Name: bot2.name,
      bot2Id: bot2.getId(),
      bot1Stats: bot1.metrics,
      bot2Stats: bot2.metrics,
    });

    // Bot1 challenges Bot2
    const targetId = bot2.getId();
    if (targetId) {
      bot1.challengePlayer(targetId);
    } else {
      console.warn(
        `[DuelMatchmaker] Cannot start match: ${bot2.name} has no ID`,
      );
      this.activeMatches.delete(matchId);
    }
  }

  private getConnectedBots(): DuelBot[] {
    return this.bots.filter((bot) => bot.connected);
  }

  private getIdleBots(): DuelBot[] {
    return this.bots.filter((bot) => bot.connected && bot.state === "idle");
  }

  private logStats(): void {
    const stats = this.getStats();
    console.log(`[DuelMatchmaker] Stats:`, {
      connected: `${stats.connectedBots}/${stats.totalBots}`,
      idle: stats.idleBots,
      inProgress: stats.duelsInProgress,
      completed: stats.totalMatchesCompleted,
      uptime: `${Math.round(stats.uptime / 1000)}s`,
    });
  }

  getStats(): MatchmakerStats {
    const connectedBots = this.getConnectedBots();
    const idleBots = this.getIdleBots();
    const botStats = new Map<string, DuelBotMetrics>();

    for (const bot of this.bots) {
      botStats.set(bot.name, bot.metrics);
    }

    return {
      totalBots: this.config.botCount,
      connectedBots: connectedBots.length,
      idleBots: idleBots.length,
      duelsInProgress: this.activeMatches.size,
      totalMatchesCompleted: this.totalMatchesCompleted,
      matchHistory: [...this.matchHistory],
      botStats,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  getLeaderboard(): {
    name: string;
    wins: number;
    losses: number;
    winRate: number;
  }[] {
    const leaderboard = this.bots
      .map((bot) => ({
        name: bot.name,
        wins: bot.metrics.wins,
        losses: bot.metrics.losses,
        winRate:
          bot.metrics.totalDuels > 0
            ? (bot.metrics.wins / bot.metrics.totalDuels) * 100
            : 0,
      }))
      .sort((a, b) => {
        // Sort by wins first, then by win rate
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.winRate - a.winRate;
      });

    return leaderboard;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("[DuelMatchmaker] Stopping...");
    this.isRunning = false;

    if (this.matchSchedulerTimer) {
      clearInterval(this.matchSchedulerTimer);
      this.matchSchedulerTimer = null;
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    // Disconnect all bots
    for (const bot of this.bots) {
      bot.disconnect();
    }

    this.bots = [];
    this.activeMatches.clear();

    console.log("[DuelMatchmaker] Stopped.");
    this.emit("stopped", { totalMatches: this.totalMatchesCompleted });
  }

  get running(): boolean {
    return this.isRunning;
  }
}

export default DuelMatchmaker;
