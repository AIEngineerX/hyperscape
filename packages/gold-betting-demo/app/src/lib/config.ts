import { PublicKey } from "@solana/web3.js";

export type SolanaCluster = "localnet" | "testnet" | "mainnet-beta";

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

export function getFixedMatchId(): number | null {
  const value = import.meta.env.VITE_ACTIVE_MATCH_ID;
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function getCluster(): SolanaCluster {
  const value = import.meta.env.VITE_SOLANA_CLUSTER;
  if (value === "localnet" || value === "testnet" || value === "mainnet-beta")
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

  if (cluster === "testnet") {
    return "https://api.testnet.solana.com";
  }

  const heliusApiKey = import.meta.env.VITE_HELIUS_API_KEY;
  if (!heliusApiKey) {
    return "https://api.mainnet-beta.solana.com";
  }

  return `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
}

export function getWsUrl(): string | undefined {
  const configured = import.meta.env.VITE_SOLANA_WS_URL;
  if (configured) return configured;

  if (getCluster() === "localnet") {
    return "ws://127.0.0.1:8900";
  }

  if (getCluster() === "testnet") {
    return "wss://api.testnet.solana.com/";
  }

  const heliusApiKey = import.meta.env.VITE_HELIUS_API_KEY;
  if (!heliusApiKey) return undefined;
  return `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
}
