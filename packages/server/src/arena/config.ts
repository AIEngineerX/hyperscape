export interface ArenaRuntimeConfig {
  previewDurationMs: number;
  bettingOpenDurationMs: number;
  bettingLockBufferMs: number;
  duelMaxDurationMs: number;
  resultShowDurationMs: number;
  restoreDurationMs: number;
  tickIntervalMs: number;
  minWhitelistedAgents: number;
  participantCooldownMs: number;
}

export const DEFAULT_ARENA_RUNTIME_CONFIG: ArenaRuntimeConfig = {
  previewDurationMs: 60_000,
  bettingOpenDurationMs: 60_000,
  bettingLockBufferMs: 10_000,
  duelMaxDurationMs: 300_000,
  resultShowDurationMs: 15_000,
  restoreDurationMs: 5_000,
  tickIntervalMs: 1_000,
  minWhitelistedAgents: 2,
  participantCooldownMs: 60_000,
};

export interface SolanaArenaConfig {
  rpcUrl: string;
  wsUrl: string;
  marketProgramId: string;
  goldMint: string;
  goldTokenProgramId: string;
  associatedTokenProgramId: string;
  systemProgramId: string;
  jupiterQuoteUrl: string;
  usdcMint: string;
  solMint: string;
  feeBps: number;
  authoritySecret: string | null;
  reporterSecret: string | null;
  keeperSecret: string | null;
  closeSlotLead: number;
  stakingIndexerUrl: string | null;
  stakingIndexerAuthHeader: string | null;
  birdeyeApiKey: string | null;
  birdeyeBaseUrl: string;
}

export function getSolanaArenaConfig(): SolanaArenaConfig {
  return {
    rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    wsUrl: process.env.SOLANA_WS_URL ?? "ws://127.0.0.1:8900",
    marketProgramId:
      process.env.SOLANA_ARENA_MARKET_PROGRAM_ID ??
      "23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6",
    goldMint:
      process.env.SOLANA_GOLD_MINT ??
      "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump",
    goldTokenProgramId:
      process.env.SOLANA_GOLD_TOKEN_PROGRAM_ID ??
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    associatedTokenProgramId:
      process.env.SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID ??
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    systemProgramId:
      process.env.SOLANA_SYSTEM_PROGRAM_ID ??
      "11111111111111111111111111111111",
    jupiterQuoteUrl:
      process.env.JUPITER_QUOTE_URL ?? "https://lite-api.jup.ag/swap/v1/quote",
    usdcMint:
      process.env.SOLANA_USDC_MINT ??
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    solMint:
      process.env.SOLANA_SOL_MINT ??
      "So11111111111111111111111111111111111111112",
    feeBps: Number(process.env.SOLANA_MARKET_FEE_BPS ?? 200),
    authoritySecret: process.env.SOLANA_ARENA_AUTHORITY_SECRET ?? null,
    reporterSecret: process.env.SOLANA_ARENA_REPORTER_SECRET ?? null,
    keeperSecret: process.env.SOLANA_ARENA_KEEPER_SECRET ?? null,
    closeSlotLead: Number(process.env.SOLANA_ARENA_CLOSE_SLOT_LEAD ?? 20),
    stakingIndexerUrl: process.env.SOLANA_GOLD_STAKING_INDEXER_URL ?? null,
    stakingIndexerAuthHeader:
      process.env.SOLANA_GOLD_STAKING_INDEXER_AUTH_HEADER ?? null,
    birdeyeApiKey: process.env.BIRDEYE_API_KEY ?? null,
    birdeyeBaseUrl:
      process.env.BIRDEYE_API_BASE_URL ?? "https://public-api.birdeye.so",
  };
}
