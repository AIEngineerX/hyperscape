/**
 * AgentStatsDisplay - Shows agent HP bar and stats during fight
 */

import React from "react";
import type { AgentInfo } from "../../screens/StreamingMode";

interface AgentStatsDisplayProps {
  agent: AgentInfo;
  side: "left" | "right";
}

export function AgentStatsDisplay({ agent, side }: AgentStatsDisplayProps) {
  const hpPercent = Math.max(0, Math.min(100, (agent.hp / agent.maxHp) * 100));
  const isLow = hpPercent < 30;
  const isCritical = hpPercent < 15;

  // HP bar color based on health
  const hpColor = isCritical ? "#ff4444" : isLow ? "#ffaa00" : "#44cc44";

  return (
    <div
      style={{
        ...styles.container,
        flexDirection: side === "right" ? "row-reverse" : "row",
      }}
    >
      {/* Agent Info */}
      <div
        style={{
          ...styles.info,
          textAlign: side === "right" ? "right" : "left",
        }}
      >
        <div style={styles.name}>{agent.name}</div>
        <div style={styles.meta}>
          Lv {agent.combatLevel} | {agent.wins}W-{agent.losses}L
        </div>
      </div>

      {/* HP Bar */}
      <div style={styles.hpContainer}>
        <div style={styles.hpBarBg}>
          <div
            style={{
              ...styles.hpBarFill,
              width: `${hpPercent}%`,
              background: hpColor,
              boxShadow: `0 0 10px ${hpColor}`,
            }}
          />
        </div>
        <div style={styles.hpText}>
          {agent.hp} / {agent.maxHp}
        </div>
      </div>

      {/* Damage Dealt */}
      <div style={styles.damage}>
        <span style={styles.damageLabel}>DMG</span>
        <span style={styles.damageValue}>{agent.damageDealtThisFight}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    background: "rgba(0, 0, 0, 0.7)",
    padding: "12px 20px",
    borderRadius: "8px",
    border: "1px solid rgba(242, 208, 138, 0.3)",
    minWidth: "280px",
  },
  info: {
    flex: "0 0 auto",
  },
  name: {
    color: "#fff",
    fontSize: "1rem",
    fontWeight: "bold",
    marginBottom: "2px",
  },
  meta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: "0.75rem",
  },
  hpContainer: {
    flex: 1,
    minWidth: "120px",
  },
  hpBarBg: {
    height: "16px",
    background: "rgba(0, 0, 0, 0.5)",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.2)",
  },
  hpBarFill: {
    height: "100%",
    transition: "width 0.3s ease-out",
    borderRadius: "8px",
  },
  hpText: {
    color: "#fff",
    fontSize: "0.75rem",
    textAlign: "center",
    marginTop: "4px",
    fontFamily: "monospace",
  },
  damage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
  },
  damageLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.65rem",
    textTransform: "uppercase",
  },
  damageValue: {
    color: "#ff6b6b",
    fontSize: "1.1rem",
    fontWeight: "bold",
    fontFamily: "monospace",
  },
};
