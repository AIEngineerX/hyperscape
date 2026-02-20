import React, { useState } from "react";

interface TabsProps {
  tabs: { id: string; label: React.ReactNode }[];
  activeTab: string;
  onChange: (id: string) => void;
  style?: React.CSSProperties;
}

export function Tabs({ tabs, activeTab, onChange, style }: TabsProps) {
  return (
    <div
      style={{
        display: "flex",
        background: "rgba(0,0,0,0.4)",
        borderRadius: 12,
        padding: 4,
        gap: 4,
        border: "1px solid rgba(255,255,255,0.05)",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "8px 12px",
              background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
              color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
              border: isActive
                ? "1px solid rgba(255,255,255,0.1)"
                : "1px solid transparent",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: isActive ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
