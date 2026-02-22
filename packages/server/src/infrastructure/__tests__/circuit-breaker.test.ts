import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitState,
} from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      resetTimeoutMs: 5000,
    });
  });

  describe("initial state", () => {
    it("starts CLOSED", () => {
      expect(cb.getState()).toBe("CLOSED");
    });

    it("is available", () => {
      expect(cb.isAvailable()).toBe(true);
    });
  });

  describe("CLOSED state", () => {
    it("passes successful requests through", async () => {
      const result = await cb.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
      expect(cb.getState()).toBe("CLOSED");
    });

    it("stays CLOSED on fewer failures than threshold", async () => {
      for (let i = 0; i < 2; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow("fail");
      }
      expect(cb.getState()).toBe("CLOSED");
    });

    it("resets failure count on success", async () => {
      // 2 failures
      for (let i = 0; i < 2; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
      // 1 success resets count
      await cb.execute(() => Promise.resolve("ok"));
      // 2 more failures should not open (count was reset)
      for (let i = 0; i < 2; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
      expect(cb.getState()).toBe("CLOSED");
    });
  });

  describe("CLOSED → OPEN transition", () => {
    it("opens after failureThreshold consecutive failures", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow("fail");
      }
      expect(cb.getState()).toBe("OPEN");
    });

    it("fires onStateChange callback", async () => {
      const changes: Array<{ from: CircuitState; to: CircuitState }> = [];
      const cbWithListener = new CircuitBreaker({
        name: "test",
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        onStateChange: (from, to) => changes.push({ from, to }),
      });

      for (let i = 0; i < 2; i++) {
        await expect(
          cbWithListener.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
      expect(changes).toEqual([{ from: "CLOSED", to: "OPEN" }]);
    });
  });

  describe("OPEN state", () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
    });

    it("short-circuits with CircuitBreakerError", async () => {
      await expect(
        cb.execute(() => Promise.resolve("should not run")),
      ).rejects.toThrow(CircuitBreakerError);
    });

    it("returns fallback when provided", async () => {
      const result = await cb.execute(
        () => Promise.resolve("should not run"),
        () => "fallback-value",
      );
      expect(result).toBe("fallback-value");
    });

    it("does not call operation when open", async () => {
      const operation = vi.fn().mockResolvedValue("result");
      await expect(cb.execute(operation)).rejects.toThrow(CircuitBreakerError);
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe("OPEN → HALF_OPEN transition (after timeout)", () => {
    it("transitions to HALF_OPEN after resetTimeout", async () => {
      const fastCb = new CircuitBreaker({
        name: "fast",
        failureThreshold: 1,
        resetTimeoutMs: 10,
      });

      // Trip the circuit
      await expect(
        fastCb.execute(() => Promise.reject(new Error("fail"))),
      ).rejects.toThrow();
      expect(fastCb.getState()).toBe("OPEN");

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 15));

      // Next call should probe (HALF_OPEN)
      await fastCb.execute(() => Promise.resolve("recovered"));
      expect(fastCb.getState()).toBe("CLOSED");
    });
  });

  describe("HALF_OPEN state", () => {
    it("HALF_OPEN → CLOSED on success", async () => {
      const fastCb = new CircuitBreaker({
        name: "fast",
        failureThreshold: 1,
        resetTimeoutMs: 10,
      });

      // Trip the circuit
      await expect(
        fastCb.execute(() => Promise.reject(new Error("fail"))),
      ).rejects.toThrow();

      await new Promise((r) => setTimeout(r, 15));

      // Successful probe closes circuit
      await fastCb.execute(() => Promise.resolve("ok"));
      expect(fastCb.getState()).toBe("CLOSED");
    });

    it("HALF_OPEN → OPEN on failure", async () => {
      const fastCb = new CircuitBreaker({
        name: "fast",
        failureThreshold: 1,
        resetTimeoutMs: 10,
      });

      // Trip the circuit
      await expect(
        fastCb.execute(() => Promise.reject(new Error("fail"))),
      ).rejects.toThrow();

      await new Promise((r) => setTimeout(r, 15));

      // Failed probe re-opens circuit
      await expect(
        fastCb.execute(() => Promise.reject(new Error("still failing"))),
      ).rejects.toThrow();
      expect(fastCb.getState()).toBe("OPEN");
    });
  });

  describe("reset", () => {
    it("resets to CLOSED from OPEN", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
      expect(cb.getState()).toBe("OPEN");

      cb.reset();
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.isAvailable()).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("returns diagnostic info", async () => {
      const status = cb.getStatus();
      expect(status.name).toBe("test");
      expect(status.state).toBe("CLOSED");
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastFailureTime).toBe(0);
    });

    it("reflects failure state", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error("fail"))),
        ).rejects.toThrow();
      }
      const status = cb.getStatus();
      expect(status.state).toBe("OPEN");
      expect(status.consecutiveFailures).toBe(3);
      expect(status.lastFailureTime).toBeGreaterThan(0);
    });
  });
});
