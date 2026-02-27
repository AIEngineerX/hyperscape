/**
 * Goal Progression Planner — deterministic next-goal selection
 *
 * Pure function: planNextGoal(context) → GoalPlan | null
 *
 * Handles the 90% obvious decisions without LLM. The planner evaluates
 * progression phases in priority order and returns a goal the agent should
 * pursue next. Returns null when no deterministic choice can be made
 * (falls through to LLM).
 *
 * Re-evaluated every time a goal completes, so prerequisite chains resolve
 * naturally: "accept quest" → tools granted → "gather resources" now valid.
 */

import { logger } from "@elizaos/core";
import type { CurrentGoal } from "./autonomous-behavior-manager.js";
import type { PlayerEntity, QuestData } from "../types.js";
import {
  hasAxe,
  hasPickaxe,
  hasFishingEquipment,
  hasTinderbox,
  hasCombatCapableItem,
  hasWeapon,
  hasOre,
  hasBars,
  hasRawFood,
  countFood,
} from "../utils/item-detection.js";
import { getResourcesAtLevel } from "../utils/world-data.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything the planner needs to decide — built by the caller */
export interface PlannerContext {
  player: PlayerEntity;
  quests: QuestData[];
  recentGoalCounts: Record<string, number>;
  /** Cached bank item names (lowercase) for tool-in-bank detection */
  bankItemNames?: string[];
}

/** What the planner outputs */
export interface GoalPlan {
  goal: CurrentGoal;
  /** Human-readable reason (for logs) */
  reason: string;
}

// ---------------------------------------------------------------------------
// Quest → tool mapping
// ---------------------------------------------------------------------------

interface ToolQuest {
  questId: string;
  npc: string;
  /** Checker returns true when the player already has the tool */
  hasIt: (player: PlayerEntity) => boolean;
}

/**
 * Bank item keywords to detect tools that were banked.
 * Maps quest ID → item name fragments to search for in bank.
 */
const TOOL_BANK_KEYWORDS: Record<string, string[]> = {
  goblin_slayer: ["shortsword", "longsword", "scimitar", "dagger"],
  lumberjacks_first_lesson: ["hatchet"],
  torvins_tools: ["pickaxe"],
  fresh_catch: ["fishing net", "fishing_net", "net"],
};

/**
 * Ordered list of tool-granting quests. Evaluated top-to-bottom;
 * first quest whose tool the player is missing wins.
 */
const TOOL_QUESTS: ToolQuest[] = [
  {
    questId: "goblin_slayer",
    npc: "guard_captain",
    hasIt: (p) => hasWeapon(p) || hasCombatCapableItem(p),
  },
  {
    questId: "lumberjacks_first_lesson",
    npc: "forester_wilma",
    hasIt: (p) => hasAxe(p),
  },
  {
    questId: "torvins_tools",
    npc: "torvin",
    hasIt: (p) => hasPickaxe(p),
  },
  {
    questId: "fresh_catch",
    npc: "fisherman",
    hasIt: (p) => hasFishingEquipment(p),
  },
];

