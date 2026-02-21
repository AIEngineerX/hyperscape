import React, { useEffect, useState, useCallback } from "react";
import { GAME_API_URL } from "../lib/config";

interface PointsDisplayProps {
  walletAddress: string | null;
  compact?: boolean;
}

interface PointsData {
  wallet: string;
  pointsScope?: "WALLET" | "LINKED";
  identityWalletCount?: number;
  totalPoints: number;
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
  multiplier: number;
  goldBalance: string | null;
  goldHoldDays: number;
}

export function PointsDisplay({
  walletAddress,
  compact = false,
}: PointsDisplayProps) {
  const [points, setPoints] = useState<PointsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const fetchPoints = useCallback(async () => {
    if (!walletAddress) {
      setPoints(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${GAME_API_URL}/api/arena/points/${walletAddress}?scope=linked`,
        { cache: "no-store" },
      );
      if (response.ok) {
        setPoints(await response.json());
        setError(null);
      } else {
        setPoints(null);
        setError(`Points API unavailable (${response.status})`);
      }
    } catch (err) {
      console.error("Failed to load points API:", err);
      setPoints(null);
      setError("Failed to load points");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void fetchPoints();
    const id = setInterval(() => void fetchPoints(), 15_000);
    return () => clearInterval(id);
  }, [fetchPoints]);

  const placeholderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: compact ? "0 12px" : "10px 14px",
    height: compact ? 38 : undefined,
    minHeight: compact ? 38 : undefined,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "'Inter', system-ui, sans-serif",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  };

  if (!walletAddress) {
    return <div style={placeholderStyle}>Connect wallet to view points</div>;
  }

  if (loading && !points) {
    return <div style={placeholderStyle}>Loading points...</div>;
  }

  const multiplier = points?.multiplier ?? 0;
  const totalPoints = points?.totalPoints ?? 0;

  return (
    <div
      className={compact ? "points-pill points-pill-compact" : "points-pill"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 10,
        padding: compact ? "0 12px" : "8px 14px",
        height: compact ? 38 : undefined,
        minHeight: compact ? 38 : undefined,
        background:
          "linear-gradient(95deg, rgba(242,208,138,0.08) 0%, rgba(10,10,18,0.6) 50%, rgba(10,10,18,0.5) 100%)",
        borderRadius: 12,
        border: "1px solid rgba(242, 208, 138, 0.15)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        position: "relative",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Top edge glow */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background:
            "linear-gradient(90deg, transparent 10%, rgba(242,208,138,0.3) 50%, transparent 90%)",
        }}
      />

      <div
        style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8 }}
      >
        <span
          style={{
            fontSize: compact ? 12 : 18,
            filter: "drop-shadow(0 0 6px rgba(242,208,138,0.5))",
            lineHeight: 1,
          }}
        >
          ⭐
        </span>
        <div>
          <div
            style={{
              fontSize: compact ? 13 : 20,
              fontWeight: 900,
              color: "#f2d08a",
              lineHeight: 1,
              fontFamily: "'Teko', sans-serif",
              letterSpacing: 1,
              textShadow: "0 0 8px rgba(242,208,138,0.3)",
            }}
          >
            {totalPoints.toLocaleString()}
          </div>
          {!compact && (
            <div
              style={{
                fontSize: 8,
                color: "rgba(242,208,138,0.45)",
                textTransform: "uppercase",
                letterSpacing: 1.5,
                fontWeight: 800,
                fontFamily: "'Teko', sans-serif",
              }}
            >
              POINTS
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div
          style={{
            width: 1,
            height: 16,
            flexShrink: 0,
            background:
              "linear-gradient(180deg, transparent, rgba(242,208,138,0.2), transparent)",
          }}
        />
      )}

      {!compact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 9,
            fontWeight: 700,
            color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase",
            fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: 0.5,
          }}
        >
          <span>
            S/W/R/S:{" "}
            <span style={{ color: "rgba(255,255,255,0.7)" }}>
              {points?.selfPoints ?? 0}/{points?.winPoints ?? 0}/
              {points?.referralPoints ?? 0}/{points?.stakingPoints ?? 0}
            </span>
          </span>
          <span>
            GOLD:{" "}
            <span style={{ color: "#f2d08a" }}>
              {points?.goldBalance ?? "0"}
            </span>
          </span>
        </div>
      )}

      {multiplier > 1 && (
        <button
          type="button"
          onClick={() => setShowPopup((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: compact ? "3px 8px" : "4px 10px",
            background:
              "linear-gradient(135deg, rgba(242,208,138,0.15) 0%, rgba(242,208,138,0.05) 100%)",
            border: "1px solid rgba(242,208,138,0.25)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 800,
            color: "#f2d08a",
            fontFamily: "'Teko', sans-serif",
            letterSpacing: 1,
            textTransform: "uppercase",
            transition: "all 0.15s ease",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "inset 0 1px 0 rgba(242,208,138,0.08)",
            flexShrink: 0,
          }}
        >
          {multiplier}× BOOST
        </button>
      )}

      {error ? (
        <div
          style={{
            fontSize: 9,
            color: "rgba(255,100,100,0.7)",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      ) : null}

      {showPopup && (
        <GoldBonusPopupInline onClose={() => setShowPopup(false)} />
      )}
    </div>
  );
}

function GoldBonusPopupInline({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: "min(320px, calc(100vw - 34px))",
        padding: 20,
        background: "rgba(10, 12, 18, 0.85)",
        backdropFilter: "blur(32px) saturate(1.4)",
        WebkitBackdropFilter: "blur(32px) saturate(1.4)",
        borderRadius: 16,
        border: "1px solid rgba(242,208,138,0.2)",
        boxShadow:
          "0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.04)",
        zIndex: 100,
        color: "#fff",
      }}
    >
      {/* Top highlight */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(242,208,138,0.3), transparent)",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            fontFamily: "'Teko', sans-serif",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "#f2d08a",
            textShadow: "0 0 8px rgba(242,208,138,0.3)",
          }}
        >
          GOLD POINTS BOOST
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            fontSize: 14,
            padding: "4px 8px",
            transition: "all 0.15s ease",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 14,
        }}
      >
        <TierRow emoji="🟤" label="1K+ GOLD" multiplier="1×" color="#a16207" />
        <TierRow
          emoji="🥈"
          label="100K+ GOLD"
          multiplier="2×"
          color="#a3a3a3"
        />
        <TierRow emoji="🥇" label="1M+ GOLD" multiplier="3×" color="#eab308" />
        <TierRow
          emoji="💎"
          label="+ held 10+ days"
          multiplier="+1×"
          color="#60a5fa"
        />
      </div>

      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          lineHeight: 1.5,
          marginBottom: 14,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        Hold or stake Hyperscape GOLD to increase your multiplier. Staked GOLD
        counts toward multiplier tiers and earns staking points daily.
      </div>

      <a
        href="https://pump.fun/DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          width: "100%",
          padding: "10px 0",
          background:
            "linear-gradient(180deg, rgba(242,208,138,0.9) 0%, rgba(196,154,58,0.9) 100%)",
          borderRadius: 10,
          border: "1px solid rgba(242,208,138,0.5)",
          color: "#0a0a0a",
          fontSize: 14,
          fontWeight: 900,
          fontFamily: "'Teko', sans-serif",
          letterSpacing: 2,
          textTransform: "uppercase",
          textAlign: "center",
          textDecoration: "none",
          cursor: "pointer",
          transition: "all 0.15s ease",
          boxShadow:
            "0 4px 20px rgba(242,208,138,0.2), inset 0 1px 0 rgba(255,255,255,0.4)",
          boxSizing: "border-box",
        }}
      >
        Get GOLD on Pump.fun →
      </a>
    </div>
  );
}

function TierRow({
  emoji,
  label,
  multiplier,
  color,
}: {
  emoji: string;
  label: string;
  multiplier: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 10px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        borderRadius: 8,
        border: `1px solid ${color}20`,
        backdropFilter: "blur(8px)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>{emoji}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 900,
          color,
          fontFamily: "'Teko', sans-serif",
          letterSpacing: 1,
          textShadow: `0 0 8px ${color}40`,
        }}
      >
        {multiplier}
      </span>
    </div>
  );
}
