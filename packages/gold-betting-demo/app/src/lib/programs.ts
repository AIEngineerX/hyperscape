import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";

import fightOracleIdl from "../../../anchor/target/idl/fight_oracle.json";
import goldBinaryMarketIdl from "../../../anchor/target/idl/gold_binary_market.json";

function extractProgramAddressFromIdl(idlJson: unknown): string | null {
  if (!idlJson || typeof idlJson !== "object") return null;
  const asRecord = idlJson as Record<string, unknown>;
  const direct = asRecord.address;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const metadata = asRecord.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const metadataAddress = (metadata as Record<string, unknown>).address;
  if (typeof metadataAddress === "string" && metadataAddress.trim()) {
    return metadataAddress.trim();
  }

  return null;
}

function resolveProgramId(idlJson: unknown, fallback: string): PublicKey {
  const address = extractProgramAddressFromIdl(idlJson) || fallback;
  return new PublicKey(address);
}

function ensureIdlAddress(idlJson: unknown, programId: PublicKey): Idl {
  const idlWithMaybeAddress = idlJson as Idl & { address?: string };
  return {
    ...idlWithMaybeAddress,
    // Anchor Program constructor reads `idl.address` directly. Some generated
    // IDLs only include `metadata.address`, so mirror it here.
    address:
      idlWithMaybeAddress.address && idlWithMaybeAddress.address.trim()
        ? idlWithMaybeAddress.address
        : programId.toBase58(),
  } as Idl;
}

export const FIGHT_ORACLE_PROGRAM_ID = resolveProgramId(
  fightOracleIdl,
  "A6utqr1N4KP3Tst2tMCqfJR4mhCRNw4M2uN3Nb6nPBcS",
);
export const GOLD_BINARY_MARKET_PROGRAM_ID = resolveProgramId(
  goldBinaryMarketIdl,
  "GzwZKz1fku9sPVN8G3JdnLHTzGyPzW9MkgVfMcdJGc7e",
);

const FIGHT_ORACLE_IDL = ensureIdlAddress(
  fightOracleIdl,
  FIGHT_ORACLE_PROGRAM_ID,
);
const GOLD_BINARY_MARKET_IDL = ensureIdlAddress(
  goldBinaryMarketIdl,
  GOLD_BINARY_MARKET_PROGRAM_ID,
);

export type ProgramsBundle = {
  provider: AnchorProvider;
  fightOracle: Program<any>;
  goldBinaryMarket: Program<any>;
};

function asAnchorWallet(wallet: WalletContextState): any {
  if (
    !wallet.publicKey ||
    !wallet.signTransaction ||
    !wallet.signAllTransactions
  ) {
    throw new Error("Wallet does not support required signing methods");
  }

  return {
    payer: null,
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions,
  };
}

function readonlyAnchorWallet(): any {
  const readonlyPk = new PublicKey("11111111111111111111111111111111");
  return {
    payer: null,
    publicKey: readonlyPk,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T): Promise<T> => txs,
  };
}

export function createPrograms(
  connection: Connection,
  wallet: WalletContextState,
): ProgramsBundle {
  const anchorWallet = asAnchorWallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);

  const goldBinaryMarket = new Program(GOLD_BINARY_MARKET_IDL, provider);

  return { provider, fightOracle, goldBinaryMarket };
}

export function createReadonlyPrograms(connection: Connection): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const goldBinaryMarket = new Program(GOLD_BINARY_MARKET_IDL, provider);

  return { provider, fightOracle, goldBinaryMarket };
}

export function toBnAmount(amount: bigint): BN {
  return new BN(amount.toString());
}

export function yesEnum(): { yes: Record<string, never> } {
  return { yes: {} };
}

export function noEnum(): { no: Record<string, never> } {
  return { no: {} };
}
