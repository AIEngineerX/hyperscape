/**
 * BotSpawner - Spawns AI model agents for dueling and testing
 *
 * This module creates embedded AI agents for each supported AI model.
 * These agents are automatically registered with the DuelScheduler for
 * continuous agent-vs-agent PvP matches.
 *
 * AI Models:
 * - OpenAI: GPT-4, GPT-4o, GPT-4o-mini, o1, o1-mini
 * - Anthropic: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku
 *
 * Usage:
 * ```typescript
 * import { spawnModelBots } from './BotSpawner';
 * await spawnModelBots(agentManager, databaseSystem);
 * ```
 */

import type { AgentManager } from "./AgentManager.js";
import type { World } from "@hyperscape/shared";
import { v4 as uuidv4 } from "uuid";

/**
 * Bot configuration for each AI model
 */
interface BotConfig {
  /** Unique identifier for the bot (used as characterId) */
  id: string;
  /** Display name in-game */
  name: string;
  /** The AI model this bot represents */
  model: string;
  /** Provider (openai, anthropic) */
  provider: "openai" | "anthropic";
  /** Starting skills for combat diversity */
  skills?: {
    attack?: number;
    strength?: number;
    defense?: number;
    constitution?: number;
  };
}

/**
 * Default AI model bots to spawn
 * Each represents a different AI model for showcasing and dueling
 */
export const AI_MODEL_BOTS: BotConfig[] = [
  // OpenAI Models
  {
    id: "bot-gpt-4o",
    name: "[AI] GPT-4o",
    model: "gpt-4o",
    provider: "openai",
    skills: { attack: 40, strength: 45, defense: 35, constitution: 50 },
  },
  {
    id: "bot-gpt-4o-mini",
    name: "[AI] GPT-4o Mini",
    model: "gpt-4o-mini",
    provider: "openai",
    skills: { attack: 25, strength: 30, defense: 20, constitution: 35 },
  },
  {
    id: "bot-gpt-4",
    name: "[AI] GPT-4",
    model: "gpt-4",
    provider: "openai",
    skills: { attack: 35, strength: 40, defense: 30, constitution: 45 },
  },
  {
    id: "bot-o1",
    name: "[AI] o1",
    model: "o1",
    provider: "openai",
    skills: { attack: 50, strength: 50, defense: 50, constitution: 60 },
  },
  {
    id: "bot-o1-mini",
    name: "[AI] o1-mini",
    model: "o1-mini",
    provider: "openai",
    skills: { attack: 30, strength: 35, defense: 25, constitution: 40 },
  },
  // Anthropic Models
  {
    id: "bot-claude-4-opus",
    name: "[AI] Claude 4 Opus",
    model: "claude-opus-4-5-20251101",
    provider: "anthropic",
    skills: { attack: 55, strength: 55, defense: 55, constitution: 65 },
  },
  {
    id: "bot-claude-3-5-sonnet",
    name: "[AI] Claude 3.5 Sonnet",
    model: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    skills: { attack: 45, strength: 50, defense: 40, constitution: 55 },
  },
  {
    id: "bot-claude-3-opus",
    name: "[AI] Claude 3 Opus",
    model: "claude-3-opus-20240229",
    provider: "anthropic",
    skills: { attack: 45, strength: 45, defense: 45, constitution: 55 },
  },
  {
    id: "bot-claude-3-sonnet",
    name: "[AI] Claude 3 Sonnet",
    model: "claude-3-sonnet-20240229",
    provider: "anthropic",
    skills: { attack: 35, strength: 40, defense: 30, constitution: 45 },
  },
  {
    id: "bot-claude-3-haiku",
    name: "[AI] Claude 3 Haiku",
    model: "claude-3-haiku-20240307",
    provider: "anthropic",
    skills: { attack: 20, strength: 25, defense: 15, constitution: 30 },
  },
];

/**
 * Database system interface for bot spawning
 */
interface DatabaseSystem {
  db: {
    select: () => {
      from: (table: unknown) => {
        where: (condition: unknown) => Promise<Array<{ id: string }>>;
      };
    };
    insert: (table: unknown) => {
      values: (data: unknown) => Promise<void>;
    };
  };
}

