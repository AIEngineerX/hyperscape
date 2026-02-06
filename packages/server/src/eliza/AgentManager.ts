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
    return (mod as Record<string, unknown>).hyperscapePlugin as Plugin;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load @hyperscape/plugin-hyperscape:",
      err instanceof Error ? err.message : String(err),
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
    // The SQL plugin exports as 'sqlPlugin', 'plugin', or 'default' depending on version
    const sqlPlugin =
      (mod as Record<string, unknown>).sqlPlugin ??
      (mod as Record<string, unknown>).plugin ??
      mod.default;
    if (sqlPlugin) {
      console.log("[AgentManager] Loaded SQL plugin for database support");
      return sqlPlugin as Plugin;
    }
    console.warn(
      "[AgentManager] SQL plugin module loaded but no plugin export found. Exports:",
      Object.keys(mod),
    );
    return null;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load SQL plugin:",
      err instanceof Error ? err.message : String(err),
    );
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
      // Cast needed due to potential type version mismatch in nested node_modules
      return mod.openaiPlugin as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load OpenAI plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Check for Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // @ts-ignore - optional plugin, may not be installed
      const mod = await import("@elizaos/plugin-anthropic");
      console.log("[AgentManager] Using Anthropic model provider");
      return (mod.anthropicPlugin ?? mod.default) as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load Anthropic plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Check for OpenRouter API key
  if (process.env.OPENROUTER_API_KEY) {
    try {
      // @ts-ignore - optional plugin, may not be installed
      const mod = await import("@elizaos/plugin-openrouter");
      console.log("[AgentManager] Using OpenRouter model provider");
      return (mod.openrouterPlugin ?? mod.default) as Plugin;
    } catch (err) {
      console.warn(
        "[AgentManager] Failed to load OpenRouter plugin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fall back to Ollama for local development (no API key needed)
  try {
    const mod = await import("@elizaos/plugin-ollama");
    console.log("[AgentManager] Using Ollama model provider (local fallback)");
    return mod.ollamaPlugin as Plugin;
  } catch (err) {
    console.warn(
      "[AgentManager] Failed to load Ollama plugin:",
      err instanceof Error ? err.message : String(err),
    );
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
 * Internal agent instance tracking
 */
interface AgentInstance {
  config: EmbeddedAgentConfig;
  service: EmbeddedHyperscapeService;
  state: AgentState;
  startedAt: number;
  lastActivity: number;
  error?: string;
  // Will add ElizaOS runtime when implemented
  // runtime?: AgentRuntime;
}

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
    };

    this.agents.set(characterId, instance);

    // Auto-start if configured
    if (config.autoStart !== false) {
      try {
        await this.startAgent(characterId);
      } catch (err) {
        instance.state = "error";
        instance.error =
          err instanceof Error ? err.message : String(err);
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

      console.log(
        `[AgentManager] ✅ Agent ${instance.config.name} is now running`,
      );

      // TODO: Initialize ElizaOS AgentRuntime with EmbeddedHyperscapeService
      // This will be implemented once we integrate the full ElizaOS runtime
      // await this.initializeElizaRuntime(instance);

    } catch (err) {
      instance.state = "error";
      instance.error =
        err instanceof Error ? err.message : String(err);
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
      await instance.service.stop();
      instance.state = "stopped";
      instance.lastActivity = Date.now();

      console.log(
        `[AgentManager] ✅ Agent ${instance.config.name} stopped`,
      );
    } catch (err) {
      instance.state = "error";
      instance.error =
        err instanceof Error ? err.message : String(err);
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

    // TODO: Stop autonomous behavior without removing entity
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

    // TODO: Resume autonomous behavior
    instance.state = "running";
    instance.lastActivity = Date.now();

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
      console.log(`[AgentManager] Agent ${characterId} not found, nothing to remove`);
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

    console.log(
      `[AgentManager] ✅ Agent ${instance.config.name} removed`,
    );
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

    // Normalize position to tuple format [x, y, z]
    let position: [number, number, number] | null = null;
    if (playerEntity?.position) {
      const pos = playerEntity.position;
      if (Array.isArray(pos)) {
        position = [pos[0], pos[1], pos[2]];
      } else if (typeof pos === "object" && "x" in pos) {
        position = [pos.x, pos.y ?? 0, pos.z];
      }
    }

    return {
      agentId: characterId,
      characterId,
      accountId: instance.config.accountId,
      name: instance.config.name,
      state: instance.state,
      entityId: playerEntity?.id || null,
      position,
      health: playerEntity?.health?.current ?? null,
      maxHealth: playerEntity?.health?.max ?? null,
      startedAt: instance.startedAt,
      lastActivity: instance.lastActivity,
      error: instance.error,
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
    return this.getAllAgents().filter(
      (agent) => agent.accountId === accountId,
    );
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

      default:
        throw new Error(`Unknown command: ${command}`);
    }
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
      console.warn("[AgentManager] Database not available, skipping agent load");
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
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      console.log(
        `[AgentManager] ✅ Loaded ${this.agents.size} agent(s)`,
      );
    } catch (err) {
      console.error(
        "[AgentManager] Error loading agents from database:",
        err instanceof Error ? err.message : String(err),
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
    console.log(
      `[AgentManager] Shutting down ${this.agents.size} agent(s)...`,
    );

    const stopPromises: Promise<void>[] = [];

    for (const [characterId] of this.agents) {
      stopPromises.push(
        this.stopAgent(characterId).catch((err) => {
          console.error(
            `[AgentManager] Error stopping agent ${characterId}:`,
            err instanceof Error ? err.message : String(err),
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
