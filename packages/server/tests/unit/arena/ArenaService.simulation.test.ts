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

describe("ArenaService multiplier + abuse simulation matrix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects external SOLANA tracking when bettor wallet is not base58", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
    };

    vi.spyOn(typed, "getDb").mockReturnValue({ query: {} } as never);

    await expect(
      service.recordExternalBet({
        bettorWallet: "0x1111111111111111111111111111111111111111",
        chain: "SOLANA",
        sourceAsset: "GOLD",
        sourceAmount: "5",
        goldAmount: "5",
        feeBps: 100,
        txSignature: "sol_sig_invalid_wallet",
      }),
    ).rejects.toThrow("Solana wallet must be a valid base58 address");
  });

  it("rejects invite redemption when invite owner is already in linked identity", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    const wallet = "So11111111111111111111111111111111111111112";
    const linkedEvm = "0x1111111111111111111111111111111111111111";

    const dbMock = {
      query: {
        arenaInviteCodes: {
          findFirst: vi.fn().mockResolvedValue({
            code: "DUELSELFID1",
            inviterWallet: linkedEvm,
          }),
        },
        arenaInvitedWallets: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "listIdentityWallets").mockResolvedValue([
      wallet,
      linkedEvm,
    ]);

    await expect(
      service.redeemInviteCode({
        wallet,
        inviteCode: "DUELSELFID1",
      }),
    ).rejects.toThrow("own invite code");
  });

  it("simulates multiplier outcomes for verified bet points across tier boundaries", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
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
      awardPoints: (params: {
        wallet: string;
        roundId: string | null;
        roundSeedHex: string | null;
        marketPda?: string | null;
        betId: string;
        sourceAsset: "GOLD" | "SOL" | "USDC";
        goldAmount: string;
        txSignature: string | null;
        side: "A" | "B";
        verifiedForPoints: boolean;
        referral: { inviteCode: string; inviterWallet: string } | null;
      }) => Promise<void>;
    };

    const insertCalls: Array<{
      table: unknown;
      values: Record<string, unknown>;
    }> = [];
    const dbMock = {
      insert: vi.fn().mockImplementation((table: unknown) => ({
        values: vi
          .fn()
          .mockImplementation(async (values: Record<string, unknown>) => {
            insertCalls.push({ table, values });
            return undefined;
          }),
      })),
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "accrueStakingPointsIfDue").mockResolvedValue(undefined);

    const positionByWallet = new Map<
      string,
      { balance: number; holdDays: number }
    >([
      ["wallet_tier0", { balance: 500, holdDays: 30 }],
      ["wallet_tier1", { balance: 1_000, holdDays: 5 }],
      ["wallet_tier2", { balance: 100_000, holdDays: 9 }],
      ["wallet_tier3", { balance: 100_000, holdDays: 10 }],
      ["wallet_tier4", { balance: 1_000_000, holdDays: 12 }],
    ]);

    vi.spyOn(typed, "fetchGoldPositionForWallet").mockImplementation(
      async (wallet) => {
        const position = positionByWallet.get(wallet);
        if (!position) {
          return {
            liquidGoldBalance: 0,
            stakedGoldBalance: 0,
            goldBalance: 0,
            liquidGoldHoldDays: 0,
            stakedGoldHoldDays: 0,
            goldHoldDays: 0,
            stakingSource: "NONE",
          };
        }
        return {
          liquidGoldBalance: position.balance,
          stakedGoldBalance: 0,
          goldBalance: position.balance,
          liquidGoldHoldDays: position.holdDays,
          stakedGoldHoldDays: 0,
          goldHoldDays: position.holdDays,
          stakingSource: "SIM",
        };
      },
    );

    const scenarios = [
      { wallet: "wallet_tier0", expectedMultiplier: 0, referral: null },
      { wallet: "wallet_tier1", expectedMultiplier: 1, referral: null },
      { wallet: "wallet_tier2", expectedMultiplier: 2, referral: null },
      { wallet: "wallet_tier3", expectedMultiplier: 3, referral: null },
      {
        wallet: "wallet_tier4",
        expectedMultiplier: 4,
        referral: {
          inviteCode: "DUELSIM999",
          inviterWallet: "inviter_wallet",
        },
      },
    ] as const;

    for (const [index, scenario] of scenarios.entries()) {
      await typed.awardPoints({
        wallet: scenario.wallet,
        roundId: null,
        roundSeedHex: null,
        marketPda: null,
        betId: `bet_sim_${index}`,
        sourceAsset: "GOLD",
        goldAmount: "2500",
        txSignature: `tx_sim_${index}`,
        side: "A",
        verifiedForPoints: true,
        referral: scenario.referral,
      });
    }

    const pointsRows = insertCalls
      .filter((call) => call.table === schema.arenaPoints)
      .map((call) => call.values);
    const referralRows = insertCalls
      .filter((call) => call.table === schema.arenaReferralPoints)
      .map((call) => call.values);

    // basePoints = round(2500 * 0.001) = 3
    expect(pointsRows).toHaveLength(5);
    expect(pointsRows.map((row) => row.multiplier)).toEqual([0, 1, 2, 3, 4]);
    expect(pointsRows.map((row) => row.totalPoints)).toEqual([0, 3, 6, 9, 12]);

    expect(referralRows).toHaveLength(1);
    expect(referralRows[0]).toEqual(
      expect.objectContaining({
        inviteCode: "DUELSIM999",
        inviterWallet: "inviter_wallet",
        invitedWallet: "wallet_tier4",
        basePoints: 3,
        multiplier: 1,
        totalPoints: 3,
      }),
    );
  });

  it("summarizes inviter swarms with hundreds of invited wallets", async () => {
    const service = createService();
    const typed = service as unknown as {
      getDb: () => unknown;
      findReferralMappingForWalletNetwork: (wallet: string) => Promise<unknown>;
      listIdentityWallets: (wallet: string) => Promise<string[]>;
    };

    const inviterWallet = "0x1111111111111111111111111111111111111111";
    const inviteRows = Array.from({ length: 200 }, (_, index) => ({
      invitedWallet: `wallet_${String(index + 1).padStart(3, "0")}`,
    }));

    const selectMock = vi
      .fn()
      .mockImplementation((fields: Record<string, unknown>) => {
        if ("count" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ count: 500 }]),
            }),
          };
        }
        if ("totalPoints" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ totalPoints: 12_345 }]),
            }),
          };
        }
        if ("inviterFeeGold" in fields) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValue([
                  { inviterFeeGold: "50", treasuryFeeGold: "450" },
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
            code: "DUELMASS500",
            inviterWallet,
          }),
        },
        arenaInvitedWallets: {
          findMany: vi.fn().mockResolvedValue(inviteRows),
        },
      },
      select: selectMock,
    };

    vi.spyOn(typed, "getDb").mockReturnValue(dbMock as never);
    vi.spyOn(typed, "findReferralMappingForWalletNetwork").mockResolvedValue(
      null,
    );
    vi.spyOn(typed, "listIdentityWallets").mockResolvedValue([inviterWallet]);

    const summary = await service.getInviteSummary(inviterWallet, "all");

    expect(summary.inviteCode).toBe("DUELMASS500");
    expect(summary.invitedWalletCount).toBe(500);
    expect(summary.invitedWallets).toHaveLength(200);
    expect(summary.invitedWalletsTruncated).toBe(true);
    expect(summary.pointsFromReferrals).toBe(12_345);
    expect(summary.feeShareFromReferralsGold).toBe("50");
    expect(summary.treasuryFeesFromReferredBetsGold).toBe("450");
  });

  it("treats identical tx signatures on different EVM chains as distinct bet ids", async () => {
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

    const firstId = await service.recordExternalBet({
      bettorWallet: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      chain: "BSC",
      sourceAsset: "GOLD",
      sourceAmount: "3",
      goldAmount: "3",
      feeBps: 100,
      txSignature: "0xdupedsignature",
      skipPoints: true,
    });
    const secondId = await service.recordExternalBet({
      bettorWallet: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      chain: "BASE",
      sourceAsset: "GOLD",
      sourceAmount: "3",
      goldAmount: "3",
      feeBps: 100,
      txSignature: "0xdupedsignature",
      skipPoints: true,
    });

    expect(firstId).not.toBe(secondId);
    expect(feeSpy).toHaveBeenCalledTimes(2);
    expect(feeSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chain: "BSC",
        bettorWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(feeSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chain: "BASE",
        bettorWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
  });
});
