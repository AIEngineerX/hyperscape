import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
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
} from "@solana/web3.js";

type ProgramAny = anchor.Program<anchor.Idl>;

const SIDE_A = 1;
const SIDE_B = 2;

function toU64Bn(value: number): BN {
  return new BN(value.toString());
}

function providerFromEnv(): anchor.AnchorProvider {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) {
    throw new Error("ANCHOR_PROVIDER_URL is not set");
  }

  const connection = new anchor.web3.Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: process.env.ANCHOR_WS_URL,
  });

  const wallet = anchor.Wallet.local();
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

async function airdrop(
  provider: anchor.AnchorProvider,
  wallet: PublicKey,
  sol = 2,
): Promise<void> {
  const signature = await provider.connection.requestAirdrop(
    wallet,
    sol * LAMPORTS_PER_SOL,
  );
  await provider.connection.confirmTransaction(signature, "confirmed");
}

describe("hyperscape_prediction_market local e2e", () => {
  const provider = providerFromEnv();
  anchor.setProvider(provider);

  const program = anchor.workspace.hyperscapePredictionMarket as ProgramAny;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const reporter = authority.publicKey;
  const keeper = authority.publicKey;

  let mint: PublicKey;
  let configPda: PublicKey;
  let oraclePda: PublicKey;
  let marketPda: PublicKey;
  let marketVault: PublicKey;
  let feeVault: PublicKey;

  let bettorA: Keypair;
  let bettorB: Keypair;
  let bettorAAta: PublicKey;
  let bettorBAta: PublicKey;
  let positionA: PublicKey;
  let positionB: PublicKey;

  it("runs full market lifecycle", async () => {
    const roundSeed = Uint8Array.from(Keypair.generate().publicKey.toBytes());

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      program.programId,
    );
    [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle", "utf8"), Buffer.from(roundSeed)],
      program.programId,
    );
    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market", "utf8"), Buffer.from(roundSeed)],
      program.programId,
    );

    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    marketVault = await getAssociatedTokenAddress(
      mint,
      marketPda,
      true,
      TOKEN_PROGRAM_ID,
    );
    feeVault = await getAssociatedTokenAddress(
      mint,
      configPda,
      true,
      TOKEN_PROGRAM_ID,
    );

    const configInfo = await provider.connection.getAccountInfo(configPda);
    if (!configInfo) {
      await program.methods
        .initializeConfig(100, reporter, keeper)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    await program.methods
      .initOracleRound(Array.from(roundSeed))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        oracleRound: oraclePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    bettorA = Keypair.generate();
    bettorB = Keypair.generate();
    await airdrop(provider, bettorA.publicKey);
    await airdrop(provider, bettorB.publicKey);

    bettorAAta = await createAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      bettorA.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    bettorBAta = await createAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      bettorB.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    await mintTo(
      provider.connection,
      authority,
      mint,
      bettorAAta,
      authority,
      100_000_000n,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );

    const currentSlot = await provider.connection.getSlot("confirmed");
    // Short window after setup keeps the test fast and avoids long idle waits.
    const closeSlot = currentSlot + 20;
    await program.methods
      .initMarket(Array.from(roundSeed), toU64Bn(closeSlot))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        oracleRound: oraclePda,
        mint,
        market: marketPda,
        marketVault,
        feeVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await mintTo(
      provider.connection,
      authority,
      mint,
      bettorBAta,
      authority,
      100_000_000n,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );

    [positionA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position", "utf8"),
        marketPda.toBuffer(),
        bettorA.publicKey.toBuffer(),
      ],
      program.programId,
    );
    [positionB] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position", "utf8"),
        marketPda.toBuffer(),
        bettorB.publicKey.toBuffer(),
      ],
      program.programId,
    );

    await program.methods
      .placeBet(SIDE_A, toU64Bn(40_000_000))
      .accountsStrict({
        bettor: bettorA.publicKey,
        mint,
        market: marketPda,
        marketVault,
        bettorTokenAccount: bettorAAta,
        position: positionA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettorA])
      .rpc();

    await program.methods
      .placeBet(SIDE_B, toU64Bn(60_000_000))
      .accountsStrict({
        bettor: bettorB.publicKey,
        mint,
        market: marketPda,
        marketVault,
        bettorTokenAccount: bettorBAta,
        position: positionB,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettorB])
      .rpc();

    while ((await provider.connection.getSlot("confirmed")) < closeSlot) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await program.methods
      .lockMarket()
      .accountsStrict({
        resolver: authority.publicKey,
        config: configPda,
        market: marketPda,
      })
      .rpc();

    const resultHash = Array.from(
      Buffer.from(
        "21f7cf13cfd112bbfbf35f8c70f09ecf5d2ddd8acc771cced8b43ca12cd7ab11",
        "hex",
      ),
    );
    await program.methods
      .reportOutcome(
        Array.from(roundSeed),
        SIDE_A,
        resultHash,
        "arena://prediction/test-round",
      )
      .accountsStrict({
        reporter: authority.publicKey,
        config: configPda,
        oracleRound: oraclePda,
      })
      .rpc();

    await program.methods
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
      .rpc();

    await program.methods
      .claim()
      .accountsStrict({
        bettor: bettorA.publicKey,
        mint,
        market: marketPda,
        marketVault,
        position: positionA,
        destinationAta: bettorAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bettorA])
      .rpc();

    await program.methods
      .claim()
      .accountsStrict({
        bettor: bettorB.publicKey,
        mint,
        market: marketPda,
        marketVault,
        position: positionB,
        destinationAta: bettorBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bettorB])
      .rpc();

    const accountA = await getAccount(
      provider.connection,
      bettorAAta,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    const accountB = await getAccount(
      provider.connection,
      bettorBAta,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    const feeVaultAccount = await getAccount(
      provider.connection,
      feeVault,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    expect(accountA.amount).to.equal(159_400_000n);
    expect(accountB.amount).to.equal(40_000_000n);
    expect(feeVaultAccount.amount).to.equal(600_000n);
  });

  it("rejects unauthorized lock_market attempts", async () => {
    const unauthorized = Keypair.generate();
    await airdrop(provider, unauthorized.publicKey);

    const roundSeed2 = Uint8Array.from(Keypair.generate().publicKey.toBytes());

    const [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      program.programId,
    );
    const [oracle] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle", "utf8"), Buffer.from(roundSeed2)],
      program.programId,
    );
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market", "utf8"), Buffer.from(roundSeed2)],
      program.programId,
    );

    const configInfo = await provider.connection.getAccountInfo(config);
    if (!configInfo) {
      await program.methods
        .initializeConfig(100, reporter, keeper)
        .accountsStrict({
          authority: authority.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    await program.methods
      .initOracleRound(Array.from(roundSeed2))
      .accountsStrict({
        authority: authority.publicKey,
        config,
        oracleRound: oracle,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const mint2 = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    const marketVault2 = await getAssociatedTokenAddress(
      mint2,
      market,
      true,
      TOKEN_PROGRAM_ID,
    );
    const feeVault2 = await getAssociatedTokenAddress(
      mint2,
      config,
      true,
      TOKEN_PROGRAM_ID,
    );

    const currentSlot = await provider.connection.getSlot("confirmed");
    const closeSlot = currentSlot + 5;

    await program.methods
      .initMarket(Array.from(roundSeed2), toU64Bn(closeSlot))
      .accountsStrict({
        authority: authority.publicKey,
        config,
        oracleRound: oracle,
        mint: mint2,
        market,
        marketVault: marketVault2,
        feeVault: feeVault2,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    while ((await provider.connection.getSlot("confirmed")) < closeSlot) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    try {
      await program.methods
        .lockMarket()
        .accountsStrict({
          resolver: unauthorized.publicKey,
          config,
          market,
        })
        .signers([unauthorized])
        .rpc();
      expect.fail("Expected unauthorized lock_market to fail");
    } catch (e: any) {
      expect(e.message).to.include("Unauthorized action");
    }
  });
});
