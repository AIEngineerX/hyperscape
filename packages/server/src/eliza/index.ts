/**
 * Embedded Eliza Agent Module
 *
 * This module provides embedded ElizaOS agent support for the Hyperscape server.
 * Agents run directly in the server process with direct world access, eliminating
 * the need for external ElizaOS processes and WebSocket connections.
 *
 * Usage:
 * ```typescript
 * import { initializeAgents, getAgentManager } from './eliza';
 *
 * // During server startup
 * await initializeAgents(world, config);
 *
 * // Later, to manage agents
 * const manager = getAgentManager();
 * await manager.createAgent({ ... });
 * ```
 */

export { EmbeddedHyperscapeService } from "./EmbeddedHyperscapeService.js";
export {
  AgentManager,
  getAgentManager,
  setAgentManager,
} from "./AgentManager.js";
export type { HyperscapeService } from "./AgentManager.js";
export type {
  EmbeddedAgentConfig,
  EmbeddedAgentInfo,
  AgentState,
  AgentCharacterConfig,
  EmbeddedGameState,
  NearbyEntityData,
  IEmbeddedHyperscapeService,
} from "./types.js";

// Bot spawner for AI model agents
export {
  spawnModelBots,
  getAvailableBots,
  getBotsByProvider,
  AI_MODEL_BOTS,
} from "./BotSpawner.js";

import type { World } from "@hyperscape/shared";
import { AgentManager, setAgentManager } from "./AgentManager.js";
import { spawnModelBots } from "./BotSpawner.js";

/**
 * Server configuration type (partial, for what we need)
 */
interface ServerConfig {
  autoStartAgents?: boolean;
  /** Spawn AI model bots for dueling (default: true if SPAWN_MODEL_BOTS !== "false") */
  spawnModelBots?: boolean;
  /** Maximum number of bots to spawn */
  maxBots?: number;
}

/**
 * Initialize the embedded agent system
 *
 * This should be called during server startup after the world is created.
 *
 * @param world - The Hyperscape world instance
 * @param config - Server configuration
 * @returns The initialized AgentManager
 */
export async function initializeAgents(
  world: World,
  config?: ServerConfig,
): Promise<AgentManager> {
  console.log("[Eliza] Initializing embedded agent system...");

  // Create the agent manager
  const manager = new AgentManager(world);

  // Set as global instance
  setAgentManager(manager);

  // Load agents from database if auto-start is enabled
  const autoStart = config?.autoStartAgents !== false;
  if (autoStart) {
    console.log("[Eliza] Auto-starting agents from database...");
    await manager.loadAgentsFromDatabase();
  } else {
    console.log(
      "[Eliza] Auto-start disabled, agents will not start automatically",
    );
  }

  // Spawn AI model bots for dueling
  const shouldSpawnBots =
    config?.spawnModelBots !== false &&
    process.env.SPAWN_MODEL_BOTS !== "false";

  if (shouldSpawnBots) {
    console.log("[Eliza] Spawning AI model bots for dueling...");
    const maxBots =
      config?.maxBots ?? parseInt(process.env.MAX_MODEL_BOTS || "6", 10);
    const spawnedCount = await spawnModelBots(manager, world, {
      onlyIfEmpty: false, // Always spawn model bots
      maxBots,
    });
    console.log(`[Eliza] ✅ Spawned ${spawnedCount} AI model bots`);
  } else {
    console.log("[Eliza] Model bot spawning disabled (SPAWN_MODEL_BOTS=false)");
  }

  console.log("[Eliza] ✅ Embedded agent system initialized");

  return manager;
}
