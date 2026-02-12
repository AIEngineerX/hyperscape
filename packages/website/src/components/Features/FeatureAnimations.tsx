"use client";

import { FadeIn } from "@/lib/motion";
import type { ReactNode } from "react";

export function FeatureAnimations({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <FadeIn delay={delay} className={className}>
      {children}
    </FadeIn>
  );
}
