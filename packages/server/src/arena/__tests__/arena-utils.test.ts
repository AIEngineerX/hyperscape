import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addDecimalAmounts,
  normalizeWallet,
  normalizeSide,
  normalizeInviteCode,
  computePowerScore,
  isLikelySolanaWallet,
  readBooleanEnv,
  readIntegerEnv,
  coerceArenaPhase,
  coerceArenaWinReason,
} from "../arena-utils.js";

describe("addDecimalAmounts", () => {
  it("adds two whole numbers", () => {
    expect(addDecimalAmounts("100", "200", 6)).toBe("300");
  });

  it("adds two decimal numbers", () => {
    expect(addDecimalAmounts("1.5", "2.3", 6)).toBe("3.8");
  });

  it("adds zero", () => {
    expect(addDecimalAmounts("100", "0", 6)).toBe("100");
  });

  it("handles precision correctly", () => {
    expect(addDecimalAmounts("0.000001", "0.000001", 6)).toBe("0.000002");
  });

  it("handles large sums", () => {
    expect(addDecimalAmounts("999999.999999", "0.000001", 6)).toBe("1000000");
  });

  it("1000 sequential adds produce correct sum", () => {
    let pool = "0";
    for (let i = 0; i < 1000; i++) {
      pool = addDecimalAmounts(pool, "1.5", 6);
    }
    expect(pool).toBe("1500");
  });
});

describe("normalizeWallet", () => {
  it("trims whitespace", () => {
    expect(normalizeWallet("  abc123  ")).toBe("abc123");
  });

  it("lowercases EVM addresses", () => {
    expect(normalizeWallet("0xABCDef1234567890abcdef1234567890ABCDEF12")).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("preserves Solana (non-0x) addresses", () => {
    const solana = "5FHwkrdxMaKyKYbPe9g2p4L23v3QTw3JHqNDv4SKFJZZ";
    expect(normalizeWallet(solana)).toBe(solana);
  });

  it("throws on empty string", () => {
    expect(() => normalizeWallet("")).toThrow("Wallet is required");
  });

  it("throws on whitespace-only string", () => {
    expect(() => normalizeWallet("   ")).toThrow("Wallet is required");
  });
});

describe("normalizeSide", () => {
  it("returns 'A' for 'A'", () => {
    expect(normalizeSide("A")).toBe("A");
  });

  it("returns 'B' for 'B'", () => {
    expect(normalizeSide("B")).toBe("B");
  });

  it("returns 'B' for any other string", () => {
    expect(normalizeSide("C")).toBe("B");
    expect(normalizeSide("")).toBe("B");
  });
});

describe("normalizeInviteCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeInviteCode("  abcd  ")).toBe("ABCD");
  });

  it("accepts valid codes", () => {
    expect(normalizeInviteCode("HYPERSCAPE-2024")).toBe("HYPERSCAPE-2024");
  });

  it("throws on too-short codes", () => {
    expect(() => normalizeInviteCode("AB")).toThrow("format is invalid");
  });

  it("throws on special characters", () => {
    expect(() => normalizeInviteCode("code!@#")).toThrow("format is invalid");
  });
});

describe("computePowerScore", () => {
  it("sums all combat stats", () => {
    const score = computePowerScore({
      attackLevel: 99,
      strengthLevel: 99,
      defenseLevel: 99,
      constitutionLevel: 99,
      rangedLevel: 99,
      magicLevel: 99,
      prayerLevel: 99,
    });
    expect(score).toBe(693);
  });

  it("uses defaults for null stats", () => {
    const score = computePowerScore({
      attackLevel: null,
      strengthLevel: null,
      defenseLevel: null,
      constitutionLevel: null,
      rangedLevel: null,
      magicLevel: null,
      prayerLevel: null,
    });
    // 1+1+1+10+1+1+1 = 16
    expect(score).toBe(16);
  });
});

describe("isLikelySolanaWallet", () => {
  it("accepts valid base58 address", () => {
    expect(
      isLikelySolanaWallet("5FHwkrdxMaKyKYbPe9g2p4L23v3QTw3JHqNDv4SKFJZZ"),
    ).toBe(true);
  });

  it("rejects EVM address", () => {
    expect(
      isLikelySolanaWallet("0xabcdef1234567890abcdef1234567890abcdef12"),
    ).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isLikelySolanaWallet("")).toBe(false);
  });

  it("rejects too-short string", () => {
    expect(isLikelySolanaWallet("short")).toBe(false);
  });
});

describe("readBooleanEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns fallback when env var is unset", () => {
    delete process.env.TEST_BOOL;
    expect(readBooleanEnv("TEST_BOOL", true)).toBe(true);
    expect(readBooleanEnv("TEST_BOOL", false)).toBe(false);
  });

  it("parses truthy values", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "Yes"]) {
      process.env.TEST_BOOL = v;
      expect(readBooleanEnv("TEST_BOOL", false)).toBe(true);
    }
  });

  it("parses falsy values", () => {
    for (const v of ["0", "false", "no", "off", "FALSE", "No"]) {
      process.env.TEST_BOOL = v;
      expect(readBooleanEnv("TEST_BOOL", true)).toBe(false);
    }
  });

  it("returns fallback for unrecognized value", () => {
    process.env.TEST_BOOL = "maybe";
    expect(readBooleanEnv("TEST_BOOL", true)).toBe(true);
  });
});

describe("readIntegerEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns fallback when unset", () => {
    delete process.env.TEST_INT;
    expect(readIntegerEnv("TEST_INT", 42, 0)).toBe(42);
  });

  it("parses valid integer", () => {
    process.env.TEST_INT = "100";
    expect(readIntegerEnv("TEST_INT", 42, 0)).toBe(100);
  });

  it("clamps to min", () => {
    process.env.TEST_INT = "-5";
    expect(readIntegerEnv("TEST_INT", 42, 0)).toBe(0);
  });

  it("clamps to max", () => {
    process.env.TEST_INT = "999";
    expect(readIntegerEnv("TEST_INT", 42, 0, 100)).toBe(100);
  });

  it("returns fallback for non-numeric", () => {
    process.env.TEST_INT = "abc";
    expect(readIntegerEnv("TEST_INT", 42, 0)).toBe(42);
  });
});

describe("coerceArenaPhase", () => {
  it("accepts valid phases", () => {
    expect(coerceArenaPhase("BET_OPEN")).toBe("BET_OPEN");
    expect(coerceArenaPhase("DUEL_ACTIVE")).toBe("DUEL_ACTIVE");
    expect(coerceArenaPhase("COMPLETE")).toBe("COMPLETE");
  });

  it("returns null for invalid phase", () => {
    expect(coerceArenaPhase("INVALID")).toBeNull();
    expect(coerceArenaPhase("")).toBeNull();
  });
});

describe("coerceArenaWinReason", () => {
  it("accepts valid reasons", () => {
    expect(coerceArenaWinReason("DEATH")).toBe("DEATH");
    expect(coerceArenaWinReason("TIME_DAMAGE")).toBe("TIME_DAMAGE");
  });

  it("returns null for invalid/null", () => {
    expect(coerceArenaWinReason(null)).toBeNull();
    expect(coerceArenaWinReason("INVALID")).toBeNull();
  });
});
