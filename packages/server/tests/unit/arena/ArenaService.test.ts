import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ArenaService } from "../../../src/arena/ArenaService";

type MockWorld = {
  entities: {
    players: Map<
      string,
      {
        id: string;
        name?: string;
        data?: {
          name?: string;
          combatLevel?: number;
        };
        combatLevel?: number;
      }
    >;
  };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getSystem: ReturnType<typeof vi.fn>;
};

type MockDuelSystem = {
  createChallenge: ReturnType<typeof vi.fn>;
  respondToChallenge: ReturnType<typeof vi.fn>;
  acceptRules: ReturnType<typeof vi.fn>;
  acceptStakes: ReturnType<typeof vi.fn>;
  acceptFinal: ReturnType<typeof vi.fn>;
};

type Candidate = {
  characterId: string;
  name: string;
  powerScore: number;
  cooldownUntil: null;
};

type MockInboundTransfer = {
  signature: string;
  fromWallet: string | null;
  toWallet: string;
  destinationAta: string;
  amountBaseUnits: bigint;
  amountGold: string;
  memo: string | null;
};

type MockSolanaArenaOperator = {
  isEnabled: ReturnType<typeof vi.fn>;
  getCustodyWallet: ReturnType<typeof vi.fn>;
  getCustodyAta: ReturnType<typeof vi.fn>;
  inspectMarketBetTransaction: ReturnType<typeof vi.fn>;
  inspectInboundGoldTransfer: ReturnType<typeof vi.fn>;
  placeBetFor: ReturnType<typeof vi.fn>;
  claimFor: ReturnType<typeof vi.fn>;
};

function buildCandidates(): Candidate[] {
  return [
    {
      characterId: "agent-a",
      name: "Agent_A",
      powerScore: 10,
      cooldownUntil: null,
    },
    {
      characterId: "agent-b",
      name: "Agent_B",
      powerScore: 11,
      cooldownUntil: null,
    },
    {
      characterId: "agent-c",
      name: "Agent_C",
      powerScore: 12,
      cooldownUntil: null,
    },
    {
      characterId: "agent-d",
      name: "Agent_D",
      powerScore: 13,
      cooldownUntil: null,
    },
  ];
}

async function createBetOpenRound(service: ArenaService): Promise<{
  roundId: string;
  roundSeedHex: string;
}> {
  const typed = service as {
    config: {
      minWhitelistedAgents: number;
      previewDurationMs: number;
      bettingOpenDurationMs: number;
      bettingLockBufferMs: number;
      duelMaxDurationMs: number;
      resultShowDurationMs: number;
      restoreDurationMs: number;
    };
    getEligibleAgents: () => Promise<Candidate[]>;
    tick: () => Promise<void>;
  };

  typed.config = {
    ...typed.config,
    minWhitelistedAgents: 2,
    previewDurationMs: 10,
    bettingOpenDurationMs: 30_000,
  } as never;

  vi.spyOn(typed, "getEligibleAgents").mockResolvedValue(buildCandidates());
  vi.spyOn(Math, "random").mockReturnValue(0);

  const roundStartMs = Date.now();
  await typed.tick();
  vi.setSystemTime(roundStartMs + 11);
  await typed.tick();

  const round = service.getCurrentRound();
  expect(round?.phase).toBe("BET_OPEN");
  expect(round).not.toBeNull();

  return {
    roundId: round!.id,
    roundSeedHex: round!.roundSeedHex,
  };
}

function createMockSolanaArenaOperator(): MockSolanaArenaOperator {
  return {
    isEnabled: vi.fn().mockReturnValue(true),
    getCustodyWallet: vi.fn().mockReturnValue("custody_wallet"),
    getCustodyAta: vi.fn().mockReturnValue("custody_ata"),
    inspectMarketBetTransaction: vi.fn(),
    inspectInboundGoldTransfer: vi.fn(),
    placeBetFor: vi.fn(),
    claimFor: vi.fn(),
  };
}

function buildArenaPlayer(
  id: string,
  overrides: { name?: string; combatLevel?: number } = {},
) {
  return {
    id,
    name: `Agent_${id}`,
    combatLevel: 50,
    ...overrides,
  };
}

function createService(world: MockWorld): {
  current: ReturnType<typeof ArenaService.forWorld>;
  mockDuel: MockDuelSystem;
} {
  const mockDuel: MockDuelSystem = {
    createChallenge: vi.fn().mockReturnValue({
      success: true,
      challengeId: "challenge-1",
    }),
    respondToChallenge: vi.fn().mockReturnValue({
      success: true,
      duelId: "duel-1",
    }),
    acceptRules: vi.fn().mockReturnValue({ success: true }),
    acceptStakes: vi.fn().mockReturnValue({ success: true }),
    acceptFinal: vi.fn().mockReturnValue({ success: true }),
  };

  world.getSystem.mockImplementation((name: string) => {
    if (name === "duel") return mockDuel;
    return null;
  });

  return {
    current: ArenaService.forWorld(world as never),
    mockDuel,
  };
}

