/**
 * StreamingDuelScheduler - 15-minute duel cycle for streaming mode
 *
 * Thin facade that orchestrates three extracted managers:
 * - MatchmakingManager: agent registration, stats, pair selection, leaderboard
 * - CameraDirector: camera targeting, activity tracking, idle preview
 * - DuelOrchestrator: combat preparation, execution, cleanup, duel flags
 *
 * The facade owns:
 * - Lifecycle (init, destroy, start, stop)
 * - Tick loop and state machine (handleIdleState, tick, phase transitions)
 * - Event subscriptions (subscribeToEvents)
 * - Broadcasting (broadcastState, getStreamingState)
 */

import type { World } from "@hyperscape/shared";
import { EventType } from "@hyperscape/shared";

/** Type for network with send method */
interface NetworkWithSend {
  send: <T>(name: string, data: T, ignoreSocketId?: string) => void;
  sendToSpectators?: <T>(name: string, data: T) => void;
}
import { Logger } from "../ServerNetwork/services";
import { v4 as uuidv4 } from "uuid";
import { errMsg } from "../../shared/errMsg.js";
import {
  type StreamingDuelCycle,
  type AgentContestant,
  type StreamingStateUpdate,
  type LeaderboardEntry,
  type RecentDuelEntry,
  type StreamingPhase,
  STREAMING_TIMING,
} from "./types.js";
import { MatchmakingManager } from "./managers/MatchmakingManager.js";
import { CameraDirector } from "./managers/CameraDirector.js";
import { DuelOrchestrator } from "./managers/DuelOrchestrator.js";
import { CycleStateMachine } from "./managers/CycleStateMachine.js";

// ============================================================================
// Configuration
// ============================================================================

const config = {
  /** Whether the streaming scheduler is enabled */
  enabled: process.env.STREAMING_DUEL_ENABLED !== "false",

  /** Check if maintenance mode is active (blocks new cycles) */
  isMaintenanceMode: (): boolean =>
    process.env.STREAMING_DUEL_MAINTENANCE_MODE === "true",

  /** Minimum agents required to run duels */
  minAgents: 2,

  /** How long to wait before retrying when insufficient agents (ms) */
  insufficientAgentsRetryInterval: 30_000,

  /** Maximum consecutive insufficient agent warnings before logging at error level */
  maxInsufficientAgentWarnings: 5,

  /** Max duel records to retain in memory for leaderboard/history APIs */
  maxRecentDuels: Math.max(
    20,
    Number.parseInt(process.env.STREAMING_RECENT_DUELS_MAX || "200", 10),
  ),

  /**
   * Persist duel win/loss stats to Postgres.
   * In stream uptime mode (DB_WRITE_ERRORS_NON_FATAL=true), default to disabled
   * to avoid transient DB transport faults taking down the game loop.
   */
  persistStatsToDatabase: (() => {
    const explicit = process.env.STREAMING_PERSIST_STATS;
    if (explicit != null && explicit.trim().length > 0) {
      const normalized = explicit.trim().toLowerCase();
      return !(
        normalized === "0" ||
        normalized === "false" ||
        normalized === "no" ||
        normalized === "off"
      );
    }
    return process.env.DB_WRITE_ERRORS_NON_FATAL !== "true";
  })(),

  /**
   * Max inactive agent stat records to retain in memory.
   * Active agents and current-cycle contestants are never evicted.
   */
  maxAgentStats: Math.max(
    64,
    Number.parseInt(process.env.STREAMING_AGENT_STATS_MAX || "512", 10),
  ),
};

const STREAMING_COMBAT_STALL_NUDGE_MS = Math.max(
  5_000,
  Number.parseInt(process.env.STREAMING_COMBAT_STALL_NUDGE_MS || "15000", 10),
);

const clampNumber = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

// ============================================================================
// StreamingDuelScheduler Class (Thin Facade)
// ============================================================================

export class StreamingDuelScheduler {
  private readonly world: World;

  // ---- Managers ----
  private readonly matchmaking: MatchmakingManager;
  private readonly camera: CameraDirector;
  private readonly orchestrator: DuelOrchestrator;
  private readonly phaseStateMachine = new CycleStateMachine();

  // ---- Facade-owned state ----

  /** Current cycle state */
  private currentCycle: StreamingDuelCycle | null = null;

  /** Tick interval for state updates */
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Broadcast interval for streaming state */
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  /** Countdown timeout for starting fight after countdown */
  private countdownTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Event listeners for cleanup */
  private eventListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  /** Guard against concurrent startCountdown() invocations */
  private _startCountdownInProgress = false;

  /** Guard against concurrent endCycle() invocations (Fix M) */
  private _endCycleInProgress = false;

  /** Scheduler state for state machine */
  private schedulerState: "IDLE" | "WAITING_FOR_AGENTS" | "ACTIVE" = "IDLE";

  /** Whether a graceful restart is pending (waits for current duel to end) */
  private _pendingGracefulRestart = false;

  // ---- Streaming State Cache (Memory Optimization) ----
  /** Cached streaming state to avoid recreating objects every 500ms */
  private _cachedStreamingState: StreamingStateUpdate | null = null;
  /** Last tick when streaming state was fully regenerated */
  private _lastStreamingStateTick = -1;
  /** Current game tick counter (updated by tick loop) */
  private _currentTick = 0;
  /** Last phase when state was generated (for cache invalidation) */
  private _lastStreamingStatePhase: StreamingPhase | null = null;
  /** Last cycle ID when state was generated */
  private _lastStreamingStateCycleId: string | null = null;
  /** Cached agent objects to avoid recreation (reused in getStreamingState) */
  private _cachedAgent1: StreamingStateUpdate["cycle"]["agent1"] = null;
  private _cachedAgent2: StreamingStateUpdate["cycle"]["agent1"] = null;
  /** Pre-allocated idle cycle object (reused when no active cycle) */
  private readonly _idleCycleObject: StreamingStateUpdate["cycle"] = {
    cycleId: "",
    phase: "IDLE",
    cycleStartTime: 0,
    phaseStartTime: 0,
    phaseEndTime: 0,
    timeRemaining: 0,
    agent1: null,
    agent2: null,
    countdown: null,
    fightStartTime: null,
    arenaPositions: null,
    winnerId: null,
    winnerName: null,
    winReason: null,
  };
  /** Pre-allocated active cycle object (reused during active cycle) */
  private readonly _activeCycleObject: StreamingStateUpdate["cycle"] = {
    cycleId: "",
    phase: "IDLE",
    cycleStartTime: 0,
    phaseStartTime: 0,
    phaseEndTime: 0,
    timeRemaining: 0,
    agent1: null,
    agent2: null,
    countdown: null,
    fightStartTime: null,
    arenaPositions: null,
    winnerId: null,
    winnerName: null,
    winReason: null,
  };
  /** Pre-allocated streaming state return object */
  private readonly _streamingStateObject: StreamingStateUpdate = {
    type: "STREAMING_STATE_UPDATE",
    cycle: this._idleCycleObject,
    leaderboard: [],
    cameraTarget: null,
  };