/**
 * Spawn AI model bots for dueling
 *
 * Creates characters in the database for each AI model if they don't exist,
 * then uses AgentManager to spawn them as embedded agents.
 *
 * @param agentManager - The AgentManager instance
 * @param world - The World instance (for database access)
 * @param options - Configuration options
 * @returns Number of bots spawned
 */
export async function spawnModelBots(
  agentManager: AgentManager,
  world: World,
  options: {
    /** Only spawn bots if no agents exist */
    onlyIfEmpty?: boolean;
    /** Maximum number of bots to spawn */
    maxBots?: number;
    /** Specific bot IDs to spawn (if empty, spawns all) */
    botIds?: string[];
  } = {},
): Promise<number> {
  const { onlyIfEmpty = false, maxBots = 10, botIds = [] } = options;

  // Check if we should skip spawning
  if (onlyIfEmpty && agentManager.getAllAgents().length > 0) {
    console.log(
      "[BotSpawner] Agents already exist, skipping bot spawn (onlyIfEmpty=true)",
    );
    return 0;
  }

  // Get database system
  const databaseSystem = world.getSystem("database") as DatabaseSystem | null;

  if (!databaseSystem?.db) {
    console.warn("[BotSpawner] Database not available, cannot spawn bots");
    return 0;
  }

  // Filter bots to spawn
  let botsToSpawn = AI_MODEL_BOTS;
  if (botIds.length > 0) {
    botsToSpawn = botsToSpawn.filter((bot) => botIds.includes(bot.id));
  }
  botsToSpawn = botsToSpawn.slice(0, maxBots);

  console.log(`[BotSpawner] Spawning ${botsToSpawn.length} AI model bots...`);

  // Import database schema
  const { characters, users } = await import("../database/schema.js");
  const { eq } = await import("drizzle-orm");

  let spawnedCount = 0;

  for (const bot of botsToSpawn) {
    try {
      // Check if character already exists
      const existingCharacters = (await databaseSystem.db
        .select()
        .from(characters)
        .where(eq(characters.id, bot.id))) as Array<{ id: string }>;

      // Create bot account ID
      const accountId = `bot-account-${bot.provider}`;

      if (existingCharacters.length === 0) {
        // Ensure account exists
        const existingUsers = (await databaseSystem.db
          .select()
          .from(users)
          .where(eq(users.id, accountId))) as Array<{ id: string }>;

        if (existingUsers.length === 0) {
          await databaseSystem.db.insert(users).values({
            id: accountId,
            name: `${bot.provider.toUpperCase()} Bots`,
            roles: "bot",
            createdAt: new Date().toISOString(),
          });
        }

        // Create character
        await databaseSystem.db.insert(characters).values({
          id: bot.id,
          accountId,
          name: bot.name,
          isAgent: 1,
          createdAt: Date.now(),
        });

        console.log(`[BotSpawner] Created character: ${bot.name}`);
      }

      // Check if agent already running
      if (agentManager.hasAgent(bot.id)) {
        console.log(`[BotSpawner] Agent ${bot.name} already running, skipping`);
        continue;
      }

      // Spawn the agent via AgentManager
      await agentManager.createAgent({
        characterId: bot.id,
        accountId,
        name: bot.name,
        autoStart: true,
      });

      spawnedCount++;
      console.log(`[BotSpawner] ✅ Spawned: ${bot.name} (${bot.model})`);
    } catch (error) {
      console.error(
        `[BotSpawner] ❌ Failed to spawn ${bot.name}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(
    `[BotSpawner] ✅ Spawned ${spawnedCount}/${botsToSpawn.length} bots`,
  );

  return spawnedCount;
}

/**
 * Get the list of available AI model bots
 */
export function getAvailableBots(): BotConfig[] {
  return [...AI_MODEL_BOTS];
}

/**
 * Get bots by provider
 */
export function getBotsByProvider(
  provider: "openai" | "anthropic",
): BotConfig[] {
  return AI_MODEL_BOTS.filter((bot) => bot.provider === provider);
}
