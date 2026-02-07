/**
 * Duel Event Listeners
 *
 * Registers all world-event listeners related to the duel system.
 * These bridge duel engine events to client-facing WebSocket messages.
 *
 * Extracted from ServerNetwork.initializeManagers() to keep the orchestrator lean.
 */

import { EventType, type EventMap, World } from "@hyperscape/shared";
import type { BroadcastManager } from "./broadcast";
import type { ServerSocket } from "../../shared/types";

/** Thin accessor so we don't depend on the full ServerNetwork class */
export interface DuelEventDeps {
  world: World;
  broadcastManager: BroadcastManager;
  getSocketByPlayerId: (id: string) => ServerSocket | undefined;
  /** Idempotency guard set – callers must share a single instance */
  processedDuelSettlements: Set<string>;
  /** Execute the atomic stake transfer (with retry logic) */
  executeDuelStakeTransferWithRetry: (
    winnerId: string,
    loserId: string,
    stakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>,
    duelId?: string,
  ) => Promise<void>;
}

/**
 * Register all duel-related world event listeners.
 *
 * Call once during ServerNetwork initialisation (after DuelSystem is available).
 */
export function registerDuelEventListeners(deps: DuelEventDeps): void {
  const { world, getSocketByPlayerId, processedDuelSettlements } = deps;

  // -- countdown start --
  world.on("duel:countdown:start", (event) => {
    const { duelId, arenaId, challengerId, targetId } =
      event as EventMap[typeof EventType.DUEL_COUNTDOWN_START];

    const payload = { duelId, arenaId, challengerId, targetId };

    const challengerSocket = getSocketByPlayerId(challengerId);
    if (challengerSocket) {
      challengerSocket.send("duelCountdownStart", payload);
    }

    const targetSocket = getSocketByPlayerId(targetId);
    if (targetSocket) {
      targetSocket.send("duelCountdownStart", payload);
    }
  });

  // -- countdown ticks --
  world.on("duel:countdown:tick", (event) => {
    const { duelId, count, challengerId, targetId } =
      event as EventMap[typeof EventType.DUEL_COUNTDOWN_TICK];

    const payload = { duelId, count, challengerId, targetId };

    const challengerSocket = getSocketByPlayerId(challengerId);
    if (challengerSocket) {
      challengerSocket.send("duelCountdownTick", payload);
    }

    const targetSocket = getSocketByPlayerId(targetId);
    if (targetSocket) {
      targetSocket.send("duelCountdownTick", payload);
    }
  });

  // -- fight start --
  world.on("duel:fight:start", (event) => {
    const { duelId, challengerId, targetId, arenaId, bounds } =
      event as EventMap[typeof EventType.DUEL_FIGHT_START];

    const challengerSocket = getSocketByPlayerId(challengerId);
    if (challengerSocket) {
      challengerSocket.send("duelFightStart", {
        duelId,
        arenaId,
        opponentId: targetId,
        bounds,
      });
    }

    const targetSocket = getSocketByPlayerId(targetId);
    if (targetSocket) {
      targetSocket.send("duelFightStart", {
        duelId,
        arenaId,
        opponentId: challengerId,
        bounds,
      });
    }
  });

  // -- duel completed --
  world.on("duel:completed", (event) => {
    const {
      duelId,
      winnerId,
      loserId,
      loserName,
      winnerName,
      forfeit,
      winnerReceives,
      winnerReceivesValue,
    } = event as EventMap[typeof EventType.DUEL_COMPLETED];

    const loserLostValue =
      winnerId === loserId
        ? 0
        : winnerReceives.reduce((sum, item) => sum + item.value, 0);

    const winnerSocket = getSocketByPlayerId(winnerId);
    if (winnerSocket) {
      winnerSocket.send("duelCompleted", {
        duelId,
        won: true,
        opponentName: loserName,
        itemsReceived: winnerReceives,
        itemsLost: [],
        totalValueWon: winnerReceivesValue,
        totalValueLost: 0,
        forfeit,
      });
    }

    const loserSocket = getSocketByPlayerId(loserId);
    if (loserSocket) {
      loserSocket.send("duelCompleted", {
        duelId,
        won: false,
        opponentName: winnerName,
        itemsReceived: [],
        itemsLost: winnerReceives,
        totalValueWon: 0,
        totalValueLost: loserLostValue,
        forfeit,
      });
    }
  });

  // -- player disconnected during duel --
  world.on("duel:player:disconnected", (event) => {
    const { duelId, playerId, challengerId, targetId, timeoutMs } =
      event as EventMap[typeof EventType.DUEL_PLAYER_DISCONNECTED];

    const opponentId = playerId === challengerId ? targetId : challengerId;
    const opponentSocket = getSocketByPlayerId(opponentId);
    if (opponentSocket) {
      opponentSocket.send("duelOpponentDisconnected", {
        duelId,
        timeoutMs,
      });
    }
  });

  // -- player reconnected during duel --
  world.on("duel:player:reconnected", (event) => {
    const { duelId, playerId, challengerId, targetId } =
      event as EventMap[typeof EventType.DUEL_PLAYER_RECONNECTED];

    const opponentId = playerId === challengerId ? targetId : challengerId;
    const opponentSocket = getSocketByPlayerId(opponentId);
    if (opponentSocket) {
      opponentSocket.send("duelOpponentReconnected", { duelId });
    }
  });

  // -- equipment restrictions --
  world.on("duel:equipment:restrict", (event) => {
    const { challengerId, targetId, disabledSlots } =
      event as EventMap[typeof EventType.DUEL_EQUIPMENT_RESTRICT];

    for (const playerId of [challengerId, targetId]) {
      for (const slot of disabledSlots) {
        world.emit(EventType.EQUIPMENT_UNEQUIP, {
          playerId,
          slot,
        });
      }
    }

    console.log(
      `[Duel] Equipment restrictions applied - disabled slots: ${disabledSlots.join(", ")}`,
    );
  });

  // -- stakes settle --
  world.on("duel:stakes:settle", (event) => {
    const { playerId, ownStakes, wonStakes, fromPlayerId, duelId, reason } =
      event as EventMap[typeof EventType.DUEL_STAKES_SETTLE];

    console.log(
      `[Duel] Stakes settle event received - winnerId: ${playerId}, loserId: ${fromPlayerId}, duelId: ${duelId || "unknown"}, ownStakes: ${ownStakes?.length || 0}, wonStakes: ${wonStakes?.length || 0}, reason: ${reason}`,
    );

    // Idempotency guard: prevent double-settlement if event fires twice
    const settlementKey = duelId
      ? `duel:${duelId}`
      : `${playerId}:${fromPlayerId}`;
    if (processedDuelSettlements.has(settlementKey)) {
      console.warn(
        `[Duel] SECURITY: Duplicate settlement blocked for ${settlementKey}`,
      );
      return;
    }
    processedDuelSettlements.add(settlementKey);
    // Auto-cleanup after 60 seconds to prevent unbounded growth
    setTimeout(() => {
      processedDuelSettlements.delete(settlementKey);
    }, 60_000);

    // Winner's own stakes stay in their inventory - nothing to do
    if (!wonStakes || wonStakes.length === 0) {
      console.log("[Duel] No stakes to transfer from loser, skipping");
      return;
    }

    console.log(
      `[Duel] Transferring ${wonStakes.length} items from ${fromPlayerId} to ${playerId}`,
    );

    // Fire and forget with retry logic
    deps
      .executeDuelStakeTransferWithRetry(
        playerId,
        fromPlayerId,
        wonStakes,
        duelId,
      )
      .catch((err) => {
        console.error("[Duel] All settlement retries exhausted:", err);
      });
  });
}
