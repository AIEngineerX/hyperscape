/**
 * Shopping actions for ElizaOS agents
 *
 * BUY_ITEM - Buy items from NPC shops
 * SELL_ITEM - Sell items to NPC shops
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

function getDistance2D(
  posA: [number, number, number] | null | undefined,
  posB: [number, number, number] | null | undefined,
): number | null {
  if (!posA || !posB) return null;
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function isShopkeeper(entity: Entity): boolean {
  const entityType = (entity.entityType || "").toLowerCase();
  const type = (entity.type || "").toLowerCase();
  const name = (entity.name || "").toLowerCase();
  return (
    entityType === "shopkeeper" ||
    entityType === "store" ||
    entityType === "npc" ||
    type === "npc" ||
    name.includes("shop") ||
    name.includes("store") ||
    name.includes("merchant") ||
    name.includes("trader")
  );
}

function findNearestShopkeeper(
  entities: Entity[],
  playerPos: [number, number, number],
): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const entity of entities) {
    if (!isShopkeeper(entity)) continue;
    const dist = getDistance2D(playerPos, entity.position);
    if (dist !== null && dist < nearestDist) {
      nearest = entity;
      nearestDist = dist;
    }
  }

  return nearest;
}

export const buyItemAction: Action = {
  name: "BUY_ITEM",
  similes: ["PURCHASE", "BUY_FROM_SHOP", "SHOP_BUY"],
  description:
    "Buy an item from a nearby NPC shop. Requires coins and a shopkeeper nearby.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;
    if ((player.coins ?? 0) <= 0) return false;

    const nearbyEntities = service.getNearbyEntities();
    const shop = findNearestShopkeeper(nearbyEntities, player.position);
    return shop !== null;
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
      const shopkeeper = findNearestShopkeeper(nearbyEntities, player.position);
      if (!shopkeeper) {
        await callback?.({ text: "No shop nearby.", action: "BUY_ITEM" });
        return { success: false, error: "No shop nearby" };
      }

      const distance = getDistance2D(player.position, shopkeeper.position);
      if (distance !== null && distance > 8) {
        await service.executeMove({
          target: shopkeeper.position,
          runMode: false,
        });
        await new Promise((r) => setTimeout(r, 2000));
      }

      service.interactWithEntity(shopkeeper.id, "talk");

      const text = message.content.text || "";
      const responseText = `Browsing ${shopkeeper.name}'s shop${text ? ` for ${text}` : ""}`;
      await callback?.({ text: responseText, action: "BUY_ITEM" });

      return {
        success: true,
        text: responseText,
        data: {
          action: "BUY_ITEM",
          shopName: shopkeeper.name,
          shopId: shopkeeper.id,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BUY_ITEM] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Buy a fishing rod" } },
      {
        name: "agent",
        content: {
          text: "Browsing General Store's shop for a fishing rod",
          action: "BUY_ITEM",
        },
      },
    ],
  ],
};

export const sellItemAction: Action = {
  name: "SELL_ITEM",
  similes: ["SELL", "SELL_TO_SHOP", "SHOP_SELL"],
  description:
    "Sell items to a nearby NPC shop for coins. Requires items in inventory and a shopkeeper nearby.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player?.position) return false;
    if ((player.items?.length ?? 0) === 0) return false;

    const nearbyEntities = service.getNearbyEntities();
    const shop = findNearestShopkeeper(nearbyEntities, player.position);
    return shop !== null;
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
      const shopkeeper = findNearestShopkeeper(nearbyEntities, player.position);
      if (!shopkeeper) {
        await callback?.({ text: "No shop nearby.", action: "SELL_ITEM" });
        return { success: false, error: "No shop nearby" };
      }

      const distance = getDistance2D(player.position, shopkeeper.position);
      if (distance !== null && distance > 8) {
        await service.executeMove({
          target: shopkeeper.position,
          runMode: false,
        });
        await new Promise((r) => setTimeout(r, 2000));
      }

      service.interactWithEntity(shopkeeper.id, "talk");

      const text = message.content.text || "";
      const responseText = `Selling items at ${shopkeeper.name}'s shop${text ? ` (${text})` : ""}`;
      await callback?.({ text: responseText, action: "SELL_ITEM" });

      return {
        success: true,
        text: responseText,
        data: {
          action: "SELL_ITEM",
          shopName: shopkeeper.name,
          shopId: shopkeeper.id,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SELL_ITEM] Failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Sell my extra logs" } },
      {
        name: "agent",
        content: {
          text: "Selling items at General Store's shop (extra logs)",
          action: "SELL_ITEM",
        },
      },
    ],
  ],
};

export const shoppingActions = [buyItemAction, sellItemAction];
