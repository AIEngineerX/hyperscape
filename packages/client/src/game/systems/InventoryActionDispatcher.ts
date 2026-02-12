/**
 * Centralized inventory action dispatching.
 * Eliminates duplication between context menu and left-click handlers.
 *
 * This dispatcher is the single source of truth for handling inventory actions.
 * Both context menu selections and left-click primary actions route through here.
 *
 * Supports optimistic updates for eat/drink/drop actions: the UI item is removed
 * immediately and the network request is sent in parallel. The server's authoritative
 * inventoryUpdated response replaces the local cache regardless, so explicit rollback
 * is rarely needed — only on timeout (5 s without server response).
 */

import {
  EventType,
  uuid,
  getItem,
  PendingActionTracker,
  type Item,
} from "@hyperscape/shared";
import type { ClientWorld } from "../../types";

export interface InventoryActionContext {
  world: ClientWorld;
  itemId: string;
  slot: number;
  quantity?: number;
}

export interface ActionResult {
  success: boolean;
  message?: string;
}

/** Actions that are intentionally no-ops (don't warn) */
const SILENT_ACTIONS = new Set(["cancel"]);

/** Snapshot of the inventory cache at the moment before an optimistic update */
interface InventorySnapshot {
  playerId: string;
  items: Array<{ slot: number; itemId: string; quantity: number }>;
  coins: number;
  maxSlots: number;
}

/** Tracks optimistic inventory actions awaiting server confirmation (5s timeout) */
const inventoryTracker = new PendingActionTracker<InventorySnapshot>(5000);

/** Interval ID for the stale-action pruner (allows cleanup on HMR) */
let prunerInterval: ReturnType<typeof setInterval> | null = null;

/** World reference for rollback emission (set on first dispatch) */
let trackedWorld: ClientWorld | null = null;

/** Start periodic stale-action pruning (once per second) */
function ensurePruner(): void {
  if (prunerInterval) return;
  prunerInterval = setInterval(() => {
    const rollbacks = inventoryTracker.pruneStale();
    for (const snapshot of rollbacks) {
      if (!trackedWorld) continue;
      // Restore the pre-action cache so the UI corrects itself
      const network = trackedWorld.network as {
        lastInventoryByPlayerId?: Record<string, InventorySnapshot>;
      };
      if (network?.lastInventoryByPlayerId) {
        network.lastInventoryByPlayerId[snapshot.playerId] = snapshot;
      }
      trackedWorld.emit(EventType.INVENTORY_UPDATED, { ...snapshot });
      console.warn(
        "[InventoryActionDispatcher] Optimistic action timed out, rolling back inventory",
      );
    }
  }, 1000);
}

/** Listeners registered per world to clear tracker on server inventory updates */
const worldListeners = new WeakSet<ClientWorld>();

function ensureServerListener(world: ClientWorld): void {
  if (worldListeners.has(world)) return;
  worldListeners.add(world);
  world.on(EventType.INVENTORY_UPDATED, () => {
    // Server sent authoritative inventory state — discard all pending rollbacks.
    // We clear all pending actions (not per-txId) because the server's inventory
    // packet is a full snapshot that replaces the client cache entirely, making
    // individual transaction tracking unnecessary.
    inventoryTracker.clear();
  });
  // Clean up module-level state when the world disconnects so stale references
  // don't leak across reconnections or HMR reloads.
  world.on(EventType.NETWORK_DISCONNECTED, () => {
    if (prunerInterval) {
      clearInterval(prunerInterval);
      prunerInterval = null;
    }
    inventoryTracker.clear();
    trackedWorld = null;
  });
}

/**
 * Deep-clone the current inventory cache for a player so we can roll back.
 * Returns null if no cache exists yet.
 */
function snapshotInventory(
  world: ClientWorld,
  playerId: string,
): InventorySnapshot | null {
  const network = world.network as {
    lastInventoryByPlayerId?: Record<string, InventorySnapshot>;
  };
  const cached = network.lastInventoryByPlayerId?.[playerId];
  if (!cached) return null;
  return {
    playerId: cached.playerId,
    items: cached.items.map((i) => ({ ...i })),
    coins: cached.coins,
    maxSlots: cached.maxSlots,
  };
}

/**
 * Optimistically remove an item from the client-side inventory cache and
 * emit an immediate UI update so the player sees instant feedback.
 *
 * The server's authoritative `inventoryUpdated` packet will replace this
 * cache within ~100-200 ms. If it never arrives, the PendingActionTracker
 * rolls back after 5 seconds.
 */
