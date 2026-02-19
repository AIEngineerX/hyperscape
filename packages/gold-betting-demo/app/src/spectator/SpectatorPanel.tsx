import { useStreamingState } from "./useStreamingState";
import { AgentCard } from "./AgentCard";
import { Leaderboard } from "./Leaderboard";
import type { StreamingPhase } from "./types";

function phaseLabel(phase: StreamingPhase): string {
  switch (phase) {
    case "IDLE":
      return "Waiting for Agents";
    case "ANNOUNCEMENT":
      return "Next Match";
    case "COUNTDOWN":
      return "Starting";
    case "FIGHTING":
      return "LIVE";
    case "RESOLUTION":
      return "Result";
  }
}

function phaseColor(phase: StreamingPhase): string {
  switch (phase) {
    case "FIGHTING":
      return "#ef4444";
    case "COUNTDOWN":
      return "#eab308";
    case "ANNOUNCEMENT":
      return "#3b82f6";
    case "RESOLUTION":
      return "#22c55e";
    default:
      return "rgba(255,255,255,0.3)";
  }
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function SpectatorPanel() {
  const { state, isConnected } = useStreamingState();

  const cycle = state?.cycle;
  const phase = cycle?.phase ?? "IDLE";

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.6)",
        borderRadius: 16,
        padding: 20,
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            <span style={{ color: phaseColor(phase) }}>ARENA</span>{" "}
            <span style={{ color: "rgba(255,255,255,0.6)" }}>DUEL</span>
          </h2>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              background: phaseColor(phase),
              color: "#000",
              borderRadius: 4,
              padding: "2px 6px",
              fontWeight: 700,
            }}
          >
            {phaseLabel(phase)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isConnected ? "#22c55e" : "#ef4444",
            }}
          />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {cycle?.countdown != null && phase === "COUNTDOWN" && (
        <div
          style={{
            textAlign: "center",
            fontSize: 48,
            fontWeight: 900,
            color: "#eab308",
            margin: "20px 0",
          }}
        >
          {cycle.countdown}
        </div>
      )}

      {cycle?.timeRemaining != null &&
        phase !== "IDLE" &&
        phase !== "COUNTDOWN" && (
          <div
            style={{
              textAlign: "center",
              fontSize: 14,
              color: "rgba(255,255,255,0.5)",
              marginBottom: 12,
            }}
          >
            {formatTime(cycle.timeRemaining)} remaining
          </div>
        )}

      {cycle?.agent1 && cycle?.agent2 ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <AgentCard
            agent={cycle.agent1}
            side="left"
            isWinner={
              phase === "RESOLUTION" && cycle.winnerId === cycle.agent1.id
            }
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 20,
              fontWeight: 900,
              color: "rgba(255,255,255,0.2)",
            }}
          >
            VS
          </div>
          <AgentCard
            agent={cycle.agent2}
            side="right"
            isWinner={
              phase === "RESOLUTION" && cycle.winnerId === cycle.agent2.id
            }
          />
        </div>
      ) : (
        <div
          style={{
            textAlign: "center",
            padding: 32,
            color: "rgba(255,255,255,0.3)",
            fontSize: 13,
          }}
        >
          Waiting for agents to join...
        </div>
      )}

      {phase === "RESOLUTION" && cycle?.winnerName && (
        <div
          style={{
            textAlign: "center",
            padding: 12,
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>
            {cycle.winnerName} wins!
          </span>
          {cycle.winReason && (
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.4)",
                marginLeft: 8,
              }}
            >
              ({cycle.winReason})
            </span>
          )}
        </div>
      )}

      {state?.leaderboard && <Leaderboard entries={state.leaderboard} />}
    </div>
  );
}
