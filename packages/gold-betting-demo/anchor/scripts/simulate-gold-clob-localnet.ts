import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
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

type Winner = "YES" | "NO";

type Bettor = {
  wallet: Keypair;
  strategy: Strategy;
  initialBalance: bigint;
};

type RoundSummary = {
  round: number;
  winner: Winner;
  houseBias: Winner;
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

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer (got: ${raw})`);
  }
  return parsed;
}

const WALLET_COUNT = parsePositiveIntEnv("SOLANA_NATIVE_SIM_WALLETS", 100);
const ROUNDS = parsePositiveIntEnv("SOLANA_NATIVE_SIM_ROUNDS", 1);
const BASE_ORDER_AMOUNT = 3_000_000n;
const BETTOR_FUNDING = Math.floor(2 * LAMPORTS_PER_SOL);
const TREASURY_FUNDING = Math.floor(0.1 * LAMPORTS_PER_SOL);
const MARKET_MAKER_FUNDING = Math.floor(0.1 * LAMPORTS_PER_SOL);

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

function clampPrice(price: number): number {
  return Math.max(1, Math.min(999, Math.floor(price)));
}

function toU64Bn(value: bigint): BN {
  return new BN(value.toString());
}

function normalizeAmount(value: bigint): bigint {
  const rounded = (value / 1000n) * 1000n;
  return rounded > 0n ? rounded : 1000n;
}

function pickWinner(rng: () => number): Winner {
  return rng() > 0.5 ? "YES" : "NO";
}

function orderFromStrategy(
  strategy: Strategy,
  winner: Winner,
  houseBias: Winner,
  rng: () => number,
): { isBuy: boolean; price: number; amount: bigint } {
  const amountBump = BigInt(Math.floor(rng() * 1_000_000));
  const amount = normalizeAmount(BASE_ORDER_AMOUNT + amountBump);

  if (strategy === "always_winner") {
    return winner === "YES"
      ? { isBuy: true, price: clampPrice(620 + rng() * 120), amount }
      : { isBuy: false, price: clampPrice(380 - rng() * 120), amount };
  }

  if (strategy === "cabal_against_house") {
    return houseBias === "YES"
      ? { isBuy: false, price: clampPrice(450 - rng() * 80), amount }
      : { isBuy: true, price: clampPrice(550 + rng() * 80), amount };
  }

  if (strategy === "mev") {
    if (rng() > 0.5) {
      return { isBuy: true, price: clampPrice(520 + rng() * 160), amount };
    }
    return { isBuy: false, price: clampPrice(480 - rng() * 160), amount };
  }

  if (strategy === "highest_spread") {
    if (rng() > 0.5) {
      return { isBuy: true, price: 999, amount };
    }
    return { isBuy: false, price: 1, amount };
  }

  if (rng() > 0.5) {
    return { isBuy: true, price: clampPrice(500 + rng() * 250), amount };
  }
  return { isBuy: false, price: clampPrice(500 - rng() * 250), amount };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function deriveUserBalancePda(
  programId: PublicKey,
  matchState: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), matchState.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

function deriveOrderPda(
  programId: PublicKey,
  matchState: PublicKey,
  user: PublicKey,
  orderId: BN,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      matchState.toBuffer(),
      user.toBuffer(),
      orderId.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  )[0];
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const idlPath = join(workspaceDir, "target", "idl", "gold_clob_market.json");

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const wsUrl = process.env.ANCHOR_WS_URL;
  const walletPath =
    process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]),
  );
  const connection =
    wsUrl !== undefined
      ? new anchor.web3.Connection(rpcUrl, {
          commitment: "confirmed",
          wsEndpoint: wsUrl,
        })
      : new anchor.web3.Connection(rpcUrl, "confirmed");
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

  const signatures: string[] = [];
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
    signatures.push(sig);
    return sig;
  }

  async function recordWithRetries(
    label: string,
    signatureFactory: () => Promise<string>,
    maxAttempts = 3,
  ) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await record(signatureFactory());
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

  async function sendAndConfirmWithRetries(
    label: string,
    transaction: Transaction,
    signers: Keypair[] = [],
  ) {
    await recordWithRetries(label, () =>
      provider.sendAndConfirm(transaction, signers, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        maxRetries: 8,
      }),
    );
  }

  async function sendSol(to: PublicKey, lamports: number) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: to,
        lamports,
      }),
    );
    await sendAndConfirmWithRetries("fund-wallet", tx, []);
  }

  async function fundWallets(recipients: PublicKey[], lamports: number) {
    for (const group of chunk(recipients, 20)) {
      const tx = new Transaction();
      for (const recipient of group) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: recipient,
            lamports,
          }),
        );
      }
      await sendAndConfirmWithRetries("fund-wallet-batch", tx, []);
    }
  }

  async function getBalance(pubkey: PublicKey) {
    return BigInt(await connection.getBalance(pubkey, "confirmed"));
  }

  async function nextOrderId(matchState: PublicKey) {
    const state = (await program.account.matchState.fetch(matchState)) as {
      nextOrderId: BN;
    };
    return new BN(state.nextOrderId.toString());
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );

  const treasuryWallet = Keypair.generate();
  const marketMakerWallet = Keypair.generate();
  await Promise.all([
    sendSol(treasuryWallet.publicKey, TREASURY_FUNDING),
    sendSol(marketMakerWallet.publicKey, MARKET_MAKER_FUNDING),
  ]);

  await recordWithRetries("initialize-config", () =>
    program.methods
      .initializeConfig(
        treasuryWallet.publicKey,
        marketMakerWallet.publicKey,
        100,
        100,
        200,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  ).catch(async () => {
    await recordWithRetries("update-config", () =>
      program.methods
        .updateConfig(
          treasuryWallet.publicKey,
          marketMakerWallet.publicKey,
          100,
          100,
          200,
        )
        .accountsPartial({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc(),
    );
  });

  const treasuryStartBalance = await getBalance(treasuryWallet.publicKey);
  const mmStartBalance = await getBalance(marketMakerWallet.publicKey);

  const bettors: Bettor[] = Array.from({ length: WALLET_COUNT }, (_, i) => ({
    wallet: Keypair.generate(),
    strategy: STRATEGIES[i % STRATEGIES.length],
    initialBalance: BigInt(BETTOR_FUNDING),
  }));
  await fundWallets(
    bettors.map((bettor) => bettor.wallet.publicKey),
    BETTOR_FUNDING,
  );

  for (let round = 1; round <= ROUNDS; round += 1) {
    const matchState = Keypair.generate();
    const orderBook = Keypair.generate();
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), matchState.publicKey.toBuffer()],
      programId,
    );

    await recordWithRetries("initialize-match", () =>
      program.methods
        .initializeMatch(500)
        .accountsPartial({
          matchState: matchState.publicKey,
          user: authority.publicKey,
          config: configPda,
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([matchState])
        .rpc(),
    );

    await recordWithRetries("initialize-order-book", () =>
      program.methods
        .initializeOrderBook()
        .accountsPartial({
          user: authority.publicKey,
          matchState: matchState.publicKey,
          orderBook: orderBook.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([orderBook])
        .rpc(),
    );

    // Ensure the vault PDA is rent-exempt before receiving small trade flows.
    await sendSol(vault, Math.floor(0.05 * LAMPORTS_PER_SOL));

    const winner = pickWinner(rng);
    const houseBias: Winner = round % 2 === 0 ? "YES" : "NO";
    let betsPlaced = 0;

    for (const bettor of bettors) {
      const order = orderFromStrategy(bettor.strategy, winner, houseBias, rng);

      executionStats.betAttempts += 1;

      const bettorOrderId = await nextOrderId(matchState.publicKey);
      const userBalance = deriveUserBalancePda(
        programId,
        matchState.publicKey,
        bettor.wallet.publicKey,
      );
      const newOrder = deriveOrderPda(
        programId,
        matchState.publicKey,
        bettor.wallet.publicKey,
        bettorOrderId,
      );
      await recordWithRetries("bettor-order", () =>
        program.methods
          .placeOrder(
            bettorOrderId,
            order.isBuy,
            order.price,
            toU64Bn(order.amount),
          )
          .accountsPartial({
            matchState: matchState.publicKey,
            orderBook: orderBook.publicKey,
            userBalance,
            newOrder,
            config: configPda,
            treasury: treasuryWallet.publicKey,
            marketMaker: marketMakerWallet.publicKey,
            vault,
            user: bettor.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([bettor.wallet])
          .rpc(),
      );

      executionStats.betSuccess += 1;
      betsPlaced += 1;
    }

    const winnerArg =
      winner === "YES" ? ({ yes: {} } as any) : ({ no: {} } as any);
    await recordWithRetries("resolve-match", () =>
      program.methods
        .resolveMatch(winnerArg)
        .accountsPartial({
          matchState: matchState.publicKey,
          authority: authority.publicKey,
        })
        .rpc(),
    );

    const winningClaims = 0;

    roundSummaries.push({
      round,
      winner,
      houseBias,
      betsPlaced,
      winningClaims,
    });
  }

  const walletPnl = [];
  for (const bettor of bettors) {
    const finalBalance = await getBalance(bettor.wallet.publicKey);
    walletPnl.push({
      address: bettor.wallet.publicKey.toBase58(),
      strategy: bettor.strategy,
      initialBalance: bettor.initialBalance.toString(),
      finalBalance: finalBalance.toString(),
      pnl: (finalBalance - bettor.initialBalance).toString(),
    });
  }

  const byStrategy = new Map<
    Strategy,
    { total: bigint; wallets: number; positive: number }
  >();
  for (const strategy of STRATEGIES) {
    byStrategy.set(strategy, { total: 0n, wallets: 0, positive: 0 });
  }

  for (const row of walletPnl) {
    const agg = byStrategy.get(row.strategy as Strategy)!;
    const pnl = BigInt(row.pnl);
    agg.total += pnl;
    agg.wallets += 1;
    if (pnl > 0n) agg.positive += 1;
  }

  const strategyPnl = STRATEGIES.map((strategy) => {
    const agg = byStrategy.get(strategy)!;
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
  for (const group of chunk(signatures, 256)) {
    const statuses = await connection.getSignatureStatuses(group, {
      searchTransactionHistory: true,
    });
    for (const status of statuses.value) {
      if (status && !status.err) {
        verifiedSignatures += 1;
      }
    }
  }

  const treasuryEndBalance = await getBalance(treasuryWallet.publicKey);
  const mmEndBalance = await getBalance(marketMakerWallet.publicKey);

  const report = {
    generatedAt: new Date().toISOString(),
    rpcUrl,
    programId: programId.toBase58(),
    wallets: WALLET_COUNT,
    rounds: ROUNDS,
    feeFlows: {
      tradingFeesToTreasury: (
        treasuryEndBalance - treasuryStartBalance
      ).toString(),
      allFeesToMarketMaker: (mmEndBalance - mmStartBalance).toString(),
    },
    chainVerification: {
      signaturesSubmitted: signatures.length,
      signaturesVerified: verifiedSignatures,
      verificationPassed: signatures.length === verifiedSignatures,
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

  console.log("\n=== Solana CLOB Localnet Simulation Complete ===");
  console.log(`Wallets: ${WALLET_COUNT}`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log(
    `Signatures verified: ${verifiedSignatures}/${signatures.length}`,
  );
  console.log(
    `Trading fees -> treasury: ${report.feeFlows.tradingFeesToTreasury}`,
  );
  console.log(
    `All fees -> market maker: ${report.feeFlows.allFeesToMarketMaker}`,
  );
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
