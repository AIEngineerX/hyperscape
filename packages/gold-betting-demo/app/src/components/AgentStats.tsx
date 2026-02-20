import React from "react";

type StreamingInventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

type StreamingMonologue = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

type StreamingAgentContext = {
  id: string;
  name: string;
  provider: string;
  model: string;
  hp: number;
  maxHp: number;
  combatLevel: number;
  wins: number;
  losses: number;
  damageDealtThisFight: number;
  inventory: StreamingInventoryItem[];
  monologues: StreamingMonologue[];
};

interface AgentStatsProps {
  agent: StreamingAgentContext | null;
  side?: "left" | "right";
}

export function AgentStats({ agent, side = "left" }: AgentStatsProps) {
  if (!agent) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "32px 0",
          color: "rgba(255,255,255,0.3)",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Waiting for agent data...
      </div>
    );
  }

  const hpPercent = Math.max(0, Math.min(100, (agent.hp / agent.maxHp) * 100));
  const isLowHp = hpPercent < 25;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Header Info */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: "bold",
            border: `2px solid ${side === "left" ? "#3b82f6" : "#ef4444"}`,
          }}
        >
          {agent.name.charAt(0)}
        </div>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 900,
              letterSpacing: 0.5,
            }}
          >
            {agent.name}
          </h2>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.5)",
              marginTop: 2,
            }}
          >
            Level {agent.combatLevel} • {agent.provider} {agent.model}
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <StatBox
          label="WINS / LOSSES"
          value={`${agent.wins} / ${agent.losses}`}
        />
        <StatBox
          label="DMG DEALT"
          value={agent.damageDealtThisFight.toString()}
          valueColor="#ef4444"
        />
      </div>

      {/* Health Bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.5)" }}>HP</span>
          <span style={{ color: isLowHp ? "#ef4444" : "#fff" }}>
            {agent.hp} / {agent.maxHp}
          </span>
        </div>
        <div
          style={{
            height: 12,
            background: "rgba(255,255,255,0.1)",
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${hpPercent}%`,
              background: isLowHp ? "#ef4444" : "#22c55e",
              transition: "width 0.3s, background-color 0.3s",
              boxShadow: `0 0 10px ${isLowHp ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)"}`,
            }}
          />
        </div>
      </div>

      {/* Inventory */}
      <div>
        <h3
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "rgba(255,255,255,0.4)",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          Inventory
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
          }}
        >
          {Array.from({ length: 15 }).map((_, i) => {
            const item = agent.inventory.find((inv) => inv.slot === i);
            return (
              <div
                key={i}
                style={{
                  aspectRatio: "1",
                  background: item
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  color: "rgba(255,255,255,0.8)",
                  fontSize: 10,
                  textAlign: "center",
                  overflow: "hidden",
                }}
              >
                {item ? <span style={{ fontSize: 18 }}>📦</span> : null}
                {item && item.quantity > 1 && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 4,
                      fontSize: 10,
                      fontWeight: "bold",
                    }}
                  >
                    x{item.quantity}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Thoughts/Monologues */}
      {agent.monologues && agent.monologues.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 12,
            }}
          >
            Live Feed
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agent.monologues.slice(0, 3).map((mono) => (
              <div
                key={mono.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderLeft: `2px solid ${mono.type === "action" ? "#3b82f6" : "#eab308"}`,
                  padding: "8px 12px",
                  borderRadius: "0 8px 8px 0",
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    display: "block",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}
                >
                  {mono.type}
                </span>
                {mono.content}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  valueColor = "#fff",
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: "12px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color: valueColor }}>
        {value}
      </div>
    </div>
  );
}
