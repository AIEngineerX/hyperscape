/**
 * DuelScheduler - Server-side system for continuous agent-vs-agent dueling
 *
 * This system manages the automated pairing of AI agents for continuous PvP duels.
 * It monitors available agents, pairs them together, and ensures duels are
 * scheduled continuously for betting and entertainment purposes.
 *
 * Features:
 * - Automatic agent discovery and pairing
 * - Configurable match interval
 * - Duel result tracking for betting integration
 * - Fair matchmaking based on combat level
 *
 * Usage:
 * 1. Register the system with the world
 * 2. Configure via environment variables:
 *    - DUEL_SCHEDULER_ENABLED: Enable/disable scheduler
 *    - DUEL_SCHEDULER_INTERVAL_MS: Time between match attempts
 *    - DUEL_SCHEDULER_MIN_AGENTS: Minimum agents for scheduling
 */

import type { World } from "@hyperscape/shared";
import {
  EventType,
  type PlayerEntity,
  createPlayerID,
} from "@hyperscape/shared";
import { Logger } from "../ServerNetwork/services";

// ============================================================================
// Configuration
// ============================================================================

const config = {
  /** Whether the scheduler is enabled */
  enabled: process.env.DUEL_SCHEDULER_ENABLED !== "false",

  /** Interval between match scheduling attempts (ms) */
  matchIntervalMs: parseInt(
    process.env.DUEL_SCHEDULER_INTERVAL_MS || "30000",
    10,
  ),

  /** Minimum agents required to start scheduling */
  minAgents: parseInt(process.env.DUEL_SCHEDULER_MIN_AGENTS || "2", 10),

  /** Combat level difference tolerance for matchmaking */
  combatLevelTolerance: parseInt(
    process.env.DUEL_SCHEDULER_LEVEL_TOLERANCE || "10",
    10,
  ),

  /** Cooldown after a duel before an agent can be paired again (ms) */
  postDuelCooldownMs: parseInt(
    process.env.DUEL_SCHEDULER_COOLDOWN_MS || "10000",
    10,
  ),
};

// ============================================================================
// Types
// ============================================================================

interface AgentDuelStats {
  agentId: string;
  agentName: string;
  totalDuels: number;
  wins: number;
  losses: number;
  lastDuelEndTime: number;
  inActiveDuel: boolean;
}

interface ScheduledDuel {
  duelId: string;
  agent1Id: string;
  agent2Id: string;
  startTime: number;
  endTime?: number;
  winnerId?: string;
  loserId?: string;
}

// ============================================================================
// DuelScheduler Class
// ============================================================================

export class DuelScheduler {
  private readonly world: World;

  /** Map of agent ID -> duel stats */
  private agentStats: Map<string, AgentDuelStats> = new Map();

  /** History of scheduled duels for betting integration */
  private duelHistory: ScheduledDuel[] = [];

  /** Interval handle for match scheduling */
  private matchSchedulerInterval: ReturnType<typeof setInterval> | null = null;

  /** Currently active duel being managed by scheduler */
  private currentScheduledDuel: ScheduledDuel | null = null;

