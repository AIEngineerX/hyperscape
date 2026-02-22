/**
 * CountdownOverlay - Big countdown display before fight
 *
 * Self-driven: receives fightStartTime (absolute timestamp) and
 * computes the remaining seconds locally via requestAnimationFrame.
 * Only triggers a React re-render when the displayed second changes.
 * Animation is re-triggered via DOM class toggle (no React remount).
 *
 * When the countdown reaches 0, shows "FIGHT!" with a scale-up + fade-out
 * animation. The parent keeps this component mounted for a linger period
 * (FIGHT_TEXT_LINGER_MS) so the text remains visible into the FIGHTING phase.
 */

import React, { useState, useEffect, useRef } from "react";

interface CountdownOverlayProps {
  fightStartTime: number;
}

export function CountdownOverlay({ fightStartTime }: CountdownOverlayProps) {
  const [displayCount, setDisplayCount] = useState(() =>
    Math.max(0, Math.ceil((fightStartTime - Date.now()) / 1000)),
  );
  const lastCountRef = useRef(displayCount);
  const rafRef = useRef(0);
  const countdownRef = useRef<HTMLDivElement>(null);

  // Track how long we've been showing "FIGHT!" for fade-out opacity
  const [fightProgress, setFightProgress] = useState(0);
  const fightStartRef = useRef<number | null>(null);

  useEffect(() => {
    lastCountRef.current = Math.max(
      0,
      Math.ceil((fightStartTime - Date.now()) / 1000),
    );
    setDisplayCount(lastCountRef.current);

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((fightStartTime - Date.now()) / 1000),
      );
      // Only update React state when the displayed second actually changes
      if (remaining !== lastCountRef.current) {
        lastCountRef.current = remaining;
        setDisplayCount(remaining);

        // Re-trigger CSS animation without React remount
        const el = countdownRef.current;
        if (el) {
          el.classList.remove("countdown-pulse");
          // Force reflow so browser registers the removal
          void el.offsetWidth;
          el.classList.add("countdown-pulse");
        }
      }

      // Once countdown is done, track elapsed time for fade-out
      if (remaining === 0) {
        if (!fightStartRef.current) {
          fightStartRef.current = Date.now();
        }
        const elapsed = Date.now() - fightStartRef.current;
        // Progress from 0→1 over 2.5 seconds for fade-out
        setFightProgress(Math.min(1, elapsed / 2500));
      }

      // Keep running even after countdown ends so the fade-out animates
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [fightStartTime]);

  const displayText = displayCount === 0 ? "FIGHT!" : displayCount.toString();
  const isFight = displayCount === 0;

  // Fade-out: starts fully opaque, fades to 0 over the linger period
  const fightOpacity = isFight ? 1 - fightProgress * 0.9 : 1;
  // Scale: starts at 1, scales up to 1.3 then back during fade
  const fightScale = isFight ? 1 + Math.sin(fightProgress * Math.PI) * 0.3 : 1;

  return (
    <div style={styles.container}>
      <div
        ref={countdownRef}
        className="countdown-pulse"
        style={{
          ...styles.countdown,
          color: isFight ? "#ff6b6b" : "#f2d08a",
          textShadow: isFight
            ? "0 0 40px rgba(255,107,107,0.8), 0 0 80px rgba(255,107,107,0.4)"
            : "0 0 40px rgba(242,208,138,0.8), 0 0 80px rgba(242,208,138,0.4)",
          opacity: fightOpacity,
          transform: `scale(${fightScale})`,
        }}
      >
        {displayText}
      </div>
      <style>
        {`
          .countdown-pulse {
            animation: pulse 0.5s ease-in-out;
          }

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
    transition: "opacity 0.1s ease-out",
  },
};
