import React, { useEffect, useState } from "react";

export interface Trade {
  id: string; // unique
  side: "YES" | "NO";
  amount: number;
  price?: number;
  time: number; // timestamp
}

interface RecentTradesProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
  trades: Trade[]; // Real trades
}

function formatAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function formatTimeAgo(ts: number): string {
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 0) return "just now";
  const mins = Math.floor(ago / 60);
  const secs = ago % 60;
  if (mins > 0) return `${mins}m ${secs}s ago`;
  return `${secs}s ago`;
}

export function RecentTrades({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
  trades,
}: RecentTradesProps) {
  // We'll use a tick to keep "time ago" fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

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
      <style>{`
        @keyframes flashNewTrade {
          0% { background: rgba(255,255,255,0.2); }
          100% { background: transparent; }
        }
        .trade-row-new {
          animation: flashNewTrade 1s ease-out;
        }
      `}</style>
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
          trades.map((trade, i) => {
            // Assume trade is "new" if under 2 seconds old
            const isNew = Date.now() - trade.time < 2000;
            return (
              <div
                key={trade.id}
                className={isNew ? "trade-row-new" : ""}
                style={{
                  display: "flex",
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 4,
                  borderBottom:
                    i < trades.length - 1
                      ? "1px solid rgba(255,255,255,0.03)"
                      : "none",
                  transition: "background 0.3s",
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
                  {formatTimeAgo(trade.time)}
                </div>
              </div>
            );
          })
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