  /** Registered world event listeners for cleanup */
  private readonly eventListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Initialize the duel scheduler
   */
  init(): void {
    if (!config.enabled) {
      Logger.info("DuelScheduler", "Duel scheduler is disabled");
      return;
    }

    Logger.info("DuelScheduler", "Initializing duel scheduler", {
      matchIntervalMs: config.matchIntervalMs,
      minAgents: config.minAgents,
      combatLevelTolerance: config.combatLevelTolerance,
    });

    // Subscribe to duel completion events
    const onDuelCompleted = (payload: unknown) => {
      this.handleDuelCompleted(payload);
    };
    this.world.on("duel:completed", onDuelCompleted);
    this.eventListeners.push({
      event: "duel:completed",
      fn: onDuelCompleted,
    });

    // Also listen to duel:finished for the same event
    const onDuelFinished = (payload: unknown) => {
      this.handleDuelCompleted(payload);
    };
    this.world.on("duel:finished", onDuelFinished);
    this.eventListeners.push({
      event: "duel:finished",
      fn: onDuelFinished,
    });

    // Subscribe to player spawn events to track agents
    // Note: We listen for both PLAYER_SPAWNED and PLAYER_JOINED because:
    // - PLAYER_SPAWNED is emitted by PlayerSystem after equipment setup (normal players)
    // - PLAYER_JOINED is emitted by EmbeddedHyperscapeService (embedded AI agents)
    const onPlayerSpawned = (payload: unknown) => {
      this.handlePlayerSpawned(payload);
    };
    this.world.on(EventType.PLAYER_SPAWNED, onPlayerSpawned);
    this.eventListeners.push({
      event: EventType.PLAYER_SPAWNED,
      fn: onPlayerSpawned,
    });

    // Also listen for PLAYER_JOINED for embedded agents
    const onPlayerJoined = (payload: unknown) => {
      this.handlePlayerSpawned(payload);
    };
    this.world.on(EventType.PLAYER_JOINED, onPlayerJoined);
    this.eventListeners.push({
      event: EventType.PLAYER_JOINED,
      fn: onPlayerJoined,
    });

    // Subscribe to player left events to clean up
    const onPlayerLeft = (payload: unknown) => {
      this.handlePlayerLeft(payload);
    };
    this.world.on(EventType.PLAYER_LEFT, onPlayerLeft);
    this.eventListeners.push({
      event: EventType.PLAYER_LEFT,
      fn: onPlayerLeft,
    });

    // Start the match scheduler
    this.matchSchedulerInterval = setInterval(() => {
      this.tryScheduleMatch();
    }, config.matchIntervalMs);

    Logger.info("DuelScheduler", "Duel scheduler initialized");
  }

  /**
   * Destroy the scheduler and clean up resources
   */
  destroy(): void {
    if (this.matchSchedulerInterval) {
      clearInterval(this.matchSchedulerInterval);
      this.matchSchedulerInterval = null;
    }

    // Remove event listeners
    for (const { event, fn } of this.eventListeners) {
      this.world.off(event, fn);
    }
    this.eventListeners.length = 0;

    Logger.info("DuelScheduler", "Duel scheduler destroyed");
  }

  /**
   * Get all tracked agents
   */
  getAllAgentStats(): Map<string, AgentDuelStats> {
    return new Map(this.agentStats);
  }

  /**
   * Get stats for a specific agent
   */
  getAgentStats(agentId: string): AgentDuelStats | undefined {
    return this.agentStats.get(agentId);
  }

  /**
   * Get duel history for betting integration
   */
  getDuelHistory(): ScheduledDuel[] {
    return [...this.duelHistory];
  }

  /**
   * Get the currently active scheduled duel
   */
  getCurrentDuel(): ScheduledDuel | null {
    return this.currentScheduledDuel;
  }

  /**
   * Check if an entity is an AI agent (not a human player)
   */
  private isAgent(entity: PlayerEntity): boolean {
    // Check for agent marker in entity data
    const entityAny = entity as unknown as Record<string, unknown>;
    return (
      entityAny.isAgent === true ||
      entityAny.agentId !== undefined ||
      (typeof entityAny.name === "string" && entityAny.name.startsWith("[AI]"))
    );
  }

  /**
   * Get available agents for matching (not in cooldown, not in active duel)
   */
  private getAvailableAgents(): AgentDuelStats[] {
    const now = Date.now();
    return Array.from(this.agentStats.values()).filter((agent) => {
      // Not in active duel
      if (agent.inActiveDuel) return false;

      // Not in cooldown
      const cooldownEnd = agent.lastDuelEndTime + config.postDuelCooldownMs;
      if (now < cooldownEnd) return false;

      return true;
    });
  }

  /**
   * Try to schedule a match between available agents
   */
  private tryScheduleMatch(): void {
    // Skip if there's already an active scheduled duel
    if (this.currentScheduledDuel) {
      return;
    }

    const availableAgents = this.getAvailableAgents();

    if (availableAgents.length < config.minAgents) {
      Logger.debug(
        "DuelScheduler",
        `Not enough agents for match: ${availableAgents.length}/${config.minAgents}`,
      );
      return;
    }

    // Sort by total duels (prioritize less active agents for fair scheduling)
    availableAgents.sort((a, b) => a.totalDuels - b.totalDuels);

    // Pick first two agents
    const agent1 = availableAgents[0];
    const agent2 = availableAgents[1];

    // TODO: Add combat level matching for fairer matches
    // const combatLevel1 = this.getAgentCombatLevel(agent1.agentId);
    // const combatLevel2 = this.getAgentCombatLevel(agent2.agentId);

    Logger.info("DuelScheduler", "Scheduling duel between agents", {
      agent1: agent1.agentName,
      agent2: agent2.agentName,
    });

    // Initiate the duel challenge via the DuelSystem
    this.initiateDuel(agent1.agentId, agent2.agentId);
  }

