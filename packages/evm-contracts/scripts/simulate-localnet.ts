import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "hardhat";

type Winner = "YES" | "NO";
type Strategy =
  | "cabal_against_house"
  | "mev"
  | "random"
  | "always_winner"
  | "highest_spread";

type Bettor = {
  wallet: ReturnType<typeof ethers.Wallet.createRandom> & {
    address: string;
  };
  strategy: Strategy;
  initialBalance: bigint;
};

type RoundSummary = {
  round: number;
  matchId: string;
  winner: Winner;
  houseBias: Winner;
  txCount: number;
  betsPlaced: number;
  winningClaims: number;
};

type WalletPnl = {
  address: string;
  strategy: Strategy;
  initialBalance: string;
  finalBalance: string;
  pnl: string;
};

type StrategyPnl = {
  strategy: Strategy;
  wallets: number;
  totalPnl: string;
  averagePnl: string;
  positiveWallets: number;
};

const STRATEGIES: Strategy[] = [
  "cabal_against_house",
  "mev",
  "random",
  "always_winner",
  "highest_spread",
];

const WALLET_COUNT = 100;
const ROUNDS = 4;
const INITIAL_GOLD = 1_000_000_000n;
const BASE_ORDER_AMOUNT = 2_000_000n;
const HOUSE_LIQUIDITY = 200_000_000n;
const ONE_ETH = ethers.parseEther("1");

function clampPrice(price: number): number {
  return Math.max(1, Math.min(999, Math.floor(price)));
}

function createRng(seed: bigint): () => number {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const value = Number(state & 0xffff_ffffn);
    return Math.abs(value) / 0xffff_ffff;
  };
}

function pickWinner(rng: () => number): Winner {
  return rng() > 0.5 ? "YES" : "NO";
}

function orderFromStrategy(
  strategy: Strategy,
  winner: Winner,
  houseBias: Winner,
  bestBid: bigint,
  bestAsk: bigint,
  rng: () => number,
): { isBuy: boolean; price: number; amount: bigint } {
  const bid = Number(bestBid);
  const ask = Number(bestAsk);
  const spread = Math.max(0, ask - bid);
  const amountBump = BigInt(Math.floor(rng() * 600_000));
  const amount = BASE_ORDER_AMOUNT + amountBump;

  if (strategy === "always_winner") {
    if (winner === "YES") {
      return { isBuy: true, price: clampPrice(Math.max(ask, 650)), amount };
    }
    return {
      isBuy: false,
      price: clampPrice(Math.min(bid || 400, 350)),
      amount,
    };
  }

  if (strategy === "cabal_against_house") {
    if (houseBias === "YES") {
      return {
        isBuy: false,
        price: clampPrice(Math.min(bid || 420, 450)),
        amount,
      };
    }
    return { isBuy: true, price: clampPrice(Math.max(ask, 550)), amount };
  }

  if (strategy === "mev") {
    if (spread >= 100) {
      if (rng() > 0.5) {
        return {
          isBuy: true,
          price: clampPrice(Math.max(ask, bid + spread / 2)),
          amount,
        };
      }
      return {
        isBuy: false,
        price: clampPrice(Math.min(bid || 450, ask - spread / 2)),
        amount,
      };
    }
    if (winner === "YES") {
      return { isBuy: true, price: clampPrice(Math.max(ask, 560)), amount };
    }
    return {
      isBuy: false,
      price: clampPrice(Math.min(bid || 440, 440)),
      amount,
    };
  }

  if (strategy === "highest_spread") {
    if (spread >= 100) {
      if (ask <= 500) {
        return { isBuy: true, price: clampPrice(ask + 25), amount };
      }
      if (bid >= 500) {
        return { isBuy: false, price: clampPrice(bid - 25), amount };
      }
    }
    if (rng() > 0.5) {
      return { isBuy: true, price: clampPrice(Math.max(ask, 540)), amount };
    }
    return {
      isBuy: false,
      price: clampPrice(Math.min(bid || 460, 460)),
      amount,
    };
  }

  if (rng() > 0.5) {
    return {
      isBuy: true,
      price: clampPrice(Math.max(ask, 520 + Math.floor(rng() * 180))),
      amount,
    };
  }
  return {
    isBuy: false,
    price: clampPrice(Math.min(bid || 480, 480 - Math.floor(rng() * 160))),
    amount,
  };
}