function applyOptimisticRemoval(
  world: ClientWorld,
  playerId: string,
  slot: number,
  quantity: number,
): void {
  const network = world.network as {
    lastInventoryByPlayerId?: Record<
      string,
      {
        playerId: string;
        items: Array<{ slot: number; itemId: string; quantity: number }>;
        coins: number;
        maxSlots: number;
      }
    >;
  };
  const cached = network.lastInventoryByPlayerId?.[playerId];
  if (!cached) return;

  // Find the item in the cached inventory
  const itemIndex = cached.items.findIndex((i) => i.slot === slot);
  if (itemIndex === -1) return;

  const item = cached.items[itemIndex];
  if (item.quantity <= quantity) {
    // Remove entirely
    cached.items.splice(itemIndex, 1);
  } else {
    // Decrease quantity
    item.quantity -= quantity;
  }

  // Emit the updated inventory so UI re-renders immediately
  world.emit(EventType.INVENTORY_UPDATED, { ...cached });
}

/**
 * Dispatch an inventory action to the appropriate handler.
 * Single source of truth for action handling.
 *
 * @param action - The action ID (e.g., "eat", "wield", "drop")
 * @param ctx - Context containing world, itemId, slot, and optional quantity
 * @returns ActionResult indicating success/failure
 */
export function dispatchInventoryAction(
  action: string,
  ctx: InventoryActionContext,
): ActionResult {
  const { world, itemId, slot, quantity = 1 } = ctx;
  const localPlayer = world.getPlayer();

  if (!localPlayer) {
    return { success: false, message: "No local player" };
  }

  // Wire up tracker infrastructure on first call
  trackedWorld = world;
  ensurePruner();
  ensureServerListener(world);

  switch (action) {
    case "eat":
    case "drink":
    case "bury": {
      // Snapshot before optimistic removal for rollback on timeout
      const snapshot = snapshotInventory(world, localPlayer.id);
      if (snapshot) inventoryTracker.add(snapshot);
      // Optimistic: remove the item from UI immediately
      applyOptimisticRemoval(world, localPlayer.id, slot, 1);
      // Send to server — server handles validation, consumption, and effects
      // Server flow: useItem → INVENTORY_USE → InventorySystem → ITEM_USED → PlayerSystem
      world.network?.send("useItem", { itemId, slot });
      return { success: true };
    }

    case "wield":
    case "wear":
      world.network?.send("equipItem", {
        playerId: localPlayer.id,
        itemId,
        inventorySlot: slot,
      });
      return { success: true };

    case "drop": {
      // Snapshot before optimistic removal for rollback on timeout
      const dropSnapshot = snapshotInventory(world, localPlayer.id);
      if (dropSnapshot) inventoryTracker.add(dropSnapshot);
      // Optimistic: remove the item from UI immediately
      applyOptimisticRemoval(world, localPlayer.id, slot, quantity);
      if (world.network?.dropItem) {
        world.network.dropItem(itemId, slot, quantity);
      } else {
        world.network?.send("dropItem", { itemId, slot, quantity });
      }
      return { success: true };
    }

    case "examine": {
      const itemData = getItem(itemId);
      const examineText = itemData?.examine || `It's a ${itemId}.`;

      world.emit(EventType.UI_TOAST, {
        message: examineText,
        type: "info",
      });

      if (world.chat?.add) {
        world.chat.add({
          id: uuid(),
          from: "",
          body: examineText,
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
        });
      }
      return { success: true };
    }

    case "use":
      world.emit(EventType.ITEM_ACTION_SELECTED, {
        playerId: localPlayer.id,
        actionId: "use",
        itemId,
        slot,
      });
      return { success: true };

    case "rub": {
      // Handle XP lamp usage - check if item has useEffect with type "xp_lamp"
      const lampData = getItem(itemId) as Item & {
        useEffect?: { type: string; xpAmount: number };
      };
      if (lampData?.useEffect?.type === "xp_lamp") {
        // Emit event to open skill selection modal
        world.emit(EventType.XP_LAMP_USE_REQUEST, {
          playerId: localPlayer.id,
          itemId,
          slot,
          xpAmount: lampData.useEffect.xpAmount,
        });
        return { success: true };
      }
      // Fall through to default if not an XP lamp
      console.warn(
        `[InventoryActionDispatcher] Rub action on non-lamp item: ${itemId}`,
      );
      return { success: false, message: "Cannot rub this item" };
    }

    case "cancel":
      // Intentional no-op - menu already closed by EntityContextMenu
      return { success: true };

    default:
      // Only warn for truly unhandled actions, not intentional no-ops
      if (!SILENT_ACTIONS.has(action)) {
        console.warn(
          `[InventoryActionDispatcher] Unhandled action: "${action}" for item "${itemId}". ` +
            `Check inventoryActions in item manifest.`,
        );
      }
      return { success: false, message: `Unhandled action: ${action}` };
  }
}