  /**
   * Initiate a duel between two agents
   */
  private initiateDuel(agent1Id: string, agent2Id: string): void {
    // Get the DuelSystem from the world
    const duelSystem = (this.world as unknown as { duelSystem?: unknown })
      .duelSystem as
      | {
          createChallenge?: (
            challengerId: string,
            targetId: string,
          ) => { success: boolean; challengeId?: string; error?: string };
        }
      | undefined;

    if (!duelSystem || !duelSystem.createChallenge) {
      Logger.warn("DuelScheduler", "DuelSystem not available");
      return;
    }

    // Create the challenge
    const result = duelSystem.createChallenge(
      createPlayerID(agent1Id),
      createPlayerID(agent2Id),
    );

    if (!result.success) {
      Logger.warn("DuelScheduler", "Failed to create duel challenge", {
        agent1: agent1Id,
        agent2: agent2Id,
        error: result.error,
      });
      return;
    }

    // Mark agents as in active duel
    const stats1 = this.agentStats.get(agent1Id);
    const stats2 = this.agentStats.get(agent2Id);
    if (stats1) stats1.inActiveDuel = true;
    if (stats2) stats2.inActiveDuel = true;

    // Create scheduled duel record
    this.currentScheduledDuel = {
      duelId: result.challengeId || `scheduled-${Date.now()}`,
      agent1Id,
      agent2Id,
      startTime: Date.now(),
    };

    Logger.info("DuelScheduler", "Duel challenge created", {
      duelId: this.currentScheduledDuel.duelId,
      agent1: agent1Id,
      agent2: agent2Id,
    });

    // Emit event for betting system integration
    this.world.emit("duel:scheduled", {
      duelId: this.currentScheduledDuel.duelId,
      agent1Id,
      agent2Id,
      agent1Name: stats1?.agentName || agent1Id,
      agent2Name: stats2?.agentName || agent2Id,
      agent1Stats: stats1 || null,
      agent2Stats: stats2 || null,
      startTime: Date.now(),
    });
  }

  /**
   * Handle duel completion
   */
  private handleDuelCompleted(payload: unknown): void {
    const data = payload as {
      duelId?: string;
      winnerId?: string;
      loserId?: string;
      winnerName?: string;
      loserName?: string;
    };

    if (!data.winnerId || !data.loserId) {
      return;
    }

    // Update stats for winner
    const winnerStats = this.agentStats.get(data.winnerId);
    if (winnerStats) {
      winnerStats.wins++;
      winnerStats.totalDuels++;
      winnerStats.lastDuelEndTime = Date.now();
      winnerStats.inActiveDuel = false;
    }

    // Update stats for loser
    const loserStats = this.agentStats.get(data.loserId);
    if (loserStats) {
      loserStats.losses++;
      loserStats.totalDuels++;
      loserStats.lastDuelEndTime = Date.now();
      loserStats.inActiveDuel = false;
    }

    // Update scheduled duel record
    if (
      this.currentScheduledDuel &&
      (this.currentScheduledDuel.agent1Id === data.winnerId ||
        this.currentScheduledDuel.agent2Id === data.winnerId ||
        this.currentScheduledDuel.agent1Id === data.loserId ||
        this.currentScheduledDuel.agent2Id === data.loserId)
    ) {
      this.currentScheduledDuel.endTime = Date.now();
      this.currentScheduledDuel.winnerId = data.winnerId;
      this.currentScheduledDuel.loserId = data.loserId;

      // Add to history
      this.duelHistory.push({ ...this.currentScheduledDuel });

      // Keep history limited
      if (this.duelHistory.length > 100) {
        this.duelHistory.shift();
      }

      Logger.info("DuelScheduler", "Scheduled duel completed", {
        duelId: this.currentScheduledDuel.duelId,
        winner: data.winnerName || data.winnerId,
        loser: data.loserName || data.loserId,
        duration:
          this.currentScheduledDuel.endTime -
          this.currentScheduledDuel.startTime,
      });

      // Emit event for betting system integration
      this.world.emit("duel:result", {
        duelId: this.currentScheduledDuel.duelId,
        winnerId: data.winnerId,
        loserId: data.loserId,
        winnerName: data.winnerName,
        loserName: data.loserName,
        winnerStats,
        loserStats,
        duration:
          this.currentScheduledDuel.endTime -
          this.currentScheduledDuel.startTime,
      });

      // Clear current scheduled duel
      this.currentScheduledDuel = null;
    }
  }

