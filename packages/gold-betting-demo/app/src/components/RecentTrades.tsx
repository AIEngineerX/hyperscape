import React from "react";

interface RecentTradesProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
}

// Generate mock recent trades from pool state
function generateRecentTrades(
  yesPot: number,
  noPot: number,
): { side: "YES" | "NO"; amount: number; time: string }[] {
  if (yesPot <= 0 && noPot <= 0) return [];

  const total = yesPot + noPot;
  const trades: { side: "YES" | "NO"; amount: number; time: string }[] = [];
  const now = Date.now();

  // Generate proportional trades from pool data
  const tradeCount = Math.min(12, Math.max(3, Math.floor(total / 1e6)));
  for (let i = 0; i < tradeCount; i++) {
    const isYes = Math.random() < yesPot / total;
    const pool = isYes ? yesPot : noPot;
    const amount = Math.round(pool * (0.05 + Math.random() * 0.15));
    const ago = Math.floor(Math.random() * 300);
    const mins = Math.floor(ago / 60);
    const secs = ago % 60;
    trades.push({
      side: isYes ? "YES" : "NO",
      amount,
      time: mins > 0 ? `${mins}m ${secs}s ago` : `${secs}s ago`,
    });
  }

  return trades;
}

function formatAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

export function RecentTrades({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
}: RecentTradesProps) {
  const trades = generateRecentTrades(yesPot, noPot);

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.3)",
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Recent Trades
        </div>
        {goldPriceUsd !== null && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            GOLD ${goldPriceUsd.toFixed(4)}
          </div>
        )}
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          fontSize: 10,
          color: "rgba(255,255,255,0.3)",
          paddingBottom: 4,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ flex: 1 }}>Side</div>
        <div style={{ flex: 1, textAlign: "right" }}>Amount</div>
        <div style={{ flex: 1, textAlign: "right" }}>Time</div>
      </div>

      {/* Trade List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {trades.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "16px 0",
              color: "rgba(255,255,255,0.2)",
              fontSize: 12,
            }}
          >
            No trades yet
          </div>
        ) : (
          trades.map((trade, i) => (
            <div
              key={`trade-${i}`}
              style={{
                display: "flex",
                fontSize: 12,
                padding: "4px 0",
                borderBottom:
                  i < trades.length - 1
                    ? "1px solid rgba(255,255,255,0.03)"
                    : "none",
              }}
            >
              <div
                style={{
                  flex: 1,
                  color: trade.side === "YES" ? "#22c55e" : "#ef4444",
                  fontWeight: 700,
                }}
              >
                {trade.side}
              </div>
              <div
                style={{
                  flex: 1,
                  textAlign: "right",
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {formatAmount(trade.amount)}
              </div>
              <div
                style={{
                  flex: 1,
                  textAlign: "right",
                  color: "rgba(255,255,255,0.35)",
                  fontSize: 11,
                }}
              >
                {trade.time}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pool Summary */}
      {totalPot > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            paddingTop: 4,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span>YES Pool: {formatAmount(yesPot)}</span>
          <span>NO Pool: {formatAmount(noPot)}</span>
        </div>
      )}
    </div>
  );
}
