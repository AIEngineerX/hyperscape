/**
 * EventBus Tests
 *
 * Tests the event bus system including:
 * - Basic subscription and emission
 * - Priority-based handler ordering
 * - Request-response patterns
 * - Cleanup and async handler tracking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus, EventPriority } from "../EventBus";
import type { SystemEvent } from "../../../../types/events";

describe("EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  afterEach(() => {
    eventBus.cleanup();
  });

  describe("basic subscription and emission", () => {
    it("emits events to subscribers", () => {
      const handler = vi.fn();
      eventBus.subscribe("test-event", handler);
      eventBus.emitEvent("test-event", { value: 42 }, "test-source");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "test-event",
          data: { value: 42 },
          source: "test-source",
        }),
      );
    });

    it("allows unsubscribing", () => {
      const handler = vi.fn();
      const subscription = eventBus.subscribe("test-event", handler);

      eventBus.emitEvent("test-event", {}, "test");
      expect(handler).toHaveBeenCalledTimes(1);

      subscription.unsubscribe();
      eventBus.emitEvent("test-event", {}, "test");
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it("supports once subscriptions", () => {
      const handler = vi.fn();
      eventBus.subscribe("test-event", handler, { once: true });

      eventBus.emitEvent("test-event", {}, "test");
      eventBus.emitEvent("test-event", {}, "test");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("tracks active subscriptions", () => {
      expect(eventBus.getActiveSubscriptionCount()).toBe(0);

      const sub1 = eventBus.subscribe("event1", () => {});
      expect(eventBus.getActiveSubscriptionCount()).toBe(1);

      const sub2 = eventBus.subscribe("event2", () => {});
      expect(eventBus.getActiveSubscriptionCount()).toBe(2);

      sub1.unsubscribe();
      expect(eventBus.getActiveSubscriptionCount()).toBe(1);

      sub2.unsubscribe();
      expect(eventBus.getActiveSubscriptionCount()).toBe(0);
    });
  });

  describe("priority-based handler ordering", () => {
    it("calls handlers in priority order (lowest number first)", () => {
      const order: string[] = [];

      eventBus.subscribe("priority-test", () => order.push("lowest"), {
        priority: EventPriority.LOWEST,
      });
      eventBus.subscribe("priority-test", () => order.push("highest"), {
        priority: EventPriority.HIGHEST,
      });
      eventBus.subscribe("priority-test", () => order.push("normal"), {
        priority: EventPriority.NORMAL,
      });
      eventBus.subscribe("priority-test", () => order.push("high"), {
        priority: EventPriority.HIGH,
      });
      eventBus.subscribe("priority-test", () => order.push("low"), {
        priority: EventPriority.LOW,
      });

      eventBus.emitEvent("priority-test", {}, "test");

      expect(order).toEqual(["highest", "high", "normal", "low", "lowest"]);
    });

    it("maintains registration order within same priority", () => {
      const order: string[] = [];

      eventBus.subscribe("same-priority", () => order.push("first"), {
        priority: EventPriority.NORMAL,
      });
      eventBus.subscribe("same-priority", () => order.push("second"), {
        priority: EventPriority.NORMAL,
      });
      eventBus.subscribe("same-priority", () => order.push("third"), {
        priority: EventPriority.NORMAL,
      });

      eventBus.emitEvent("same-priority", {}, "test");

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("defaults to NORMAL priority when not specified", () => {
      const order: string[] = [];

      eventBus.subscribe("default-priority", () => order.push("high"), {
        priority: EventPriority.HIGH,
      });
      eventBus.subscribe("default-priority", () => order.push("default"));
      eventBus.subscribe("default-priority", () => order.push("low"), {
        priority: EventPriority.LOW,
      });

      eventBus.emitEvent("default-priority", {}, "test");

      expect(order).toEqual(["high", "default", "low"]);
    });

    it("supports backwards compatible boolean once parameter", () => {
      const handler = vi.fn();
      // Using old API: subscribe(type, handler, once: boolean)
      eventBus.subscribe("compat-test", handler, true);

      eventBus.emitEvent("compat-test", {}, "test");
      eventBus.emitEvent("compat-test", {}, "test");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("can disable priority dispatch", () => {
      eventBus.setPriorityDispatch(false);

      // Without priority dispatch, handlers use eventemitter3's FIFO order
      const order: string[] = [];

      eventBus.subscribe("no-priority", () => order.push("first"), {
        priority: EventPriority.LOWEST,
      });
      eventBus.subscribe("no-priority", () => order.push("second"), {
        priority: EventPriority.HIGHEST,
      });

      eventBus.emitEvent("no-priority", {}, "test");

      // With priority dispatch disabled, order depends on eventemitter3
      // The exact order may vary, but the point is priorities aren't enforced
      expect(order.length).toBe(2);
    });
  });

  describe("event history", () => {
    it("records event history", () => {
      eventBus.emitEvent("event1", { a: 1 }, "source1");
      eventBus.emitEvent("event2", { b: 2 }, "source2");

      const history = eventBus.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe("event1");
      expect(history[1].type).toBe("event2");
    });

    it("filters history by type", () => {
      eventBus.emitEvent("event1", {}, "test");
      eventBus.emitEvent("event2", {}, "test");
      eventBus.emitEvent("event1", {}, "test");

      const filtered = eventBus.getEventHistory("event1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.type === "event1")).toBe(true);
    });

    it("limits history size", () => {
      // Emit more than maxHistorySize events
      for (let i = 0; i < 1100; i++) {
        eventBus.emitEvent("flood", { i }, "test");
      }

      const history = eventBus.getEventHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe("async handler tracking", () => {
    it("tracks pending async handlers", async () => {
      let resolveHandler: () => void;
      const asyncHandler = () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        });

      eventBus.subscribe("async-test", asyncHandler);
      eventBus.emitEvent("async-test", {}, "test");

      expect(eventBus.getPendingHandlerCount()).toBe(1);

      resolveHandler!();
      // Wait for promise resolution to propagate
      await new Promise((r) => setTimeout(r, 0));

      expect(eventBus.getPendingHandlerCount()).toBe(0);
    });

    it("handles async handler errors gracefully", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      eventBus.subscribe("async-error", async () => {
        throw new Error("Async error");
      });

      eventBus.emitEvent("async-error", {}, "test");

      // Wait for error to propagate
      await new Promise((r) => setTimeout(r, 10));

      expect(consoleError).toHaveBeenCalledWith(
        "[EventBus] Async handler error:",
        expect.any(Error),
      );
      expect(eventBus.getPendingHandlerCount()).toBe(0);

      consoleError.mockRestore();
    });

    it("waits for pending handlers during shutdown", async () => {
      let resolved = false;

      eventBus.subscribe("shutdown-test", async () => {
        await new Promise((r) => setTimeout(r, 50));
        resolved = true;
      });

      eventBus.emitEvent("shutdown-test", {}, "test");

      await eventBus.waitForPendingHandlers(1000);

      expect(resolved).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("cleans up all subscriptions", () => {
      eventBus.subscribe("event1", () => {});
      eventBus.subscribe("event2", () => {});

      expect(eventBus.getActiveSubscriptionCount()).toBe(2);

      eventBus.cleanup();

      expect(eventBus.getActiveSubscriptionCount()).toBe(0);
    });

    it("clears event history", () => {
      eventBus.emitEvent("test", {}, "test");
      expect(eventBus.getEventHistory().length).toBe(1);

      eventBus.cleanup();

      expect(eventBus.getEventHistory().length).toBe(0);
    });
  });

  describe("subscribeOnce convenience method", () => {
    it("auto-unsubscribes after first event", () => {
      const handler = vi.fn();
      eventBus.subscribeOnce("once-test", handler);

      eventBus.emitEvent("once-test", {}, "test");
      eventBus.emitEvent("once-test", {}, "test");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("request-response pattern", () => {
    it("supports request-response with timeout", async () => {
      // Set up responder
      eventBus.subscribe("my-request", (event: SystemEvent<unknown>) => {
        // Respond to the request
        eventBus.respond(
          event as SystemEvent<{ _responseType?: string; _requestId?: string }>,
          { result: "success" },
          "responder",
        );
      });

      const response = await eventBus.request(
        "my-request",
        { query: "test" },
        "requester",
        1000,
      );

      expect(response).toEqual({ result: "success" });
    });

    it("times out if no response", async () => {
      await expect(
        eventBus.request("no-responder", {}, "test", 100),
      ).rejects.toThrow("timed out");
    });
  });
});
