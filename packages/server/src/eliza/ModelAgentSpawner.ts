/**
 * ModelAgentSpawner - Spawns ElizaOS agents with different AI models
 *
 * Each agent uses a different AI model (OpenAI, Anthropic, Groq, xAI) and
 * competes in the game with a system prompt focused on mastering combat,
 * skills, and strategic dueling.
 *
 * Usage:
 * ```typescript
 * import { spawnModelAgents } from './ModelAgentSpawner';
 * await spawnModelAgents(world);
 * ```
 */

import {
  AgentRuntime,
  ModelType,
  type Plugin,
  type Character,
} from "@elizaos/core";
import { EventType, getDuelArenaConfig, type World } from "@hyperscape/shared";
import { createJWT } from "../shared/utils.js";
import { hyperscapePlugin } from "@hyperscape/plugin-hyperscape";
import type { EmbeddedHyperscapeService } from "./EmbeddedHyperscapeService.js";
import {
  ejectAgentFromCombatArena,
  recoverAgentFromDeathLoop,
} from "./agentRecovery.js";
import {
  loadModelPlugin,
  loadSqlPlugin,
  loadTrajectoryLoggerPlugin,
  createAgentCharacter,
} from "./agentHelpers.js";

/**
 * Model provider configuration
 */
export interface ModelProviderConfig {
  /** Provider name (openai, anthropic, groq, xai) */
  provider: "openai" | "anthropic" | "groq" | "xai" | "openrouter";
  /** Specific model to use */
  model: string;
  /** Display name for the agent */
  displayName: string;
  /** Environment variable for API key */
  apiKeyEnv: string;
  /** Plugin module name */
  pluginModule: string;
  /** Plugin export name */
  pluginExport: string;
}

/**
 * AI model configurations for agents
 */
export const MODEL_AGENTS: ModelProviderConfig[] = [
  // OpenAI Models
  {
    provider: "openai",
    model: "gpt-5",
    displayName: "GPT-5",
    apiKeyEnv: "OPENAI_API_KEY",
    pluginModule: "@elizaos/plugin-openai",
    pluginExport: "openaiPlugin",
  },
  {
    provider: "openai",
    model: "gpt-5-nano",
    displayName: "GPT-5 Nano",
    apiKeyEnv: "OPENAI_API_KEY",
    pluginModule: "@elizaos/plugin-openai",
    pluginExport: "openaiPlugin",
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    displayName: "GPT-4.1",
    apiKeyEnv: "OPENAI_API_KEY",
    pluginModule: "@elizaos/plugin-openai",
    pluginExport: "openaiPlugin",
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    displayName: "GPT-4.1 Mini",
    apiKeyEnv: "OPENAI_API_KEY",
    pluginModule: "@elizaos/plugin-openai",
    pluginExport: "openaiPlugin",
  },
  // Anthropic Models
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    pluginModule: "@elizaos/plugin-anthropic",
    pluginExport: "anthropicPlugin",
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    displayName: "Claude 3.5 Sonnet",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    pluginModule: "@elizaos/plugin-anthropic",
    pluginExport: "anthropicPlugin",
  },
  {
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    displayName: "Claude 3.5 Haiku",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    pluginModule: "@elizaos/plugin-anthropic",
    pluginExport: "anthropicPlugin",
  },
  // Groq Models
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    apiKeyEnv: "GROQ_API_KEY",
    pluginModule: "@elizaos/plugin-groq",
    pluginExport: "groqPlugin",
  },
  {
    provider: "groq",
    model: "mixtral-8x7b-32768",
    displayName: "Mixtral 8x7B",
    apiKeyEnv: "GROQ_API_KEY",
    pluginModule: "@elizaos/plugin-groq",
    pluginExport: "groqPlugin",
  },
  // xAI Models (Grok)
  {
    provider: "xai",
    model: "grok-2",
    displayName: "Grok 2",
    apiKeyEnv: "XAI_API_KEY",
    pluginModule: "@elizaos/plugin-xai",
    pluginExport: "xaiPlugin",
  },
  {
    provider: "xai",
    model: "grok-2-mini",
    displayName: "Grok 2 Mini",
    apiKeyEnv: "XAI_API_KEY",
    pluginModule: "@elizaos/plugin-xai",
    pluginExport: "xaiPlugin",
  },
];

// System prompt, character creation, plugin loaders — all in agentHelpers.ts

