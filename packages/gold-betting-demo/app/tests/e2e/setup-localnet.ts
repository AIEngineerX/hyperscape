import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";

import fightOracleIdl from "../../../anchor/target/idl/fight_oracle.json";
import goldClobIdl from "../../../anchor/target/idl/gold_clob_market.json";

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };
type IdlWithAddress = Idl & {
  address?: string;
  metadata?: {
    address?: string;
  };
};

function resolveIdlAddress(idl: IdlWithAddress, label: string): string {
  const address = idl.address || idl.metadata?.address || "";
  if (!address) {
    throw new Error(`Missing program address in ${label} IDL`);
  }
  return address;
}

function seedKeypair(offset: number): Keypair {
  const seed = new Uint8Array(32);
  for (let i = 0; i < seed.length; i += 1) {
    seed[i] = (offset + i) % 256;
  }
  return Keypair.fromSeed(seed);
}

function findDeterministicAuthority(target: PublicKey): Keypair | null {
  for (let offset = 0; offset < 256; offset += 1) {
    const candidate = seedKeypair(offset);
    if (candidate.publicKey.equals(target)) {
      return candidate;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWallet(keypair: Keypair): AnchorLikeWallet {
  const sign = <T extends SignableTx>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else tx.partialSign(keypair);
    return tx;
  };

  return {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> =>
      sign(tx),
    signAllTransactions: async <T extends SignableTx[]>(txs: T): Promise<T> => {
      txs.forEach((tx) => sign(tx));
      return txs;
    },
  };
}

async function airdrop(
  connection: Connection,
  recipient: PublicKey,
): Promise<void> {
  let lastError: unknown = new Error("Airdrop did not settle");
  const initialBalance = await connection.getBalance(recipient, "confirmed");
  const expectedFloor = initialBalance + LAMPORTS_PER_SOL;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(
        recipient,
        10 * LAMPORTS_PER_SOL,
      );

      const startedAt = Date.now();
      while (Date.now() - startedAt < 20_000) {
        const balance = await connection.getBalance(recipient, "confirmed");
        if (balance >= expectedFloor) return;

        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        if (status?.err) {
          throw new Error(
            `Airdrop failed for signature ${signature}: ${JSON.stringify(status.err)}`,
          );
        }
        await sleep(600);
      }

      throw new Error(`Airdrop signature ${signature} did not settle in time`);
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(__dirname, "../..");
  const statePath = path.resolve(__dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");
  const solanaRpcUrl =
    process.env.E2E_SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const solanaWsUrl = process.env.E2E_SOLANA_WS_URL || "ws://127.0.0.1:8900";
  const clobProgramId = resolveIdlAddress(
    goldClobIdl as unknown as IdlWithAddress,
    "gold_clob_market",
  );

  const connection = new Connection(solanaRpcUrl, "confirmed");
  let authority = seedKeypair(17);
  let provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  let fightProgram = new Program(fightOracleIdl as Idl, provider);
  let fight: any = fightProgram;
  const clobProgram = new Program(goldClobIdl as Idl, provider);
  const clob: any = clobProgram;

  const [oracleConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightProgram.programId,
  );

  const existingOracleConfig = await (
    fightProgram as any
  ).account.oracleConfig.fetchNullable(oracleConfigPda);
  if (
    existingOracleConfig?.authority &&
    !existingOracleConfig.authority.equals(authority.publicKey)
  ) {
    const matchedAuthority = findDeterministicAuthority(
      existingOracleConfig.authority,
    );
    if (matchedAuthority) {
      authority = matchedAuthority;
      provider = new AnchorProvider(connection, toWallet(authority), {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });
      fightProgram = new Program(fightOracleIdl as Idl, provider);
      fight = fightProgram;
    }
  }

  const authorityBalance = await connection.getBalance(
    authority.publicKey,
    "confirmed",
  );
  if (authorityBalance < LAMPORTS_PER_SOL) {
    await airdrop(connection, authority.publicKey);
  }

  // CLOB settlement uses native SOL in this test stack; no SPL mint bootstrap required.
  const goldMint = new PublicKey("So11111111111111111111111111111111111111112");

  await fight.methods
    .initializeOracle()
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const deriveMarket = (matchId: number) => {
    const [matchPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), new BN(matchId).toArrayLike(Buffer, "le", 8)],
      fightProgram.programId,
    );
    return {
      matchPda,
    };
  };

  const resolvedMatchId = Date.now() - 100_000;
  const resolved = deriveMarket(resolvedMatchId);
  await fight.methods
    .createMatch(
      new BN(resolvedMatchId),
      new BN(2),
      JSON.stringify({
        agent1: "E2E Resolved Agent A",
        agent2: "E2E Resolved Agent B",
      }),
    )
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      matchResult: resolved.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fight.methods
        .postResult({ yes: {} }, new BN(42), Array.from(new Uint8Array(32)))
        .accountsPartial({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
          matchResult: resolved.matchPda,
        })
        .rpc();
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("BetWindowStillOpen")) throw error;
      if (attempt === 19) {
        throw new Error(
          "Timed out waiting for resolved e2e match betting window to close",
        );
      }
      await sleep(1_000);
    }
  }

  const currentMatchId = Date.now();
  const current = deriveMarket(currentMatchId);
  await fight.methods
    .createMatch(
      new BN(currentMatchId),
      new BN(45),
      JSON.stringify({
        agent1: "E2E Active Agent A",
        agent2: "E2E Active Agent B",
      }),
    )
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      matchResult: current.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const [clobConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    clobProgram.programId,
  );
  const existingClobConfig =
    await clob.account.marketConfig.fetchNullable(clobConfigPda);
  if (!existingClobConfig) {
    await clob.methods
      .initializeConfig(authority.publicKey, authority.publicKey, 100, 100, 200)
      .accountsPartial({
        authority: authority.publicKey,
        config: clobConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const clobMatchState = Keypair.generate();
  const [clobVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), clobMatchState.publicKey.toBuffer()],
    clobProgram.programId,
  );
  await clob.methods
    .initializeMatch(500)
    .accountsPartial({
      matchState: clobMatchState.publicKey,
      user: authority.publicKey,
      config: clobConfigPda,
      vault: clobVaultPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([clobMatchState])
    .rpc();

  const clobOrderBook = Keypair.generate();
  await clob.methods
    .initializeOrderBook()
    .accountsPartial({
      user: authority.publicKey,
      matchState: clobMatchState.publicKey,
      orderBook: clobOrderBook.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([clobOrderBook])
    .rpc();

  const [clobUserBalancePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("balance"),
      clobMatchState.publicKey.toBuffer(),
      authority.publicKey.toBuffer(),
    ],
    clobProgram.programId,
  );
  const [clobFirstOrderPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      clobMatchState.publicKey.toBuffer(),
      authority.publicKey.toBuffer(),
      new BN(1).toArrayLike(Buffer, "le", 8),
    ],
    clobProgram.programId,
  );

  const minVaultLamports = await connection.getMinimumBalanceForRentExemption(
    0,
    "confirmed",
  );
  const currentVaultLamports = await connection.getBalance(
    clobVaultPda,
    "confirmed",
  );
  if (currentVaultLamports < minVaultLamports) {
    const topUpLamports = minVaultLamports - currentVaultLamports;
    const topUpTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: clobVaultPda,
        lamports: topUpLamports,
      }),
    );
    await provider.sendAndConfirm(topUpTx);
  }

  const envBody = [
    "VITE_SOLANA_CLUSTER=localnet",
    `VITE_SOLANA_RPC_URL=${solanaRpcUrl}`,
    `VITE_SOLANA_WS_URL=${solanaWsUrl}`,
    `VITE_FIGHT_ORACLE_PROGRAM_ID=${fightProgram.programId.toBase58()}`,
    `VITE_GOLD_CLOB_MARKET_PROGRAM_ID=${clobProgramId}`,
    `VITE_GOLD_BINARY_MARKET_PROGRAM_ID=${clobProgramId}`,
    `VITE_GOLD_MINT=${goldMint.toBase58()}`,
    `VITE_ACTIVE_MATCH_ID=${currentMatchId}`,
    "VITE_BET_WINDOW_SECONDS=300",
    "VITE_NEW_ROUND_BET_WINDOW_SECONDS=300",
    "VITE_AUTO_SEED_DELAY_SECONDS=10",
    "VITE_MARKET_MAKER_SEED_GOLD=1",
    "VITE_BET_FEE_BPS=200",
    "VITE_GOLD_DECIMALS=6",
    "VITE_REFRESH_INTERVAL_MS=1500",
    "VITE_ENABLE_AUTO_SEED=false",
    "VITE_E2E_FORCE_WINNER=YES",
    `VITE_BINARY_MARKET_MAKER_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_BINARY_TRADE_TREASURY_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_BINARY_TRADE_MARKET_MAKER_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_E2E_CLOB_MATCH_STATE=${clobMatchState.publicKey.toBase58()}`,
    `VITE_E2E_CLOB_ORDER_BOOK=${clobOrderBook.publicKey.toBase58()}`,
    `VITE_E2E_CLOB_VAULT=${clobVaultPda.toBase58()}`,
    `VITE_E2E_CLOB_USER_BALANCE=${clobUserBalancePda.toBase58()}`,
    `VITE_E2E_CLOB_FIRST_ORDER=${clobFirstOrderPda.toBase58()}`,
    `VITE_HEADLESS_WALLET_SECRET_KEY=${Array.from(authority.secretKey).join(",")}`,
    "VITE_HEADLESS_WALLET_NAME=E2E Wallet",
    "VITE_HEADLESS_WALLET_AUTO_CONNECT=true",
  ].join("\n");

  await fs.writeFile(envPath, `${envBody}\n`, "utf8");
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        mode: "localnet",
        cluster: "localnet",
        solanaRpcUrl,
        authority: authority.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        currentMatchId,
        currentMatchPda: current.matchPda.toBase58(),
        clobMatchState: clobMatchState.publicKey.toBase58(),
        clobOrderBook: clobOrderBook.publicKey.toBase58(),
        clobVault: clobVaultPda.toBase58(),
        lastResolvedMatchId: resolvedMatchId,
        expectedSeedSuccess: true,
        canStartNewRound: true,
        placeBetPayAsset: "GOLD",
        placeBetAmount: "1",
        placeBetSide: "YES",
        currentBetWindowSeconds: 45,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        envPath,
        statePath,
        authority: authority.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        currentMatchId,
        clobMatchState: clobMatchState.publicKey.toBase58(),
        lastResolvedMatchId: resolvedMatchId,
      },
      null,
      2,
    ),
  );
}

void main();
