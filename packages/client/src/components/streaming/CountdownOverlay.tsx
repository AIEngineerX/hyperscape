/**
 * CountdownOverlay - Big countdown display before fight
 */

import React from "react";

interface CountdownOverlayProps {
  count: number;
}

export function CountdownOverlay({ count }: CountdownOverlayProps) {
  const displayText = count === 0 ? "FIGHT!" : count.toString();
  const isFight = count === 0;

  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.countdown,
          color: isFight ? "#ff6b6b" : "#f2d08a",
          textShadow: isFight
            ? "0 0 40px rgba(255,107,107,0.8), 0 0 80px rgba(255,107,107,0.4)"
            : "0 0 40px rgba(242,208,138,0.8), 0 0 80px rgba(242,208,138,0.4)",
          animation: "pulse 0.5s ease-in-out",
        }}
        key={count} // Re-trigger animation on change
      >
        {displayText}
      </div>
      <style>
        {`
          @keyframes pulse {
            0% { transform: scale(0.5); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
          }
        `}
      </style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 60,
  },
  countdown: {
    fontSize: "10rem",
    fontWeight: "bold",
    fontFamily: "Impact, sans-serif",
    letterSpacing: "-5px",
  },
};
