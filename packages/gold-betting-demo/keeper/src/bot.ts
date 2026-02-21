/* eslint-disable @typescript-eslint/no-explicit-any */
import BN from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
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

function isFundingError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes(
      "attempt to debit an account but found no record of a prior credit",
    ) ||
    message.includes("insufficient funds") ||
    message.includes("insufficient lamports") ||
    message.includes("fee payer")
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
  .option("game-url", {
    type: "string",
    default: process.env.GAME_URL || "http://localhost:3000",
    describe: "URL of the Hyperscape game server",
  })
  .strict()
  .parse();

import { GameClient } from "./game-client";

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
const botCluster = (
  process.env.SOLANA_CLUSTER ||
  process.env.CLUSTER ||
  "mainnet-beta"
)
  .toLowerCase()
  .trim();
const minSignerLamports = Math.max(
  5_000,
  Number(process.env.BOT_MIN_BALANCE_LAMPORTS || 100_000),
);
const fundingBackoffMs = Math.max(
  10_000,
  Number(process.env.BOT_FUNDING_CHECK_COOLDOWN_MS || 60_000),
);
const airdropRateLimitCooldownMs = Math.max(
  fundingBackoffMs,
  Number(process.env.BOT_AIRDROP_RATE_LIMIT_COOLDOWN_MS || 15 * 60 * 1000),
);
let fundingBlockedUntil = 0;
let lastFundingWarningAt = 0;
let airdropBlockedUntil = 0;

const oracleConfigPda = findOracleConfigPda(fightOracle.programId);
const marketConfigPda = findMarketConfigPda(goldBinaryMarket.programId);

const configuredGoldMint = args["gold-mint"]
  ? new PublicKey(args["gold-mint"])
  : null;

const canRequestAirdrop =
  botCluster === "testnet" ||
  botCluster === "devnet" ||
  botCluster === "localnet";

