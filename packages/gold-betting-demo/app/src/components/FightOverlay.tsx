import React from "react";
import type { MockAgentContext } from "../lib/useMockStreamingEngine";
import type { StreamingPhase } from "../spectator/types";

interface FightOverlayProps {
  phase: StreamingPhase;
  agent1: MockAgentContext;
  agent2: MockAgentContext;
  countdown: number | null;
  timeRemaining: number;
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
}

function AgentHPBar({
  agent,
  side,
}: {
  agent: MockAgentContext;
  side: "left" | "right";
}) {
  const hpPercent = Math.max(0, Math.min(100, (agent.hp / agent.maxHp) * 100));
  const isCritical = hpPercent < 20;
  const hpColor = isCritical ? "#ff0d3c" : "#00ffcc";
  const isRight = side === "right";
  const equipCount = Object.keys(agent.equipment).length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "clamp(280px, 38vw, 480px)",
        alignItems: isRight ? "flex-end" : "flex-start",
      }}
    >
      {/* Name + stats row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          width: "100%",
          padding: "0 6px",
          fontFamily: "'Teko', 'Arial Black', sans-serif",
          textTransform: "uppercase",
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "#ff0d3c",
              color: "#fff",
              padding: "2px 8px",
              fontSize: "0.85rem",
              fontWeight: 900,
              transform: "skew(-15deg)",
              border: "1px solid #fff",
              display: "inline-block",
            }}
          >
            #{agent.rank > 0 ? agent.rank : "-"}
          </span>
          <span
            style={{
              color: "#fff",
              fontSize: "clamp(1rem, 2vw, 1.4rem)",
              fontWeight: 900,
              letterSpacing: 1,
              textShadow: "2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000",
            }}
          >
            {agent.name}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(0,0,0,0.7)",
            padding: "2px 10px",
            transform: "skew(-15deg)",
            border: "1px solid rgba(255,255,255,0.3)",
          }}
        >
          <span style={{ color: "#aaa", fontSize: "0.65rem", fontWeight: 800 }}>
            OVR
          </span>
          <span
            style={{ color: "#f2d08a", fontSize: "0.9rem", fontWeight: 900 }}
          >
            {agent.wins}-{agent.losses}
          </span>
          <span style={{ color: "#555", fontSize: "0.8rem", margin: "0 4px" }}>
            /
          </span>
          <span style={{ color: "#aaa", fontSize: "0.65rem", fontWeight: 800 }}>
            H2H
          </span>
          <span
            style={{ color: "#f2d08a", fontSize: "0.9rem", fontWeight: 900 }}
          >
            {agent.headToHeadWins}-{agent.headToHeadLosses}
          </span>
        </div>
      </div>

      {/* HP bar */}
      <div
        style={{
          width: "100%",
          height: 28,
          background: "rgba(0,0,0,0.8)",
          border: "2px solid #fff",
          padding: 2,
          position: "relative",
          display: "flex",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          borderTopRightRadius: isRight ? 0 : 12,
          borderTopLeftRadius: isRight ? 12 : 0,
          borderBottomRightRadius: isRight ? 0 : 4,
          borderBottomLeftRadius: isRight ? 4 : 0,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${hpPercent}%`,
            background: hpColor,
            transition: "width 0.15s ease-out, background 0.2s",
            marginLeft: isRight ? "auto" : 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            color: "#fff",
            fontSize: "1.2rem",
            fontWeight: 900,
            fontFamily: "monospace",
            textShadow:
              "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
            ...(isRight ? { left: 12 } : { right: 12 }),
          }}
        >
          {agent.hp}
        </div>
      </div>

      {/* Bottom: DMG + equipment + inventory */}
      <div
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginTop: 4,
          gap: 12,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            border: "2px solid #ff0d3c",
            padding: "4px 16px",
            transform: "skew(-15deg)",
            minWidth: 80,
            boxShadow: "0 0 10px rgba(255,13,60,0.3)",
          }}
        >
          <div
            style={{
              color: "#ff0d3c",
              fontSize: "1.6rem",
              fontWeight: 900,
              lineHeight: 1,
              textShadow: "0 0 8px rgba(255,13,60,0.6)",
            }}
          >
            {agent.damageDealtThisFight}
          </div>
          <div
            style={{
              color: "#fff",
              fontSize: "0.65rem",
              fontWeight: 800,
              letterSpacing: 2,
              marginTop: 2,
            }}
          >
            DMG
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0,0,0,0.6)",
            padding: "4px 8px",
            border: "1px solid rgba(255,255,255,0.2)",
            transform: "skew(-5deg)",
            flexDirection: isRight ? "row-reverse" : "row",
          }}
        >
          <div
            style={{
              color: "#ffcc00",
              fontSize: "0.8rem",
              fontWeight: "bold",
              fontFamily: "monospace",
              background: "rgba(0,0,0,0.5)",
              padding: "2px 6px",
              border: "1px solid #ffcc00",
            }}
          >
            EQ: {equipCount}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(14, 1fr)",
              gridTemplateRows: "repeat(2, 1fr)",
              gap: 2,
            }}
          >
            {Array.from({ length: 28 }).map((_, i) => {
              const hasItem = agent.inventory[i] !== undefined;
              return (
                <div
                  key={i}
                  style={{
                    width: 12,
                    height: 12,
                    background: hasItem ? "#f2d08a" : "rgba(255,255,255,0.05)",
                    boxShadow: hasItem ? "0 0 4px #ffcc00" : "none",
                    transition: "all 0.2s",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CountdownDisplay({ count }: { count: number }) {
  const displayText = count === 0 ? "FIGHT!" : count.toString();
  const isFight = count === 0;

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
      }}
    >
      <div
        key={count}
        style={{
          fontSize: "clamp(4rem, 12vw, 10rem)",
          fontWeight: "bold",
          fontFamily: "Impact, sans-serif",
          letterSpacing: -5,
          color: isFight ? "#ff6b6b" : "#f2d08a",
          textShadow: isFight
            ? "0 0 40px rgba(255,107,107,0.8), 0 0 80px rgba(255,107,107,0.4)"
            : "0 0 40px rgba(242,208,138,0.8), 0 0 80px rgba(242,208,138,0.4)",
          animation: "fightCountPulse 0.5s ease-in-out",
        }}
      >
        {displayText}
      </div>
    </div>
  );
}

function VictoryDisplay({
  winner,
  winReason,
}: {
  winner: MockAgentContext;
  winReason: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
        animation: "fightSlideIn 0.5s ease-out",
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 100%)",
          border: "3px solid #f2d08a",
          borderRadius: 16,
          padding: "40px 60px",
          textAlign: "center",
          animation: "fightGlow 2s ease-in-out infinite",
        }}
      >
        <div
          style={{
            color: "#f2d08a",
            fontSize: "1rem",
            fontWeight: "bold",
            letterSpacing: 8,
            marginBottom: 12,
          }}
        >
          VICTORY
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: "clamp(1.5rem, 4vw, 3rem)",
            fontWeight: "bold",
            marginBottom: 8,
            textShadow: "0 0 20px rgba(255,255,255,0.3)",
          }}
        >
          {winner.name}
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: "1.2rem",
            marginBottom: 24,
            fontStyle: "italic",
          }}
        >
          {winReason}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 24,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(242,208,138,0.2)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {winner.wins}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Wins
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 40,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {winner.losses}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Losses
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 40,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {Math.round(
                (winner.wins / Math.max(1, winner.wins + winner.losses)) * 100,
              )}
              %
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Win Rate
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FightOverlay({
  phase,
  agent1,
  agent2,
  countdown,
  timeRemaining,
  winnerId,
  winnerName,
  winReason,
}: FightOverlayProps) {
  const showHPBars = phase === "FIGHTING" || phase === "COUNTDOWN";
  const winnerAgent =
    winnerId === agent1.id ? agent1 : winnerId === agent2.id ? agent2 : null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 45,
      }}
    >
      {/* HP Bars across the top */}
      {showHPBars && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            width: "min(1200px, calc(100vw - 40px))",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <AgentHPBar agent={agent1} side="left" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 16,
            }}
          >
            <div
              style={{
                color: "#fff",
                fontSize: "clamp(1.2rem, 2.5vw, 2rem)",
                fontWeight: "bold",
                fontFamily: "monospace",
                textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                background: "rgba(0,0,0,0.6)",
                padding: "8px 20px",
                borderRadius: 8,
                border: "2px solid rgba(242,208,138,0.5)",
              }}
            >
              {formatTime(timeRemaining)}
            </div>
          </div>
          <AgentHPBar agent={agent2} side="right" />
        </div>
      )}

      {/* Countdown */}
      {phase === "COUNTDOWN" && countdown !== null && (
        <CountdownDisplay count={countdown} />
      )}

      {/* Victory */}
      {phase === "RESOLUTION" && winnerAgent && (
        <VictoryDisplay
          winner={winnerAgent}
          winReason={winReason || "victory"}
        />
      )}

      <style>{`
        @keyframes fightCountPulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fightGlow {
          0%, 100% { box-shadow: 0 0 30px rgba(242,208,138,0.3); }
          50% { box-shadow: 0 0 60px rgba(242,208,138,0.6); }
        }
        @keyframes fightSlideIn {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
