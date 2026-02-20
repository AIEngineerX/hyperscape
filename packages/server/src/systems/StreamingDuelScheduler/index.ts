/**
 * StreamingDuelScheduler - 15-minute duel cycle for streaming mode
 *
 * Manages automated agent-vs-agent duels with a fixed 15-minute cycle:
 * - 5 minutes: Announcement phase (show matchup, build hype)
 * - 10 minutes: Fight phase (active combat)
 * - Brief resolution (announce winner, update stats)
 *
 * Features:
 * - Automatic agent pairing from model agents pool
 * - Pre-duel preparation (fill food, restore health)
 * - Post-duel cleanup (remove food, teleport back)
 * - Real-time state broadcasting to streaming viewers
 * - Leaderboard tracking and updates
 */

import type { World } from "@hyperscape/shared";
import {
  DeathState,
  EventType,
  PlayerEntity,
  getDuelArenaConfig,
  isPositionInsideCombatArena,
} from "@hyperscape/shared";

/** Type for network with send method */
interface NetworkWithSend {
  send: <T>(name: string, data: T, ignoreSocketId?: string) => void;
}
import { Logger } from "../ServerNetwork/services";
import { v4 as uuidv4 } from "uuid";
import { DuelCombatAI } from "../../arena/DuelCombatAI.js";
import {
  type StreamingDuelCycle,
  type AgentContestant,
  type StreamingStateUpdate,
  type LeaderboardEntry,
  type RecentDuelEntry,
  type StreamingPhase,
  STREAMING_TIMING,
  DUEL_FOOD_ITEM,
} from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

const config = {
  /** Whether the streaming scheduler is enabled */
  enabled: process.env.STREAMING_DUEL_ENABLED !== "false",

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
};

/** Reserved regular duel arena for streaming agents (always use a single arena). */
const STREAMING_AGENT_ARENA_ID = 1;

const clampNumber = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

type AgentCombatData = {
  inCombat?: boolean;
  combatTarget?: string | null;
  ct?: string | null;
  attackTarget?: string | null;
};

type AgentActivitySample = {
  lastPosition: [number, number, number] | null;
  lastSampleTime: number;
  lastInterestingTime: number;
  lastFocusedTime: number;
  motionScore: number;
  combatScore: number;
  eventScore: number;
};

type CameraSwitchTiming = {
  minHoldMs: number;
  maxHoldMs: number;
  idleThresholdMs: number;
};

type NextDuelPair = {
  agent1Id: string;
  agent2Id: string;
  selectedAt: number;
};

type CameraCandidateWeight = {
  agentId: string;
  weight: number;
  activityScore: number;
  isInCombat: boolean;
  isContestant: boolean;
};

type CameraPhaseWeightConfig = {
  contestant: number;
  nonContestant: number;
  winner?: number;
};

const CAMERA_DIRECTOR = {
  switchTiming: {
    IDLE: { minHoldMs: 30_000, maxHoldMs: 90_000, idleThresholdMs: 15_000 },
    ANNOUNCEMENT: {
      minHoldMs: 22_000,
      maxHoldMs: 95_000,
      idleThresholdMs: 12_000,
    },
    COUNTDOWN: { minHoldMs: 6_000, maxHoldMs: 24_000, idleThresholdMs: 6_000 },
    FIGHTING: {
      minHoldMs: 28_000,
      maxHoldMs: 130_000,
      idleThresholdMs: 18_000,
    },
    RESOLUTION: { minHoldMs: 8_000, maxHoldMs: 45_000, idleThresholdMs: 8_000 },
  } as Record<StreamingPhase, CameraSwitchTiming>,
  baseWeights: {
    IDLE: { contestant: 1.3, nonContestant: 1.3 },
    ANNOUNCEMENT: { contestant: 8.4, nonContestant: 1.75 },
    COUNTDOWN: { contestant: 10.5, nonContestant: 0.55 },
    FIGHTING: { contestant: 10.2, nonContestant: 1.35 },
    RESOLUTION: { contestant: 2.2, nonContestant: 0.45, winner: 16 },
  } as Record<StreamingPhase, CameraPhaseWeightConfig>,
  activity: {
    maxActivityScore: 12,
    weightPerPoint: 0.12,
  },
  multipliers: {
    inCombat: 1.95,
    currentTargetBias: 1.22,
    recentFocusPenaltyShort: 0.45,
    recentFocusPenaltyLong: 0.78,
    switchRandomChance: 0.28,
    strongerThresholdActive: 1.28,
    strongerThresholdIdle: 1.1,
  },
  idlePenalty: {
    softThresholdMs: 12_000,
    hardThresholdMs: 25_000,
    softMultiplier: 0.75,
    hardContestantMultiplier: 0.78,
    hardNonContestantMultiplier: 0.52,
  },
  nextDuelWeightBoost: {
    IDLE: 1.5,
    ANNOUNCEMENT: 1.95,
    COUNTDOWN: 1.45,
    FIGHTING: 1.25,
    RESOLUTION: 1.15,
  } as Record<StreamingPhase, number>,
  fightingCutaway: {
    initialContestantLockMs: 25_000,
    contestantIdleThresholdMs: 15_000,
    nonContestantSuppressionMultiplier: 0.04,
    nonContestantAllowedMultiplier: 0.85,
    maxSingleCutawayMs: 18_000,
    maxTotalCutawayMs: 60_000,
    cutawayCooldownMs: 35_000,
  },
} as const;

// ============================================================================
// StreamingDuelScheduler Class
// ============================================================================

export class StreamingDuelScheduler {
  private readonly world: World;

  /** Current cycle state */
  private currentCycle: StreamingDuelCycle | null = null;

  /** Agent stats for leaderboard */
  private agentStats: Map<
    string,
    {
      characterId: string;
      name: string;
      provider: string;
      model: string;
      wins: number;
      losses: number;
      combatLevel: number;
      currentStreak: number;
    }
  > = new Map();

  /** Recent completed duel history (newest first) */
  private recentDuels: RecentDuelEntry[] = [];

  /** Tick interval for state updates */
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Broadcast interval for streaming state */
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  /** Countdown interval during countdown phase */
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  /** Available agents for dueling */
  private availableAgents: Set<string> = new Set();

  /**
   * Duel food slots provisioned by this scheduler for the current cycle.
   * Key: playerId, Value: slots filled with DUEL_FOOD_ITEM during prep.
   */
  private duelFoodSlotsByAgent: Map<string, number[]> = new Map();

  /** Event listeners for cleanup */
  private eventListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  /** Camera target for streaming viewers */
  private cameraTarget: string | null = null;

  /** Last camera switch time */
  private lastCameraSwitchTime: number = 0;

  /** Preselected pair for the upcoming cycle. */
  private nextDuelPair: NextDuelPair | null = null;

  /** Tracks fight-phase camera cutaway airtime spent off contestants. */
  private fightCutawayStartedAt: number | null = null;
  private fightCutawayTotalMs: number = 0;
  private fightLastCutawayEndedAt: number = 0;

  /** Per-agent camera activity used for weighted cinematic target selection. */
  private agentActivity: Map<string, AgentActivitySample> = new Map();

  /** Track insufficient agent warnings for auto-recovery */
  private insufficientAgentWarningCount: number = 0;

  /** Last time we logged insufficient agents warning */
  private lastInsufficientAgentsLog: number = 0;

  /** Scheduler state for state machine */
  private schedulerState: "IDLE" | "WAITING_FOR_AGENTS" | "ACTIVE" = "IDLE";

  /** DuelCombatAI instances for active duel agents */
  private combatAIs: Map<string, DuelCombatAI> = new Map();

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Start the streaming duel scheduler (alias for init)
   */
  start(): void {
    this.init();
  }

  /**
   * Stop the streaming duel scheduler (alias for destroy)
   */
  stop(): void {
    this.destroy();
  }

  /**
   * Get current cycle (public accessor)
   */
  getCurrentCycle(): StreamingDuelCycle | null {
    return this.currentCycle;
  }

  /**
   * Initialize the streaming duel scheduler
   */
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

    // Subscribe to player events to track agents
    this.subscribeToEvents();

    // Scan for any agents that were already spawned before we initialized
    this.scanForExistingAgents();

    // Start the main tick loop
    this.startTickLoop();

    // Start broadcasting state to viewers
    this.startStateBroadcast();

