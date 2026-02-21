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

  const color = type === "bid" ? "#00ffcc" : "#ff0d3c";
  const bg = type === "bid" ? "rgba(0,255,204,0.15)" : "rgba(255,13,60,0.15)";
  const borderColor =
    type === "bid" ? "rgba(0,255,204,0.4)" : "rgba(255,13,60,0.4)";

  let rowBg = "transparent";
  if (flash === "up") rowBg = "rgba(255,255,255,0.15)";
  if (flash === "down") rowBg = "rgba(255,0,0,0.15)";

  return (
    <div
      style={{
        display: "flex",
        fontSize: 12,
        position: "relative",
        padding: "3px 4px 3px 8px",
        background: rowBg,
        transition: "background 0.5s ease-out",
        borderRadius: 4,
        borderLeft: `2px solid ${borderColor}`,
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
          borderRadius: "0 4px 4px 0",
        }}
      />
      <div
        style={{
          flex: 1,
          color,
          fontWeight: 700,
          zIndex: 1,
          textShadow: `0 0 6px ${color}44`,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
        }}
      >
        {level.price.toFixed(3)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "rgba(255,255,255,0.75)",
          zIndex: 1,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
        }}
      >
        {formatAmount(level.amount)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "right",
          color: "rgba(255,255,255,0.4)",
          zIndex: 1,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
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
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          paddingBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: "rgba(255,255,255,0.4)",
            fontFamily: "'Teko', sans-serif",
          }}
        >
          ORDER BOOK
        </div>
        {goldPriceUsd !== null && (
          <div
            style={{
              fontSize: 10,
              color: "rgba(242,208,138,0.5)",
              fontWeight: 700,
            }}
          >
            GOLD ${goldPriceUsd.toFixed(4)}
          </div>
        )}
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          fontSize: 9,
          fontWeight: 900,
          color: "rgba(255,255,255,0.35)",
          padding: "2px 8px",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          fontFamily: "'Teko', sans-serif",
        }}
      >
        <div style={{ flex: 1 }}>Price</div>
        <div style={{ flex: 1, textAlign: "right" }}>Size</div>
        <div style={{ flex: 1, textAlign: "right" }}>Total</div>
      </div>

      {/* Asks (Sells) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          flex: 1,
          minHeight: 0,
          justifyContent: "flex-end",
        }}
      >
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
          padding: "4px 0",
          margin: "1px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0,0,0,0.4)",
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid rgba(242,208,138,0.2)",
            boxShadow:
              "0 0 8px rgba(242,208,138,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 900,
              color: "#f2d08a",
              fontFamily: "'IBM Plex Mono', monospace",
              textShadow: "0 0 8px rgba(242,208,138,0.3)",
            }}
          >
            {displayMid.toFixed(3)}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Spread: {displaySpread.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Bids (Buys) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          flex: 1,
          minHeight: 0,
        }}
      >
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
            paddingTop: 4,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "rgba(255,255,255,0.45)",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#00ffcc",
                boxShadow: "0 0 4px rgba(0,255,204,0.4)",
              }}
            />
            YES Pool: {formatAmount(yesPot)}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "rgba(255,255,255,0.45)",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#ff0d3c",
                boxShadow: "0 0 4px rgba(255,13,60,0.4)",
              }}
            />
            NO Pool: {formatAmount(noPot)}
          </span>
        </div>
      )}
    </>
  );
}
