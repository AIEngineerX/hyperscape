import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction,
  createAccount,
  createMint,
  getMinimumBalanceForRentExemptAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import { FightOracle } from "../target/types/fight_oracle";
import { GoldBinaryMarket } from "../target/types/gold_binary_market";

type DemoActors = {
  payer: Keypair;
  treasury: Keypair;
  marketMaker: Keypair;
  bettorYes: Keypair;
  bettorNo: Keypair;
  goldMint: PublicKey;
  treasuryGoldAta: PublicKey;
  marketMakerGoldAta: PublicKey;
  bettorYesGoldAta: PublicKey;
  bettorNoGoldAta: PublicKey;
};

type MarketFixture = {
  oracleConfigPda: PublicKey;
  marketConfigPda: PublicKey;
  matchPda: PublicKey;
  marketPda: PublicKey;
  vaultAuthorityPda: PublicKey;
  yesVaultPda: PublicKey;
  noVaultPda: PublicKey;
};

const DECIMALS = 6;
const ONE_GOLD = 1_000_000;
const TRADE_TREASURY_FEE_BPS = 100;
const TRADE_MARKET_MAKER_FEE_BPS = 100;
const WINNINGS_MARKET_MAKER_FEE_BPS = 200;
const TOTAL_TRADE_FEE_BPS = TRADE_TREASURY_FEE_BPS + TRADE_MARKET_MAKER_FEE_BPS;
const NET_ONE_GOLD_AFTER_FEE =
  ONE_GOLD - (ONE_GOLD * TOTAL_TRADE_FEE_BPS) / 10_000;

function bn(value: number): anchor.BN {
  return new anchor.BN(value);
}

function sideYes(): { yes: Record<string, never> } {
  return { yes: {} };
}

function sideNo(): { no: Record<string, never> } {
  return { no: {} };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTokenAccountForOwner(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const payer = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;
  const tokenAccount = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptAccount(
    provider.connection,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenAccount.publicKey,
      lamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      tokenAccount.publicKey,
      mint,
      owner,
      TOKEN_PROGRAM_ID,
    ),
  );

  await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [
    payer,
    tokenAccount,
  ]);
  return tokenAccount.publicKey;
}

async function airdrop(
  connection: anchor.web3.Connection,
  recipient: PublicKey,
  sol = 2,
): Promise<void> {
  const sig = await connection.requestAirdrop(
    recipient,
    sol * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig, "confirmed");
}

