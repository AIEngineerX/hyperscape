import React from "react";

interface OrderBookProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
}

function generateDepthLevels(
  totalAmount: number,
  midPrice: number,
  side: "bid" | "ask",
  levels: number = 5,
): { price: number; amount: number; total: number }[] {
  if (totalAmount <= 0) {
    // Return empty skeleton levels
    const step = side === "bid" ? -0.02 : 0.02;
    return Array.from({ length: levels }, (_, i) => ({
      price: Math.max(0, Math.min(1, midPrice + step * (i + 1))),
      amount: 0,
      total: 0,
    }));
  }

  const step = side === "bid" ? -0.02 : 0.02;
  const result: { price: number; amount: number; total: number }[] = [];
  let cumulative = 0;

  for (let i = 0; i < levels; i++) {
    // Distribute liquidity with exponential growth toward edges
    const weight = Math.pow(1.8, i);
    const amount = Math.round(
      totalAmount * ((weight / (Math.pow(1.8, levels) - 1)) * (1.8 - 1)),
    );
    cumulative += amount;
    result.push({
      price: Math.max(0.01, Math.min(0.99, midPrice + step * (i + 1))),
      amount,
      total: cumulative,
    });
  }

  if (side === "ask") result.reverse();
  return result;
}

export function OrderBook({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
}: OrderBookProps) {
  const yesImplied = totalPot > 0 ? yesPot / totalPot : 0.5;
  const midPrice = totalPot > 0 ? yesImplied : 0.5;
  const spread =
    totalPot > 0
      ? Math.max(0.01, 0.02 * (1 - Math.min(totalPot / 1e9, 0.9)))
      : 0;

  const bids = generateDepthLevels(yesPot, midPrice - spread / 2, "bid");
  const asks = generateDepthLevels(noPot, midPrice + spread / 2, "ask");

  const maxBidTotal = bids.reduce((m, b) => Math.max(m, b.total), 1);
  const maxAskTotal = asks.reduce((m, a) => Math.max(m, a.total), 1);

  const formatAmount = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

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
        {asks.map((ask, i) => (
          <div
            key={`ask-${i}`}
            style={{
              display: "flex",
              fontSize: 12,
              position: "relative",
              padding: "3px 0",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: `${(ask.total / maxAskTotal) * 100}%`,
                background: "rgba(239,68,68,0.1)",
                zIndex: 0,
              }}
            />
            <div
              style={{ flex: 1, color: "#ef4444", fontWeight: 600, zIndex: 1 }}
            >
              {ask.price.toFixed(3)}
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "right",
                color: "rgba(255,255,255,0.7)",
                zIndex: 1,
              }}
            >
              {formatAmount(ask.amount)}
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "right",
                color: "rgba(255,255,255,0.35)",
                zIndex: 1,
              }}
            >
              {formatAmount(ask.total)}
            </div>
          </div>
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
          {midPrice.toFixed(3)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.3)",
            marginLeft: 8,
          }}
        >
          Spread: {spread.toFixed(3)}
        </div>
      </div>

      {/* Bids (Buys) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {bids.map((bid, i) => (
          <div
            key={`bid-${i}`}
            style={{
              display: "flex",
              fontSize: 12,
              position: "relative",
              padding: "3px 0",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: `${(bid.total / maxBidTotal) * 100}%`,
                background: "rgba(34,197,94,0.1)",
                zIndex: 0,
              }}
            />
            <div
              style={{ flex: 1, color: "#22c55e", fontWeight: 600, zIndex: 1 }}
            >
              {bid.price.toFixed(3)}
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "right",
                color: "rgba(255,255,255,0.7)",
                zIndex: 1,
              }}
            >
              {formatAmount(bid.amount)}
            </div>
            <div
              style={{
                flex: 1,
                textAlign: "right",
                color: "rgba(255,255,255,0.35)",
                zIndex: 1,
              }}
            >
              {formatAmount(bid.total)}
            </div>
          </div>
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