  /**
   * Handle player spawned event
   */
  private handlePlayerSpawned(payload: unknown): void {
    const data = payload as {
      playerId?: string;
      playerName?: string;
      isAgent?: boolean;
    };

    if (!data.playerId) return;

    // Check if this is an agent
    // For now, we'll track all players and filter later
    // In production, we'd have a more reliable agent detection mechanism

    if (!this.agentStats.has(data.playerId)) {
      this.agentStats.set(data.playerId, {
        agentId: data.playerId,
        agentName: data.playerName || data.playerId,
        totalDuels: 0,
        wins: 0,
        losses: 0,
        lastDuelEndTime: 0,
        inActiveDuel: false,
      });

      Logger.info("DuelScheduler", "Agent registered", {
        agentId: data.playerId,
        agentName: data.playerName,
      });
    }
  }

  /**
   * Handle player left event
   */
  private handlePlayerLeft(payload: unknown): void {
    const data = payload as {
      playerId?: string;
    };

    if (!data.playerId) return;

    // Remove from tracking
    this.agentStats.delete(data.playerId);

    // If this agent was in the current scheduled duel, clear it
    if (
      this.currentScheduledDuel &&
      (this.currentScheduledDuel.agent1Id === data.playerId ||
        this.currentScheduledDuel.agent2Id === data.playerId)
    ) {
      Logger.warn("DuelScheduler", "Agent left during scheduled duel", {
        agentId: data.playerId,
        duelId: this.currentScheduledDuel.duelId,
      });
      this.currentScheduledDuel = null;
    }
  }

  /**
   * Manually register an agent (for testing or explicit agent identification)
   */
  registerAgent(agentId: string, agentName: string): void {
    if (!this.agentStats.has(agentId)) {
      this.agentStats.set(agentId, {
        agentId,
        agentName,
        totalDuels: 0,
        wins: 0,
        losses: 0,
        lastDuelEndTime: 0,
        inActiveDuel: false,
      });

      Logger.info("DuelScheduler", "Agent manually registered", {
        agentId,
        agentName,
      });
    }
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agentStats.delete(agentId);
    Logger.info("DuelScheduler", "Agent unregistered", { agentId });
  }

  /**
   * Schedule a match between two specific agents
   * Returns true if successful, false otherwise
   */
  scheduleMatch(agent1Id: string, agent2Id: string): boolean {
    const stats1 = this.agentStats.get(agent1Id);
    const stats2 = this.agentStats.get(agent2Id);

    if (!stats1 || !stats2) {
      Logger.warn("DuelScheduler", "Cannot schedule match: agents not found", {
        agent1: agent1Id,
        agent2: agent2Id,
      });
      return false;
    }

    if (this.currentScheduledDuel) {
      Logger.warn(
        "DuelScheduler",
        "Cannot schedule match: duel already in progress",
      );
      return false;
    }

    // Emit scheduling event (for betting integration)
    this.world.emit("duel:scheduled", {
      agent1Id,
      agent2Id,
      agent1Name: stats1.agentName,
      agent2Name: stats2.agentName,
      agent1Stats: stats1,
      agent2Stats: stats2,
    });

    this.initiateDuel(agent1Id, agent2Id);
    return true;
  }

  /**
   * Force schedule a duel between two specific agents (for testing)
   * @deprecated Use scheduleMatch instead
   */
  forceScheduleDuel(agent1Id: string, agent2Id: string): boolean {
    const stats1 = this.agentStats.get(agent1Id);
    const stats2 = this.agentStats.get(agent2Id);

    if (!stats1 || !stats2) {
      Logger.warn("DuelScheduler", "Cannot force schedule: agents not found", {
        agent1: agent1Id,
        agent2: agent2Id,
      });
      return false;
    }

    if (this.currentScheduledDuel) {
      Logger.warn(
        "DuelScheduler",
        "Cannot force schedule: duel already in progress",
      );
      return false;
    }

    this.initiateDuel(agent1Id, agent2Id);
    return true;
  }
}

// Export types
export type AgentStats = AgentDuelStats;
export type { ScheduledDuel };

// Export DuelBettingBridge for external use
export { DuelBettingBridge } from "./DuelBettingBridge";

// Export for use in server initialization
export default DuelScheduler;
