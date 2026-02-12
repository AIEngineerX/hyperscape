import BN from "bn.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  baseUnitsFromGold,
  createPrograms,
  enumIs,
  findMarketPda,
  findMatchPda,
  findNoVaultPda,
  findPositionPda,
  findYesVaultPda,
  readKeypair,
  requireEnv,
} from "./common";

const args = await yargs(hideBin(process.argv))
  .option("match-id", {
    type: "number",
    demandOption: true,
    describe: "Match id used by fight_oracle",
  })
  .option("seed-gold", {
    type: "number",
    default: Number(process.env.MARKET_MAKER_SEED_GOLD || 1),
    describe: "GOLD amount to seed on each side",
  })
  .strict()
  .parse();

const marketMaker = readKeypair(requireEnv("MARKET_MAKER_KEYPAIR"));
const { connection, goldBinaryMarket, fightOracle } =
  createPrograms(marketMaker);
const marketProgram: any = goldBinaryMarket;

const matchId = new BN(args["match-id"]);
const matchPda = findMatchPda(fightOracle.programId, matchId);
const marketPda = findMarketPda(goldBinaryMarket.programId, matchPda);
const yesVaultPda = findYesVaultPda(goldBinaryMarket.programId, marketPda);
const noVaultPda = findNoVaultPda(goldBinaryMarket.programId, marketPda);
const makerPositionPda = findPositionPda(
  goldBinaryMarket.programId,
  marketPda,
  marketMaker.publicKey,
);

const market = await marketProgram.account.market.fetch(marketPda);
const nowTs = Math.floor(Date.now() / 1000);

if (!enumIs(market.status, "open")) {
  throw new Error("Market is not open");
}

if (nowTs < Number(market.openTs) + Number(market.autoSeedDelaySeconds)) {
  throw new Error("Seed delay not reached yet");
}

if (Number(market.userYesTotal) > 0 || Number(market.userNoTotal) > 0) {
  throw new Error("User bets already exist; market maker should not auto-seed");
}

if (Number(market.makerYesTotal) > 0 || Number(market.makerNoTotal) > 0) {
  throw new Error("Market maker already seeded");
}

const makerGoldAccounts = await connection.getTokenAccountsByOwner(
  marketMaker.publicKey,
  {
    mint: market.goldMint,
    programId: TOKEN_2022_PROGRAM_ID,
  },
);

if (makerGoldAccounts.value.length === 0) {
  throw new Error("Market maker has no GOLD token account");
}

const makerGoldAccount = makerGoldAccounts.value[0]!.pubkey;
const seedAmount = baseUnitsFromGold(args["seed-gold"]);

const signature = await marketProgram.methods
  .seedLiquidityIfEmpty(seedAmount)
  .accounts({
    marketMaker: marketMaker.publicKey,
    market: marketPda,
    marketMakerGoldAta: makerGoldAccount,
    yesVault: yesVaultPda,
    noVault: noVaultPda,
    marketMakerPosition: makerPositionPda,
    goldMint: market.goldMint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();

console.log(
  JSON.stringify({ signature, market: marketPda.toBase58() }, null, 2),
);