  constructor(world: World) {
    this.world = world;

    // -- Wire up managers --

    this.matchmaking = new MatchmakingManager(
      world,
      this.getDatabase.bind(this),
      {
        minAgents: config.minAgents,
        maxRecentDuels: config.maxRecentDuels,
        persistStatsToDatabase: config.persistStatsToDatabase,
        maxAgentStats: config.maxAgentStats,
        insufficientAgentsRetryInterval: config.insufficientAgentsRetryInterval,
        maxInsufficientAgentWarnings: config.maxInsufficientAgentWarnings,
      },
    );

    this.camera = new CameraDirector(
      world,
      () => this.matchmaking.availableAgents,
      () => this.currentCycle,
      () => this.matchmaking.nextDuelPair,
      (pair) => {
        this.matchmaking.nextDuelPair = pair;
        if (
          pair === null &&
          this.matchmaking.availableAgents.size >= config.minAgents
        ) {
          this.matchmaking.refreshNextDuelPair(Date.now());
        }
      },
    );

    this.orchestrator = new DuelOrchestrator(
      world,
      () => this.currentCycle,
      (fields) => {
        if (this.currentCycle) {
          if (fields.phase && fields.phase !== this.currentCycle.phase) {
            this.phaseStateMachine.transition(fields.phase as StreamingPhase);
          }
          Object.assign(this.currentCycle, fields);
        }
      },
      () => this.matchmaking.agentStats,
      (winnerId, loserId, winReason) =>
        this.handleResolution(winnerId, loserId, winReason),
      () => this.matchmaking.getLeaderboard(),
      () => this.matchmaking.getRecentDuels(),
    );

    // -- Wire matchmaking callbacks --

    this.matchmaking.setCallbacks({
      getCycleContestantIds: () => this.camera.getCycleContestantIds(),
      getCurrentCycleAgentDamage: (characterId: string) => {
        if (!this.currentCycle) return null;
        if (this.currentCycle.agent1?.characterId === characterId) {
          return {
            damageDealtThisFight: this.currentCycle.agent1.damageDealtThisFight,
          };
        }
        if (this.currentCycle.agent2?.characterId === characterId) {
          return {
            damageDealtThisFight: this.currentCycle.agent2.damageDealtThisFight,
          };
        }
        return null;
      },
      onAgentRegistered: (agentId: string, now: number) => {
        this.camera.ensureAgentActivity(agentId, now);
      },
      onAgentUnregistered: (agentId: string) => {
        this.camera.deleteAgentActivity(agentId);

        // Check if this agent is in an active duel - forfeit them
        if (
          this.currentCycle &&
          (this.currentCycle.phase === "FIGHTING" ||
            this.currentCycle.phase === "COUNTDOWN")
        ) {
          const { agent1, agent2 } = this.currentCycle;

          if (agent1?.characterId === agentId) {
            if (agent2) {
              Logger.info(
                "StreamingDuelScheduler",
                `${agent1.name} disconnected, ${agent2.name} wins by forfeit`,
              );
              this.orchestrator.stopCombatLoop();
              this.orchestrator.startResolution(
                agent2.characterId,
                agentId,
                "kill",
              );
            }
          } else if (agent2?.characterId === agentId) {
            if (agent1) {
              Logger.info(
                "StreamingDuelScheduler",
                `${agent2.name} disconnected, ${agent1.name} wins by forfeit`,
              );
              this.orchestrator.stopCombatLoop();
              this.orchestrator.startResolution(
                agent1.characterId,
                agentId,
                "kill",
              );
            }
          }
        }
      },
    });
  }

  // ============================================================================
  // Database Access
  // ============================================================================

  /** Get the database connection, or null. */
  private getDatabase():
    | import("drizzle-orm/node-postgres").NodePgDatabase
    | null {
    const databaseSystem = this.world.getSystem("database") as {
      getDb?: () => import("drizzle-orm/node-postgres").NodePgDatabase | null;
    } | null;
    return databaseSystem?.getDb?.() ?? null;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /** Start the streaming duel scheduler (alias for init) */
  start(): void {
    this.init();
  }

  /** Stop the streaming duel scheduler (alias for destroy) */
  stop(): void {
    this.destroy();
  }

  /** Get current cycle (public accessor) */
  getCurrentCycle(): StreamingDuelCycle | null {
    return this.currentCycle;
  }

  /**
   * Request a graceful server restart after the current duel ends.
   * The server will complete the current FIGHTING/RESOLUTION phase,
   * then trigger a SIGTERM to allow PM2 to restart it with new code.
   *
   * @returns Whether the restart was scheduled (false if already pending)
   */
  requestGracefulRestart(): boolean {
    if (this._pendingGracefulRestart) {
      Logger.info("StreamingDuelScheduler", "Graceful restart already pending");
      return false;
    }

    this._pendingGracefulRestart = true;
    const phase = this.currentCycle?.phase ?? "IDLE";

    if (phase === "IDLE" || phase === "ANNOUNCEMENT") {
      // No active duel, restart immediately
      Logger.info(
        "StreamingDuelScheduler",
        "No active duel, triggering immediate graceful restart",
      );
      this.triggerGracefulRestart();
    } else {
      Logger.info(
        "StreamingDuelScheduler",
        `Graceful restart scheduled after current duel (phase: ${phase})`,
      );
    }

    return true;
  }

  /**
   * Check if a graceful restart is pending
   */
  isPendingRestart(): boolean {
    return this._pendingGracefulRestart;
  }

  /**
   * Trigger the actual graceful restart by sending SIGTERM to self.
   * PM2 will handle the restart.
   */
  private triggerGracefulRestart(): void {
    Logger.info(
      "StreamingDuelScheduler",
      "Triggering graceful restart (SIGTERM)",
    );
    // Give a moment for logs to flush
    setTimeout(() => {
      process.kill(process.pid, "SIGTERM");
    }, 500);
  }

  /** Initialize the streaming duel scheduler */
  init(): void {
    if (!config.enabled) {
      Logger.info(
        "StreamingDuelScheduler",
        "Streaming duel scheduler disabled",
      );
      return;
    }

    Logger.info(
      "StreamingDuelScheduler",
      "Initializing streaming duel scheduler",
    );
    if (!config.persistStatsToDatabase) {
      Logger.info(
        "StreamingDuelScheduler",
        "Stats persistence disabled (STREAMING_PERSIST_STATS=false or DB_WRITE_ERRORS_NON_FATAL=true)",
      );
    }

    // Subscribe to player events to track agents
    this.subscribeToEvents();

    // Scan for any agents that were already spawned before we initialized
    this.matchmaking.scanForExistingAgents();

    // Start the main tick loop
    this.startTickLoop();

    // Start broadcasting state to viewers
    this.startStateBroadcast();

    Logger.info(
      "StreamingDuelScheduler",
      "Streaming duel scheduler initialized",
    );
  }

  /** Destroy the scheduler and cleanup */
  destroy(): void {
    // Clear duel flags immediately to avoid stale no-respawn states when scheduler stops mid-cycle.
    this.orchestrator.clearDuelFlagsForCycle(this.currentCycle);

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.countdownTimeout) {
      clearTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }

    // Remove event listeners
    for (const { event, fn } of this.eventListeners) {
      this.world.off(event, fn);
    }
    this.eventListeners = [];

    // Reset facade state
    this._startCountdownInProgress = false;
    this._endCycleInProgress = false;
    this.schedulerState = "IDLE";
    this.currentCycle = null;
    this.phaseStateMachine.forceIdle();
    this.phaseStateMachine.removeAllListeners();

    // Reset managers
    this.orchestrator.reset();
    this.camera.reset();
    this.matchmaking.reset();

    Logger.info("StreamingDuelScheduler", "Streaming duel scheduler destroyed");
  }

  // ============================================================================
  // Event Subscriptions
  // ============================================================================

