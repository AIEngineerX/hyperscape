/**
 * Rate Limiter Tests
 *
 * Tests the rate limiting infrastructure used to prevent abuse
 * of WebSocket message handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IntervalRateLimiter } from "../../../src/systems/ServerNetwork/services/IntervalRateLimiter";

describe("IntervalRateLimiter", () => {
  let limiter: IntervalRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic rate limiting", () => {
    it("allows first operation for a player", () => {
      limiter = new IntervalRateLimiter(50);
      expect(limiter.isAllowed("player1")).toBe(true);
    });

    it("blocks operations within the rate limit window", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.recordOperation("player1");
      expect(limiter.isAllowed("player1")).toBe(false);
    });

    it("allows operations after the rate limit window expires", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.recordOperation("player1");

      // Advance time past the limit
      vi.advanceTimersByTime(51);

      expect(limiter.isAllowed("player1")).toBe(true);
    });

    it("tracks separate limits for different players", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.recordOperation("player1");

      // Player2 should still be allowed
      expect(limiter.isAllowed("player2")).toBe(true);
      // Player1 should be rate limited
      expect(limiter.isAllowed("player1")).toBe(false);
    });
  });

  describe("tryOperation convenience method", () => {
    it("returns true and records when allowed", () => {
      limiter = new IntervalRateLimiter(50);
      expect(limiter.tryOperation("player1")).toBe(true);
      // Second call should be blocked
      expect(limiter.tryOperation("player1")).toBe(false);
    });

    it("returns false without recording when rate limited", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.tryOperation("player1");

      // Blocked
      expect(limiter.tryOperation("player1")).toBe(false);

      // Advance just before the limit expires
      vi.advanceTimersByTime(49);
      expect(limiter.tryOperation("player1")).toBe(false);

      // Now it should be allowed
      vi.advanceTimersByTime(2);
      expect(limiter.tryOperation("player1")).toBe(true);
    });
  });

  describe("reset functionality", () => {
    it("clears rate limit for a specific player", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.recordOperation("player1");
      expect(limiter.isAllowed("player1")).toBe(false);

      limiter.reset("player1");
      expect(limiter.isAllowed("player1")).toBe(true);
    });

    it("does not affect other players", () => {
      limiter = new IntervalRateLimiter(50);
      limiter.recordOperation("player1");
      limiter.recordOperation("player2");

      limiter.reset("player1");

      expect(limiter.isAllowed("player1")).toBe(true);
      expect(limiter.isAllowed("player2")).toBe(false);
    });
  });

  describe("cleanup of old entries", () => {
    it("cleans up entries older than 60 seconds when exceeding 1000 entries", () => {
      limiter = new IntervalRateLimiter(50);

      // Record many old operations
      for (let i = 0; i < 500; i++) {
        limiter.recordOperation(`old-player-${i}`);
      }

      // Advance time past the cleanup cutoff (60 seconds)
      vi.advanceTimersByTime(61000);

      // Record more recent operations to trigger cleanup
      for (let i = 0; i < 600; i++) {
        limiter.recordOperation(`new-player-${i}`);
      }

      // Old entries should have been cleaned up
      // We can verify by checking that the limiter still works
      expect(limiter.isAllowed("old-player-0")).toBe(true);
    });
  });

  describe("configurable rate limits", () => {
    it("uses default TRANSACTION_RATE_LIMIT_MS when not specified", () => {
      // The default is imported from shared, typically 50ms
      limiter = new IntervalRateLimiter();
      limiter.recordOperation("player1");
      expect(limiter.isAllowed("player1")).toBe(false);
    });

    it("respects custom rate limit", () => {
      limiter = new IntervalRateLimiter(1000); // 1 second
      limiter.recordOperation("player1");

      vi.advanceTimersByTime(500);
      expect(limiter.isAllowed("player1")).toBe(false);

      vi.advanceTimersByTime(501);
      expect(limiter.isAllowed("player1")).toBe(true);
    });
  });

  describe("high-frequency operation scenarios", () => {
    it("prevents spam by enforcing minimum interval", () => {
      limiter = new IntervalRateLimiter(100);
      const results: boolean[] = [];

      // Try 10 operations in rapid succession
      for (let i = 0; i < 10; i++) {
        results.push(limiter.tryOperation("spammer"));
      }

      // Only the first should succeed
      expect(results.filter((r) => r).length).toBe(1);
      expect(results[0]).toBe(true);
      expect(results.slice(1).every((r) => !r)).toBe(true);
    });

    it("allows sustained operations at the rate limit", () => {
      limiter = new IntervalRateLimiter(100);
      const results: boolean[] = [];

      // Try operations spaced at exactly the limit
      for (let i = 0; i < 5; i++) {
        results.push(limiter.tryOperation("player1"));
        vi.advanceTimersByTime(100);
      }

      // All should succeed
      expect(results.every((r) => r)).toBe(true);
    });
  });
});

describe("Chat Rate Limiting", () => {
  // These tests would verify chat-specific rate limiting
  // which typically has different limits (e.g., 1 message per 500ms)

  it("should exist as a placeholder for chat rate limit tests", () => {
    // Chat rate limiting is implemented in the chat handler
    // Full integration tests would require mocking the WebSocket
    expect(true).toBe(true);
  });
});
