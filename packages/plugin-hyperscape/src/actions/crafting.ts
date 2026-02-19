/**
 * Crafting actions for ElizaOS agents
 *
 * SMELT_ORE - Smelt ore into bars at a furnace
 * SMITH_ITEM - Smith bars into weapons/armor at an anvil
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";
import type { Entity } from "../types.js";
import { hasOre, hasBars } from "../utils/item-detection.js";

function getDistance2D(
  posA: [number, number, number] | null | undefined,
  posB: [number, number, number] | null | undefined,
): number | null {
  if (!posA || !posB) return null;
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function isFurnace(entity: Entity): boolean {
  const type = (entity.type || "").toLowerCase();
  const entityType = (entity.entityType || "").toLowerCase();
  const name = (entity.name || "").toLowerCase();
  return (
    type === "furnace" || entityType === "furnace" || name.includes("furnace")
  );
}

function isAnvil(entity: Entity): boolean {
  const type = (entity.type || "").toLowerCase();
  const entityType = (entity.entityType || "").toLowerCase();
  const name = (entity.name || "").toLowerCase();
  return type === "anvil" || entityType === "anvil" || name.includes("anvil");
}

function findNearestEntity(
  entities: Entity[],
  playerPos: [number, number, number],
  filter: (e: Entity) => boolean,
): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const entity of entities) {
    if (!filter(entity)) continue;
    const dist = getDistance2D(playerPos, entity.position);
    if (dist !== null && dist < nearestDist) {
      nearest = entity;
      nearestDist = dist;
    }
  }

  return nearest;
}

function getSmeltableBar(
  items: Array<{ name?: string; itemId?: string }>,
): string | null {
  const itemNames = items.map((i) => (i.name || i.itemId || "").toLowerCase());
  const hasCopper = itemNames.some((n) => n.includes("copper"));
  const hasTin = itemNames.some((n) => n.includes("tin"));
  const hasIronOre = itemNames.some(
    (n) => n.includes("iron") && n.includes("ore"),
  );

  if (hasCopper && hasTin) return "bronze_bar";
  if (hasIronOre) return "iron_bar";
  return null;
}

function detectBarType(
  items: Array<{ name?: string; itemId?: string }>,
): string | null {
  for (const item of items) {
    const name = (item.name || item.itemId || "").toLowerCase();
    if (name.includes("bronze") && name.includes("bar")) return "bronze_bar";
    if (name.includes("iron") && name.includes("bar")) return "iron_bar";
    if (name.includes("steel") && name.includes("bar")) return "steel_bar";
    if (name.includes("mithril") && name.includes("bar")) return "mithril_bar";
  }
  return null;
}

export const smeltOreAction: Action = {
  name: "SMELT_ORE",
  similes: ["SMELT", "USE_FURNACE", "MAKE_BARS"],
  description:
    "Smelt ore into metal bars at a furnace. Requires ore in inventory and a nearby furnace.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;
    if (!hasOre(player)) return false;

    const nearbyEntities = service.getNearbyEntities();
    const furnace = findNearestEntity(
      nearbyEntities,
      player.position,
      isFurnace,
    );
    return furnace !== null;
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
      if (!service) return { success: false, error: "Service not available" };

      const player = service.getPlayerEntity();
      if (!player?.position)
        return { success: false, error: "No player position" };

      const nearbyEntities = service.getNearbyEntities();
      const furnace = findNearestEntity(
        nearbyEntities,
        player.position,
        isFurnace,
      );
      if (!furnace) {
        await callback?.({ text: "No furnace nearby.", action: "SMELT_ORE" });
        return { success: false, error: "No furnace nearby" };
      }

      const distance = getDistance2D(player.position, furnace.position);
      if (distance !== null && distance > 5) {
        await service.executeMove({ target: furnace.position, runMode: false });
        await new Promise((r) => setTimeout(r, 2000));
      }

      const barType = getSmeltableBar(player.items);
      if (!barType) {
        await callback?.({
          text: "I don't have the right combination of ores to smelt anything.",
          action: "SMELT_ORE",
        });
        return { success: false, error: "No valid ore combination" };
      }

      service.interactWithEntity(furnace.id, "smelt");

      const responseText = `Smelting ${barType.replace("_", " ")} at the furnace`;
      await callback?.({ text: responseText, action: "SMELT_ORE" });

      return {
        success: true,
        text: responseText,
        data: { action: "SMELT_ORE", barType, furnaceId: furnace.id },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SMELT_ORE] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Smelt my ore into bars" } },
      {
        name: "agent",
        content: {
          text: "Smelting bronze bar at the furnace",
          action: "SMELT_ORE",
        },
      },
    ],
  ],
};

export const smithItemAction: Action = {
  name: "SMITH_ITEM",
  similes: ["SMITH", "USE_ANVIL", "FORGE_ITEM", "MAKE_WEAPON"],
  description:
    "Smith metal bars into weapons, armor, or tools at an anvil. Requires bars in inventory and a nearby anvil.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;
    if (!hasBars(player)) return false;

    const nearbyEntities = service.getNearbyEntities();
    const anvil = findNearestEntity(nearbyEntities, player.position, isAnvil);
    return anvil !== null;
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
      if (!service) return { success: false, error: "Service not available" };

      const player = service.getPlayerEntity();
      if (!player?.position)
        return { success: false, error: "No player position" };

      const nearbyEntities = service.getNearbyEntities();
      const anvil = findNearestEntity(nearbyEntities, player.position, isAnvil);
      if (!anvil) {
        await callback?.({ text: "No anvil nearby.", action: "SMITH_ITEM" });
        return { success: false, error: "No anvil nearby" };
      }

      const distance = getDistance2D(player.position, anvil.position);
      if (distance !== null && distance > 5) {
        await service.executeMove({ target: anvil.position, runMode: false });
        await new Promise((r) => setTimeout(r, 2000));
      }

      const barType = detectBarType(player.items);
      if (!barType) {
        await callback?.({
          text: "I don't have any metal bars to smith with.",
          action: "SMITH_ITEM",
        });
        return { success: false, error: "No bars in inventory" };
      }

      service.interactWithEntity(anvil.id, "smith");

      const metalName = barType.replace("_bar", "");
      const responseText = `Smithing ${metalName} equipment at the anvil`;
      await callback?.({ text: responseText, action: "SMITH_ITEM" });

      return {
        success: true,
        text: responseText,
        data: { action: "SMITH_ITEM", barType, anvilId: anvil.id },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SMITH_ITEM] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Smith a bronze sword" } },
      {
        name: "agent",
        content: {
          text: "Smithing bronze equipment at the anvil",
          action: "SMITH_ITEM",
        },
      },
    ],
  ],
};

export const craftingActions = [smeltOreAction, smithItemAction];