  private subscribeToEvents(): void {
    // Track agent spawns
    const onPlayerJoined = (payload: unknown) => {
      const data = payload as {
        playerId?: string;
        isEmbeddedAgent?: boolean;
        isAgent?: boolean;
      };

      if (data.playerId && (data.isEmbeddedAgent || data.isAgent)) {
        this.matchmaking.registerAgent(data.playerId);
      }
    };
    this.world.on(EventType.PLAYER_JOINED, onPlayerJoined);
    this.eventListeners.push({
      event: EventType.PLAYER_JOINED,
      fn: onPlayerJoined,
    });

    // Track agent leaves
    const onPlayerLeft = (payload: unknown) => {
      const data = payload as { playerId?: string };
      if (data.playerId) {
        this.matchmaking.unregisterAgent(data.playerId);
      }
    };
    this.world.on(EventType.PLAYER_LEFT, onPlayerLeft);
    this.eventListeners.push({
      event: EventType.PLAYER_LEFT,
      fn: onPlayerLeft,
    });

    // Track duel completions
    const onDuelCompleted = (payload: unknown) => {
      this.handleDuelCompleted(payload);
    };
    this.world.on("duel:completed", onDuelCompleted);
    this.eventListeners.push({ event: "duel:completed", fn: onDuelCompleted });

    // Track combat damage for duel stats
    const onCombatDamageDealt = (payload: unknown) => {
      this.handleEntityDamaged(payload);
    };
    this.world.on(EventType.COMBAT_DAMAGE_DEALT, onCombatDamageDealt);
    this.eventListeners.push({
      event: EventType.COMBAT_DAMAGE_DEALT,
      fn: onCombatDamageDealt,
    });

    // Track entity deaths
    const onEntityDeath = (payload: unknown) => {
      this.handleEntityDeath(payload);
    };
    this.world.on(EventType.ENTITY_DEATH, onEntityDeath);
    this.eventListeners.push({
      event: EventType.ENTITY_DEATH,
      fn: onEntityDeath,
    });
  }

  // ============================================================================
  // Public API Delegates
  // ============================================================================

  /** Register an agent for duel scheduling */
  registerAgent(agentId: string): void {
    this.matchmaking.registerAgent(agentId);
  }

  /** Unregister an agent from duel scheduling */
  unregisterAgent(agentId: string): void {
    this.matchmaking.unregisterAgent(agentId);
  }

  /** Get leaderboard sorted by win rate */
  getLeaderboard(): LeaderboardEntry[] {
    return this.matchmaking.getLeaderboard();
  }

  /** Get recent duel history */
  getRecentDuels(limit: number = 30): RecentDuelEntry[] {
    return this.matchmaking.getRecentDuels(limit);
  }

  // ============================================================================
  // Main Tick Loop
  // ============================================================================

  private startTickLoop(): void {
    // Run tick every second
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 1000);