/**
 * Model agents now use the hyperscapePlugin which connects via WebSocket.
 * Each agent gets a JWT for authentication and joins the game world as a
 * normal player, enabling the full ElizaOS LLM decision loop.
 */

/**
 * Running agent instance
 */
interface RunningAgent {
  config: ModelProviderConfig;
  runtime: AgentRuntime;
  characterId: string;
  accountId: string;
}

/**
 * Global registry of running model agents
 */
const runningAgents: Map<string, RunningAgent> = new Map();

/**
 * Spawn ElizaOS agents with different AI models
 *
 * @param world - The Hyperscape world instance
 * @param options - Configuration options
 * @returns Number of agents spawned
 */
export async function spawnModelAgents(
  world: World,
  options: {
    /** Maximum number of agents to spawn */
    maxAgents?: number;
    /** Specific providers to spawn (if empty, spawns all available) */
    providers?: Array<"openai" | "anthropic" | "groq" | "xai" | "openrouter">;
  } = {},
): Promise<number> {
  const { maxAgents = 10, providers = [] } = options;

  console.log("[ModelAgentSpawner] Starting ElizaOS model agent spawning...");

  // Filter agents by provider if specified
  let agentsToSpawn = MODEL_AGENTS;
  if (providers.length > 0) {
    agentsToSpawn = agentsToSpawn.filter((a) => providers.includes(a.provider));
  }
  agentsToSpawn = agentsToSpawn.slice(0, maxAgents);

  // Load shared plugins
  const sqlPlugin = await loadSqlPlugin("ModelAgentSpawner");
  const trajectoryLoggerPlugin =
    await loadTrajectoryLoggerPlugin("ModelAgentSpawner");

  // Get database system for character creation
  // @ts-ignore - Dynamic import to avoid circular dependency
  const databaseSystem = world.getSystem("database");
  const db = databaseSystem?.getDb?.();

  if (!db) {
    console.error("[ModelAgentSpawner] Database not available");
    return 0;
  }

  const { characters, users } = await import("../database/schema.js");
  const { eq } = await import("drizzle-orm");

  // Create shared account for model agents
  const accountId = "model-agents-account";
  const existingUsers = (await db
    .select()
    .from(users)
    .where(eq(users.id, accountId))) as Array<{ id: string }>;

  if (existingUsers.length === 0) {
    await db.insert(users).values({
      id: accountId,
      name: "AI Model Agents",
      roles: "agent",
      createdAt: new Date().toISOString(),
    });
    console.log("[ModelAgentSpawner] Created shared account for model agents");
  }

  let spawnedCount = 0;

  for (const agentConfig of agentsToSpawn) {
    // Check if API key is available
    if (!process.env[agentConfig.apiKeyEnv]) {
      console.log(
        `[ModelAgentSpawner] Skipping ${agentConfig.displayName} - no API key`,
      );
      continue;
    }

    // Check if already running
    const agentKey = `${agentConfig.provider}-${agentConfig.model}`;
    if (runningAgents.has(agentKey)) {
      console.log(
        `[ModelAgentSpawner] ${agentConfig.displayName} already running`,
      );
      continue;
    }

    try {
      // Load model-specific plugin (shared helper)
      const modelPlugin = await loadModelPlugin(
        agentConfig,
        "ModelAgentSpawner",
      );
      if (!modelPlugin) {
        continue;
      }

      // Generate authentication token for this agent
      const authToken = await createJWT({ userId: accountId });

      // Create character using shared helper — includes PGLITE_DATA_DIR,
      // model routing secrets, and system prompt
      const { character, characterId } = createAgentCharacter(agentConfig, {
        secrets: {
          HYPERSCAPE_SERVER_URL:
            process.env.HYPERSCAPE_SERVER_URL ||
            `ws://127.0.0.1:${process.env.PORT || 5555}/ws`,
          HYPERSCAPE_AUTH_TOKEN: authToken,
          HYPERSCAPE_PRIVY_USER_ID: accountId,
          HYPERSCAPE_CHARACTER_ID: "", // will be patched below
        },
      });
      // Patch characterId into secrets now that we know it
      if (character.settings?.secrets) {
        (
          character.settings.secrets as Record<string, string>
        ).HYPERSCAPE_CHARACTER_ID = characterId;
      }

      // Ensure character exists in database
      const existingChars = (await db
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))) as Array<{ id: string }>;

      if (existingChars.length === 0) {
        await db.insert(characters).values({
          id: characterId,
          accountId,
          name: agentConfig.displayName,
          isAgent: 1,
          createdAt: Date.now(),
        });
        console.log(
          `[ModelAgentSpawner] Created character: ${agentConfig.displayName}`,
        );
      }

      // Build plugins array
      let plugins: Plugin[] = [modelPlugin, hyperscapePlugin as any as Plugin];
      if (sqlPlugin) {
        plugins.push(sqlPlugin);
      }
      if (trajectoryLoggerPlugin) {
        plugins.push(trajectoryLoggerPlugin);
      }

      // Try to initialize trajectory logging into memory
      try {
        // @ts-ignore - plugin module is loaded dynamically and runtime fields are probed defensively
        const mod = await import("@elizaos/plugin-trajectory-logger");
        if (mod.TrajectoryLoggerService) {
          const trajectoryLogger = new mod.TrajectoryLoggerService();
          // Wrap all collected plugins
          plugins = plugins.map((p) => {
            let wrapped = p;
            if (mod.wrapPluginActions)
              wrapped = mod.wrapPluginActions(wrapped, trajectoryLogger);
            if (mod.wrapPluginProviders)
              wrapped = mod.wrapPluginProviders(wrapped, trajectoryLogger);
            return wrapped;
          });

          // Create ElizaOS AgentRuntime
          console.log(
            `[ModelAgentSpawner] Creating AgentRuntime for ${agentConfig.displayName}...`,
          );

          const runtime = new AgentRuntime({
            character,
            plugins,
            // token: process.env[agentConfig.apiKeyEnv],
            // databaseAdapter: undefined, // Will use in-memory or default
          });

          // Start trajectory and set context
          const trajectoryId = trajectoryLogger.startTrajectory(characterId);
          if (mod.setTrajectoryContext) {
            mod.setTrajectoryContext(runtime, trajectoryId, trajectoryLogger);
          }
          console.log(
            `[ModelAgentSpawner] Started trajectory logging for ${agentConfig.displayName} (${trajectoryId})`,
          );

          // Prevent ensureEmbeddingDimension from taking > 30s due to API timeouts/rate limits
          runtime.ensureEmbeddingDimension = async () => {
            try {
              // Give the API 5 seconds to reply
              await Promise.race([
                AgentRuntime.prototype.ensureEmbeddingDimension.call(runtime),
                new Promise((_, reject) =>
                  setTimeout(
                    () =>
                      reject(new Error("Embedding dimension check timed out")),
                    5000,
                  ),
                ),
              ]);
            } catch (err) {
              console.warn(
                `[ModelAgentSpawner] ensureEmbeddingDimension failed or timed out: ${err instanceof Error ? err.message : String(err)}. Using fallback 1536.`,
              );
              await runtime.adapter?.ensureEmbeddingDimension?.(1536);
            }
          };

          // Initialize the runtime (required for plugins to start)
          await runtime.initialize();
          console.log(
            `[ModelAgentSpawner] AgentRuntime initialized for ${agentConfig.displayName}`,
          );

          // Store running agent
          runningAgents.set(agentKey, {
            config: agentConfig,
            runtime,
            characterId,
            accountId,
          });

          spawnedCount++;
          console.log(
            `[ModelAgentSpawner] ✅ Spawned: ${agentConfig.displayName} (${agentConfig.model})`,
          );

          continue; // Skip the normal initialization path
        }
      } catch (err) {
        console.warn(
          "[ModelAgentSpawner] Trajectory setup failed, falling back:",
          err instanceof Error ? err.message : String(err),
        );
      }

      // Create ElizaOS AgentRuntime (Fallback without trajectory logging setup)
      console.log(
        `[ModelAgentSpawner] Creating AgentRuntime for ${agentConfig.displayName}...`,
      );

      const runtime = new AgentRuntime({
        character,
        plugins,
        // token: process.env[agentConfig.apiKeyEnv],
        // databaseAdapter: undefined, // Will use in-memory or default
      });

      // Prevent ensureEmbeddingDimension from taking > 30s due to API timeouts/rate limits
      runtime.ensureEmbeddingDimension = async () => {
        try {
          // Give the API 5 seconds to reply
          await Promise.race([
            AgentRuntime.prototype.ensureEmbeddingDimension.call(runtime),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Embedding dimension check timed out")),
                5000,
              ),
            ),
          ]);
        } catch (err) {
          console.warn(
            `[ModelAgentSpawner] ensureEmbeddingDimension failed or timed out: ${err instanceof Error ? err.message : String(err)}. Using fallback 1536.`,
          );
          await runtime.adapter?.ensureEmbeddingDimension?.(1536);
        }
      };

      // Initialize the runtime (required for plugins to start)
      await runtime.initialize();
      console.log(
        `[ModelAgentSpawner] AgentRuntime initialized for ${agentConfig.displayName}`,
      );

      // Store running agent
      runningAgents.set(agentKey, {
        config: agentConfig,
        runtime,
        characterId,
        accountId,
      });

      spawnedCount++;
      console.log(
        `[ModelAgentSpawner] ✅ Spawned: ${agentConfig.displayName} (${agentConfig.model})`,
      );
    } catch (error) {
      console.error(
        `[ModelAgentSpawner] ❌ Failed to spawn ${agentConfig.displayName}:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Stagger agent spawns to avoid concurrent PGLite/API contention
    // that causes ElizaOS service registration timeouts (30s limit)
    if (spawnedCount > 0) {
      const SPAWN_DELAY_MS = 5000;
      console.log(
        `[ModelAgentSpawner] Waiting ${SPAWN_DELAY_MS / 1000}s before next agent...`,
      );
      await new Promise((r) => setTimeout(r, SPAWN_DELAY_MS));
    }
  }

  console.log(
    `[ModelAgentSpawner] ✅ Spawned ${spawnedCount}/${agentsToSpawn.length} model agents`,
  );

  return spawnedCount;
}

/**
 * Get all running model agents
 */
export function getRunningAgents(): Map<string, RunningAgent> {
  return new Map(runningAgents);
}

export function getAgentRuntimeByCharacterId(
  characterId: string,
): AgentRuntime | null {
  for (const agent of runningAgents.values()) {
    if (agent.characterId === characterId) return agent.runtime;
  }
  return null;
}

/**
 * Stop a specific model agent
 */
export async function stopModelAgent(
  provider: string,
  model: string,
): Promise<boolean> {
  const key = `${provider}-${model}`;
  const agent = runningAgents.get(key);

  if (!agent) {
    return false;
  }

  try {
    // Stop the runtime (this also stops HyperscapeService)
    await agent.runtime.stop();

    // Remove from registry
    runningAgents.delete(key);

    console.log(
      `[ModelAgentSpawner] Stopped agent: ${agent.config.displayName}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[ModelAgentSpawner] Error stopping agent:`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Stop all running model agents
 */
export async function stopAllModelAgents(): Promise<void> {
  console.log(
    `[ModelAgentSpawner] Stopping ${runningAgents.size} model agents...`,
  );

  const stopPromises: Promise<boolean>[] = [];

  for (const [key, agent] of runningAgents) {
    stopPromises.push(
      stopModelAgent(agent.config.provider, agent.config.model),
    );
  }

  await Promise.all(stopPromises);

  console.log("[ModelAgentSpawner] All model agents stopped");
}

/**
 * Get available models that can be spawned (have API keys configured)
 */
export function getAvailableModels(): ModelProviderConfig[] {
  return MODEL_AGENTS.filter((config) => process.env[config.apiKeyEnv]);
}

// ============================================================================
// Autonomous Behavior Loop
// ============================================================================

/** Behavior tick interval in ms */
const BEHAVIOR_TICK_INTERVAL = 3000; // 3 seconds

/** Map of behavior loop intervals for cleanup */
const behaviorIntervals: Map<string, NodeJS.Timeout> = new Map();

/** Keep autonomous roaming near the duel lobby so spectators always see activity on known terrain. */
const LOBBY_SOFT_RADIUS = 80;
const LOBBY_HARD_RADIUS = 150;

function distance2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

function getGroundedY(
  world: World,
  x: number,
  z: number,
  fallbackY: number,
): number {
  const terrain = world.getSystem("terrain") as {
    getHeightAt?: (x: number, z: number) => number;
  } | null;
  const sampledY = terrain?.getHeightAt?.(x, z);
  return typeof sampledY === "number" && Number.isFinite(sampledY)
    ? sampledY
    : fallbackY;
}

function getSafeLobbyPosition(
  world: World,
  agentSeed: string,
): [number, number, number] {
  const lobby = getDuelArenaConfig().lobbySpawnPoint;

  let hash = 0;
  for (let i = 0; i < agentSeed.length; i++) {
    hash = (hash * 31 + agentSeed.charCodeAt(i)) >>> 0;
  }

  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 6 + (hash % 4);
  const x = lobby.x + Math.cos(angle) * radius;
  const z = lobby.z + Math.sin(angle) * radius;
  const y = getGroundedY(world, x, z, lobby.y);
  return [x, y, z];
}

function constrainTargetToLobby(
  world: World,
  target: [number, number, number],
): [number, number, number] {
  const lobby = getDuelArenaConfig().lobbySpawnPoint;
  const dist = distance2D(target[0], target[2], lobby.x, lobby.z);
  let x = target[0];
  let z = target[2];

  if (dist > LOBBY_SOFT_RADIUS && dist > 0) {
    const scale = LOBBY_SOFT_RADIUS / dist;
    x = lobby.x + (target[0] - lobby.x) * scale;
    z = lobby.z + (target[2] - lobby.z) * scale;
  }

  const y = getGroundedY(world, x, z, lobby.y);
  return [x, y, z];
}

function snapAgentToPosition(
  service: EmbeddedHyperscapeService,
  position: [number, number, number],
): boolean {
  const playerId = service.getPlayerId();
  if (!playerId) return false;

  const world = service.getWorld();
  const entity = world.entities.get(playerId);
  if (!entity) return false;

  const data = entity.data as {
    position?: unknown;
    rotation?: number;
    _teleport?: boolean;
  };
  data.position = position;
  data._teleport = true;

  world.emit("player:teleport", {
    playerId,
    position: { x: position[0], y: position[1], z: position[2] },
    rotation: Number.isFinite(data.rotation) ? data.rotation : 0,
  });

  world.emit(EventType.ENTITY_MODIFIED, {
    id: playerId,
    changes: {
      position,
      _teleport: true,
    },
  });

  return true;
}

/**
 * Start the autonomous behavior loop for an embedded agent
 *
 * This is a simplified behavior loop that uses EmbeddedHyperscapeService
 * directly for game actions, without going through the full ElizaOS
 * action/provider pipeline.
 */
function startAgentBehaviorLoop(
  runtime: AgentRuntime,
  service: EmbeddedHyperscapeService,
  config: ModelProviderConfig,
): void {
  const agentKey = `${config.provider}-${config.model}`;

  console.log(
    `[ModelAgentSpawner] Starting behavior loop for ${config.displayName}`,
  );

  // Clear any existing interval
  const existingInterval = behaviorIntervals.get(agentKey);
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  // Start the behavior loop with execution lock to prevent overlapping ticks
  let tickInProgress = false;
  const interval = setInterval(async () => {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      await executeBehaviorTick(runtime, service, config);
    } catch (error) {
      console.error(
        `[ModelAgentSpawner] Behavior tick error for ${config.displayName}:`,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      tickInProgress = false;
    }
  }, BEHAVIOR_TICK_INTERVAL);

  behaviorIntervals.set(agentKey, interval);

  // Execute first tick immediately
  executeBehaviorTick(runtime, service, config).catch((err) => {
    console.error(
      `[ModelAgentSpawner] Initial behavior tick error for ${config.displayName}:`,
      err instanceof Error ? err.message : String(err),
    );
  });
}

/**
 * Stop the behavior loop for an agent
 */
function stopAgentBehaviorLoop(agentKey: string): void {
  const interval = behaviorIntervals.get(agentKey);
  if (interval) {
    clearInterval(interval);
    behaviorIntervals.delete(agentKey);
  }
}

/**
 * Execute a single behavior tick
 *
 * The agent observes its game state and decides what to do:
 * - If low health, flee from combat
 * - If there are nearby enemies and we're healthy, attack
 * - If there are resources nearby, gather them
 * - Otherwise, explore randomly
 */
// ============================================================================
// LLM Behavior Planning
// ============================================================================

interface PlannedAction {
  action: string;
  target?: string;
  position?: [number, number, number];
  reason: string;
}

interface AgentPlan {
  actions: PlannedAction[];
  goal: string;
  createdAt: number;
}

const agentPlans: Map<string, AgentPlan> = new Map();
const PLAN_STALE_MS = 30000;

async function getOrCreatePlan(
  runtime: AgentRuntime,
  service: EmbeddedHyperscapeService,
  config: ModelProviderConfig,
  gameState: ReturnType<EmbeddedHyperscapeService["getGameState"]> & object,
  world: ReturnType<EmbeddedHyperscapeService["getWorld"]>,
): Promise<AgentPlan | null> {
  const existing = agentPlans.get(config.displayName);
  if (
    existing &&
    existing.actions.length > 0 &&
    Date.now() - existing.createdAt < PLAN_STALE_MS
  ) {
    return existing;
  }

  try {
    const plan = await createBehaviorPlan(runtime, service, config, gameState);
    if (plan) {
      agentPlans.set(config.displayName, plan);
      return plan;
    }
  } catch (err) {
    console.debug(
      `[${config.displayName}] LLM plan failed, using fallback:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return null;
}

async function createBehaviorPlan(
  runtime: AgentRuntime,
  service: EmbeddedHyperscapeService,
  config: ModelProviderConfig,
  gameState: ReturnType<EmbeddedHyperscapeService["getGameState"]> & object,
): Promise<AgentPlan | null> {
  const { health, maxHealth, nearbyEntities, inCombat, inventory } = gameState;
  const healthPct = ((health / maxHealth) * 100).toFixed(0);

  const mobs = nearbyEntities.filter((e) => e.type === "mob").slice(0, 5);
  const resources = nearbyEntities
    .filter((e) => e.type === "resource")
    .slice(0, 5);
  const items = nearbyEntities.filter((e) => e.type === "item").slice(0, 5);
  const npcs = nearbyEntities.filter((e) => e.type === "npc").slice(0, 3);

  const foodCount = inventory.filter((i) =>
    [
      "shark",
      "lobster",
      "swordfish",
      "trout",
      "salmon",
      "shrimp",
      "bread",
      "meat",
      "cooked",
      "fish",
    ].some((f) => i.itemId.toLowerCase().includes(f)),
  ).length;

  const prompt = [
    `You are ${config.displayName}, an OSRS-style RPG agent between arena duels.`,
    `Plan your next 3-5 actions to prepare for the next duel.`,
    ``,
    `STATE: HP ${healthPct}%, ${inventory.length}/28 inventory, ${foodCount} food, ${inCombat ? "IN COMBAT" : "idle"}`,
    `NEARBY: ${mobs.length} mobs, ${resources.length} resources, ${items.length} ground items, ${npcs.length} NPCs`,
    mobs.length > 0
      ? `MOBS: ${mobs.map((m) => `${m.name || m.type}(${m.distance.toFixed(0)}m)`).join(", ")}`
      : "",
    resources.length > 0
      ? `RESOURCES: ${resources.map((r) => `${r.name || r.type}(${r.distance.toFixed(0)}m)`).join(", ")}`
      : "",
    items.length > 0
      ? `ITEMS: ${items.map((i) => `${i.name || i.type}(${i.distance.toFixed(0)}m)`).join(", ")}`
      : "",
    ``,
    `PRIORITIES: Get food for duels > train combat > gather resources > explore`,
    `AVAILABLE ACTIONS: MOVE, ATTACK, GATHER, PICKUP, USE, EQUIP, DROP, COOK, SMELT, SMITH, FIREMAKE, BANK_DEPOSIT, BANK_WITHDRAW, BANK_DEPOSIT_ALL, STORE_BUY, STORE_SELL, TALK, QUEST_ACCEPT, QUEST_COMPLETE, UNEQUIP, TRADE, FOLLOW, PRAY, CHANGE_STYLE, HOME_TELEPORT, EXPLORE, IDLE`,
    ``,
    `Respond as JSON: { "goal": "brief goal", "actions": [{"action": "ACTION", "target": "id or description", "reason": "why"}] }`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt,
    maxTokens: 300,
    temperature: 0.5,
  });

  const text = typeof response === "string" ? response : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]) as {
    goal?: string;
    actions?: Array<{ action?: string; target?: string; reason?: string }>;
  };

  if (!parsed.actions || !Array.isArray(parsed.actions)) return null;

  return {
    goal: parsed.goal || "prepare for duel",
    actions: parsed.actions
      .filter((a) => a.action)
      .map((a) => ({
        action: (a.action || "IDLE").toUpperCase(),
        target: a.target,
        reason: a.reason || "",
      })),
    createdAt: Date.now(),
  };
}

