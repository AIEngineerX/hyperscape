import React, { useEffect, useState, useRef } from "react";

export interface OrderLevel {
  price: number;
  amount: number;
  total: number;
}

interface OrderBookProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
  bids?: OrderLevel[];
  asks?: OrderLevel[];
  midPrice?: number;
  spread?: number;
}

function formatAmount(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function LevelRow({
  level,
  type,
  maxTotal,
}: {
  level: OrderLevel;
  type: "bid" | "ask";
  maxTotal: number;
}) {
  const prevAmountRef = useRef(level.amount);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (level.amount > prevAmountRef.current) {
      setFlash("up");
    } else if (level.amount < prevAmountRef.current) {
      setFlash("down");
    }
    prevAmountRef.current = level.amount;

    const timer = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(timer);
  }, [level.amount]);

  const color = type === "bid" ? "#22c55e" : "#ef4444";
  const bg = type === "bid" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";

  let rowBg = "transparent";
  if (flash === "up") rowBg = "rgba(255,255,255,0.15)";
  if (flash === "down") rowBg = "rgba(255,0,0,0.15)";

  return (
    <div
      style={{
        display: "flex",
        fontSize: 12,
        position: "relative",
        padding: "3px 4px",
        background: rowBg,
        transition: "background 0.5s ease-out",
        borderRadius: 2,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${maxTotal > 0 ? (level.total / maxTotal) * 100 : 0}%`,
          background: bg,
          zIndex: 0,
          transition: "width 0.3s ease-out",
        }}
      />
      <div style={{ flex: 1, color, fontWeight: 600, zIndex: 1 }}>
        {level.price.toFixed(3)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "rgba(255,255,255,0.7)",
          zIndex: 1,
        }}
      >
        {formatAmount(level.amount)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "rgba(255,255,255,0.35)",
          zIndex: 1,
        }}
      >
        {formatAmount(level.total)}
      </div>
    </div>
  );
}

export function OrderBook({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
  bids = [],
  asks = [],
  midPrice,
  spread,
}: OrderBookProps) {
  const displayMid = midPrice ?? (totalPot > 0 ? yesPot / totalPot : 0.5);
  const displaySpread = spread ?? 0;

  const maxBidTotal = bids.reduce((m, b) => Math.max(m, b.total), 1);
  const maxAskTotal = asks.reduce((m, a) => Math.max(m, a.total), 1);

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
          Order Book
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
        <div style={{ flex: 1 }}>Price</div>
        <div style={{ flex: 1, textAlign: "right" }}>Size</div>
        <div style={{ flex: 1, textAlign: "right" }}>Total</div>
      </div>

      {/* Asks (Sells) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {asks.map((ask) => (
          <LevelRow
            key={`ask-${ask.price}`}
            level={ask}
            type="ask"
            maxTotal={maxAskTotal}
          />
        ))}
      </div>

      {/* Spread / Mid */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "8px 0",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>
          {displayMid.toFixed(3)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.3)",
            marginLeft: 8,
          }}
        >
          Spread: {displaySpread.toFixed(3)}
        </div>
      </div>

      {/* Bids (Buys) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {bids.map((bid) => (
          <LevelRow
            key={`bid-${bid.price}`}
            level={bid}
            type="bid"
            maxTotal={maxBidTotal}
          />
        ))}
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
