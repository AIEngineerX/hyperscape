/**
 * Configuration Module Tests
 *
 * Tests for database connection strategy logic (USE_LOCAL_POSTGRES defaults).
 */

import { describe, it, expect } from "vitest";
import { shouldUseLocalPostgres } from "../config";

describe("shouldUseLocalPostgres", () => {
  describe("explicit USE_LOCAL_POSTGRES override", () => {
    it("returns true when USE_LOCAL_POSTGRES=true (overrides everything)", () => {
      // Production with DATABASE_URL, but explicit override
      expect(
        shouldUseLocalPostgres("true", "production", "postgresql://prod.db"),
      ).toBe(true);

      // Development with DATABASE_URL, but explicit override
      expect(
        shouldUseLocalPostgres("true", "development", "postgresql://dev.db"),
      ).toBe(true);

      // Development without DATABASE_URL (would be true anyway, but explicit)
      expect(shouldUseLocalPostgres("true", "development", undefined)).toBe(
        true,
      );
    });

    it("returns false when USE_LOCAL_POSTGRES=false (overrides everything)", () => {
      // Development without DATABASE_URL (would default to true, but explicit false)
      expect(shouldUseLocalPostgres("false", "development", undefined)).toBe(
        false,
      );

      // Production (would be false anyway, but explicit)
      expect(
        shouldUseLocalPostgres("false", "production", "postgresql://prod.db"),
      ).toBe(false);
    });
  });

  describe("production environment defaults", () => {
    it("returns false in production without DATABASE_URL", () => {
      expect(shouldUseLocalPostgres(undefined, "production", undefined)).toBe(
        false,
      );
    });

    it("returns false in production with DATABASE_URL", () => {
      expect(
        shouldUseLocalPostgres(undefined, "production", "postgresql://prod.db"),
      ).toBe(false);
    });
  });

  describe("development environment defaults", () => {
    it("returns true in development without DATABASE_URL", () => {
      expect(shouldUseLocalPostgres(undefined, "development", undefined)).toBe(
        true,
      );
    });

    it("returns false in development with DATABASE_URL", () => {
      expect(
        shouldUseLocalPostgres(undefined, "development", "postgresql://dev.db"),
      ).toBe(false);
    });
  });

  describe("other environments", () => {
    it("returns true in test environment without DATABASE_URL", () => {
      expect(shouldUseLocalPostgres(undefined, "test", undefined)).toBe(true);
    });

    it("returns false in test environment with DATABASE_URL", () => {
      expect(
        shouldUseLocalPostgres(undefined, "test", "postgresql://test.db"),
      ).toBe(false);
    });

    it("returns true with empty NODE_ENV (defaults to non-production behavior)", () => {
      // Empty string is treated as non-production
      expect(shouldUseLocalPostgres(undefined, "", undefined)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("treats empty string DATABASE_URL as falsy", () => {
      // Empty DATABASE_URL should behave like undefined
      expect(shouldUseLocalPostgres(undefined, "development", "")).toBe(true);
    });

    it("handles USE_LOCAL_POSTGRES with various truthy string values", () => {
      // Only exact "true" string should return true
      expect(shouldUseLocalPostgres("TRUE", "development", undefined)).toBe(
        false,
      );
      expect(shouldUseLocalPostgres("1", "development", undefined)).toBe(false);
      expect(shouldUseLocalPostgres("yes", "development", undefined)).toBe(
        false,
      );
      expect(shouldUseLocalPostgres("true", "development", undefined)).toBe(
        true,
      );
    });
  });
});
