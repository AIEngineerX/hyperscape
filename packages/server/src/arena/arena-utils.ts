import crypto from "node:crypto";
import type {
  ArenaFeeChain,
  ArenaFeePlatform,
  ArenaPhase,
  ArenaWinReason,
} from "./types.js";
import {
  parseDecimalToBaseUnits,
  formatBaseUnitsToDecimal,
} from "./amounts.js";

export function nowMs(): number {
  return Date.now();
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function buildRoundSeedHex(roundId: string): string {
  return sha256Hex(`arena:round-seed:${roundId}`);
}

export function addDecimalAmounts(
  left: string,
  right: string,
  decimals: number,
): string {
  const leftUnits = parseDecimalToBaseUnits(left, decimals);
  const rightUnits = parseDecimalToBaseUnits(right, decimals);
  return formatBaseUnitsToDecimal(leftUnits + rightUnits, decimals);
}

export function pickRandom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index] as T;
}

export function computePowerScore(candidate: {
  attackLevel: number | null;
  strengthLevel: number | null;
  defenseLevel: number | null;
  constitutionLevel: number | null;
  rangedLevel: number | null;
  magicLevel: number | null;
  prayerLevel: number | null;
}): number {
  return (
    (candidate.attackLevel ?? 1) +
    (candidate.strengthLevel ?? 1) +
    (candidate.defenseLevel ?? 1) +
    (candidate.constitutionLevel ?? 10) +
    (candidate.rangedLevel ?? 1) +
    (candidate.magicLevel ?? 1) +
    (candidate.prayerLevel ?? 1)
  );
}

export function normalizeSide(side: "A" | "B" | string): "A" | "B" {
  return side === "A" ? "A" : "B";
}

export function normalizeWallet(wallet: string): string {
  const value = wallet.trim();
  if (!value) {
    throw new Error("Wallet is required");
  }
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return value.toLowerCase();
  }
  return value;
}

export function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on")
    return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return fallback;
}

export function readIntegerEnv(
  name: string,
  fallback: number,
  minValue: number,
  maxValue?: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const boundedMin = Math.max(minValue, parsed);
  if (maxValue == null) return boundedMin;
  return Math.min(maxValue, boundedMin);
}

export function isLikelyDevelopmentRuntime(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  if (nodeEnv === "development" || nodeEnv === "dev" || nodeEnv === "test") {
    return true;
  }
  const entry = process.argv[1] ?? "";
  return (
    entry.includes(
      `${process.platform === "win32" ? "\\" : "/"}build${process.platform === "win32" ? "\\" : "/"}index.js`,
    ) ||
    entry.includes("/build/index.js") ||
    entry.includes("\\build\\index.js")
  );
}

export function isLikelySolanaWallet(walletRaw: string): boolean {
  const wallet = walletRaw.trim();
  if (!wallet) return false;
  if (wallet.startsWith("0x") || wallet.startsWith("0X")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
}

export function normalizeInviteCode(inviteCode: string): string {
  const value = inviteCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(value)) {
    throw new Error("Invite code format is invalid");
  }
  return value;
}

export function normalizeFeeChain(chainRaw: string): ArenaFeeChain {
  const value = chainRaw.trim().toUpperCase();
  if (value === "SOLANA" || value === "BSC" || value === "BASE") {
    return value;
  }
  throw new Error("Unsupported chain. Expected SOLANA, BSC, or BASE");
}

export function normalizeFeePlatform(
  platformRaw: string | null | undefined,
): ArenaFeePlatform {
  if (!platformRaw) return "ALL";
  const value = platformRaw.trim().toUpperCase();
  if (
    value === "ALL" ||
    value === "EVM" ||
    value === "SOLANA" ||
    value === "BSC" ||
    value === "BASE"
  ) {
    return value;
  }
  throw new Error(
    "Unsupported platform. Expected all, evm, solana, bsc, or base",
  );
}

export function feeChainsForPlatform(
  platform: ArenaFeePlatform,
): ArenaFeeChain[] {
  if (platform === "SOLANA") {
    return ["SOLANA"];
  }
  if (platform === "EVM" || platform === "BSC" || platform === "BASE") {
    return ["BSC", "BASE"];
  }
  return ["SOLANA", "BSC", "BASE"];
}

export function walletChainFamily(chain: ArenaFeeChain): "SOLANA" | "EVM" {
  return chain === "SOLANA" ? "SOLANA" : "EVM";
}

export function normalizeWalletForChain(
  walletRaw: string,
  chain: ArenaFeeChain,
): string {
  const wallet = normalizeWallet(walletRaw);
  if (chain === "SOLANA") {
    if (!isLikelySolanaWallet(wallet)) {
      throw new Error("Solana wallet must be a valid base58 address");
    }
    return wallet;
  }

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw new Error("EVM wallet must be a valid 0x address");
  }
  return wallet;
}

export function walletLinkPairKey(params: {
  leftWallet: string;
  leftPlatform: ArenaFeeChain;
  rightWallet: string;
  rightPlatform: ArenaFeeChain;
}): string {
  const left = `${walletChainFamily(params.leftPlatform)}:${params.leftWallet}`;
  const right = `${walletChainFamily(params.rightPlatform)}:${params.rightWallet}`;
  return [left, right].sort().join("|");
}

export const VALID_ARENA_PHASES: ReadonlySet<ArenaPhase> = new Set([
  "PREVIEW_CAMS",
  "BET_OPEN",
  "BET_LOCK",
  "DUEL_ACTIVE",
  "RESULT_SHOW",
  "ORACLE_REPORT",
  "MARKET_RESOLVE",
  "RESTORE",
  "COMPLETE",
]);

export const VALID_ARENA_WIN_REASONS: ReadonlySet<ArenaWinReason> = new Set([
  "DEATH",
  "TIME_DAMAGE",
]);

export function coerceArenaPhase(value: string): ArenaPhase | null {
  if (VALID_ARENA_PHASES.has(value as ArenaPhase)) {
    return value as ArenaPhase;
  }
  return null;
}

export function coerceArenaWinReason(
  value: string | null,
): ArenaWinReason | null {
  if (!value) return null;
  if (VALID_ARENA_WIN_REASONS.has(value as ArenaWinReason)) {
    return value as ArenaWinReason;
  }
  return null;
}

export const MAX_HISTORY = 50;
