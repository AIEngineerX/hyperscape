/**
 * useBettingPanel - Hook for managing betting panel state
 *
 * Handles:
 * - Listening to betting market events from the server
 * - Tracking user positions
 * - Managing bet placement
 */

import { useState, useCallback, useEffect } from "react";
import type {
  BettingMarket,
  UserPosition,
  BettingPanelState,
} from "./BettingPanel";

// ============================================================================
// Types
// ============================================================================

interface UseBettingPanelOptions {
  /** World instance for network events */
  world: {
    on: (event: string, callback: (data: unknown) => void) => void;
    off: (event: string, callback: (data: unknown) => void) => void;
    network?: {
      send: (packet: string, data: unknown) => void;
    };
  } | null;
  /** User's GOLD balance */
  userBalance: number;
}

interface UseBettingPanelReturn {
  state: BettingPanelState;
  openPanel: () => void;
  closePanel: () => void;
  placeBet: (marketId: string, side: "A" | "B", amount: number) => void;
  claimWinnings: (marketId: string) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useBettingPanel({
  world,
  userBalance,
}: UseBettingPanelOptions): UseBettingPanelReturn {
  const [visible, setVisible] = useState(false);
  const [markets, setMarkets] = useState<BettingMarket[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);

  // Listen for betting events
  useEffect(() => {
    if (!world) return;

    const handleMarketCreated = (data: unknown) => {
      const event = data as {
        duelId: string;
        market: BettingMarket;
      };

      setMarkets((prev) => {
        // Check if market already exists
        const exists = prev.some((m) => m.duelId === event.duelId);
        if (exists) return prev;

        return [
          ...prev,
          {
            ...event.market,
            poolA: 0,
            poolB: 0,
            status: "betting",
          },
        ];
      });
    };

    const handleMarketLocked = (data: unknown) => {
      const event = data as {
        duelId: string;
      };

      setMarkets((prev) =>
        prev.map((m) =>
          m.duelId === event.duelId ? { ...m, status: "locked" } : m,
        ),
      );
    };

    const handleMarketResolved = (data: unknown) => {
      const event = data as {
        duelId: string;
        winnerId: string;
        winnerSide: "A" | "B";
      };

      setMarkets((prev) =>
        prev.map((m) =>
          m.duelId === event.duelId
            ? {
                ...m,
                status: "resolved",
                winnerId: event.winnerId,
                winnerSide: event.winnerSide,
              }
            : m,
        ),
      );
    };

    const handlePoolUpdated = (data: unknown) => {
      const event = data as {
        duelId: string;
        poolA: number;
        poolB: number;
      };

      setMarkets((prev) =>
        prev.map((m) =>
          m.duelId === event.duelId
            ? { ...m, poolA: event.poolA, poolB: event.poolB }
            : m,
        ),
      );
    };

    const handlePositionUpdated = (data: unknown) => {
      const event = data as {
        marketId: string;
        side: "A" | "B";
        amount: number;
        potentialPayout: number;
      };

      setPositions((prev) => {
        const exists = prev.some((p) => p.marketId === event.marketId);
        if (exists) {
          return prev.map((p) =>
            p.marketId === event.marketId
              ? {
                  ...p,
                  amount: event.amount,
                  potentialPayout: event.potentialPayout,
                }
              : p,
          );
        }
        return [...prev, event];
      });
    };

    // Subscribe to events
    world.on("betting:market:created", handleMarketCreated);
    world.on("betting:market:locked", handleMarketLocked);
    world.on("betting:market:resolved", handleMarketResolved);
    world.on("betting:pool:updated", handlePoolUpdated);
    world.on("betting:position:updated", handlePositionUpdated);

    // Cleanup
    return () => {
      world.off("betting:market:created", handleMarketCreated);
      world.off("betting:market:locked", handleMarketLocked);
      world.off("betting:market:resolved", handleMarketResolved);
      world.off("betting:pool:updated", handlePoolUpdated);
      world.off("betting:position:updated", handlePositionUpdated);
    };
  }, [world]);

  // Clean up old resolved markets periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const CLEANUP_DELAY = 60000; // Remove resolved markets after 1 minute

      setMarkets((prev) =>
        prev.filter((m) => {
          if (m.status !== "resolved") return true;
          // Keep resolved markets for a while so users can see results
          const age = now - m.bettingClosesAt;
          return age < CLEANUP_DELAY;
        }),
      );
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const openPanel = useCallback(() => {
    setVisible(true);
  }, []);

  const closePanel = useCallback(() => {
    setVisible(false);
  }, []);

  const placeBet = useCallback(
    (marketId: string, side: "A" | "B", amount: number) => {
      if (!world?.network) {
        console.warn("[useBettingPanel] Cannot place bet: no network");
        return;
      }

      // Send bet to server
      world.network.send("betting:placeBet", {
        marketId,
        side,
        amount,
      });

      // Optimistically update position
      setPositions((prev) => {
        const existing = prev.find((p) => p.marketId === marketId);
        const market = markets.find((m) => m.duelId === marketId);

        if (!market) return prev;

        // Calculate new potential payout
        const currentPool = side === "A" ? market.poolA : market.poolB;
        const otherPool = side === "A" ? market.poolB : market.poolA;
        const totalPool = currentPool + otherPool + amount;
        const newPoolShare = currentPool + amount;
        const potentialPayout = (totalPool * amount) / newPoolShare;

        if (existing) {
          return prev.map((p) =>
            p.marketId === marketId
              ? {
                  ...p,
                  amount: p.amount + amount,
                  potentialPayout: potentialPayout + (p.potentialPayout || 0),
                }
              : p,
          );
        }

        return [
          ...prev,
          {
            marketId,
            side,
            amount,
            potentialPayout,
          },
        ];
      });

      // Optimistically update pool
      setMarkets((prev) =>
        prev.map((m) =>
          m.duelId === marketId
            ? {
                ...m,
                poolA: side === "A" ? m.poolA + amount : m.poolA,
                poolB: side === "B" ? m.poolB + amount : m.poolB,
              }
            : m,
        ),
      );
    },
    [world, markets],
  );

  const claimWinnings = useCallback(
    (marketId: string) => {
      if (!world?.network) {
        console.warn("[useBettingPanel] Cannot claim: no network");
        return;
      }

      // Send claim to server
      world.network.send("betting:claim", {
        marketId,
      });

      // Remove position after claiming
      setPositions((prev) => prev.filter((p) => p.marketId !== marketId));
    },
    [world],
  );

  const state: BettingPanelState = {
    visible,
    markets,
    positions,
    userBalance,
    selectedMarketId: null,
    selectedSide: null,
    betAmount: 0,
  };

  return {
    state,
    openPanel,
    closePanel,
    placeBet,
    claimWinnings,
  };
}

export default useBettingPanel;
