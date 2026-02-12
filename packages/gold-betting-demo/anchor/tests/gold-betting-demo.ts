import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAccount,
  createMint,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import { FightOracle } from "../target/types/fight_oracle";
import { GoldBinaryMarket } from "../target/types/gold_binary_market";

type DemoActors = {
  payer: Keypair;
  marketMaker: Keypair;
  bettorYes: Keypair;
  bettorNo: Keypair;
  goldMint: PublicKey;
  marketMakerGoldAta: PublicKey;
  bettorYesGoldAta: PublicKey;
  bettorNoGoldAta: PublicKey;
};

type MarketFixture = {
  oracleConfigPda: PublicKey;
  matchPda: PublicKey;
  marketPda: PublicKey;
  vaultAuthorityPda: PublicKey;
  yesVaultPda: PublicKey;
  noVaultPda: PublicKey;
};

const DECIMALS = 6;
const ONE_GOLD = 1_000_000;

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
  const marketMaker = Keypair.generate();
  const bettorYes = Keypair.generate();
  const bettorNo = Keypair.generate();

  await Promise.all([
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
    marketMaker,
    bettorYes,
    bettorNo,
    goldMint,
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
    .accounts({
      authority: actors.payer.publicKey,
      oracleConfig: fixture.oracleConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await fightProgram.methods
    .createMatch(bn(matchId), bn(betWindowSeconds))
    .accounts({
      authority: actors.payer.publicKey,
      oracleConfig: fixture.oracleConfigPda,
      matchResult: fixture.matchPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await marketProgram.methods
    .initializeMarket(bn(autoSeedDelaySeconds))
    .accounts({
      payer: actors.payer.publicKey,
      marketMaker: actors.marketMaker.publicKey,
      oracleMatch: fixture.matchPda,
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

describe("gold-betting-demo", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const marketProgram = anchor.workspace
    .GoldBinaryMarket as Program<GoldBinaryMarket>;

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

    await sleep(11_000);

    await marketProgram.methods
      .seedLiquidityIfEmpty(bn(ONE_GOLD))
      .accounts({
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
      4,
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
      .placeBet(sideYes() as any, bn(ONE_GOLD))
      .accounts({
        bettor: actors.bettorYes.publicKey,
        market: fixture.marketPda,
        bettorGoldAta: actors.bettorYesGoldAta,
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
      .placeBet(sideNo() as any, bn(ONE_GOLD))
      .accounts({
        bettor: actors.bettorNo.publicKey,
        market: fixture.marketPda,
        bettorGoldAta: actors.bettorNoGoldAta,
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

    await sleep(4_500);

    await fightProgram.methods
      .postResult(sideYes() as any, bn(42), Array.from(new Uint8Array(32)))
      .accounts({
        authority: actors.payer.publicKey,
        oracleConfig: fixture.oracleConfigPda,
        matchResult: fixture.matchPda,
      })
      .rpc();

    await marketProgram.methods
      .resolveFromOracle()
      .accounts({
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

    expect(resolvedMarket.userYesTotal.toNumber()).to.equal(ONE_GOLD);
    expect(resolvedMarket.userNoTotal.toNumber()).to.equal(ONE_GOLD);
    expect(bettorYesPosition.yesStake.toNumber()).to.equal(ONE_GOLD);
    expect(yesVaultBeforeClaim.amount).to.equal(BigInt(ONE_GOLD));
    expect(noVaultBeforeClaim.amount).to.equal(BigInt(ONE_GOLD));

    await marketProgram.methods
      .claim()
      .accounts({
        bettor: actors.bettorYes.publicKey,
        market: fixture.marketPda,
        position: bettorYesPositionPda,
        bettorGoldAta: actors.bettorYesGoldAta,
        vaultAuthority: fixture.vaultAuthorityPda,
        yesVault: fixture.yesVaultPda,
        noVault: fixture.noVaultPda,
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
      initialYesBalance.amount + BigInt(ONE_GOLD),
    );
  });
});
