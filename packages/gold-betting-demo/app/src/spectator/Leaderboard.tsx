import type { LeaderboardEntry } from "./types";

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: "rgba(255,255,255,0.4)",
          marginBottom: 12,
          marginTop: 0,
        }}
      >
        Leaderboard
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.slice(0, 10).map((entry) => (
          <div
            key={entry.rank}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.3)",
                  width: 20,
                }}
              >
                #{entry.rank}
              </span>
              <span style={{ fontSize: 12, color: "#fff" }}>{entry.name}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                {entry.wins}W-{entry.losses}L
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e" }}>
                {entry.winRate.toFixed(0)}%
              </span>
              {entry.currentStreak > 1 && (
                <span style={{ fontSize: 10, color: "#eab308" }}>
                  {entry.currentStreak} streak
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
