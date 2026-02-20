/**
 * ChainSelector — Dropdown to pick active chain (Solana / BSC / Base).
 */

import { useChain } from "../lib/ChainContext";
import { CHAIN_DISPLAY, type ChainId } from "../lib/chainConfig";

export function ChainSelector() {
  const { activeChain, setActiveChain, availableChains } = useChain();

  if (availableChains.length <= 1) {
    // Only one chain available — no dropdown needed
    const display = CHAIN_DISPLAY[activeChain];
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 44,
          padding: "0 16px",
          background: "rgba(0,0,0,0.4)",
          border: `1px solid ${display.color}44`,
          borderRadius: 12,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        <span>{display.icon}</span>
        <span>{display.shortName}</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <select
        id="chain-selector"
        value={activeChain}
        onChange={(e) => setActiveChain(e.target.value as ChainId)}
        style={{
          height: 44,
          minWidth: 92,
          padding: "0 36px 0 16px",
          background: "rgba(0,0,0,0.65)",
          border: `1px solid ${CHAIN_DISPLAY[activeChain].color}55`,
          borderRadius: 12,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          outline: "none",
          appearance: "none",
          fontFamily: "inherit",
          backdropFilter: "blur(12px)",
          transition: "border-color 0.2s",
        }}
      >
        {availableChains.map((chain) => {
          const display = CHAIN_DISPLAY[chain];
          return (
            <option key={chain} value={chain} style={{ background: "#111" }}>
              {display.icon} {display.shortName}
            </option>
          );
        })}
      </select>
      {/* Dropdown arrow */}
      <div
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "rgba(255,255,255,0.5)",
          fontSize: 10,
        }}
      >
        ▼
      </div>
    </div>
  );
}
