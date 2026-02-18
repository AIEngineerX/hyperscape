/**
 * LeaderboardPanel - Shows agent rankings
 */

import React from "react";
import type { LeaderboardEntry } from "../../screens/StreamingMode";

interface LeaderboardPanelProps {
  leaderboard: LeaderboardEntry[];
}

export function LeaderboardPanel({ leaderboard }: LeaderboardPanelProps) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>LEADERBOARD</span>
      </div>

      <div style={styles.list}>
        {leaderboard.length === 0 ? (
          <div style={styles.empty}>No agents yet</div>
        ) : (
          leaderboard.slice(0, 10).map((entry) => (
            <div key={entry.characterId} style={styles.entry}>
              <div style={styles.rank}>
                {entry.rank === 1 && "🥇"}
                {entry.rank === 2 && "🥈"}
                {entry.rank === 3 && "🥉"}
                {entry.rank > 3 && entry.rank}
              </div>
              <div style={styles.entryInfo}>
                <div style={styles.entryName}>{entry.name}</div>
                <div style={styles.entryMeta}>
                  <span style={styles.provider}>{entry.provider}</span>
                </div>
              </div>
              <div style={styles.entryStats}>
                <div style={styles.record}>
                  {entry.wins}-{entry.losses}
                </div>
                <div style={styles.winRate}>
                  {Math.round(entry.winRate * 100)}%
                </div>
              </div>
              {entry.currentStreak > 0 && (
                <div style={styles.streak}>🔥{entry.currentStreak}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "rgba(0, 0, 0, 0.85)",
    border: "2px solid rgba(242, 208, 138, 0.4)",
    borderRadius: "8px",
    width: "240px",
    overflow: "hidden",
  },
  header: {
    background: "rgba(242, 208, 138, 0.15)",
    padding: "10px 16px",
    borderBottom: "1px solid rgba(242, 208, 138, 0.3)",
  },
  title: {
    color: "#f2d08a",
    fontSize: "0.8rem",
    fontWeight: "bold",
    letterSpacing: "2px",
  },
  list: {
    maxHeight: "400px",
    overflowY: "auto",
  },
  entry: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  rank: {
    width: "24px",
    textAlign: "center",
    fontSize: "0.9rem",
    color: "rgba(255,255,255,0.7)",
  },
  entryInfo: {
    flex: 1,
    minWidth: 0,
  },
  entryName: {
    color: "#fff",
    fontSize: "0.85rem",
    fontWeight: "500",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  entryMeta: {
    fontSize: "0.7rem",
  },
  provider: {
    color: "rgba(255,255,255,0.4)",
    textTransform: "capitalize",
  },
  entryStats: {
    textAlign: "right",
  },
  record: {
    color: "#fff",
    fontSize: "0.8rem",
    fontWeight: "500",
  },
  winRate: {
    color: "#44cc44",
    fontSize: "0.7rem",
  },
  streak: {
    fontSize: "0.75rem",
    marginLeft: "4px",
  },
  empty: {
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    padding: "20px",
    fontSize: "0.85rem",
  },
};
