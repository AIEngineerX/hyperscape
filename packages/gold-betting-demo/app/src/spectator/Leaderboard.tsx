import type { LeaderboardEntry } from "./types";

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: "rgba(255,255,255,0.4)",
          margin: "0 0 10px 0",
        }}
      >
        Top Agents
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.slice(0, 5).map((entry) => (
          <div
            key={entry.rank}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "rgba(255,255,255,0.3)",
                  width: 16,
                }}
              >
                {entry.rank}
              </span>
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>
                {entry.name}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontWeight: 600,
                }}
              >
                {entry.wins}W-{entry.losses}L
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#22c55e" }}>
                {entry.winRate.toFixed(0)}%
              </span>
              {entry.currentStreak > 1 && (
                <span
                  style={{ fontSize: 10, color: "#eab308", fontWeight: 700 }}
                >
                  {entry.currentStreak}🔥
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
