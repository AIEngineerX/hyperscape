/**
 * CountdownOverlay - Big countdown display before fight
 *
 * Self-driven: receives fightStartTime (absolute timestamp) and
 * computes the remaining seconds locally via 100ms polling.
 */

import React, { useState, useEffect } from "react";

interface CountdownOverlayProps {
  fightStartTime: number;
}

export function CountdownOverlay({ fightStartTime }: CountdownOverlayProps) {
  const [displayCount, setDisplayCount] = useState(() =>
    Math.max(0, Math.ceil((fightStartTime - Date.now()) / 1000)),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((fightStartTime - Date.now()) / 1000),
      );
      setDisplayCount(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [fightStartTime]);

  const displayText = displayCount === 0 ? "FIGHT!" : displayCount.toString();
  const isFight = displayCount === 0;

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
        key={displayCount} // Re-trigger animation on change
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
