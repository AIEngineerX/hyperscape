/**
 * AgentManager - Manages embedded ElizaOS agent runtimes
 *
 * This manager handles:
 * - Creating and initializing agent runtimes
 * - Starting and stopping agents
 * - Providing agent status and control
 * - Managing agent lifecycle
 *
 * Unlike external ElizaOS processes, these agents run directly in the
 * Hyperscape server process with direct world access.
 */

import {
  AgentRuntime,
  ChannelType,
  mergeCharacterDefaults,
  stringToUuid,
  type Plugin,
} from "@elizaos/core";
import { createJWT } from "../shared/utils.js";
import { errMsg } from "../shared/errMsg.js";
import { EmbeddedHyperscapeService } from "./EmbeddedHyperscapeService.js";
import {
  ejectAgentFromCombatArena,
  recoverAgentFromDeathLoop,
} from "./agentRecovery.js";

/**
 * Dynamically import the Hyperscape plugin to avoid hard dependency in dev.
 * Returns null if AI plugins are disabled or the module fails to load.
 */
async function getHyperscapePlugin(): Promise<Plugin | null> {
  if (process.env.DISABLE_AI === "true" || process.env.ENABLE_AI === "false") {
    console.warn("[AgentManager] AI plugins disabled via env");
    return null;
  }

  try {
    const mod = await import("@hyperscape/plugin-hyperscape");
    return mod.hyperscapePlugin;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load @hyperscape/plugin-hyperscape:",
      errMsg(err),
    );
    return null;
  }
}

/**
 * Dynamically import the SQL plugin required for ElizaOS database operations.
 * Returns the plugin or null if not available.
 */
async function getSqlPlugin(): Promise<Plugin | null> {
  try {
    const mod = await import("@elizaos/plugin-sql");
    const sqlPlugin = mod.plugin ?? mod.default;
    if (sqlPlugin) {
      console.log("[AgentManager] Loaded SQL plugin for database support");
      return sqlPlugin;
    }
    console.warn(
      "[AgentManager] SQL plugin module loaded but no plugin export found. Exports:",
      Object.keys(mod),
    );
    return null;
  } catch (err) {
    console.warn("[AgentManager] Failed to load SQL plugin:", errMsg(err));
    return null;
  }
}

/**
 * Dynamically import the appropriate model provider plugin based on available API keys.
 * Returns the plugin or null if no API key is configured.
 *
 * Note: We return Plugin type but dynamically imported plugins may have slightly different
 * type definitions due to nested node_modules. The runtime handles this correctly.
 */
async function getModelProviderPlugin(): Promise<Plugin | null> {
  // Check for OpenAI API key first (most common)
  if (process.env.OPENAI_API_KEY) {
    try {
      const mod = await import("@elizaos/plugin-openai");
      console.log("[AgentManager] Using OpenAI model provider");
      return mod.openaiPlugin;
    } catch (err) {
      console.warn("[AgentManager] Failed to load OpenAI plugin:", errMsg(err));
    }
  }

  // Check for Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const mod = await import("@elizaos/plugin-anthropic");
      console.log("[AgentManager] Using Anthropic model provider");
      return mod.anthropicPlugin ?? mod.default;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load Anthropic plugin:",
        errMsg(err),
      );
    }
  }

  // Check for OpenRouter API key
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const mod = await import("@elizaos/plugin-openrouter");
      console.log("[AgentManager] Using OpenRouter model provider");
      return mod.openrouterPlugin ?? mod.default;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load OpenRouter plugin:",
        errMsg(err),
      );
    }
  }

  // Fall back to Ollama for local development (no API key needed)
  try {
    const mod = await import("@elizaos/plugin-ollama");
    console.log("[AgentManager] Using Ollama model provider (local fallback)");
    return mod.ollamaPlugin;
  } catch (err) {
    console.warn("[AgentManager] Failed to load Ollama plugin:", errMsg(err));
  }

  console.warn(
    "[AgentManager] No model provider available! Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY",
  );
  return null;
}
import type { World } from "@hyperscape/shared";

type Equipment = {
  helmet?: unknown;
  amulet?: unknown;
  gloves?: unknown;
  boots?: unknown;
  weapon?: unknown;
  shield?: unknown;
  body?: unknown;
  legs?: unknown;
  cape?: unknown;
  ring?: unknown;
  arrows?: unknown;
};

/**
 * Interface for the HyperscapeService methods used by AgentManager.
 * This mirrors the plugin-hyperscape HyperscapeService but avoids direct dependency.
 */
export interface HyperscapeService {
  /** Enable or disable autonomous behavior */
  setAutonomousBehaviorEnabled(enabled: boolean): void;

  /** Get the current game state cache */
  getGameState(): {
    playerEntity: {
      id: string;
      position: [number, number, number] | { x: number; y?: number; z: number };
      health?: { current: number; max: number };
      items: Array<{
        id: string;
        itemId?: string;
        name?: string;
        item?: { name?: string };
      }>;
    } | null;
  };

  /** Get player entity */
  getPlayerEntity(): {
    items: Array<{
      id: string;
      itemId?: string;
      name?: string;
      item?: { name?: string };
    }>;
  } | null;

