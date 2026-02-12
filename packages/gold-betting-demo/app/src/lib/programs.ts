/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";

import fightOracleIdl from "../../../anchor/target/idl/fight_oracle.json";
import goldBinaryMarketIdl from "../../../anchor/target/idl/gold_binary_market.json";

export const FIGHT_ORACLE_PROGRAM_ID = new PublicKey(fightOracleIdl.address);
export const GOLD_BINARY_MARKET_PROGRAM_ID = new PublicKey(
  goldBinaryMarketIdl.address,
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

  const fightOracle = new Program(fightOracleIdl as Idl, provider);

  const goldBinaryMarket = new Program(goldBinaryMarketIdl as Idl, provider);

  return { provider, fightOracle, goldBinaryMarket };
}

export function createReadonlyPrograms(connection: Connection): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(fightOracleIdl as Idl, provider);
  const goldBinaryMarket = new Program(goldBinaryMarketIdl as Idl, provider);

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