    // Run first tick immediately
    this.tick();
  }

  private tick(): void {
    const now = Date.now();
    this.camera.refreshAgentActivity(now);

    // If no active cycle, check if we can start one
    if (!this.currentCycle) {
      this.handleIdleState(now);
      if (!this.currentCycle) {
        this.camera.syncIdlePreviewAndCamera(now);
        return;
      }
    }

    // Fix K — Watchdog for stuck phases. If any phase exceeds its generous
    // grace period, abort to IDLE rather than staying stuck forever.
    const phaseElapsed = now - this.currentCycle.phaseStartTime;
    // Reduced grace periods (10s instead of 30s) to fail faster on stuck phases
    const PHASE_TIMEOUT_MS: Partial<Record<StreamingPhase, number>> = {
      ANNOUNCEMENT: 10_000 + STREAMING_TIMING.ANNOUNCEMENT_DURATION,
      COUNTDOWN: 5_000 + STREAMING_TIMING.COUNTDOWN_DURATION,
      FIGHTING:
        10_000 +
        STREAMING_TIMING.FIGHTING_DURATION +
        STREAMING_TIMING.END_WARNING_DURATION,
      RESOLUTION: 10_000 + STREAMING_TIMING.RESOLUTION_DURATION,
    };
    const maxPhaseMs = PHASE_TIMEOUT_MS[this.currentCycle.phase];
    if (maxPhaseMs !== undefined && phaseElapsed > maxPhaseMs) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Watchdog: phase ${this.currentCycle.phase} stuck for ${Math.round(phaseElapsed / 1000)}s (max ${Math.round(maxPhaseMs / 1000)}s), aborting`,
      );
      this.abortCycleToIdle(
        `watchdog_${this.currentCycle.phase.toLowerCase()}_timeout`,
      );
      return;
    }

    // Process current phase
    switch (this.currentCycle.phase) {
      case "ANNOUNCEMENT":
        this.tickAnnouncement(now);
        break;
      case "COUNTDOWN":
        // Fix N — COUNTDOWN fallback. If fightStartTime has passed by >2s and
        // the countdownTimeout was lost (GC'd, cleared by accident), force-start.
        if (
          this.currentCycle.fightStartTime &&
          now > this.currentCycle.fightStartTime + 2000 &&
          this.countdownTimeout === null
        ) {
          Logger.warn(
            "StreamingDuelScheduler",
            "COUNTDOWN fallback: fightStartTime passed and countdownTimeout lost, force-starting fight",
          );
          this.doStartFight(now);
        }
        break;
      case "FIGHTING":
        this.tickFighting(now);
        break;
      case "RESOLUTION":
        this.tickResolution(now);
        break;
    }

    // Update camera target
    this.camera.updateCameraTarget(now);
  }

  // ============================================================================
  // State Machine Management
  // ============================================================================

  /**
   * Handle idle state - check if we can start a new cycle
   * Implements proper error handling and auto-recovery for insufficient agents
   */
  private handleIdleState(now: number): void {
    // Guard: don't start a new cycle while endCycle cleanup is still in flight
    if (this._endCycleInProgress) return;

    this.orchestrator.clearStaleDuelFlagsForIdleAgents(
      this.matchmaking.availableAgents,
    );

    // Check for maintenance mode - don't start new cycles during deployment
    if (config.isMaintenanceMode()) {
      this.schedulerState = "IDLE";
      return;
    }

    const agentCount = this.matchmaking.availableAgents.size;

    if (agentCount >= config.minAgents) {
      // Reset warning counter on success
      if (this.matchmaking.insufficientAgentWarningCount > 0) {
        Logger.info(
          "StreamingDuelScheduler",
          `Agent availability recovered: ${agentCount} agents now available`,
        );
        this.matchmaking.insufficientAgentWarningCount = 0;
      }

      // Transition to active state
      this.schedulerState = "ACTIVE";
      this.startNewCycle();
      return;
    }

    // Not enough agents - implement auto-recovery with logging
    this.schedulerState = "WAITING_FOR_AGENTS";

    // Throttle logging to avoid spam
    const timeSinceLastLog = now - this.matchmaking.lastInsufficientAgentsLog;
    if (timeSinceLastLog >= config.insufficientAgentsRetryInterval) {
      this.matchmaking.insufficientAgentWarningCount++;
      this.matchmaking.lastInsufficientAgentsLog = now;

      const message =
        `Insufficient agents for duel: ${agentCount}/${config.minAgents}. ` +
        `Waiting for agents to join... (check ${this.matchmaking.insufficientAgentWarningCount})`;

      if (
        this.matchmaking.insufficientAgentWarningCount >=
        config.maxInsufficientAgentWarnings
      ) {
        // Escalate to error after multiple warnings
        Logger.error(
          "StreamingDuelScheduler",
          `${message} Consider spawning more agents or checking agent spawner.`,
        );
      } else {
        Logger.warn("StreamingDuelScheduler", message);
      }

      // Emit event for external monitoring
      this.world.emit("streaming:waiting_for_agents", {
        currentAgents: agentCount,
        requiredAgents: config.minAgents,
        warningCount: this.matchmaking.insufficientAgentWarningCount,
      });
    }
  }

  // ============================================================================
  // Cycle Management
  // ============================================================================

  private startNewCycle(): void {
    // Guard: don't start a new cycle while endCycle cleanup is still in flight
    if (this._endCycleInProgress) {
      Logger.warn(
        "StreamingDuelScheduler",
        "startNewCycle blocked: endCycle cleanup still in progress",
      );
      return;
    }

    const cycleId = uuidv4();
    const now = Date.now();

    const agents = Array.from(this.matchmaking.availableAgents);

    // CRITICAL: Double-check agent count with error handling
    if (agents.length < config.minAgents) {
      Logger.error(
        "StreamingDuelScheduler",
        `startNewCycle called with insufficient agents: ${agents.length}/${config.minAgents}. ` +
          `This indicates a state machine bug.`,
      );
      this.schedulerState = "WAITING_FOR_AGENTS";
      return;
    }

    // Validate all agents still exist in the world before selection
    const validAgents = agents.filter((agentId) => {
      const entity = this.world.entities.get(agentId);
      if (!entity) {
        Logger.warn(
          "StreamingDuelScheduler",
          `Agent ${agentId} no longer exists in world, removing from available list`,
        );
        this.matchmaking.availableAgents.delete(agentId);
        return false;
      }
      return true;
    });

    // Re-check after validation
    if (validAgents.length < config.minAgents) {
      Logger.warn(
        "StreamingDuelScheduler",
        `After validation, only ${validAgents.length} valid agents remain. Waiting for more.`,
      );
      this.schedulerState = "WAITING_FOR_AGENTS";
      return;
    }

    const selectedPair =
      this.matchmaking.consumePreselectedDuelPair(validAgents) ??
      this.matchmaking.chooseRandomPairFromPool(validAgents, now);
    const agent1Id = selectedPair?.agent1Id ?? null;
    const agent2Id = selectedPair?.agent2Id ?? null;

    // Validate: ensure different agents selected (safety check)
    if (!agent1Id || !agent2Id || agent1Id === agent2Id) {
      Logger.error(
        "StreamingDuelScheduler",
        "Could not select two distinct valid agents for a cycle",
      );
      return;
    }

    // Get agent data
    const agent1 = this.orchestrator.createContestant(agent1Id, agent2Id);
    const agent2 = this.orchestrator.createContestant(agent2Id, agent1Id);

    if (!agent1 || !agent2) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to create contestants: agent1=${!!agent1}, agent2=${!!agent2}`,
      );
      // Remove invalid agents from available list
      if (!agent1) this.matchmaking.availableAgents.delete(agent1Id);
      if (!agent2) this.matchmaking.availableAgents.delete(agent2Id);
      return;
    }

    this.phaseStateMachine.transition("ANNOUNCEMENT");
    this.currentCycle = {
      cycleId,
      phase: "ANNOUNCEMENT",
      cycleStartTime: now,
      phaseStartTime: now,
      agent1,
      agent2,
      duelId: null,
      arenaId: null,
      countdownValue: null,
      fightStartTime: null,
      arenaPositions: null,
      winnerId: null,
      loserId: null,
      winReason: null,
    };
    this.matchmaking.refreshNextDuelPair(now);

    // Mark agents as in a streaming duel immediately so their autonomous AI
    // won't make them attack each other or wander into combat during announcement.
    this.orchestrator.setDuelFlags(true);

    // Force-end any combat the selected agents are already in.
    this.orchestrator.forceStopAgentCombat(agent1.characterId);
    this.orchestrator.forceStopAgentCombat(agent2.characterId);

    // Restore full health immediately so the first broadcast shows full HP.
    this.orchestrator.restoreHealth(agent1.characterId);
    this.orchestrator.restoreHealth(agent2.characterId);

    // Set initial camera target
    this.camera.setCameraTarget(agent1.characterId, now);

    Logger.info(
      "StreamingDuelScheduler",
      `New cycle started: ${agent1.name} vs ${agent2.name}`,
    );

    // Emit announcement event
    this.world.emit("streaming:cycle:started", {
      cycleId,
      agent1: { id: agent1.characterId, name: agent1.name },
      agent2: { id: agent2.characterId, name: agent2.name },
    });

    this.world.emit("streaming:announcement:start", {
      cycleId,
      agent1,
      agent2,
      duration: STREAMING_TIMING.ANNOUNCEMENT_DURATION,
    });
  }

  // ============================================================================
  // Phase Handlers
  // ============================================================================

  private tickAnnouncement(now: number): void {
    if (!this.currentCycle) return;

    const elapsed = now - this.currentCycle.phaseStartTime;

    // Check if announcement phase is over
    if (elapsed >= STREAMING_TIMING.ANNOUNCEMENT_DURATION) {
      void this.startCountdown();
    }
  }

  private async startCountdown(): Promise<void> {
    if (
      !this.currentCycle ||
      !this.currentCycle.agent1 ||
      !this.currentCycle.agent2
    ) {
      return;
    }

    // Guard against re-entry if phase already changed.
    if (this.currentCycle.phase !== "ANNOUNCEMENT") {
      return;
    }

    // Prevent concurrent invocations from overlapping ticks (Fix A).
    if (this._startCountdownInProgress) return;
    this._startCountdownInProgress = true;
    try {
      Logger.info(
        "StreamingDuelScheduler",
        "Preparing contestants for countdown",
      );

      // Duel flags are already set at ANNOUNCEMENT start (startNewCycle), but
      // re-apply as a safety net in case they were cleared by recovery logic.
      this.orchestrator.setDuelFlags(true);

      // Prepare contestants (fill food, restore HP) but NOT teleport yet.
      // Fix J — timeout wrapper so prep can't block forever.
      const PREP_TIMEOUT_MS = 10_000;
      try {
        await Promise.race([
          this.orchestrator.prepareContestantsForDuel(),
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error("Prep timed out")),
              PREP_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        Logger.warn(
          "StreamingDuelScheduler",
          `Contestant prep failed: ${errMsg(err)}`,
        );
      }

      // Scheduler may have advanced/ended while awaiting prep.
      if (!this.currentCycle || this.currentCycle.phase !== "ANNOUNCEMENT") {
        return;
      }

      // Fix I — Re-validate both agents exist and are alive after async prep.
      const postPrepEntity1 = this.currentCycle.agent1
        ? this.world.entities.get(this.currentCycle.agent1.characterId)
        : null;
      const postPrepEntity2 = this.currentCycle.agent2
        ? this.world.entities.get(this.currentCycle.agent2.characterId)
        : null;
      const postPrepAlive1 =
        postPrepEntity1 &&
        ((postPrepEntity1.data as { health?: number }).health ?? 0) > 0;
      const postPrepAlive2 =
        postPrepEntity2 &&
        ((postPrepEntity2.data as { health?: number }).health ?? 0) > 0;

      if (!postPrepAlive1 && !postPrepAlive2) {
        this.abortCycleToIdle("both_agents_lost_during_prep");
        return;
      }
      if (!postPrepAlive1 && this.currentCycle.agent2) {
        this.orchestrator.startResolution(
          this.currentCycle.agent2.characterId,
          this.currentCycle.agent1?.characterId ?? "",
          "kill",
        );
        return;
      }
      if (!postPrepAlive2 && this.currentCycle.agent1) {
        this.orchestrator.startResolution(
          this.currentCycle.agent1.characterId,
          this.currentCycle.agent2?.characterId ?? "",
          "kill",
        );
        return;
      }

      // Teleport agents to arena NOW — right as countdown begins.
      try {
        await this.orchestrator.teleportToArena(
          this.currentCycle.agent1.characterId,
          this.currentCycle.agent2.characterId,
        );
      } catch (err) {
        Logger.warn(
          "StreamingDuelScheduler",
          `Failed to teleport contestants into arena: ${errMsg(err)}`,
        );
        this.abortCycleToIdle("arena_teleport_failed");
        return;
      }

      if (!this.currentCycle || this.currentCycle.phase !== "ANNOUNCEMENT") {
        return;
      }

      // Ensure stale pathing state does not pull contestants away after teleport.
      this.world.emit("player:movement:cancel", {
        playerId: this.currentCycle.agent1.characterId,
      });
      this.world.emit("player:movement:cancel", {
        playerId: this.currentCycle.agent2.characterId,
      });

      // Transition to COUNTDOWN.
      const now = Date.now();
      const fightStartTime = now + STREAMING_TIMING.COUNTDOWN_DURATION;

      this.phaseStateMachine.transition("COUNTDOWN");
      this.currentCycle.phase = "COUNTDOWN";
      this.currentCycle.phaseStartTime = now;
      this.currentCycle.fightStartTime = fightStartTime;
      this.currentCycle.countdownValue = null;
      this.camera.setCameraTarget(
        this.currentCycle.agent1?.characterId ?? null,
        now,
      );

      Logger.info("StreamingDuelScheduler", "Starting countdown");

      // Force immediate broadcast so clients see COUNTDOWN state.
      this.broadcastState();

      // Schedule startFight after the countdown duration.
      if (this.countdownTimeout) {
        clearTimeout(this.countdownTimeout);
      }
      this.countdownTimeout = setTimeout(() => {
        this.countdownTimeout = null;
        this.doStartFight(Date.now());
      }, STREAMING_TIMING.COUNTDOWN_DURATION);
    } finally {
      this._startCountdownInProgress = false;
    }
  }

  /**
   * Wrapper that calls orchestrator.startFight() and handles facade-owned
   * camera logic around the fight start transition.
   */
  private doStartFight(now: number): void {
    if (!this.currentCycle || this.currentCycle.phase !== "COUNTDOWN") {
      return;
    }

    // Both-dead check: abort if neither agent is alive (startFight just returns).
    const { agent1, agent2 } = this.currentCycle;
    const entity1 = agent1 ? this.world.entities.get(agent1.characterId) : null;
    const entity2 = agent2 ? this.world.entities.get(agent2.characterId) : null;
    const alive1 =
      entity1 && ((entity1.data as { health?: number }).health ?? 0) > 0;
    const alive2 =
      entity2 && ((entity2.data as { health?: number }).health ?? 0) > 0;
    if (!alive1 && !alive2) {
      this.abortCycleToIdle("both_agents_missing");
      return;
    }

    // Reset camera cutaway tracking for the new fight phase.
    this.camera.resetFightCutawayTracking();

    // Delegate fight start to orchestrator (handles phase transition, duel flags,
    // health restore, emit, combat initiation, combat AIs).
    this.orchestrator.startFight();

    // If the orchestrator transitioned to FIGHTING, set camera target.
    // Re-read cycle since startFight() mutates phase via setCurrentCycleFields.
    const cycleAfterFight = this.currentCycle;
    if (
      cycleAfterFight &&
      (cycleAfterFight.phase as StreamingPhase) === "FIGHTING"
    ) {
      this.camera.setCameraTarget(
        cycleAfterFight.agent1?.characterId ?? null,
        now,
      );
    }
  }

  private tickFighting(now: number): void {
    if (!this.currentCycle) return;

    const elapsed = now - this.currentCycle.phaseStartTime;
    const totalFightDuration =
      STREAMING_TIMING.FIGHTING_DURATION +
      STREAMING_TIMING.END_WARNING_DURATION;

    // Check for end warning
    if (
      elapsed >= STREAMING_TIMING.FIGHTING_DURATION &&
      elapsed < totalFightDuration
    ) {
      // In end warning phase
      const remaining = totalFightDuration - elapsed;
      if (remaining <= 30000 && remaining > 29000) {
        this.world.emit("streaming:fight:end_warning", {
          cycleId: this.currentCycle.cycleId,
          secondsRemaining: Math.ceil(remaining / 1000),
        });
      }
    }

    // Check if fight time is up
    if (elapsed >= totalFightDuration) {
      this.orchestrator.endFightByTimeout();
    }

    // Update HP from entities
    this.orchestrator.updateContestantHp();

    // Fallback: nudge stalled fights so the stream cycle still progresses even
    // when combat start hooks fail in this tick window.
    if (elapsed >= STREAMING_COMBAT_STALL_NUDGE_MS) {
      this.orchestrator.applyCombatStallNudge(now);
    }
  }

  private tickResolution(now: number): void {
    if (!this.currentCycle) return;

    const elapsed = now - this.currentCycle.phaseStartTime;

    // Check if resolution phase is over
    if (elapsed >= STREAMING_TIMING.RESOLUTION_DURATION) {
      this.endCycle();
    }
  }

  // ============================================================================
  // Resolution Handling (callback from DuelOrchestrator)
  // ============================================================================

  /**
   * Handle resolution when DuelOrchestrator calls onResolution.
   * This is the facade's responsibility: phase transition, stats, recording, camera.
   */
  private handleResolution(
    winnerId: string,
    loserId: string,
    winReason: "kill" | "hp_advantage" | "damage_advantage" | "draw",
  ): void {
    if (!this.currentCycle) return;

    // Idempotency guard — only transition from FIGHTING or COUNTDOWN (Fix C).
    if (
      this.currentCycle.phase !== "FIGHTING" &&
      this.currentCycle.phase !== "COUNTDOWN"
    ) {
      return;
    }

    // Clear countdown timeout if still pending (e.g. forfeit during countdown).
    if (this.countdownTimeout) {
      clearTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }

    const now = Date.now();
    this.phaseStateMachine.transition("RESOLUTION");
    this.currentCycle.phase = "RESOLUTION";
    this.currentCycle.phaseStartTime = now;
    this.currentCycle.winnerId = winnerId;
    this.currentCycle.loserId = loserId;
    this.currentCycle.winReason = winReason;

    // Update stats
    this.matchmaking.updateStats(winnerId, loserId);

    // Get winner/loser names
    const winnerName =
      this.currentCycle.agent1?.characterId === winnerId
        ? this.currentCycle.agent1.name
        : this.currentCycle.agent2?.name || "Unknown";
    const loserName =
      this.currentCycle.agent1?.characterId === loserId
        ? this.currentCycle.agent1.name
        : this.currentCycle.agent2?.name || "Unknown";
    this.matchmaking.recordRecentDuel({
      cycleId: this.currentCycle.cycleId,
      duelId: this.currentCycle.duelId,
      finishedAt: now,
      winnerId,
      winnerName,
      loserId,
      loserName,
      winReason,
      damageWinner:
        this.currentCycle.agent1?.characterId === winnerId
          ? this.currentCycle.agent1.damageDealtThisFight
          : (this.currentCycle.agent2?.damageDealtThisFight ?? 0),
      damageLoser:
        this.currentCycle.agent1?.characterId === loserId
          ? this.currentCycle.agent1.damageDealtThisFight
          : (this.currentCycle.agent2?.damageDealtThisFight ?? 0),
    });

    Logger.info(
      "StreamingDuelScheduler",
      `Fight ended: ${winnerName} wins by ${winReason}`,
    );

    // Emit resolution event
    this.world.emit("streaming:resolution:start", {
      cycleId: this.currentCycle.cycleId,
      winnerId,
      loserId,
      winnerName,
      winReason,
    });

    // Set camera to winner
    this.camera.finishFightCutawayTracking(now);
    this.camera.setCameraTarget(winnerId, now);

    // NOTE: cleanupAfterDuel() (health restore, food removal, teleport out) is
    // deferred to endCycle() so the death animation plays during the RESOLUTION
    // phase before agents are teleported out of the arena.
  }

  // ============================================================================
  // Cycle End
  // ============================================================================

  private endCycle(): void {
    if (!this.currentCycle) return;

    // Fix M — guard against re-entry
    if (this._endCycleInProgress) return;
    this._endCycleInProgress = true;

    const cycleSnapshot = this.currentCycle;
    const now = Date.now();
    const winnerId = cycleSnapshot.winnerId;
    const loserId = cycleSnapshot.loserId;
    const cycleAgent1Id = cycleSnapshot.agent1?.characterId ?? null;
    const cycleAgent2Id = cycleSnapshot.agent2?.characterId ?? null;

    // Snapshot duel food slots before clearing
    const duelFoodSlotsMap = this.orchestrator.getDuelFoodSlotsByAgent();
    const duelFoodSlotsSnapshotByAgent = new Map<
      string,
      Array<{ slot: number; itemId: string }>
    >();
    if (cycleAgent1Id) {
      duelFoodSlotsSnapshotByAgent.set(cycleAgent1Id, [
        ...(duelFoodSlotsMap.get(cycleAgent1Id) ?? []),
      ]);
      duelFoodSlotsMap.delete(cycleAgent1Id);
    }
    if (cycleAgent2Id) {
      duelFoodSlotsSnapshotByAgent.set(cycleAgent2Id, [
        ...(duelFoodSlotsMap.get(cycleAgent2Id) ?? []),
      ]);
      duelFoodSlotsMap.delete(cycleAgent2Id);
    }

    Logger.info(
      "StreamingDuelScheduler",
      `Cycle ${cycleSnapshot.cycleId} ended. Winner: ${winnerId || "none"}`,
    );

    // Emit cycle end
    this.world.emit("streaming:resolution:end", {
      cycleId: cycleSnapshot.cycleId,
      winnerId,
      loserId,
    });
    this.camera.finishFightCutawayTracking(now);

    // NOTE: Duel flags (inStreamingDuel, preventRespawn) are intentionally NOT
    // cleared here. They stay `true` until cleanupAfterDuel() teleports both
    // agents out of the arena and then clears them via microtask. Clearing
    // flags before the cleanup teleport creates a race condition where
    // DuelSystem.ejectNonDuelingPlayersFromCombatArenas() sees the agents
    // still in the arena with inStreamingDuel=false and emits a spurious
    // extra teleport (causing duplicate teleport VFX).

    // Clear current cycle
    this.currentCycle = null;

    // Transition phase state machine back to IDLE
    this.phaseStateMachine.forceIdle();
    this.schedulerState = "IDLE";

    // Await cleanup, then start next cycle after an inter-cycle delay.
    // This prevents stale avatars from lingering in the arena — cleanup
    // must complete before re-selecting agents for the next duel.
    this.orchestrator
      .cleanupAfterDuel(cycleSnapshot, duelFoodSlotsSnapshotByAgent)
      .catch((err) => {
        Logger.warn(
          "StreamingDuelScheduler",
          `cleanupAfterDuel failed: ${err instanceof Error ? err.message : String(err)}. Clearing duel food tracking and flags as fallback.`,
        );
        this.orchestrator.clearDuelFlagsForCycleIfInactive(cycleSnapshot);
      })
      .finally(() => {
        // Wait for inter-cycle delay so spectators see a clean arena reset
        setTimeout(() => {
          this._endCycleInProgress = false;

          // Check for pending graceful restart
          if (this._pendingGracefulRestart) {
            Logger.info(
              "StreamingDuelScheduler",
              "Duel cycle complete, triggering pending graceful restart",
            );
            this.triggerGracefulRestart();
            return;
          }

          // Start new cycle if enough agents are available
          if (this.matchmaking.availableAgents.size >= config.minAgents) {
            this.schedulerState = "ACTIVE";
            this.startNewCycle();
          } else {
            this.schedulerState = "WAITING_FOR_AGENTS";
            Logger.info(
              "StreamingDuelScheduler",
              `Waiting for agents after cycle end: ${this.matchmaking.availableAgents.size}/${config.minAgents}`,
            );
          }
        }, STREAMING_TIMING.INTER_CYCLE_DELAY_MS);
      });
  }

  /**
   * Abort the current cycle and return to IDLE state.
   * Used when both agents are missing or an unrecoverable error occurs mid-cycle.
   */
  private abortCycleToIdle(reason: string): void {
    Logger.warn("StreamingDuelScheduler", `Aborting cycle to IDLE: ${reason}`);

    this.orchestrator.stopCombatLoop();
    this.orchestrator.clearCombatRetryTimeout();
    this.orchestrator.stopCombatAIs();

    if (this.countdownTimeout) {
      clearTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }

    this.orchestrator.clearDuelFlagsForCycle(this.currentCycle);
    this.orchestrator.getDuelFoodSlotsByAgent().clear();
    this.currentCycle = null;
    this._endCycleInProgress = false;
    this.phaseStateMachine.forceIdle();
    this.schedulerState = "IDLE";
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleDuelCompleted(payload: unknown): void {
    const data = payload as {
      duelId?: string;
      winnerId?: string;
      loserId?: string;
    };

    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return;
    }

    // Check if this is our duel
    if (
      data.winnerId === this.currentCycle.agent1?.characterId ||
      data.winnerId === this.currentCycle.agent2?.characterId
    ) {
      const winnerId = data.winnerId!;
      const loserId =
        winnerId === this.currentCycle.agent1?.characterId
          ? this.currentCycle.agent2?.characterId
          : this.currentCycle.agent1?.characterId;

      if (loserId) {
        this.orchestrator.startResolution(winnerId, loserId, "kill");
      }
    }
  }

  private handleEntityDamaged(payload: unknown): void {
    const data = payload as {
      entityId?: string;
      targetId?: string;
      sourceId?: string;
      attackerId?: string;
      damage?: number;
    };

    const attackerId = data.attackerId || data.sourceId;
    const targetId = data.targetId || data.entityId;
    if (!attackerId || !targetId) return;

    const now = Date.now();
    const damage = Number(data.damage);
    const intensity = Number.isFinite(damage)
      ? clampNumber(damage / 6, 0.4, 5.5)
      : 0.8;
    this.camera.markAgentInteresting(attackerId, intensity, now);
    this.camera.markAgentInteresting(targetId, intensity * 0.7, now);

    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return;
    }

    if (!Number.isFinite(damage) || damage <= 0) {
      return;
    }

    // Update damage dealt for the attacker
    if (
      attackerId === this.currentCycle.agent1?.characterId &&
      targetId === this.currentCycle.agent2?.characterId
    ) {
      this.currentCycle.agent1.damageDealtThisFight += damage;
    } else if (
      attackerId === this.currentCycle.agent2?.characterId &&
      targetId === this.currentCycle.agent1?.characterId
    ) {
      this.currentCycle.agent2.damageDealtThisFight += damage;
    }

    // Sync target HP immediately so the next broadcast reflects current health
    // (don't wait for the next tickFighting → updateContestantHp cycle).
    const targetEntity = this.world.entities.get(targetId);
    if (targetEntity) {
      const targetData = targetEntity.data as { health?: number };
      const freshHp = targetData.health;
      if (typeof freshHp === "number" && Number.isFinite(freshHp)) {
        if (this.currentCycle.agent1?.characterId === targetId) {
          this.currentCycle.agent1.currentHp = freshHp;
        } else if (this.currentCycle.agent2?.characterId === targetId) {
          this.currentCycle.agent2.currentHp = freshHp;
        }
      }
    }
  }

  private handleEntityDeath(payload: unknown): void {
    const data = payload as {
      entityId?: string;
      killedBy?: string;
    };

    const now = Date.now();
    if (data.killedBy) {
      this.camera.markAgentInteresting(data.killedBy, 4.2, now);
    }
    if (data.entityId) {
      this.camera.markAgentInteresting(data.entityId, 1.2, now);
    }

    // Handle deaths during both FIGHTING and COUNTDOWN phases (Fix F).
    if (
      !this.currentCycle ||
      (this.currentCycle.phase !== "FIGHTING" &&
        this.currentCycle.phase !== "COUNTDOWN")
    ) {
      return;
    }

    if (!data.entityId) return;

    // Check if one of our contestants died
    if (
      data.entityId === this.currentCycle.agent1?.characterId ||
      data.entityId === this.currentCycle.agent2?.characterId
    ) {
      const loserId = data.entityId;
      const winnerId =
        loserId === this.currentCycle.agent1?.characterId
          ? this.currentCycle.agent2?.characterId
          : this.currentCycle.agent1?.characterId;

      if (winnerId) {
        this.orchestrator.startResolution(winnerId, loserId, "kill");
      }
    }
  }

  // ============================================================================
  // State Broadcasting
  // ============================================================================

  private startStateBroadcast(): void {
    // Emit immediately so spectators get a valid first camera target without
    // waiting for the first interval tick.
    this.broadcastState();

    // Broadcast state every second
    this.broadcastInterval = setInterval(() => {
      // Ensure HP is fresh before broadcasting (catches food/regen changes
      // that don't fire damage events).
      this.orchestrator.updateContestantHp();
      this.broadcastState();
    }, STREAMING_TIMING.STATE_BROADCAST_INTERVAL);
  }

  private broadcastState(): void {
    const state = this.getStreamingState();
    // Broadcast streaming state only to spectator sockets (interest management).
    // Regular gameplay clients don't need streaming duel updates every second.
    const network = this.world.network as NetworkWithSend | undefined;
    if (network?.sendToSpectators) {
      network.sendToSpectators("streamingState", state);
    } else if (network?.send) {
      // Fallback: broadcast to all if sendToSpectators not available
      network.send("streamingState", state);
    }
  }

  /**
   * Get current streaming state for broadcast.
   * MEMORY OPTIMIZATION: Reuses pre-allocated objects to avoid GC pressure.
   * Only creates new contestant objects when agents change.
   */
  getStreamingState(): StreamingStateUpdate {
    const now = Date.now();
    const leaderboard = this.matchmaking.getLeaderboard();

    if (!this.currentCycle) {
      // IDLE state - use pre-allocated idle cycle object
      const previewPair = this.camera.getIdlePreviewPairSnapshot();
      let previewAgent1Id = previewPair?.agent1Id ?? null;
      let previewAgent2Id = previewPair?.agent2Id ?? null;

      if (!previewAgent1Id || !previewAgent2Id) {
        // Collect fallback IDs without allocating if possible
        let fallbackCount = 0;
        let fallback1: string | null = null;
        let fallback2: string | null = null;
        for (const agentId of this.matchmaking.availableAgents) {
          if (!this.camera.isAgentValidCameraCandidate(agentId)) {
            continue;
          }
          if (fallbackCount === 0) {
            fallback1 = agentId;
          } else if (fallbackCount === 1) {
            fallback2 = agentId;
          }
          fallbackCount++;
          if (fallbackCount >= config.minAgents) {
            break;
          }
        }
        previewAgent1Id = previewAgent1Id ?? fallback1;
        previewAgent2Id = previewAgent2Id ?? fallback2;
      }

      // Only create contestant objects if IDs changed (reduces allocations)
      const needAgent1Update =
        this._cachedAgent1 === null ||
        (this._cachedAgent1 as { id?: string })?.id !== previewAgent1Id;
      const needAgent2Update =
        this._cachedAgent2 === null ||
        (this._cachedAgent2 as { id?: string })?.id !== previewAgent2Id;

      if (needAgent1Update && previewAgent1Id) {
        const contestant = this.orchestrator.createContestant(
          previewAgent1Id,
          previewAgent2Id ?? undefined,
        );
        this._cachedAgent1 = this.toStreamingCycleAgentInPlace(
          contestant,
          this._cachedAgent1,
        );
      } else if (!previewAgent1Id) {
        this._cachedAgent1 = null;
      }

      if (needAgent2Update && previewAgent2Id) {
        const contestant = this.orchestrator.createContestant(
          previewAgent2Id,
          previewAgent1Id ?? undefined,
        );
        this._cachedAgent2 = this.toStreamingCycleAgentInPlace(
          contestant,
          this._cachedAgent2,
        );
      } else if (!previewAgent2Id) {
        this._cachedAgent2 = null;
      }

      // Update idle cycle object in place (zero allocation)
      this._idleCycleObject.cycleStartTime = now;
      this._idleCycleObject.phaseStartTime = now;
      this._idleCycleObject.phaseEndTime = now;
      this._idleCycleObject.agent1 = this._cachedAgent1;
      this._idleCycleObject.agent2 = this._cachedAgent2;

      // Build camera IDs without allocation if possible
      const cameraId1 = this._cachedAgent1
        ? (this._cachedAgent1 as { id?: string }).id
        : null;
      const cameraId2 = this._cachedAgent2
        ? (this._cachedAgent2 as { id?: string }).id
        : null;

      // Use inline array to avoid allocation when possible
      const preferredCameraIds: string[] = [];
      if (cameraId1) preferredCameraIds.push(cameraId1);
      if (cameraId2) preferredCameraIds.push(cameraId2);

      const idleCameraTarget =
        this.camera.getIdleCameraTargetSnapshot(preferredCameraIds);

      // Update return object in place
      this._streamingStateObject.cycle = this._idleCycleObject;
      this._streamingStateObject.leaderboard = leaderboard;
      this._streamingStateObject.cameraTarget = idleCameraTarget;

      return this._streamingStateObject;
    }

    // ACTIVE CYCLE - use pre-allocated active cycle object
    const { agent1, agent2 } = this.currentCycle;
    const phaseEndTime = this.getPhaseEndTime();
    const timeRemaining = Math.max(0, phaseEndTime - now);
    const cameraTarget = this.getCycleCameraTargetSnapshot();

    // Check if we need to update agent objects (only when agent changes or health changes)
    const currentCycleId = this.currentCycle.cycleId;
    const cycleChanged = this._lastStreamingStateCycleId !== currentCycleId;

    if (cycleChanged || this._cachedAgent1 === null) {
      this._cachedAgent1 = this.toStreamingCycleAgentInPlace(
        agent1,
        this._cachedAgent1,
      );
    } else if (agent1) {
      // Update HP in place (most common change during fight)
      this.updateAgentHpInPlace(this._cachedAgent1, agent1);
    }

    if (cycleChanged || this._cachedAgent2 === null) {
      this._cachedAgent2 = this.toStreamingCycleAgentInPlace(
        agent2,
        this._cachedAgent2,
      );
    } else if (agent2) {
      // Update HP in place (most common change during fight)
      this.updateAgentHpInPlace(this._cachedAgent2, agent2);
    }

    this._lastStreamingStateCycleId = currentCycleId;

    // Update active cycle object in place
    this._activeCycleObject.cycleId = currentCycleId;
    this._activeCycleObject.phase = this.currentCycle.phase;
    this._activeCycleObject.cycleStartTime = this.currentCycle.cycleStartTime;
    this._activeCycleObject.phaseStartTime = this.currentCycle.phaseStartTime;
    this._activeCycleObject.phaseEndTime = phaseEndTime;
    this._activeCycleObject.timeRemaining = timeRemaining;
    this._activeCycleObject.agent1 = this._cachedAgent1;
    this._activeCycleObject.agent2 = this._cachedAgent2;
    this._activeCycleObject.countdown = this.currentCycle.countdownValue;
    this._activeCycleObject.fightStartTime =
      this.currentCycle.fightStartTime ?? null;
    this._activeCycleObject.arenaPositions =
      this.currentCycle.arenaPositions ?? null;
    this._activeCycleObject.winnerId = this.currentCycle.winnerId;
    this._activeCycleObject.winnerName = this.currentCycle.winnerId
      ? (this.currentCycle.agent1?.characterId === this.currentCycle.winnerId
          ? this.currentCycle.agent1?.name
          : this.currentCycle.agent2?.name) || null
      : null;
    this._activeCycleObject.winReason = this.currentCycle.winReason;

    // Update return object in place
    this._streamingStateObject.cycle = this._activeCycleObject;
    this._streamingStateObject.leaderboard = leaderboard;
    this._streamingStateObject.cameraTarget = cameraTarget;

    return this._streamingStateObject;
  }

  /**
   * Convert AgentContestant to streaming format, reusing existing object if possible.
   * MEMORY OPTIMIZATION: Updates properties in place instead of creating new objects.
   */
  private toStreamingCycleAgentInPlace(
    agent: AgentContestant | null,
    existing: StreamingStateUpdate["cycle"]["agent1"],
  ): StreamingStateUpdate["cycle"]["agent1"] {
    if (!agent) {
      return null;
    }

    // Reuse existing object if available
    if (existing) {
      existing.id = agent.characterId;
      existing.name = agent.name;
      existing.provider = agent.provider;
      existing.model = agent.model;
      existing.hp = agent.currentHp;
      existing.maxHp = agent.maxHp;
      existing.combatLevel = agent.combatLevel;
      existing.wins = agent.wins;
      existing.losses = agent.losses;
      existing.damageDealtThisFight = agent.damageDealtThisFight;
      existing.rank = agent.rank;
      existing.headToHeadWins = agent.headToHeadWins;
      existing.headToHeadLosses = agent.headToHeadLosses;
      // Equipment: update in place by copying properties
      if (agent.equipment) {
        if (!existing.equipment) {
          existing.equipment = {};
        }
        // Clear existing and copy new (avoids creating new object)
        for (const key of Object.keys(
          existing.equipment as Record<string, unknown>,
        )) {
          delete (existing.equipment as Record<string, unknown>)[key];
        }
        Object.assign(existing.equipment, agent.equipment);
      } else {
        existing.equipment = {};
      }
      // Inventory: we must use the reference since inventory items can change
      // But cap at 28 items to match original
      existing.inventory = Array.isArray(agent.inventory)
        ? agent.inventory.slice(0, 28)
        : [];
      return existing;
    }

    // Create new object (only when no existing object)
    return this.toStreamingCycleAgent(agent);
  }

  /**
   * Update just HP fields in place (most common update during fights)
   */
  private updateAgentHpInPlace(
    cached: StreamingStateUpdate["cycle"]["agent1"],
    agent: AgentContestant,
  ): void {
    if (!cached) return;
    cached.hp = agent.currentHp;
    cached.maxHp = agent.maxHp;
    cached.wins = agent.wins;
    cached.losses = agent.losses;
  }

  // ============================================================================
  // Helper Methods (owned by facade)
  // ============================================================================

  private getPhaseEndTime(): number {
    if (!this.currentCycle) return Date.now();

    const { phase, phaseStartTime } = this.currentCycle;

    switch (phase) {
      case "ANNOUNCEMENT":
        return phaseStartTime + STREAMING_TIMING.ANNOUNCEMENT_DURATION;
      case "COUNTDOWN":
        return (
          this.currentCycle.fightStartTime ??
          phaseStartTime + STREAMING_TIMING.COUNTDOWN_DURATION
        );
      case "FIGHTING":
        return (
          phaseStartTime +
          STREAMING_TIMING.FIGHTING_DURATION +
          STREAMING_TIMING.END_WARNING_DURATION
        );
      case "RESOLUTION":
        return phaseStartTime + STREAMING_TIMING.RESOLUTION_DURATION;
      default:
        return Date.now();
    }
  }

  private toStreamingCycleAgent(
    agent: AgentContestant | null,
  ): StreamingStateUpdate["cycle"]["agent1"] {
    if (!agent) {
      return null;
    }

    return {
      id: agent.characterId,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      hp: agent.currentHp,
      maxHp: agent.maxHp,
      combatLevel: agent.combatLevel,
      wins: agent.wins,
      losses: agent.losses,
      damageDealtThisFight: agent.damageDealtThisFight,
      equipment: { ...(agent.equipment ?? {}) },
      inventory: Array.isArray(agent.inventory)
        ? agent.inventory.slice(0, 28)
        : [],
      rank: agent.rank,
      headToHeadWins: agent.headToHeadWins,
      headToHeadLosses: agent.headToHeadLosses,
    };
  }

  /**
   * Snapshot-based camera target for broadcast (no side-effects like
   * refreshNextDuelPair). Used by getStreamingState for the active-cycle path.
   */
  private getCycleCameraTargetSnapshot(): string | null {
    if (!this.currentCycle) {
      return null;
    }

    const phase = this.currentCycle.phase ?? "IDLE";
    const contestantIds = this.camera.getCycleContestantIds();
    const nextDuelIds = this.getNextDuelAgentIdsSnapshot(contestantIds);
    const currentTarget = this.camera.cameraTarget;
    if (
      typeof currentTarget === "string" &&
      this.camera.isAgentValidCameraCandidate(currentTarget)
    ) {
      const currentIsContestant = contestantIds.has(currentTarget);
      const currentIsNextDuel = nextDuelIds.has(currentTarget);

      if (phase === "ANNOUNCEMENT" || phase === "COUNTDOWN") {
        if (currentIsContestant) {
          return currentTarget;
        }
      } else if (phase === "FIGHTING") {
        if (currentIsContestant || currentIsNextDuel) {
          return currentTarget;
        }
      } else {
        return currentTarget;
      }
    }

    const preferredIds: string[] = [];

    if (phase === "RESOLUTION" && this.currentCycle.winnerId) {
      preferredIds.push(this.currentCycle.winnerId);
    }

    preferredIds.push(...contestantIds, ...nextDuelIds);

    const seen = new Set<string>();
    for (const agentId of preferredIds) {
      if (seen.has(agentId)) {
        continue;
      }
      seen.add(agentId);
      if (this.camera.isAgentValidCameraCandidate(agentId)) {
        return agentId;
      }
    }

    for (const agentId of this.matchmaking.availableAgents) {
      if (this.camera.isAgentValidCameraCandidate(agentId)) {
        return agentId;
      }
    }

    return null;
  }

  /**
   * Non-mutating snapshot of next-duel agent IDs for broadcast.
   * Unlike CameraDirector.getNextDuelAgentIds, this does NOT refresh the
   * pair if a member is invalid — it just returns what's available.
   */
  private getNextDuelAgentIdsSnapshot(contestantIds: Set<string>): Set<string> {
    const ids = new Set<string>();
    const nextPair = this.matchmaking.nextDuelPair;
    if (!nextPair) {
      return ids;
    }

    const pairIds = [nextPair.agent1Id, nextPair.agent2Id];
    let validPairMembers = 0;
    for (const agentId of pairIds) {
      if (this.camera.isAgentValidCameraCandidate(agentId)) {
        validPairMembers++;
        if (!contestantIds.has(agentId)) {
          ids.add(agentId);
        }
      }
    }

    if (validPairMembers < config.minAgents) {
      return new Set<string>();
    }

    return ids;
  }

  /** Get scheduler state for monitoring/debugging */
  getSchedulerState(): {
    state: "IDLE" | "WAITING_FOR_AGENTS" | "ACTIVE";
    availableAgents: number;
    requiredAgents: number;
    insufficientWarnings: number;
    currentPhase: StreamingPhase | null;
  } {
    return {
      state: this.schedulerState,
      availableAgents: this.matchmaking.availableAgents.size,
      requiredAgents: config.minAgents,
      insufficientWarnings: this.matchmaking.insufficientAgentWarningCount,
      currentPhase: this.currentCycle?.phase ?? null,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let streamingSchedulerInstance: StreamingDuelScheduler | null = null;

/** Initialize the streaming duel scheduler */
export function initStreamingDuelScheduler(
  world: World,
): StreamingDuelScheduler {
  if (streamingSchedulerInstance) {
    streamingSchedulerInstance.destroy();
  }

  streamingSchedulerInstance = new StreamingDuelScheduler(world);
  streamingSchedulerInstance.init();

  return streamingSchedulerInstance;
}

/** Get the streaming duel scheduler instance */
export function getStreamingDuelScheduler(): StreamingDuelScheduler | null {
  return streamingSchedulerInstance;
}
