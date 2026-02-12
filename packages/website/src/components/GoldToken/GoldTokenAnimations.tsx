"use client";

import { FadeIn } from "@/lib/motion";
import type { ReactNode } from "react";

export function GoldFadeIn({
  children,
  delay = 0,
  className,
  direction = "up",
  onScroll = true,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  direction?: "up" | "down" | "left" | "right" | "none";
  onScroll?: boolean;
}) {
  return (
    <FadeIn
      delay={delay}
      className={className}
      direction={direction}
      onScroll={onScroll}
    >
      {children}
    </FadeIn>
  );
}
