"use client";

import { FadeIn } from "@/lib/motion";
import type { ReactNode } from "react";

export function HeroAnimations({ children }: { children: ReactNode }) {
  return (
    <FadeIn onScroll={false} delay={0.1}>
      {children}
    </FadeIn>
  );
}