async function executeQueuedAction(
  service: EmbeddedHyperscapeService,
  action: PlannedAction,
  gameState: ReturnType<EmbeddedHyperscapeService["getGameState"]> & object,
  world: ReturnType<EmbeddedHyperscapeService["getWorld"]>,
): Promise<void> {
  const { nearbyEntities } = gameState;

  switch (action.action) {
    case "ATTACK": {
      const mob = nearbyEntities.find(
        (e) =>
          e.type === "mob" &&
          e.distance < 50 &&
          (!action.target ||
            e.id === action.target ||
            (e.name || "")
              .toLowerCase()
              .includes((action.target || "").toLowerCase())),
      );
      if (mob) {
        if (mob.distance > 3) {
          await service.executeMove(mob.position, true);
        } else {
          await service.executeAttack(mob.id);
        }
      }
      break;
    }

    case "GATHER": {
      const resource = nearbyEntities.find(
        (e) =>
          e.type === "resource" &&
          e.distance < 40 &&
          (!action.target ||
            (e.name || "")
              .toLowerCase()
              .includes((action.target || "").toLowerCase())),
      );
      if (resource) {
        if (resource.distance > 3) {
          await service.executeMove(resource.position, false);
        } else {
          await service.executeGather(resource.id);
        }
      }
      break;
    }

    case "PICKUP": {
      const item = nearbyEntities.find(
        (e) =>
          e.type === "item" &&
          e.distance < 30 &&
          (!action.target ||
            (e.name || "")
              .toLowerCase()
              .includes((action.target || "").toLowerCase())),
      );
      if (item) {
        if (item.distance > 2.5) {
          await service.executeMove(item.position, true);
        } else {
          await service.executePickup(item.id);
        }
      }
      break;
    }

    case "USE": {
      const useItem = gameState.inventory.find(
        (i) =>
          action.target &&
          i.itemId.toLowerCase().includes(action.target.toLowerCase()),
      );
      if (useItem) {
        await service.executeUse(useItem.itemId);
      }
      break;
    }

    case "EQUIP": {
      const equipItem = gameState.inventory.find(
        (i) =>
          action.target &&
          i.itemId.toLowerCase().includes(action.target.toLowerCase()),
      );
      if (equipItem) {
        await service.executeEquip(equipItem.itemId);
      }
      break;
    }

    case "MOVE":
    case "EXPLORE": {
      if (action.position) {
        const target = constrainTargetToLobby(world, action.position);
        await service.executeMove(target, false);
      } else if (gameState.position) {
        const exploreX = gameState.position[0] + (Math.random() - 0.5) * 50;
        const exploreZ = gameState.position[2] + (Math.random() - 0.5) * 50;
        const target = constrainTargetToLobby(world, [
          exploreX,
          gameState.position[1],
          exploreZ,
        ]);
        await service.executeMove(target, false);
      }
      break;
    }

    case "COOK":
      if (action.target) await service.executeCook(action.target);
      break;

    case "SMELT":
      if (action.target) await service.executeSmelt(action.target);
      break;

    case "SMITH":
      if (action.target) await service.executeSmith(action.target);
      break;

    case "FIREMAKE":
      await service.executeFiremake();
      break;

    case "BANK_DEPOSIT":
      if (action.target) await service.executeBankDeposit(action.target, 1);
      break;

    case "BANK_WITHDRAW":
      if (action.target) await service.executeBankWithdraw(action.target, 1);
      break;

    case "BANK_DEPOSIT_ALL":
      await service.executeBankDepositAll();
      break;

    case "STORE_BUY":
      if (action.target) {
        const [storeId, itemId] = action.target.split(":");
        if (storeId && itemId)
          await service.executeStoreBuy(storeId, itemId, 1);
      }
      break;

    case "STORE_SELL":
      if (action.target) {
        const [storeId, itemId] = action.target.split(":");
        if (storeId && itemId)
          await service.executeStoreSell(storeId, itemId, 1);
      }
      break;

    case "NPC_INTERACT":
    case "TALK":
      if (action.target)
        await service.executeNpcInteract(action.target, "talk");
      break;

    case "QUEST_ACCEPT":
      if (action.target) await service.executeQuestAccept(action.target);
      break;

    case "QUEST_COMPLETE":
      if (action.target) await service.executeQuestComplete(action.target);
      break;

    case "UNEQUIP":
      if (action.target) await service.executeUnequip(action.target);
      break;

    case "TRADE":
      if (action.target) await service.executeTradeRequest(action.target);
      break;

    case "FOLLOW":
      if (action.target) await service.executeFollow(action.target);
      break;

    case "PRAY":
    case "PRAYER":
      if (action.target) await service.executePrayerToggle(action.target);
      break;

    case "PRAYER_OFF":
      await service.executePrayerDeactivateAll();
      break;

    case "CHANGE_STYLE":
      if (action.target) await service.executeChangeStyle(action.target);
      break;

    case "HOME_TELEPORT":
      await service.executeHomeTeleport();
      break;

    case "RESPAWN":
      await service.executeRespawn();
      break;

    case "DROP":
      if (action.target) await service.executeDrop(action.target, 1);
      break;

    case "CHAT":
      if (action.target) await service.executeChat(action.target);
      break;

    case "IDLE":
    default:
      break;
  }
}

