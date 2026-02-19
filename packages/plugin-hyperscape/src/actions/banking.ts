/**
 * Banking actions - BANK_DEPOSIT, BANK_WITHDRAW
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
import type { BankCommand, InventoryItem } from "../types.js";

function parseQuantity(text: string): number | null {
  const match = text.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  if (text.includes("all")) return -1;
  return null;
}

function findItemInInventory(
  items: InventoryItem[],
  searchText: string,
): InventoryItem | null {
  const term = searchText.toLowerCase().trim();
  if (!term) return null;

  const exact = items.find(
    (i) => (i.name || i.itemId || "").toLowerCase() === term,
  );
  if (exact) return exact;

  return (
    items.find((i) =>
      (i.name || i.itemId || "").toLowerCase().includes(term),
    ) ?? null
  );
}

function extractItemName(content: string, actionWord: string): string {
  return content
    .toLowerCase()
    .replace(new RegExp(`${actionWord}\\s*(all\\s*)?`, "i"), "")
    .replace(/\d+\s*/g, "")
    .replace(/\s*(my|the|some|a|an)\s*/g, " ")
    .trim();
}

export const bankDepositAction: Action = {
  name: "BANK_DEPOSIT",
  similes: ["DEPOSIT", "BANK_ITEMS", "STORE"],
  description:
    "Deposit items or coins into the bank. Specify which item to deposit.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    if (!player) return false;

    return player.items.length > 0 || player.coins > 0;
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
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }

      const player = service.getPlayerEntity();
      if (!player) {
        return {
          success: false,
          error: new Error("No player entity"),
        };
      }

      const content = message.content.text || "";
      const quantity = parseQuantity(content);
      const itemName = extractItemName(content, "deposit");
      const item = findItemInInventory(player.items, itemName);

      if (!item && itemName.length > 0) {
        await callback?.({
          text: `Could not find "${itemName}" in inventory.`,
          action: "BANK_DEPOSIT",
        });
        return {
          success: false,
          error: new Error(`Item "${itemName}" not found in inventory`),
        };
      }

      const depositAmount =
        quantity === -1
          ? (item?.quantity ?? 1)
          : (quantity ?? item?.quantity ?? 1);

      const command: BankCommand = {
        action: "deposit",
        itemId: item?.id,
        amount: depositAmount,
      };

      await service.executeBankAction(command);

      const itemLabel = item ? item.name : "items";
      const amountLabel = depositAmount > 1 ? `${depositAmount}x ` : "";
      const responseText = `Deposited ${amountLabel}${itemLabel} into the bank`;
      await callback?.({ text: responseText, action: "BANK_DEPOSIT" });

      return {
        success: true,
        text: responseText,
        data: {
          action: "BANK_DEPOSIT",
          itemId: item?.id ?? null,
          itemName: itemLabel,
          amount: depositAmount,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BANK_DEPOSIT] Failed: ${errorMsg}`);
      await callback?.({
        text: `Failed to deposit: ${errorMsg}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Deposit all logs" } },
      {
        name: "agent",
        content: {
          text: "Deposited Logs into the bank",
          action: "BANK_DEPOSIT",
        },
      },
    ],
    [
      { name: "user", content: { text: "Deposit 5 iron ore" } },
      {
        name: "agent",
        content: {
          text: "Deposited 5x Iron Ore into the bank",
          action: "BANK_DEPOSIT",
        },
      },
    ],
  ],
};

export const bankWithdrawAction: Action = {
  name: "BANK_WITHDRAW",
  similes: ["WITHDRAW", "TAKE_FROM_BANK"],
  description:
    "Withdraw items or coins from the bank. Specify which item to withdraw.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service?.isConnected()) return false;

    const player = service.getPlayerEntity();
    return !!player;
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
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }

      const content = message.content.text || "";
      const quantity = parseQuantity(content);
      const itemName = extractItemName(content, "withdraw");

      if (!itemName) {
        await callback?.({
          text: "Please specify which item to withdraw.",
          action: "BANK_WITHDRAW",
        });
        return {
          success: false,
          error: new Error("No item specified for withdrawal"),
        };
      }

      const withdrawAmount = quantity === -1 ? undefined : (quantity ?? 1);

      const command: BankCommand = {
        action: "withdraw",
        itemId: itemName,
        amount: withdrawAmount,
      };

      await service.executeBankAction(command);

      const amountLabel =
        withdrawAmount && withdrawAmount > 1 ? `${withdrawAmount}x ` : "";
      const responseText = `Withdrawing ${amountLabel}${itemName} from the bank`;
      await callback?.({ text: responseText, action: "BANK_WITHDRAW" });

      return {
        success: true,
        text: responseText,
        data: {
          action: "BANK_WITHDRAW",
          itemName,
          amount: withdrawAmount ?? "all",
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BANK_WITHDRAW] Failed: ${errorMsg}`);
      await callback?.({
        text: `Failed to withdraw: ${errorMsg}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Withdraw axe" } },
      {
        name: "agent",
        content: {
          text: "Withdrawing axe from the bank",
          action: "BANK_WITHDRAW",
        },
      },
    ],
    [
      { name: "user", content: { text: "Withdraw 10 lobsters" } },
      {
        name: "agent",
        content: {
          text: "Withdrawing 10x lobsters from the bank",
          action: "BANK_WITHDRAW",
        },
      },
    ],
  ],
};

export const bankingActions = [bankDepositAction, bankWithdrawAction];
