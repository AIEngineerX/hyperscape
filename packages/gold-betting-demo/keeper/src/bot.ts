/* eslint-disable @typescript-eslint/no-explicit-any */
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  baseUnitsFromGold,
  createPrograms,
  detectTokenProgramForMint,
  enumIs,
  findAnyTokenAccountForMint,
  findMarketConfigPda,
  findMarketPda,
  findMatchPda,
  findNoVaultPda,
  findOracleConfigPda,
  findPositionPda,
  findYesVaultPda,
  readKeypair,
  requireEnv,
} from "./common";
import { simulateFight } from "./fight";

function asNum(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTxSignature(error: unknown): string | null {
  const message = (error as Error)?.message ?? "";
  const match = message.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{32,88})/i);
  return match?.[1] ?? null;
}

function isIgnorableRaceError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return (
    message.includes("MarketNotOpen") ||
    message.includes("BettingClosed") ||
    message.includes("MarketAlreadyResolved") ||
    message.includes("OracleNotResolved") ||
    message.includes("MatchAlreadyResolved") ||
    message.includes("BetWindowStillOpen") ||
    message.includes("MarketAlreadyHasUserBets") ||
    message.includes("LiquidityAlreadySeeded") ||
    message.includes("SeedWindowNotReached")
  );
}

async function waitForTxBySignature(
  connection: any,
  signature: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status) {
      if (status.err) return false;
      if (status.confirmationStatus) return true;
    }
    await sleep(2_000);
  }
  return false;
}

async function runWithRecovery<T>(
  fn: () => Promise<T>,
  connection: any,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const signature = extractTxSignature(error);
    if (!signature) throw error;
    const ok = await waitForTxBySignature(connection, signature);
    if (!ok) throw error;
    return undefined as T;
  }
}

const args = await yargs(hideBin(process.argv))
  .option("once", {
    type: "boolean",
    default: process.env.BOT_LOOP !== "true",
    describe: "Run one cycle and exit",
  })
  .option("poll-seconds", {
    type: "number",
    default: Number(process.env.BOT_POLL_SECONDS || 5),
    describe: "Delay between loop cycles",
  })
  .option("bet-window-seconds", {
    type: "number",
    default: Number(process.env.BET_WINDOW_SECONDS || 300),
    describe: "Bet window for newly created rounds",
  })
  .option("auto-seed-delay-seconds", {
    type: "number",
    default: Number(process.env.AUTO_SEED_DELAY_SECONDS || 10),
    describe: "Auto-seed delay for new markets",
  })
  .option("seed-gold", {
    type: "number",
    default: Number(process.env.MARKET_MAKER_SEED_GOLD || 1),
    describe: "Target seed GOLD on each side",
  })
  .option("fee-bps", {
    type: "number",
    default: Number(process.env.BET_FEE_BPS || 100),
    describe: "Fee in basis points routed to fee wallet",
  })
  .option("gold-mint", {
    type: "string",
    default: process.env.GOLD_MINT,
    describe: "GOLD mint address used for new markets",
  })
  .strict()
  .parse();

const botKeypair = readKeypair(
  process.env.BOT_KEYPAIR ||
    process.env.ORACLE_AUTHORITY_KEYPAIR ||
    process.env.MARKET_MAKER_KEYPAIR ||
    requireEnv("ORACLE_AUTHORITY_KEYPAIR"),
);
const { connection, fightOracle, goldBinaryMarket } =
  createPrograms(botKeypair);
const fightProgram: any = fightOracle;
const marketProgram: any = goldBinaryMarket;

const oracleConfigPda = findOracleConfigPda(fightOracle.programId);
const marketConfigPda = findMarketConfigPda(goldBinaryMarket.programId);

const configuredGoldMint = args["gold-mint"]
  ? new PublicKey(args["gold-mint"])
  : null;

