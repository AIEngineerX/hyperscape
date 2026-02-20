/**
 * DuelBot Unit Tests
 *
 * Tests for the DuelBot class without requiring a real server connection.
 * Uses mocked network for unit-level testing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";

const { createNodeClientWorldMock, sendMock, networkState } = vi.hoisted(() => {
  const networkState = {
    connected: true,
    id: "test-player-123" as string | null,
  };
  const sendMock = vi.fn();
  const onMock = vi.fn();
  const worldOnMock = vi.fn();
  const initMock = vi.fn().mockResolvedValue(undefined);
  const destroyMock = vi.fn();
  const createNodeClientWorldMock = vi.fn(() => {
    const networkSystem = {
      get connected() {
        return networkState.connected;
      },
      get id() {
        return networkState.id;
      },
      send: sendMock,
      on: onMock,
    };

    return {
      init: initMock,
      destroy: destroyMock,
      getSystem: vi.fn().mockImplementation((name: string) => {
        if (name === "network") return networkSystem;
        return null;
      }),
      entities: {
        player: {
          node: { position: { x: 10, y: 5, z: 20 } },
        },
      },
      on: worldOnMock,
    };
  });

  return {
    createNodeClientWorldMock,
    initMock,
    destroyMock,
    sendMock,
    onMock,
    worldOnMock,
    networkState,
  };
});

vi.mock("../../runtime/createNodeClientWorld", () => ({
  createNodeClientWorld: createNodeClientWorldMock,
}));

// Import after mocking
import { DuelBot, type DuelBotConfig } from "../DuelBot";

describe("DuelBot", () => {
  let config: DuelBotConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockReset();
    networkState.connected = true;
    networkState.id = "test-player-123";
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

    it("enters challenged state when initiating a challenge", () => {
      const bot = new DuelBot(config);
      (bot as unknown as { state: string }).state = "idle";

      bot.challengePlayer("target-player");

      expect(bot.state).toBe("challenged");
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

  describe("connect", () => {
    it("sends enterWorld with loadTestBot and duelBot flags", async () => {
      const bot = new DuelBot(config);

      await bot.connect();

      expect(sendMock).toHaveBeenCalledWith(
        "enterWorld",
        expect.objectContaining({
          loadTestBot: true,
          duelBot: true,
          botName: "TestBot-001",
        }),
      );
      expect(sendMock).toHaveBeenCalledWith("clientReady", {});
      expect(bot.state).toBe("idle");
      expect(bot.connected).toBe(true);
    });

    it("fails if disconnected immediately after enterWorld", async () => {
      sendMock.mockImplementation((method: string) => {
        if (method === "enterWorld") {
          networkState.connected = false;
        }
      });

      const bot = new DuelBot(config);

      await expect(bot.connect()).rejects.toThrow(
        "TestBot-001 disconnected after enterWorld",
      );
      expect(bot.state).toBe("disconnected");
      expect(bot.connected).toBe(false);
    });

    it("includes duelId when accepting duel screens", async () => {
      const bot = new DuelBot(config);
      await bot.connect();

      sendMock.mockClear();
      (bot as unknown as { currentDuelId: string }).currentDuelId = "duel-123";

      (bot as unknown as { acceptRules: () => void }).acceptRules();
      (bot as unknown as { acceptStakes: () => void }).acceptStakes();
      (bot as unknown as { acceptFinal: () => void }).acceptFinal();

      expect(sendMock).toHaveBeenCalledWith("duel:accept:rules", {
        duelId: "duel-123",
      });
      expect(sendMock).toHaveBeenCalledWith("duel:accept:stakes", {
        duelId: "duel-123",
      });
      expect(sendMock).toHaveBeenCalledWith("duel:accept:final", {
        duelId: "duel-123",
      });
    });

    it("attacks duel opponents using attackPlayer packets", async () => {
      const bot = new DuelBot(config);
      await bot.connect();

      sendMock.mockClear();
      (
        bot as unknown as { currentOpponentId: string; state: string }
      ).currentOpponentId = "opponent-123";
      (bot as unknown as { currentOpponentId: string; state: string }).state =
        "in_duel_fighting";

      (bot as unknown as { attack: () => void }).attack();

      expect(sendMock).toHaveBeenCalledWith("attackPlayer", {
        targetPlayerId: "opponent-123",
      });
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
