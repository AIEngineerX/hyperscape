import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

type Strategy =
  | "cabal_against_house"
  | "mev"
  | "random"
  | "always_winner"
  | "highest_spread";

type Winner = "A" | "B";

type Bettor = {
  wallet: Keypair;
  strategy: Strategy;
  tokenAccount: PublicKey;
  initialBalance: bigint;
};

type RoundSummary = {
  round: number;
  winner: Winner;
  houseBias: Winner;
  poolA: string;
  poolB: string;
  feeAmount: string;
  betsPlaced: number;
  winningClaims: number;
};

const STRATEGIES: Strategy[] = [
  "cabal_against_house",
  "mev",
  "random",
  "always_winner",
  "highest_spread",
];

const SIDE_A = 1;
const SIDE_B = 2;
const STATUS_RESOLVED = 3;
const WALLET_COUNT = 100;
const ROUNDS = 3;
const INITIAL_GOLD = 1_000_000_000n; // base units (decimals=6)
const BASE_STAKE = 8_000_000n;

function createRng(seed: bigint): () => number {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const out = Number(state & 0xffff_ffffn);
    return Math.abs(out) / 0xffff_ffff;
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toU64Bn(value: bigint): BN {
  return new BN(value.toString());
}

function chooseBet(
  strategy: Strategy,
  winner: Winner,
  houseBias: Winner,
  poolA: bigint,
  poolB: bigint,
  rng: () => number,
): { side: number; amount: bigint } {
  const amountBump = BigInt(Math.floor(rng() * 3_000_000));
  const base = BASE_STAKE + amountBump;
  const underdogSide = poolA <= poolB ? SIDE_A : SIDE_B;

  if (strategy === "always_winner") {
    return {
      side: winner === "A" ? SIDE_A : SIDE_B,
      amount: base + 2_500_000n,
    };
  }

  if (strategy === "cabal_against_house") {
    return {
      side: houseBias === "A" ? SIDE_B : SIDE_A,
      amount: base,
    };
  }

  if (strategy === "mev") {
    const imbalance = poolA > poolB ? poolA - poolB : poolB - poolA;
    if (imbalance > 20_000_000n) {
      return { side: underdogSide, amount: base + 1_500_000n };
    }
    return { side: rng() > 0.5 ? SIDE_A : SIDE_B, amount: base };
  }

  if (strategy === "highest_spread") {
    return { side: underdogSide, amount: base + 3_000_000n };
  }

  return { side: rng() > 0.5 ? SIDE_A : SIDE_B, amount: base };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const idlPath = join(
    workspaceDir,
    "target",
    "idl",
    "hyperscape_prediction_market.json",
  );

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const walletPath =
    process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]),
  );
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as anchor.Idl & {
    address: string;
  };
  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl, provider) as anchor.Program<any>;

  const txSignatures: string[] = [];
  const roundSummaries: RoundSummary[] = [];
  const rng = createRng(0x5eedn);
  const executionStats = {
    betAttempts: 0,
    betSuccess: 0,
    betFailures: 0,
    claimAttempts: 0,
    claimSuccess: 0,
    claimFailures: 0,
  };

  async function record(signaturePromise: Promise<string>) {
    const sig = await signaturePromise;
    txSignatures.push(sig);
    return sig;
  }

  async function recordWithRetries(
    label: string,
    txFactory: () => Promise<string>,
    maxAttempts = 2,
  ) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await record(txFactory());
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(150);
        }
      }
    }
    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${label} failed after ${maxAttempts} attempts: ${reason}`);
  }

  async function sendSol(to: PublicKey, lamports: number) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: to,
        lamports,
      }),
    );
    const sig = await provider.sendAndConfirm(tx, []);
    txSignatures.push(sig);
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config", "utf8")],
    programId,
  );
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    await record(
      program.methods
        .initializeConfig(100, authority.publicKey, authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );
  }

  const mint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );

  const bettors: Bettor[] = [];
  for (let i = 0; i < WALLET_COUNT; i += 1) {
    const walletKeypair = Keypair.generate();
    await sendSol(walletKeypair.publicKey, Math.floor(0.2 * LAMPORTS_PER_SOL));
    const tokenAccount = await createAssociatedTokenAccount(
      connection,
      authority,
      mint,
      walletKeypair.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    const mintSig = await mintTo(
      connection,
      authority,
      mint,
      tokenAccount,
      authority,
      INITIAL_GOLD,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );
    txSignatures.push(mintSig);

    bettors.push({
      wallet: walletKeypair,
      strategy: STRATEGIES[i % STRATEGIES.length],
      tokenAccount,
      initialBalance: (
        await getAccount(
          connection,
          tokenAccount,
          "confirmed",
          TOKEN_PROGRAM_ID,
        )
      ).amount,
    });
  }
  console.log(`Prepared ${WALLET_COUNT} funded wallets with minted GOLD`);

  for (let round = 1; round <= ROUNDS; round += 1) {
    const roundSeed = Keypair.generate().publicKey.toBytes();
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle", "utf8"), Buffer.from(roundSeed)],
      programId,
    );
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market", "utf8"), Buffer.from(roundSeed)],
      programId,
    );

    const marketVault = await getAssociatedTokenAddress(
      mint,
      marketPda,
      true,
      TOKEN_PROGRAM_ID,
    );
    const feeVault = await getAssociatedTokenAddress(
      mint,
      configPda,
      true,
      TOKEN_PROGRAM_ID,
    );

    await record(
      program.methods
        .initOracleRound(Array.from(roundSeed))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          oracleRound: oraclePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    const closeSlot = (await connection.getSlot("confirmed")) + 300;
    console.log(
      `Round ${round}: initialized market with closeSlot=${closeSlot}`,
    );
    await record(
      program.methods
        .initMarket(Array.from(roundSeed), new BN(closeSlot.toString()))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          oracleRound: oraclePda,
          mint,
          market: marketPda,
          marketVault,
          feeVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    let poolA = 0n;
    let poolB = 0n;
    const winner: Winner = rng() > 0.5 ? "A" : "B";
    const houseBias: Winner = round % 2 === 0 ? "A" : "B";
    const winnerSide = winner === "A" ? SIDE_A : SIDE_B;
    const roundBetSides = new Map<string, number>();
    const betFailures: string[] = [];
    let roundBetSuccess = 0;

    for (const bettor of bettors) {
      const { side, amount } = chooseBet(
        bettor.strategy,
        winner,
        houseBias,
        poolA,
        poolB,
        rng,
      );
      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position", "utf8"),
          marketPda.toBuffer(),
          bettor.wallet.publicKey.toBuffer(),
        ],
        programId,
      );

      executionStats.betAttempts += 1;
      try {
        await recordWithRetries(
          `round ${round} bet for ${bettor.wallet.publicKey.toBase58()}`,
          () =>
            program.methods
              .placeBet(side, toU64Bn(amount))
              .accountsStrict({
                bettor: bettor.wallet.publicKey,
                mint,
                market: marketPda,
                marketVault,
                bettorTokenAccount: bettor.tokenAccount,
                position: positionPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .signers([bettor.wallet])
              .rpc(),
          2,
        );
        executionStats.betSuccess += 1;
        roundBetSuccess += 1;
        roundBetSides.set(bettor.wallet.publicKey.toBase58(), side);
        if (side === SIDE_A) poolA += amount;
        else poolB += amount;
        if (roundBetSuccess % 20 === 0) {
          console.log(
            `Round ${round}: placed ${roundBetSuccess}/${WALLET_COUNT} bets`,
          );
        }
      } catch (error) {
        executionStats.betFailures += 1;
        if (betFailures.length < 3) {
          const reason = error instanceof Error ? error.message : String(error);
          betFailures.push(`${bettor.wallet.publicKey.toBase58()}: ${reason}`);
        }
      }
    }

    if (roundBetSuccess !== WALLET_COUNT) {
      throw new Error(
        `Round ${round} expected ${WALLET_COUNT} successful bets, got ${roundBetSuccess}/${WALLET_COUNT}. Failures: ${betFailures.join(
          " | ",
        )}`,
      );
    }
    if (roundBetSides.size !== WALLET_COUNT) {
      throw new Error(
        `Round ${round} missing wallet participation: ${roundBetSides.size}/${WALLET_COUNT}`,
      );
    }
    console.log(
      `Round ${round}: all ${roundBetSuccess}/${WALLET_COUNT} bets confirmed`,
    );

    while ((await connection.getSlot("confirmed")) < closeSlot) {
      await sleep(250);
    }

    await record(
      program.methods
        .lockMarket()
        .accountsStrict({
          resolver: authority.publicKey,
          config: configPda,
          market: marketPda,
        })
        .rpc(),
    );

    const resultHash = Array.from(Keypair.generate().publicKey.toBytes());
    await record(
      program.methods
        .reportOutcome(
          Array.from(roundSeed),
          winnerSide,
          resultHash,
          `sim://round/${round}`,
        )
        .accountsStrict({
          reporter: authority.publicKey,
          config: configPda,
          oracleRound: oraclePda,
        })
        .rpc(),
    );

    await record(
      program.methods
        .resolveMarketFromOracle()
        .accountsStrict({
          resolver: authority.publicKey,
          config: configPda,
          mint,
          market: marketPda,
          oracleRound: oraclePda,
          marketVault,
          feeVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );

    let winningClaims = 0;
    for (const bettor of bettors) {
      if (
        roundBetSides.get(bettor.wallet.publicKey.toBase58()) !== winnerSide
      ) {
        continue;
      }

      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position", "utf8"),
          marketPda.toBuffer(),
          bettor.wallet.publicKey.toBuffer(),
        ],
        programId,
      );

      executionStats.claimAttempts += 1;
      await recordWithRetries(
        `round ${round} claim for ${bettor.wallet.publicKey.toBase58()}`,
        () =>
          program.methods
            .claim()
            .accountsStrict({
              bettor: bettor.wallet.publicKey,
              mint,
              market: marketPda,
              marketVault,
              position: positionPda,
              destinationAta: bettor.tokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([bettor.wallet])
            .rpc(),
        2,
      );
      executionStats.claimSuccess += 1;
      winningClaims += 1;
    }

    const marketState = await program.account.marketRound.fetch(marketPda);
    if (marketState.status !== STATUS_RESOLVED) {
      throw new Error(`Round ${round} did not resolve on-chain`);
    }

    roundSummaries.push({
      round,
      winner,
      houseBias,
      poolA: poolA.toString(),
      poolB: poolB.toString(),
      feeAmount: (marketState.feeAmount as BN).toString(),
      betsPlaced: roundBetSides.size,
      winningClaims,
    });
    console.log(`Round ${round}: resolved, winner claims=${winningClaims}`);
  }

  const walletPnl = [];
  for (const bettor of bettors) {
    const finalBalance = (
      await getAccount(
        connection,
        bettor.tokenAccount,
        "confirmed",
        TOKEN_PROGRAM_ID,
      )
    ).amount;
    walletPnl.push({
      address: bettor.wallet.publicKey.toBase58(),
      strategy: bettor.strategy,
      initialBalance: bettor.initialBalance.toString(),
      finalBalance: finalBalance.toString(),
      pnl: (finalBalance - bettor.initialBalance).toString(),
    });
  }

  const strategyAgg = new Map<
    Strategy,
    { total: bigint; wallets: number; positive: number }
  >();
  for (const strategy of STRATEGIES) {
    strategyAgg.set(strategy, { total: 0n, wallets: 0, positive: 0 });
  }
  for (const row of walletPnl) {
    const agg = strategyAgg.get(row.strategy as Strategy)!;
    const pnl = BigInt(row.pnl);
    agg.total += pnl;
    agg.wallets += 1;
    if (pnl > 0n) agg.positive += 1;
  }

  const strategyPnl = STRATEGIES.map((strategy) => {
    const agg = strategyAgg.get(strategy)!;
    return {
      strategy,
      wallets: agg.wallets,
      totalPnl: agg.total.toString(),
      averagePnl:
        agg.wallets === 0 ? "0" : (agg.total / BigInt(agg.wallets)).toString(),
      positiveWallets: agg.positive,
    };
  });

  let verifiedSignatures = 0;
  for (const group of chunk(txSignatures, 256)) {
    const statuses = await connection.getSignatureStatuses(group, {
      searchTransactionHistory: true,
    });
    for (const status of statuses.value) {
      if (status && !status.err) {
        verifiedSignatures += 1;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    rpcUrl,
    programId: programId.toBase58(),
    mint: mint.toBase58(),
    wallets: WALLET_COUNT,
    rounds: ROUNDS,
    chainVerification: {
      signaturesSubmitted: txSignatures.length,
      signaturesVerified: verifiedSignatures,
      verificationPassed: txSignatures.length === verifiedSignatures,
    },
    executionStats,
    roundsSummary: roundSummaries,
    strategyPnl,
    walletPnl,
  };

  const outputDir = join(workspaceDir, "simulations");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "solana-localnet-pnl.json");
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("\n=== Solana Localnet Simulation Complete ===");
  console.log(`Wallets: ${WALLET_COUNT}`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log(
    `Signatures verified: ${verifiedSignatures}/${txSignatures.length}`,
  );
  for (const row of strategyPnl) {
    console.log(
      `${row.strategy}: total=${row.totalPnl} avg=${row.averagePnl} positive=${row.positiveWallets}/${row.wallets}`,
    );
  }
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
