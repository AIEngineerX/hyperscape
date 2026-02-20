import { PublicKey } from "@solana/web3.js";

export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

export const GOLD_MAINNET_MINT = new PublicKey(
  "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
);

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

export const DEFAULT_BET_WINDOW_SECONDS = 300;

export const DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS = 300;

export const DEFAULT_AUTO_SEED_DELAY_SECONDS = 10;

export const DEFAULT_SEED_GOLD_AMOUNT = 1;

export const DEFAULT_BET_FEE_BPS = 100;

export const GOLD_DECIMALS = 6;

export const DEFAULT_REFRESH_INTERVAL_MS = 5000;

export function toBaseUnits(amount: number, decimals = GOLD_DECIMALS): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

function readEnvString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const DEFAULT_STREAM_URL = "http://localhost:4179/live/stream.m3u8";
const DEFAULT_GAME_API_URL = "http://localhost:5555";
const DEFAULT_GAME_WS_URL = "ws://localhost:5555/ws";
const DEFAULT_UI_SYNC_DELAY_MS = 2000;

export const STREAM_URL: string =
  readEnvString(import.meta.env.VITE_STREAM_URL) ?? DEFAULT_STREAM_URL;
export const GAME_API_URL: string =
  readEnvString(import.meta.env.VITE_GAME_API_URL) ?? DEFAULT_GAME_API_URL;
export const ARENA_EXTERNAL_BET_WRITE_KEY: string =
  import.meta.env.VITE_ARENA_EXTERNAL_BET_WRITE_KEY || "";
export const GAME_WS_URL: string =
  readEnvString(import.meta.env.VITE_GAME_WS_URL) ?? DEFAULT_GAME_WS_URL;
export const UI_SYNC_DELAY_MS: number = Math.max(
  0,
  readEnvNumber(import.meta.env.VITE_UI_SYNC_DELAY_MS) ??
    DEFAULT_UI_SYNC_DELAY_MS,
);

export function buildArenaWriteHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ARENA_EXTERNAL_BET_WRITE_KEY) {
    headers["x-arena-write-key"] = ARENA_EXTERNAL_BET_WRITE_KEY;
  }
  return headers;
}

export function getFixedMatchId(): number | null {
  return null;
}

export function getCluster(): SolanaCluster {
  return "devnet";
}

export function getRpcUrl(): string {
  const cluster = getCluster();
  const configured = import.meta.env.VITE_SOLANA_RPC_URL;
  if (configured) return configured;

  if (cluster === "localnet") {
    return "http://127.0.0.1:8899";
  }

  if (cluster === "devnet") {
    return "https://api.devnet.solana.com";
  }

  if (cluster === "testnet") {
    return "https://api.testnet.solana.com";
  }

  return `${GAME_API_URL}/api/proxy/helius/rpc`;
}

export function getWsUrl(): string | undefined {
  const configured = import.meta.env.VITE_SOLANA_WS_URL;
  if (configured) return configured;

  if (getCluster() === "localnet") {
    return "ws://127.0.0.1:8900";
  }

  if (getCluster() === "devnet") {
    return "wss://api.devnet.solana.com/";
  }

  if (getCluster() === "testnet") {
    return "wss://api.testnet.solana.com/";
  }

  // WebSockets must be proxied or use GAME_WS_URL base
  const host = GAME_API_URL.replace(/^http/, "ws");
  return `${host}/api/proxy/helius/ws`;
}

// ============================================================================
// EVM Chain Configuration
// ============================================================================

export const BSC_RPC_URL: string =
  "https://data-seed-prebsc-1-s1.binance.org:8545";
export const BSC_CHAIN_ID: number = 97;
export const BSC_GOLD_CLOB_ADDRESS: string = "";
export const BSC_GOLD_TOKEN_ADDRESS: string = "";

export const BASE_RPC_URL: string = "https://sepolia.base.org";
export const BASE_CHAIN_ID: number = 84532;
export const BASE_GOLD_CLOB_ADDRESS: string = "";
export const BASE_GOLD_TOKEN_ADDRESS: string = "";