  /** Get nearby entities */
  getNearbyEntities(): Array<{
    id: string;
    harvestSkill?:
      | "woodcutting"
      | "fishing"
      | "mining"
      | "firemaking"
      | "cooking";
    resourceType?: string;
  }>;

  /** Execute movement command */
  executeMove(command: {
    target: [number, number, number];
    runMode?: boolean;
    cancel?: boolean;
  }): Promise<void>;

  /** Execute attack command */
  executeAttack(command: { targetEntityId: string }): Promise<void>;

  /** Execute gather resource command */
  executeGatherResource(command: {
    resourceEntityId: string;
    skill: "woodcutting" | "fishing" | "mining" | "firemaking" | "cooking";
  }): Promise<void>;

  /** Execute pickup item command */
  executePickupItem(itemId: string): Promise<void>;

  /** Execute drop item command */
  executeDropItem(
    itemId: string,
    quantity?: number,
    slot?: number,
  ): Promise<void>;

  /** Execute equip item command */
  executeEquipItem(command: {
    itemId: string;
    equipSlot: keyof Equipment;
  }): Promise<void>;

  /** Execute use item command */
  executeUseItem(command: { itemId: string; slot?: number }): Promise<void>;

  /** Execute chat message command */
  executeChatMessage(command: { message: string }): Promise<void>;
}
import type { DatabaseSystem } from "../systems/DatabaseSystem/index.js";
import type {
  EmbeddedAgentConfig,
  EmbeddedAgentInfo,
  AgentState,
} from "./types.js";

/**
 * Active goal for an embedded agent (visible on dashboard)
 */
interface AgentGoal {
  type: "questing" | "combat" | "gathering" | "idle";
  description: string;
  questId?: string;
  questName?: string;
  questStageType?: string;
  questStageTarget?: string;
  questStageCount?: number;
  questStartNpc?: string;
}

/**
 * Internal agent instance tracking
 */
interface AgentInstance {
  config: EmbeddedAgentConfig;
  service: EmbeddedHyperscapeService;
  state: AgentState;
  startedAt: number;
  lastActivity: number;
  error?: string;
  behaviorInterval: ReturnType<typeof setInterval> | null;
  goal: AgentGoal | null;
  questsAccepted: Set<string>;
  currentTargetId: string | null;
}

/** Autonomous behavior tick interval for embedded agents */
const EMBEDDED_BEHAVIOR_TICK_INTERVAL = 8000;

type EmbeddedBehaviorAction =
  | { type: "attack"; targetId: string }
  | { type: "gather"; targetId: string }
  | { type: "pickup"; targetId: string }
  | { type: "move"; target: [number, number, number]; runMode?: boolean }
  | { type: "questAccept"; questId: string }
  | { type: "questComplete"; questId: string }
  | { type: "stop" }
  | { type: "idle" };

/**
 * AgentManager manages the lifecycle of embedded ElizaOS agents
 */
export class AgentManager {
  private world: World;
  private agents: Map<string, AgentInstance> = new Map();
  private isShuttingDown: boolean = false;

  constructor(world: World) {
    this.world = world;
    console.log("[AgentManager] Initialized");
  }

  /**
   * Create and optionally start an embedded agent
   *
   * @param config - Agent configuration
   * @returns The agent's character ID
   */
  async createAgent(config: EmbeddedAgentConfig): Promise<string> {
    const { characterId, accountId, name } = config;

    // Check if agent already exists
    if (this.agents.has(characterId)) {
      console.warn(
        `[AgentManager] Agent ${characterId} already exists, returning existing`,
      );
      return characterId;
    }

    console.log(`[AgentManager] Creating agent: ${name} (${characterId})`);

    // Create the embedded service
    const service = new EmbeddedHyperscapeService(
      this.world,
      characterId,
      accountId,
      name,
    );

    // Track the agent
    const instance: AgentInstance = {
      config,
      service,
      state: "initializing",
      startedAt: Date.now(),
      lastActivity: Date.now(),
      behaviorInterval: null,
      goal: null,
      questsAccepted: new Set(),
      currentTargetId: null,
    };

    this.agents.set(characterId, instance);

    // Auto-start if configured
    if (config.autoStart !== false) {
      try {
        await this.startAgent(characterId);
      } catch (err) {
        instance.state = "error";
        instance.error = errMsg(err);
        console.error(
          `[AgentManager] Failed to auto-start agent ${name}:`,
          instance.error,
        );
      }
    }

    return characterId;
  }

