/**
 * StreamingOverlay - Main overlay container for streaming mode
 *
 * Displays:
 * - Duel info panel (top center)
 * - Agent HP bars (bottom)
 * - Leaderboard (left side)
 * - Countdown timer
 * - Victory announcement
 */

import React from "react";
import type {
  StreamingState,
  AgentInfo,
  LeaderboardEntry,
} from "../../screens/StreamingMode";
import { DuelInfoPanel } from "./DuelInfoPanel";
import { AgentStatsDisplay } from "./AgentStatsDisplay";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { CountdownOverlay } from "./CountdownOverlay";
import { VictoryOverlay } from "./VictoryOverlay";

interface StreamingOverlayProps {
  state: StreamingState | null;
}

export function StreamingOverlay({ state }: StreamingOverlayProps) {
  if (!state) {
    return (
      <div style={styles.waitingContainer}>
        <div style={styles.waitingText}>Waiting for duel data...</div>
      </div>
    );
  }

  const { cycle, leaderboard } = state;
  const {
    phase,
    agent1,
    agent2,
    countdown,
    winnerId,
    winnerName,
    winReason,
    timeRemaining,
  } = cycle;

  // Get winner agent info
  const winnerAgent =
    winnerId === agent1?.id ? agent1 : winnerId === agent2?.id ? agent2 : null;

  return (
    <div style={styles.overlay}>
      {/* Duel Info - Top Center */}
      {(phase === "FIGHTING" || phase === "COUNTDOWN") && agent1 && agent2 && (
        <div style={styles.duelInfoContainer}>
          <AgentStatsDisplay agent={agent1} side="left" />
          <div style={styles.timerContainer}>
            <div style={styles.timer}>{formatTime(timeRemaining)}</div>
          </div>
          <AgentStatsDisplay agent={agent2} side="right" />
        </div>
      )}

      {/* Countdown Overlay */}
      {phase === "COUNTDOWN" && cycle.fightStartTime != null && (
        <CountdownOverlay fightStartTime={cycle.fightStartTime} />
      )}

      {/* Victory Overlay */}
      {phase === "RESOLUTION" && winnerAgent && (
        <VictoryOverlay
          winner={winnerAgent}
          winReason={winReason || "victory"}
        />
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getPhaseLabel(phase: string): string {
  switch (phase) {
    case "IDLE":
      return "Waiting for agents...";
    case "ANNOUNCEMENT":
      return "NEXT DUEL";
    case "COUNTDOWN":
      return "GET READY";
    case "FIGHTING":
      return "FIGHT!";
    case "RESOLUTION":
      return "WINNER";
    default:
      return "";
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: "none",
    zIndex: 50,
  },
  waitingContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 50,
  },
  waitingText: {
    color: "#f2d08a",
    fontSize: "1.5rem",
    textShadow: "0 2px 4px rgba(0,0,0,0.8)",
  },
  leaderboardContainer: {
    position: "absolute",
    top: "80px",
    left: "20px",
    pointerEvents: "auto",
  },
  duelInfoContainer: {
    position: "absolute",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    width: "1200px",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  statsContainer: {
    position: "absolute",
    bottom: "40px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "40px",
  },
  timerContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginTop: "16px",
  },
  timer: {
    color: "#fff",
    fontSize: "2rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    textShadow: "0 2px 4px rgba(0,0,0,0.8)",
    background: "rgba(0, 0, 0, 0.6)",
    padding: "8px 20px",
    borderRadius: "8px",
    border: "2px solid rgba(242, 208, 138, 0.5)",
  },
  phaseIndicator: {
    position: "absolute",
    top: "20px",
    right: "20px",
    color: "#f2d08a",
    fontSize: "0.9rem",
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "2px",
    textShadow: "0 2px 4px rgba(0,0,0,0.8)",
    background: "rgba(0, 0, 0, 0.6)",
    padding: "8px 16px",
    borderRadius: "4px",
  },
};
