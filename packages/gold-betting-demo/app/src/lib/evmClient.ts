/**
 * EVM client for interacting with the GoldClob contract via viem.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
} from "viem";
import type { EvmChainConfig } from "./chainConfig";
import { GOLD_CLOB_ABI, ERC20_APPROVE_ABI } from "./goldClobAbi";

// ============================================================================
// Types
// ============================================================================

export type MatchStatus = "NULL" | "OPEN" | "RESOLVED";
export type Side = "NONE" | "YES" | "NO";

export type MatchMeta = {
  status: MatchStatus;
  winner: Side;
  yesPool: bigint;
  noPool: bigint;
};

export type Position = {
  yesShares: bigint;
  noShares: bigint;
};

export type OrderInfo = {
  id: bigint;
  price: number;
  isBuy: boolean;
  maker: Address;
  amount: bigint;
  filled: bigint;
};

// ============================================================================
// Status/Side mapping
// ============================================================================

const MATCH_STATUS_MAP: Record<number, MatchStatus> = {
  0: "NULL",
  1: "OPEN",
  2: "RESOLVED",
};

const SIDE_MAP: Record<number, Side> = {
  0: "NONE",
  1: "YES",
  2: "NO",
};

export const SIDE_ENUM: Record<string, number> = {
  NONE: 0,
  YES: 1,
  NO: 2,
};

// ============================================================================
// Client factory
// ============================================================================

export function createEvmPublicClient(
  chainConfig: EvmChainConfig,
): PublicClient {
  return createPublicClient({
    chain: chainConfig.wagmiChain,
    transport: http(chainConfig.rpcUrl),
  });
}

export function createEvmWalletClient(
  chainConfig: EvmChainConfig,
): WalletClient | null {
  if (typeof window === "undefined" || !(window as any).ethereum) return null;
  return createWalletClient({
    chain: chainConfig.wagmiChain,
    transport: custom((window as any).ethereum),
  });
}

// ============================================================================
// Read functions
// ============================================================================

export async function getMatchMeta(
  client: PublicClient,
  contractAddress: Address,
  matchId: bigint,
): Promise<MatchMeta> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "matches",
    args: [matchId],
  })) as [number, number, bigint, bigint];

  return {
    status: MATCH_STATUS_MAP[result[0]] ?? "NULL",
    winner: SIDE_MAP[result[1]] ?? "NONE",
    yesPool: result[2],
    noPool: result[3],
  };
}

export async function getPosition(
  client: PublicClient,
  contractAddress: Address,
  matchId: bigint,
  userAddress: Address,
): Promise<Position> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [matchId, userAddress],
  })) as [bigint, bigint];

  return {
    yesShares: result[0],
    noShares: result[1],
  };
}

export async function getNextMatchId(
  client: PublicClient,
  contractAddress: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "nextMatchId",
  })) as bigint;
}

export async function getBestBid(
  client: PublicClient,
  contractAddress: Address,
  matchId: bigint,
): Promise<number> {
  return Number(
    await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "bestBids",
      args: [matchId],
    }),
  );
}

export async function getBestAsk(
  client: PublicClient,
  contractAddress: Address,
  matchId: bigint,
): Promise<number> {
  return Number(
    await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "bestAsks",
      args: [matchId],
    }),
  );
}

export async function getFeeBps(
  client: PublicClient,
  contractAddress: Address,
): Promise<number> {
  return Number(
    await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "feeBps",
    }),
  );
}

export async function getGoldBalance(
  client: PublicClient,
  tokenAddress: Address,
  userAddress: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: tokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "balanceOf",
    args: [userAddress],
  })) as bigint;
}

export async function getGoldAllowance(
  client: PublicClient,
  tokenAddress: Address,
  ownerAddress: Address,
  spenderAddress: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: tokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [ownerAddress, spenderAddress],
  })) as bigint;
}

export async function getGoldDecimals(
  client: PublicClient,
  tokenAddress: Address,
): Promise<number> {
  return Number(
    await client.readContract({
      address: tokenAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: "decimals",
    }),
  );
}

// ============================================================================
// Write functions
// ============================================================================

export async function approveGoldToken(
  walletClient: WalletClient,
  tokenAddress: Address,
  spenderAddress: Address,
  amount: bigint,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spenderAddress, amount],
    account,
    chain: walletClient.chain,
  });
}

export async function placeOrder(
  walletClient: WalletClient,
  contractAddress: Address,
  matchId: bigint,
  isBuy: boolean,
  price: number,
  amount: bigint,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [matchId, isBuy, price, amount],
    account,
    chain: walletClient.chain,
  });
}

export async function cancelOrder(
  walletClient: WalletClient,
  contractAddress: Address,
  matchId: bigint,
  orderId: bigint,
  price: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "cancelOrder",
    args: [matchId, orderId, price],
    account,
    chain: walletClient.chain,
  });
}

export async function claimWinnings(
  walletClient: WalletClient,
  contractAddress: Address,
  matchId: bigint,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [matchId],
    account,
    chain: walletClient.chain,
  });
}

export async function createMatch(
  walletClient: WalletClient,
  contractAddress: Address,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "createMatch",
    args: [],
    account,
    chain: walletClient.chain,
  });
}

export async function resolveMatch(
  walletClient: WalletClient,
  contractAddress: Address,
  matchId: bigint,
  winner: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "resolveMatch",
    args: [matchId, winner],
    account,
    chain: walletClient.chain,
  });
}
