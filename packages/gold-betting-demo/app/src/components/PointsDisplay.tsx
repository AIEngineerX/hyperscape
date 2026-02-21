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

  if (!walletAddress) {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          fontSize: 12,
          color: "rgba(255,255,255,0.62)",
        }}
      >
        Connect a wallet to view points.
      </div>
    );
  }

  if (loading && !points) {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          fontSize: 12,
          color: "rgba(255,255,255,0.62)",
        }}
      >
        Loading points...
      </div>
    );
  }

  const multiplier = points?.multiplier ?? 0;
  const totalPoints = points?.totalPoints ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        padding: compact ? "8px 10px" : "10px 14px",
        background: "rgba(0,0,0,0.4)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: compact ? 16 : 20,
            filter: "drop-shadow(0 0 4px rgba(234,179,8,0.5))",
          }}
        >
          ⭐
        </span>
        <div>
          <div
            style={{
              fontSize: compact ? 14 : 16,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1,
            }}
          >
            {totalPoints.toLocaleString()}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Points
          </div>
        </div>
      </div>

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>
          S / W / R / Stk: {points?.selfPoints ?? 0} / {points?.winPoints ?? 0}{" "}
          / {points?.referralPoints ?? 0} / {points?.stakingPoints ?? 0}
        </span>
        <span>
          GOLD: {points?.goldBalance ?? "0"} ({points?.goldHoldDays ?? 0}d)
        </span>
        <span>
          Scope: {points?.pointsScope ?? "WALLET"} (
          {points?.identityWalletCount ?? 1} wallet
          {(points?.identityWalletCount ?? 1) === 1 ? "" : "s"})
        </span>
      </div>

      {/* Multiplier badge */}
      {multiplier > 1 && (
        <button
          type="button"
          onClick={() => setShowPopup((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            background: "rgba(234,179,8,0.14)",
            border: "1px solid rgba(234,179,8,0.35)",
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: "#facc15",
          }}
        >
          Boost Points
        </button>
      )}

      {error ? (
        <div
          style={{
            width: "100%",
            fontSize: 10,
            color: "#fca5a5",
            marginTop: 2,
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
        background: "rgba(15,15,15,0.95)",
        backdropFilter: "blur(20px)",
        borderRadius: 16,
        border: "1px solid rgba(234,179,8,0.3)",
        boxShadow:
          "0 20px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(234,179,8,0.1)",
        zIndex: 100,
        color: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800 }}>
          🪙 GOLD Points Boost
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 18,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 16,
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
          label="+ 100K+/1M+ held 10+ days"
          multiplier="+1×"
          color="#60a5fa"
        />
      </div>

      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          lineHeight: 1.5,
          marginBottom: 14,
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
          padding: "12px 0",
          background: "linear-gradient(135deg, #eab308, #d97706)",
          borderRadius: 10,
          border: "none",
          color: "#000",
          fontSize: 13,
          fontWeight: 800,
          textAlign: "center",
          textDecoration: "none",
          cursor: "pointer",
          transition: "opacity 0.15s",
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
        padding: "8px 12px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        border: `1px solid ${color}22`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "rgba(255,255,255,0.8)",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 900,
          color,
        }}
      >
        {multiplier}
      </span>
    </div>
  );
}
