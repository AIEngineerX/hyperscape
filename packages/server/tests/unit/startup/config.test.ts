/**
 * Config Module Tests
 *
 * Tests for CDN URL default logic in loadConfig()
 *
 * CDN URL resolution rules:
 * 1. If PUBLIC_CDN_URL is set, use that value (explicit override)
 * 2. If NODE_ENV === "production" and no PUBLIC_CDN_URL, default to https://assets.hyperscape.club
 * 3. If NODE_ENV !== "production" (development) and no PUBLIC_CDN_URL, default to http://localhost:${PORT}/game-assets
 */

import { describe, it, expect } from "vitest";

/**
 * Helper function that replicates the CDN URL default logic from config.ts
 * This allows us to test the logic in isolation without side effects from loadConfig()
 *
 * @param nodeEnv - NODE_ENV value
 * @param port - PORT value
 * @param publicCdnUrl - PUBLIC_CDN_URL value (optional)
 * @returns The resolved CDN URL
 */
function resolveCdnUrl(
  nodeEnv: string,
  port: number,
  publicCdnUrl?: string,
): string {
  // Replicate logic from config.ts lines 373-379
  const DEFAULT_CDN_URL =
    nodeEnv === "production"
      ? "https://assets.hyperscape.club"
      : `http://localhost:${port}/game-assets`;
  return publicCdnUrl || DEFAULT_CDN_URL;
}

describe("CDN_URL default logic", () => {
  describe("resolveCdnUrl helper (isolated logic)", () => {
    it("uses explicit PUBLIC_CDN_URL when provided (overrides everything)", () => {
      const customCdnUrl = "https://custom-cdn.example.com";

      // In production with explicit URL
      expect(resolveCdnUrl("production", 5555, customCdnUrl)).toBe(
        customCdnUrl,
      );

      // In development with explicit URL
      expect(resolveCdnUrl("development", 5555, customCdnUrl)).toBe(
        customCdnUrl,
      );

      // With custom port and explicit URL
      expect(resolveCdnUrl("development", 8080, customCdnUrl)).toBe(
        customCdnUrl,
      );
    });

    it("defaults to production CDN in production environment without PUBLIC_CDN_URL", () => {
      const result = resolveCdnUrl("production", 5555);
      expect(result).toBe("https://assets.hyperscape.club");
    });

    it("defaults to production CDN in production regardless of PORT", () => {
      // PORT should not affect production default
      expect(resolveCdnUrl("production", 3000)).toBe(
        "https://assets.hyperscape.club",
      );
      expect(resolveCdnUrl("production", 8080)).toBe(
        "https://assets.hyperscape.club",
      );
      expect(resolveCdnUrl("production", 5555)).toBe(
        "https://assets.hyperscape.club",
      );
    });

    it("defaults to localhost in development without PUBLIC_CDN_URL", () => {
      const result = resolveCdnUrl("development", 5555);
      expect(result).toBe("http://localhost:5555/game-assets");
    });

    it("uses custom PORT in development CDN URL", () => {
      expect(resolveCdnUrl("development", 3000)).toBe(
        "http://localhost:3000/game-assets",
      );
      expect(resolveCdnUrl("development", 8080)).toBe(
        "http://localhost:8080/game-assets",
      );
      expect(resolveCdnUrl("development", 9999)).toBe(
        "http://localhost:9999/game-assets",
      );
    });

    it("treats unset NODE_ENV as development (non-production)", () => {
      // When NODE_ENV is not "production", it defaults to development behavior
      expect(resolveCdnUrl("", 5555)).toBe("http://localhost:5555/game-assets");
      expect(resolveCdnUrl("test", 5555)).toBe(
        "http://localhost:5555/game-assets",
      );
      expect(resolveCdnUrl("staging", 5555)).toBe(
        "http://localhost:5555/game-assets",
      );
    });

    it("explicit PUBLIC_CDN_URL takes precedence over all environments", () => {
      const explicitUrl = "https://my-custom-assets.net";

      // Production
      expect(resolveCdnUrl("production", 5555, explicitUrl)).toBe(explicitUrl);

      // Development
      expect(resolveCdnUrl("development", 5555, explicitUrl)).toBe(explicitUrl);

      // Test
      expect(resolveCdnUrl("test", 5555, explicitUrl)).toBe(explicitUrl);

      // Empty/unset NODE_ENV
      expect(resolveCdnUrl("", 5555, explicitUrl)).toBe(explicitUrl);
    });
  });

  describe("edge cases", () => {
    it("handles empty string PUBLIC_CDN_URL as unset (falsy)", () => {
      // Empty string is falsy, so it should fall back to default
      expect(resolveCdnUrl("production", 5555, "")).toBe(
        "https://assets.hyperscape.club",
      );
      expect(resolveCdnUrl("development", 5555, "")).toBe(
        "http://localhost:5555/game-assets",
      );
    });

    it("preserves trailing slash in explicit PUBLIC_CDN_URL", () => {
      const urlWithSlash = "https://cdn.example.com/";
      expect(resolveCdnUrl("production", 5555, urlWithSlash)).toBe(
        urlWithSlash,
      );
    });

    it("works with non-standard ports", () => {
      expect(resolveCdnUrl("development", 1)).toBe(
        "http://localhost:1/game-assets",
      );
      expect(resolveCdnUrl("development", 65535)).toBe(
        "http://localhost:65535/game-assets",
      );
    });
  });
});