async function ensureBotSignerFunding(): Promise<boolean> {
  const now = Date.now();
  if (now < fundingBlockedUntil) {
    return false;
  }

  let lamports = await connection.getBalance(botKeypair.publicKey, "confirmed");
  if (lamports >= minSignerLamports) {
    return true;
  }

  if (canRequestAirdrop && now >= airdropBlockedUntil) {
    try {
      const airdropSig = await connection.requestAirdrop(
        botKeypair.publicKey,
        1 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(airdropSig, "confirmed");
      lamports = await connection.getBalance(botKeypair.publicKey, "confirmed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited =
        message.includes("429") || /too many requests/i.test(message);
      if (isRateLimited) {
        airdropBlockedUntil = Date.now() + airdropRateLimitCooldownMs;
      }
      if (Date.now() - lastFundingWarningAt > 10_000) {
        console.warn(`[bot] airdrop attempt failed: ${message}`);
        if (isRateLimited) {
          console.warn(
            `[bot] faucet rate-limited; pausing airdrop attempts for ${Math.round(
              airdropRateLimitCooldownMs / 1000,
            )}s`,
          );
        }
        lastFundingWarningAt = Date.now();
      }
    }
  }

  if (lamports >= minSignerLamports) {
    return true;
  }

  if (Date.now() - lastFundingWarningAt > 10_000) {
    console.warn(
      `[bot] bot wallet ${botKeypair.publicKey.toBase58()} has ${(
        lamports / LAMPORTS_PER_SOL
      ).toFixed(
        6,
      )} SOL (< ${(minSignerLamports / LAMPORTS_PER_SOL).toFixed(6)} required). ` +
        `Skipping keeper cycle for ${Math.round(fundingBackoffMs / 1000)}s.`,
    );
    lastFundingWarningAt = Date.now();
  }
  fundingBlockedUntil = Date.now() + fundingBackoffMs;
  return false;
}

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
  matchIdInput: number,
  metadata: string,
): Promise<{ matchId: number; matchPda: PublicKey; marketPda: PublicKey }> {
  // Use input match ID directly (assuming it fits in u64/number safe range, else use string/BN)
  // Hyperscape duel IDs might be UUIDs. We need a numeric ID for the contract.
  // We can hash the UUID to get 64-bit int, or use a timestamp.
  // For now, let's assume matchIdInput is provided as a number or we generate one.
  const matchId = matchIdInput;
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
        .createMatch(
          new BN(matchId),
          new BN(args["bet-window-seconds"]),
          metadata,
        )
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

// Event-driven Logic
const gameClient = new GameClient(args["game-url"]);

gameClient.onDuelStart(async (data: any) => {
  console.log("Duel Started:", data);
  try {
    // The game server now outputs strict numeric IDs that map natively to u64
    const numericMatchId = asNum(data.duelId);
    if (!numericMatchId) {
      console.warn(
        "Skipping market creation: received non-numeric or empty duelId:",
        data.duelId,
      );
      return;
    }

    const metadata = JSON.stringify({
      agent1: data.agent1?.name || "Agent A",
      agent2: data.agent2?.name || "Agent B",
    });

    // Check if gold mint is discovered
    let goldMint = configuredGoldMint;
    if (!goldMint) {
      // Try to find from recent markets
      const latestMatches =
        (await fightProgram.account.matchResult.all()) as any[];
      for (const entry of latestMatches) {
        const marketPda = findMarketPda(
          goldBinaryMarket.programId,
          entry.publicKey,
        );
        const market = await getMarketState(marketPda);
        if (market?.goldMint) {
          goldMint = market.goldMint as PublicKey;
          break;
        }
      }
    }

    if (!goldMint) {
      console.error("No GOLD mint found. Cannot create market.");
      return;
    }

    const tokenProgram = await ensureMarketConfigReady(goldMint);
    await createRound(goldMint, tokenProgram, numericMatchId, metadata);
    console.log(`Created market for duel ${numericMatchId}`);
  } catch (err) {
    console.error("Failed to create market for duel:", err);
  }
});

gameClient.onDuelEnd(async (data: any) => {
  console.log("Duel Ended:", data);
  try {
    const numericMatchId = asNum(data.duelId); // Must match creation ID
    if (!numericMatchId) return;

    const matchPda = findMatchPda(
      fightOracle.programId,
      new BN(numericMatchId),
    );
    // We need to resolve it.
    // postResult takes winner, seed, replayHash.
    // We need these from data.
    // data.winner should be "agent1" or "agent2" or ID.

    const winnerId = data.winnerId;
    const isAgent1 = winnerId === data.agent1?.id;
    const winnerSide = isAgent1 ? "A" : "B";

    // Use cryptographically secure oracle data emitted by the Game Server
    if (!data.seed || !data.replayHash) {
      console.warn(
        `[Keeper] Warning: duel:completed event for ${numericMatchId} is missing seed or replayHash!`,
      );
    }

    const seed = data.seed ? new BN(data.seed) : new BN(Date.now());
    const replayHash = data.replayHash
      ? Buffer.from(data.replayHash, "hex")
      : Buffer.alloc(32);

    console.log(
      `[Keeper] Waiting 15s before posting result for duel ${numericMatchId} to sync with stream...`,
    );
    await sleep(15000);

    await runWithRecovery(
      () =>
        fightProgram.methods
          .postResult(
            winnerSide === "A" ? ({ yes: {} } as any) : ({ no: {} } as any),
            seed,
            Array.from(replayHash),
          )
          .accounts({
            authority: botKeypair.publicKey,
            oracleConfig: oracleConfigPda,
            matchResult: matchPda,
          })
          .rpc(),
      connection,
    );

    await maybeResolveMarket(matchPda);
    console.log(`Resolved market for duel ${numericMatchId}`);
  } catch (err) {
    console.error("Failed to resolve market:", err);
  }
});

gameClient.connect();

// Maintenance Loop (Seeding & Cleanup)
async function runMaintenance(): Promise<void> {
  if (!(await ensureBotSignerFunding())) {
    return;
  }
  await ensureOracleReady();
  // ... (simplified loop for seeing liquidity and resolving old markets)

  const latestMatches = (await fightProgram.account.matchResult.all()) as any[];
  const now = Math.floor(Date.now() / 1000);

  for (const entry of latestMatches.slice(0, 50)) {
    const matchPda = entry.publicKey as PublicKey;
    const matchState = entry.account;
    const marketPda = findMarketPda(goldBinaryMarket.programId, matchPda);
    const market = await getMarketState(marketPda);

    await maybeResolveMatch(matchPda, matchState); // Only resolves if time passed?
    // We should probably rely on event listener for resolution, but this is a backup.

    await maybeResolveMarket(matchPda);
    if (market) {
      await maybeSeedMarket(marketPda, market);
    }
  }

  // NOTE: We do NOT create new rounds here anymore.
}

for (;;) {
  try {
    await runMaintenance();
  } catch (error) {
    if (isFundingError(error)) {
      fundingBlockedUntil = Date.now() + fundingBackoffMs;
    }
    console.error(`[bot] cycle failed: ${(error as Error).message}`);
  }

  if (args.once) break;
  await sleep(args["poll-seconds"] * 1_000);
}
