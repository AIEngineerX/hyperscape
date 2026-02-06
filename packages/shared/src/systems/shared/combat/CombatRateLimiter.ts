/** Prevents request flooding via per-tick and per-second limits */

import type { EntityID } from "../../../types/core/identifiers";
import { Logger } from "../../../utils/Logger";

export interface RateLimiterConfig {
  maxRequestsPerTick: number;
  maxRequestsPerSecond: number;
  cooldownTicks: number;
  logViolations: boolean;
}

interface PlayerRateState {
  tickRequests: number;
  lastTick: number;
  secondRequests: number;
  lastSecond: number;
  cooldownUntilTick: number;
  totalViolations: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "tick_limit" | "second_limit" | "cooldown";
  remainingThisTick: number;
  cooldownUntil: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerTick: 3,
  maxRequestsPerSecond: 5,
  cooldownTicks: 2,
  logViolations: true,
};

export class CombatRateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly playerStates = new Map<string, PlayerRateState>();

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  checkLimit(
    playerId: EntityID | string,
    currentTick: number,
  ): RateLimitResult {
    const playerIdStr = String(playerId);
    const state = this.getOrCreateState(playerIdStr);
    const currentSecond = Math.floor(Date.now() / 1000);

    if (state.cooldownUntilTick > currentTick) {
      return {
        allowed: false,
        reason: "cooldown",
        remainingThisTick: 0,
        cooldownUntil: state.cooldownUntilTick,
      };
    }

    if (state.lastTick !== currentTick) {
      state.tickRequests = 0;
      state.lastTick = currentTick;
    }

    if (state.lastSecond !== currentSecond) {
      state.secondRequests = 0;
      state.lastSecond = currentSecond;
    }

    if (state.tickRequests >= this.config.maxRequestsPerTick) {
      this.handleViolation(playerIdStr, state, currentTick, "tick_limit");
      return {
        allowed: false,
        reason: "tick_limit",
        remainingThisTick: 0,
        cooldownUntil: state.cooldownUntilTick,
      };
    }

    if (state.secondRequests >= this.config.maxRequestsPerSecond) {
      this.handleViolation(playerIdStr, state, currentTick, "second_limit");
      return {
        allowed: false,
        reason: "second_limit",
        remainingThisTick: 0,
        cooldownUntil: state.cooldownUntilTick,
      };
    }

    state.tickRequests++;
    state.secondRequests++;

    return {
      allowed: true,
      remainingThisTick: this.config.maxRequestsPerTick - state.tickRequests,
      cooldownUntil: 0,
    };
  }

  isAllowed(playerId: EntityID | string, currentTick: number): boolean {
    return this.checkLimit(playerId, currentTick).allowed;
  }

  getPlayerStats(
    playerId: EntityID | string,
    currentTick?: number,
  ): {
    tickRequests: number;
    secondRequests: number;
    totalViolations: number;
    inCooldown: boolean;
    cooldownUntil: number;
  } | null {
    const state = this.playerStates.get(String(playerId));
    if (!state) return null;

    const tick = currentTick ?? 0;
    return {
      tickRequests: state.tickRequests,
      secondRequests: state.secondRequests,
      totalViolations: state.totalViolations,
      inCooldown: state.cooldownUntilTick > tick,
      cooldownUntil: state.cooldownUntilTick,
    };
  }

  getStats(currentTick?: number): {
    trackedPlayers: number;
    playersInCooldown: number;
    totalViolationsAllTime: number;
  } {
    const tick = currentTick ?? 0;
    let playersInCooldown = 0;
    let totalViolationsAllTime = 0;

    for (const state of this.playerStates.values()) {
      if (state.cooldownUntilTick > tick) playersInCooldown++;
      totalViolationsAllTime += state.totalViolations;
    }

    return {
      trackedPlayers: this.playerStates.size,
      playersInCooldown,
      totalViolationsAllTime,
    };
  }

  cleanup(playerId: EntityID | string): void {
    this.playerStates.delete(String(playerId));
  }

  destroy(): void {
    this.playerStates.clear();
  }

  resetPlayer(playerId: EntityID | string): void {
    this.cleanup(playerId);
  }

  getConfig(): Readonly<RateLimiterConfig> {
    return this.config;
  }

  private getOrCreateState(playerId: string): PlayerRateState {
    let state = this.playerStates.get(playerId);
    if (!state) {
      state = {
        tickRequests: 0,
        lastTick: 0,
        secondRequests: 0,
        lastSecond: 0,
        cooldownUntilTick: 0,
        totalViolations: 0,
      };
      this.playerStates.set(playerId, state);
    }
    return state;
  }

  private handleViolation(
    playerId: string,
    state: PlayerRateState,
    currentTick: number,
    reason: "tick_limit" | "second_limit",
  ): void {
    state.totalViolations++;
    state.cooldownUntilTick = currentTick + this.config.cooldownTicks;

    if (this.config.logViolations) {
      Logger.systemWarn(
        "CombatRateLimiter",
        `Rate limit: ${playerId} ${reason} (${state.totalViolations})`,
      );
    }
  }
}
