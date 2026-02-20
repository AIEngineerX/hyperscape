import { PublicKey } from "@solana/web3.js";

export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

export const GOLD_MAINNET_MINT = new PublicKey(
  import.meta.env.VITE_GOLD_MINT ||
    "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
);

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

export const DEFAULT_BET_WINDOW_SECONDS = Number(
  import.meta.env.VITE_BET_WINDOW_SECONDS || 300,
);

export const DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS = Number(
  import.meta.env.VITE_NEW_ROUND_BET_WINDOW_SECONDS ||
    DEFAULT_BET_WINDOW_SECONDS,
);

export const DEFAULT_AUTO_SEED_DELAY_SECONDS = Number(
  import.meta.env.VITE_AUTO_SEED_DELAY_SECONDS || 10,
);

export const DEFAULT_SEED_GOLD_AMOUNT = Number(
  import.meta.env.VITE_MARKET_MAKER_SEED_GOLD || 1,
);

export const DEFAULT_BET_FEE_BPS = Number(
  import.meta.env.VITE_BET_FEE_BPS || 100,
);

export const GOLD_DECIMALS = Number(import.meta.env.VITE_GOLD_DECIMALS || 6);

export const DEFAULT_REFRESH_INTERVAL_MS = Number(
  import.meta.env.VITE_REFRESH_INTERVAL_MS || 5000,
);

export function toBaseUnits(amount: number, decimals = GOLD_DECIMALS): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

export const STREAM_URL = import.meta.env.VITE_STREAM_URL || "";
export const GAME_API_URL =
  import.meta.env.VITE_GAME_API_URL || "http://localhost:5555";
export const ARENA_EXTERNAL_BET_WRITE_KEY =
  import.meta.env.VITE_ARENA_EXTERNAL_BET_WRITE_KEY || "";
export const GAME_WS_URL =
  import.meta.env.VITE_GAME_WS_URL ||
  import.meta.env.VITE_WS_URL ||
  "ws://localhost:5555/ws";

export function getFixedMatchId(): number | null {
  const value = import.meta.env.VITE_ACTIVE_MATCH_ID;
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function getCluster(): SolanaCluster {
  const value = import.meta.env.VITE_SOLANA_CLUSTER;
  if (
    value === "localnet" ||
    value === "devnet" ||
    value === "testnet" ||
    value === "mainnet-beta"
  )
    return value;
  return "mainnet-beta";
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

export const BSC_RPC_URL =
  import.meta.env.VITE_BSC_RPC_URL ||
  "https://data-seed-prebsc-1-s1.binance.org:8545";
export const BSC_CHAIN_ID = Number(import.meta.env.VITE_BSC_CHAIN_ID || 97);
export const BSC_GOLD_CLOB_ADDRESS =
  import.meta.env.VITE_BSC_GOLD_CLOB_ADDRESS || "";
export const BSC_GOLD_TOKEN_ADDRESS =
  import.meta.env.VITE_BSC_GOLD_TOKEN_ADDRESS || "";

export const BASE_RPC_URL =
  import.meta.env.VITE_BASE_RPC_URL || "https://sepolia.base.org";
export const BASE_CHAIN_ID = Number(
  import.meta.env.VITE_BASE_CHAIN_ID || 84532,
);
export const BASE_GOLD_CLOB_ADDRESS =
  import.meta.env.VITE_BASE_GOLD_CLOB_ADDRESS || "";
export const BASE_GOLD_TOKEN_ADDRESS =
  import.meta.env.VITE_BASE_GOLD_TOKEN_ADDRESS || "";