describe("ArenaService lifecycle", () => {
  let world: MockWorld;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    world = {
      entities: {
        players: new Map([
          ["agent-a", buildArenaPlayer("agent-a")],
          ["agent-b", buildArenaPlayer("agent-b")],
          ["agent-c", buildArenaPlayer("agent-c")],
          ["agent-d", buildArenaPlayer("agent-d")],
        ]),
      },
      on: vi.fn(),
      off: vi.fn(),
      getSystem: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates round with two-agent fallback preview selection", async () => {
    const { current: service } = createService(world);
    const typed = service as {
      config: {
        minWhitelistedAgents: number;
        previewDurationMs: number;
        bettingOpenDurationMs: number;
      };
      getEligibleAgents: () => Promise<Candidate[]>;
      tick: () => Promise<void>;
    };

    typed.config = {
      ...typed.config,
      minWhitelistedAgents: 2,
      previewDurationMs: 15_000,
      bettingOpenDurationMs: 15_000,
    } as never;

    const candidates: Candidate[] = [
      {
        characterId: "agent-a",
        name: "Agent_A",
        powerScore: 10,
        cooldownUntil: null,
      },
      {
        characterId: "agent-b",
        name: "Agent_B",
        powerScore: 12,
        cooldownUntil: null,
      },
    ];

    vi.spyOn(typed, "getEligibleAgents").mockResolvedValue(candidates);
    vi.spyOn(Math, "random").mockReturnValue(0);

    await typed.tick();

    const round = service.getCurrentRound();
    expect(round).not.toBeNull();
    expect(round?.phase).toBe("PREVIEW_CAMS");
    expect(round?.agentAId).toBe("agent-a");
    expect(round?.agentBId).toBe("agent-b");
    expect(round?.previewAgentAId).toBe("agent-a");
    expect(round?.previewAgentBId).toBe("agent-b");
  });

  it("advances through all phases to completion", async () => {
    const { current: service, mockDuel } = createService(world);
    const typed = service as {
      config: {
        previewDurationMs: number;
        bettingOpenDurationMs: number;
        bettingLockBufferMs: number;
        duelMaxDurationMs: number;
        resultShowDurationMs: number;
        restoreDurationMs: number;
      };
      getEligibleAgents: () => Promise<Candidate[]>;
      onEntityDamaged: (payload: unknown) => void;
      tick: () => Promise<void>;
    };

    typed.config = {
      ...typed.config,
      previewDurationMs: 10,
      bettingOpenDurationMs: 10,
      bettingLockBufferMs: 5,
      duelMaxDurationMs: 20,
      resultShowDurationMs: 4,
      restoreDurationMs: 2,
    } as never;

    const candidates: Candidate[] = [
      {
        characterId: "agent-a",
        name: "Agent_A",
        powerScore: 10,
        cooldownUntil: null,
      },
      {
        characterId: "agent-b",
        name: "Agent_B",
        powerScore: 11,
        cooldownUntil: null,
      },
      {
        characterId: "agent-c",
        name: "Agent_C",
        powerScore: 12,
        cooldownUntil: null,
      },
      {
        characterId: "agent-d",
        name: "Agent_D",
        powerScore: 13,
        cooldownUntil: null,
      },
    ];

    vi.spyOn(typed, "getEligibleAgents").mockResolvedValue(candidates);
    vi.spyOn(Math, "random").mockReturnValue(0);

    const roundStartMs = Date.now();

    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("PREVIEW_CAMS");

    vi.setSystemTime(roundStartMs + 11);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("BET_OPEN");

    vi.setSystemTime(roundStartMs + 21);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("BET_LOCK");

    vi.setSystemTime(roundStartMs + 27);
    await typed.tick();
    const round = service.getCurrentRound();
    expect(round?.phase).toBe("DUEL_ACTIVE");
    expect(round?.duelId).toBe("duel-1");
    expect(mockDuel.createChallenge).toHaveBeenCalledTimes(1);
    expect(mockDuel.respondToChallenge).toHaveBeenCalledTimes(1);

    typed.onEntityDamaged({
      sourceId: round?.agentAId,
      entityId: round?.agentBId,
      damage: 13.8,
    } as never);

    vi.setSystemTime(roundStartMs + 48);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("RESULT_SHOW");

    vi.setSystemTime(roundStartMs + 52);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("ORACLE_REPORT");

    vi.setSystemTime(roundStartMs + 53);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("MARKET_RESOLVE");

    vi.setSystemTime(roundStartMs + 54);
    await typed.tick();
    expect(service.getCurrentRound()?.phase).toBe("RESTORE");

    vi.setSystemTime(roundStartMs + 56);
    await typed.tick();
    expect(service.getCurrentRound()).toBeNull();
    expect(service.listRecentRounds(1)[0]?.phase).toBe("COMPLETE");
    expect(service.listRecentRounds(1)[0]?.winnerId).toBe("agent-a");
  });

  it("builds a custody deposit address with deterministic memo template", async () => {
    const { current: service } = createService(world);
    const { roundId } = await createBetOpenRound(service);

    const mockSolana = createMockSolanaArenaOperator();
    (service as { solanaOperator: unknown }).solanaOperator = mockSolana;

    const response = service.buildDepositAddress({ roundId, side: "A" });
    expect(response.roundId).toBe(roundId);
    expect(response.side).toBe("A");
    expect(response.custodyWallet).toBe("custody_wallet");
    expect(response.custodyAta).toBe("custody_ata");
    expect(response.memoTemplate).toBe(`ARENA:${roundId}:A`);
  });

  it("rejects deposit ingest when memo is missing", async () => {
    const { current: service } = createService(world);
    const { roundId } = await createBetOpenRound(service);

    const mockSolana = createMockSolanaArenaOperator();
    const inbound: MockInboundTransfer = {
      signature: "source_sig",
      fromWallet: "bettor_wallet",
      toWallet: "custody_wallet",
      destinationAta: "custody_ata",
      amountBaseUnits: 1_000_000n,
      amountGold: "1",
      memo: null,
    };
    mockSolana.inspectInboundGoldTransfer.mockResolvedValue(inbound);
    (service as { solanaOperator: unknown }).solanaOperator = mockSolana;

    await expect(
      service.ingestDepositBySignature({
        roundId,
        side: "A",
        txSignature: "source_sig",
      }),
    ).rejects.toThrow("memo is required");
  });

  it("ingests deposit tx and settles place_bet_for into market", async () => {
    const { current: service } = createService(world);
    const { roundId, roundSeedHex } = await createBetOpenRound(service);

    const mockSolana = createMockSolanaArenaOperator();
    const inbound: MockInboundTransfer = {
      signature: "source_sig",
      fromWallet: "bettor_wallet",
      toWallet: "custody_wallet",
      destinationAta: "custody_ata",
      amountBaseUnits: 2_500_000n,
      amountGold: "2.5",
      memo: `ARENA:${roundId}:A`,
    };
    mockSolana.inspectInboundGoldTransfer.mockResolvedValue(inbound);
    mockSolana.placeBetFor.mockResolvedValue("settle_sig");
    (service as { solanaOperator: unknown }).solanaOperator = mockSolana;

    const recordBetSpy = vi
      .spyOn(service, "recordBet")
      .mockResolvedValue("bet_ingested");

    const response = await service.ingestDepositBySignature({
      roundId,
      side: "A",
      txSignature: "source_sig",
    });

    expect(mockSolana.placeBetFor).toHaveBeenCalledWith({
      roundSeedHex,
      bettorWallet: "bettor_wallet",
      side: "A",
      amountGoldBaseUnits: 2_500_000n,
    });
    expect(recordBetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId,
        bettorWallet: "bettor_wallet",
        side: "A",
        sourceAsset: "GOLD",
        sourceAmount: "2.5",
        goldAmount: "2.5",
        txSignature: "source_sig",
      }),
    );
    expect(response).toEqual({
      roundId,
      side: "A",
      txSignature: "source_sig",
      settleSignature: "settle_sig",
      bettorWallet: "bettor_wallet",
      goldAmount: "2.5",
      betId: "bet_ingested",
    });
  });

  it("processes payout jobs through claim_for and marks as paid", async () => {
    const { current: service } = createService(world);
    const typed = service as {
      getDb: () => unknown;
      processPayoutJobs: () => Promise<void>;
      markPayoutJobResult: (payload: unknown) => Promise<boolean>;
      solanaOperator: unknown;
    };

    const mockSolana = createMockSolanaArenaOperator();
    mockSolana.claimFor.mockResolvedValue("claim_sig");
    typed.solanaOperator = mockSolana;

    const now = Date.now();
    const job = {
      id: "payout_1",
      roundId: "round_1",
      bettorWallet: "bettor_wallet",
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: now - 1,
      createdAt: now - 10_000,
    };

    const limitMock = vi.fn().mockResolvedValue([job]);
    const dbMock = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: limitMock,
            }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    const markSpy = vi
      .spyOn(typed, "markPayoutJobResult")
      .mockResolvedValue(true);

    await typed.processPayoutJobs();

    expect(mockSolana.claimFor).toHaveBeenCalledTimes(1);
    expect(markSpy).toHaveBeenCalledWith({
      id: "payout_1",
      status: "PROCESSING",
      nextAttemptAt: null,
    });
    expect(markSpy).toHaveBeenCalledWith({
      id: "payout_1",
      status: "PAID",
      claimSignature: "claim_sig",
      nextAttemptAt: null,
      lastError: null,
    });
  });
});
