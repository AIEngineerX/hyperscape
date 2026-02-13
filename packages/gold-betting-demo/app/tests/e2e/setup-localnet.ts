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
import {
  TOKEN_2022_PROGRAM_ID,
  createAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";

import fightOracleIdl from "../../../anchor/target/idl/fight_oracle.json";
import marketIdl from "../../../anchor/target/idl/gold_binary_market.json";

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };

function seedKeypair(offset: number): Keypair {
  const seed = new Uint8Array(32);
  for (let i = 0; i < seed.length; i += 1) {
    seed[i] = (offset + i) % 256;
  }
  return Keypair.fromSeed(seed);
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
  const signature = await connection.requestAirdrop(
    recipient,
    10 * LAMPORTS_PER_SOL,
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(__dirname, "../..");
  const statePath = path.resolve(__dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");

  const authority = seedKeypair(17);
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  await airdrop(connection, authority.publicKey);

  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightProgram = new Program(fightOracleIdl as Idl, provider);
  const marketProgram = new Program(marketIdl as Idl, provider);
  const fight: any = fightProgram;
  const market: any = marketProgram;

  const [oracleConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightProgram.programId,
  );

  const goldMint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const authorityGoldAta = await createAccount(
    connection,
    authority,
    goldMint,
    authority.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  await mintTo(
    connection,
    authority,
    goldMint,
    authorityGoldAta,
    authority,
    100_000_000,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

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
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), matchPda.toBuffer()],
      marketProgram.programId,
    );
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_auth"), marketPda.toBuffer()],
      marketProgram.programId,
    );
    const [yesVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("yes_vault"), marketPda.toBuffer()],
      marketProgram.programId,
    );
    const [noVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("no_vault"), marketPda.toBuffer()],
      marketProgram.programId,
    );
    return {
      matchPda,
      marketPda,
      vaultAuthorityPda,
      yesVaultPda,
      noVaultPda,
    };
  };

  const resolvedMatchId = Date.now() - 100_000;
  const resolved = deriveMarket(resolvedMatchId);
  await fight.methods
    .createMatch(new BN(resolvedMatchId), new BN(2))
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      matchResult: resolved.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await market.methods
    .initializeMarket(new BN(10))
    .accountsPartial({
      payer: authority.publicKey,
      marketMaker: authority.publicKey,
      oracleMatch: resolved.matchPda,
      market: resolved.marketPda,
      vaultAuthority: resolved.vaultAuthorityPda,
      yesVault: resolved.yesVaultPda,
      noVault: resolved.noVaultPda,
      goldMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await sleep(2_500);

  await fight.methods
    .postResult({ yes: {} }, new BN(42), Array.from(new Uint8Array(32)))
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      matchResult: resolved.matchPda,
    })
    .rpc();

  await market.methods
    .resolveFromOracle()
    .accountsPartial({
      resolver: authority.publicKey,
      market: resolved.marketPda,
      oracleMatch: resolved.matchPda,
    })
    .rpc();

  const currentMatchId = Date.now();
  const current = deriveMarket(currentMatchId);
  await fight.methods
    .createMatch(new BN(currentMatchId), new BN(45))
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      matchResult: current.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await market.methods
    .initializeMarket(new BN(10))
    .accountsPartial({
      payer: authority.publicKey,
      marketMaker: authority.publicKey,
      oracleMatch: current.matchPda,
      market: current.marketPda,
      vaultAuthority: current.vaultAuthorityPda,
      yesVault: current.yesVaultPda,
      noVault: current.noVaultPda,
      goldMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const envBody = [
    "VITE_SOLANA_CLUSTER=localnet",
    "VITE_SOLANA_RPC_URL=http://127.0.0.1:8899",
    "VITE_SOLANA_WS_URL=ws://127.0.0.1:8900",
    `VITE_GOLD_MINT=${goldMint.toBase58()}`,
    `VITE_ACTIVE_MATCH_ID=${currentMatchId}`,
    "VITE_BET_WINDOW_SECONDS=300",
    "VITE_NEW_ROUND_BET_WINDOW_SECONDS=300",
    "VITE_AUTO_SEED_DELAY_SECONDS=10",
    "VITE_MARKET_MAKER_SEED_GOLD=1",
    "VITE_GOLD_DECIMALS=6",
    "VITE_REFRESH_INTERVAL_MS=1500",
    "VITE_ENABLE_AUTO_SEED=false",
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
        authority: authority.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        currentMatchId,
        currentMatchPda: current.matchPda.toBase58(),
        currentMarketPda: current.marketPda.toBase58(),
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
        lastResolvedMatchId: resolvedMatchId,
      },
      null,
      2,
    ),
  );
}

void main();
