import { PublicKey } from "@solana/web3.js";

export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

// ============================================================================
// Environment Configuration
// ============================================================================

export type Environment =
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "localnet"
  | "e2e"
  | "stream-ui";

const ENVIRONMENT_ALIASES: Record<string, Environment> = {
  development: "devnet",
  dev: "devnet",
  devnet: "devnet",
  testnet: "testnet",
  production: "mainnet-beta",
  prod: "mainnet-beta",
  mainnet: "mainnet-beta",
  "mainnet-beta": "mainnet-beta",
  local: "localnet",
  localnet: "localnet",
  e2e: "e2e",
  "stream-ui": "stream-ui",
};

function readEnvString(name: string): string | undefined {
  const rawValue = import.meta.env[name];
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvNumber(name: string, fallback: number): number {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  return fallback;
}

function resolveEnvironment(): Environment {
  const explicitCluster = readEnvString("VITE_SOLANA_CLUSTER")?.toLowerCase();
  if (explicitCluster && ENVIRONMENT_ALIASES[explicitCluster]) {
    return ENVIRONMENT_ALIASES[explicitCluster];
  }

  const viteMode = readEnvString("MODE")?.toLowerCase();
  if (viteMode && ENVIRONMENT_ALIASES[viteMode]) {
    return ENVIRONMENT_ALIASES[viteMode];
  }

  return "devnet";
}

export const ACTIVE_ENV: Environment = resolveEnvironment();

export interface EnvConfig {
  cluster: SolanaCluster;
  rpcUrl: string;
  wsUrl?: string;
  fightOracleProgramId: string;
  goldBinaryMarketProgramId: string;
  goldMint: string;
  usdcMint?: string;
  betWindowSeconds: number;
  newRoundBetWindowSeconds: number;
  autoSeedDelaySeconds: number;
  marketMakerSeedGold: number;
  betFeeBps: number;
  goldDecimals: number;
  enableAutoSeed: boolean;
  gameApiUrl: string;
  gameWsUrl: string;
  streamUrl: string;
  uiSyncDelayMs: number;
  refreshIntervalMs: number;
  headlessWalletName: string;
  headlessWalletAutoConnect: boolean;
  headlessWalletSecretKey: string;
  jupiterBaseUrl: string;

  // EVM
  bscRpcUrl: string;
  bscChainId: number;
  bscGoldClobAddress: string;
  bscGoldTokenAddress: string;
  baseRpcUrl: string;
  baseChainId: number;
  baseGoldClobAddress: string;
  baseGoldTokenAddress: string;

  walletConnectProjectId: string;
}

const DEFAULT_STREAM_URL = "http://127.0.0.1:5555/live/stream.m3u8";
const DEFAULT_GAME_API_URL = "http://127.0.0.1:5555";
const DEFAULT_GAME_WS_URL = "ws://127.0.0.1:5555/ws";

const baseConfig: Partial<EnvConfig> = {
  betWindowSeconds: 300,
  newRoundBetWindowSeconds: 300,
  autoSeedDelaySeconds: 10,
  marketMakerSeedGold: 1,
  betFeeBps: 100,
  goldDecimals: 6,
  enableAutoSeed: true,
  gameApiUrl: DEFAULT_GAME_API_URL,
  gameWsUrl: DEFAULT_GAME_WS_URL,
  streamUrl: DEFAULT_STREAM_URL,
  refreshIntervalMs: 5000,
  jupiterBaseUrl: "https://lite-api.jup.ag",

  headlessWalletSecretKey:
    import.meta.env.VITE_HEADLESS_WALLET_SECRET_KEY || "",

  bscRpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  bscChainId: 97,
  bscGoldClobAddress: "",
  bscGoldTokenAddress: "",

  baseRpcUrl: "https://sepolia.base.org",
  baseChainId: 84532,
  baseGoldClobAddress: "",
  baseGoldTokenAddress: "",

  walletConnectProjectId: (
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ""
  ).trim(),
};

export const ENV_CONFIGS: Record<Environment, EnvConfig> = {
  devnet: {
    ...baseConfig,
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com/",
    fightOracleProgramId: "A6utqr1N4KP3Tst2tMCqfJR4mhCRNw4M2uN3Nb6nPBcS",
    goldBinaryMarketProgramId: "7pxwReoFYABrSN7rnqusAxniKvrdv3zWDLoVamX5NN3W",
    goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
    uiSyncDelayMs: 0,
    headlessWalletName: "Headless Test Wallet",
    headlessWalletAutoConnect: false,
  } as EnvConfig,
  testnet: {
    ...baseConfig,
    cluster: "testnet",
    rpcUrl: "https://api.testnet.solana.com",
    wsUrl: "wss://api.testnet.solana.com/",
    fightOracleProgramId: "EW9GwxawnPEHA4eFgqd2oq9t55gSG4ReNqPRyG6Ui6PF",
    goldBinaryMarketProgramId: "23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6",
    goldMint: "", // From .env.testnet
    uiSyncDelayMs: 0,
    headlessWalletName: "Headless Test Wallet",
    headlessWalletAutoConnect: false,
  } as EnvConfig,
  localnet: {
    ...baseConfig,
    cluster: "localnet",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    fightOracleProgramId: "",
    goldBinaryMarketProgramId: "",
    goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
    streamUrl: "/live/stream.m3u8",
    uiSyncDelayMs: 0,
    headlessWalletName: "Headless Test Wallet",
    headlessWalletAutoConnect: false,
  } as EnvConfig,
  e2e: {
    ...baseConfig,
    cluster: "localnet",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    fightOracleProgramId: "",
    goldBinaryMarketProgramId: "",
    goldMint: "XeYyjz6Y351cyYDJAyghh6gJja9NF1ssiAXuem8YDyx",
    streamUrl: "/live/stream.m3u8",
    enableAutoSeed: false,
    refreshIntervalMs: 1500,
    uiSyncDelayMs: 0,
    headlessWalletName: "E2E Wallet",
    headlessWalletAutoConnect: true,
  } as EnvConfig,
  "stream-ui": {
    ...baseConfig,
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    fightOracleProgramId: "11111111111111111111111111111111",
    goldBinaryMarketProgramId: "11111111111111111111111111111111",
    goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
    streamUrl: "",
    enableAutoSeed: false,
    refreshIntervalMs: 60000,
    uiSyncDelayMs: 0,
    headlessWalletName: "Stream UI Dev",
    headlessWalletAutoConnect: false,
  } as EnvConfig,
  "mainnet-beta": {
    ...baseConfig,
    cluster: "mainnet-beta",
    rpcUrl:
      "https://mainnet.helius-rpc.com/?api-key=46a4233d-8380-4c89-b70a-4d2d8c3258d6", // Default fallback if needed
    wsUrl:
      "wss://mainnet.helius-rpc.com/?api-key=46a4233d-8380-4c89-b70a-4d2d8c3258d6",
    fightOracleProgramId: "EW9GwxawnPEHA4eFgqd2oq9t55gSG4ReNqPRyG6Ui6PF",
    goldBinaryMarketProgramId: "23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6",
    goldMint: "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    uiSyncDelayMs: 0,
    headlessWalletName: "Headless Test Wallet",
    headlessWalletAutoConnect: false,
  } as EnvConfig,
};

const baseEnvConfig = ENV_CONFIGS[ACTIVE_ENV];
const envGameApiUrl = readEnvString("VITE_GAME_API_URL");
const resolvedGameApiUrl = envGameApiUrl ?? baseEnvConfig.gameApiUrl;
const envGameWsUrl = readEnvString("VITE_GAME_WS_URL");
const resolvedGameWsUrl =
  envGameWsUrl ??
  baseEnvConfig.gameWsUrl ??
  `${resolvedGameApiUrl.replace(/^http/, "ws")}/ws`;

export const CONFIG: EnvConfig = {
  ...baseEnvConfig,
  rpcUrl: readEnvString("VITE_SOLANA_RPC_URL") ?? baseEnvConfig.rpcUrl,
  wsUrl: readEnvString("VITE_SOLANA_WS_URL") ?? baseEnvConfig.wsUrl,
  fightOracleProgramId:
    readEnvString("VITE_FIGHT_ORACLE_PROGRAM_ID") ??
    baseEnvConfig.fightOracleProgramId,
  goldBinaryMarketProgramId:
    readEnvString("VITE_GOLD_BINARY_MARKET_PROGRAM_ID") ??
    baseEnvConfig.goldBinaryMarketProgramId,
  goldMint: readEnvString("VITE_GOLD_MINT") ?? baseEnvConfig.goldMint,
  usdcMint: readEnvString("VITE_USDC_MINT") ?? baseEnvConfig.usdcMint,
  betWindowSeconds: readEnvNumber(
    "VITE_BET_WINDOW_SECONDS",
    baseEnvConfig.betWindowSeconds,
  ),
  newRoundBetWindowSeconds: readEnvNumber(
    "VITE_NEW_ROUND_BET_WINDOW_SECONDS",
    baseEnvConfig.newRoundBetWindowSeconds,
  ),
  autoSeedDelaySeconds: readEnvNumber(
    "VITE_AUTO_SEED_DELAY_SECONDS",
    baseEnvConfig.autoSeedDelaySeconds,
  ),
  marketMakerSeedGold: readEnvNumber(
    "VITE_MARKET_MAKER_SEED_GOLD",
    baseEnvConfig.marketMakerSeedGold,
  ),
  betFeeBps: readEnvNumber("VITE_BET_FEE_BPS", baseEnvConfig.betFeeBps),
  goldDecimals: readEnvNumber("VITE_GOLD_DECIMALS", baseEnvConfig.goldDecimals),
  enableAutoSeed: readEnvBoolean(
    "VITE_ENABLE_AUTO_SEED",
    baseEnvConfig.enableAutoSeed,
  ),
  gameApiUrl: resolvedGameApiUrl,
  gameWsUrl: resolvedGameWsUrl,
  streamUrl: readEnvString("VITE_STREAM_URL") ?? baseEnvConfig.streamUrl,
  uiSyncDelayMs: readEnvNumber(
    "VITE_UI_SYNC_DELAY_MS",
    baseEnvConfig.uiSyncDelayMs,
  ),
  refreshIntervalMs: readEnvNumber(
    "VITE_REFRESH_INTERVAL_MS",
    baseEnvConfig.refreshIntervalMs,
  ),
  headlessWalletName:
    readEnvString("VITE_HEADLESS_WALLET_NAME") ??
    baseEnvConfig.headlessWalletName,
  headlessWalletAutoConnect: readEnvBoolean(
    "VITE_HEADLESS_WALLET_AUTO_CONNECT",
    baseEnvConfig.headlessWalletAutoConnect,
  ),
  headlessWalletSecretKey:
    readEnvString("VITE_HEADLESS_WALLET_SECRET_KEY") ??
    baseEnvConfig.headlessWalletSecretKey,
  jupiterBaseUrl:
    readEnvString("VITE_JUPITER_BASE_URL") ?? baseEnvConfig.jupiterBaseUrl,
  bscRpcUrl: readEnvString("VITE_BSC_RPC_URL") ?? baseEnvConfig.bscRpcUrl,
  bscChainId: readEnvNumber("VITE_BSC_CHAIN_ID", baseEnvConfig.bscChainId),
  bscGoldClobAddress:
    readEnvString("VITE_BSC_GOLD_CLOB_ADDRESS") ??
    baseEnvConfig.bscGoldClobAddress,
  bscGoldTokenAddress:
    readEnvString("VITE_BSC_GOLD_TOKEN_ADDRESS") ??
    baseEnvConfig.bscGoldTokenAddress,
  baseRpcUrl: readEnvString("VITE_BASE_RPC_URL") ?? baseEnvConfig.baseRpcUrl,
  baseChainId: readEnvNumber("VITE_BASE_CHAIN_ID", baseEnvConfig.baseChainId),
  baseGoldClobAddress:
    readEnvString("VITE_BASE_GOLD_CLOB_ADDRESS") ??
    baseEnvConfig.baseGoldClobAddress,
  baseGoldTokenAddress:
    readEnvString("VITE_BASE_GOLD_TOKEN_ADDRESS") ??
    baseEnvConfig.baseGoldTokenAddress,
  walletConnectProjectId:
    readEnvString("VITE_WALLETCONNECT_PROJECT_ID") ??
    baseEnvConfig.walletConnectProjectId,
};

// Legacy Exports mapping to CONFIG
export const GOLD_MAINNET_MINT = new PublicKey(
  "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
);

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

export const DEFAULT_BET_WINDOW_SECONDS = CONFIG.betWindowSeconds;
export const DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS =
  CONFIG.newRoundBetWindowSeconds;
export const DEFAULT_AUTO_SEED_DELAY_SECONDS = CONFIG.autoSeedDelaySeconds;
export const DEFAULT_SEED_GOLD_AMOUNT = CONFIG.marketMakerSeedGold;
export const DEFAULT_BET_FEE_BPS = CONFIG.betFeeBps;
export const GOLD_DECIMALS = CONFIG.goldDecimals;
export const DEFAULT_REFRESH_INTERVAL_MS = CONFIG.refreshIntervalMs;

export function toBaseUnits(amount: number, decimals = GOLD_DECIMALS): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

export const STREAM_URL: string = CONFIG.streamUrl;
export const GAME_API_URL: string = CONFIG.gameApiUrl;
export const ARENA_EXTERNAL_BET_WRITE_KEY: string = ""; // Usually secrets shouldn't be here, skipping for now, we can read from import.meta.env if needed
export const GAME_WS_URL: string = CONFIG.gameWsUrl;
export const UI_SYNC_DELAY_MS: number = CONFIG.uiSyncDelayMs;
const USE_GAME_RPC_PROXY = readEnvBoolean("VITE_USE_GAME_RPC_PROXY", false);

export function buildArenaWriteHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const writeKey = import.meta.env.VITE_ARENA_EXTERNAL_BET_WRITE_KEY || "";
  if (writeKey) {
    headers["x-arena-write-key"] = writeKey;
  }
  return headers;
}