async function createActors(
  provider: anchor.AnchorProvider,
): Promise<DemoActors> {
  const payer = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;
  const treasury = Keypair.generate();
  const marketMaker = Keypair.generate();
  const bettorYes = Keypair.generate();
  const bettorNo = Keypair.generate();

  await Promise.all([
    airdrop(provider.connection, treasury.publicKey),
    airdrop(provider.connection, marketMaker.publicKey),
    airdrop(provider.connection, bettorYes.publicKey),
    airdrop(provider.connection, bettorNo.publicKey),
  ]);

  const goldMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    DECIMALS,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const treasuryGoldAta = await createAccount(
    provider.connection,
    payer,
    goldMint,
    treasury.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const marketMakerGoldAta = await createAccount(
    provider.connection,
    payer,
    goldMint,
    marketMaker.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const bettorYesGoldAta = await createAccount(
    provider.connection,
    payer,
    goldMint,
    bettorYes.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const bettorNoGoldAta = await createAccount(
    provider.connection,
    payer,
    goldMint,
    bettorNo.publicKey,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  await mintTo(
    provider.connection,
    payer,
    goldMint,
    marketMakerGoldAta,
    payer,
    ONE_GOLD * 20,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  await mintTo(
    provider.connection,
    payer,
    goldMint,
    bettorYesGoldAta,
    payer,
    ONE_GOLD * 10,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  await mintTo(
    provider.connection,
    payer,
    goldMint,
    bettorNoGoldAta,
    payer,
    ONE_GOLD * 10,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  return {
    payer,
    treasury,
    marketMaker,
    bettorYes,
    bettorNo,
    goldMint,
    treasuryGoldAta,
    marketMakerGoldAta,
    bettorYesGoldAta,
    bettorNoGoldAta,
  };
}

function deriveMarketFixture(
  fightProgram: Program<FightOracle>,
  marketProgram: Program<GoldBinaryMarket>,
  matchId: number,
): MarketFixture {
  const [oracleConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightProgram.programId,
  );

  const [matchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("match"), bn(matchId).toArrayLike(Buffer, "le", 8)],
    fightProgram.programId,
  );

  const [marketConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market_config")],
    marketProgram.programId,
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
    oracleConfigPda,
    marketConfigPda,
    matchPda,
    marketPda,
    vaultAuthorityPda,
    yesVaultPda,
    noVaultPda,
  };
}

async function initializeMarketWithOracle(
  fightProgram: Program<FightOracle>,
  marketProgram: Program<GoldBinaryMarket>,
  actors: DemoActors,
  matchId: number,
  betWindowSeconds: number,
  autoSeedDelaySeconds: number,
): Promise<MarketFixture> {
  const fixture = deriveMarketFixture(fightProgram, marketProgram, matchId);

  await fightProgram.methods
    .initializeOracle()
    .accountsPartial({
      authority: actors.payer.publicKey,
      oracleConfig: fixture.oracleConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await fightProgram.methods
    .createMatch(bn(matchId), bn(betWindowSeconds), "metadata_uri")
    .accountsPartial({
      authority: actors.payer.publicKey,
      oracleConfig: fixture.oracleConfigPda,
      matchResult: fixture.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await marketProgram.methods
    .initializeMarketConfig(
      actors.marketMaker.publicKey,
      actors.treasury.publicKey,
      actors.marketMaker.publicKey,
      TRADE_TREASURY_FEE_BPS,
      TRADE_MARKET_MAKER_FEE_BPS,
      WINNINGS_MARKET_MAKER_FEE_BPS,
    )
    .accountsPartial({
      authority: actors.payer.publicKey,
      marketConfig: fixture.marketConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await marketProgram.methods
    .initializeMarket(bn(autoSeedDelaySeconds))
    .accountsPartial({
      payer: actors.payer.publicKey,
      marketMaker: actors.marketMaker.publicKey,
      oracleMatch: fixture.matchPda,
      marketConfig: fixture.marketConfigPda,
      market: fixture.marketPda,
      vaultAuthority: fixture.vaultAuthorityPda,
      yesVault: fixture.yesVaultPda,
      noVault: fixture.noVaultPda,
      goldMint: actors.goldMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return fixture;
}

import { GoldClobMarket } from "../target/types/gold_clob_market";

describe("gold-betting-demo", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const marketProgram = anchor.workspace
    .GoldBinaryMarket as Program<GoldBinaryMarket>;
  const clobProgram = anchor.workspace
    .GoldClobMarket as Program<GoldClobMarket>;

  it("adds market-maker liquidity after 10 seconds when no user has bet", async () => {
    const actors = await createActors(provider);
    const matchId = Math.floor(Date.now() / 1000);

    const fixture = await initializeMarketWithOracle(
      fightProgram,
      marketProgram,
      actors,
      matchId,
      25,
      10,
    );

    const [marketMakerPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        fixture.marketPda.toBuffer(),
        actors.marketMaker.publicKey.toBuffer(),
      ],
      marketProgram.programId,
    );

    let seeded = false;
    const seedDeadline = Date.now() + 35_000;
    while (Date.now() < seedDeadline) {
      try {
        await marketProgram.methods
          .seedLiquidityIfEmpty(bn(ONE_GOLD))
          .accountsPartial({
            marketMaker: actors.marketMaker.publicKey,
            market: fixture.marketPda,
            marketMakerGoldAta: actors.marketMakerGoldAta,
            yesVault: fixture.yesVaultPda,
            noVault: fixture.noVaultPda,
            marketMakerPosition: marketMakerPositionPda,
            goldMint: actors.goldMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([actors.marketMaker])
          .rpc();
        seeded = true;
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "");
        if (!message.includes("SeedWindowNotReached")) {
          throw error;
        }
        await sleep(1_000);
      }
    }
    expect(seeded).to.equal(true);

    const marketState = await marketProgram.account.market.fetch(
      fixture.marketPda,
    );
    const makerPosition = await marketProgram.account.position.fetch(
      marketMakerPositionPda,
    );

    expect(marketState.makerYesTotal.toNumber()).to.equal(ONE_GOLD);
    expect(marketState.makerNoTotal.toNumber()).to.equal(ONE_GOLD);
    expect(makerPosition.yesStake.toNumber()).to.equal(ONE_GOLD);
    expect(makerPosition.noStake.toNumber()).to.equal(ONE_GOLD);
  });

  it("resolves with oracle result and pays winning bettors", async () => {
    const actors = await createActors(provider);
    const matchId = Math.floor(Date.now() / 1000) + 1_000;
    const initialYesBalance = await getAccount(
      provider.connection,
      actors.bettorYesGoldAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    const fixture = await initializeMarketWithOracle(
      fightProgram,
      marketProgram,
      actors,
      matchId,
      12,
      10,
    );

    const [bettorYesPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        fixture.marketPda.toBuffer(),
        actors.bettorYes.publicKey.toBuffer(),
      ],
      marketProgram.programId,
    );

    const [bettorNoPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        fixture.marketPda.toBuffer(),
        actors.bettorNo.publicKey.toBuffer(),
      ],
      marketProgram.programId,
    );

    await marketProgram.methods
      .placeBet(sideYes(), bn(ONE_GOLD))
      .accountsPartial({
        bettor: actors.bettorYes.publicKey,
        market: fixture.marketPda,
        bettorGoldAta: actors.bettorYesGoldAta,
        marketConfig: fixture.marketConfigPda,
        tradeTreasuryWalletGoldAta: actors.treasuryGoldAta,
        tradeMarketMakerWalletGoldAta: actors.marketMakerGoldAta,
        vaultAuthority: fixture.vaultAuthorityPda,
        yesVault: fixture.yesVaultPda,
        noVault: fixture.noVaultPda,
        position: bettorYesPositionPda,
        goldMint: actors.goldMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([actors.bettorYes])
      .rpc();

    await marketProgram.methods
      .placeBet(sideNo(), bn(ONE_GOLD))
      .accountsPartial({
        bettor: actors.bettorNo.publicKey,
        market: fixture.marketPda,
        bettorGoldAta: actors.bettorNoGoldAta,
        marketConfig: fixture.marketConfigPda,
        tradeTreasuryWalletGoldAta: actors.treasuryGoldAta,
        tradeMarketMakerWalletGoldAta: actors.marketMakerGoldAta,
        vaultAuthority: fixture.vaultAuthorityPda,
        yesVault: fixture.yesVaultPda,
        noVault: fixture.noVaultPda,
        position: bettorNoPositionPda,
        goldMint: actors.goldMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([actors.bettorNo])
      .rpc();

    const afterBetBalance = await getAccount(
      provider.connection,
      actors.bettorYesGoldAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(afterBetBalance.amount).to.equal(
      initialYesBalance.amount - BigInt(ONE_GOLD),
    );

    await sleep(500);

    const treasuryWalletAfterBets = await getAccount(
      provider.connection,
      actors.treasuryGoldAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    const marketMakerWalletAfterBets = await getAccount(
      provider.connection,
      actors.marketMakerGoldAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(treasuryWalletAfterBets.amount).to.equal(
      BigInt((ONE_GOLD * TRADE_TREASURY_FEE_BPS * 2) / 10_000),
    );
    expect(marketMakerWalletAfterBets.amount).to.equal(
      BigInt(
        ONE_GOLD * 20 + (ONE_GOLD * TRADE_MARKET_MAKER_FEE_BPS * 2) / 10_000,
      ),
    );

    await sleep(12_500);

    await fightProgram.methods
      .postResult(sideYes(), bn(42), Array.from(new Uint8Array(32)))
      .accountsPartial({
        authority: actors.payer.publicKey,
        oracleConfig: fixture.oracleConfigPda,
        matchResult: fixture.matchPda,
      })
      .rpc();

    await marketProgram.methods
      .resolveFromOracle()
      .accountsPartial({
        resolver: actors.payer.publicKey,
        market: fixture.marketPda,
        oracleMatch: fixture.matchPda,
      })
      .rpc();

    const resolvedMarket = await marketProgram.account.market.fetch(
      fixture.marketPda,
    );
    const bettorYesPosition =
      await marketProgram.account.position.fetch(bettorYesPositionPda);
    const yesVaultBeforeClaim = await getAccount(
      provider.connection,
      fixture.yesVaultPda,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    const noVaultBeforeClaim = await getAccount(
      provider.connection,
      fixture.noVaultPda,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    expect(resolvedMarket.userYesTotal.toNumber()).to.equal(
      NET_ONE_GOLD_AFTER_FEE,
    );
    expect(resolvedMarket.userNoTotal.toNumber()).to.equal(
      NET_ONE_GOLD_AFTER_FEE,
    );
    expect(bettorYesPosition.yesStake.toNumber()).to.equal(
      NET_ONE_GOLD_AFTER_FEE,
    );
    expect(yesVaultBeforeClaim.amount).to.equal(BigInt(NET_ONE_GOLD_AFTER_FEE));
    expect(noVaultBeforeClaim.amount).to.equal(BigInt(NET_ONE_GOLD_AFTER_FEE));

    await marketProgram.methods
      .claim()
      .accountsPartial({
        bettor: actors.bettorYes.publicKey,
        market: fixture.marketPda,
        position: bettorYesPositionPda,
        bettorGoldAta: actors.bettorYesGoldAta,
        vaultAuthority: fixture.vaultAuthorityPda,
        yesVault: fixture.yesVaultPda,
        noVault: fixture.noVaultPda,
        marketMakerTokenAccount: actors.marketMakerGoldAta,
        goldMint: actors.goldMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([actors.bettorYes])
      .rpc();

    await sleep(500);

    const finalYesBalance = await getAccount(
      provider.connection,
      actors.bettorYesGoldAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    expect(finalYesBalance.amount).to.equal(
      initialYesBalance.amount -
        BigInt(ONE_GOLD) +
        BigInt(NET_ONE_GOLD_AFTER_FEE) +
        BigInt(
          Math.floor(
            (NET_ONE_GOLD_AFTER_FEE *
              (10_000 - WINNINGS_MARKET_MAKER_FEE_BPS)) /
              10_000,
          ),
        ),
    );
  });

  it("allows users to cancel open limit orders", async () => {
    const payer = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey);

    const goldMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      DECIMALS,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    const traderGoldAta = await createAccount(
      provider.connection,
      payer,
      goldMint,
      trader.publicKey,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    await mintTo(
      provider.connection,
      payer,
      goldMint,
      traderGoldAta,
      payer,
      ONE_GOLD * 2,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      clobProgram.programId,
    );

    const existingConfig =
      await clobProgram.account.marketConfig.fetchNullable(configPda);
    const treasuryOwner = Keypair.generate();
    const marketMakerOwner = Keypair.generate();
    const treasuryTokenAccount = await createAccount(
      provider.connection,
      payer,
      goldMint,
      treasuryOwner.publicKey,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    const marketMakerTokenAccount = await createAccount(
      provider.connection,
      payer,
      goldMint,
      marketMakerOwner.publicKey,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    if (!existingConfig) {
      await clobProgram.methods
        .initializeConfig(
          treasuryTokenAccount,
          marketMakerTokenAccount,
          100,
          100,
          200,
        )
        .accountsPartial({
          authority: payer.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } else {
      await clobProgram.methods
        .updateConfig(
          treasuryTokenAccount,
          marketMakerTokenAccount,
          100,
          100,
          200,
        )
        .accountsPartial({
          authority: payer.publicKey,
          config: configPda,
        })
        .rpc();
    }

    const config = (await clobProgram.account.marketConfig.fetch(
      configPda,
    )) as any;

    const matchState = Keypair.generate();
    const orderBook = Keypair.generate();
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_auth"), matchState.publicKey.toBuffer()],
      clobProgram.programId,
    );

    const vault = await createTokenAccountForOwner(
      provider,
      goldMint,
      vaultAuthorityPda,
    );

    await clobProgram.methods
      .initializeMatch(500)
      .accountsPartial({
        matchState: matchState.publicKey,
        user: payer.publicKey,
        config: configPda,
        vaultAuthority: vaultAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([matchState])
      .rpc();

    await clobProgram.methods
      .initializeOrderBook()
      .accountsPartial({
        user: payer.publicKey,
        matchState: matchState.publicKey,
        orderBook: orderBook.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([orderBook])
      .rpc();

    const initialTraderBalance = await getAccount(
      provider.connection,
      traderGoldAta,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );

    const placeSig = await clobProgram.methods
      .placeOrder(true, 500, bn(ONE_GOLD))
      .accountsPartial({
        matchState: matchState.publicKey,
        orderBook: orderBook.publicKey,
        config: configPda,
        userTokenAccount: traderGoldAta,
        treasuryTokenAccount: config.treasuryTokenAccount as PublicKey,
        marketMakerTokenAccount: config.marketMakerTokenAccount as PublicKey,
        vault,
        vaultAuthority: vaultAuthorityPda,
        user: trader.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
    await provider.connection.confirmTransaction(placeSig, "confirmed");

    const totalTradeFeeBps =
      Number(config.tradeTreasuryFeeBps) +
      Number(config.tradeMarketMakerFeeBps);
    const orderCost = ONE_GOLD / 2;
    const tradeFee = Math.floor((orderCost * totalTradeFeeBps) / 10_000);

    const afterPlaceBalance = await getAccount(
      provider.connection,
      traderGoldAta,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
    expect(afterPlaceBalance.amount).to.equal(
      initialTraderBalance.amount - BigInt(orderCost + tradeFee),
    );

    const cancelSig = await clobProgram.methods
      .cancelOrder(new anchor.BN(1))
      .accountsPartial({
        matchState: matchState.publicKey,
        orderBook: orderBook.publicKey,
        userTokenAccount: traderGoldAta,
        vault,
        vaultAuthority: vaultAuthorityPda,
        user: trader.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
    await provider.connection.confirmTransaction(cancelSig, "confirmed");

    const finalTraderBalance = await getAccount(
      provider.connection,
      traderGoldAta,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
    expect(finalTraderBalance.amount).to.equal(
      initialTraderBalance.amount - BigInt(tradeFee),
    );

    const orderBookState = (await clobProgram.account.orderBook.fetch(
      orderBook.publicKey,
    )) as any;
    expect(orderBookState.orders.length).to.equal(0);
  });
});