/** Gathering skills the planner round-robins through */
const GATHERING_SKILLS: Array<{
  goalType: CurrentGoal["type"];
  skillName: string;
  location: string;
  hasIt: (player: PlayerEntity) => boolean;
}> = [
  {
    goalType: "woodcutting",
    skillName: "woodcutting",
    location: "forest",
    hasIt: (p) => hasAxe(p),
  },
  {
    goalType: "mining",
    skillName: "mining",
    location: "mine",
    hasIt: (p) => hasPickaxe(p),
  },
  {
    goalType: "fishing",
    skillName: "fishing",
    location: "fishing",
    hasIt: (p) => hasFishingEquipment(p),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSkillLevel(player: PlayerEntity, skill: string): number {
  return player.skills?.[skill]?.level ?? 1;
}

function inventoryCount(player: PlayerEntity): number {
  return Array.isArray(player.items) ? player.items.length : 0;
}

function countCoins(player: PlayerEntity): number {
  // PlayerEntity has a direct `coins` field from the coin pouch
  if (typeof player.coins === "number" && player.coins > 0) return player.coins;
  // Fallback: check inventory items
  if (!Array.isArray(player.items)) return 0;
  for (const item of player.items) {
    const name = (item.name || item.item?.name || item.itemId || "")
      .toString()
      .toLowerCase();
    if (name === "coins" || name === "coin" || name === "gold_coins") {
      return typeof item.quantity === "number" ? item.quantity : 1;
    }
  }
  return 0;
}

function findQuest(
  quests: QuestData[],
  questId: string,
): QuestData | undefined {
  return quests.find(
    (q) =>
      q.questId === questId || (q as Record<string, unknown>).id === questId,
  );
}

function questStatus(quest: QuestData | undefined): string {
  return quest?.status ?? "unknown";
}

// ---------------------------------------------------------------------------
// Core planner
// ---------------------------------------------------------------------------

/**
 * Deterministic goal selection — evaluate phases in priority order.
 *
 * Returns the first applicable GoalPlan, or null when the situation is
 * ambiguous enough that the LLM should decide.
 */
export function planNextGoal(ctx: PlannerContext): GoalPlan | null {
  const { player, quests, recentGoalCounts } = ctx;

  // ------------------------------------------------------------------
  // Phase 1 — Bootstrap: accept tool-granting quests
  // ------------------------------------------------------------------
  for (const tq of TOOL_QUESTS) {
    if (tq.hasIt(player)) continue; // already have this tool

    const quest = findQuest(quests, tq.questId);
    const status = questStatus(quest);

    if (status === "not_started") {
      return {
        goal: {
          type: "questing",
          description: `Accept quest: ${tq.questId} (get starter tool)`,
          target: 1,
          progress: 0,
          startedAt: Date.now(),
          questId: tq.questId,
          questStartNpc: tq.npc,
        },
        reason: `Missing tool → accept ${tq.questId}`,
      };
    }

    // Quest exists but not available (maybe not in quest list yet) — skip
    // to let later phases handle it, or LLM fallback
  }

  // ------------------------------------------------------------------
  // Phase 2 — Turn in ready quests
  // ------------------------------------------------------------------
  const readyQuests = quests.filter((q) => q.status === "ready_to_complete");
  if (readyQuests.length > 0) {
    const q = readyQuests[0];
    const questId =
      q.questId || ((q as Record<string, unknown>).id as string) || "";
    return {
      goal: {
        type: "questing",
        description: `Turn in quest: ${q.name || questId}`,
        target: 1,
        progress: 0,
        startedAt: Date.now(),
        questId,
        questStartNpc: "",
      },
      reason: `Quest ${questId} ready to complete`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 2.5 — Tools in bank → withdraw them
  // If the player doesn't have a tool in inventory but it exists in
  // the bank, go withdraw it regardless of quest status.
  // ------------------------------------------------------------------
  const bankNames = ctx.bankItemNames || [];
  if (bankNames.length > 0) {
    for (const tq of TOOL_QUESTS) {
      if (tq.hasIt(player)) continue; // still have the tool in inventory

      const toolInBank = TOOL_BANK_KEYWORDS[tq.questId]?.some((kw) =>
        bankNames.some((bn) => bn.includes(kw)),
      );

      if (toolInBank) {
        return {
          goal: {
            type: "banking",
            description: `Withdraw ${tq.questId} tool from bank`,
            target: 1,
            progress: 0,
            startedAt: Date.now(),
            location: "bank",
          },
          reason: `Tool for ${tq.questId} is in bank — go withdraw it`,
        };
      }
    }

    // Also check for tinderbox in bank
    if (
      !hasTinderbox(player) &&
      bankNames.some((bn) => bn.includes("tinderbox"))
    ) {
      return {
        goal: {
          type: "banking",
          description: "Withdraw tinderbox from bank",
          target: 1,
          progress: 0,
          startedAt: Date.now(),
          location: "bank",
        },
        reason: "Tinderbox is in bank — go withdraw it",
      };
    }
  }

  // ------------------------------------------------------------------
  // Phase 2.6 — Lost tools recovery (tool quest done but tool missing)
  // ------------------------------------------------------------------
  for (const tq of TOOL_QUESTS) {
    if (tq.hasIt(player)) continue;

    const quest = findQuest(quests, tq.questId);
    const status = questStatus(quest);

    // Tool quest was completed but player no longer has the tool → lost on death
    if (status === "completed") {
      const coins = countCoins(player);
      if (coins >= 10) {
        return {
          goal: {
            type: "questing",
            description: `Buy replacement tool (lost ${tq.questId} reward) from shop`,
            target: 1,
            progress: 0,
            startedAt: Date.now(),
            location: "spawn",
          },
          reason: `Tool lost after completing ${tq.questId} — has ${coins} coins, try shop`,
        };
      }
      logger.info(
        `[GoalPlanner] Lost tool from ${tq.questId} and no coins — exploring to find replacement`,
      );
    }

    // Quest in progress but no tool — keep pursuing it
    if (status === "in_progress") break; // handled by Phase 3
  }

  // ------------------------------------------------------------------
  // Phase 3 — Continue in-progress quests
  // ------------------------------------------------------------------
  const activeQuests = quests.filter((q) => q.status === "in_progress");
  if (activeQuests.length > 0) {
    const q = activeQuests[0];
    const questId =
      q.questId || ((q as Record<string, unknown>).id as string) || "";
    const questData = q as Record<string, unknown>;

    // Enrich with actual stage progress from quest data
    let enrichedProgress = 0;
    let enrichedTarget = 1;
    const stageCount = (questData.stageCount as number) || undefined;
    if (q.stageProgress && typeof q.stageProgress === "object") {
      const progressValues = Object.values(q.stageProgress);
      if (progressValues.length > 0) {
        enrichedProgress = Math.max(...progressValues);
      }
    }
    if (stageCount && stageCount > 0) {
      enrichedTarget = stageCount;
    }

    return {
      goal: {
        type: "questing",
        description: `Complete quest: ${q.name || questId}${enrichedTarget > 1 ? ` (${enrichedProgress}/${enrichedTarget})` : ""}`,
        target: enrichedTarget,
        progress: enrichedProgress,
        startedAt: Date.now(),
        questId,
        questStartNpc: (questData.startNpc as string) || "",
        questStageType:
          (questData.stageType as CurrentGoal["questStageType"]) || undefined,
        questStageTarget: (questData.stageTarget as string) || undefined,
        questStageCount: stageCount,
      },
      reason: `Quest ${questId} in progress (${enrichedProgress}/${enrichedTarget})`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 4 — Inventory full → bank
  // ------------------------------------------------------------------
  if (inventoryCount(player) >= 26) {
    return {
      goal: {
        type: "banking",
        description: "Bank items — inventory nearly full",
        target: 1,
        progress: 0,
        location: "bank",
        startedAt: Date.now(),
      },
      reason: `Inventory ${inventoryCount(player)}/28 → banking`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 5 — Process raw materials (ore/bars/raw food)
  // ------------------------------------------------------------------
  if (inventoryCount(player) > 20) {
    if (hasOre(player)) {
      return {
        goal: {
          type: "smithing",
          description: "Smelt ore into bars",
          target: 1,
          progress: 0,
          startedAt: Date.now(),
          location: "furnace",
          targetSkill: "smithing",
          targetSkillLevel: getSkillLevel(player, "smithing") + 1,
        },
        reason: "Has ore + inventory > 20 → smelt",
      };
    }
    if (hasBars(player)) {
      return {
        goal: {
          type: "smithing",
          description: "Smith bars into items",
          target: 1,
          progress: 0,
          startedAt: Date.now(),
          location: "anvil",
          targetSkill: "smithing",
          targetSkillLevel: getSkillLevel(player, "smithing") + 1,
        },
        reason: "Has bars + inventory > 20 → smith",
      };
    }
    if (hasRawFood(player)) {
      return {
        goal: {
          type: "cooking",
          description: "Cook raw food",
          target: 1,
          progress: 0,
          startedAt: Date.now(),
          targetSkill: "cooking",
          targetSkillLevel: getSkillLevel(player, "cooking") + 1,
        },
        reason: "Has raw food + inventory > 20 → cook",
      };
    }
  }

  // ------------------------------------------------------------------
  // Phase 6 — Gather resources (round-robin by lowest level + least recent)
  // Level-aware: skip skills where no resources exist at the player's level
  // ------------------------------------------------------------------
  const eligible = GATHERING_SKILLS.filter((g) => {
    if (!g.hasIt(player)) return false;
    // Check if any resources exist at the player's level for this skill
    const level = getSkillLevel(player, g.skillName);
    const resources = getResourcesAtLevel(
      g.skillName as "woodcutting" | "mining" | "fishing",
      level,
    );
    return resources.length > 0;
  });
  if (eligible.length > 0 && inventoryCount(player) < 26) {
    // Score each skill: lower level + less recent history = higher priority
    const scored = eligible.map((g) => {
      const level = getSkillLevel(player, g.skillName);
      const recentCount =
        recentGoalCounts[g.skillName] || recentGoalCounts[g.goalType] || 0;
      // Lower is better: level contributes most, recent history breaks ties
      const score = level + recentCount * 5;
      return { ...g, score, level };
    });

    scored.sort((a, b) => a.score - b.score);
    const pick = scored[0];

    return {
      goal: {
        type: pick.goalType,
        description: `Train ${pick.skillName} (level ${pick.level})`,
        target: 1,
        progress: 0,
        startedAt: Date.now(),
        location: pick.location,
        targetSkill: pick.skillName,
        targetSkillLevel: pick.level + 1,
      },
      reason: `Round-robin gathering → ${pick.skillName} (level ${pick.level}, score ${pick.score})`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 7 — Combat prep: not enough food
  // Only set fishing goal if the player actually has fishing equipment.
  // Otherwise fall through to combat/exploration — the tool quest loop
  // (Phase 1 → Phase 3) will resolve the missing tool first.
  // ------------------------------------------------------------------
  if (
    hasCombatCapableItem(player) &&
    countFood(player) < 5 &&
    hasFishingEquipment(player)
  ) {
    return {
      goal: {
        type: "fishing",
        description: "Fish for food before combat",
        target: 1,
        progress: 0,
        startedAt: Date.now(),
        location: "fishing",
        targetSkill: "fishing",
        targetSkillLevel: getSkillLevel(player, "fishing") + 1,
      },
      reason: `Food count ${countFood(player)} < 5 → fish for food`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 8 — Combat training
  // ------------------------------------------------------------------
  if (hasCombatCapableItem(player) && countFood(player) >= 5) {
    return {
      goal: {
        type: "combat_training",
        description: "Train combat on goblins",
        target: 1,
        progress: 0,
        startedAt: Date.now(),
        location: "spawn",
        targetSkill: "attack",
        targetSkillLevel: getSkillLevel(player, "attack") + 1,
        targetEntity: "goblin",
      },
      reason: `Has weapon + ${countFood(player)} food → combat training`,
    };
  }

  // ------------------------------------------------------------------
  // Phase 9 — Fallback: explore
  // ------------------------------------------------------------------
  return {
    goal: {
      type: "exploration",
      description: "Explore the world",
      target: 3,
      progress: 0,
      startedAt: Date.now(),
    },
    reason: "No other phase matched → exploration",
  };
}

/**
 * Convenience: build the PlannerContext from readily available data.
 */
export function buildPlannerContext(
  player: PlayerEntity,
  quests: QuestData[],
  recentGoalCounts: Record<string, number>,
  bankItemNames?: string[],
): PlannerContext {
  return { player, quests, recentGoalCounts, bankItemNames };
}

/**
 * Log the planner's decision at info level.
 */
export function logPlannerDecision(plan: GoalPlan): void {
  logger.info(
    `[GoalPlanner] ${plan.reason} → ${plan.goal.type}: ${plan.goal.description}`,
  );
}