const ensureOracleReady = async (): Promise<void> => {
  await runWithRecovery(
    () =>
      fightProgram.methods
        .initializeOracle()
        .accounts({
          authority: botKeypair.publicKey,
          oracleConfig: oracleConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  const config = await fightProgram.account.oracleConfig.fetch(oracleConfigPda);
  if (!(config.authority as PublicKey).equals(botKeypair.publicKey)) {
    throw new Error(
      `Bot wallet ${botKeypair.publicKey.toBase58()} is not oracle authority`,
    );
  }
};

const ensureMarketConfigReady = async (
  goldMint: PublicKey,
): Promise<PublicKey> => {
  await runWithRecovery(
    () =>
      marketProgram.methods
        .initializeMarketConfig(
          botKeypair.publicKey,
          botKeypair.publicKey,
          args["fee-bps"],
        )
        .accounts({
          authority: botKeypair.publicKey,
          marketConfig: marketConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  const marketConfig =
    await marketProgram.account.marketConfig.fetch(marketConfigPda);
  if (!(marketConfig.marketMaker as PublicKey).equals(botKeypair.publicKey)) {
    throw new Error("Market config market maker does not match bot wallet");
  }

  const feeWalletGold = await findAnyTokenAccountForMint(
    connection,
    marketConfig.feeWallet as PublicKey,
    goldMint,
  );
  if (!feeWalletGold.tokenAccount) {
    throw new Error(
      `Fee wallet ${(
        marketConfig.feeWallet as PublicKey
      ).toBase58()} has no GOLD token account`,
    );
  }

  return (
    feeWalletGold.tokenProgram ??
    (await detectTokenProgramForMint(connection, goldMint))
  );
};

async function getMatchState(matchPda: PublicKey): Promise<any | null> {
  return fightProgram.account.matchResult.fetchNullable(matchPda);
}

async function getMarketState(marketPda: PublicKey): Promise<any | null> {
  return marketProgram.account.market.fetchNullable(marketPda);
}

async function createRound(
  goldMint: PublicKey,
  tokenProgram: PublicKey,
): Promise<{ matchId: number; matchPda: PublicKey; marketPda: PublicKey }> {
  const matchId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const matchPda = findMatchPda(fightOracle.programId, new BN(matchId));
  const marketPda = findMarketPda(goldBinaryMarket.programId, matchPda);
  const yesVaultPda = findYesVaultPda(goldBinaryMarket.programId, marketPda);
  const noVaultPda = findNoVaultPda(goldBinaryMarket.programId, marketPda);
  const vaultAuthorityPda = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_auth"), marketPda.toBuffer()],
    goldBinaryMarket.programId,
  )[0];

  await runWithRecovery(
    () =>
      fightProgram.methods
        .createMatch(new BN(matchId), new BN(args["bet-window-seconds"]))
        .accounts({
          authority: botKeypair.publicKey,
          oracleConfig: oracleConfigPda,
          matchResult: matchPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  await runWithRecovery(
    () =>
      marketProgram.methods
        .initializeMarket(new BN(args["auto-seed-delay-seconds"]))
        .accounts({
          payer: botKeypair.publicKey,
          marketMaker: botKeypair.publicKey,
          oracleMatch: matchPda,
          marketConfig: marketConfigPda,
          market: marketPda,
          vaultAuthority: vaultAuthorityPda,
          yesVault: yesVaultPda,
          noVault: noVaultPda,
          goldMint,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  return { matchId, matchPda, marketPda };
}

async function maybeSeedMarket(
  marketPda: PublicKey,
  market: any,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (!enumIs(market.status, "open")) return;
  if (now < asNum(market.openTs) + asNum(market.autoSeedDelaySeconds)) return;
  if (asNum(market.userYesTotal) > 0 || asNum(market.userNoTotal) > 0) return;
  if (asNum(market.makerYesTotal) > 0 || asNum(market.makerNoTotal) > 0) return;

  const marketMaker = market.marketMaker as PublicKey;
  if (!marketMaker.equals(botKeypair.publicKey)) return;

  const makerGold = await findAnyTokenAccountForMint(
    connection,
    marketMaker,
    market.goldMint as PublicKey,
  );
  if (!makerGold.tokenAccount || !makerGold.tokenProgram) return;

  const balance = await connection.getTokenAccountBalance(
    makerGold.tokenAccount,
  );
  const available = BigInt(balance.value.amount);
  const targetEach = BigInt(baseUnitsFromGold(args["seed-gold"]).toString());
  const maxEach = available / 2n;
  const amountEach = targetEach <= maxEach ? targetEach : maxEach;
  if (amountEach <= 0n) return;

  const yesVaultPda = findYesVaultPda(goldBinaryMarket.programId, marketPda);
  const noVaultPda = findNoVaultPda(goldBinaryMarket.programId, marketPda);
  const makerPositionPda = findPositionPda(
    goldBinaryMarket.programId,
    marketPda,
    marketMaker,
  );

  try {
    await runWithRecovery(
      () =>
        marketProgram.methods
          .seedLiquidityIfEmpty(new BN(amountEach.toString()))
          .accounts({
            marketMaker,
            market: marketPda,
            marketMakerGoldAta: makerGold.tokenAccount!,
            yesVault: yesVaultPda,
            noVault: noVaultPda,
            marketMakerPosition: makerPositionPda,
            goldMint: market.goldMint,
            tokenProgram: makerGold.tokenProgram!,
          })
          .rpc(),
      connection,
    );
  } catch (error) {
    if (isIgnorableRaceError(error)) return;
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        action: "seeded",
        market: marketPda.toBase58(),
        amountEach: amountEach.toString(),
      },
      null,
      2,
    ),
  );
}

async function maybeResolveMatch(
  matchPda: PublicKey,
  matchState: any,
): Promise<void> {
  if (!enumIs(matchState.status, "open")) return;
  const now = Math.floor(Date.now() / 1000);
  if (now < asNum(matchState.betCloseTs)) return;

  const fight = simulateFight(BigInt(Date.now()));
  try {
    await runWithRecovery(
      () =>
        fightProgram.methods
          .postResult(
            fight.winner === "A" ? ({ yes: {} } as any) : ({ no: {} } as any),
            new BN(fight.seed.toString()),
            Array.from(fight.replayHash),
          )
          .accounts({
            authority: botKeypair.publicKey,
            oracleConfig: oracleConfigPda,
            matchResult: matchPda,
          })
          .rpc(),
      connection,
    );
  } catch (error) {
    if (isIgnorableRaceError(error)) return;
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        action: "oracle_posted",
        match: matchPda.toBase58(),
      },
      null,
      2,
    ),
  );
}

async function maybeResolveMarket(matchPda: PublicKey): Promise<void> {
  const marketPda = findMarketPda(goldBinaryMarket.programId, matchPda);
  const market = await getMarketState(marketPda);
  const matchState = await getMatchState(matchPda);
  if (!market || !matchState) return;
  if (!enumIs(market.status, "open")) return;
  if (!enumIs(matchState.status, "resolved")) return;

  try {
    await runWithRecovery(
      () =>
        marketProgram.methods
          .resolveFromOracle()
          .accounts({
            resolver: botKeypair.publicKey,
            market: marketPda,
            oracleMatch: matchPda,
          })
          .rpc(),
      connection,
    );
  } catch (error) {
    if (isIgnorableRaceError(error)) return;
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        action: "market_resolved",
        market: marketPda.toBase58(),
      },
      null,
      2,
    ),
  );
}

async function runCycle(): Promise<void> {
  await ensureOracleReady();

  const latestMatches = (await fightProgram.account.matchResult.all()) as any[];
  latestMatches.sort(
    (a, b) =>
      asNum(b.account.matchId) - asNum(a.account.matchId) ||
      asNum(b.account.openTs) - asNum(a.account.openTs),
  );

  let discoveredGoldMint: PublicKey | null = configuredGoldMint;
  if (!discoveredGoldMint) {
    for (const entry of latestMatches) {
      const marketPda = findMarketPda(
        goldBinaryMarket.programId,
        entry.publicKey,
      );
      const market = await getMarketState(marketPda);
      if (market?.goldMint) {
        discoveredGoldMint = market.goldMint as PublicKey;
        break;
      }
    }
  }

  if (!discoveredGoldMint) {
    throw new Error("Missing GOLD_MINT. Set GOLD_MINT in env for the bot.");
  }

  const tokenProgram = await ensureMarketConfigReady(discoveredGoldMint);
  const now = Math.floor(Date.now() / 1000);
  let hasBettableMarket = false;

  for (const entry of latestMatches.slice(0, 50)) {
    const matchPda = entry.publicKey as PublicKey;
    const matchState = entry.account;
    const marketPda = findMarketPda(goldBinaryMarket.programId, matchPda);
    const market = await getMarketState(marketPda);

    if (
      market &&
      enumIs(market.status, "open") &&
      now < asNum(market.closeTs)
    ) {
      hasBettableMarket = true;
    }

    await maybeResolveMatch(matchPda, matchState);
    await maybeResolveMarket(matchPda);
    if (market) {
      await maybeSeedMarket(marketPda, market);
    }
  }

  if (!hasBettableMarket) {
    const created = await createRound(discoveredGoldMint, tokenProgram);
    console.log(
      JSON.stringify(
        {
          action: "market_created",
          matchId: created.matchId,
          match: created.matchPda.toBase58(),
          market: created.marketPda.toBase58(),
        },
        null,
        2,
      ),
    );
  }
}

for (;;) {
  try {
    await runCycle();
  } catch (error) {
    console.error(`[bot] cycle failed: ${(error as Error).message}`);
  }

  if (args.once) break;
  await sleep(args["poll-seconds"] * 1_000);
}
