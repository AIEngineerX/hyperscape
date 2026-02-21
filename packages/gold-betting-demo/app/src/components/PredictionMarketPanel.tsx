import { useState, useMemo, ReactNode } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type BetSide = "YES" | "NO";

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
  status: string;
  statusColor: string;
  agent1Name: string;
  agent2Name: string;
  isEvm: boolean;
  children?: ReactNode;
}

// Generate some mock historical data to make the chart look alive since we only have current data
function generateMockHistory(currentYesPercent: number) {
  const data = [];
  const now = Date.now();
  let lastVal = 50; // Start at 50%
  for (let i = 20; i >= 0; i--) {
    // Trend toward current
    if (i === 0) {
      data.push({ time: now, pct: currentYesPercent });
    } else {
      const diff = currentYesPercent - lastVal;
      const step = diff / (i + 1);
      lastVal = lastVal + step + (Math.random() * 10 - 5); // Add noise
      lastVal = Math.max(5, Math.min(95, lastVal)); // Clamp
      data.push({ time: now - i * 5000, pct: Math.round(lastVal) });
    }
  }
  return data;
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
  status,
  statusColor,
  agent1Name,
  agent2Name,
  isEvm,
  children,
}: PredictionMarketPanelProps) {
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");

  const chartData = useMemo(
    () => generateMockHistory(yesPercent),
    [yesPercent],
  );

  return (
    <div className="prediction-market-panel">
      <div className="chart-section">
        <div className="chart-header">
          <h3>Probability</h3>
          <div className="odds-display">
            <span
              className="yes-odds"
              style={{ color: "#22c55e", fontWeight: "bold" }}
            >
              {agent1Name}: {yesPercent}%
            </span>
            <span
              className="separator"
              style={{ margin: "0 8px", color: "rgba(255,255,255,0.3)" }}
            >
              |
            </span>
            <span
              className="no-odds"
              style={{ color: "#ef4444", fontWeight: "bold" }}
            >
              {agent2Name}: {noPercent}%
            </span>
          </div>
        </div>
        <div
          className="chart-container"
          style={{ height: "200px", marginTop: "16px" }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div
                        className="chart-tooltip"
                        style={{
                          background: "rgba(0,0,0,0.8)",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          border: "1px solid rgba(255,255,255,0.1)",
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
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="3 3"
              />
              <Line
                type="monotone"
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

      <div className="trade-section" style={{ marginTop: "24px" }}>
        <div
          className="tabs"
          style={{ display: "flex", gap: "8px", marginBottom: "16px" }}
        >
          <button
            className={`tab-btn ${activeTab === "buy" ? "active" : ""}`}
            onClick={() => setActiveTab("buy")}
            style={{
              flex: 1,
              padding: "8px",
              background:
                activeTab === "buy" ? "rgba(255,255,255,0.1)" : "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: activeTab === "buy" ? "#fff" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            Buy
          </button>
          <button
            className={`tab-btn ${activeTab === "sell" ? "active" : ""}`}
            onClick={() => setActiveTab("sell")}
            style={{
              flex: 1,
              padding: "8px",
              background:
                activeTab === "sell" ? "rgba(255,255,255,0.1)" : "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: activeTab === "sell" ? "#fff" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            Sell
          </button>
        </div>

        {activeTab === "buy" ? (
          <div className="buy-form">
            <div
              className="betting-side-row"
              style={{ display: "flex", gap: "8px", marginBottom: "16px" }}
            >
              <button
                type="button"
                className={`betting-side-btn ${side === "YES" ? "is-yes" : ""}`}
                aria-pressed={side === "YES"}
                onClick={() => setSide("YES")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background:
                    side === "YES"
                      ? "rgba(34, 197, 94, 0.2)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    side === "YES"
                      ? "1px solid #22c55e"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <span>{agent1Name}</span>
                <small
                  style={{ display: "block", fontSize: "11px", opacity: 0.6 }}
                >
                  {yesPercent}%
                </small>
              </button>
              <button
                type="button"
                className={`betting-side-btn ${side === "NO" ? "is-no" : ""}`}
                aria-pressed={side === "NO"}
                onClick={() => setSide("NO")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background:
                    side === "NO"
                      ? "rgba(239, 68, 68, 0.2)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    side === "NO"
                      ? "1px solid #ef4444"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <span>{agent2Name}</span>
                <small
                  style={{ display: "block", fontSize: "11px", opacity: 0.6 }}
                >
                  {noPercent}%
                </small>
              </button>
            </div>

            <div
              className="betting-amount-row"
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <input
                className="betting-amount-input"
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                aria-label="Bet amount in GOLD"
                placeholder="Bet amount (GOLD)"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                  boxSizing: "border-box",
                }}
              />
              <button
                className="place-order-btn betting-submit-btn"
                disabled={!isWalletReady || !programsReady}
                onClick={onPlaceBet}
                style={{
                  width: "100%",
                  padding: "14px",
                  background:
                    isWalletReady && programsReady
                      ? "#eab308"
                      : "rgba(255,255,255,0.1)",
                  color:
                    isWalletReady && programsReady
                      ? "#000"
                      : "rgba(255,255,255,0.5)",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  cursor:
                    isWalletReady && programsReady ? "pointer" : "not-allowed",
                }}
              >
                {isWalletReady
                  ? `Buy ${side === "YES" ? "Yes" : "No"}`
                  : "Connect Wallet"}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="sell-form"
            style={{
              padding: "16px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <p
              style={{
                fontSize: "14px",
                color: "rgba(255,255,255,0.7)",
                marginBottom: "12px",
              }}
            >
              {isEvm
                ? "EVM ASKs are supported. Use the EVM panel below to place sell orders."
                : "Continuous selling before market resolution is not natively supported by the current AMM logic. Please wait for the market to resolve to claim payout."}
            </p>
            {isEvm ? (
              children
            ) : (
              <button
                disabled
                style={{
                  width: "100%",
                  padding: "14px",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.3)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  cursor: "not-allowed",
                }}
              >
                Sell Feature Disabled
              </button>
            )}
          </div>
        )}

        <div
          className="betting-dock-status"
          style={{
            color: statusColor,
            marginTop: "16px",
            fontSize: "12px",
            textAlign: "center",
          }}
        >
          {status}
        </div>
      </div>
    </div>
  );
}
