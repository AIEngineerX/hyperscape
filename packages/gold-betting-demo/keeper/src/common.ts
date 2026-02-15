/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import dotenv from "dotenv";

import fightOracleIdl from "../../anchor/target/idl/fight_oracle.json";
import goldBinaryMarketIdl from "../../anchor/target/idl/gold_binary_market.json";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envRoot = path.resolve(__dirname, "../..");
const configuredClusterRaw =
  process.env.SOLANA_CLUSTER ||
  process.env.CLUSTER ||
  process.env.VITE_SOLANA_CLUSTER ||
  "mainnet-beta";
const configuredCluster = configuredClusterRaw.toLowerCase();
const envClusterSuffix =
  configuredCluster === "mainnet" || configuredCluster === "mainnet-beta"
    ? "mainnet"
    : configuredCluster;

// Load cluster-specific defaults first, then generic .env fallback.
dotenv.config({ path: path.join(envRoot, `.env.${envClusterSuffix}`) });
dotenv.config({ path: path.join(envRoot, ".env") });

type SignableTx = Transaction | VersionedTransaction;

type AnchorLikeWallet = Wallet & {
  payer: Keypair;
};

function signTx(tx: SignableTx, signer: Keypair): SignableTx {
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer]);
  } else {
    tx.partialSign(signer);
  }
  return tx;
}

function toAnchorWallet(signer: Keypair): AnchorLikeWallet {
  return {
    payer: signer,
    publicKey: signer.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> => {
      return signTx(tx, signer) as T;
    },
    signAllTransactions: async <T extends SignableTx[]>(txs: T): Promise<T> => {
      txs.forEach((tx) => signTx(tx, signer));
      return txs;
    },
  };
}

export function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;

  if (configuredCluster === "localnet") {
    return "http://127.0.0.1:8899";
  }

  if (configuredCluster === "testnet") {
    return "https://api.testnet.solana.com";
  }

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (heliusApiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  }

  return "https://api.mainnet-beta.solana.com";
}

export function readKeypair(keypairPath: string): Keypair {
  const expanded = keypairPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", keypairPath.slice(1))
    : keypairPath;

  const raw = fs.readFileSync(expanded, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(secret);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function createPrograms(signer: Keypair): {
  connection: Connection;
  provider: AnchorProvider;
  fightOracle: Program<any>;
  goldBinaryMarket: Program<any>;
} {
  const connection = new Connection(getRpcUrl(), {
    commitment: "confirmed",
  });
  const wallet = toAnchorWallet(signer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(fightOracleIdl as Idl, provider);

  const goldBinaryMarket = new Program(goldBinaryMarketIdl as Idl, provider);

  return {
    connection,
    provider,
    fightOracle,
    goldBinaryMarket,
  };
}

export function findOracleConfigPda(
  fightOracleProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightOracleProgramId,
  )[0];
}

export function findMatchPda(
  fightOracleProgramId: PublicKey,
  matchId: BN,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 8)],
    fightOracleProgramId,
  )[0];
}

export function findMarketPda(
  marketProgramId: PublicKey,
  matchPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), matchPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findMarketConfigPda(marketProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market_config")],
    marketProgramId,
  )[0];
}

export function findYesVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findNoVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findPositionPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPda.toBuffer(), owner.toBuffer()],
    marketProgramId,
  )[0];
}

export function enumIs(value: unknown, variant: string): boolean {
  if (!value || typeof value !== "object") return false;
  const key = Object.keys(value as Record<string, unknown>)[0];
  return key === variant;
}

export function baseUnitsFromGold(goldAmount: number, decimals = 6): BN {
  const scaled = BigInt(Math.floor(goldAmount * 10 ** decimals));
  return new BN(scaled.toString());
}

export async function detectTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }
  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID;
  }
  throw new Error(`Unsupported token program for mint ${mint.toBase58()}`);
}

export async function findTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<PublicKey | null> {
  const response = await connection.getTokenAccountsByOwner(owner, {
    mint,
    programId: tokenProgram,
  });
  return response.value[0]?.pubkey ?? null;
}

export async function findAnyTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ tokenAccount: PublicKey | null; tokenProgram: PublicKey | null }> {
  const token2022 = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
  );
  if (token2022) {
    return { tokenAccount: token2022, tokenProgram: TOKEN_2022_PROGRAM_ID };
  }

  const legacy = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
  );
  if (legacy) {
    return { tokenAccount: legacy, tokenProgram: TOKEN_PROGRAM_ID };
  }

  return { tokenAccount: null, tokenProgram: null };
}
