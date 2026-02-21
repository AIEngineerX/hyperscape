import React, { useEffect, useState, useCallback } from "react";
import { GAME_API_URL } from "../lib/config";

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  totalPoints: number;
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

export function PointsLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const fetchLeaderboard = useCallback(async () => {
    try {
      setError(null);
      const offset = page * pageSize;
      const response = await fetch(
        `${GAME_API_URL}/api/arena/points/leaderboard?limit=${pageSize}&offset=${offset}&scope=linked`,
        { cache: "no-store" },
      );
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data.leaderboard ?? []);
      } else {
        setLeaderboard([]);
        setError(`Leaderboard unavailable (${response.status})`);
      }
    } catch {
      setLeaderboard([]);
      setError("Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void fetchLeaderboard();
    const id = setInterval(() => void fetchLeaderboard(), 30_000);
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "#fff",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: "rgba(255,255,255,0.5)",
          marginBottom: 8,
        }}
      >
        ⭐ Points Leaderboard
      </div>

      {loading && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.3)",
            padding: 16,
            textAlign: "center",
          }}
        >
          Loading...
        </div>
      )}

      {!loading && leaderboard.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: error ? "#fca5a5" : "rgba(255,255,255,0.3)",
            padding: 24,
            textAlign: "center",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {error ?? "No points data yet. Place a bet to get started!"}
        </div>
      )}

      {leaderboard.length > 0 && (
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              padding: "10px 16px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "rgba(255,255,255,0.3)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ width: 36 }}>#</div>
            <div style={{ flex: 1 }}>Wallet</div>
            <div style={{ width: 100, textAlign: "right" }}>Points</div>
          </div>

          {/* Rows */}
          {leaderboard.map((entry) => (
            <div
              key={entry.wallet}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 16px",
                fontSize: 13,
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 36,
                  fontWeight: 800,
                  color:
                    entry.rank === 1
                      ? "#eab308"
                      : entry.rank === 2
                        ? "#a3a3a3"
                        : entry.rank === 3
                          ? "#cd7f32"
                          : "rgba(255,255,255,0.4)",
                  fontSize: entry.rank <= 3 ? 15 : 13,
                }}
              >
                {entry.rank <= 3
                  ? ["🥇", "🥈", "🥉"][entry.rank - 1]
                  : entry.rank}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {truncateWallet(entry.wallet)}
              </div>
              <div
                style={{
                  width: 100,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#eab308",
                }}
              >
                {entry.totalPoints.toLocaleString()}
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  page === 0 ? "transparent" : "rgba(255,255,255,0.05)",
                color:
                  page === 0
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor: page === 0 ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Prev
            </button>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Page {page + 1}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={leaderboard.length < pageSize}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  leaderboard.length < pageSize
                    ? "transparent"
                    : "rgba(255,255,255,0.05)",
                color:
                  leaderboard.length < pageSize
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor:
                  leaderboard.length < pageSize ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