    Logger.info(
      "StreamingDuelScheduler",
      "Streaming duel scheduler initialized",
    );
  }

  /**
   * Scan for agents that may have been spawned before the scheduler started
   */
  private scanForExistingAgents(): void {
    // Get all entities from the world
    const entities = this.world.entities as {
      getAllEntities?: () => Map<string, unknown>;
    };

    if (!entities?.getAllEntities) {
      return;
    }

    const allEntities = entities.getAllEntities();
    let agentCount = 0;

    for (const [id, entity] of allEntities) {
      const entityAny = entity as { type?: string; isAgent?: boolean };

      // Check if this is a player entity marked as an agent
      if (entityAny.type === "player" && entityAny.isAgent === true) {
        this.registerAgent(id);
        agentCount++;
      }
    }

    if (agentCount > 0) {
      Logger.info(
        "StreamingDuelScheduler",
        `Found ${agentCount} existing agent(s) during initialization`,
      );
    }
  }

  /**
   * Destroy the scheduler and cleanup
   */
  destroy(): void {
    // Clear duel flags immediately to avoid stale no-respawn states when scheduler stops mid-cycle.
    this.clearDuelFlagsForCycle(this.currentCycle);

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Clear combat loop interval and AIs
    if (this.combatLoopInterval) {
      clearInterval(this.combatLoopInterval);
      this.combatLoopInterval = null;
    }

    // Remove event listeners
    for (const { event, fn } of this.eventListeners) {
      this.world.off(event, fn);
    }
    this.eventListeners = [];

    // Reset state
    this.schedulerState = "IDLE";
    this.currentCycle = null;
    this.cameraTarget = null;
    this.lastCameraSwitchTime = 0;
    this.nextDuelPair = null;
    this.fightCutawayStartedAt = null;
    this.fightCutawayTotalMs = 0;
    this.fightLastCutawayEndedAt = 0;
    this.duelFoodSlotsByAgent.clear();
    this.agentActivity.clear();
    this.recentDuels = [];

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
        this.registerAgent(data.playerId);
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
        this.unregisterAgent(data.playerId);
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
  // Agent Management
  // ============================================================================

  /**
   * Register an agent for duel scheduling
   */
  registerAgent(agentId: string): void {
    this.availableAgents.add(agentId);
    this.ensureAgentActivity(agentId, Date.now());
    if (this.currentCycle && this.availableAgents.size >= config.minAgents) {
      this.refreshNextDuelPair(Date.now());
    }

    // Get agent info from entity
    const entity = this.world.entities.get(agentId);
    if (entity) {
      const data = entity.data as {
        name?: string;
        skills?: Record<string, { level: number }>;
      };

      // Calculate combat level
      const skills = data.skills || {};
      const attack = skills.attack?.level || 1;
      const strength = skills.strength?.level || 1;
      const defense = skills.defense?.level || 1;
      const constitution = skills.constitution?.level || 10;
      const combatLevel = Math.floor(
        (attack + strength + defense + constitution) / 4,
      );

      // Parse provider and model from agent ID (or use character name)
      // Try to get from character data first
      const characterData = data as {
        name?: string;
        agentProvider?: string;
        agentModel?: string;
      };

      let provider = characterData.agentProvider || "unknown";
      let model = characterData.agentModel || "unknown";

      // Fallback: try to parse from agent ID if format is agent-{provider}-{model}
      if (provider === "unknown" && agentId.startsWith("agent-")) {
        const parts = agentId.split("-");
        provider = parts[1] || "unknown";
        model = parts.slice(2).join("-") || "unknown";
      }

      // Initialize stats if not exists
      if (!this.agentStats.has(agentId)) {
        this.agentStats.set(agentId, {
          characterId: agentId,
          name: data.name || agentId,
          provider,
          model,
          wins: 0,
          losses: 0,
          combatLevel,
          currentStreak: 0,
        });

        // Load persisted stats from database asynchronously
        this.loadStatsFromDatabase(agentId).catch((err) => {
          Logger.warn(
            "StreamingDuelScheduler",
            `Failed to load stats for ${agentId}: ${err}`,
          );
        });
      }

      Logger.info(
        "StreamingDuelScheduler",
        `Agent registered: ${data.name || agentId}`,
      );
    }
  }

  /**
   * Load persisted stats from database for an agent
   */
  private async loadStatsFromDatabase(agentId: string): Promise<void> {
    const databaseSystem = this.world.getSystem("database") as {
      getDb?: () => import("drizzle-orm/node-postgres").NodePgDatabase | null;
    } | null;

    const db = databaseSystem?.getDb?.();
    if (!db) {
      return;
    }

    try {
      const { playerCombatStats } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      const result = await db
        .select({
          totalDuelWins: playerCombatStats.totalDuelWins,
          totalDuelLosses: playerCombatStats.totalDuelLosses,
        })
        .from(playerCombatStats)
        .where(eq(playerCombatStats.playerId, agentId))
        .limit(1);

      if (result.length > 0) {
        const stats = this.agentStats.get(agentId);
        if (stats) {
          stats.wins = result[0].totalDuelWins;
          stats.losses = result[0].totalDuelLosses;
          Logger.info(
            "StreamingDuelScheduler",
            `Loaded persisted stats for ${agentId}: ${stats.wins}W ${stats.losses}L`,
          );
        }
      }
    } catch (err) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Error loading stats for ${agentId}: ${err}`,
      );
    }
  }

  /**
   * Unregister an agent from duel scheduling
   */
  unregisterAgent(agentId: string): void {
    this.availableAgents.delete(agentId);
    this.agentActivity.delete(agentId);
    if (
      this.nextDuelPair &&
      (this.nextDuelPair.agent1Id === agentId ||
        this.nextDuelPair.agent2Id === agentId)
    ) {
      this.nextDuelPair = null;
      if (this.availableAgents.size >= config.minAgents) {
        this.refreshNextDuelPair(Date.now());
      }
    }
    Logger.info("StreamingDuelScheduler", `Agent unregistered: ${agentId}`);

    // Check if this agent is in an active duel - forfeit them
    if (
      this.currentCycle &&
      (this.currentCycle.phase === "FIGHTING" ||
        this.currentCycle.phase === "COUNTDOWN")
    ) {
      const { agent1, agent2 } = this.currentCycle;

      if (agent1?.characterId === agentId) {
        // Agent 1 disconnected, agent 2 wins
        if (agent2) {
          Logger.info(
            "StreamingDuelScheduler",
            `${agent1.name} disconnected, ${agent2.name} wins by forfeit`,
          );
          this.stopCombatLoop();
          this.startResolution(agent2.characterId, agentId, "kill");
        }
      } else if (agent2?.characterId === agentId) {
        // Agent 2 disconnected, agent 1 wins
        if (agent1) {
          Logger.info(
            "StreamingDuelScheduler",
            `${agent2.name} disconnected, ${agent1.name} wins by forfeit`,
          );
          this.stopCombatLoop();
          this.startResolution(agent1.characterId, agentId, "kill");
        }
      }
    }
  }

  private ensureAgentActivity(
    agentId: string,
    now: number,
  ): AgentActivitySample {
    const existing = this.agentActivity.get(agentId);
    if (existing) {
      return existing;
    }

    const entity = this.world.entities.get(agentId);
    const startPosition = entity
      ? (this.normalizePosition(
          (
            entity as {
              data?: { position?: unknown };
            }
          ).data?.position,
        ) ??
        this.normalizePosition((entity as { position?: unknown }).position))
      : null;

    const sample: AgentActivitySample = {
      lastPosition: startPosition,
      lastSampleTime: now,
      lastInterestingTime: now,
      lastFocusedTime: 0,
      motionScore: 0,
      combatScore: 0,
      eventScore: 0,
    };
    this.agentActivity.set(agentId, sample);
    return sample;
  }

  private decayAgentActivity(sample: AgentActivitySample, now: number): void {
    const elapsedSeconds = (now - sample.lastSampleTime) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      sample.lastSampleTime = now;
      return;
    }

    sample.motionScore *= Math.exp(-1.1 * elapsedSeconds);
    sample.combatScore *= Math.exp(-0.8 * elapsedSeconds);
    sample.eventScore *= Math.exp(-1.45 * elapsedSeconds);
    sample.lastSampleTime = now;
  }

  private markAgentInteresting(
    agentId: string,
    intensity: number,
    now: number,
  ): void {
    if (!this.availableAgents.has(agentId)) {
      return;
    }

    const sample = this.ensureAgentActivity(agentId, now);
    this.decayAgentActivity(sample, now);

    const clampedIntensity = clampNumber(intensity, 0.1, 6);
    sample.eventScore = clampNumber(
      sample.eventScore + clampedIntensity,
      0,
      18,
    );
    sample.combatScore = clampNumber(
      sample.combatScore + clampedIntensity * 0.45,
      0,
      14,
    );
    sample.lastInterestingTime = now;
  }

  private isAgentInCombat(data: AgentCombatData | undefined): boolean {
    if (!data) return false;
    return Boolean(
      data.inCombat === true ||
      (typeof data.combatTarget === "string" && data.combatTarget.length) ||
      (typeof data.ct === "string" && data.ct.length) ||
      (typeof data.attackTarget === "string" && data.attackTarget.length),
    );
  }

  private getAgentActivityScore(agentId: string): number {
    const sample = this.agentActivity.get(agentId);
    if (!sample) {
      return 0;
    }

    return (
      sample.motionScore * 0.3 +
      sample.combatScore * 1.05 +
      sample.eventScore * 1.2
    );
  }

  private refreshAgentActivity(now: number): void {
    for (const agentId of this.availableAgents) {
      const entity = this.world.entities.get(agentId);
      if (!entity) {
        continue;
      }

      const sample = this.ensureAgentActivity(agentId, now);
      this.decayAgentActivity(sample, now);

      const currentPosition =
        this.normalizePosition(
          (
            entity as {
              data?: { position?: unknown };
            }
          ).data?.position,
        ) ??
        this.normalizePosition((entity as { position?: unknown }).position);

      if (currentPosition && sample.lastPosition) {
        const movedDistance = Math.hypot(
          currentPosition[0] - sample.lastPosition[0],
          currentPosition[2] - sample.lastPosition[2],
        );
        if (movedDistance > 0.05) {
          sample.motionScore = clampNumber(
            sample.motionScore + movedDistance * 2.25,
            0,
            12,
          );
          sample.lastInterestingTime = now;
        }
      }
      sample.lastPosition = currentPosition;

      const entityData = (entity as { data?: AgentCombatData }).data;
      if (this.isAgentInCombat(entityData)) {
        sample.combatScore = clampNumber(sample.combatScore + 0.9, 0, 12);
        sample.lastInterestingTime = now;
      }
    }

    // Keep activity map aligned with live agents.
    for (const agentId of this.agentActivity.keys()) {
      if (!this.availableAgents.has(agentId)) {
        this.agentActivity.delete(agentId);
      }
    }
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
    this.refreshAgentActivity(now);

    // If no active cycle, check if we can start one
    if (!this.currentCycle) {
      this.handleIdleState(now);
      return;
    }

    // Process current phase
    switch (this.currentCycle.phase) {
      case "ANNOUNCEMENT":
        this.tickAnnouncement(now);
        break;
      case "COUNTDOWN":
        // Countdown handled by separate interval
        break;
      case "FIGHTING":
        this.tickFighting(now);
        break;
      case "RESOLUTION":
        this.tickResolution(now);
        break;
    }

    // Update camera target
    this.updateCameraTarget(now);
  }

  // ============================================================================
  // State Machine Management
  // ============================================================================

  /**
   * Handle idle state - check if we can start a new cycle
   * Implements proper error handling and auto-recovery for insufficient agents
   */
  private handleIdleState(now: number): void {
    this.clearStaleDuelFlagsForIdleAgents();

    const agentCount = this.availableAgents.size;

    if (agentCount >= config.minAgents) {
      // Reset warning counter on success
      if (this.insufficientAgentWarningCount > 0) {
        Logger.info(
          "StreamingDuelScheduler",
          `Agent availability recovered: ${agentCount} agents now available`,
        );
        this.insufficientAgentWarningCount = 0;
      }

      // Transition to active state
      this.schedulerState = "ACTIVE";
      this.startNewCycle();
      return;
    }

    // Not enough agents - implement auto-recovery with logging
    this.schedulerState = "WAITING_FOR_AGENTS";

    // Throttle logging to avoid spam
    const timeSinceLastLog = now - this.lastInsufficientAgentsLog;
    if (timeSinceLastLog >= config.insufficientAgentsRetryInterval) {
      this.insufficientAgentWarningCount++;
      this.lastInsufficientAgentsLog = now;

      const message =
        `Insufficient agents for duel: ${agentCount}/${config.minAgents}. ` +
        `Waiting for agents to join... (check ${this.insufficientAgentWarningCount})`;

      if (
        this.insufficientAgentWarningCount >=
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
        warningCount: this.insufficientAgentWarningCount,
      });
    }
  }

  // ============================================================================
  // Cycle Management
  // ============================================================================

  private chooseRandomPairFromPool(
    pool: string[],
    now: number,
  ): NextDuelPair | null {
    if (pool.length < config.minAgents) {
      return null;
    }

    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const agent1Id = shuffled[0];
    const agent2Id = shuffled[1];
    if (!agent1Id || !agent2Id || agent1Id === agent2Id) {
      return null;
    }

    return { agent1Id, agent2Id, selectedAt: now };
  }

  private consumePreselectedDuelPair(
    validAgents: string[],
  ): NextDuelPair | null {
    if (!this.nextDuelPair) {
      return null;
    }

    const preselected = this.nextDuelPair;
    this.nextDuelPair = null;

    const validSet = new Set(validAgents);
    if (
      preselected.agent1Id !== preselected.agent2Id &&
      validSet.has(preselected.agent1Id) &&
      validSet.has(preselected.agent2Id)
    ) {
      return preselected;
    }

    return null;
  }

  private refreshNextDuelPair(now: number): void {
    const validAgents = Array.from(this.availableAgents).filter((agentId) =>
      Boolean(this.world.entities.get(agentId)),
    );
    if (validAgents.length < config.minAgents) {
      this.nextDuelPair = null;
      return;
    }

    const excluded = this.getCycleContestantIds();
    let pool = validAgents.filter((agentId) => !excluded.has(agentId));
    if (pool.length < config.minAgents) {
      pool = validAgents;
    }

    this.nextDuelPair = this.chooseRandomPairFromPool(pool, now);
  }

  private startNewCycle(): void {
    const cycleId = uuidv4();
    const now = Date.now();

    const agents = Array.from(this.availableAgents);

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
        this.availableAgents.delete(agentId);
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
      this.consumePreselectedDuelPair(validAgents) ??
      this.chooseRandomPairFromPool(validAgents, now);
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
    const agent1 = this.createContestant(agent1Id);
    const agent2 = this.createContestant(agent2Id);

    if (!agent1 || !agent2) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to create contestants: agent1=${!!agent1}, agent2=${!!agent2}`,
      );
      // Remove invalid agents from available list
      if (!agent1) this.availableAgents.delete(agent1Id);
      if (!agent2) this.availableAgents.delete(agent2Id);
      return;
    }

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
      winnerId: null,
      loserId: null,
      winReason: null,
    };
    this.duelFoodSlotsByAgent.clear();
    this.refreshNextDuelPair(now);

    // Set initial camera target
    this.setCameraTarget(agent1.characterId, now);

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

  private createContestant(agentId: string): AgentContestant | null {
    const entity = this.world.entities.get(agentId);
    if (!entity) return null;

    const data = entity.data as {
      name?: string;
      health?: number;
      maxHealth?: number;
      position?: [number, number, number] | { x: number; y: number; z: number };
      skills?: Record<string, { level: number }>;
    };

    const stats = this.agentStats.get(agentId);
    const parts = agentId.split("-");
    const provider = parts[1] || "unknown";
    const model = parts.slice(2).join("-") || "unknown";

    const entityPosition = (entity as { position?: unknown }).position;
    const normalizedPosition =
      this.normalizePosition(data.position) ??
      this.normalizePosition(entityPosition);
    const originalPosition = this.sanitizeRestorePosition(
      normalizedPosition,
      agentId,
    );

    // Calculate combat level
    const skills = data.skills || {};
    const attack = skills.attack?.level || 1;
    const strength = skills.strength?.level || 1;
    const defense = skills.defense?.level || 1;
    const constitution = skills.constitution?.level || 10;
    const combatLevel = Math.floor(
      (attack + strength + defense + constitution) / 4,
    );

    return {
      characterId: agentId,
      name: data.name || agentId,
      provider,
      model,
      combatLevel,
      wins: stats?.wins || 0,
      losses: stats?.losses || 0,
      currentHp: data.health || constitution,
      maxHp: data.maxHealth || constitution,
      originalPosition,
      damageDealtThisFight: 0,
    };
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

    const now = Date.now();
    this.currentCycle.phase = "COUNTDOWN";
    this.currentCycle.phaseStartTime = now;
    this.currentCycle.countdownValue = 3;
    this.setCameraTarget(this.currentCycle.agent1?.characterId ?? null, now);
    // Freeze contestant autonomy during countdown so they stay in arena lanes.
    this.setDuelFlags(true);

    Logger.info("StreamingDuelScheduler", "Starting countdown");

    // Prepare contestants first so countdown/fight never starts before teleport/food/HP prep.
    try {
      await this.prepareContestantsForDuel();
    } catch (err) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Contestant prep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Scheduler may have advanced/ended while awaiting prep.
    if (!this.currentCycle || this.currentCycle.phase !== "COUNTDOWN") {
      return;
    }

    // Start countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.countdownInterval = setInterval(() => {
      if (!this.currentCycle || this.currentCycle.phase !== "COUNTDOWN") {
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        return;
      }

      if (this.currentCycle.countdownValue === null) {
        this.currentCycle.countdownValue = 3;
      }

      // Emit countdown tick
      this.world.emit("streaming:countdown:tick", {
        cycleId: this.currentCycle.cycleId,
        count: this.currentCycle.countdownValue,
      });

      if (this.currentCycle.countdownValue === 0) {
        // Start fight
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        this.startFight();
      } else {
        this.currentCycle.countdownValue--;
      }
    }, 1000);
  }

  private async prepareContestantsForDuel(): Promise<void> {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    // Fill inventory with food
    const agent1FoodSlots = await this.fillInventoryWithFood(
      agent1.characterId,
    );
    const agent2FoodSlots = await this.fillInventoryWithFood(
      agent2.characterId,
    );
    this.duelFoodSlotsByAgent.set(agent1.characterId, agent1FoodSlots);
    this.duelFoodSlotsByAgent.set(agent2.characterId, agent2FoodSlots);

    // Restore full health
    this.restoreHealth(agent1.characterId);
    this.restoreHealth(agent2.characterId);

    // Teleport to arena
    await this.teleportToArena(agent1.characterId, agent2.characterId);

    // Ensure stale pathing state does not pull contestants away after teleport.
    this.world.emit("player:movement:cancel", { playerId: agent1.characterId });
    this.world.emit("player:movement:cancel", { playerId: agent2.characterId });

    Logger.info(
      "StreamingDuelScheduler",
      `Contestants prepared: ${agent1.name} vs ${agent2.name}`,
    );
  }

  private async fillInventoryWithFood(playerId: string): Promise<number[]> {
    const inventorySystem = this.world.getSystem("inventory") as {
      getInventory?: (playerId: string) =>
        | {
            playerId: string;
            items: Array<{ slot: number; itemId: string; quantity: number }>;
            coins: number;
          }
        | undefined;
      addItemDirect?: (
        playerId: string,
        item: { itemId: string; quantity: number; slot?: number },
      ) => Promise<boolean>;
      isInventoryReady?: (playerId: string) => boolean;
    } | null;

    if (!inventorySystem?.getInventory || !inventorySystem?.addItemDirect) {
      Logger.warn("StreamingDuelScheduler", "Inventory system not available");
      return [];
    }

    try {
      // Wait for inventory to be ready
      if (
        inventorySystem.isInventoryReady &&
        !inventorySystem.isInventoryReady(playerId)
      ) {
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (inventorySystem.isInventoryReady(playerId)) break;
        }
      }

      const inventory = inventorySystem.getInventory(playerId);
      if (!inventory) {
        Logger.warn(
          "StreamingDuelScheduler",
          `No inventory found for ${playerId}`,
        );
        return [];
      }

      // Get occupied slots
      const occupiedSlots = new Set(inventory.items.map((item) => item.slot));

      // Fill empty slots with food (assume 28 slots max)
      const maxSlots = 28;
      let foodAdded = 0;
      const addedSlots: number[] = [];

      for (let slot = 0; slot < maxSlots; slot++) {
        if (!occupiedSlots.has(slot)) {
          try {
            await inventorySystem.addItemDirect(playerId, {
              itemId: DUEL_FOOD_ITEM,
              quantity: 1,
              slot,
            });
            foodAdded++;
            addedSlots.push(slot);
          } catch (slotErr) {
            // Slot might be invalid, continue
          }
        }
      }

      Logger.info(
        "StreamingDuelScheduler",
        `Filled ${foodAdded} slots with food for ${playerId}`,
      );
      return addedSlots;
    } catch (err) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to fill inventory: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private restoreHealth(playerId: string): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) return;

    const data = entity.data as {
      health?: number;
      maxHealth?: number;
      alive?: boolean;
      position?:
        | [number, number, number]
        | { x?: number; y?: number; z?: number };
      skills?: Record<string, { level: number }>;
      deathState?: DeathState;
    };

    // Calculate max health from constitution
    const constitution = data.skills?.constitution?.level || 10;
    const maxHealth = constitution;

    // Restore to full and clear stale death state so startCombat() can engage.
    if (entity instanceof PlayerEntity) {
      entity.resetDeathState();
      entity.setHealth(maxHealth);
      entity.markNetworkDirty();
    } else {
      data.health = maxHealth;
      data.maxHealth = maxHealth;
      data.deathState = DeathState.ALIVE;

      const healthComponent = (
        entity as {
          getComponent?: (name: string) => {
            data?: { current?: number; max?: number; isDead?: boolean };
          } | null;
        }
      ).getComponent?.("health");

      if (healthComponent?.data) {
        healthComponent.data.current = maxHealth;
        healthComponent.data.max = maxHealth;
        healthComponent.data.isDead = false;
      }
    }

    // Keep raw entity data in sync for network serialization.
    data.health = maxHealth;
    data.maxHealth = maxHealth;
    data.alive = true;
    data.deathState = DeathState.ALIVE;

    const respawnPosition =
      this.normalizePosition(data.position) ??
      this.normalizePosition((entity as { position?: unknown }).position) ??
      this.getFallbackLobbyPosition(playerId);

    // Synchronize PlayerSystem alive/death flags after duel-owned deaths.
    this.world.emit(EventType.PLAYER_RESPAWNED, {
      playerId,
      spawnPosition: {
        x: respawnPosition[0],
        y: respawnPosition[1],
        z: respawnPosition[2],
      },
      townName: "Streaming Duel Arena",
    });

    // Ensure client and server systems clear any lingering dead flags.
    this.world.emit(EventType.PLAYER_SET_DEAD, {
      playerId,
      isDead: false,
    });

    // Update contestant data
    if (this.currentCycle?.agent1?.characterId === playerId) {
      this.currentCycle.agent1.currentHp = maxHealth;
      this.currentCycle.agent1.maxHp = maxHealth;
    } else if (this.currentCycle?.agent2?.characterId === playerId) {
      this.currentCycle.agent2.currentHp = maxHealth;
      this.currentCycle.agent2.maxHp = maxHealth;
    }

    // Emit health update
    this.world.emit(EventType.ENTITY_MODIFIED, {
      id: playerId,
      changes: { health: maxHealth, maxHealth },
    });
  }

  private async teleportToArena(
    agent1Id: string,
    agent2Id: string,
  ): Promise<void> {
    // Use a single reserved regular duel arena so all agent duels happen in
    // the same standard arena as player duels (no custom arena coordinates).
    const arenaConfig = getDuelArenaConfig();
    const arenaId = Math.max(
      1,
      Math.min(STREAMING_AGENT_ARENA_ID, arenaConfig.arenaCount),
    );
    const row = Math.floor((arenaId - 1) / arenaConfig.columns);
    const col = (arenaId - 1) % arenaConfig.columns;
    const arenaCenterX =
      arenaConfig.baseX +
      col * (arenaConfig.arenaWidth + arenaConfig.arenaGap) +
      arenaConfig.arenaWidth / 2;
    const arenaCenterZ =
      arenaConfig.baseZ +
      row * (arenaConfig.arenaLength + arenaConfig.arenaGap) +
      arenaConfig.arenaLength / 2;
    const centerTileX = Math.floor(arenaCenterX);
    const centerTileZ = Math.floor(arenaCenterZ);

    const agent1X = centerTileX + 0.5;
    const agent1Z = centerTileZ - 0.5;
    const agent2X = centerTileX + 0.5;
    const agent2Z = centerTileZ + 0.5;

    // Agent 1 spawns north (negative Z)
    const agent1Pos: [number, number, number] = [
      agent1X,
      this.getGroundedY(agent1X, agent1Z, arenaConfig.baseY),
      agent1Z,
    ];

    // Agent 2 spawns south (positive Z)
    const agent2Pos: [number, number, number] = [
      agent2X,
      this.getGroundedY(agent2X, agent2Z, arenaConfig.baseY),
      agent2Z,
    ];

    // Teleport both agents, facing each other
    this.teleportPlayer(agent1Id, agent1Pos, agent2Pos);
    this.teleportPlayer(agent2Id, agent2Pos, agent1Pos);

    this.currentCycle!.arenaId = arenaId;

    Logger.info(
      "StreamingDuelScheduler",
      "Contestants teleported to arena, facing each other",
    );
  }

  /**
   * Get grounded Y using terrain height when available.
   */
  private getGroundedY(x: number, z: number, fallbackY: number): number {
    const terrain = this.world.getSystem("terrain") as {
      getHeightAt?: (x: number, z: number) => number;
    } | null;

    const sampledY = terrain?.getHeightAt?.(x, z);
    return typeof sampledY === "number" && Number.isFinite(sampledY)
      ? sampledY
      : fallbackY;
  }

  private normalizePosition(
    position: unknown,
  ): [number, number, number] | null {
    if (Array.isArray(position) && position.length >= 3) {
      const x = Number(position[0]);
      const y = Number(position[1]);
      const z = Number(position[2]);
      if (Number.isFinite(x) && Number.isFinite(z)) {
        return [x, Number.isFinite(y) ? y : 0, z];
      }
      return null;
    }

    if (position && typeof position === "object") {
      const pos = position as { x?: number; y?: number; z?: number };
      if (Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
        return [pos.x as number, Number(pos.y ?? 0), pos.z as number];
      }
    }

    return null;
  }

  /**
   * Deterministic fallback near duel lobby to avoid overlapping resets.
   */
  private getFallbackLobbyPosition(agentId: string): [number, number, number] {
    const lobby = getDuelArenaConfig().lobbySpawnPoint;

    let hash = 0;
    for (let i = 0; i < agentId.length; i++) {
      hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
    }

    const angle = ((hash % 360) * Math.PI) / 180;
    const radius = 6 + (hash % 4);
    const x = lobby.x + Math.cos(angle) * radius;
    const z = lobby.z + Math.sin(angle) * radius;
    const y = this.getGroundedY(x, z, lobby.y);

    return [x, y, z];
  }

  /**
   * Keep restore positions safe for spectator camera and terrain grounding.
   */
  private sanitizeRestorePosition(
    position: [number, number, number] | null,
    agentId: string,
  ): [number, number, number] {
    const fallback = this.getFallbackLobbyPosition(agentId);
    if (!position) {
      return fallback;
    }

    const [x, y, z] = position;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return fallback;
    }

    // Never restore non-dueling agents back into combat arena tiles.
    if (isPositionInsideCombatArena(x, z)) {
      return fallback;
    }

    // Keep post-duel restores near the duel lobby area to avoid origin/out-of-map
    // drift from stale respawn state or invalid legacy coordinates.
    const lobby = getDuelArenaConfig().lobbySpawnPoint;
    const distanceFromLobby = Math.hypot(x - lobby.x, z - lobby.z);
    if (distanceFromLobby > 120) {
      return fallback;
    }

    const terrainY = this.getGroundedY(x, z, fallback[1]);
    const yTooLow = !Number.isFinite(y) || y < terrainY - 15;
    const yTooHigh = Number.isFinite(y) && y > terrainY + 80;
    const safeY = yTooLow || yTooHigh ? terrainY : y;

    return [x, safeY, z];
  }

  private teleportPlayer(
    playerId: string,
    position: [number, number, number],
    faceToward?: [number, number, number],
  ): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) return;

    // Position as object for events
    const posObj = { x: position[0], y: position[1], z: position[2] };

    // Calculate rotation to face opponent if specified
    let rotation = 0;
    if (faceToward) {
      const dx = faceToward[0] - position[0];
      const dz = faceToward[2] - position[2];
      rotation = Math.atan2(dx, dz);
    }

    // Update entity data - keep as tuple format for type compatibility
    entity.data.position = position;
    entity.data.rotation = rotation;

    // Mark as teleport for network sync (tells client to snap, not lerp)
    entity.data._teleport = true;

    // Emit teleport event for network system to handle properly
    this.world.emit("player:teleport", {
      playerId,
      position: posObj,
      rotation,
    });

    // Emit entity modified for immediate sync
    this.world.emit(EventType.ENTITY_MODIFIED, {
      id: playerId,
      changes: {
        position,
        rotation,
        _teleport: true,
      },
    });

    Logger.debug(
      "StreamingDuelScheduler",
      `Teleported ${playerId} to [${position.join(", ")}]`,
    );
  }

  private startFight(): void {
    if (!this.currentCycle) return;

    const now = Date.now();
    this.currentCycle.phase = "FIGHTING";
    this.currentCycle.phaseStartTime = now;
    this.currentCycle.countdownValue = null;
    this.resetFightCutawayTracking();
    this.setCameraTarget(this.currentCycle.agent1?.characterId ?? null, now);

    Logger.info("StreamingDuelScheduler", "Fight started!");

    // Mark agents as in duel (prevents normal respawn mechanics)
    this.setDuelFlags(true);

    // Emit fight start
    this.world.emit("streaming:fight:start", {
      cycleId: this.currentCycle.cycleId,
      agent1Id: this.currentCycle.agent1?.characterId,
      agent2Id: this.currentCycle.agent2?.characterId,
      duration:
        STREAMING_TIMING.FIGHTING_DURATION +
        STREAMING_TIMING.END_WARNING_DURATION,
    });

    // Make agents attack each other
    this.initiateAgentCombat();

    // Start DuelCombatAI for each agent (tick-based heal/buff/attack decisions)
    this.startCombatAIs().catch((err) => {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to start combat AIs: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Start DuelCombatAI instances for both agents.
   * These run alongside the re-engagement loop and handle food eating,
   * potion usage, and combat phase awareness (opening, trading, finishing).
   */
  private async startCombatAIs(): Promise<void> {
    this.stopCombatAIs();

    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    const { getAgentManager } = await import("../../eliza/AgentManager.js");
    const { getAgentRuntimeByCharacterId } =
      await import("../../eliza/ModelAgentSpawner.js");
    const manager = getAgentManager();

    const service1 = manager?.getAgentService(agent1.characterId) ?? null;
    const service2 = manager?.getAgentService(agent2.characterId) ?? null;
    const runtime1 = getAgentRuntimeByCharacterId(agent1.characterId);
    const runtime2 = getAgentRuntimeByCharacterId(agent2.characterId);

    if (service1) {
      const ai1 = new DuelCombatAI(
        service1,
        agent2.characterId,
        { useLlmTactics: !!runtime1 },
        runtime1 ?? undefined,
      );
      ai1.setContext(agent1.name, agent2.combatLevel);
      ai1.start();
      this.combatAIs.set(agent1.characterId, ai1);
      Logger.info(
        "StreamingDuelScheduler",
        `Combat AI started for ${agent1.name} (LLM strategy enabled)`,
      );
    }

    if (service2) {
      const ai2 = new DuelCombatAI(
        service2,
        agent1.characterId,
        { useLlmTactics: !!runtime2 },
        runtime2 ?? undefined,
      );
      ai2.setContext(agent2.name, agent1.combatLevel);
      ai2.start();
      this.combatAIs.set(agent2.characterId, ai2);
      Logger.info(
        "StreamingDuelScheduler",
        `Combat AI started for ${agent2.name} (LLM strategy enabled)`,
      );
    }
  }

  /** Stop all DuelCombatAI instances and log their stats */
  private stopCombatAIs(): void {
    for (const [characterId, ai] of this.combatAIs) {
      const stats = ai.getStats();
      Logger.info(
        "StreamingDuelScheduler",
        `Combat AI stats for ${characterId}: ${stats.attacksLanded} attacks, ${stats.healsUsed} heals, ${stats.totalDamageDealt} dmg dealt`,
      );
      ai.stop();
    }
    this.combatAIs.clear();
  }

  /** Set or clear duel flags on agents to prevent normal respawn */
  private setDuelFlags(inDuel: boolean): void {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    const entity1 = this.world.entities.get(agent1.characterId);
    const entity2 = this.world.entities.get(agent2.characterId);

    if (entity1) {
      entity1.data.inStreamingDuel = inDuel;
      entity1.data.preventRespawn = inDuel;
    }
    if (entity2) {
      entity2.data.inStreamingDuel = inDuel;
      entity2.data.preventRespawn = inDuel;
    }
  }

  private initiateAgentCombat(): void {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    // Get combat system
    const combatSystem = this.world.getSystem("combat") as {
      startCombat?: (
        attackerId: string,
        targetId: string,
        options?: { attackerType?: string; targetType?: string },
      ) => boolean;
    } | null;

    if (combatSystem?.startCombat) {
      this.ensureDuelProximity(agent1.characterId, agent2.characterId);

      // Both agents attack each other (player vs player)
      const started1 = combatSystem.startCombat(
        agent1.characterId,
        agent2.characterId,
        {
          attackerType: "player",
          targetType: "player",
        },
      );
      if (!started1) {
        this.logCombatStartFailure(
          agent1.characterId,
          agent2.characterId,
          "a1",
        );
      }

      // Resolution may have started during the first attack (e.g., lethal hit).
      if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
        return;
      }

      const started2 = combatSystem.startCombat(
        agent2.characterId,
        agent1.characterId,
        {
          attackerType: "player",
          targetType: "player",
        },
      );
      if (!started2) {
        this.logCombatStartFailure(
          agent2.characterId,
          agent1.characterId,
          "a2",
        );
      }

      Logger.info(
        "StreamingDuelScheduler",
        `Combat initiated between ${agent1.name} and ${agent2.name}`,
      );
    } else {
      Logger.warn(
        "StreamingDuelScheduler",
        "Combat system not available or missing startCombat method",
      );
    }

    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return;
    }

    // Set combat targets on entities directly as backup
    this.setAgentCombatTarget(agent1.characterId, agent2.characterId);
    this.setAgentCombatTarget(agent2.characterId, agent1.characterId);

    // Start combat re-engagement loop to keep agents fighting
    this.startCombatLoop();
  }

  /** Set combat target on an agent entity */
  private setAgentCombatTarget(agentId: string, targetId: string): void {
    const entity = this.world.entities.get(agentId);
    if (!entity) return;

    entity.data.combatTarget = targetId;
    entity.data.inCombat = true;
    entity.data.attackTarget = targetId;
  }

  /**
   * Keep duel contestants within melee range to guarantee engagement.
   */
  private ensureDuelProximity(agent1Id: string, agent2Id: string): void {
    const distance = this.getTileChebyshevDistance(agent1Id, agent2Id);
    if (distance !== null && distance !== 1) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Contestants not in valid melee spacing (tileDistance=${distance}), re-teleporting`,
      );
      void this.teleportToArena(agent1Id, agent2Id);
    }
  }

  private logCombatStartFailure(
    attackerId: string,
    targetId: string,
    side: "a1" | "a2",
  ): void {
    const distance = this.getTileChebyshevDistance(attackerId, targetId);
    Logger.warn(
      "StreamingDuelScheduler",
      `startCombat failed (${side}) attacker=${attackerId} target=${targetId} tileDistance=${distance ?? "unknown"}`,
    );
  }

  private getTileChebyshevDistance(
    entityAId: string,
    entityBId: string,
  ): number | null {
    const entityA = this.world.entities.get(entityAId);
    const entityB = this.world.entities.get(entityBId);
    if (!entityA || !entityB) return null;

    const posA = entityA.data.position as
      | [number, number, number]
      | { x: number; y?: number; z: number }
      | undefined;
    const posB = entityB.data.position as
      | [number, number, number]
      | { x: number; y?: number; z: number }
      | undefined;
    if (!posA || !posB) return null;

    const ax = Array.isArray(posA) ? posA[0] : posA.x;
    const az = Array.isArray(posA) ? posA[2] : posA.z;
    const bx = Array.isArray(posB) ? posB[0] : posB.x;
    const bz = Array.isArray(posB) ? posB[2] : posB.z;

    const tileAx = Math.floor(ax);
    const tileAz = Math.floor(az);
    const tileBx = Math.floor(bx);
    const tileBz = Math.floor(bz);
    return Math.max(Math.abs(tileAx - tileBx), Math.abs(tileAz - tileBz));
  }

  /** Combat re-engagement interval */
  private combatLoopInterval: ReturnType<typeof setInterval> | null = null;

  /** Start a loop that keeps agents engaged in combat */
  private startCombatLoop(): void {
    // Clear any existing loop
    if (this.combatLoopInterval) {
      clearInterval(this.combatLoopInterval);
    }

    // Re-engage combat every 3 seconds as a fallback.
    // When DuelCombatAI instances are active, they handle targeting on a 600ms tick,
    // so this loop only sets combatTarget if the AI hasn't already.
    this.combatLoopInterval = setInterval(() => {
      if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
        if (this.combatLoopInterval) {
          clearInterval(this.combatLoopInterval);
          this.combatLoopInterval = null;
        }
        return;
      }

      // Skip re-engagement when DuelCombatAI is handling combat
      if (this.combatAIs.size > 0) return;

      const { agent1, agent2 } = this.currentCycle;
      if (!agent1 || !agent2) return;

      const entity1 = this.world.entities.get(agent1.characterId);
      const entity2 = this.world.entities.get(agent2.characterId);

      if (entity1 && !entity1.data.combatTarget) {
        this.setAgentCombatTarget(agent1.characterId, agent2.characterId);
      }
      if (entity2 && !entity2.data.combatTarget) {
        this.setAgentCombatTarget(agent2.characterId, agent1.characterId);
      }

      // Re-initiate combat via system
      const combatSystem = this.world.getSystem("combat") as {
        startCombat?: (
          attackerId: string,
          targetId: string,
          options?: { attackerType?: string; targetType?: string },
        ) => boolean;
      } | null;

      if (combatSystem?.startCombat) {
        this.ensureDuelProximity(agent1.characterId, agent2.characterId);

        const started1 = combatSystem.startCombat(
          agent1.characterId,
          agent2.characterId,
          {
            attackerType: "player",
            targetType: "player",
          },
        );
        if (!started1) {
          this.logCombatStartFailure(
            agent1.characterId,
            agent2.characterId,
            "a1",
          );
        }

        // First attack may have ended the duel; do not allow stale follow-up hit.
        if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
          return;
        }

        const started2 = combatSystem.startCombat(
          agent2.characterId,
          agent1.characterId,
          {
            attackerType: "player",
            targetType: "player",
          },
        );
        if (!started2) {
          this.logCombatStartFailure(
            agent2.characterId,
            agent1.characterId,
            "a2",
          );
        }
      }
    }, 3000);
  }

  /** Stop the combat loop */
  private stopCombatLoop(): void {
    if (this.combatLoopInterval) {
      clearInterval(this.combatLoopInterval);
      this.combatLoopInterval = null;
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
      this.endFightByTimeout();
    }

    // Update HP from entities
    this.updateContestantHp();
  }

  private updateContestantHp(): void {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const entity1 = this.world.entities.get(
      this.currentCycle.agent1.characterId,
    );
    const entity2 = this.world.entities.get(
      this.currentCycle.agent2.characterId,
    );

    if (entity1) {
      const data = entity1.data as { health?: number; maxHealth?: number };
      this.currentCycle.agent1.currentHp = data.health || 0;
      this.currentCycle.agent1.maxHp = data.maxHealth || 10;
    }

    if (entity2) {
      const data = entity2.data as { health?: number; maxHealth?: number };
      this.currentCycle.agent2.currentHp = data.health || 0;
      this.currentCycle.agent2.maxHp = data.maxHealth || 10;
    }
  }

  private endFightByTimeout(): void {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    // Determine winner by HP percentage
    const hp1Percent = agent1.currentHp / agent1.maxHp;
    const hp2Percent = agent2.currentHp / agent2.maxHp;

    let winnerId: string;
    let loserId: string;
    let winReason: "hp_advantage" | "damage_advantage" | "draw";

    if (hp1Percent > hp2Percent) {
      winnerId = agent1.characterId;
      loserId = agent2.characterId;
      winReason = "hp_advantage";
    } else if (hp2Percent > hp1Percent) {
      winnerId = agent2.characterId;
      loserId = agent1.characterId;
      winReason = "hp_advantage";
    } else {
      // Tied HP - check damage dealt
      if (agent1.damageDealtThisFight > agent2.damageDealtThisFight) {
        winnerId = agent1.characterId;
        loserId = agent2.characterId;
        winReason = "damage_advantage";
      } else if (agent2.damageDealtThisFight > agent1.damageDealtThisFight) {
        winnerId = agent2.characterId;
        loserId = agent1.characterId;
        winReason = "damage_advantage";
      } else {
        // True draw - agent1 wins by coin flip
        winnerId =
          Math.random() > 0.5 ? agent1.characterId : agent2.characterId;
        loserId =
          winnerId === agent1.characterId
            ? agent2.characterId
            : agent1.characterId;
        winReason = "draw";
      }
    }

    this.startResolution(winnerId, loserId, winReason);
  }

  private startResolution(
    winnerId: string,
    loserId: string,
    winReason: "kill" | "hp_advantage" | "damage_advantage" | "draw",
  ): void {
    if (!this.currentCycle) return;

    // Stop the combat loop
    this.stopCombatLoop();

    const now = Date.now();
    this.currentCycle.phase = "RESOLUTION";
    this.currentCycle.phaseStartTime = now;
    this.currentCycle.winnerId = winnerId;
    this.currentCycle.loserId = loserId;
    this.currentCycle.winReason = winReason;

    // Update stats
    this.updateStats(winnerId, loserId);

    // Get winner name
    const winnerName =
      this.currentCycle.agent1?.characterId === winnerId
        ? this.currentCycle.agent1.name
        : this.currentCycle.agent2?.name || "Unknown";
    const loserName =
      this.currentCycle.agent1?.characterId === loserId
        ? this.currentCycle.agent1.name
        : this.currentCycle.agent2?.name || "Unknown";
    this.recordRecentDuel({
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
    this.finishFightCutawayTracking(now);
    this.setCameraTarget(winnerId, now);

    // Restore health and clean up
    this.cleanupAfterDuel();
  }

  private recordRecentDuel(duel: RecentDuelEntry): void {
    this.recentDuels.unshift(duel);
    if (this.recentDuels.length > config.maxRecentDuels) {
      this.recentDuels.length = config.maxRecentDuels;
    }
  }

  private updateStats(winnerId: string, loserId: string): void {
    const winnerStats = this.agentStats.get(winnerId);
    const loserStats = this.agentStats.get(loserId);

    if (winnerStats) {
      winnerStats.wins++;
      winnerStats.currentStreak++;
    }

    if (loserStats) {
      loserStats.losses++;
      loserStats.currentStreak = 0;
    }

    // Persist to database asynchronously
    this.persistStatsToDatabase(winnerId, loserId).catch((err) => {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to persist stats to database: ${err}`,
      );
    });
  }

  /**
   * Persist duel stats to the database
   */
  private async persistStatsToDatabase(
    winnerId: string,
    loserId: string,
  ): Promise<void> {
    const databaseSystem = this.world.getSystem("database") as {
      getDb?: () => import("drizzle-orm/node-postgres").NodePgDatabase | null;
    } | null;

    const db = databaseSystem?.getDb?.();
    if (!db) {
      Logger.warn(
        "StreamingDuelScheduler",
        "Database not available for stats persistence",
      );
      return;
    }

    try {
      // Import schema dynamically to avoid circular dependencies
      const { playerCombatStats, agentDuelStats } =
        await import("../../database/schema.js");
      const { sql } = await import("drizzle-orm");

      const now = Date.now();

      // Update winner stats (playerCombatStats)
      await db
        .insert(playerCombatStats)
        .values({
          playerId: winnerId,
          totalDuelWins: 1,
          totalDuelLosses: 0,
        })
        .onConflictDoUpdate({
          target: playerCombatStats.playerId,
          set: {
            totalDuelWins: sql`${playerCombatStats.totalDuelWins} + 1`,
            updatedAt: sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT`,
          },
        });

      // Update loser stats (playerCombatStats)
      await db
        .insert(playerCombatStats)
        .values({
          playerId: loserId,
          totalDuelWins: 0,
          totalDuelLosses: 1,
        })
        .onConflictDoUpdate({
          target: playerCombatStats.playerId,
          set: {
            totalDuelLosses: sql`${playerCombatStats.totalDuelLosses} + 1`,
            updatedAt: sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT`,
          },
        });

      // Persist agent-specific stats (agentDuelStats) for AI model tracking
      const winnerAgentStats = this.agentStats.get(winnerId);
      const loserAgentStats = this.agentStats.get(loserId);

      if (winnerAgentStats) {
        const winner =
          this.currentCycle?.agent1?.characterId === winnerId
            ? this.currentCycle?.agent1
            : this.currentCycle?.agent2;
        const damageDealt = winner?.damageDealtThisFight ?? 0;

        await db
          .insert(agentDuelStats)
          .values({
            characterId: winnerId,
            agentName: winnerAgentStats.name,
            provider: winnerAgentStats.provider,
            model: winnerAgentStats.model,
            wins: winnerAgentStats.wins,
            losses: winnerAgentStats.losses,
            draws: 0,
            totalDamageDealt: damageDealt,
            totalDamageTaken: 0,
            killStreak: Math.max(winnerAgentStats.currentStreak, 1),
            currentStreak: winnerAgentStats.currentStreak,
            lastDuelAt: now,
          })
          .onConflictDoUpdate({
            target: agentDuelStats.characterId,
            set: {
              wins: sql`${agentDuelStats.wins} + 1`,
              totalDamageDealt: sql`${agentDuelStats.totalDamageDealt} + ${damageDealt}`,
              killStreak: sql`GREATEST(${agentDuelStats.killStreak}, ${agentDuelStats.currentStreak} + 1)`,
              currentStreak: sql`${agentDuelStats.currentStreak} + 1`,
              lastDuelAt: now,
              updatedAt: sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT`,
            },
          });
      }

      if (loserAgentStats) {
        const loser =
          this.currentCycle?.agent1?.characterId === loserId
            ? this.currentCycle?.agent1
            : this.currentCycle?.agent2;
        const damageDealt = loser?.damageDealtThisFight ?? 0;

        await db
          .insert(agentDuelStats)
          .values({
            characterId: loserId,
            agentName: loserAgentStats.name,
            provider: loserAgentStats.provider,
            model: loserAgentStats.model,
            wins: loserAgentStats.wins,
            losses: loserAgentStats.losses,
            draws: 0,
            totalDamageDealt: damageDealt,
            totalDamageTaken: 0,
            killStreak: 0,
            currentStreak: 0,
            lastDuelAt: now,
          })
          .onConflictDoUpdate({
            target: agentDuelStats.characterId,
            set: {
              losses: sql`${agentDuelStats.losses} + 1`,
              totalDamageDealt: sql`${agentDuelStats.totalDamageDealt} + ${damageDealt}`,
              currentStreak: 0,
              lastDuelAt: now,
              updatedAt: sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT`,
            },
          });
      }

      Logger.info(
        "StreamingDuelScheduler",
        `Stats persisted: ${winnerId} won, ${loserId} lost`,
      );
    } catch (err) {
      Logger.warn("StreamingDuelScheduler", `Error persisting stats: ${err}`);
    }
  }

  private async cleanupAfterDuel(): Promise<void> {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    // Restore health
    this.restoreHealth(agent1.characterId);
    this.restoreHealth(agent2.characterId);

    // Remove duel food from inventory
    await this.removeDuelFood(
      agent1.characterId,
      this.duelFoodSlotsByAgent.get(agent1.characterId) ?? [],
    );
    await this.removeDuelFood(
      agent2.characterId,
      this.duelFoodSlotsByAgent.get(agent2.characterId) ?? [],
    );
    this.duelFoodSlotsByAgent.delete(agent1.characterId);
    this.duelFoodSlotsByAgent.delete(agent2.characterId);

    // Teleport back to validated original positions
    const agent1RestorePosition = this.sanitizeRestorePosition(
      agent1.originalPosition,
      agent1.characterId,
    );
    const agent2RestorePosition = this.sanitizeRestorePosition(
      agent2.originalPosition,
      agent2.characterId,
    );
    this.teleportPlayer(agent1.characterId, agent1RestorePosition);
    this.teleportPlayer(agent2.characterId, agent2RestorePosition);

    // Stop combat
    this.stopCombat(agent1.characterId);
    this.stopCombat(agent2.characterId);

    // Defer flag clear until current death-event dispatch unwinds. If we clear
    // synchronously here, PlayerDeathSystem may treat duel deaths as normal deaths
    // and force a Central Haven respawn before cleanup completes.
    globalThis.queueMicrotask(() => {
      this.clearDuelFlagsForCycle(this.currentCycle);
    });
  }

  /**
   * Clear streaming duel flags for contestants in a cycle.
   */
  private clearDuelFlagsForCycle(cycle: StreamingDuelCycle | null): void {
    if (!cycle?.agent1 || !cycle.agent2) {
      return;
    }

    const ids = [cycle.agent1.characterId, cycle.agent2.characterId];
    for (const playerId of ids) {
      const entity = this.world.entities.get(playerId);
      if (!entity) {
        continue;
      }
      entity.data.inStreamingDuel = false;
      entity.data.preventRespawn = false;
    }
  }

  /**
   * Clear stale duel flags from idle agents when no duel owns them.
   */
  private clearStaleDuelFlagsForIdleAgents(): void {
    if (this.currentCycle) {
      return;
    }

    for (const agentId of this.availableAgents) {
      const entity = this.world.entities.get(agentId);
      if (!entity) {
        continue;
      }

      if (
        entity.data.inStreamingDuel === true ||
        entity.data.preventRespawn === true
      ) {
        entity.data.inStreamingDuel = false;
        entity.data.preventRespawn = false;
      }
    }
  }

  private async removeDuelFood(
    playerId: string,
    duelFoodSlots: number[],
  ): Promise<void> {
    if (duelFoodSlots.length === 0) {
      return;
    }

    const inventorySystem = this.world.getSystem("inventory") as {
      getInventory?: (playerId: string) =>
        | {
            playerId: string;
            items: Array<{ slot: number; itemId: string; quantity: number }>;
            coins: number;
          }
        | undefined;
      removeItem?: (data: {
        playerId: string;
        itemId: string;
        quantity: number;
        slot?: number;
      }) => Promise<boolean>;
    } | null;

    if (!inventorySystem?.getInventory || !inventorySystem?.removeItem) {
      return;
    }

    try {
      const inventory = inventorySystem.getInventory(playerId);
      if (!inventory) return;

      const itemsBySlot = new Map(
        inventory.items.map((item) => [item.slot, item] as const),
      );
      let removed = 0;

      for (const slot of duelFoodSlots) {
        const item = itemsBySlot.get(slot);
        if (!item) continue;

        // Defensive check: only remove duel food at tracked slots.
        if (
          item.itemId !== DUEL_FOOD_ITEM &&
          !item.itemId.endsWith(DUEL_FOOD_ITEM)
        ) {
          continue;
        }

        try {
          await inventorySystem.removeItem({
            playerId,
            itemId: item.itemId,
            quantity: item.quantity,
            slot: item.slot,
          });
          removed++;
        } catch (slotErr) {
          // Continue on error
        }
      }

      if (removed > 0) {
        Logger.info(
          "StreamingDuelScheduler",
          `Removed ${removed} food items from ${playerId}`,
        );
      }
    } catch (err) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to remove duel food: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private stopCombat(playerId: string): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) return;

    entity.data.combatTarget = null;
    entity.data.inCombat = false;
  }

  private tickResolution(now: number): void {
    if (!this.currentCycle) return;

    const elapsed = now - this.currentCycle.phaseStartTime;

    // Check if resolution phase is over
    if (elapsed >= STREAMING_TIMING.RESOLUTION_DURATION) {
      this.endCycle();
    }
  }

  private endCycle(): void {
    if (!this.currentCycle) return;

    const now = Date.now();
    const winnerId = this.currentCycle.winnerId;
    const loserId = this.currentCycle.loserId;

    Logger.info(
      "StreamingDuelScheduler",
      `Cycle ${this.currentCycle.cycleId} ended. Winner: ${winnerId || "none"}`,
    );

    // Emit cycle end
    this.world.emit("streaming:resolution:end", {
      cycleId: this.currentCycle.cycleId,
      winnerId,
      loserId,
    });
    this.finishFightCutawayTracking(now);

    // Clear current cycle
    this.currentCycle = null;

    // Transition state machine - will be handled by next tick
    this.schedulerState = "IDLE";

    // Start new cycle immediately if we have enough agents
    if (this.availableAgents.size >= config.minAgents) {
      this.schedulerState = "ACTIVE";
      this.startNewCycle();
    } else {
      this.schedulerState = "WAITING_FOR_AGENTS";
      Logger.info(
        "StreamingDuelScheduler",
        `Waiting for agents after cycle end: ${this.availableAgents.size}/${config.minAgents}`,
      );
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleDuelCompleted(payload: unknown): void {
    // This is called if the duel system resolves the duel (e.g., death)
    // We may need to transition to resolution phase early
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
        this.startResolution(winnerId, loserId, "kill");
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
    this.markAgentInteresting(attackerId, intensity, now);
    this.markAgentInteresting(targetId, intensity * 0.7, now);

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
  }

  private handleEntityDeath(payload: unknown): void {
    const data = payload as {
      entityId?: string;
      killedBy?: string;
    };

    const now = Date.now();
    if (data.killedBy) {
      this.markAgentInteresting(data.killedBy, 4.2, now);
    }
    if (data.entityId) {
      this.markAgentInteresting(data.entityId, 1.2, now);
    }

    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
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
        this.startResolution(winnerId, loserId, "kill");
      }
    }
  }

  // ============================================================================
  // Camera Management
  // ============================================================================

  /**
   * Resolve a safe camera target for the current cycle.
   *
   * If the tracked target drifts stale/null, fall back to active contestants so
   * spectator clients always receive a valid duel-focused target.
   */
  private getCycleContestantIds(): Set<string> {
    const ids = new Set<string>();
    if (this.currentCycle?.agent1?.characterId) {
      ids.add(this.currentCycle.agent1.characterId);
    }
    if (this.currentCycle?.agent2?.characterId) {
      ids.add(this.currentCycle.agent2.characterId);
    }
    return ids;
  }

  private getNextDuelAgentIds(contestantIds: Set<string>): Set<string> {
    const ids = new Set<string>();
    const nextPair = this.nextDuelPair;
    if (!nextPair) {
      return ids;
    }

    const pairIds = [nextPair.agent1Id, nextPair.agent2Id];
    let validPairMembers = 0;
    for (const agentId of pairIds) {
      if (this.isAgentValidCameraCandidate(agentId)) {
        validPairMembers++;
        if (!contestantIds.has(agentId)) {
          ids.add(agentId);
        }
      }
    }

    if (validPairMembers < config.minAgents) {
      this.nextDuelPair = null;
      return new Set<string>();
    }

    return ids;
  }

  private resetFightCutawayTracking(): void {
    this.fightCutawayStartedAt = null;
    this.fightCutawayTotalMs = 0;
    this.fightLastCutawayEndedAt = 0;
  }

  private finishFightCutawayTracking(now: number): void {
    if (this.fightCutawayStartedAt === null) {
      return;
    }
    this.fightCutawayTotalMs += Math.max(0, now - this.fightCutawayStartedAt);
    this.fightCutawayStartedAt = null;
    this.fightLastCutawayEndedAt = now;
  }

  private syncFightCutawayTracking(
    now: number,
    currentTarget: string | null,
  ): void {
    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      this.finishFightCutawayTracking(now);
      return;
    }

    const contestantIds = this.getCycleContestantIds();
    const trackingNonContestantTarget =
      currentTarget !== null && !contestantIds.has(currentTarget);

    if (!trackingNonContestantTarget) {
      this.finishFightCutawayTracking(now);
      return;
    }

    if (this.fightCutawayStartedAt === null) {
      this.fightCutawayStartedAt = now;
    }
  }

  private isFightCutawayAllowed(now: number): boolean {
    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return true;
    }

    const elapsedFightMs = now - this.currentCycle.phaseStartTime;
    if (
      elapsedFightMs < CAMERA_DIRECTOR.fightingCutaway.initialContestantLockMs
    ) {
      return false;
    }

    if (
      this.fightCutawayTotalMs >=
      CAMERA_DIRECTOR.fightingCutaway.maxTotalCutawayMs
    ) {
      return false;
    }

    if (this.fightCutawayStartedAt !== null) {
      return true;
    }

    if (
      this.fightLastCutawayEndedAt > 0 &&
      now - this.fightLastCutawayEndedAt <
        CAMERA_DIRECTOR.fightingCutaway.cutawayCooldownMs
    ) {
      return false;
    }

    const contestantIds = this.getCycleContestantIds();
    if (contestantIds.size === 0) {
      return false;
    }

    for (const contestantId of contestantIds) {
      const sample = this.ensureAgentActivity(contestantId, now);
      this.decayAgentActivity(sample, now);
      const entity = this.world.entities.get(contestantId);
      const data = (entity as { data?: AgentCombatData } | undefined)?.data;

      if (this.isAgentInCombat(data)) {
        return false;
      }

      const idleMs = now - sample.lastInterestingTime;
      if (idleMs < CAMERA_DIRECTOR.fightingCutaway.contestantIdleThresholdMs) {
        return false;
      }
    }

    return true;
  }

  private isFightCutawayExpired(now: number): boolean {
    if (this.fightCutawayStartedAt === null) {
      return false;
    }
    return (
      now - this.fightCutawayStartedAt >=
      CAMERA_DIRECTOR.fightingCutaway.maxSingleCutawayMs
    );
  }

  private selectBestContestantCandidate(
    candidates: CameraCandidateWeight[],
    preferredAgentId: string | null,
  ): CameraCandidateWeight | null {
    const contestantCandidates = candidates.filter(
      (candidate) => candidate.isContestant,
    );
    if (contestantCandidates.length === 0) {
      return null;
    }

    if (preferredAgentId) {
      const preferred = contestantCandidates.find(
        (candidate) => candidate.agentId === preferredAgentId,
      );
      if (preferred) {
        return preferred;
      }
    }

    let best = contestantCandidates[0];
    for (let i = 1; i < contestantCandidates.length; i++) {
      if (contestantCandidates[i].weight > best.weight) {
        best = contestantCandidates[i];
      }
    }
    return best;
  }

  private setCameraTarget(agentId: string | null, now: number): void {
    if (!agentId || !this.isAgentValidCameraCandidate(agentId)) {
      return;
    }

    const previous = this.cameraTarget;
    if (previous !== agentId) {
      this.cameraTarget = agentId;
      this.lastCameraSwitchTime = now;
    }
    this.markAgentFocused(agentId, now);
    this.syncFightCutawayTracking(now, this.cameraTarget);
  }

  private resolveCycleCameraTarget(): string | null {
    if (this.isAgentValidCameraCandidate(this.cameraTarget)) {
      return this.cameraTarget;
    }

    if (this.currentCycle?.phase === "RESOLUTION") {
      if (this.isAgentValidCameraCandidate(this.currentCycle.winnerId)) {
        return this.currentCycle.winnerId;
      }
    }

    const cycleAgents = [
      this.currentCycle?.agent1?.characterId,
      this.currentCycle?.agent2?.characterId,
    ];
    for (const agentId of cycleAgents) {
      if (this.isAgentValidCameraCandidate(agentId)) {
        return agentId as string;
      }
    }

    for (const agentId of this.availableAgents) {
      if (this.isAgentValidCameraCandidate(agentId)) {
        return agentId;
      }
    }

    return null;
  }

  private isAgentValidCameraCandidate(
    agentId: string | null | undefined,
  ): boolean {
    if (!agentId || !this.availableAgents.has(agentId)) {
      return false;
    }
    return Boolean(this.world.entities.get(agentId));
  }

  private getCameraSwitchTimingForPhase(
    phase: StreamingPhase,
  ): CameraSwitchTiming {
    return (
      CAMERA_DIRECTOR.switchTiming[phase] ?? CAMERA_DIRECTOR.switchTiming.IDLE
    );
  }

  private buildCameraCandidates(
    now: number,
    currentTarget: string | null,
    allowFightCutaway: boolean,
  ): CameraCandidateWeight[] {
    const candidates: CameraCandidateWeight[] = [];
    const phase = this.currentCycle?.phase ?? "IDLE";
    const contestantIds = this.getCycleContestantIds();
    const nextDuelIds = this.getNextDuelAgentIds(contestantIds);
    const phaseWeight = CAMERA_DIRECTOR.baseWeights[phase];

    for (const agentId of this.availableAgents) {
      const entity = this.world.entities.get(agentId);
      if (!entity) {
        continue;
      }

      const sample = this.ensureAgentActivity(agentId, now);
      this.decayAgentActivity(sample, now);
      const activityScore = this.getAgentActivityScore(agentId);
      const entityData = (entity as { data?: AgentCombatData }).data;
      const isInCombat = this.isAgentInCombat(entityData);
      const isContestant = contestantIds.has(agentId);

      let weight = isContestant
        ? phaseWeight.contestant
        : phaseWeight.nonContestant;
      if (
        phase === "RESOLUTION" &&
        agentId === this.currentCycle?.winnerId &&
        typeof phaseWeight.winner === "number"
      ) {
        weight = phaseWeight.winner;
      }

      if (isInCombat) {
        weight *= CAMERA_DIRECTOR.multipliers.inCombat;
      }

      if (!isContestant && nextDuelIds.has(agentId)) {
        weight *= CAMERA_DIRECTOR.nextDuelWeightBoost[phase];
      }

      if (phase === "FIGHTING" && !isContestant) {
        weight *= allowFightCutaway
          ? CAMERA_DIRECTOR.fightingCutaway.nonContestantAllowedMultiplier
          : CAMERA_DIRECTOR.fightingCutaway.nonContestantSuppressionMultiplier;
      }

      weight *=
        1 +
        clampNumber(
          activityScore,
          0,
          CAMERA_DIRECTOR.activity.maxActivityScore,
        ) *
          CAMERA_DIRECTOR.activity.weightPerPoint;

      const idleDurationMs = now - sample.lastInterestingTime;
      if (
        !isInCombat &&
        idleDurationMs > CAMERA_DIRECTOR.idlePenalty.hardThresholdMs
      ) {
        weight *= isContestant
          ? CAMERA_DIRECTOR.idlePenalty.hardContestantMultiplier
          : CAMERA_DIRECTOR.idlePenalty.hardNonContestantMultiplier;
      } else if (
        !isInCombat &&
        idleDurationMs > CAMERA_DIRECTOR.idlePenalty.softThresholdMs
      ) {
        weight *= CAMERA_DIRECTOR.idlePenalty.softMultiplier;
      }

      if (sample.lastFocusedTime > 0 && agentId !== currentTarget) {
        const msSinceFocused = now - sample.lastFocusedTime;
        if (msSinceFocused < 25_000) {
          weight *= CAMERA_DIRECTOR.multipliers.recentFocusPenaltyShort;
        } else if (msSinceFocused < 60_000) {
          weight *= CAMERA_DIRECTOR.multipliers.recentFocusPenaltyLong;
        }
      }

      if (agentId === currentTarget) {
        weight *= CAMERA_DIRECTOR.multipliers.currentTargetBias;
      }

      candidates.push({
        agentId,
        weight: Math.max(0.01, weight),
        activityScore,
        isInCombat,
        isContestant,
      });
    }

    return candidates;
  }

  private chooseWeightedCameraCandidate(
    candidates: CameraCandidateWeight[],
  ): CameraCandidateWeight | null {
    if (candidates.length === 0) {
      return null;
    }

    const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      return candidates[0];
    }

    let cursor = Math.random() * totalWeight;
    for (const item of candidates) {
      cursor -= item.weight;
      if (cursor <= 0) {
        return item;
      }
    }

    return candidates[candidates.length - 1];
  }

  private markAgentFocused(agentId: string | null, now: number): void {
    if (!agentId) return;
    const sample = this.ensureAgentActivity(agentId, now);
    sample.lastFocusedTime = now;
  }

  private updateCameraTarget(now: number): void {
    if (!this.currentCycle) return;

    if (this.currentCycle.phase === "RESOLUTION") {
      const winnerId = this.currentCycle.winnerId;
      if (this.isAgentValidCameraCandidate(winnerId)) {
        this.setCameraTarget(winnerId ?? null, now);
      }
      return;
    }

    const currentTarget = this.isAgentValidCameraCandidate(this.cameraTarget)
      ? this.cameraTarget
      : null;
    this.syncFightCutawayTracking(now, currentTarget);
    const allowFightCutaway = this.isFightCutawayAllowed(now);

    const candidates = this.buildCameraCandidates(
      now,
      currentTarget,
      allowFightCutaway,
    );
    if (candidates.length === 0) {
      const fallback = this.resolveCycleCameraTarget();
      if (fallback) {
        this.setCameraTarget(fallback, now);
      }
      return;
    }

    if (this.currentCycle.phase === "FIGHTING" && currentTarget) {
      const contestantIds = this.getCycleContestantIds();
      if (
        !contestantIds.has(currentTarget) &&
        (!allowFightCutaway || this.isFightCutawayExpired(now))
      ) {
        const fallbackContestant = this.selectBestContestantCandidate(
          candidates,
          null,
        );
        if (fallbackContestant) {
          this.setCameraTarget(fallbackContestant.agentId, now);
        }
        return;
      }
    }

    if (!currentTarget) {
      let firstSelection = this.chooseWeightedCameraCandidate(candidates);
      if (
        firstSelection &&
        this.currentCycle.phase === "FIGHTING" &&
        !allowFightCutaway &&
        !firstSelection.isContestant
      ) {
        const contestantSelection = this.selectBestContestantCandidate(
          candidates,
          null,
        );
        if (contestantSelection) {
          firstSelection = contestantSelection;
        }
      }
      if (firstSelection) {
        this.setCameraTarget(firstSelection.agentId, now);
      }
      return;
    }

    const timing = this.getCameraSwitchTimingForPhase(this.currentCycle.phase);
    const msSinceSwitch = now - this.lastCameraSwitchTime;
    const canSwitch = msSinceSwitch >= timing.minHoldMs;
    const forceSwitch = msSinceSwitch >= timing.maxHoldMs;
    if (!canSwitch && !forceSwitch) {
      return;
    }

    const byAgentId = new Map(candidates.map((item) => [item.agentId, item]));
    const currentCandidate = byAgentId.get(currentTarget);
    if (!currentCandidate) {
      const fallback = this.chooseWeightedCameraCandidate(candidates);
      if (fallback) {
        this.setCameraTarget(fallback.agentId, now);
      }
      return;
    }

    let selected = this.chooseWeightedCameraCandidate(candidates);
    if (!selected) {
      return;
    }

    if (
      this.currentCycle.phase === "FIGHTING" &&
      !allowFightCutaway &&
      !selected.isContestant
    ) {
      const contestantSelection = this.selectBestContestantCandidate(
        candidates,
        currentTarget,
      );
      if (contestantSelection) {
        selected = contestantSelection;
      }
    }

    if (
      forceSwitch &&
      selected.agentId === currentTarget &&
      candidates.length > 1
    ) {
      const alternatives = candidates.filter(
        (candidate) =>
          candidate.agentId !== currentTarget &&
          (this.currentCycle?.phase !== "FIGHTING" ||
            allowFightCutaway ||
            candidate.isContestant),
      );
      const alternateSelection =
        this.chooseWeightedCameraCandidate(alternatives);
      if (alternateSelection) {
        selected = alternateSelection;
      }
    }

    const currentSample = this.ensureAgentActivity(currentTarget, now);
    const currentIdleDurationMs = now - currentSample.lastInterestingTime;
    const currentIsIdle =
      currentIdleDurationMs >= timing.idleThresholdMs &&
      !currentCandidate.isInCombat;

    const selectedIsStronger =
      selected.weight >
      currentCandidate.weight *
        (currentIsIdle
          ? CAMERA_DIRECTOR.multipliers.strongerThresholdIdle
          : CAMERA_DIRECTOR.multipliers.strongerThresholdActive);

    const shouldSwitch =
      forceSwitch ||
      (selected.agentId !== currentTarget &&
        (selectedIsStronger ||
          (currentIsIdle &&
            selected.activityScore >= currentCandidate.activityScore) ||
          Math.random() < CAMERA_DIRECTOR.multipliers.switchRandomChance));

    if (shouldSwitch && selected.agentId !== currentTarget) {
      this.setCameraTarget(selected.agentId, now);
    }
  }

  // ============================================================================
  // State Broadcasting
  // ============================================================================

  private startStateBroadcast(): void {
    // Broadcast state every second
    this.broadcastInterval = setInterval(() => {
      this.broadcastState();
    }, STREAMING_TIMING.STATE_BROADCAST_INTERVAL);
  }

  private broadcastState(): void {
    const state = this.getStreamingState();
    // Broadcast via WebSocket to all connected clients
    const network = this.world.network as NetworkWithSend | undefined;
    if (network?.send) {
      network.send("streamingState", state);
    }
  }

  /**
   * Get current streaming state for broadcast
   */
  getStreamingState(): StreamingStateUpdate {
    const now = Date.now();
    const leaderboard = this.getLeaderboard();

    if (!this.currentCycle) {
      return {
        type: "STREAMING_STATE_UPDATE",
        cycle: {
          cycleId: "",
          phase: "IDLE",
          cycleStartTime: now,
          phaseStartTime: now,
          phaseEndTime: now,
          timeRemaining: 0,
          agent1: null,
          agent2: null,
          countdown: null,
          winnerId: null,
          winnerName: null,
          winReason: null,
        },
        leaderboard,
        cameraTarget: null,
      };
    }

    const { agent1, agent2 } = this.currentCycle;
    const phaseEndTime = this.getPhaseEndTime();
    const timeRemaining = Math.max(0, phaseEndTime - now);

    const cameraTarget = this.resolveCycleCameraTarget();
    if (cameraTarget && cameraTarget !== this.cameraTarget) {
      this.setCameraTarget(cameraTarget, now);
    }

    return {
      type: "STREAMING_STATE_UPDATE",
      cycle: {
        cycleId: this.currentCycle.cycleId,
        phase: this.currentCycle.phase,
        cycleStartTime: this.currentCycle.cycleStartTime,
        phaseStartTime: this.currentCycle.phaseStartTime,
        phaseEndTime,
        timeRemaining,
        agent1: agent1
          ? {
              id: agent1.characterId,
              name: agent1.name,
              provider: agent1.provider,
              model: agent1.model,
              hp: agent1.currentHp,
              maxHp: agent1.maxHp,
              combatLevel: agent1.combatLevel,
              wins: agent1.wins,
              losses: agent1.losses,
              damageDealtThisFight: agent1.damageDealtThisFight,
            }
          : null,
        agent2: agent2
          ? {
              id: agent2.characterId,
              name: agent2.name,
              provider: agent2.provider,
              model: agent2.model,
              hp: agent2.currentHp,
              maxHp: agent2.maxHp,
              combatLevel: agent2.combatLevel,
              wins: agent2.wins,
              losses: agent2.losses,
              damageDealtThisFight: agent2.damageDealtThisFight,
            }
          : null,
        countdown: this.currentCycle.countdownValue,
        winnerId: this.currentCycle.winnerId,
        winnerName: this.currentCycle.winnerId
          ? (this.currentCycle.agent1?.characterId ===
            this.currentCycle.winnerId
              ? this.currentCycle.agent1?.name
              : this.currentCycle.agent2?.name) || null
          : null,
        winReason: this.currentCycle.winReason,
      },
      leaderboard,
      cameraTarget,
    };
  }

  private getPhaseEndTime(): number {
    if (!this.currentCycle) return Date.now();

    const { phase, phaseStartTime } = this.currentCycle;

    switch (phase) {
      case "ANNOUNCEMENT":
        return phaseStartTime + STREAMING_TIMING.ANNOUNCEMENT_DURATION;
      case "COUNTDOWN":
        return phaseStartTime + 4000; // 3-2-1-0 = 4 seconds
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

  /**
   * Get scheduler state for monitoring/debugging
   */
  getSchedulerState(): {
    state: "IDLE" | "WAITING_FOR_AGENTS" | "ACTIVE";
    availableAgents: number;
    requiredAgents: number;
    insufficientWarnings: number;
    currentPhase: StreamingPhase | null;
  } {
    return {
      state: this.schedulerState,
      availableAgents: this.availableAgents.size,
      requiredAgents: config.minAgents,
      insufficientWarnings: this.insufficientAgentWarningCount,
      currentPhase: this.currentCycle?.phase ?? null,
    };
  }

  /**
   * Get leaderboard sorted by win rate
   */
  getLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];

    for (const [characterId, stats] of this.agentStats) {
      const totalGames = stats.wins + stats.losses;
      const winRate = totalGames > 0 ? stats.wins / totalGames : 0;

      entries.push({
        rank: 0, // Will be set after sorting
        characterId,
        name: stats.name,
        provider: stats.provider,
        model: stats.model,
        wins: stats.wins,
        losses: stats.losses,
        winRate,
        combatLevel: stats.combatLevel,
        currentStreak: stats.currentStreak,
      });
    }

    // Sort by win rate, then by total wins
    entries.sort((a, b) => {
      if (b.winRate !== a.winRate) {
        return b.winRate - a.winRate;
      }
      return b.wins - a.wins;
    });

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  getRecentDuels(limit: number = 30): RecentDuelEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, config.maxRecentDuels));
    return this.recentDuels.slice(0, safeLimit).map((duel) => ({ ...duel }));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let streamingSchedulerInstance: StreamingDuelScheduler | null = null;

/**
 * Initialize the streaming duel scheduler
 */
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

/**
 * Get the streaming duel scheduler instance
 */
export function getStreamingDuelScheduler(): StreamingDuelScheduler | null {
  return streamingSchedulerInstance;
}