async function main() {
  const [admin, treasury, houseBidSigner, houseAskSigner] =
    await ethers.getSigners();
  const txHashes: string[] = [];
  const roundSummaries: RoundSummary[] = [];
  const executionStats = {
    betAttempts: 0,
    betSuccess: 0,
    betFailures: 0,
    claimAttempts: 0,
    claimSuccess: 0,
    claimFailures: 0,
  };

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Gold", "GOLD");
  await token.waitForDeployment();

  const GoldClob = await ethers.getContractFactory("GoldClob");
  const clob = await GoldClob.deploy(
    await token.getAddress(),
    treasury.address,
    houseBidSigner.address,
  );
  await clob.waitForDeployment();
  const clobAddress = await clob.getAddress();

  async function sendTx(
    txPromise: Promise<{
      hash: string;
      wait: () => Promise<{ status: bigint | number | null }>;
    }>,
  ) {
    const tx = await txPromise;
    txHashes.push(tx.hash);
    const receipt = await tx.wait();
    const status =
      typeof receipt.status === "bigint"
        ? Number(receipt.status)
        : receipt.status;
    if (status !== 1) {
      throw new Error(`Transaction failed: ${tx.hash}`);
    }
  }

  const bettors: Bettor[] = [];
  for (let i = 0; i < WALLET_COUNT; i += 1) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await sendTx(admin.sendTransaction({ to: wallet.address, value: ONE_ETH }));
    await sendTx(token.mint(wallet.address, INITIAL_GOLD));
    await sendTx(token.connect(wallet).approve(clobAddress, ethers.MaxUint256));
    bettors.push({
      wallet,
      strategy: STRATEGIES[i % STRATEGIES.length],
      initialBalance: await token.balanceOf(wallet.address),
    });
  }

  await sendTx(token.mint(houseBidSigner.address, INITIAL_GOLD * 40n));
  await sendTx(token.mint(houseAskSigner.address, INITIAL_GOLD * 40n));
  await sendTx(
    token.connect(houseBidSigner).approve(clobAddress, ethers.MaxUint256),
  );
  await sendTx(
    token.connect(houseAskSigner).approve(clobAddress, ethers.MaxUint256),
  );

  const rng = createRng(0x5eedn);

  for (let round = 1; round <= ROUNDS; round += 1) {
    const txStart = txHashes.length;
    await sendTx(clob.connect(admin).createMatch());
    const matchId = BigInt(round);
    const winner = pickWinner(rng);
    const houseBias = round % 2 === 0 ? "YES" : "NO";
    const roundBetters = new Set<string>();

    await sendTx(
      clob
        .connect(houseBidSigner)
        .placeOrder(matchId, true, 400, HOUSE_LIQUIDITY),
    );
    await sendTx(
      clob
        .connect(houseAskSigner)
        .placeOrder(matchId, false, 600, HOUSE_LIQUIDITY),
    );

    for (const bettor of bettors) {
      const bestBid = await clob.bestBids(matchId);
      const bestAsk = await clob.bestAsks(matchId);
      const primaryOrder = orderFromStrategy(
        bettor.strategy,
        winner,
        houseBias,
        bestBid,
        bestAsk,
        rng,
      );
      const fallbackOrders = [
        {
          isBuy: !primaryOrder.isBuy,
          price: primaryOrder.isBuy
            ? clampPrice(Number(bestBid) || 500)
            : clampPrice(Number(bestAsk) < 1000 ? Number(bestAsk) : 500),
          amount: BASE_ORDER_AMOUNT,
        },
        {
          isBuy: primaryOrder.isBuy,
          price: primaryOrder.isBuy ? 999 : 1,
          amount: BASE_ORDER_AMOUNT,
        },
      ];

      const candidates = [primaryOrder, ...fallbackOrders];
      let placed = false;
      for (const order of candidates) {
        executionStats.betAttempts += 1;
        try {
          await sendTx(
            clob
              .connect(bettor.wallet)
              .placeOrder(matchId, order.isBuy, order.price, order.amount),
          );
          executionStats.betSuccess += 1;
          roundBetters.add(bettor.wallet.address);
          placed = true;
          break;
        } catch {
          executionStats.betFailures += 1;
        }
      }

      if (!placed) {
        throw new Error(
          `Round ${round}: failed to place a valid order for wallet ${bettor.wallet.address}`,
        );
      }
    }
    if (roundBetters.size !== WALLET_COUNT) {
      throw new Error(
        `Round ${round}: expected ${WALLET_COUNT} participants, got ${roundBetters.size}`,
      );
    }

    await sendTx(
      clob.connect(admin).resolveMatch(matchId, winner === "YES" ? 1 : 2),
    );

    let winningClaims = 0;
    for (const bettor of bettors) {
      const position = await clob.positions(matchId, bettor.wallet.address);
      const winningShares =
        winner === "YES" ? position.yesShares : position.noShares;
      if (winningShares === 0n) {
        continue;
      }
      executionStats.claimAttempts += 1;
      try {
        await sendTx(clob.connect(bettor.wallet).claim(matchId));
        executionStats.claimSuccess += 1;
        winningClaims += 1;
      } catch {
        executionStats.claimFailures += 1;
        throw new Error(
          `Round ${round}: winner claim failed for ${bettor.wallet.address}`,
        );
      }
    }

    roundSummaries.push({
      round,
      matchId: matchId.toString(),
      winner,
      houseBias,
      txCount: txHashes.length - txStart,
      betsPlaced: roundBetters.size,
      winningClaims,
    });
  }

  const walletPnl: WalletPnl[] = [];
  for (const bettor of bettors) {
    const finalBalance = await token.balanceOf(bettor.wallet.address);
    walletPnl.push({
      address: bettor.wallet.address,
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
    const agg = byStrategy.get(row.strategy)!;
    const pnl = BigInt(row.pnl);
    agg.total += pnl;
    agg.wallets += 1;
    if (pnl > 0n) agg.positive += 1;
  }

  const strategyPnl: StrategyPnl[] = STRATEGIES.map((strategy) => {
    const agg = byStrategy.get(strategy)!;
    const average = agg.wallets === 0 ? 0n : agg.total / BigInt(agg.wallets);
    return {
      strategy,
      wallets: agg.wallets,
      totalPnl: agg.total.toString(),
      averagePnl: average.toString(),
      positiveWallets: agg.positive,
    };
  });

  let verifiedReceipts = 0;
  for (const hash of txHashes) {
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    if (receipt && receipt.status === 1) {
      verifiedReceipts += 1;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    wallets: WALLET_COUNT,
    rounds: ROUNDS,
    contract: {
      goldToken: await token.getAddress(),
      clob: clobAddress,
    },
    chainVerification: {
      transactionsSubmitted: txHashes.length,
      receiptsVerified: verifiedReceipts,
      verificationPassed: verifiedReceipts === txHashes.length,
    },
    executionStats,
    roundsSummary: roundSummaries,
    strategyPnl,
    walletPnl,
  };

  const outputDir = join(process.cwd(), "simulations");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "evm-localnet-pnl.json");
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("\n=== EVM Localnet Simulation Complete ===");
  console.log(`Wallets: ${WALLET_COUNT}`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log(`Transactions: ${txHashes.length}`);
  console.log(`Receipts verified: ${verifiedReceipts}/${txHashes.length}`);
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
