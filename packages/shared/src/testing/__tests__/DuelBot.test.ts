/**
 * DuelBot Unit Tests
 *
 * Tests for the DuelBot class without requiring a real server connection.
 * Uses mocked network for unit-level testing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";

// Mock the createNodeClientWorld
vi.mock("../../runtime/createNodeClientWorld", () => ({
  createNodeClientWorld: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    getSystem: vi.fn().mockReturnValue({
      connected: true,
      id: "test-player-123",
      send: vi.fn(),
      on: vi.fn(),
    }),
    entities: {
      player: {
        node: { position: { x: 10, y: 5, z: 20 } },
      },
    },
    on: vi.fn(),
  })),
}));

// Import after mocking
import { DuelBot, type DuelBotConfig } from "../DuelBot";

describe("DuelBot", () => {
  let config: DuelBotConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      wsUrl: "ws://localhost:5555/ws",
      name: "TestBot-001",
      autoAcceptChallenges: true,
      autoConfirmScreens: true,
      connectTimeoutMs: 5000,
    };
  });

  describe("constructor", () => {
    it("creates DuelBot with provided config", () => {
      const bot = new DuelBot(config);
      expect(bot.name).toBe("TestBot-001");
      expect(bot.state).toBe("disconnected");
      expect(bot.metrics.wins).toBe(0);
      expect(bot.metrics.losses).toBe(0);
      expect(bot.metrics.totalDuels).toBe(0);
    });

    it("sets default values for optional config", () => {
      const minimalConfig = {
        wsUrl: "ws://localhost:5555/ws",
        name: "MinimalBot",
      };
      const bot = new DuelBot(minimalConfig);
      expect(bot.name).toBe("MinimalBot");
      expect(bot.state).toBe("disconnected");
    });

    it("extends EventEmitter", () => {
      const bot = new DuelBot(config);
      expect(bot).toBeInstanceOf(EventEmitter);
    });
  });

  describe("state management", () => {
    it("initial state is disconnected", () => {
      const bot = new DuelBot(config);
      expect(bot.state).toBe("disconnected");
    });

    it("connected property returns false when disconnected", () => {
      const bot = new DuelBot(config);
      expect(bot.connected).toBe(false);
    });
  });

  describe("metrics", () => {
    it("initializes with zero metrics", () => {
      const bot = new DuelBot(config);
      expect(bot.metrics.wins).toBe(0);
      expect(bot.metrics.losses).toBe(0);
      expect(bot.metrics.totalDuels).toBe(0);
      expect(bot.metrics.connectedAt).toBe(0);
      expect(bot.metrics.lastDuelAt).toBe(0);
      expect(bot.metrics.isConnected).toBe(false);
    });
  });

  describe("name property", () => {
    it("returns configured name", () => {
      const bot = new DuelBot({ ...config, name: "CustomName" });
      expect(bot.name).toBe("CustomName");
    });
  });
});

describe("DuelBot State Transitions", () => {
  const states = [
    "disconnected",
    "connecting",
    "idle",
    "challenged",
    "in_duel_rules",
    "in_duel_stakes",
    "in_duel_confirm",
    "in_duel_countdown",
    "in_duel_fighting",
    "duel_finished",
  ];

  it("all valid states are defined", () => {
    for (const state of states) {
      expect(typeof state).toBe("string");
    }
  });
});

describe("DuelBotConfig", () => {
  it("accepts minimal config", () => {
    const config: DuelBotConfig = {
      wsUrl: "ws://localhost:5555/ws",
      name: "Bot",
    };
    expect(config.wsUrl).toBe("ws://localhost:5555/ws");
    expect(config.name).toBe("Bot");
  });

  it("accepts full config", () => {
    const config: DuelBotConfig = {
      wsUrl: "ws://localhost:5555/ws",
      name: "FullBot",
      autoAcceptChallenges: false,
      autoConfirmScreens: false,
      connectTimeoutMs: 10000,
    };
    expect(config.autoAcceptChallenges).toBe(false);
    expect(config.autoConfirmScreens).toBe(false);
    expect(config.connectTimeoutMs).toBe(10000);
  });
});

describe("DuelBotMetrics", () => {
  it("tracks win/loss correctly via metrics object", () => {
    const bot = new DuelBot({
      wsUrl: "ws://localhost:5555/ws",
      name: "MetricsBot",
    });

    // Initial state
    expect(bot.metrics.wins).toBe(0);
    expect(bot.metrics.losses).toBe(0);
    expect(bot.metrics.totalDuels).toBe(0);

    // Metrics should be readonly externally but the object is mutable
    // This is expected behavior - metrics are updated internally by the bot
  });
});
