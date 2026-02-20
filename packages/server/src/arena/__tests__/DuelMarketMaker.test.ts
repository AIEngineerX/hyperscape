import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { World } from "@hyperscape/shared";
import { DuelMarketMaker } from "../DuelMarketMaker";

type Listener = (payload: unknown) => void;

function createMockWorld(solanaArenaOperator: unknown) {
  const listeners = new Map<string, Set<Listener>>();

  const on = (event: string, fn: Listener) => {
    const handlers = listeners.get(event) ?? new Set<Listener>();
    handlers.add(fn);
    listeners.set(event, handlers);
  };

  const off = (event: string, fn: Listener) => {
    listeners.get(event)?.delete(fn);
  };

  const emit = (event: string, payload: unknown) => {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      fn(payload);
    }
  };

  const world = {
    on,
    off,
    emit,
    solanaArenaOperator,
  } as unknown as World;

  return { world, emit };
}

describe("DuelMarketMaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("seeds balanced market-maker liquidity for both sides", async () => {
    const operator = {
      isEnabled: vi.fn(() => true),
      getCustodyWallet: vi.fn(() => "wallet-keeper"),
      initRound: vi.fn(async () => ({
        closeSlot: 123,
        initOracleSignature: "oracle-sig",
        initMarketSignature: "market-sig",
      })),
      lockMarket: vi.fn(async () => null),
      reportAndResolve: vi.fn(async () => null),
      placeBetFor: vi
        .fn()
        .mockResolvedValueOnce("seed-a")
        .mockResolvedValueOnce("seed-b"),
    };

    const { world, emit } = createMockWorld(operator);
    const marketMaker = new DuelMarketMaker(world, 10);
    await marketMaker.init();

    emit("streaming:announcement:start", {
      cycleId: "cycle-1",
      agent1Id: "agent-a",
      agent2Id: "agent-b",
      bettingClosesAt: Date.now() + 60_000,
    });
    await vi.runAllTicks();

    expect(operator.initRound).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(operator.placeBetFor).toHaveBeenCalledTimes(2);
    expect(operator.placeBetFor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        roundSeedHex: expect.any(String),
        bettorWallet: "wallet-keeper",
        side: "A",
        amountGoldBaseUnits: 10_000_000n,
      }),
    );
    expect(operator.placeBetFor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        roundSeedHex: expect.any(String),
        bettorWallet: "wallet-keeper",
        side: "B",
        amountGoldBaseUnits: 10_000_000n,
      }),
    );

    marketMaker.destroy();
  });

  it("accepts streaming scheduler announcement payload shape", async () => {
    const operator = {
      isEnabled: vi.fn(() => true),
      getCustodyWallet: vi.fn(() => "wallet-keeper"),
      initRound: vi.fn(async () => ({
        closeSlot: 123,
        initOracleSignature: "oracle-sig",
        initMarketSignature: "market-sig",
      })),
      lockMarket: vi.fn(async () => null),
      reportAndResolve: vi.fn(async () => null),
      placeBetFor: vi
        .fn()
        .mockResolvedValueOnce("seed-a")
        .mockResolvedValueOnce("seed-b"),
    };

    const { world, emit } = createMockWorld(operator);
    const marketMaker = new DuelMarketMaker(world, 10);
    await marketMaker.init();

    emit("streaming:announcement:start", {
      cycleId: "cycle-2",
      duration: 30_000,
      agent1: { characterId: "agent-a", name: "Agent A" },
      agent2: { characterId: "agent-b", name: "Agent B" },
    });
    await vi.runAllTicks();

    expect(operator.initRound).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(operator.placeBetFor).toHaveBeenCalledTimes(2);

    marketMaker.destroy();
  });
});