  /**
   * Start an agent (spawn player entity and begin autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async startAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state === "running") {
      console.log(`[AgentManager] Agent ${characterId} is already running`);
      return;
    }

    console.log(
      `[AgentManager] Starting agent: ${instance.config.name} (${characterId})`,
    );

    instance.state = "initializing";
    instance.lastActivity = Date.now();

    try {
      // Initialize the embedded service (spawns player entity)
      await instance.service.initialize();

      instance.state = "running";
      instance.lastActivity = Date.now();
      instance.error = undefined;

      // Start autonomous behavior loop for embedded agents.
      this.startBehaviorLoop(characterId);

      console.log(
        `[AgentManager] ✅ Agent ${instance.config.name} is now running`,
      );

      // TODO: Initialize ElizaOS AgentRuntime with EmbeddedHyperscapeService
      // This will be implemented once we integrate the full ElizaOS runtime
      // await this.initializeElizaRuntime(instance);
    } catch (err) {
      instance.state = "error";
      instance.error = errMsg(err);
      throw err;
    }
  }

  /**
   * Stop an agent (remove from world, stop autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async stopAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state === "stopped") {
      console.log(`[AgentManager] Agent ${characterId} is already stopped`);
      return;
    }

    console.log(
      `[AgentManager] Stopping agent: ${instance.config.name} (${characterId})`,
    );

    try {
      // Stop autonomous behavior first.
      this.stopBehaviorLoop(characterId);

      await instance.service.stop();
      instance.state = "stopped";
      instance.lastActivity = Date.now();

      console.log(`[AgentManager] ✅ Agent ${instance.config.name} stopped`);
    } catch (err) {
      instance.state = "error";
      instance.error = errMsg(err);
      throw err;
    }
  }

  /**
   * Pause an agent (keep entity but stop autonomous behavior)
   *
   * @param characterId - The agent's character ID
   */
  async pauseAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "running") {
      console.log(
        `[AgentManager] Agent ${characterId} is not running (state: ${instance.state})`,
      );
      return;
    }

    console.log(
      `[AgentManager] Pausing agent: ${instance.config.name} (${characterId})`,
    );

    // Stop autonomous behavior without removing the entity.
    this.stopBehaviorLoop(characterId);
    instance.state = "paused";
    instance.lastActivity = Date.now();

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} paused`);
  }

  /**
   * Resume a paused agent
   *
   * @param characterId - The agent's character ID
   */
  async resumeAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "paused") {
      console.log(
        `[AgentManager] Agent ${characterId} is not paused (state: ${instance.state})`,
      );
      return;
    }

    console.log(
      `[AgentManager] Resuming agent: ${instance.config.name} (${characterId})`,
    );

    instance.state = "running";
    instance.lastActivity = Date.now();
    this.startBehaviorLoop(characterId);

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} resumed`);
  }

  /**
   * Remove an agent completely
   *
   * @param characterId - The agent's character ID
   */
  async removeAgent(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      console.log(
        `[AgentManager] Agent ${characterId} not found, nothing to remove`,
      );
      return;
    }

    console.log(
      `[AgentManager] Removing agent: ${instance.config.name} (${characterId})`,
    );

    // Stop first if running
    if (instance.state === "running" || instance.state === "paused") {
      await this.stopAgent(characterId);
    }

    // Remove from tracking
    this.agents.delete(characterId);

    console.log(`[AgentManager] ✅ Agent ${instance.config.name} removed`);
  }

  /**
   * Get information about an agent
   *
   * @param characterId - The agent's character ID
   * @returns Agent information or null if not found
   */
  getAgentInfo(characterId: string): EmbeddedAgentInfo | null {
    const instance = this.agents.get(characterId);
    if (!instance) {
      return null;
    }

    const gameState = instance.service.getGameState();

    return {
      agentId: characterId,
      characterId,
      accountId: instance.config.accountId,
      name: instance.config.name,
      scriptedRole: instance.config.scriptedRole,
      state: instance.state,
      entityId: gameState?.playerId || null,
      position: gameState?.position ?? null,
      health: gameState?.health ?? null,
      maxHealth: gameState?.maxHealth ?? null,
      startedAt: instance.startedAt,
      lastActivity: instance.lastActivity,
      error: instance.error,
      goal: instance.goal,
    };
  }

  /**
   * Get information about all agents
   *
   * @returns Array of agent information
   */
  getAllAgents(): EmbeddedAgentInfo[] {
    const result: EmbeddedAgentInfo[] = [];
    for (const [characterId] of this.agents) {
      const info = this.getAgentInfo(characterId);
      if (info) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Get agents by account ID
   *
   * @param accountId - The account ID to filter by
   * @returns Array of agent information for the account
   */
  getAgentsByAccount(accountId: string): EmbeddedAgentInfo[] {
    return this.getAllAgents().filter((agent) => agent.accountId === accountId);
  }

  /**
   * Check if an agent exists
   *
   * @param characterId - The agent's character ID
   * @returns True if the agent exists
   */
  hasAgent(characterId: string): boolean {
    return this.agents.has(characterId);
  }

  /**
   * Get the embedded service for an agent (for direct manipulation)
   *
   * @param characterId - The agent's character ID
   * @returns The embedded service or null
   */
  getAgentService(characterId: string): EmbeddedHyperscapeService | null {
    return this.agents.get(characterId)?.service || null;
  }

  /**
   * Send a command to an agent
   *
   * @param characterId - The agent's character ID
   * @param command - The command type
   * @param data - Command data
   */
  async sendCommand(
    characterId: string,
    command: string,
    data: unknown,
  ): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance) {
      throw new Error(`Agent ${characterId} not found`);
    }

    if (instance.state !== "running") {
      throw new Error(`Agent ${characterId} is not running`);
    }

    instance.lastActivity = Date.now();

    const service = instance.service;
    const commandData = data as Record<string, unknown>;

    switch (command) {
      case "move":
        await service.executeMove(
          commandData.target as [number, number, number],
          commandData.runMode as boolean | undefined,
        );
        break;

      case "attack":
        await service.executeAttack(commandData.targetId as string);
        break;

      case "gather":
        await service.executeGather(commandData.resourceId as string);
        break;

      case "pickup":
        await service.executePickup(commandData.itemId as string);
        break;

      case "drop":
        await service.executeDrop(
          commandData.itemId as string,
          commandData.quantity as number | undefined,
        );
        break;

      case "equip":
        await service.executeEquip(commandData.itemId as string);
        break;

      case "use":
        await service.executeUse(commandData.itemId as string);
        break;

      case "chat":
        await service.executeChat(commandData.message as string);
        break;

      case "stop":
        await service.executeStop();
        break;

      case "bankOpen":
        await service.executeBankOpen(commandData.bankId as string);
        break;

      case "bankDeposit":
        await service.executeBankDeposit(
          commandData.itemId as string,
          commandData.quantity as number | undefined,
        );
        break;

      case "bankWithdraw":
        await service.executeBankWithdraw(
          commandData.itemId as string,
          commandData.quantity as number | undefined,
        );
        break;

      case "bankDepositAll":
        await service.executeBankDepositAll();
        break;

      case "storeBuy":
        await service.executeStoreBuy(
          commandData.storeId as string,
          commandData.itemId as string,
          commandData.quantity as number | undefined,
        );
        break;

      case "storeSell":
        await service.executeStoreSell(
          commandData.storeId as string,
          commandData.itemId as string,
          commandData.quantity as number | undefined,
        );
        break;

      case "cook":
        await service.executeCook(commandData.itemId as string);
        break;

      case "smelt":
        await service.executeSmelt(commandData.recipe as string);
        break;

      case "smith":
        await service.executeSmith(commandData.recipe as string);
        break;

      case "firemake":
        await service.executeFiremake();
        break;

      case "npcInteract":
        await service.executeNpcInteract(
          commandData.npcId as string,
          commandData.interaction as string | undefined,
        );
        break;

      case "unequip":
        await service.executeUnequip(commandData.slot as string);
        break;

      case "prayerToggle":
        await service.executePrayerToggle(commandData.prayerId as string);
        break;

      case "prayerDeactivateAll":
        await service.executePrayerDeactivateAll();
        break;

      case "changeStyle":
        await service.executeChangeStyle(commandData.style as string);
        break;

      case "autoRetaliate":
        await service.executeSetAutoRetaliate(commandData.enabled as boolean);
        break;

      case "homeTeleport":
        await service.executeHomeTeleport();
        break;

      case "follow":
        await service.executeFollow(commandData.targetId as string);
        break;

      case "respawn":
        await service.executeRespawn();
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * Start autonomous behavior loop for an embedded agent.
   */
  private startBehaviorLoop(characterId: string): void {
    const instance = this.agents.get(characterId);
    if (!instance || instance.state !== "running") {
      return;
    }

    // Replace any existing loop.
    this.stopBehaviorLoop(characterId);

    const runTick = async () => {
      const current = this.agents.get(characterId);
      if (!current || current.state !== "running") {
        return;
      }

      try {
        await this.executeBehaviorTick(characterId);
      } catch (err) {
        console.warn(
          `[AgentManager] Behavior tick failed for ${characterId}: ${errMsg(
            err,
          )}`,
        );
      } finally {
        tickInProgress = false;
      }
    };

    let tickInProgress = false;
    instance.behaviorInterval = setInterval(() => {
      if (tickInProgress) return;
      tickInProgress = true;
      void runTick();
    }, EMBEDDED_BEHAVIOR_TICK_INTERVAL);

    // Delay the first tick so PLAYER_REGISTERED has time to fire and
    // QuestSystem can load the player's quest state from the database.
    setTimeout(() => void runTick(), 3000);
  }

  /**
   * Stop autonomous behavior loop for an embedded agent.
   */
  private stopBehaviorLoop(characterId: string): void {
    const instance = this.agents.get(characterId);
    if (!instance) {
      return;
    }

    if (instance.behaviorInterval) {
      clearInterval(instance.behaviorInterval);
      instance.behaviorInterval = null;
    }

    // Best-effort stop so paused/stopped agents don't keep pathing or attacking.
    void instance.service.executeStop().catch(() => {});
  }

  /**
   * Execute one autonomous behavior tick.
   *
   * Quest-aware: agents auto-accept quests, track objectives, and complete them.
   */
  private async executeBehaviorTick(characterId: string): Promise<void> {
    const instance = this.agents.get(characterId);
    if (!instance || instance.state !== "running") {
      return;
    }

    const entity = this.world.entities.get(characterId);

    if (recoverAgentFromDeathLoop(this.world, characterId, "AgentManager")) {
      instance.lastActivity = Date.now();
      return;
    }

    if (ejectAgentFromCombatArena(this.world, characterId, "AgentManager")) {
      instance.lastActivity = Date.now();
      return;
    }

    const inStreamingDuel =
      (entity?.data as { inStreamingDuel?: boolean } | undefined)
        ?.inStreamingDuel === true;

    if (inStreamingDuel) {
      return;
    }

    const gameState = instance.service.getGameState();
    if (!gameState || !gameState.position) {
      return;
    }

    // === QUEST MANAGEMENT ===
    await this.manageQuests(instance);

    // === PICK ACTION ===
    const action = this.pickBehaviorAction(instance, gameState);

    const logParts = [
      `[AgentManager] ${instance.config.name} tick: action=${action.type}`,
    ];
    if ("targetId" in action) logParts.push(`target=${action.targetId}`);
    if ("target" in action) {
      const t = (action as { target: number[] }).target;
      logParts.push(`pos=[${t.map((n: number) => n.toFixed(0)).join(",")}]`);
    }
    if (instance.goal)
      logParts.push(
        `goal=${instance.goal.type}${instance.goal.questName ? `:${instance.goal.questName}` : ""}`,
      );
    console.log(logParts.join(" "));

    switch (action.type) {
      case "attack":
        await instance.service.executeAttack(action.targetId);
        instance.lastActivity = Date.now();
        break;

      case "gather":
        await instance.service.executeGather(action.targetId);
        instance.lastActivity = Date.now();
        break;

      case "pickup":
        await instance.service.executePickup(action.targetId);
        instance.lastActivity = Date.now();
        break;

      case "move":
        await instance.service.executeMove(action.target, action.runMode);
        instance.lastActivity = Date.now();
        break;

      case "questAccept": {
        const accepted = await instance.service.executeQuestAccept(
          action.questId,
        );
        if (accepted) {
          // Verify quest actually started by checking quest state after a moment
          // (QUEST_START_ACCEPTED is handled synchronously by QuestSystem)
          const postAcceptState = instance.service.getQuestState();
          const questStarted = postAcceptState.some(
            (q) => q.questId === action.questId,
          );
          if (questStarted) {
            instance.questsAccepted.add(action.questId);
            console.log(
              `[AgentManager] ${instance.config.name} accepted quest: ${action.questId}`,
            );
          } else {
            console.warn(
              `[AgentManager] ${instance.config.name} quest accept sent but not started yet: ${action.questId} (will retry)`,
            );
          }
        }
        instance.lastActivity = Date.now();
        break;
      }

      case "questComplete":
        await instance.service.executeQuestComplete(action.questId);
        console.log(
          `[AgentManager] ${instance.config.name} completed quest: ${action.questId}`,
        );
        instance.goal = null;
        instance.lastActivity = Date.now();
        break;

      case "stop":
        await instance.service.executeStop();
        instance.lastActivity = Date.now();
        break;

      case "idle":
      default:
        break;
    }
  }

  /**
   * Manage quest state for an agent: auto-accept, track progress, update goals.
   * Only accepts quests the agent can actually execute (kill quests first).
   */
  private async manageQuests(instance: AgentInstance): Promise<void> {
    const activeQuests = instance.service.getQuestState();
    const availableQuests = instance.service.getAvailableQuests();

    // If there's an active quest, set the goal to work on it
    if (activeQuests.length > 0) {
      const quest = activeQuests[0];
      instance.goal = {
        type: "questing",
        description:
          quest.status === "ready_to_complete"
            ? `Turn in: ${quest.name}`
            : `${quest.stageDescription || quest.name}`,
        questId: quest.questId,
        questName: quest.name,
        questStageType: quest.stageType,
        questStageTarget: quest.stageTarget,
        questStageCount: quest.stageCount,
        questStartNpc: quest.startNpc,
      };
      return;
    }

    // No active quest — accept one the agent can actually do.
    // Priority: kill quests first (always work), then gather quests.
    const killQuestIds = ["goblin_slayer"];
    const gatherQuestIds = [
      "lumberjacks_first_lesson",
      "fresh_catch",
      "torvins_tools",
    ];

    // Try kill quests first
    for (const questId of killQuestIds) {
      const quest = availableQuests.find(
        (q) => q.questId === questId && q.status === "not_started",
      );
      if (quest && !instance.questsAccepted.has(questId)) {
        instance.goal = {
          type: "questing",
          description: `Accept quest: ${quest.name}`,
          questId: quest.questId,
          questName: quest.name,
          questStartNpc: quest.startNpc,
        };
        return;
      }
    }

    // Then gather quests
    for (const questId of gatherQuestIds) {
      const quest = availableQuests.find(
        (q) => q.questId === questId && q.status === "not_started",
      );
      if (quest && !instance.questsAccepted.has(questId)) {
        instance.goal = {
          type: "questing",
          description: `Accept quest: ${quest.name}`,
          questId: quest.questId,
          questName: quest.name,
          questStartNpc: quest.startNpc,
        };
        return;
      }
    }

    // Default: combat training
    instance.goal = {
      type: "combat",
      description: "Train combat on goblins",
    };
  }

  /**
   * Decide the next behavior action for an agent.
   * Quest-aware: routes actions based on active quest objectives.
   * Key principle: ALWAYS do something productive. Never just wander aimlessly.
   */
  private pickBehaviorAction(
    instance: AgentInstance,
    gameState: import("./types.js").EmbeddedGameState,
  ): EmbeddedBehaviorAction {
    const healthPercent =
      gameState.maxHealth > 0 ? gameState.health / gameState.maxHealth : 1;
    const position = gameState.position!;

    const nearbyItems = gameState.nearbyEntities
      .filter((entity) => entity.type === "item" && entity.distance <= 15)
      .sort((a, b) => a.distance - b.distance);

    const nearbyMobs = gameState.nearbyEntities
      .filter((entity) => entity.type === "mob" && entity.distance <= 40)
      .sort((a, b) => a.distance - b.distance);

    const nearbyResources = gameState.nearbyEntities
      .filter((entity) => entity.type === "resource" && entity.distance <= 45)
      .sort((a, b) => a.distance - b.distance);

    // Safety first: flee if critically low in active combat.
    if (gameState.inCombat && healthPercent < 0.35) {
      return {
        type: "move",
        target: this.getRandomNearbyTarget(position, 14, 26),
        runMode: true,
      };
    }

    // Already fighting — let the combat system handle auto-attacks.
    if (gameState.inCombat) {
      return { type: "idle" };
    }

    // Opportunistic loot pickup.
    if (nearbyItems.length > 0) {
      return { type: "pickup", targetId: nearbyItems[0].id };
    }

    const goal = instance.goal;

    // === QUEST-DRIVEN BEHAVIOR ===
    if (goal?.type === "questing" && goal.questId) {
      const questAction = this.pickQuestAction(
        instance,
        position,
        nearbyMobs,
        nearbyResources,
        healthPercent,
      );
      if (questAction) return questAction;
    }

    // === DEFAULT: fight anything nearby, or return to spawn ===
    return this.pickCombatOrExplore(
      position,
      nearbyMobs,
      nearbyResources,
      healthPercent,
    );
  }

  /**
   * Pick the best action for the agent's current quest objective.
   * Returns null if quest state doesn't dictate a specific action
   * (caller should fall through to default combat).
   */
  private pickQuestAction(
    instance: AgentInstance,
    position: [number, number, number],
    nearbyMobs: import("./types.js").NearbyEntityData[],
    nearbyResources: import("./types.js").NearbyEntityData[],
    healthPercent: number,
  ): EmbeddedBehaviorAction | null {
    const goal = instance.goal!;
    const activeQuests = instance.service.getQuestState();
    const activeQuest = activeQuests.find((q) => q.questId === goal.questId);

    // Quest not yet accepted — walk to NPC, then accept
    if (!activeQuest && !instance.questsAccepted.has(goal.questId!)) {
      return this.moveToNpcOrAccept(
        instance,
        position,
        goal.questId!,
        goal.questStartNpc,
      );
    }

    // Quest is ready to complete — walk to NPC, then turn in
    if (activeQuest?.status === "ready_to_complete") {
      return this.moveToNpcOrComplete(instance, position, activeQuest);
    }

    // Quest in progress — route by stage type
    if (activeQuest?.status === "in_progress") {
      const stageType = activeQuest.stageType;
      const stageTarget = activeQuest.stageTarget || "";

      if (stageType === "kill") {
        const characterId = instance.service.getPlayerId() || "";
        const targetMob = this.findMobForQuest(
          characterId,
          nearbyMobs,
          stageTarget,
        );
        if (targetMob && healthPercent > 0.4) {
          instance.currentTargetId = targetMob.id;
          return { type: "attack", targetId: targetMob.id };
        }
        instance.currentTargetId = null;
        return this.moveTowardSpawn(position);
      }

      if (stageType === "gather") {
        // Gather quest: find matching resources
        const resource = this.findResourceForQuest(
          nearbyResources,
          stageTarget,
        );
        if (resource) {
          return { type: "gather", targetId: resource.id };
        }
        // No resources found — try to navigate toward them, but also
        // fight mobs opportunistically while traveling
        if (nearbyMobs.length > 0 && healthPercent > 0.5) {
          return { type: "attack", targetId: nearbyMobs[0].id };
        }
        // Navigate toward the resource area
        return this.moveTowardResourceArea(position, stageTarget);
      }

      // Interact stages (firemaking, cooking, smelting, etc.) — not yet implemented.
      // Fall through to default combat so agent isn't idle.
    }

    return null;
  }

  /**
   * Find a mob for this agent's kill quest. Spreads agents across different
   * mobs so they don't all pile on the same one (only the killing blow
   * gets quest credit).
   */
  private findMobForQuest(
    agentId: string,
    nearbyMobs: import("./types.js").NearbyEntityData[],
    stageTarget: string,
  ): import("./types.js").NearbyEntityData | undefined {
    if (nearbyMobs.length === 0) return undefined;

    const target = stageTarget.toLowerCase();

    // Filter to mobs matching the quest target
    const matchingMobs = nearbyMobs.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const mType = (m.mobType || "").toLowerCase();
      return (
        name.includes(target) ||
        mType.includes(target) ||
        target.includes(name) ||
        target.includes(mType)
      );
    });
    const candidates = matchingMobs.length > 0 ? matchingMobs : nearbyMobs;

    // Collect mob IDs already targeted by other agents
    const takenTargets = new Set<string>();
    for (const [id, inst] of this.agents) {
      if (id !== agentId && inst.currentTargetId) {
        takenTargets.add(inst.currentTargetId);
      }
    }

    // Prefer a mob nobody else is targeting
    const untargeted = candidates.find((m) => !takenTargets.has(m.id));
    if (untargeted) return untargeted;

    // All mobs are taken — pick the one with fewest agents on it
    const targetCounts = new Map<string, number>();
    for (const [id, inst] of this.agents) {
      if (id !== agentId && inst.currentTargetId) {
        targetCounts.set(
          inst.currentTargetId,
          (targetCounts.get(inst.currentTargetId) || 0) + 1,
        );
      }
    }
    candidates.sort(
      (a, b) => (targetCounts.get(a.id) || 0) - (targetCounts.get(b.id) || 0),
    );

    return candidates[0];
  }

  private findResourceForQuest(
    nearbyResources: import("./types.js").NearbyEntityData[],
    stageTarget: string,
  ): import("./types.js").NearbyEntityData | undefined {
    const keywords = this.getResourceKeywords(stageTarget);
    return nearbyResources.find((r) => {
      const haystack = `${(r.name || "").toLowerCase()} ${(r.resourceType || "").toLowerCase()}`;
      return keywords.some((kw) => haystack.includes(kw));
    });
  }

  private moveToNpcOrAccept(
    instance: AgentInstance,
    position: [number, number, number],
    questId: string,
    questStartNpc?: string,
  ): EmbeddedBehaviorAction {
    if (questStartNpc) {
      const npcPositions = instance.service.getAllNPCPositions();
      const npc = npcPositions.find(
        (n) =>
          n.npcId === questStartNpc ||
          n.name
            .toLowerCase()
            .includes(questStartNpc.replace(/_/g, " ").toLowerCase()),
      );
      if (npc) {
        const dx = position[0] - npc.position[0];
        const dz = position[2] - npc.position[2];
        if (Math.sqrt(dx * dx + dz * dz) > 6) {
          return { type: "move", target: npc.position, runMode: false };
        }
      }
    }
    return { type: "questAccept", questId };
  }

  private moveToNpcOrComplete(
    instance: AgentInstance,
    position: [number, number, number],
    activeQuest: import("./types.js").AgentQuestProgress,
  ): EmbeddedBehaviorAction {
    const npcPositions = instance.service.getAllNPCPositions();
    const startNpc = activeQuest.startNpc;
    const npc = npcPositions.find(
      (n) =>
        n.npcId === startNpc ||
        n.name
          .toLowerCase()
          .includes(startNpc.replace(/_/g, " ").toLowerCase()),
    );
    if (npc) {
      const dx = position[0] - npc.position[0];
      const dz = position[2] - npc.position[2];
      if (Math.sqrt(dx * dx + dz * dz) > 6) {
        return { type: "move", target: npc.position, runMode: false };
      }
    }
    return { type: "questComplete", questId: activeQuest.questId };
  }

  /**
   * Navigate toward an area where the target resource might be found.
   */
  private moveTowardResourceArea(
    position: [number, number, number],
    stageTarget: string,
  ): EmbeddedBehaviorAction {
    const target = stageTarget.toLowerCase();
    // Known resource locations from world-areas.json
    let targetPos: [number, number, number] | null = null;

    if (target.includes("log") || target.includes("wood")) {
      targetPos = [30, position[1], -15]; // Tree cluster area
    } else if (target.includes("shrimp") || target.includes("fish")) {
      targetPos = [-30, position[1], -8]; // Near Fisherman Pete
    } else if (
      target.includes("ore") ||
      target.includes("copper") ||
      target.includes("tin")
    ) {
      targetPos = [-28, position[1], 24]; // Near Torvin (mine area)
    }

    if (targetPos) {
      const dx = position[0] - targetPos[0];
      const dz = position[2] - targetPos[2];
      if (Math.sqrt(dx * dx + dz * dz) > 8) {
        return { type: "move", target: targetPos, runMode: false };
      }
    }

    return this.moveTowardSpawn(position);
  }

  /**
   * Default behavior: fight nearby mobs, or head back to spawn.
   */
  private pickCombatOrExplore(
    position: [number, number, number],
    nearbyMobs: import("./types.js").NearbyEntityData[],
    nearbyResources: import("./types.js").NearbyEntityData[],
    healthPercent: number,
  ): EmbeddedBehaviorAction {
    if (nearbyMobs.length > 0 && healthPercent > 0.5) {
      return { type: "attack", targetId: nearbyMobs[0].id };
    }
    if (nearbyResources.length > 0) {
      return { type: "gather", targetId: nearbyResources[0].id };
    }
    return this.moveTowardSpawn(position);
  }

  /**
   * Move the agent back toward spawn (0,0) if far away, else random patrol.
   */
  private moveTowardSpawn(
    position: [number, number, number],
  ): EmbeddedBehaviorAction {
    const [px, , pz] = position;
    const distFromSpawn = Math.sqrt(px * px + pz * pz);

    if (distFromSpawn > 25) {
      const angle = Math.atan2(-pz, -px) + (Math.random() - 0.5) * 0.6;
      const step = 12 + Math.random() * 8;
      return {
        type: "move",
        target: [
          px + Math.cos(angle) * step,
          position[1],
          pz + Math.sin(angle) * step,
        ] as [number, number, number],
        runMode: false,
      };
    }

    return {
      type: "move",
      target: this.getRandomNearbyTarget(position, 8, 18),
      runMode: false,
    };
  }

  /**
   * Map quest gather targets to resource keywords that match world entities.
   * Quest targets use item IDs (e.g., "logs", "raw_shrimp", "copper_ore")
   * but world resources use different names (e.g., "tree", "fishing_spot", "rock").
   */
  private getResourceKeywords(stageTarget: string): string[] {
    const target = stageTarget.toLowerCase();
    const keywords = [target];

    if (target.includes("log") || target.includes("wood")) {
      keywords.push("tree", "oak", "willow", "maple", "yew");
    }
    if (
      target.includes("shrimp") ||
      target.includes("fish") ||
      target.includes("trout") ||
      target.includes("salmon")
    ) {
      keywords.push("fishing", "spot", "fishing_spot");
    }
    if (
      target.includes("ore") ||
      target.includes("copper") ||
      target.includes("tin") ||
      target.includes("iron") ||
      target.includes("coal")
    ) {
      keywords.push("rock", "ore", "mining");
    }
    if (target.includes("essence")) {
      keywords.push("essence", "rune", "altar");
    }

    return keywords;
  }

  /**
   * Choose a random nearby movement target.
   */
  private getRandomNearbyTarget(
    origin: [number, number, number],
    minDistance: number,
    maxDistance: number,
  ): [number, number, number] {
    const angle = Math.random() * Math.PI * 2;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const x = origin[0] + Math.cos(angle) * distance;
    const z = origin[2] + Math.sin(angle) * distance;

    // Keep current Y to avoid abrupt vertical jumps.
    return [x, origin[1], z];
  }

  /**
   * Load agents from database that are marked as AI agents
   * and auto-start them
   */
  async loadAgentsFromDatabase(): Promise<void> {
    console.log("[AgentManager] Loading agents from database...");

    const databaseSystem = this.world.getSystem("database") as
      | {
          db: {
            select: () => {
              from: (table: unknown) => {
                where: (condition: unknown) => Promise<
                  Array<{
                    id: string;
                    accountId: string;
                    name: string;
                    isAgent: boolean;
                  }>
                >;
              };
            };
          };
        }
      | undefined;

    if (!databaseSystem?.db) {
      console.warn(
        "[AgentManager] Database not available, skipping agent load",
      );
      return;
    }

    try {
      // Query characters marked as agents
      const { characters } = await import("../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // isAgent is stored as integer (1 = true, 0 = false) in database
      const agentCharacters = await databaseSystem.db
        .select()
        .from(characters)
        .where(eq(characters.isAgent, 1));

      console.log(
        `[AgentManager] Found ${agentCharacters.length} agent character(s) in database`,
      );

      // Create agents for each
      for (const char of agentCharacters) {
        try {
          await this.createAgent({
            characterId: char.id,
            accountId: char.accountId,
            name: char.name,
            autoStart: true,
          });
        } catch (err) {
          console.error(
            `[AgentManager] Failed to create agent for ${char.name}:`,
            errMsg(err),
          );
        }
      }

      console.log(`[AgentManager] ✅ Loaded ${this.agents.size} agent(s)`);
    } catch (err) {
      console.error(
        "[AgentManager] Error loading agents from database:",
        errMsg(err),
      );
    }
  }

  /**
   * Gracefully shut down all agents
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.log(`[AgentManager] Shutting down ${this.agents.size} agent(s)...`);

    const stopPromises: Promise<void>[] = [];

    for (const [characterId] of this.agents) {
      stopPromises.push(
        this.stopAgent(characterId).catch((err) => {
          console.error(
            `[AgentManager] Error stopping agent ${characterId}:`,
            errMsg(err),
          );
        }),
      );
    }

    await Promise.all(stopPromises);

    this.agents.clear();
    console.log("[AgentManager] ✅ All agents shut down");
  }
}

/**
 * Global agent manager instance (set during server startup)
 */
let globalAgentManager: AgentManager | null = null;

/**
 * Get the global agent manager instance
 */
export function getAgentManager(): AgentManager | null {
  return globalAgentManager;
}

/**
 * Set the global agent manager instance (called during startup)
 */
export function setAgentManager(manager: AgentManager): void {
  globalAgentManager = manager;
}