export function getFixedMatchId(): number | null {
  const id = import.meta.env.VITE_ACTIVE_MATCH_ID;
  if (!id) return null;
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCluster(): SolanaCluster {
  return CONFIG.cluster;
}

export function getRpcUrl(): string {
  // Default to direct RPC for standalone deployments.
  if (!USE_GAME_RPC_PROXY || CONFIG.cluster === "localnet") {
    return CONFIG.rpcUrl;
  }
  return `${GAME_API_URL}/api/proxy/solana/rpc?cluster=${encodeURIComponent(CONFIG.cluster)}`;
}

export function getWsUrl(): string | undefined {
  if (!USE_GAME_RPC_PROXY) {
    return CONFIG.wsUrl;
  }
  if (CONFIG.cluster === "localnet" && CONFIG.wsUrl) {
    return CONFIG.wsUrl;
  }
  const host = GAME_API_URL.replace(/^http/, "ws");
  return `${host}/api/proxy/solana/ws?cluster=${encodeURIComponent(CONFIG.cluster)}`;
}

// ============================================================================
// EVM Chain Configuration
// ============================================================================

export const BSC_RPC_URL: string = CONFIG.bscRpcUrl;
export const BSC_CHAIN_ID: number = CONFIG.bscChainId;
export const BSC_GOLD_CLOB_ADDRESS: string = CONFIG.bscGoldClobAddress;
export const BSC_GOLD_TOKEN_ADDRESS: string = CONFIG.bscGoldTokenAddress;

export const BASE_RPC_URL: string = CONFIG.baseRpcUrl;
export const BASE_CHAIN_ID: number = CONFIG.baseChainId;
export const BASE_GOLD_CLOB_ADDRESS: string = CONFIG.baseGoldClobAddress;
export const BASE_GOLD_TOKEN_ADDRESS: string = CONFIG.baseGoldTokenAddress;
