"use client";

import { FadeIn } from "@/lib/motion";
import type { ReactNode } from "react";

export function CTAAnimations({ children }: { children: ReactNode }) {
  return <FadeIn>{children}</FadeIn>;
}
