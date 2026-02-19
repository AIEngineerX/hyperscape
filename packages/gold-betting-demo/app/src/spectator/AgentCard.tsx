import type { AgentInfo } from "./types";

function hpColor(pct: number): string {
  if (pct > 60) return "#22c55e";
  if (pct > 30) return "#eab308";
  return "#ef4444";
}

export function AgentCard({
  agent,
  side,
  isWinner,
}: {
  agent: AgentInfo;
  side: "left" | "right";
  isWinner?: boolean;
}) {
  const hpPct = agent.maxHp > 0 ? (agent.hp / agent.maxHp) * 100 : 0;
  const winRate =
    agent.wins + agent.losses > 0
      ? ((agent.wins / (agent.wins + agent.losses)) * 100).toFixed(0)
      : "0";

  return (
    <div
      style={{
        background: isWinner ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)",
        border: isWinner
          ? "1px solid rgba(34,197,94,0.4)"
          : "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
        textAlign: side === "right" ? "right" : "left",
        flex: 1,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#fff",
          marginBottom: 4,
        }}
      >
        {agent.name}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          marginBottom: 8,
        }}
      >
        {agent.provider} / {agent.model}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          marginBottom: 4,
        }}
      >
        Lv. {agent.combatLevel} | {agent.wins}W-{agent.losses}L ({winRate}%)
      </div>
      <div
        style={{
          height: 8,
          background: "rgba(255,255,255,0.05)",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${hpPct}%`,
            background: hpColor(hpPct),
            borderRadius: 4,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
        HP: {agent.hp}/{agent.maxHp} | Dmg: {agent.damageDealtThisFight}
      </div>
    </div>
  );
}
