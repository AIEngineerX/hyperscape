/**
 * BettingPanel - Spectator betting interface for agent duels
 *
 * Displays active betting markets for scheduled agent-vs-agent duels.
 * Allows users to:
 * - View upcoming duels and their odds
 * - Place bets on either side (Agent A or Agent B)
 * - Track their positions and potential payouts
 * - View results after duels complete
 *
 * Integration:
 * - Listens to betting:market:* events from the server
 * - Uses Solana prediction market for on-chain bets
 */

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { ModalWindow, useThemeStore } from "@/ui";

// ============================================================================
// Types
// ============================================================================

export interface BettingMarket {
  duelId: string;
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  agent1Stats: {
    totalDuels: number;
    wins: number;
    losses: number;
  } | null;
  agent2Stats: {
    totalDuels: number;
    wins: number;
    losses: number;
  } | null;
  poolA: number; // Total bet on Agent A
  poolB: number; // Total bet on Agent B
  status: "betting" | "locked" | "fighting" | "resolved";
  bettingClosesAt: number;
  winnerId?: string;
  winnerSide?: "A" | "B";
}

export interface UserPosition {
  marketId: string;
  side: "A" | "B";
  amount: number;
  potentialPayout: number;
}

export interface BettingPanelState {
  visible: boolean;
  markets: BettingMarket[];
  positions: UserPosition[];
  userBalance: number;
  selectedMarketId: string | null;
  selectedSide: "A" | "B" | null;
  betAmount: number;
}

