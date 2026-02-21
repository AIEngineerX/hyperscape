import { useState, ReactNode } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { OrderBook, type OrderLevel } from "./OrderBook";
import { RecentTrades, type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";

export interface ChartDataPoint {
  time: number;
  pct: number;
}

interface PredictionMarketPanelProps {
  yesPercent: number;
  noPercent: number;
  yesPool: string | number;
  noPool: string | number;
  side: BetSide;
  setSide: (side: BetSide) => void;
  amountInput: string;
  setAmountInput: (val: string) => void;
  onPlaceBet: () => void;
  isWalletReady: boolean;
  programsReady: boolean;
  agent1Name: string;
  agent2Name: string;
  isEvm: boolean;
  chartData?: ChartDataPoint[];
  bids?: OrderLevel[];
  asks?: OrderLevel[];
  recentTrades?: Trade[];
  goldPriceUsd?: number | null;
  children?: ReactNode;
  onViewAgent1?: () => void;
  onViewAgent2?: () => void;
}

export function PredictionMarketPanel({
  yesPercent,
  noPercent,
  yesPool,
  noPool,
  side,
  setSide,
  amountInput,
  setAmountInput,
  onPlaceBet,
  isWalletReady,
  programsReady,
  agent1Name,
  agent2Name,
  isEvm,
  chartData = [],
  bids = [],
  asks = [],
  recentTrades = [],
  goldPriceUsd = null,
  children,
  onViewAgent1,
  onViewAgent2,
}: PredictionMarketPanelProps) {
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");

  const yesSelected = side === "YES";
  const noSelected = side === "NO";
  const canBet = isWalletReady && programsReady;

  return (
    <div className="prediction-market-panel" style={{ position: "relative" }}>
      {/* 3 Column Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "230px 1fr 300px",
          gap: 14,
          marginBottom: 14,
          minHeight: 320,
        }}
      >
        {/* ========== LEFT COLUMN: Betting Controls ========== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Agent 1 Select */}
          <button
            type="button"
            aria-pressed={yesSelected}
            onClick={() => setSide("YES")}
            className="gm-btn gm-btn-agent1"
            style={{
              position: "relative",
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              color: "#fff",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.2s ease",
              overflow: "hidden",
              background: yesSelected
                ? "linear-gradient(180deg, #2dd47a 0%, #1a9e55 40%, #147a42 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)",
              boxShadow: yesSelected
                ? "0 4px 16px rgba(34,197,94,0.5), 0 2px 4px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.25), 0 0 24px rgba(34,197,94,0.2)"
                : "0 2px 8px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -1px 2px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                textShadow: yesSelected
                  ? "0 1px 2px rgba(0,0,0,0.5), 0 0 10px rgba(255,255,255,0.15)"
                  : "0 1px 2px rgba(0,0,0,0.5)",
              }}
            >
              {agent1Name}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: yesSelected ? "#fff" : "#22c55e",
                fontFamily: "monospace",
                lineHeight: 1,
                marginTop: 3,
                textShadow: yesSelected
                  ? "0 0 12px rgba(255,255,255,0.4), 0 2px 3px rgba(0,0,0,0.4)"
                  : "0 0 8px rgba(34,197,94,0.3)",
              }}
            >
              {yesPercent}%
            </div>
            {yesSelected && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                }}
              />
            )}
          </button>

          {/* Agent 2 Select */}
          <button
            type="button"
            aria-pressed={noSelected}
            onClick={() => setSide("NO")}
            className="gm-btn gm-btn-agent2"
            style={{
              position: "relative",
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              color: "#fff",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.2s ease",
              overflow: "hidden",
              background: noSelected
                ? "linear-gradient(180deg, #f05050 0%, #d42a2a 40%, #a01e1e 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)",
              boxShadow: noSelected
                ? "0 4px 16px rgba(239,68,68,0.5), 0 2px 4px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.25), 0 0 24px rgba(239,68,68,0.2)"
                : "0 2px 8px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -1px 2px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                textShadow: noSelected
                  ? "0 1px 2px rgba(0,0,0,0.5), 0 0 10px rgba(255,255,255,0.15)"
                  : "0 1px 2px rgba(0,0,0,0.5)",
              }}
            >
              {agent2Name}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: noSelected ? "#fff" : "#ef4444",
                fontFamily: "monospace",
                lineHeight: 1,
                marginTop: 3,
                textShadow: noSelected
                  ? "0 0 12px rgba(255,255,255,0.4), 0 2px 3px rgba(0,0,0,0.4)"
                  : "0 0 8px rgba(239,68,68,0.3)",
              }}
            >
              {noPercent}%
            </div>
            {noSelected && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                }}
              />
            )}
          </button>

          {/* View Stats */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={onViewAgent1}
              className="gm-btn-sm gm-btn-sm-green"
              style={{
                flex: 1,
                padding: "7px 6px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                background:
                  "linear-gradient(180deg, rgba(34,197,94,0.25) 0%, rgba(34,197,94,0.1) 100%)",
                color: "#4ade80",
                boxShadow:
                  "0 2px 6px rgba(34,197,94,0.25), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 2px rgba(0,0,0,0.2)",
                textShadow: "0 0 6px rgba(34,197,94,0.4)",
              }}
            >
              STATS
            </button>
            <button
              onClick={onViewAgent2}
              className="gm-btn-sm gm-btn-sm-red"
              style={{
                flex: 1,
                padding: "7px 6px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                background:
                  "linear-gradient(180deg, rgba(239,68,68,0.25) 0%, rgba(239,68,68,0.1) 100%)",
                color: "#f87171",
                boxShadow:
                  "0 2px 6px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 2px rgba(0,0,0,0.2)",
                textShadow: "0 0 6px rgba(239,68,68,0.4)",
              }}
            >
              STATS
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              margin: "2px 0",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
            }}
          />

          {/* Buy / Sell Toggle */}
          <div
            style={{
              display: "flex",
              gap: 0,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 10,
              padding: 3,
            }}
          >
            <button
              onClick={() => setActiveTab("buy")}
              className="gm-tab"
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                background:
                  activeTab === "buy"
                    ? "linear-gradient(180deg, #2dd47a 0%, #1a9e55 100%)"
                    : "transparent",
                color: activeTab === "buy" ? "#fff" : "rgba(255,255,255,0.35)",
                boxShadow:
                  activeTab === "buy"
                    ? "0 2px 8px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.25)"
                    : "none",
                textShadow:
                  activeTab === "buy" ? "0 1px 2px rgba(0,0,0,0.4)" : "none",
              }}
            >
              BUY
            </button>
            <button
              onClick={() => setActiveTab("sell")}
              className="gm-tab"
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                background:
                  activeTab === "sell"
                    ? "linear-gradient(180deg, #f05050 0%, #d42a2a 100%)"
                    : "transparent",
                color: activeTab === "sell" ? "#fff" : "rgba(255,255,255,0.35)",
                boxShadow:
                  activeTab === "sell"
                    ? "0 2px 8px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.25)"
                    : "none",
                textShadow:
                  activeTab === "sell" ? "0 1px 2px rgba(0,0,0,0.4)" : "none",
              }}
            >
              SELL
            </button>
          </div>

          {/* Amount + Submit */}
          {activeTab === "buy" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
              }}
            >
              <input
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                aria-label="Bet amount in GOLD"
                placeholder="AMOUNT"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  color: "#f2d08a",
                  boxSizing: "border-box",
                  fontSize: 16,
                  fontWeight: 800,
                  fontFamily: "monospace",
                  letterSpacing: 1,
                  background: "rgba(0,0,0,0.5)",
                  boxShadow:
                    "inset 0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06), 0 1px 0 rgba(255,255,255,0.04)",
                }}
              />
              <button
                disabled={!canBet}
                onClick={onPlaceBet}
                className="gm-btn-submit"
                style={{
                  width: "100%",
                  padding: "14px 8px",
                  borderRadius: 12,
                  border: "none",
                  fontWeight: 900,
                  fontSize: 14,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  cursor: canBet ? "pointer" : "not-allowed",
                  transition: "all 0.2s ease",
                  fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                  background: canBet
                    ? "linear-gradient(180deg, #ffe066 0%, #eab308 30%, #c9960a 70%, #a67c08 100%)"
                    : "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                  color: canBet ? "#1a0f00" : "rgba(255,255,255,0.25)",
                  boxShadow: canBet
                    ? "0 4px 20px rgba(234,179,8,0.45), 0 2px 4px rgba(0,0,0,0.3), inset 0 2px 1px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.2), 0 0 30px rgba(234,179,8,0.15)"
                    : "0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
                  textShadow: canBet
                    ? "0 1px 1px rgba(255,255,255,0.3)"
                    : "none",
                }}
              >
                {isWalletReady ? `BUY ${side}` : "CONNECT"}
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                flex: 1,
                background: "rgba(0,0,0,0.3)",
                boxShadow:
                  "inset 0 2px 6px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.04)",
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.45)",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {isEvm
                  ? "EVM sell orders supported via the EVM panel."
                  : "Sell disabled until market resolution."}
              </p>
              {isEvm ? (
                children
              ) : (
                <button
                  disabled
                  style={{
                    width: "100%",
                    marginTop: 8,
                    padding: "10px",
                    borderRadius: 8,
                    border: "none",
                    fontWeight: 700,
                    fontSize: 11,
                    cursor: "not-allowed",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
                    color: "rgba(255,255,255,0.2)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                  }}
                >
                  LOCKED
                </button>
              )}
            </div>
          )}
        </div>

        {/* ========== MIDDLE COLUMN: Chart ========== */}
        <div
          style={{
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
              }}
            >
              PROBABILITY
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  color: "#22c55e",
                  fontWeight: 800,
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              >
                {agent1Name} {yesPercent}%
              </span>
              <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>
                |
              </span>
              <span
                style={{
                  color: "#ef4444",
                  fontWeight: 800,
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              >
                {agent2Name} {noPercent}%
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="time" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div
                          style={{
                            background: "rgba(0,0,0,0.9)",
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(242,208,138,0.3)",
                            fontSize: 12,
                            fontFamily: "monospace",
                            fontWeight: 700,
                            color: "#f2d08a",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                          }}
                        >
                          {payload[0].value}% {agent1Name}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  y={50}
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="3 3"
                />
                <Line
                  type="stepAfter"
                  dataKey="pct"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ========== RIGHT COLUMN: Order Book + Recent Trades ========== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <OrderBook
              yesPot={Number(yesPool)}
              noPot={Number(noPool)}
              totalPot={Number(yesPool) + Number(noPool)}
              goldPriceUsd={goldPriceUsd}
              bids={bids}
              asks={asks}
              midPrice={yesPercent / 100}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <RecentTrades
              yesPot={Number(yesPool)}
              noPot={Number(noPool)}
              totalPot={Number(yesPool) + Number(noPool)}
              goldPriceUsd={goldPriceUsd}
              trades={recentTrades}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        .gm-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .gm-btn:active {
          transform: translateY(1px);
          filter: brightness(0.95);
        }
        .gm-btn-agent1:hover {
          box-shadow: 0 5px 14px rgba(34,197,94,0.3), 0 2px 4px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.25) !important;
        }
        .gm-btn-agent2:hover {
          box-shadow: 0 5px 14px rgba(239,68,68,0.3), 0 2px 4px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.25) !important;
        }
        .gm-btn-sm:hover {
          transform: translateY(-1px);
          filter: brightness(1.15);
        }
        .gm-btn-sm:active {
          transform: translateY(0px);
          filter: brightness(0.9);
        }
        .gm-btn-sm-green:hover {
          box-shadow: 0 3px 8px rgba(34,197,94,0.25), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 2px rgba(0,0,0,0.2) !important;
        }
        .gm-btn-sm-red:hover {
          box-shadow: 0 3px 8px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 2px rgba(0,0,0,0.2) !important;
        }
        .gm-tab:hover {
          filter: brightness(1.08);
        }
        .gm-tab:active {
          filter: brightness(0.9);
        }
        .gm-btn-submit:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 5px 16px rgba(234,179,8,0.35), 0 2px 4px rgba(0,0,0,0.3), inset 0 2px 1px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.2) !important;
          filter: brightness(1.05);
        }
        .gm-btn-submit:not(:disabled):active {
          transform: translateY(1px);
          box-shadow: 0 2px 6px rgba(234,179,8,0.25), 0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 2px 6px rgba(0,0,0,0.15) !important;
          filter: brightness(0.95);
        }
      `}</style>
    </div>
  );
}
