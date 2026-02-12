export type ArenaPhase =
  | "PREVIEW_CAMS"
  | "BET_OPEN"
  | "BET_LOCK"
  | "DUEL_ACTIVE"
  | "RESULT_SHOW"
  | "ORACLE_REPORT"
  | "MARKET_RESOLVE"
  | "RESTORE"
  | "COMPLETE";

export type ArenaWinReason = "DEATH" | "TIME_DAMAGE";

export type ArenaSide = "A" | "B";

export type MarketStatus =
  | "PENDING"
  | "BETTING"
  | "LOCKED"
  | "RESOLVED"
  | "SETTLING"
  | "SETTLED";

export interface ArenaMarketSnapshot {
  roundId: string;
  roundSeedHex: string;
  programId: string;
  mint: string;
  tokenProgram: string;
  marketPda: string;
  oraclePda: string;
  vaultAta: string;
  feeVaultAta: string;
  status: MarketStatus;
  closeSlot: number | null;
  resolvedSlot: number | null;
  winnerSide: ArenaSide | null;
  poolA: string;
  poolB: string;
  feeBps: number;
}

export interface ArenaRoundSnapshot {
  id: string;
  roundSeedHex: string;
  phase: ArenaPhase;
  createdAt: number;
  updatedAt: number;
  scheduledAt: number;
  bettingOpensAt: number;
  bettingClosesAt: number;
  duelStartsAt: number | null;
  duelEndsAt: number | null;
  agentAId: string;
  agentBId: string;
  previewAgentAId: string | null;
  previewAgentBId: string | null;
  duelId: string | null;
  winnerId: string | null;
  winReason: ArenaWinReason | null;
  damageA: number;
  damageB: number;
  metadataUri: string | null;
  resultHash: string | null;
  market: ArenaMarketSnapshot | null;
}

export interface BetQuoteRequest {
  roundId: string;
  side: ArenaSide;
  sourceAsset: "GOLD" | "SOL" | "USDC";
  sourceAmount: string;
  bettorWallet: string;
}

export interface BetQuoteResponse {
  roundId: string;
  side: ArenaSide;
  sourceAsset: "GOLD" | "SOL" | "USDC";
  sourceAmount: string;
  expectedGoldAmount: string;
  minGoldAmount: string;
  swapQuote: Record<string, unknown> | null;
  market: ArenaMarketSnapshot;
}

export interface ClaimBuildRequest {
  roundId: string;
  bettorWallet: string;
}

export interface ClaimBuildResponse {
  roundId: string;
  roundSeedHex: string;
  programId: string;
  mint: string;
  tokenProgram: string;
  marketPda: string;
  vaultAta: string;
  positionPda: string;
  winnerSide: ArenaSide | null;
  bettorWallet: string;
  manualClaimEnabled: true;
  message: string;
}

export interface DepositAddressResponse {
  roundId: string;
  side: ArenaSide;
  custodyWallet: string;
  custodyAta: string;
  mint: string;
  tokenProgram: string;
  memoTemplate: string;
}

export interface IngestDepositRequest {
  roundId: string;
  side: ArenaSide;
  txSignature: string;
}

export interface IngestDepositResponse {
  roundId: string;
  side: ArenaSide;
  txSignature: string;
  settleSignature: string;
  bettorWallet: string;
  goldAmount: string;
  betId: string;
}

export interface ArenaWhitelistEntry {
  characterId: string;
  enabled: boolean;
  minPowerScore: number;
  maxPowerScore: number;
  priority: number;
  cooldownUntil: number | null;
  notes: string | null;
  updatedAt: number;
}

export interface ArenaWhitelistUpsertInput {
  characterId: string;
  enabled?: boolean;
  minPowerScore?: number;
  maxPowerScore?: number;
  priority?: number;
  cooldownUntil?: number | null;
  notes?: string | null;
}
