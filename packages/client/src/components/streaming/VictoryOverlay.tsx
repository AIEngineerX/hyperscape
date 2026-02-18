/**
 * VictoryOverlay - Displays winner announcement
 */

import React from "react";
import type { AgentInfo } from "../../screens/StreamingMode";

interface VictoryOverlayProps {
  winner: AgentInfo;
  winReason: string;
}

export function VictoryOverlay({ winner, winReason }: VictoryOverlayProps) {
  const reasonText = getReasonText(winReason);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.victoryLabel}>VICTORY</div>
        <div style={styles.winnerName}>{winner.name}</div>
        <div style={styles.reason}>{reasonText}</div>
        <div style={styles.stats}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{winner.wins}</span>
            <span style={styles.statLabel}>Wins</span>
          </div>
          <div style={styles.divider} />
          <div style={styles.statItem}>
            <span style={styles.statValue}>{winner.losses}</span>
            <span style={styles.statLabel}>Losses</span>
          </div>
          <div style={styles.divider} />
          <div style={styles.statItem}>
            <span style={styles.statValue}>
              {Math.round(
                (winner.wins / Math.max(1, winner.wins + winner.losses)) * 100,
              )}
              %
            </span>
            <span style={styles.statLabel}>Win Rate</span>
          </div>
        </div>
      </div>

      {/* Animated background effect */}
      <style>
        {`
          @keyframes glow {
            0%, 100% { box-shadow: 0 0 30px rgba(242, 208, 138, 0.3); }
            50% { box-shadow: 0 0 60px rgba(242, 208, 138, 0.6); }
          }
          @keyframes slideIn {
            0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
            100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          }
        `}
      </style>
    </div>
  );
}

function getReasonText(reason: string): string {
  switch (reason) {
    case "kill":
      return "by Knockout";
    case "hp_advantage":
      return "by HP Advantage";
    case "damage_advantage":
      return "by Damage Dealt";
    case "draw":
      return "by Decision";
    default:
      return "";
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 60,
    animation: "slideIn 0.5s ease-out",
  },
  content: {
    background:
      "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 100%)",
    border: "3px solid #f2d08a",
    borderRadius: "16px",
    padding: "40px 60px",
    textAlign: "center",
    animation: "glow 2s ease-in-out infinite",
  },
  victoryLabel: {
    color: "#f2d08a",
    fontSize: "1rem",
    fontWeight: "bold",
    letterSpacing: "8px",
    marginBottom: "12px",
  },
  winnerName: {
    color: "#fff",
    fontSize: "3rem",
    fontWeight: "bold",
    marginBottom: "8px",
    textShadow: "0 0 20px rgba(255,255,255,0.3)",
  },
  reason: {
    color: "rgba(255,255,255,0.7)",
    fontSize: "1.2rem",
    marginBottom: "24px",
    fontStyle: "italic",
  },
  stats: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "24px",
    marginTop: "16px",
    paddingTop: "16px",
    borderTop: "1px solid rgba(242, 208, 138, 0.2)",
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  },
  statValue: {
    color: "#fff",
    fontSize: "1.5rem",
    fontWeight: "bold",
  },
  statLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  divider: {
    width: "1px",
    height: "40px",
    background: "rgba(255,255,255,0.2)",
  },
};
