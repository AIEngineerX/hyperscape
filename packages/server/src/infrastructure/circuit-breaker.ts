/**
 * CircuitBreaker — Protects against cascading failures from external dependencies.
 *
 * States:
 *   CLOSED  → normal operation, requests pass through
 *   OPEN    → dependency failing, requests short-circuited with fallback
 *   HALF_OPEN → testing recovery, limited requests allowed through
 *
 * Transitions:
 *   CLOSED → OPEN     when failureThreshold consecutive failures reached
 *   OPEN → HALF_OPEN  after resetTimeoutMs elapses
 *   HALF_OPEN → CLOSED when a probe request succeeds
 *   HALF_OPEN → OPEN   when a probe request fails
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Human-readable name for logging */
  name: string;
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Time to wait before attempting recovery (ms) */
  resetTimeoutMs: number;
  /** Optional callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreakerError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — dependency unavailable`);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute an operation through the circuit breaker.
   * @param operation - The async operation to protect
   * @param fallback - Optional fallback when circuit is open
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => T,
  ): Promise<T> {
    if (this.state === "OPEN") {
      // Check if enough time has passed to try recovery
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.transitionTo("HALF_OPEN");
      } else {
        if (fallback) return fallback();
        throw new CircuitBreakerError(this.config.name);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === "HALF_OPEN") {
      this.transitionTo("CLOSED");
    }
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // Probe failed, back to OPEN
      this.transitionTo("OPEN");
    } else if (
      this.state === "CLOSED" &&
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;
    this.state = newState;
    if (newState === "CLOSED") {
      this.consecutiveFailures = 0;
    }
    this.config.onStateChange?.(oldState, newState);
  }

  /** Current circuit state */
  getState(): CircuitState {
    return this.state;
  }

  /** Whether requests can pass through */
  isAvailable(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "HALF_OPEN") return true;
    // OPEN — check if recovery timeout has elapsed
    return Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs;
  }

  /** Reset the circuit breaker to CLOSED state */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.transitionTo("CLOSED");
  }

  /** Get diagnostic information */
  getStatus(): {
    name: string;
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureTime: number;
  } {
    return {
      name: this.config.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
