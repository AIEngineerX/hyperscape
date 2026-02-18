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

// Model agent spawner for real ElizaOS agents with different AI models
export {
  spawnModelAgents,
  getRunningAgents,
  stopModelAgent,
  stopAllModelAgents,
  getAvailableModels,
  MODEL_AGENTS,
} from "./ModelAgentSpawner.js";

import type { World } from "@hyperscape/shared";
import { AgentManager, setAgentManager } from "./AgentManager.js";
import { spawnModelAgents, getAvailableModels } from "./ModelAgentSpawner.js";

/**
 * Server configuration type (partial, for what we need)
 */
interface ServerConfig {
  autoStartAgents?: boolean;
  /** Spawn ElizaOS agents with different AI models (default: true if SPAWN_MODEL_AGENTS !== "false") */
  spawnModelAgents?: boolean;
  /** Maximum number of model agents to spawn */
  maxModelAgents?: number;
  /** Specific providers to spawn (openai, anthropic, groq, xai) */
  modelProviders?: Array<"openai" | "anthropic" | "groq" | "xai">;
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

  // Spawn ElizaOS agents with different AI models
  const shouldSpawnAgents =
    config?.spawnModelAgents !== false &&
    process.env.SPAWN_MODEL_AGENTS !== "false";

  if (shouldSpawnAgents) {
    const availableModels = getAvailableModels();
    console.log(
      `[Eliza] Found ${availableModels.length} model(s) with API keys configured`,
    );

    if (availableModels.length > 0) {
      console.log("[Eliza] Spawning ElizaOS model agents for dueling...");
      const maxAgents =
        config?.maxModelAgents ??
        parseInt(process.env.MAX_MODEL_AGENTS || "10", 10);

      const spawnedCount = await spawnModelAgents(world, {
        maxAgents,
        providers: config?.modelProviders,
      });

      console.log(`[Eliza] ✅ Spawned ${spawnedCount} ElizaOS model agents`);
    } else {
      console.log(
        "[Eliza] No model API keys configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, or XAI_API_KEY to spawn model agents.",
      );
    }
  } else {
    console.log(
      "[Eliza] Model agent spawning disabled (SPAWN_MODEL_AGENTS=false)",
    );
  }

  console.log("[Eliza] ✅ Embedded agent system initialized");

  return manager;
}
