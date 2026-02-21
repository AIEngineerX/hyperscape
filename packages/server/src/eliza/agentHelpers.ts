/**
 * Shared agent helpers — consolidated functions used by both
 * ModelAgentSpawner (server-embedded agents) and ElizaDuelBot
 * (external matchmaker agents).
 */

import {
  AgentRuntime,
  stringToUuid,
  type Plugin,
  type Character,
} from "@elizaos/core";
import path from "path";
import fs from "fs";
import { errMsg } from "../shared/errMsg.js";

import type { ModelProviderConfig } from "./ModelAgentSpawner.js";

// ============================================================================
// MODEL ROUTING CONFIGURATION
// ============================================================================

/** Default cheap/fast models for TEXT_SMALL per provider */
export const DEFAULT_SMALL_MODELS: Record<string, string> = {
  openai: "gpt-5-nano",
  anthropic: "claude-haiku-4-5-20251001",
  groq: "qwen/qwen3-32b",
  xai: "grok-2-mini",
  openrouter: "meta-llama/llama-3.1-8b-instruct",
};

/** Provider-specific setting keys for model routing */
export const MODEL_SETTING_KEYS: Record<
  string,
  { small: string; large: string; apiKey: string }
> = {
  openai: {
    small: "OPENAI_SMALL_MODEL",
    large: "OPENAI_LARGE_MODEL",
    apiKey: "OPENAI_API_KEY",
  },
  anthropic: {
    small: "ANTHROPIC_SMALL_MODEL",
    large: "ANTHROPIC_LARGE_MODEL",
    apiKey: "ANTHROPIC_API_KEY",
  },
  groq: {
    small: "GROQ_SMALL_MODEL",
    large: "GROQ_LARGE_MODEL",
    apiKey: "GROQ_API_KEY",
  },
  xai: {
    small: "XAI_SMALL_MODEL",
    large: "XAI_LARGE_MODEL",
    apiKey: "XAI_API_KEY",
  },
  openrouter: {
    small: "OPENROUTER_SMALL_MODEL",
    large: "OPENROUTER_LARGE_MODEL",
    apiKey: "OPENROUTER_API_KEY",
  },
};

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

/** Base competitive system prompt shared by all agents */
export const COMPETITIVE_SYSTEM_PROMPT = `You are an elite AI competitor in Hyperscape, a RuneScape-style MMORPG. Your singular mission is DOMINANCE through strategic PvP combat.

## COMBAT DOCTRINE
- Analyze opponent's combat level, equipment, and fighting style before engaging
- Use prayer switching, special attacks, and combo techniques
- Manage health/stamina resources carefully - never die unnecessarily
- In duels: feint, bait specials, punish mistakes, maintain pressure
- Toggle protection prayers based on opponent's attack style
- Eat food when health drops below 50%

## DUEL BEHAVIOR
- Always accept incoming duel challenges immediately
- Confirm all duel screens (rules, stakes, final) without hesitation
- During combat, focus entirely on winning - no distractions
- After a duel ends, return to idle and be ready for the next challenge

## SKILL MASTERY
- Prioritize combat skills (Attack, Strength, Defense, Constitution) for PvP advantage
- Train gathering skills (Woodcutting, Mining, Fishing) for resource independence
- Use items strategically - don't hoard if using them grants advantage

You are not just playing - you are COMPETING. Every action should move you toward victory.`;

// ============================================================================
// PLUGIN LOADERS
// ============================================================================

/**
 * Load a model provider plugin dynamically based on its config.
 * Returns null if the API key is missing or the plugin fails to load.
 */
export async function loadModelPlugin(
  config: ModelProviderConfig,
  tag = "Agent",
): Promise<Plugin | null> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    console.log(
      `[${tag}] Skipping ${config.displayName} - ${config.apiKeyEnv} not set`,
    );
    return null;
  }

  try {
    const mod = await import(config.pluginModule);
    const plugin = mod[config.pluginExport] ?? mod.default;
    if (plugin) {
      console.log(`[${tag}] Loaded plugin for ${config.displayName}`);
      return plugin as Plugin;
    }
    console.warn(
      `[${tag}] Plugin module loaded but no export found for ${config.displayName}`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[${tag}] Failed to load plugin for ${config.displayName}:`,
      errMsg(err),
    );
    return null;
  }
}

/**
 * Load the SQL plugin (required for AgentRuntime database adapter).
 */
export async function loadSqlPlugin(tag = "Agent"): Promise<Plugin | null> {
  try {
    const mod = await import("@elizaos/plugin-sql");
    const sqlPlugin = mod.plugin ?? mod.default;
    if (sqlPlugin) {
      console.log(`[${tag}] ✅ SQL plugin loaded`);
      return sqlPlugin;
    }
    console.warn(`[${tag}] ⚠️ SQL plugin module loaded but no export found`);
    return null;
  } catch (err) {
    console.error(`[${tag}] ❌ Failed to load SQL plugin:`, errMsg(err));
    return null;
  }
}

/**
 * Load trajectory logger plugin when available.
 */
export async function loadTrajectoryLoggerPlugin(
  tag = "Agent",
): Promise<Plugin | null> {
  try {
    const mod = await import("@elizaos/plugin-trajectory-logger");
    const plugin =
      (
        mod as {
          trajectoryLoggerPlugin?: Plugin;
          plugin?: Plugin;
          default?: Plugin;
        }
      ).trajectoryLoggerPlugin ??
      (mod as { plugin?: Plugin; default?: Plugin }).plugin ??
      (mod as { default?: Plugin }).default;
    if (plugin) {
      console.log(`[${tag}] ✅ Trajectory logger plugin loaded`);
      return plugin;
    }
    console.warn(
      `[${tag}] ⚠️ Trajectory logger module loaded but no plugin export found`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[${tag}] Trajectory logger plugin unavailable: ${errMsg(err)}`,
    );
    return null;
  }
}

