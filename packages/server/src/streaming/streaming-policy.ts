/**
 * Canonical stream timing policy for anti-cheat public surfaces.
 *
 * Defaults are opinionated for production safety:
 * - Canonical platform: YouTube
 * - Public data delay: 15 seconds (unless explicitly overridden)
 */

export type StreamingCanonicalPlatform = "youtube" | "twitch";

const DEFAULT_DELAY_BY_PLATFORM_MS: Record<StreamingCanonicalPlatform, number> =
  {
    youtube: 15000,
    twitch: 12000,
  };

function parseCanonicalPlatform(
  raw: string | undefined,
): StreamingCanonicalPlatform {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "twitch") return "twitch";
  return "youtube";
}

function parseDelayOverride(raw: string | undefined): number | null {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export const STREAMING_CANONICAL_PLATFORM: StreamingCanonicalPlatform =
  parseCanonicalPlatform(process.env.STREAMING_CANONICAL_PLATFORM);

export const STREAMING_PUBLIC_DELAY_DEFAULT_MS =
  DEFAULT_DELAY_BY_PLATFORM_MS[STREAMING_CANONICAL_PLATFORM];

const STREAMING_PUBLIC_DELAY_OVERRIDE_MS = parseDelayOverride(
  process.env.STREAMING_PUBLIC_DELAY_MS,
);

export const STREAMING_PUBLIC_DELAY_OVERRIDDEN =
  STREAMING_PUBLIC_DELAY_OVERRIDE_MS !== null;

export const STREAMING_PUBLIC_DELAY_MS =
  STREAMING_PUBLIC_DELAY_OVERRIDE_MS ?? STREAMING_PUBLIC_DELAY_DEFAULT_MS;
