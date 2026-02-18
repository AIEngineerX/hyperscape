/**
 * Event Bus System
 *
 * Type-safe event bus for inter-system communication.
 * Provides subscription management, event history, and request-response patterns.
 *
 * Features:
 * - Type-safe event emission and subscription
 * - Automatic subscription cleanup
 * - Event history for debugging
 * - Request-response pattern with timeout
 * - Active subscription tracking
 */

import EventEmitter from "eventemitter3";
import { AnyEvent, EventPayloads, EventType } from "../../../types/events";
import type {
  SystemEvent,
  EventHandler,
  EventSubscription,
} from "../../../types/events";

// Types moved to shared event-system.ts

/**
 * Event handler priority levels.
 * Lower numbers = higher priority (called first).
 */
export enum EventPriority {
  /** Called first - for critical handlers that must run before others */
  HIGHEST = 0,
  /** High priority - for validation, security checks */
  HIGH = 25,
  /** Normal priority - default for most handlers */
  NORMAL = 50,
  /** Low priority - for logging, analytics */
  LOW = 75,
  /** Called last - for cleanup, monitoring */
  LOWEST = 100,
}

/**
 * Internal wrapper for prioritized handlers
 */
interface PrioritizedHandler {
  handler: (event: SystemEvent<AnyEvent>) => void | Promise<void>;
  priority: EventPriority;
  subscriptionId: string;
}

/**
 * Type-safe event bus for world-wide event communication
 */
export class EventBus extends EventEmitter {
  private subscriptionCounter = 0;
  private activeSubscriptions = new Map<string, EventSubscription>();
  private eventHistory: SystemEvent<AnyEvent>[] = [];
  private readonly maxHistorySize = 1000;

  /**
   * Track pending async handlers for graceful shutdown
   * Allows waiting for all async operations to complete before shutdown
   */
  private pendingAsyncHandlers: Set<Promise<unknown>> = new Set();

  /**
   * Priority-ordered handlers for each event type.
   * Using our own ordering instead of eventemitter3's to support priorities.
   */
  private prioritizedHandlers = new Map<string, PrioritizedHandler[]>();

  /**
   * Flag to track if we should use priority-based dispatch
   */
  private usePriorityDispatch = true;

  /**
   * Emit a typed event
   *
   * When usePriorityDispatch is enabled, handlers are called in priority order.
   * Otherwise, falls back to eventemitter3's default FIFO ordering.
   */
  emitEvent<T extends AnyEvent>(
    type: EventType | string,
    data: T,
    source: string = "unknown",
  ): void {
    const event: SystemEvent<T> = {
      type: type as EventType,
      data,
      source,
      timestamp: Date.now(),
      id: `${source}-${type}-${++this.subscriptionCounter}`,
    };

    // Add to history for debugging
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Use priority-based dispatch if enabled and handlers exist
    if (this.usePriorityDispatch) {
      const handlers = this.prioritizedHandlers.get(type as string);
      if (handlers && handlers.length > 0) {
        // Call handlers in priority order (already sorted)
        for (const { handler } of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error(`[EventBus] Handler error for ${type}:`, err);
          }
        }
        return;
      }
    }

