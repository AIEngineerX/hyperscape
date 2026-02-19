/**
 * Quest actions for ElizaOS agents
 *
 * TALK_TO_NPC - Interact with a nearby NPC (quest giver, shopkeeper, banker)
 * ACCEPT_QUEST - Accept a quest from an NPC via dialogue
 * COMPLETE_QUEST - Turn in a completed quest for rewards
 * CHECK_QUEST - Check current quest progress
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService";
import type { Entity } from "../types";

function getDistance2D(
  posA: [number, number, number] | null | undefined,
  posB: [number, number, number] | null | undefined,
): number | null {
  if (!posA || !posB) return null;
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function isNpcEntity(entity: Entity): boolean {
  const entityType = (entity.entityType || "").toLowerCase();
  const type = (entity.type || "").toLowerCase();
  return (
    entityType === "npc" ||
    type === "npc" ||
    entityType === "quest_giver" ||
    entityType === "shopkeeper" ||
    entityType === "banker"
  );
}

function findNpcByName(entities: Entity[], text: string): Entity | null {
  const lowerText = text.toLowerCase();
  const npcs = entities.filter(isNpcEntity);

  const exactMatch = npcs.find((n) => n.name?.toLowerCase() === lowerText);
  if (exactMatch) return exactMatch;

  const partialMatch = npcs.find(
    (n) =>
      n.name?.toLowerCase().includes(lowerText) ||
      lowerText.includes(n.name?.toLowerCase() || ""),
  );
  if (partialMatch) return partialMatch;

  return npcs.length > 0 ? npcs[0] : null;
}

export const talkToNpcAction: Action = {
  name: "TALK_TO_NPC",
  similes: ["INTERACT_NPC", "SPEAK_TO_NPC", "TALK_NPC"],
  description:
    "Approach and talk to a nearby NPC (quest giver, shopkeeper, banker, trainer). Initiates dialogue.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;

    const nearbyEntities = service.getNearbyEntities();
    const npcs = nearbyEntities.filter(isNpcEntity);

    return npcs.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const player = service.getPlayerEntity();
      if (!player?.position) {
        return { success: false, error: "No player position" };
      }

      const nearbyEntities = service.getNearbyEntities();
      const text = message.content.text || "";

      const npc = findNpcByName(nearbyEntities, text);
      if (!npc) {
        await callback?.({
          text: "No NPC found nearby to talk to.",
          action: "TALK_TO_NPC",
        });
        return { success: false, error: "No NPC nearby" };
      }

      const distance = getDistance2D(player.position, npc.position);
      if (distance !== null && distance > 10) {
        await service.executeMove({
          target: npc.position,
          runMode: false,
        });
        await callback?.({
          text: `Walking towards ${npc.name}...`,
          action: "TALK_TO_NPC",
        });
        await new Promise((r) => setTimeout(r, 2000));
      }

      service.interactWithEntity(npc.id, "talk");

      const responseText = `Talking to ${npc.name}`;
      await callback?.({ text: responseText, action: "TALK_TO_NPC" });

      return {
        success: true,
        text: responseText,
        data: { action: "TALK_TO_NPC", npcName: npc.name, npcId: npc.id },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[TALK_TO_NPC] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Talk to the quest giver" } },
      {
        name: "agent",
        content: { text: "Talking to Captain Rowan", action: "TALK_TO_NPC" },
      },
    ],
  ],
};

export const acceptQuestAction: Action = {
  name: "ACCEPT_QUEST",
  similes: ["START_QUEST", "BEGIN_QUEST", "TAKE_QUEST"],
  description:
    "Accept a quest from a nearby NPC. Initiates dialogue and selects the quest acceptance option.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;

    const nearbyEntities = service.getNearbyEntities();
    const questNpcs = nearbyEntities.filter((e) => {
      const entityType = (e.entityType || "").toLowerCase();
      return (
        isNpcEntity(e) &&
        (entityType === "quest_giver" ||
          entityType === "npc" ||
          (e.name && /captain|guide|master|elder/i.test(e.name)))
      );
    });

    return questNpcs.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const player = service.getPlayerEntity();
      if (!player?.position) {
        return { success: false, error: "No player position" };
      }

      const nearbyEntities = service.getNearbyEntities();
      const text = message.content.text || "";

      const npc = findNpcByName(nearbyEntities, text);
      if (!npc) {
        await callback?.({
          text: "No quest NPC found nearby.",
          action: "ACCEPT_QUEST",
        });
        return { success: false, error: "No quest NPC nearby" };
      }

      const distance = getDistance2D(player.position, npc.position);
      if (distance !== null && distance > 10) {
        await service.executeMove({
          target: npc.position,
          runMode: false,
        });
        await new Promise((r) => setTimeout(r, 2000));
      }

      service.interactWithEntity(npc.id, "talk");

      const responseText = `Accepting quest from ${npc.name}`;
      await callback?.({ text: responseText, action: "ACCEPT_QUEST" });

      return {
        success: true,
        text: responseText,
        data: {
          action: "ACCEPT_QUEST",
          npcName: npc.name,
          npcId: npc.id,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[ACCEPT_QUEST] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Accept a quest" } },
      {
        name: "agent",
        content: {
          text: "Accepting quest from Captain Rowan",
          action: "ACCEPT_QUEST",
        },
      },
    ],
  ],
};

export const completeQuestAction: Action = {
  name: "COMPLETE_QUEST",
  similes: ["TURN_IN_QUEST", "FINISH_QUEST", "HAND_IN_QUEST"],
  description:
    "Turn in a completed quest to the NPC for rewards. Only works when quest objectives are complete.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;

    const nearbyEntities = service.getNearbyEntities();
    return nearbyEntities.some(isNpcEntity);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const player = service.getPlayerEntity();
      if (!player?.position) {
        return { success: false, error: "No player position" };
      }

      const nearbyEntities = service.getNearbyEntities();
      const text = message.content.text || "";

      const npc = findNpcByName(nearbyEntities, text);
      if (!npc) {
        await callback?.({
          text: "No NPC found nearby to turn in quest.",
          action: "COMPLETE_QUEST",
        });
        return { success: false, error: "No NPC nearby" };
      }

      const distance = getDistance2D(player.position, npc.position);
      if (distance !== null && distance > 10) {
        await service.executeMove({
          target: npc.position,
          runMode: false,
        });
        await new Promise((r) => setTimeout(r, 2000));
      }

      service.interactWithEntity(npc.id, "talk");

      const responseText = `Turning in quest to ${npc.name}`;
      await callback?.({ text: responseText, action: "COMPLETE_QUEST" });

      return {
        success: true,
        text: responseText,
        data: { action: "COMPLETE_QUEST", npcName: npc.name },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[COMPLETE_QUEST] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Turn in quest" } },
      {
        name: "agent",
        content: {
          text: "Turning in quest to Captain Rowan",
          action: "COMPLETE_QUEST",
        },
      },
    ],
  ],
};

export const checkQuestAction: Action = {
  name: "CHECK_QUEST",
  similes: ["QUEST_STATUS", "QUEST_PROGRESS", "VIEW_QUESTS"],
  description:
    "Check current quest progress and objectives. Reports what needs to be done.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    return !!service?.isConnected();
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return { success: false, error: "Service not available" };
      }

      const gameState = service.getGameState();
      const questData = (gameState as unknown as Record<string, unknown>)
        .activeQuests as Array<Record<string, unknown>> | undefined;
      if (!questData || questData.length === 0) {
        const responseText =
          "No active quests. I should talk to an NPC to find a quest!";
        await callback?.({ text: responseText, action: "CHECK_QUEST" });
        return { success: true, text: responseText };
      }

      const lines: string[] = ["My current quests:"];

      for (const quest of questData) {
        const name = quest.name || quest.questId || "Unknown Quest";
        const status = quest.status || "in_progress";
        const description = quest.description || "";
        lines.push(
          `- ${name} (${status})${description ? `: ${description}` : ""}`,
        );

        if (quest.stageProgress) {
          for (const [key, value] of Object.entries(quest.stageProgress)) {
            lines.push(`  Progress: ${key} - ${value}`);
          }
        }
      }

      const responseText = lines.join("\n");
      await callback?.({ text: responseText, action: "CHECK_QUEST" });

      return { success: true, text: responseText };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[CHECK_QUEST] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Check my quests" } },
      {
        name: "agent",
        content: {
          text: "My current quests:\n- Goblin Slayer (in_progress): Kill 5 goblins",
          action: "CHECK_QUEST",
        },
      },
    ],
  ],
};

export const questActions = [
  talkToNpcAction,
  acceptQuestAction,
  completeQuestAction,
  checkQuestAction,
];
