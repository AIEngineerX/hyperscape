import React, { useState } from "react";

interface SidebarProps {
  side: "left" | "right";
  children: React.ReactNode;
  width?: number;
  defaultExpanded?: boolean;
}

export function Sidebar({
  side,
  children,
  width = 420,
  defaultExpanded = true,
}: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div
      style={{
        position: "relative",
        width: isExpanded ? width : 48,
        height: "100%",
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        zIndex: 10,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: side === "left" ? 0 : "auto",
          right: side === "right" ? 0 : "auto",
          width: width,
          background: "rgba(0,0,0,0.65)",
          borderRight:
            side === "left" ? "1px solid rgba(255,255,255,0.08)" : "none",
          borderLeft:
            side === "right" ? "1px solid rgba(255,255,255,0.08)" : "none",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          transform: `translateX(${isExpanded ? 0 : side === "left" ? "-100%" : "100%"})`,
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 24,
            paddingBottom: 100,
          }}
        >
          {children}
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
          left: side === "left" ? (isExpanded ? width : 0) : "auto",
          right: side === "right" ? (isExpanded ? width : 0) : "auto",
          background: "rgba(0,0,0,0.8)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderLeftColor:
            side === "right" && !isExpanded
              ? "rgba(255,255,255,0.1)"
              : "transparent",
          borderRightColor:
            side === "left" && !isExpanded
              ? "rgba(255,255,255,0.1)"
              : "transparent",
          width: 24,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "rgba(255,255,255,0.5)",
          borderTopRightRadius: side === "left" ? 8 : 0,
          borderBottomRightRadius: side === "left" ? 8 : 0,
          borderTopLeftRadius: side === "right" ? 8 : 0,
          borderBottomLeftRadius: side === "right" ? 8 : 0,
          transition: "all 0.2s",
          zIndex: 11,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "rgba(255,255,255,0.5)")
        }
      >
        {side === "left" ? (isExpanded ? "◀" : "▶") : isExpanded ? "▶" : "◀"}
      </button>
    </div>
  );
}