    // Fall back to eventemitter3 for handlers without priority
    this.emit(type, event);
  }

  /**
   * Subscribe to typed events with automatic cleanup and optional priority.
   *
   * @param type - Event type to subscribe to
   * @param handler - Handler function
   * @param options - Subscription options (once, priority)
   */
  subscribe<K extends keyof EventPayloads>(
    type: K,
    handler: EventHandler<EventPayloads[K]>,
    options?: { once?: boolean; priority?: EventPriority },
  ): EventSubscription;
  subscribe<T extends AnyEvent>(
    type: string,
    handler: EventHandler<T>,
    options?: { once?: boolean; priority?: EventPriority },
  ): EventSubscription;
  // Backwards compatible overload for boolean once parameter
  subscribe<K extends keyof EventPayloads>(
    type: K,
    handler: EventHandler<EventPayloads[K]>,
    once?: boolean,
  ): EventSubscription;
  subscribe<T extends AnyEvent>(
    type: string,
    handler: EventHandler<T>,
    once?: boolean,
  ): EventSubscription;
  subscribe(
    type: string | keyof EventPayloads,
    handler: EventHandler<AnyEvent | EventPayloads[keyof EventPayloads]>,
    optionsOrOnce:
      | boolean
      | { once?: boolean; priority?: EventPriority } = false,
  ): EventSubscription {
    const subscriptionId = `sub-${++this.subscriptionCounter}`;
    let active = true;

    // Handle backwards compatibility
    const options =
      typeof optionsOrOnce === "boolean"
        ? { once: optionsOrOnce, priority: EventPriority.NORMAL }
        : {
            once: optionsOrOnce?.once ?? false,
            priority: optionsOrOnce?.priority ?? EventPriority.NORMAL,
          };

    const wrappedHandler = (
      event: SystemEvent<AnyEvent | EventPayloads[keyof EventPayloads]>,
    ) => {
      if (!active) return;

      const result = handler(event);

      // Handle async handlers - track for graceful shutdown
      if (result instanceof Promise) {
        this.pendingAsyncHandlers.add(result);
        result
          .catch((err) => {
            // Log error but don't crash - handlers should handle their own errors
            console.error("[EventBus] Async handler error:", err);
          })
          .finally(() => {
            this.pendingAsyncHandlers.delete(result);
          });
      }

      if (options.once) {
        subscription.unsubscribe();
      }
    };

    // Register with priority-based handler list
    const typeStr = type as string;
    if (!this.prioritizedHandlers.has(typeStr)) {
      this.prioritizedHandlers.set(typeStr, []);
    }

    const handlers = this.prioritizedHandlers.get(typeStr)!;
    const prioritizedHandler: PrioritizedHandler = {
      handler: wrappedHandler as (event: SystemEvent<AnyEvent>) => void,
      priority: options.priority,
      subscriptionId,
    };

    // Insert in sorted order by priority (lower number = higher priority)
    let insertIndex = handlers.length;
    for (let i = 0; i < handlers.length; i++) {
      if (handlers[i].priority > options.priority) {
        insertIndex = i;
        break;
      }
    }
    handlers.splice(insertIndex, 0, prioritizedHandler);

    // Also register with eventemitter3 for backwards compatibility
    if (options.once) {
      this.once(type, wrappedHandler);
    } else {
      this.on(type, wrappedHandler);
    }

    const subscription: EventSubscription = {
      unsubscribe: () => {
        if (!active) return;
        active = false;
        this.off(type, wrappedHandler);
        this.activeSubscriptions.delete(subscriptionId);

        // Also remove from prioritized handlers
        const priorityHandlers = this.prioritizedHandlers.get(typeStr);
        if (priorityHandlers) {
          const idx = priorityHandlers.findIndex(
            (h) => h.subscriptionId === subscriptionId,
          );
          if (idx !== -1) {
            priorityHandlers.splice(idx, 1);
          }
        }
      },
      get active() {
        return active;
      },
    };

    this.activeSubscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  /**
   * Subscribe to an event only once
   */
  subscribeOnce<K extends keyof EventPayloads>(
    type: K,
    handler: EventHandler<EventPayloads[K]>,
  ): EventSubscription;
  subscribeOnce<T extends AnyEvent>(
    type: string,
    handler: EventHandler<T>,
  ): EventSubscription;
  subscribeOnce(
    type: string | keyof EventPayloads,
    handler: EventHandler<AnyEvent | EventPayloads[keyof EventPayloads]>,
  ): EventSubscription {
    return this.subscribe(
      type as string,
      handler as EventHandler<AnyEvent>,
      true,
    );
  }

  /**
   * Request-response pattern with timeout
   */
  async request<
    TRequest extends AnyEvent = AnyEvent,
    TResponse extends AnyEvent = AnyEvent,
  >(
    requestType: string,
    data: TRequest,
    source: string,
    timeout: number = 5000,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const responseType = `${requestType}:response`;
      const requestId = `req-${++this.subscriptionCounter}`;

      const timeoutHandle = setTimeout(() => {
        subscription.unsubscribe();
        reject(
          new Error(`Request ${requestType} timed out after ${timeout}ms`),
        );
      }, timeout);

      const subscription = this.subscribeOnce<TResponse>(
        responseType,
        (event) => {
          clearTimeout(timeoutHandle);
          resolve(event.data);
        },
      );

      // Emit the request with response info
      this.emitEvent(
        requestType as EventType,
        {
          ...data,
          _requestId: requestId,
          _responseType: responseType,
        } as TRequest,
        source,
      );
    });
  }

  /**
   * Respond to a request
   */
  respond<T extends AnyEvent>(
    originalEvent: SystemEvent<{ _responseType?: string; _requestId?: string }>,
    responseData: T,
    source: string,
  ): void {
    if (!originalEvent.data._responseType || !originalEvent.data._requestId) {
      console.warn(
        "[EventBus] Attempted to respond to non-request event:",
        originalEvent,
      );
      return;
    }

    this.emitEvent(originalEvent.data._responseType, responseData, source);
  }

  /**
   * Get event history for debugging
   */
  getEventHistory(filterByType?: string): SystemEvent[] {
    if (filterByType) {
      return this.eventHistory.filter((event) => event.type === filterByType);
    }
    return [...this.eventHistory];
  }

  /**
   * Get active subscription count
   */
  getActiveSubscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  /**
   * Wait for all pending async handlers to complete
   *
   * Call this during graceful shutdown to ensure all async operations
   * (like database saves) complete before shutting down.
   *
   * @param timeout - Maximum time to wait in ms (default: 5000)
   * @returns Promise that resolves when all handlers complete or timeout
   */
  async waitForPendingHandlers(timeout: number = 5000): Promise<void> {
    if (this.pendingAsyncHandlers.size === 0) {
      return;
    }

    const pending = Array.from(this.pendingAsyncHandlers);
    console.log(
      `[EventBus] Waiting for ${pending.length} pending async handlers...`,
    );

    // Race between waiting for all handlers and timeout
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);

    if (this.pendingAsyncHandlers.size > 0) {
      console.warn(
        `[EventBus] ${this.pendingAsyncHandlers.size} handlers still pending after timeout`,
      );
    }
  }

  /**
   * Get count of pending async handlers (for debugging/monitoring)
   */
  getPendingHandlerCount(): number {
    return this.pendingAsyncHandlers.size;
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    this.activeSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    this.activeSubscriptions.clear();
    this.prioritizedHandlers.clear();
    this.eventHistory.length = 0;
    this.pendingAsyncHandlers.clear();
    this.removeAllListeners();
  }

  /**
   * Enable or disable priority-based event dispatch.
   * When disabled, falls back to eventemitter3's default FIFO ordering.
   */
  setPriorityDispatch(enabled: boolean): void {
    this.usePriorityDispatch = enabled;
  }
}

export type { SystemEvent, EventHandler, EventSubscription };
