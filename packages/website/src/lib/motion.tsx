"use client";

import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
}

type FadeInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  /** true = animate when scrolled into view, false = animate on mount */
  onScroll?: boolean;
};

const offsets = {
  up: { y: 24 },
  down: { y: -24 },
  left: { x: -24 },
  right: { x: 24 },
  none: {},
} as const;

export function FadeIn({
  children,
  className,
  delay = 0,
  direction = "up",
  onScroll = true,
}: FadeInProps) {
  const reducedMotion = useReducedMotion();
  const initial = { opacity: 0, ...offsets[direction] };
  const target = { opacity: 1, x: 0, y: 0 };
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.5, delay, ease: "easeOut" as const };

  if (onScroll) {
    return (
      <m.div
        className={className}
        initial={initial}
        whileInView={target}
        viewport={{ once: true, margin: "-50px" }}
        transition={transition}
      >
        {children}
      </m.div>
    );
  }

  return (
    <m.div
      className={className}
      initial={initial}
      animate={target}
      transition={transition}
    >
      {children}
    </m.div>
  );
}

export { m, AnimatePresence };
