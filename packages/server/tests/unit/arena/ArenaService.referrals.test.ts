import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaService } from "../../../src/arena/ArenaService";
import * as schema from "../../../src/database/schema";

type MockWorld = {
  entities: {
    players: Map<string, unknown>;
  };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getSystem: ReturnType<typeof vi.fn>;
};

function createService(): ArenaService {
  const world: MockWorld = {
    entities: {
      players: new Map(),
    },
    on: vi.fn(),
    off: vi.fn(),
    getSystem: vi.fn(),
  };
  return ArenaService.forWorld(world as never);
}

describe("ArenaService referrals + wallet links", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects self-referral invite redemption", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<unknown>;
    };

    const dbMock = {
      query: {
        arenaInviteCodes: {
          findFirst: vi.fn().mockResolvedValue({
            code: "DUELSELF01",
            inviterWallet: "same_wallet",
          }),
        },
        arenaInvitedWallets: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );

    await expect(
      service.redeemInviteCode({
        wallet: "same_wallet",
        inviteCode: "DUELSELF01",
      }),
    ).rejects.toThrow("own invite code");
  });

  it("splits fees 10/90 for referred bettors and 100% treasury otherwise", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      recordFeeShare: (params: {
        roundId: string | null;
        betId: string;
        bettorWallet: string;
        goldAmount: string;
        feeBps: number;
        chain: "SOLANA" | "BSC" | "BASE";
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<boolean>;
    };
    const insertedRows: Record<string, unknown>[] = [];

    const dbMock = {
      insert: vi.fn().mockReturnValue({
        values: vi
          .fn()
          .mockImplementation((values: Record<string, unknown>) => ({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockImplementation(async () => {
                insertedRows.push(values);
                return [{ id: insertedRows.length }];
              }),
            }),
          })),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);

    await typed.recordFeeShare({
      roundId: "round_1",
      betId: "bet_ref",
      bettorWallet: "invited_wallet",
      goldAmount: "100",
      feeBps: 100,
      chain: "SOLANA",
      referral: {
        inviteCode: "DUELAAA111",
        inviterWallet: "inviter_wallet",
      },
    });

    await typed.recordFeeShare({
      roundId: "round_1",
      betId: "bet_direct",
      bettorWallet: "direct_wallet",
      goldAmount: "100",
      feeBps: 100,
      chain: "BSC",
      referral: null,
    });

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toEqual(
      expect.objectContaining({
        chain: "SOLANA",
        totalFeeGold: "1",
        inviterFeeGold: "0.1",
        treasuryFeeGold: "0.9",
        inviterWallet: "inviter_wallet",
      }),
    );
    expect(insertedRows[1]).toEqual(
      expect.objectContaining({
        chain: "BSC",
        totalFeeGold: "1",
        inviterFeeGold: "0",
        treasuryFeeGold: "1",
        inviterWallet: null,
      }),
    );
  });

  it("filters invite fee summary by connected platform (EVM = Base+BSC, Solana = Solana)", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<unknown>;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    let feeSummaryQueryCount = 0;
    const selectMock = vi
      .fn()
      .mockImplementation((fields: Record<string, unknown>) => {
        if ("count" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ count: 2 }]),
            }),
          };
        }
        if ("totalPoints" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ totalPoints: 20 }]),
            }),
          };
        }
        if ("inviterFeeGold" in fields) {
          const feeRows =
            feeSummaryQueryCount === 0
              ? [{ inviterFeeGold: "0.25", treasuryFeeGold: "1.75" }]
              : [{ inviterFeeGold: "0.05", treasuryFeeGold: "0.45" }];
          feeSummaryQueryCount += 1;
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(feeRows),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

    const dbMock = {
      query: {
        arenaInviteCodes: {
          findFirst: vi.fn().mockResolvedValue({
            code: "DUELABC123",
            inviterWallet: "inviter_wallet",
          }),
        },
        arenaInvitedWallets: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { invitedWallet: "wallet_a" },
              { invitedWallet: "wallet_b" },
            ]),
        },
        arenaReferralPoints: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ totalPoints: 12 }, { totalPoints: 8 }]),
        },
      },
      select: selectMock,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    vi.spyOn(typed, "listIdentityWallets").mockResolvedValue([
      "inviter_wallet",
    ]);

    const evmSummary = await service.getInviteSummary("inviter_wallet", "evm");
    const solSummary = await service.getInviteSummary(
      "inviter_wallet",
      "solana",
    );

    expect(evmSummary.platformView).toBe("EVM");
    expect(evmSummary.invitedWalletsTruncated).toBe(false);
    expect(evmSummary.feeShareFromReferralsGold).toBe("0.25");
    expect(evmSummary.treasuryFeesFromReferredBetsGold).toBe("1.75");

    expect(solSummary.platformView).toBe("SOLANA");
    expect(solSummary.invitedWalletsTruncated).toBe(false);
    expect(solSummary.feeShareFromReferralsGold).toBe("0.05");
    expect(solSummary.treasuryFeesFromReferredBetsGold).toBe("0.45");
  });

  it("treats base and bsc platform queries as EVM fee views", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<unknown>;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    const selectMock = vi
      .fn()
      .mockImplementation((fields: Record<string, unknown>) => {
        if ("count" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ count: 1 }]),
            }),
          };
        }
        if ("totalPoints" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ totalPoints: 9 }]),
            }),
          };
        }
        if ("inviterFeeGold" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValue([
                  { inviterFeeGold: "0.40", treasuryFeeGold: "3.60" },
                ]),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

    const dbMock = {
      query: {
        arenaInviteCodes: {
          findFirst: vi.fn().mockResolvedValue({
            code: "DUELBASEBSC",
            inviterWallet: "inviter_wallet",
          }),
        },
        arenaInvitedWallets: {
          findMany: vi.fn().mockResolvedValue([{ invitedWallet: "wallet_a" }]),
        },
      },
      select: selectMock,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    vi.spyOn(typed, "listIdentityWallets").mockResolvedValue([
      "inviter_wallet",
    ]);

    const baseSummary = await service.getInviteSummary(
      "inviter_wallet",
      "base",
    );
    const bscSummary = await service.getInviteSummary("inviter_wallet", "bsc");

    expect(baseSummary.platformView).toBe("BASE");
    expect(baseSummary.feeShareFromReferralsGold).toBe("0.40");
    expect(baseSummary.treasuryFeesFromReferredBetsGold).toBe("3.60");

    expect(bscSummary.platformView).toBe("BSC");
    expect(bscSummary.feeShareFromReferralsGold).toBe("0.40");
    expect(bscSummary.treasuryFeesFromReferredBetsGold).toBe("3.60");
  });

  it("flags invite wallets as truncated when only a partial page is returned", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<unknown>;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    const selectMock = vi
      .fn()
      .mockImplementation((fields: Record<string, unknown>) => {
        if ("count" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ count: 3 }]),
            }),
          };
        }
        if ("totalPoints" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ totalPoints: 20 }]),
            }),
          };
        }
        if ("inviterFeeGold" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValue([
                  { inviterFeeGold: "0.25", treasuryFeeGold: "1.75" },
                ]),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      });

    const dbMock = {
      query: {
        arenaInviteCodes: {
          findFirst: vi.fn().mockResolvedValue({
            code: "DUELTRUNC01",
            inviterWallet: "inviter_wallet",
          }),
        },
        arenaInvitedWallets: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { invitedWallet: "wallet_a" },
              { invitedWallet: "wallet_b" },
            ]),
        },
      },
      select: selectMock,
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    vi.spyOn(typed, "listIdentityWallets").mockResolvedValue([
      "inviter_wallet",
    ]);

    const summary = await service.getInviteSummary("inviter_wallet", "all");
    expect(summary.invitedWalletCount).toBe(3);
    expect(summary.invitedWallets).toEqual(["wallet_a", "wallet_b"]);
    expect(summary.invitedWalletsTruncated).toBe(true);
  });

  it("uses database-side aggregation for points leaderboard", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
    };

    const executeMock = vi.fn().mockResolvedValue({
      rows: [
        { wallet: "wallet_a", total_points: "25" },
        { wallet: "wallet_b", total_points: 10 },
      ],
    });
    vi.spyOn(typed, "getDb").mockReturnValue({
      execute: executeMock,
    } as never);

    const leaderboard = await service.getPointsLeaderboard(2);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(leaderboard).toEqual([
      { rank: 1, wallet: "wallet_a", totalPoints: 25 },
      { rank: 2, wallet: "wallet_b", totalPoints: 10 },
    ]);
  });

  it("falls back to non-staking leaderboard query when staking table is unavailable", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
    };

    const executeMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('relation "arena_staking_points" does not exist'),
      )
      .mockResolvedValueOnce({
        rows: [{ wallet: "wallet_only", total_points: "7" }],
      });
    vi.spyOn(typed, "getDb").mockReturnValue({
      execute: executeMock,
    } as never);

    const leaderboard = await service.getPointsLeaderboard(5);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(leaderboard).toEqual([
      { rank: 1, wallet: "wallet_only", totalPoints: 7 },
    ]);
  });

  it("aggregates points across linked wallets when scope=linked", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      listLinkedWallets: (wallet: string) => Promise<string[]>;
      fetchGoldPositionForWallet: (wallet: string) => Promise<{
        liquidGoldBalance: number;
        stakedGoldBalance: number;
        goldBalance: number;
        liquidGoldHoldDays: number;
        stakedGoldHoldDays: number;
        goldHoldDays: number;
        stakingSource: string;
      }>;
      accrueStakingPointsIfDue: (
        wallet: string,
        position?: unknown,
      ) => Promise<void>;
    };

    const selectMock = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ totalPoints: 30 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ totalPoints: 12 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 5 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ totalPoints: 8 }]),
        }),
      });

    vi.spyOn(typed, "getDb").mockReturnValue({
      select: selectMock,
    } as never);
    vi.spyOn(typed, "listLinkedWallets").mockResolvedValue([
      "8Nn8pQ6xR7EwXH5kA2mG4zV9sC1tB3yJ6uF4dD2aLxQp",
    ]);
    vi.spyOn(typed, "fetchGoldPositionForWallet").mockImplementation(
      async (wallet) => {
        if (wallet === "So11111111111111111111111111111111111111112") {
          return {
            liquidGoldBalance: 1200,
            stakedGoldBalance: 0,
            goldBalance: 1200,
            liquidGoldHoldDays: 4,
            stakedGoldHoldDays: 0,
            goldHoldDays: 4,
            stakingSource: "PRIMARY",
          };
        }
        return {
          liquidGoldBalance: 500,
          stakedGoldBalance: 700,
          goldBalance: 1200,
          liquidGoldHoldDays: 8,
          stakedGoldHoldDays: 12,
          goldHoldDays: 12,
          stakingSource: "PRIMARY",
        };
      },
    );
    const accrueSpy = vi
      .spyOn(typed, "accrueStakingPointsIfDue")
      .mockResolvedValue(undefined);

    const points = await service.getWalletPoints(
      "So11111111111111111111111111111111111111112",
      { scope: "linked" },
    );

    expect(points.pointsScope).toBe("LINKED");
    expect(points.identityWalletCount).toBe(2);
    expect(points.totalPoints).toBe(50);
    expect(points.selfPoints).toBe(30);
    expect(points.referralPoints).toBe(12);
    expect(points.stakingPoints).toBe(8);
    expect(points.multiplier).toBe(1);
    expect(points.goldBalance).toBe("2400");
    expect(points.liquidGoldBalance).toBe("1700");
    expect(points.stakedGoldBalance).toBe("700");
    expect(points.goldHoldDays).toBe(12);
    expect(points.invitedWalletCount).toBe(5);
    expect(accrueSpy).toHaveBeenCalledTimes(2);
  });

  it("collapses linked wallets into one leaderboard entry when scope=linked", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
    };

    const executeMock = vi.fn().mockResolvedValue({
      rows: [
        {
          wallet: "0x1111111111111111111111111111111111111111",
          total_points: "10",
        },
        {
          wallet: "So11111111111111111111111111111111111111112",
          total_points: "15",
        },
        { wallet: "wallet_c", total_points: "7" },
      ],
    });
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 1,
                walletA: "0x1111111111111111111111111111111111111111",
                walletB: "So11111111111111111111111111111111111111112",
              },
            ]),
          }),
        }),
      }),
    });

    vi.spyOn(typed, "getDb").mockReturnValue({
      execute: executeMock,
      select: selectMock,
    } as never);

    const leaderboard = await service.getPointsLeaderboard(10, {
      scope: "linked",
    });

    expect(leaderboard).toEqual([
      {
        rank: 1,
        wallet: "0x1111111111111111111111111111111111111111",
        totalPoints: 25,
      },
      {
        rank: 2,
        wallet: "wallet_c",
        totalPoints: 7,
      },
    ]);
  });

  it("links EVM<->Solana wallets, propagates invite mapping, and awards +100", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<{
        id: number;
        inviteCode: string;
        inviterWallet: string;
        invitedWallet: string;
        firstBetId: string | null;
      } | null>;
      ensureWalletInviteMapping: (params: {
        wallet: string;
        inviteCode: string;
        inviterWallet: string;
        firstBetId: string | null;
      }) => Promise<void>;
      awardFlatPoints: (params: {
        wallet: string;
        points: number;
        betId: string;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const insertValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    });
    const dbMock = {
      query: {
        arenaWalletLinks: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: insertValues,
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 7,
        inviteCode: "DUELSYNC11",
        inviterWallet: "inviter_wallet",
        invitedWallet: "So11111111111111111111111111111111111111112",
        firstBetId: null,
      })
      .mockResolvedValueOnce({
        id: 7,
        inviteCode: "DUELSYNC11",
        inviterWallet: "inviter_wallet",
        invitedWallet: "0x1111111111111111111111111111111111111111",
        firstBetId: null,
      });

    const ensureSpy = vi
      .spyOn(typed, "ensureWalletInviteMapping")
      .mockResolvedValue(undefined);
    const bonusSpy = vi
      .spyOn(typed, "awardFlatPoints")
      .mockResolvedValue(undefined);

    const result = await service.linkWallets({
      wallet: "0x1111111111111111111111111111111111111111",
      walletPlatform: "BSC",
      linkedWallet: "So11111111111111111111111111111111111111112",
      linkedWalletPlatform: "SOLANA",
    });

    expect(dbMock.insert).toHaveBeenCalledWith(schema.arenaWalletLinks);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        walletA: "0x1111111111111111111111111111111111111111",
        walletAPlatform: "BSC",
        walletB: "So11111111111111111111111111111111111111112",
        walletBPlatform: "SOLANA",
      }),
    );
    expect(ensureSpy).toHaveBeenCalledTimes(2);
    expect(bonusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: "0x1111111111111111111111111111111111111111",
        points: 100,
        referral: {
          inviteCode: "DUELSYNC11",
          inviterWallet: "inviter_wallet",
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        alreadyLinked: false,
        awardedPoints: 100,
        propagatedInviteCode: "DUELSYNC11",
      }),
    );
  });

  it("rejects wallet linking when two invite trees conflict", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<{
        id: number;
        inviteCode: string;
        inviterWallet: string;
        invitedWallet: string;
        firstBetId: string | null;
      } | null>;
    };

    const dbMock = {
      query: {
        arenaWalletLinks: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork")
      .mockResolvedValueOnce({
        id: 1,
        inviteCode: "DUELAAAA11",
        inviterWallet: "inviter_a",
        invitedWallet: "0x1111111111111111111111111111111111111111",
        firstBetId: null,
      })
      .mockResolvedValueOnce({
        id: 2,
        inviteCode: "DUELBBBB22",
        inviterWallet: "inviter_b",
        invitedWallet: "So11111111111111111111111111111111111111112",
        firstBetId: null,
      });

    await expect(
      service.linkWallets({
        wallet: "0x1111111111111111111111111111111111111111",
        walletPlatform: "BASE",
        linkedWallet: "So11111111111111111111111111111111111111112",
        linkedWalletPlatform: "SOLANA",
      }),
    ).rejects.toThrow("different invite codes");
  });

  it("treats Base/BSC as one EVM link pair for bonus/idempotency", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<{
        id: number;
        inviteCode: string;
        inviterWallet: string;
        invitedWallet: string;
        firstBetId: string | null;
      } | null>;
      awardFlatPoints: (params: {
        wallet: string;
        points: number;
        betId: string;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const dbMock = {
      query: {
        arenaWalletLinks: {
          findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
            id: 1,
            pairKey: "EVM:0x111|SOLANA:So111",
          }),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    const bonusSpy = vi
      .spyOn(typed, "awardFlatPoints")
      .mockResolvedValue(undefined);

    const first = await service.linkWallets({
      wallet: "0x1111111111111111111111111111111111111111",
      walletPlatform: "BSC",
      linkedWallet: "So11111111111111111111111111111111111111112",
      linkedWalletPlatform: "SOLANA",
    });
    const second = await service.linkWallets({
      wallet: "0x1111111111111111111111111111111111111111",
      walletPlatform: "BASE",
      linkedWallet: "So11111111111111111111111111111111111111112",
      linkedWalletPlatform: "SOLANA",
    });

    expect(first.alreadyLinked).toBe(false);
    expect(first.awardedPoints).toBe(100);
    expect(second.alreadyLinked).toBe(true);
    expect(second.awardedPoints).toBe(0);
    expect(bonusSpy).toHaveBeenCalledTimes(1);
  });

  it("awards +100 when linking from Solana and remains idempotent from EVM side", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<{
        id: number;
        inviteCode: string;
        inviterWallet: string;
        invitedWallet: string;
        firstBetId: string | null;
      } | null>;
      awardFlatPoints: (params: {
        wallet: string;
        points: number;
        betId: string;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const dbMock = {
      query: {
        arenaWalletLinks: {
          findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
            id: 1,
            pairKey: "EVM:0x111|SOLANA:So111",
          }),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    const bonusSpy = vi
      .spyOn(typed, "awardFlatPoints")
      .mockResolvedValue(undefined);

    const first = await service.linkWallets({
      wallet: "So11111111111111111111111111111111111111112",
      walletPlatform: "SOLANA",
      linkedWallet: "0x1111111111111111111111111111111111111111",
      linkedWalletPlatform: "BASE",
    });
    const second = await service.linkWallets({
      wallet: "0x1111111111111111111111111111111111111111",
      walletPlatform: "BSC",
      linkedWallet: "So11111111111111111111111111111111111111112",
      linkedWalletPlatform: "SOLANA",
    });

    expect(first.alreadyLinked).toBe(false);
    expect(first.awardedPoints).toBe(100);
    expect(second.alreadyLinked).toBe(true);
    expect(second.awardedPoints).toBe(0);
    expect(bonusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: "So11111111111111111111111111111111111111112",
        points: 100,
      }),
    );
    expect(bonusSpy).toHaveBeenCalledTimes(1);
  });

  it("skips wallet-link bonus when identity already has a historical wallet-link reward", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<{
        id: number;
        inviteCode: string;
        inviterWallet: string;
        invitedWallet: string;
        firstBetId: string | null;
      } | null>;
      awardFlatPoints: (params: {
        wallet: string;
        points: number;
        betId: string;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    const dbMock = {
      query: {
        arenaWalletLinks: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        arenaPoints: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 99, betId: "wallet-link:legacy" }),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      }),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    vi.spyOn(typed, "listIdentityWallets")
      .mockResolvedValueOnce(["0x1111111111111111111111111111111111111111"])
      .mockResolvedValueOnce(["So11111111111111111111111111111111111111112"])
      .mockResolvedValueOnce([
        "0x1111111111111111111111111111111111111111",
        "So11111111111111111111111111111111111111112",
      ]);
    const bonusSpy = vi
      .spyOn(typed, "awardFlatPoints")
      .mockResolvedValue(undefined);

    const result = await service.linkWallets({
      wallet: "0x1111111111111111111111111111111111111111",
      walletPlatform: "BASE",
      linkedWallet: "So11111111111111111111111111111111111111112",
      linkedWalletPlatform: "SOLANA",
    });

    expect(result.alreadyLinked).toBe(false);
    expect(result.awardedPoints).toBe(0);
    expect(bonusSpy).not.toHaveBeenCalled();
  });

  it("rejects external bet tracking when tx signature is missing", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
    };
    vi.spyOn(typed, "getDb").mockReturnValue({ query: {} } as never);

    await expect(
      service.recordExternalBet({
        bettorWallet: "0x1111111111111111111111111111111111111111",
        chain: "BASE",
        sourceAsset: "GOLD",
        sourceAmount: "1",
        goldAmount: "1",
        feeBps: 9000,
        txSignature: null,
      }),
    ).rejects.toThrow("txSignature is required");
  });

  it("records external bets with chain-specific fee tracking", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      resolveReferralForWallet: (params: {
        wallet: string;
        betId: string;
        inviteCode: string | null;
      }) => Promise<{ inviteCode: string; inviterWallet: string } | null>;
      recordFeeShare: (params: {
        roundId: string | null;
        betId: string;
        bettorWallet: string;
        goldAmount: string;
        feeBps: number;
        chain: "SOLANA" | "BSC" | "BASE";
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<boolean>;
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    vi.spyOn(typed, "getDb").mockReturnValue({
      query: {
        arenaFeeShares: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        arenaPoints: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as never);
    vi.spyOn(typed, "resolveReferralForWallet").mockResolvedValue(null);
    const feeSpy = vi.spyOn(typed, "recordFeeShare").mockResolvedValue(true);
    const pointsSpy = vi
      .spyOn(typed, "awardPoints")
      .mockResolvedValue(undefined);

    const betId = await service.recordExternalBet({
      bettorWallet: "So11111111111111111111111111111111111111112",
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: "2.5",
      goldAmount: "2.5",
      feeBps: 9000,
      txSignature: "sol_sig_123",
      inviteCode: null,
      externalBetRef: "solana:match:12",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(betId).toContain("bet_ext_");
    expect(feeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId: null,
        chain: "SOLANA",
        feeBps: 9000,
        goldAmount: "2.5",
      }),
    );
    await vi.waitFor(() =>
      expect(pointsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          roundId: null,
          roundSeedHex: null,
          verifiedForPoints: false,
        }),
      ),
    );
  });

  it("awards external points for EVM chains using trusted external tracking", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      resolveReferralForWallet: (params: {
        wallet: string;
        betId: string;
        inviteCode: string | null;
      }) => Promise<{ inviteCode: string; inviterWallet: string } | null>;
      recordFeeShare: (params: {
        roundId: string | null;
        betId: string;
        bettorWallet: string;
        goldAmount: string;
        feeBps: number;
        chain: "SOLANA" | "BSC" | "BASE";
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<boolean>;
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    vi.spyOn(typed, "getDb").mockReturnValue({
      query: {
        arenaFeeShares: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        arenaPoints: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as never);
    vi.spyOn(typed, "resolveReferralForWallet").mockResolvedValue(null);
    const feeSpy = vi.spyOn(typed, "recordFeeShare").mockResolvedValue(true);
    const pointsSpy = vi
      .spyOn(typed, "awardPoints")
      .mockResolvedValue(undefined);

    await service.recordExternalBet({
      bettorWallet: "0x1111111111111111111111111111111111111111",
      chain: "BASE",
      sourceAsset: "GOLD",
      sourceAmount: "2.5",
      goldAmount: "2.5",
      feeBps: 100,
      txSignature: "0xabc123",
      inviteCode: null,
      externalBetRef: "evm:base:match:13",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(feeSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(pointsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          verifiedForPoints: true,
        }),
      ),
    );
  });

  it("treats external bet tracking as idempotent by tx signature", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      resolveReferralForWallet: (params: {
        wallet: string;
        betId: string;
        inviteCode: string | null;
      }) => Promise<{ inviteCode: string; inviterWallet: string } | null>;
      recordFeeShare: (params: {
        roundId: string | null;
        betId: string;
        bettorWallet: string;
        goldAmount: string;
        feeBps: number;
        chain: "SOLANA" | "BSC" | "BASE";
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<boolean>;
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const feeSharesFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1,
        betId: "existing",
      });
    const pointsFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 9, betId: "existing" });

    const dbMock = {
      query: {
        arenaFeeShares: {
          findFirst: feeSharesFindFirst,
        },
        arenaPoints: {
          findFirst: pointsFindFirst,
        },
      },
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "resolveReferralForWallet").mockResolvedValue(null);
    const feeSpy = vi.spyOn(typed, "recordFeeShare").mockResolvedValue(true);
    const pointsSpy = vi
      .spyOn(typed, "awardPoints")
      .mockResolvedValue(undefined);

    const firstId = await service.recordExternalBet({
      bettorWallet: "So11111111111111111111111111111111111111112",
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: "2.5",
      goldAmount: "2.5",
      feeBps: 100,
      txSignature: "solsamehash",
    });
    const secondId = await service.recordExternalBet({
      bettorWallet: "So11111111111111111111111111111111111111112",
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: "2.5",
      goldAmount: "2.5",
      feeBps: 100,
      txSignature: "solsamehash",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(firstId).toBe(secondId);
    expect(feeSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(pointsSpy).toHaveBeenCalledTimes(1));
  });

  it("retries external points on replay when fee-share exists but points row is missing", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    vi.spyOn(typed, "getDb").mockReturnValue({
      query: {
        arenaFeeShares: {
          findFirst: vi.fn().mockResolvedValue({
            id: 2,
            betId: "existing",
            inviteCode: "DUELSYNC11",
            inviterWallet: "inviter_wallet",
          }),
        },
        arenaPoints: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as never);
    const pointsSpy = vi
      .spyOn(typed, "awardPoints")
      .mockResolvedValue(undefined);

    await service.recordExternalBet({
      bettorWallet: "So11111111111111111111111111111111111111112",
      chain: "SOLANA",
      sourceAsset: "GOLD",
      sourceAmount: "2.5",
      goldAmount: "2.5",
      feeBps: 100,
      txSignature: "solsamehash",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(pointsSpy).toHaveBeenCalledTimes(1);
    expect(pointsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedForPoints: false,
        referral: {
          inviteCode: "DUELSYNC11",
          inviterWallet: "inviter_wallet",
        },
      }),
    );
  });

  it("enforces 1k/100k/1m tiers with 10-day bonus", () => {
    const service = createService();
    const typed = service as unknown as {
      computeGoldMultiplier: (goldBalance: number, holdDays: number) => number;
    };

    expect(typed.computeGoldMultiplier(0, 0)).toBe(0);
    expect(typed.computeGoldMultiplier(999, 365)).toBe(0);
    expect(typed.computeGoldMultiplier(1_000, 365)).toBe(1);
    expect(typed.computeGoldMultiplier(99_999, 365)).toBe(1);
    expect(typed.computeGoldMultiplier(100_000, 9)).toBe(2);
    expect(typed.computeGoldMultiplier(100_000, 10)).toBe(3);
    expect(typed.computeGoldMultiplier(999_999, 9)).toBe(2);
    expect(typed.computeGoldMultiplier(999_999, 10)).toBe(3);
    expect(typed.computeGoldMultiplier(1_000_000, 9)).toBe(3);
    expect(typed.computeGoldMultiplier(1_000_000, 10)).toBe(4);
  });

  it("skips awarding points when bet evidence is not verifiable", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const dbMock = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);

    await typed.awardPoints({
      wallet: "bettor_wallet",
      roundId: "round_1",
      roundSeedHex: "deadbeef",
      betId: "bet_unverified",
      sourceAsset: "SOL",
      goldAmount: "10",
      txSignature: null,
      side: "A",
      verifiedForPoints: false,
      referral: null,
    });

    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