async function executeBehaviorTick(
  runtime: AgentRuntime,
  service: EmbeddedHyperscapeService,
  config: ModelProviderConfig,
): Promise<void> {
  const playerId = service.getPlayerId();
  if (!playerId) {
    return;
  }

  const world = service.getWorld();

  // Recover model agents from stale dead states outside active duel ownership.
  if (
    recoverAgentFromDeathLoop(
      world,
      playerId,
      `ModelAgentSpawner:${config.displayName}`,
    )
  ) {
    return;
  }

  if (
    ejectAgentFromCombatArena(
      world,
      playerId,
      `ModelAgentSpawner:${config.displayName}`,
    )
  ) {
    return;
  }

  // Duel scheduler owns combat behavior during streaming duels.
  const playerEntity = world.entities.get(playerId);
  const inStreamingDuel =
    (playerEntity as { data?: { inStreamingDuel?: boolean } } | undefined)?.data
      ?.inStreamingDuel === true;
  if (inStreamingDuel) {
    return;
  }

  // Get current game state
  const gameState = service.getGameState();
  if (!gameState) {
    // Agent not spawned yet
    return;
  }

  const lobby = getDuelArenaConfig().lobbySpawnPoint;
  if (gameState.position) {
    const [px, py, pz] = gameState.position;
    const distFromLobby = distance2D(px, pz, lobby.x, lobby.z);
    const groundedY = getGroundedY(world, px, pz, lobby.y);
    const invalidY = !Number.isFinite(py) || py < -20 || py > 300;
    const tooFarFromLobby = distFromLobby > LOBBY_HARD_RADIUS;
    const offTerrain =
      Number.isFinite(groundedY) && Math.abs(py - groundedY) > 3;

    if (invalidY || tooFarFromLobby || offTerrain) {
      const safePos: [number, number, number] =
        invalidY || tooFarFromLobby
          ? getSafeLobbyPosition(world, playerId ?? config.displayName)
          : [px, groundedY, pz];
      if (snapAgentToPosition(service, safePos)) {
        return;
      }
    }
  }

  const { health, maxHealth, nearbyEntities, inCombat } = gameState;
  const healthPercent = (health / maxHealth) * 100;

  // Survival override: FLEE immediately at critical health
  if (healthPercent < 25 && inCombat && gameState.position) {
    const fleeX = gameState.position[0] + (Math.random() - 0.5) * 40;
    const fleeZ = gameState.position[2] + (Math.random() - 0.5) * 40;
    const fleeTarget = constrainTargetToLobby(world, [
      fleeX,
      gameState.position[1],
      fleeZ,
    ]);
    await service.executeMove(fleeTarget, true);
    agentPlans.delete(config.displayName);
    return;
  }

  // LLM-driven action planning
  const plan = await getOrCreatePlan(
    runtime,
    service,
    config,
    gameState,
    world,
  );

  if (!plan || plan.actions.length === 0) {
    // Fallback: simple exploration
    if (!inCombat && gameState.position) {
      const exploreX = gameState.position[0] + (Math.random() - 0.5) * 60;
      const exploreZ = gameState.position[2] + (Math.random() - 0.5) * 60;
      const target = constrainTargetToLobby(world, [
        exploreX,
        gameState.position[1],
        exploreZ,
      ]);
      await service.executeMove(target, false);
    }
    return;
  }

  // Pop next action from queue
  const nextAction = plan.actions.shift()!;

  try {
    await executeQueuedAction(service, nextAction, gameState, world);
  } catch (err) {
    console.debug(
      `[${config.displayName}] Plan action ${nextAction.action} failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // If plan is exhausted, clear it so next tick re-plans
  if (plan.actions.length === 0) {
    agentPlans.delete(config.displayName);
  }
}
