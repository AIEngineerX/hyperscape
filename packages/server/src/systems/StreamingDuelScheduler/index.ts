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
import { EventType } from "@hyperscape/shared";

/** Type for network with send method */
interface NetworkWithSend {
  send: <T>(name: string, data: T, ignoreSocketId?: string) => void;
}
import { Logger } from "../ServerNetwork/services";
import { v4 as uuidv4 } from "uuid";
import {
  type StreamingDuelCycle,
  type AgentContestant,
  type StreamingStateUpdate,
  type LeaderboardEntry,
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
};

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

  /** Tick interval for state updates */
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  /** Broadcast interval for streaming state */
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  /** Countdown interval during countdown phase */
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  /** Available agents for dueling */
  private availableAgents: Set<string> = new Set();

  /** Event listeners for cleanup */
  private eventListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  /** Camera target for streaming viewers */
  private cameraTarget: string | null = null;

  /** Last camera switch time */
  private lastCameraSwitchTime: number = 0;

  /** Track insufficient agent warnings for auto-recovery */
  private insufficientAgentWarningCount: number = 0;

  /** Last time we logged insufficient agents warning */
  private lastInsufficientAgentsLog: number = 0;

  /** Scheduler state for state machine */
  private schedulerState: "IDLE" | "WAITING_FOR_AGENTS" | "ACTIVE" = "IDLE";

  constructor(world: World) {
    this.world = world;
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

    // Clear combat loop interval
    if (this.combatLoopInterval) {
      clearInterval(this.combatLoopInterval);
      this.combatLoopInterval = null;
    }

    // Remove event listeners
    for (const { event, fn } of this.eventListeners) {
      this.world.off(event, fn);
    }
    this.eventListeners = [];

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

    // Track damage for stats
    const onEntityDamaged = (payload: unknown) => {
      this.handleEntityDamaged(payload);
    };
    this.world.on(EventType.ENTITY_DAMAGED, onEntityDamaged);
    this.eventListeners.push({
      event: EventType.ENTITY_DAMAGED,
      fn: onEntityDamaged,
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

  private registerAgent(agentId: string): void {
    this.availableAgents.add(agentId);

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

  private unregisterAgent(agentId: string): void {
    this.availableAgents.delete(agentId);
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

  private startNewCycle(): void {
    const cycleId = uuidv4();
    const now = Date.now();

    // Select two random agents
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

    // Shuffle and pick two using Fisher-Yates for better randomization
    const shuffled = [...validAgents];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const agent1Id = shuffled[0];
    const agent2Id = shuffled[1];

    // Validate: ensure different agents selected (safety check)
    if (agent1Id === agent2Id) {
      Logger.error(
        "StreamingDuelScheduler",
        "Same agent selected twice after shuffle, aborting cycle (bug in shuffle logic)",
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

    // Set initial camera target
    this.cameraTarget = agent1.characterId;
    this.lastCameraSwitchTime = now;

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

    // Normalize position
    let position: [number, number, number] = [0, 0, 0];
    if (Array.isArray(data.position)) {
      position = data.position as [number, number, number];
    } else if (data.position && typeof data.position === "object") {
      position = [data.position.x, data.position.y || 0, data.position.z];
    }

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
      originalPosition: position,
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
      this.startCountdown();
    }
  }

  private startCountdown(): void {
    if (
      !this.currentCycle ||
      !this.currentCycle.agent1 ||
      !this.currentCycle.agent2
    ) {
      return;
    }

    const now = Date.now();
    this.currentCycle.phase = "COUNTDOWN";
    this.currentCycle.phaseStartTime = now;
    this.currentCycle.countdownValue = 3;

    Logger.info("StreamingDuelScheduler", "Starting countdown");

    // Prepare contestants
    this.prepareContestantsForDuel();

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
    await this.fillInventoryWithFood(agent1.characterId);
    await this.fillInventoryWithFood(agent2.characterId);

    // Restore full health
    this.restoreHealth(agent1.characterId);
    this.restoreHealth(agent2.characterId);

    // Teleport to arena
    await this.teleportToArena(agent1.characterId, agent2.characterId);

    Logger.info(
      "StreamingDuelScheduler",
      `Contestants prepared: ${agent1.name} vs ${agent2.name}`,
    );
  }

  private async fillInventoryWithFood(playerId: string): Promise<void> {
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
      return;
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
        return;
      }

      // Get occupied slots
      const occupiedSlots = new Set(inventory.items.map((item) => item.slot));

      // Fill empty slots with food (assume 28 slots max)
      const maxSlots = 28;
      let foodAdded = 0;

      for (let slot = 0; slot < maxSlots; slot++) {
        if (!occupiedSlots.has(slot)) {
          try {
            await inventorySystem.addItemDirect(playerId, {
              itemId: DUEL_FOOD_ITEM,
              quantity: 1,
              slot,
            });
            foodAdded++;
          } catch (slotErr) {
            // Slot might be invalid, continue
          }
        }
      }

      Logger.info(
        "StreamingDuelScheduler",
        `Filled ${foodAdded} slots with food for ${playerId}`,
      );
    } catch (err) {
      Logger.warn(
        "StreamingDuelScheduler",
        `Failed to fill inventory: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private restoreHealth(playerId: string): void {
    const entity = this.world.entities.get(playerId);
    if (!entity) return;

    const data = entity.data as {
      health?: number;
      maxHealth?: number;
      skills?: Record<string, { level: number }>;
    };

    // Calculate max health from constitution
    const constitution = data.skills?.constitution?.level || 10;
    const maxHealth = constitution;

    // Restore to full
    entity.data.health = maxHealth;
    entity.data.maxHealth = maxHealth;

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
    // Get arena positions
    // TODO: Read from arena manifest or config instead of hardcoding
    const arenaCenter = { x: 150, y: 0, z: 150 };
    const spawnOffset = 5;

    // Agent 1 spawns north (negative Z)
    const agent1Pos: [number, number, number] = [
      arenaCenter.x,
      arenaCenter.y,
      arenaCenter.z - spawnOffset,
    ];

    // Agent 2 spawns south (positive Z)
    const agent2Pos: [number, number, number] = [
      arenaCenter.x,
      arenaCenter.y,
      arenaCenter.z + spawnOffset,
    ];

    // Teleport both agents, facing each other
    this.teleportPlayer(agent1Id, agent1Pos, agent2Pos);
    this.teleportPlayer(agent2Id, agent2Pos, agent1Pos);

    this.currentCycle!.arenaId = 1;

    Logger.info(
      "StreamingDuelScheduler",
      "Contestants teleported to arena, facing each other",
    );
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
      // Both agents attack each other (player vs player)
      combatSystem.startCombat(agent1.characterId, agent2.characterId, {
        attackerType: "player",
        targetType: "player",
      });
      combatSystem.startCombat(agent2.characterId, agent1.characterId, {
        attackerType: "player",
        targetType: "player",
      });

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

  /** Combat re-engagement interval */
  private combatLoopInterval: ReturnType<typeof setInterval> | null = null;

  /** Start a loop that keeps agents engaged in combat */
  private startCombatLoop(): void {
    // Clear any existing loop
    if (this.combatLoopInterval) {
      clearInterval(this.combatLoopInterval);
    }

    // Re-engage combat every 3 seconds to ensure agents keep fighting
    this.combatLoopInterval = setInterval(() => {
      if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
        if (this.combatLoopInterval) {
          clearInterval(this.combatLoopInterval);
          this.combatLoopInterval = null;
        }
        return;
      }

      const { agent1, agent2 } = this.currentCycle;
      if (!agent1 || !agent2) return;

      // Re-engage combat if either agent lost their target
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
        combatSystem.startCombat(agent1.characterId, agent2.characterId, {
          attackerType: "player",
          targetType: "player",
        });
        combatSystem.startCombat(agent2.characterId, agent1.characterId, {
          attackerType: "player",
          targetType: "player",
        });
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
    this.cameraTarget = winnerId;

    // Restore health and clean up
    this.cleanupAfterDuel();
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

    // Clear duel flags (allows normal respawn if needed)
    this.setDuelFlags(false);

    // Restore health
    this.restoreHealth(agent1.characterId);
    this.restoreHealth(agent2.characterId);

    // Remove duel food from inventory
    await this.removeDuelFood(agent1.characterId);
    await this.removeDuelFood(agent2.characterId);

    // Teleport back to original positions
    this.teleportPlayer(agent1.characterId, agent1.originalPosition);
    this.teleportPlayer(agent2.characterId, agent2.originalPosition);

    // Stop combat
    this.stopCombat(agent1.characterId);
    this.stopCombat(agent2.characterId);
  }

  private async removeDuelFood(playerId: string): Promise<void> {
    const inventorySystem = this.world.getSystem("inventory") as {
      getInventory?: (playerId: string) =>
        | {
            playerId: string;
            items: Array<{ slot: number; itemId: string; quantity: number }>;
            coins: number;
          }
        | undefined;
      removeItem?: (
        playerId: string,
        slot: number,
        quantity: number,
      ) => Promise<boolean>;
      removeItemBySlot?: (
        playerId: string,
        slot: number,
        quantity: number,
      ) => Promise<boolean>;
    } | null;

    if (!inventorySystem?.getInventory) {
      return;
    }

    try {
      const inventory = inventorySystem.getInventory(playerId);
      if (!inventory) return;

      // Find and remove all duel food items
      const removeMethod =
        inventorySystem.removeItem || inventorySystem.removeItemBySlot;
      if (!removeMethod) {
        Logger.warn(
          "StreamingDuelScheduler",
          "No removeItem method available on inventory system",
        );
        return;
      }

      let removed = 0;
      for (const item of inventory.items) {
        // Check if item ID matches duel food (may have prefixes like "item-")
        if (
          item.itemId === DUEL_FOOD_ITEM ||
          item.itemId.endsWith(DUEL_FOOD_ITEM)
        ) {
          try {
            await removeMethod.call(
              inventorySystem,
              playerId,
              item.slot,
              item.quantity,
            );
            removed++;
          } catch (slotErr) {
            // Continue on error
          }
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
    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return;
    }

    const data = payload as {
      entityId?: string;
      attackerId?: string;
      damage?: number;
    };

    if (!data.attackerId || !data.damage) return;

    // Update damage dealt for the attacker
    if (data.attackerId === this.currentCycle.agent1?.characterId) {
      this.currentCycle.agent1.damageDealtThisFight += data.damage;
    } else if (data.attackerId === this.currentCycle.agent2?.characterId) {
      this.currentCycle.agent2.damageDealtThisFight += data.damage;
    }
  }

  private handleEntityDeath(payload: unknown): void {
    if (!this.currentCycle || this.currentCycle.phase !== "FIGHTING") {
      return;
    }

    const data = payload as {
      entityId?: string;
      killedBy?: string;
    };

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

  private updateCameraTarget(now: number): void {
    if (!this.currentCycle?.agent1 || !this.currentCycle?.agent2) return;

    const { agent1, agent2 } = this.currentCycle;

    switch (this.currentCycle.phase) {
      case "ANNOUNCEMENT":
        // Switch every 30 seconds during announcement
        if (now - this.lastCameraSwitchTime > 30000) {
          this.cameraTarget =
            this.cameraTarget === agent1.characterId
              ? agent2.characterId
              : agent1.characterId;
          this.lastCameraSwitchTime = now;
        }
        break;

      case "COUNTDOWN":
        // Focus on agent1 during countdown
        this.cameraTarget = agent1.characterId;
        break;

      case "FIGHTING":
        // Switch every 20 seconds during fight
        if (now - this.lastCameraSwitchTime > 20000) {
          this.cameraTarget =
            this.cameraTarget === agent1.characterId
              ? agent2.characterId
              : agent1.characterId;
          this.lastCameraSwitchTime = now;
        }
        break;

      case "RESOLUTION":
        // Focus on winner
        this.cameraTarget = this.currentCycle.winnerId;
        break;
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
      cameraTarget: this.cameraTarget,
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
