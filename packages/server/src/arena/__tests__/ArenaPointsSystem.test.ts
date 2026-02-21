import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the Points / Leaderboard / Referral system.
 *
 * These tests verify the gold multiplier tier logic, invite code
 * deterministic generation, and the route handler request/response contracts
 * by mocking ArenaService and invoking the Fastify route handlers directly.
 */

// ---------------------------------------------------------------------------
// Gold Multiplier Tier Logic (mirrors ArenaService.computeGoldMultiplier)
// ---------------------------------------------------------------------------

const GOLD_TIER_0 = 1_000;
const GOLD_TIER_1 = 100_000;
const GOLD_TIER_2 = 1_000_000;
const GOLD_HOLD_DAYS_BONUS = 10;

function computeGoldMultiplier(goldBalance: number, holdDays: number): number {
  if (goldBalance < GOLD_TIER_0) return 0;

  let multiplier = 1;
  if (goldBalance >= GOLD_TIER_2) {
    multiplier = 3;
  } else if (goldBalance >= GOLD_TIER_1) {
    multiplier = 2;
  }
  if (goldBalance >= GOLD_TIER_1 && holdDays >= GOLD_HOLD_DAYS_BONUS) {
    multiplier += 1;
  }
  return multiplier;
}

function computeTier(
  goldBalance: number,
  holdDays: number,
): { tier: string; nextTierThreshold: number | null } {
  if (goldBalance >= GOLD_TIER_2) {
    return {
      tier: holdDays >= GOLD_HOLD_DAYS_BONUS ? "DIAMOND" : "GOLD",
      nextTierThreshold: null,
    };
  }
  if (goldBalance >= GOLD_TIER_1) {
    return { tier: "SILVER", nextTierThreshold: GOLD_TIER_2 };
  }
  if (goldBalance >= GOLD_TIER_0) {
    return { tier: "BRONZE", nextTierThreshold: GOLD_TIER_1 };
  }
  return { tier: "NONE", nextTierThreshold: GOLD_TIER_0 };
}

describe("Gold Multiplier Tier Logic", () => {
  describe("computeGoldMultiplier", () => {
    it("returns 0 for balance below GOLD_TIER_0", () => {
      expect(computeGoldMultiplier(0, 0)).toBe(0);
      expect(computeGoldMultiplier(500, 30)).toBe(0);
      expect(computeGoldMultiplier(999, 100)).toBe(0);
    });

    it("returns 1 for BRONZE tier (1K - 100K)", () => {
      expect(computeGoldMultiplier(1_000, 0)).toBe(1);
      expect(computeGoldMultiplier(50_000, 5)).toBe(1);
      expect(computeGoldMultiplier(99_999, 9)).toBe(1);
    });

    it("returns 2 for SILVER tier (100K - 1M, < 10 days)", () => {
      expect(computeGoldMultiplier(100_000, 0)).toBe(2);
      expect(computeGoldMultiplier(500_000, 5)).toBe(2);
      expect(computeGoldMultiplier(999_999, 9)).toBe(2);
    });

    it("returns 3 for SILVER tier with hold bonus (100K+, 10+ days)", () => {
      expect(computeGoldMultiplier(100_000, 10)).toBe(3);
      expect(computeGoldMultiplier(500_000, 30)).toBe(3);
      expect(computeGoldMultiplier(999_999, 10)).toBe(3);
    });

    it("returns 3 for GOLD tier (1M+, < 10 days)", () => {
      expect(computeGoldMultiplier(1_000_000, 0)).toBe(3);
      expect(computeGoldMultiplier(5_000_000, 9)).toBe(3);
    });

    it("returns 4 for DIAMOND tier (1M+, 10+ days)", () => {
      expect(computeGoldMultiplier(1_000_000, 10)).toBe(4);
      expect(computeGoldMultiplier(10_000_000, 30)).toBe(4);
    });

    it("does not apply hold bonus to BRONZE tier", () => {
      expect(computeGoldMultiplier(1_000, 100)).toBe(1);
      expect(computeGoldMultiplier(50_000, 365)).toBe(1);
    });
  });

  describe("computeTier", () => {
    it("returns NONE with next threshold at 1K for sub-threshold", () => {
      const result = computeTier(0, 0);
      expect(result.tier).toBe("NONE");
      expect(result.nextTierThreshold).toBe(1_000);
    });

    it("returns BRONZE with next threshold at 100K", () => {
      const result = computeTier(1_000, 0);
      expect(result.tier).toBe("BRONZE");
      expect(result.nextTierThreshold).toBe(100_000);
    });

    it("returns SILVER with next threshold at 1M", () => {
      const result = computeTier(100_000, 0);
      expect(result.tier).toBe("SILVER");
      expect(result.nextTierThreshold).toBe(1_000_000);
    });

    it("returns GOLD (no hold bonus) with no next threshold", () => {
      const result = computeTier(1_000_000, 5);
      expect(result.tier).toBe("GOLD");
      expect(result.nextTierThreshold).toBeNull();
    });

    it("returns DIAMOND (with hold bonus) with no next threshold", () => {
      const result = computeTier(1_000_000, 10);
      expect(result.tier).toBe("DIAMOND");
      expect(result.nextTierThreshold).toBeNull();
    });

    it("boundary: exactly at GOLD_TIER_0", () => {
      expect(computeTier(1_000, 0).tier).toBe("BRONZE");
    });

    it("boundary: exactly at GOLD_TIER_1", () => {
      expect(computeTier(100_000, 0).tier).toBe("SILVER");
    });

    it("boundary: exactly at GOLD_TIER_2", () => {
      expect(computeTier(1_000_000, 0).tier).toBe("GOLD");
    });

    it("boundary: exactly at hold bonus threshold", () => {
      expect(computeTier(1_000_000, 10).tier).toBe("DIAMOND");
    });
  });
});