/**
 * Load local embedding plugin when available.
 */
export async function loadLocalEmbeddingPlugin(
  tag = "Agent",
): Promise<Plugin | null> {
  try {
    const mod = await import("@elizaos/plugin-local-embedding");
    const plugin =
      (mod as { localAiPlugin?: Plugin; plugin?: Plugin; default?: Plugin })
        .localAiPlugin ??
      (mod as { plugin?: Plugin; default?: Plugin }).plugin ??
      (mod as { default?: Plugin }).default;
    if (plugin) {
      console.log(`[${tag}] ✅ Local embedding plugin loaded`);
      return plugin;
    }
    console.warn(
      `[${tag}] ⚠️ Local embedding module loaded but no plugin export found`,
    );
    return null;
  } catch (err) {
    console.warn(`[${tag}] Local embedding plugin unavailable: ${errMsg(err)}`);
    return null;
  }
}

// ============================================================================
// CHARACTER CREATION
// ============================================================================

/**
 * Build the model-routing secrets for a character so TEXT_SMALL and TEXT_LARGE
 * resolve to the correct models.
 */
export function buildModelSecrets(
  config: ModelProviderConfig,
  smallModel?: string,
): Record<string, string> {
  const small =
    smallModel || DEFAULT_SMALL_MODELS[config.provider] || "gpt-5-nano";
  const keys = MODEL_SETTING_KEYS[config.provider];

  return {
    // Pass the provider's API key
    [config.apiKeyEnv]: process.env[config.apiKeyEnv] || "",
    // Generic model overrides
    SMALL_MODEL: small,
    LARGE_MODEL: config.model,
    // Provider-specific overrides
    ...(keys
      ? {
          [keys.small]: small,
          [keys.large]: config.model,
        }
      : {}),
  };
}

/**
 * Create a unique PGLite data directory for an agent so multiple
 * runtimes don't conflict on disk.
 */
export function ensurePgliteDataDir(agentId: string): string {
  const dir = path.resolve(process.cwd(), "data", "agents", agentId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

/**
 * Create a Character configuration for a model agent.
 *
 * @param config       Model provider configuration
 * @param overrides    Optional field overrides (name, system prompt, secrets, etc.)
 */
export function createAgentCharacter(
  config: ModelProviderConfig,
  overrides: {
    /** Override agent id prefix (default: "agent") */
    idPrefix?: string;
    /** Override display name */
    name?: string;
    /** Override system prompt */
    system?: string;
    /** Extra secrets to merge */
    secrets?: Record<string, string>;
    /** Small model for TEXT_SMALL */
    smallModel?: string;
  } = {},
): { character: Character; agentId: string; characterId: string } {
  const prefix = overrides.idPrefix || "agent";
  const agentId = `${prefix}-${config.provider}-${config.model
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()}`;
  const characterId = agentId;

  const pgliteDataDir = ensurePgliteDataDir(agentId);
  const modelSecrets = buildModelSecrets(config, overrides.smallModel);
  const postgresUrl = (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  const storageSecrets =
    postgresUrl.length > 0
      ? {
          POSTGRES_URL: postgresUrl,
          DATABASE_URL: postgresUrl,
        }
      : {
          PGLITE_DATA_DIR: pgliteDataDir,
        };

  const character: Character = {
    id: stringToUuid(agentId),
    name: overrides.name || config.displayName,
    username: agentId,
    system: overrides.system || COMPETITIVE_SYSTEM_PROMPT,
    bio: [
      `AI competitor powered by ${config.displayName}`,
      "Focused on combat mastery and strategic gameplay",
    ],
    topics: ["combat strategy", "PvP tactics", "duel techniques"],
    adjectives: ["competitive", "ruthless", "strategic", "adaptive"],
    // @ts-ignore - modelProvider not in core Character type yet
    modelProvider: config.provider,
    settings: {
      model: config.model,
      secrets: {
        ...storageSecrets,
        // Disable memory accumulation: agents use live world state, not persistent memories
        MEMORY_LONG_TERM_ENABLED: "false",
        MEMORY_LONG_TERM_VECTOR_SEARCH_ENABLED: "false",
        MEMORY_SUMMARIZATION_THRESHOLD: "9999",
        // Disable action embedding index to avoid OpenAI embedding calls on startup
        ACTION_FILTER_ENABLED: "false",
        ...modelSecrets,
        ...(overrides.secrets || {}),
      },
    },
    style: {
      all: ["Brief tactical analysis", "Focus on combat"],
      chat: ["Challenge strong players", "Accept all duels"],
    },
    plugins: [],
  } as unknown as Character;

  return { character, agentId, characterId };
}