interface BettingPanelProps {
  state: BettingPanelState;
  onPlaceBet: (marketId: string, side: "A" | "B", amount: number) => void;
  onClaimWinnings: (marketId: string) => void;
  onClose: () => void;
}

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    minWidth: "500px",
    maxHeight: "70vh",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  title: {
    fontSize: "18px",
    fontWeight: "bold",
    color: "#FFD700",
  },
  balance: {
    fontSize: "14px",
    color: "#A0A0A0",
  },
  marketList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    overflowY: "auto",
    maxHeight: "calc(70vh - 150px)",
    paddingRight: "8px",
  },
  market: {
    background: "rgba(0, 0, 0, 0.4)",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: "12px",
    cursor: "pointer",
    transition: "border-color 0.2s",
  },
  marketSelected: {
    borderColor: "#FFD700",
  },
  marketHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  versus: {
    fontSize: "16px",
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  status: {
    fontSize: "12px",
    padding: "2px 8px",
    borderRadius: "4px",
  },
  statusBetting: {
    background: "#2D5A27",
    color: "#90EE90",
  },
  statusLocked: {
    background: "#5A4A27",
    color: "#FFD700",
  },
  statusFighting: {
    background: "#5A2727",
    color: "#FF6B6B",
  },
  statusResolved: {
    background: "#27355A",
    color: "#87CEEB",
  },
  agents: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  agentBox: {
    flex: 1,
    padding: "8px",
    borderRadius: "4px",
    textAlign: "center" as const,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  agentBoxA: {
    background: "rgba(0, 100, 200, 0.2)",
    border: "1px solid #0066CC",
    marginRight: "8px",
  },
  agentBoxB: {
    background: "rgba(200, 50, 50, 0.2)",
    border: "1px solid #CC3333",
    marginLeft: "8px",
  },
  agentBoxSelected: {
    borderWidth: "2px",
    background: "rgba(255, 215, 0, 0.2)",
  },
  agentName: {
    fontSize: "14px",
    fontWeight: "bold",
    marginBottom: "4px",
  },
  agentStats: {
    fontSize: "11px",
    color: "#888",
  },
  pool: {
    fontSize: "13px",
    color: "#FFD700",
    marginTop: "4px",
  },
  odds: {
    fontSize: "12px",
    color: "#90EE90",
  },
  timer: {
    fontSize: "11px",
    color: "#FF6B6B",
    textAlign: "center" as const,
    marginTop: "8px",
  },
  betSection: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginTop: "8px",
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    background: "rgba(0, 0, 0, 0.5)",
    border: "1px solid #444",
    borderRadius: "4px",
    color: "#FFFFFF",
    fontSize: "14px",
  },
  button: {
    padding: "8px 16px",
    background: "linear-gradient(180deg, #4a90d9 0%, #3478c5 100%)",
    border: "1px solid #5599dd",
    borderRadius: "4px",
    color: "#FFFFFF",
    fontSize: "14px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  claimButton: {
    background: "linear-gradient(180deg, #4ad94a 0%, #34c534 100%)",
    border: "1px solid #55dd55",
  },
  position: {
    fontSize: "12px",
    color: "#87CEEB",
    marginTop: "8px",
    padding: "4px 8px",
    background: "rgba(0, 100, 200, 0.2)",
    borderRadius: "4px",
  },
  winner: {
    fontSize: "14px",
    fontWeight: "bold",
    color: "#90EE90",
    textAlign: "center" as const,
    marginTop: "8px",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "40px",
    color: "#888",
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatTime(ms: number): string {
  if (ms <= 0) return "Closed";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function calculateOdds(poolA: number, poolB: number, side: "A" | "B"): string {
  const total = poolA + poolB;
  if (total === 0) return "1.00x";
  const pool = side === "A" ? poolA : poolB;
  if (pool === 0) return "-.--x";
  const odds = total / pool;
  return `${odds.toFixed(2)}x`;
}

function getWinRate(
  stats: { wins: number; totalDuels: number } | null,
): string {
  if (!stats || stats.totalDuels === 0) return "New";
  const winRate = (stats.wins / stats.totalDuels) * 100;
  return `${winRate.toFixed(0)}% (${stats.wins}W-${stats.totalDuels - stats.wins}L)`;
}

// ============================================================================
// Component
// ============================================================================

export function BettingPanel({
  state,
  onPlaceBet,
  onClaimWinnings,
  onClose,
}: BettingPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [betAmount, setBetAmount] = useState<string>("");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<"A" | "B" | null>(null);
  const [now, setNow] = useState(Date.now());

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMarketClick = useCallback((marketId: string) => {
    setSelectedMarket((prev) => (prev === marketId ? null : marketId));
    setSelectedSide(null);
  }, []);

  const handleSideClick = useCallback(
    (marketId: string, side: "A" | "B", e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedMarket(marketId);
      setSelectedSide(side);
    },
    [],
  );

  const handlePlaceBet = useCallback(() => {
    if (!selectedMarket || !selectedSide) return;
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) return;
    onPlaceBet(selectedMarket, selectedSide, amount);
    setBetAmount("");
    setSelectedSide(null);
  }, [selectedMarket, selectedSide, betAmount, onPlaceBet]);

  const handleClaimClick = useCallback(
    (marketId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onClaimWinnings(marketId);
    },
    [onClaimWinnings],
  );

  if (!state.visible) return null;

  return (
    <ModalWindow
      title="Agent Duel Betting"
      visible={state.visible}
      onClose={onClose}
      width={550}
      closeOnBackdropClick
    >
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>Active Markets</span>
          <span style={styles.balance}>
            Balance: {state.userBalance.toLocaleString()} GOLD
          </span>
        </div>

        {/* Market List */}
        <div style={styles.marketList}>
          {state.markets.length === 0 ? (
            <div style={styles.emptyState}>
              No active betting markets.
              <br />
              Check back when agents are scheduled to duel!
            </div>
          ) : (
            state.markets.map((market) => {
              const isSelected = selectedMarket === market.duelId;
              const position = state.positions.find(
                (p) => p.marketId === market.duelId,
              );
              const timeRemaining = market.bettingClosesAt - now;
              const canBet = market.status === "betting" && timeRemaining > 0;
              const isResolved = market.status === "resolved";
              const userWon =
                isResolved && position && position.side === market.winnerSide;

              return (
                <div
                  key={market.duelId}
                  style={{
                    ...styles.market,
                    ...(isSelected ? styles.marketSelected : {}),
                  }}
                  onClick={() => handleMarketClick(market.duelId)}
                >
                  {/* Market Header */}
                  <div style={styles.marketHeader}>
                    <span style={styles.versus}>
                      {market.agent1Name} vs {market.agent2Name}
                    </span>
                    <span
                      style={{
                        ...styles.status,
                        ...(market.status === "betting"
                          ? styles.statusBetting
                          : market.status === "locked"
                            ? styles.statusLocked
                            : market.status === "fighting"
                              ? styles.statusFighting
                              : styles.statusResolved),
                      }}
                    >
                      {market.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Agent Boxes */}
                  <div style={styles.agents}>
                    <div
                      style={{
                        ...styles.agentBox,
                        ...styles.agentBoxA,
                        ...(isSelected && selectedSide === "A"
                          ? styles.agentBoxSelected
                          : {}),
                      }}
                      onClick={(e) =>
                        canBet && handleSideClick(market.duelId, "A", e)
                      }
                    >
                      <div
                        style={{
                          ...styles.agentName,
                          color: "#6699FF",
                        }}
                      >
                        {market.agent1Name}
                      </div>
                      <div style={styles.agentStats}>
                        {getWinRate(market.agent1Stats)}
                      </div>
                      <div style={styles.pool}>
                        Pool: {market.poolA.toLocaleString()}
                      </div>
                      <div style={styles.odds}>
                        Odds: {calculateOdds(market.poolA, market.poolB, "A")}
                      </div>
                    </div>

                    <div
                      style={{
                        ...styles.agentBox,
                        ...styles.agentBoxB,
                        ...(isSelected && selectedSide === "B"
                          ? styles.agentBoxSelected
                          : {}),
                      }}
                      onClick={(e) =>
                        canBet && handleSideClick(market.duelId, "B", e)
                      }
                    >
                      <div
                        style={{
                          ...styles.agentName,
                          color: "#FF6666",
                        }}
                      >
                        {market.agent2Name}
                      </div>
                      <div style={styles.agentStats}>
                        {getWinRate(market.agent2Stats)}
                      </div>
                      <div style={styles.pool}>
                        Pool: {market.poolB.toLocaleString()}
                      </div>
                      <div style={styles.odds}>
                        Odds: {calculateOdds(market.poolA, market.poolB, "B")}
                      </div>
                    </div>
                  </div>

                  {/* Timer */}
                  {canBet && (
                    <div style={styles.timer}>
                      Betting closes in: {formatTime(timeRemaining)}
                    </div>
                  )}

                  {/* User Position */}
                  {position && (
                    <div style={styles.position}>
                      Your bet: {position.amount.toLocaleString()} GOLD on{" "}
                      {position.side === "A"
                        ? market.agent1Name
                        : market.agent2Name}
                      {!isResolved &&
                        ` (Potential: ${position.potentialPayout.toLocaleString()})`}
                    </div>
                  )}

                  {/* Winner Display */}
                  {isResolved && market.winnerId && (
                    <div style={styles.winner}>
                      Winner:{" "}
                      {market.winnerSide === "A"
                        ? market.agent1Name
                        : market.agent2Name}
                    </div>
                  )}

                  {/* Bet Input (when market selected and side chosen) */}
                  {isSelected && selectedSide && canBet && (
                    <div style={styles.betSection}>
                      <input
                        type="number"
                        placeholder="Amount"
                        value={betAmount}
                        onChange={(e) => setBetAmount(e.target.value)}
                        style={styles.input}
                        min="1"
                        max={state.userBalance}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        style={{
                          ...styles.button,
                          ...(parseFloat(betAmount) > 0
                            ? {}
                            : styles.buttonDisabled),
                        }}
                        onClick={handlePlaceBet}
                        disabled={parseFloat(betAmount) <= 0}
                      >
                        Place Bet
                      </button>
                    </div>
                  )}

                  {/* Claim Button (when user won) */}
                  {isResolved && userWon && (
                    <div style={styles.betSection}>
                      <button
                        style={{ ...styles.button, ...styles.claimButton }}
                        onClick={(e) => handleClaimClick(market.duelId, e)}
                      >
                        Claim {position?.potentialPayout.toLocaleString()} GOLD
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </ModalWindow>
  );
}

export default BettingPanel;