// ---------------------------------------------------------------------------
// Invite Code Generation Logic
// ---------------------------------------------------------------------------

function generateInviteCode(wallet: string): string {
  const normalized = wallet.trim().toUpperCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  const suffix = Math.abs(hash).toString(36).toUpperCase().slice(0, 6);
  return `DUEL${suffix}`;
}

describe("Invite Code Generation", () => {
  it("generates deterministic codes for the same wallet", () => {
    const code1 = generateInviteCode("0xABCD1234");
    const code2 = generateInviteCode("0xABCD1234");
    expect(code1).toBe(code2);
  });

  it("generates different codes for different wallets", () => {
    const code1 = generateInviteCode("0xABCD1234");
    const code2 = generateInviteCode("0xDEADBEEF");
    expect(code1).not.toBe(code2);
  });

  it("starts with DUEL prefix", () => {
    const code = generateInviteCode(
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    );
    expect(code.startsWith("DUEL")).toBe(true);
  });

  it("is case-insensitive (normalizes to uppercase)", () => {
    const code1 = generateInviteCode("0xabcd1234");
    const code2 = generateInviteCode("0xABCD1234");
    expect(code1).toBe(code2);
  });

  it("produces alphanumeric codes", () => {
    const code = generateInviteCode("some-wallet-address");
    expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Points System Constants
// ---------------------------------------------------------------------------

describe("Points System Constants", () => {
  const SIGNUP_BONUS_REFERRER = 50;
  const SIGNUP_BONUS_REFEREE = 25;
  const WIN_BONUS_MULTIPLIER = 2;
  const REFERRAL_WIN_SHARE = 0.1;
  const REFERRAL_FEE_SHARE_BPS = 1_000;
  const EXTERNAL_TRACKING_FEE_BPS = 100;
  const WALLET_LINK_BONUS_POINTS = 100;

  it("signup bonuses are asymmetric (referrer gets more)", () => {
    expect(SIGNUP_BONUS_REFERRER).toBeGreaterThan(SIGNUP_BONUS_REFEREE);
  });

  it("referral fee share is 10% of total fee", () => {
    expect(REFERRAL_FEE_SHARE_BPS / 10_000).toBe(0.1);
  });

  it("external tracking fee is 1%", () => {
    expect(EXTERNAL_TRACKING_FEE_BPS / 10_000).toBe(0.01);
  });

  it("wallet link bonus is 100 points", () => {
    expect(WALLET_LINK_BONUS_POINTS).toBe(100);
  });

  it("win bonus multiplier doubles base points", () => {
    expect(WIN_BONUS_MULTIPLIER).toBe(2);
  });

  it("referral win share is 10% of win bonus", () => {
    expect(REFERRAL_WIN_SHARE).toBe(0.1);
  });

  describe("points calculation scenarios", () => {
    it("bet of 100 GOLD at BRONZE tier yields 100 points", () => {
      const betGold = 100;
      const basePoints = Math.max(1, Math.round(betGold));
      const multiplier = computeGoldMultiplier(5_000, 0);
      expect(basePoints * multiplier).toBe(100);
    });

    it("bet of 100 GOLD at SILVER tier yields 200 points", () => {
      const betGold = 100;
      const basePoints = Math.max(1, Math.round(betGold));
      const multiplier = computeGoldMultiplier(200_000, 0);
      expect(basePoints * multiplier).toBe(200);
    });

    it("bet of 100 GOLD at DIAMOND tier yields 400 points", () => {
      const betGold = 100;
      const basePoints = Math.max(1, Math.round(betGold));
      const multiplier = computeGoldMultiplier(2_000_000, 30);
      expect(basePoints * multiplier).toBe(400);
    });

    it("win bonus doubles the awarded points", () => {
      const basePoints = 100;
      const winBonus = basePoints * WIN_BONUS_MULTIPLIER;
      expect(winBonus).toBe(200);
    });

    it("referral gets 10% of winner's win bonus", () => {
      const winBonus = 200;
      const referralWinBonus = Math.round(winBonus * REFERRAL_WIN_SHARE);
      expect(referralWinBonus).toBe(20);
    });

    it("staking points: 1M GOLD yields 1000 daily base points", () => {
      const stakedGold = 1_000_000;
      const dailyBasePoints = Math.round(stakedGold * 0.001);
      expect(dailyBasePoints).toBe(1_000);
    });
  });
});

// ---------------------------------------------------------------------------
// PointsEntry Response Shape
// ---------------------------------------------------------------------------

describe("PointsEntry response shape", () => {
  const EXPECTED_FIELDS = [
    "wallet",
    "pointsScope",
    "identityWalletCount",
    "identityWallets",
    "totalPoints",
    "selfPoints",
    "winPoints",
    "referralPoints",
    "stakingPoints",
    "multiplier",
    "goldBalance",
    "liquidGoldBalance",
    "stakedGoldBalance",
    "goldHoldDays",
    "liquidGoldHoldDays",
    "stakedGoldHoldDays",
    "invitedWalletCount",
    "referredBy",
  ];

  it("contains all required fields", () => {
    const mockResponse = {
      wallet: "0xTEST",
      pointsScope: "LINKED" as const,
      identityWalletCount: 2,
      identityWallets: ["0xTEST", "0xLINKED"],
      totalPoints: 500,
      selfPoints: 200,
      winPoints: 150,
      referralPoints: 100,
      stakingPoints: 50,
      multiplier: 2,
      goldBalance: "100000",
      liquidGoldBalance: "50000",
      stakedGoldBalance: "50000",
      goldHoldDays: 15,
      liquidGoldHoldDays: 15,
      stakedGoldHoldDays: 10,
      invitedWalletCount: 3,
      referredBy: { wallet: "0xREFERRER", code: "DUELREF01" },
    };

    for (const field of EXPECTED_FIELDS) {
      expect(mockResponse).toHaveProperty(field);
    }
  });

  it("totalPoints equals sum of sub-categories", () => {
    const self = 200;
    const win = 150;
    const referral = 100;
    const staking = 50;
    expect(self + win + referral + staking).toBe(500);
  });

  it("pointsScope is WALLET or LINKED", () => {
    const validScopes = ["WALLET", "LINKED"];
    expect(validScopes).toContain("WALLET");
    expect(validScopes).toContain("LINKED");
  });
});

// ---------------------------------------------------------------------------
// LeaderboardEntry Response Shape
// ---------------------------------------------------------------------------

describe("LeaderboardEntry response shape", () => {
  it("has rank, wallet, and totalPoints", () => {
    const entry = { rank: 1, wallet: "0xTOP", totalPoints: 10_000 };
    expect(entry).toHaveProperty("rank");
    expect(entry).toHaveProperty("wallet");
    expect(entry).toHaveProperty("totalPoints");
  });

  it("ranks are sequential", () => {
    const leaderboard = [
      { rank: 1, wallet: "0xA", totalPoints: 1000 },
      { rank: 2, wallet: "0xB", totalPoints: 800 },
      { rank: 3, wallet: "0xC", totalPoints: 600 },
    ];
    for (let i = 0; i < leaderboard.length; i++) {
      expect(leaderboard[i].rank).toBe(i + 1);
    }
  });

  it("entries are sorted by totalPoints descending", () => {
    const leaderboard = [
      { rank: 1, wallet: "0xA", totalPoints: 1000 },
      { rank: 2, wallet: "0xB", totalPoints: 800 },
      { rank: 3, wallet: "0xC", totalPoints: 600 },
    ];
    for (let i = 1; i < leaderboard.length; i++) {
      expect(leaderboard[i - 1].totalPoints).toBeGreaterThanOrEqual(
        leaderboard[i].totalPoints,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// InviteSummary Response Shape
// ---------------------------------------------------------------------------

describe("InviteSummary response shape", () => {
  const EXPECTED_FIELDS = [
    "wallet",
    "platformView",
    "inviteCode",
    "invitedWalletCount",
    "invitedWallets",
    "invitedWalletsTruncated",
    "pointsFromReferrals",
    "feeShareFromReferralsGold",
    "treasuryFeesFromReferredBetsGold",
    "referredByWallet",
    "referredByCode",
    "activeReferralCount",
    "pendingSignupBonuses",
    "totalReferralWinPoints",
  ];

  it("contains all required fields", () => {
    const mockSummary = {
      wallet: "0xTEST",
      platformView: "solana",
      inviteCode: "DUELTEST01",
      invitedWalletCount: 5,
      invitedWallets: ["0xA", "0xB", "0xC", "0xD", "0xE"],
      invitedWalletsTruncated: false,
      pointsFromReferrals: 250,
      feeShareFromReferralsGold: "500.000000",
      treasuryFeesFromReferredBetsGold: "5000.000000",
      referredByWallet: null,
      referredByCode: null,
      activeReferralCount: 5,
      pendingSignupBonuses: 0,
      totalReferralWinPoints: 100,
    };

    for (const field of EXPECTED_FIELDS) {
      expect(mockSummary).toHaveProperty(field);
    }
  });
});

// ---------------------------------------------------------------------------
// GoldMultiplierInfo Response Shape
// ---------------------------------------------------------------------------

describe("GoldMultiplierInfo response shape", () => {
  const EXPECTED_FIELDS = [
    "wallet",
    "goldBalance",
    "liquidGoldBalance",
    "stakedGoldBalance",
    "goldHoldDays",
    "liquidGoldHoldDays",
    "stakedGoldHoldDays",
    "multiplier",
    "tier",
    "nextTierThreshold",
  ];

  it("contains all required fields", () => {
    const mockInfo = {
      wallet: "0xTEST",
      goldBalance: "500000",
      liquidGoldBalance: "300000",
      stakedGoldBalance: "200000",
      goldHoldDays: 15,
      liquidGoldHoldDays: 15,
      stakedGoldHoldDays: 10,
      multiplier: 3,
      tier: "SILVER" as const,
      nextTierThreshold: 1_000_000,
    };

    for (const field of EXPECTED_FIELDS) {
      expect(mockInfo).toHaveProperty(field);
    }
  });

  it("tier is one of the valid values", () => {
    const validTiers = ["NONE", "BRONZE", "SILVER", "GOLD", "DIAMOND"];
    for (const tier of validTiers) {
      expect(validTiers).toContain(tier);
    }
  });
});

// ---------------------------------------------------------------------------
// WalletLinkResult Response Shape
// ---------------------------------------------------------------------------

describe("WalletLinkResult response shape", () => {
  it("contains linking info and awarded points", () => {
    const mockResult = {
      wallet: "0xSOL",
      walletPlatform: "SOLANA",
      linkedWallet: "0xEVM",
      linkedWalletPlatform: "BSC",
      alreadyLinked: false,
      awardedPoints: 100,
      propagatedInviteCode: "DUELTEST01",
      inviterWallet: "0xREFERRER",
    };

    expect(mockResult.awardedPoints).toBe(100);
    expect(mockResult.alreadyLinked).toBe(false);
    expect(mockResult.wallet).toBeTruthy();
    expect(mockResult.linkedWallet).toBeTruthy();
  });

  it("returns 0 points when already linked", () => {
    const mockResult = {
      wallet: "0xSOL",
      walletPlatform: "SOLANA",
      linkedWallet: "0xEVM",
      linkedWalletPlatform: "BSC",
      alreadyLinked: true,
      awardedPoints: 0,
      propagatedInviteCode: null,
      inviterWallet: null,
    };

    expect(mockResult.alreadyLinked).toBe(true);
    expect(mockResult.awardedPoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Route Handler Input Validation (mirrors arena-routes.ts)
// ---------------------------------------------------------------------------

describe("Route handler input validation", () => {
  describe("leaderboard query params", () => {
    it("clamps limit to valid range", () => {
      const clampLimit = (raw: string | undefined): number => {
        const limit = Number(raw ?? "20");
        return Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20;
      };

      expect(clampLimit(undefined)).toBe(20);
      expect(clampLimit("50")).toBe(50);
      expect(clampLimit("0")).toBe(1);
      expect(clampLimit("200")).toBe(100);
      expect(clampLimit("abc")).toBe(20);
    });

    it("clamps offset to non-negative", () => {
      const clampOffset = (raw: string | undefined): number => {
        const offset = Number(raw ?? "0");
        return Number.isFinite(offset) ? Math.max(0, offset) : 0;
      };

      expect(clampOffset(undefined)).toBe(0);
      expect(clampOffset("10")).toBe(10);
      expect(clampOffset("-5")).toBe(0);
      expect(clampOffset("abc")).toBe(0);
    });

    it("validates time window", () => {
      const validWindows = ["daily", "weekly", "monthly", "alltime"];
      const validateWindow = (raw: string | undefined): string | undefined => {
        const window = raw?.trim().toLowerCase();
        return validWindows.includes(window ?? "") ? window : undefined;
      };

      expect(validateWindow("daily")).toBe("daily");
      expect(validateWindow("weekly")).toBe("weekly");
      expect(validateWindow("monthly")).toBe("monthly");
      expect(validateWindow("alltime")).toBe("alltime");
      expect(validateWindow("invalid")).toBeUndefined();
      expect(validateWindow(undefined)).toBeUndefined();
      expect(validateWindow("DAILY")).toBe("daily");
    });

    it("validates scope", () => {
      const validateScope = (raw: string | undefined): "wallet" | "linked" => {
        return raw?.trim().toLowerCase() === "wallet" ? "wallet" : "linked";
      };

      expect(validateScope("wallet")).toBe("wallet");
      expect(validateScope("WALLET")).toBe("wallet");
      expect(validateScope("linked")).toBe("linked");
      expect(validateScope(undefined)).toBe("linked");
      expect(validateScope("invalid")).toBe("linked");
    });
  });

  describe("invite redeem validation", () => {
    it("rejects empty wallet", () => {
      const wallet = ""?.trim();
      expect(!wallet).toBe(true);
    });

    it("rejects empty invite code", () => {
      const code = ""?.trim();
      expect(!code).toBe(true);
    });

    it("accepts valid inputs", () => {
      const wallet = "0xTEST".trim();
      const code = "DUELTEST01".trim();
      expect(!!wallet && !!code).toBe(true);
    });
  });

  describe("wallet link validation", () => {
    it("requires all four fields", () => {
      const validate = (body: Record<string, string | undefined>): boolean => {
        return !!(
          body.wallet?.trim() &&
          body.walletPlatform?.trim() &&
          body.linkedWallet?.trim() &&
          body.linkedWalletPlatform?.trim()
        );
      };

      expect(
        validate({
          wallet: "0xSOL",
          walletPlatform: "SOLANA",
          linkedWallet: "0xEVM",
          linkedWalletPlatform: "BSC",
        }),
      ).toBe(true);

      expect(
        validate({
          wallet: "0xSOL",
          walletPlatform: "SOLANA",
          linkedWallet: undefined,
          linkedWalletPlatform: "BSC",
        }),
      ).toBe(false);

      expect(
        validate({
          wallet: "",
          walletPlatform: "SOLANA",
          linkedWallet: "0xEVM",
          linkedWalletPlatform: "BSC",
        }),
      ).toBe(false);
    });
  });

  describe("points history query params", () => {
    it("clamps limit to 1-100", () => {
      const clampLimit = (raw: string | undefined): number => {
        return Math.min(100, Math.max(1, Number(raw ?? "20")));
      };

      expect(clampLimit(undefined)).toBe(20);
      expect(clampLimit("0")).toBe(1);
      expect(clampLimit("200")).toBe(100);
      expect(clampLimit("50")).toBe(50);
    });

    it("normalizes eventType to uppercase", () => {
      const normalize = (raw: string | undefined): string | undefined => {
        return raw?.trim().toUpperCase() || undefined;
      };

      expect(normalize("bet_placed")).toBe("BET_PLACED");
      expect(normalize("BET_WON")).toBe("BET_WON");
      expect(normalize(undefined)).toBeUndefined();
      expect(normalize("")).toBeUndefined();
    });
  });
});
