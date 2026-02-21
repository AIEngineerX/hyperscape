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
  const isCritical = hpPercent < 20;

  // Fighting game style colors
  const hpColor = isCritical ? "#ff0d3c" : "#00ffcc";
  const isRight = side === "right";

  // Parse equipment to find what they're wearing if possible
  let equipCount = 0;
  if (agent.equipment && typeof agent.equipment === "object") {
    equipCount = Object.keys(agent.equipment).length;
  }

  return (
    <div
      style={{
        ...styles.container,
        alignItems: isRight ? "flex-end" : "flex-start",
      }}
    >
      {/* Top Meta Info Row */}
      <div
        style={{
          ...styles.metaRow,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div style={styles.nameBlock}>
          <span style={styles.rankBadge}>
            #{agent.rank > 0 ? agent.rank : "-"}
          </span>
          <span style={styles.name}>{agent.name}</span>
        </div>

        <div style={styles.statsBlock}>
          <span style={styles.statLabel}>OVR</span>
          <span style={styles.statValue}>
            {agent.wins}-{agent.losses}
          </span>
          <span style={styles.statDivider}>/</span>
          <span style={styles.statLabel}>H2H</span>
          <span style={styles.statValue}>
            {agent.headToHeadWins || 0}-{agent.headToHeadLosses || 0}
          </span>
        </div>
      </div>

      {/* HP Bar */}
      <div
        style={{
          ...styles.hpWrapper,
          flexDirection: isRight ? "row-reverse" : "row",
          borderTopRightRadius: isRight ? 0 : "12px",
          borderTopLeftRadius: isRight ? "12px" : 0,
          borderBottomRightRadius: isRight ? 0 : "4px",
          borderBottomLeftRadius: isRight ? "4px" : 0,
        }}
      >
        <div
          style={{
            ...styles.hpFill,
            width: `${hpPercent}%`,
            background: hpColor,
            marginLeft: isRight ? "auto" : 0,
            justifyContent: isRight ? "flex-start" : "flex-end",
          }}
        />
        <div
          style={{
            ...styles.hpTextAbs,
            [isRight ? "left" : "right"]: "12px",
          }}
        >
          {agent.hp}
        </div>
      </div>

      <div
        style={{
          ...styles.bottomSection,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        {/* DMG Block */}
        <div style={styles.dmgBlock}>
          <div style={styles.dmgValue}>{agent.damageDealtThisFight}</div>
          <div style={styles.dmgLabel}>DMG</div>
        </div>

        <div
          style={{
            ...styles.equipInfoBlock,
            flexDirection: isRight ? "row-reverse" : "row",
          }}
        >
          <div style={styles.equipCountText}>EQ: {equipCount}</div>
          {/* Inventory 14x2 Grid */}
          <div style={styles.inventoryGrid}>
            {Array.from({ length: 28 }).map((_, i) => {
              const hasItem =
                Array.isArray(agent.inventory) && agent.inventory[i];
              return (
                <div
                  key={i}
                  style={{
                    ...styles.invSlot,
                    background: hasItem ? "#f2d08a" : "rgba(255,255,255,0.05)",
                    boxShadow: hasItem ? "0 0 4px #ffcc00" : "none",
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    width: "480px",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    width: "100%",
    padding: "0 6px",
    fontFamily: "'Teko', 'Arial Black', sans-serif",
    textTransform: "uppercase",
  },
  nameBlock: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  rankBadge: {
    background: "#ff0d3c",
    color: "#fff",
    padding: "2px 8px",
    fontSize: "0.85rem",
    fontWeight: 900,
    transform: "skew(-15deg)",
    border: "1px solid #fff",
  },
  name: {
    color: "#fff",
    fontSize: "1.4rem",
    fontWeight: 900,
    letterSpacing: "1px",
    textShadow: "2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000",
  },
  statsBlock: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "rgba(0,0,0,0.7)",
    padding: "2px 10px",
    transform: "skew(-15deg)",
    border: "1px solid rgba(255,255,255,0.3)",
  },
  statLabel: {
    color: "#aaa",
    fontSize: "0.65rem",
    fontWeight: 800,
  },
  statValue: {
    color: "#f2d08a",
    fontSize: "0.9rem",
    fontWeight: 900,
  },
  statDivider: {
    color: "#555",
    fontSize: "0.8rem",
    margin: "0 4px",
  },
  hpWrapper: {
    width: "100%",
    height: "28px",
    background: "rgba(0, 0, 0, 0.8)",
    border: "2px solid #fff",
    padding: "2px",
    position: "relative",
    display: "flex",
    overflow: "hidden", // Fixes overflow!
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  hpFill: {
    height: "100%",
    transition: "width 0.15s ease-out, background 0.2s",
  },
  hpTextAbs: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#fff",
    fontSize: "1.2rem",
    fontWeight: 900,
    fontFamily: "monospace",
    textShadow:
      "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
  },
  bottomSection: {
    display: "flex",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: "4px",
    gap: "12px",
  },
  dmgBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.8)",
    border: "2px solid #ff0d3c",
    padding: "4px 16px",
    transform: "skew(-15deg)",
    minWidth: "80px",
    boxShadow: "0 0 10px rgba(255,13,60,0.3)",
  },
  dmgValue: {
    color: "#ff0d3c",
    fontSize: "1.6rem",
    fontWeight: 900,
    lineHeight: 1,
    textShadow: "0 0 8px rgba(255,13,60,0.6)",
  },
  dmgLabel: {
    color: "#fff",
    fontSize: "0.65rem",
    fontWeight: 800,
    letterSpacing: "2px",
    marginTop: "2px",
  },
  equipInfoBlock: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(0,0,0,0.6)",
    padding: "4px 8px",
    border: "1px solid rgba(255,255,255,0.2)",
    transform: "skew(-5deg)",
  },
  equipCountText: {
    color: "#ffcc00",
    fontSize: "0.8rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    background: "rgba(0,0,0,0.5)",
    padding: "2px 6px",
    border: "1px solid #ffcc00",
  },
  inventoryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(14, 1fr)",
    gridTemplateRows: "repeat(2, 1fr)",
    gap: "2px",
  },
  invSlot: {
    width: "12px",
    height: "12px",
    transition: "all 0.2s",
  },
};
