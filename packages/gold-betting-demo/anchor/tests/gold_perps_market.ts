import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldPerpsMarket } from "../target/types/gold_perps_market";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as assert from "assert";

describe("gold_perps_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GoldPerpsMarket as Program<GoldPerpsMarket>;

  const authority = Keypair.generate();
  const trader = Keypair.generate();

  let goldMint: PublicKey;
  let vaultTokenAccount: PublicKey;
  let traderTokenAccount: PublicKey;

  let vaultPda: PublicKey;
  let oraclePda: PublicKey;
  let positionPda: PublicKey;

  const agentId = 1;

  before(async () => {
    // Airdrop SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        authority.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      ),
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        trader.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      ),
    );

    goldMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6,
    );
    traderTokenAccount = await createAccount(
      provider.connection,
      trader,
      goldMint,
      trader.publicKey,
    );
    await mintTo(
      provider.connection,
      authority,
      goldMint,
      traderTokenAccount,
      authority,
      1000 * 1_000_000,
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId,
    );
    [oraclePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("oracle"),
        new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
      ],
      program.programId,
    );
    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        trader.publicKey.toBuffer(),
        new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
      ],
      program.programId,
    );

    // @ts-ignore
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      goldMint,
      vaultPda,
      true,
    );
    vaultTokenAccount = vaultAta.address;
  });

  it("Is initialized!", async () => {
    // 1 million as ONE (skew scale)
    const SKEW_SCALE = new anchor.BN(1_000_000);
    const FUNDING_VELOCITY = new anchor.BN(1000); // minor drift

    await program.methods
      .initializeVault(SKEW_SCALE, FUNDING_VELOCITY)
      .accountsPartial({
        vault: vaultPda,
        authority: authority.publicKey,
        goldMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultPda);
    assert.ok(vaultState.authority.equals(authority.publicKey));
  });

  it("Updates Oracle", async () => {
    const spotIndex = new anchor.BN(100 * 1_000_000);
    const mu = new anchor.BN(1000 * 1_000_000);
    const sigma = new anchor.BN(300 * 1_000_000);

    await program.methods
      .updateOracle(agentId, spotIndex, mu, sigma)
      .accountsPartial({
        oracle: oraclePda,
        vault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const state = await program.account.oracleState.fetch(oraclePda);
    assert.strictEqual(state.spotIndex.toNumber(), spotIndex.toNumber());
  });

  it("Opens a long position", async () => {
    const collateral = new anchor.BN(10 * 1_000_000); // 10 GOLD
    const leverage = new anchor.BN(2);

    await program.methods
      .openPosition(agentId, 0, collateral, leverage)
      .accountsPartial({
        position: positionPda,
        trader: trader.publicKey,
        traderTokenAccount,
        vaultTokenAccount,
        oracle: oraclePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();

    const pos = await program.account.positionState.fetch(positionPda);
    assert.strictEqual(pos.collateral.toNumber(), collateral.toNumber());
    assert.strictEqual(
      pos.size.toNumber(),
      collateral.mul(leverage).toNumber(),
    );
    assert.strictEqual(pos.positionType, 0); // 0 = Long
  });

  it("Simulates liquidation after oracle drop", async () => {
    const spotIndexLower = new anchor.BN(40 * 1_000_000); // index dropped 60%
    // 2x long means 40% equity loss, probably not full liquidation linearly, but we test the oracle update
    await program.methods
      .updateOracle(agentId, spotIndexLower, new anchor.BN(0), new anchor.BN(0))
      // @ts-ignore
      .accounts({
        oracle: oraclePda,
        vault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Liquidation would be here
    await program.methods
      .liquidate()
      .accountsPartial({
        position: positionPda,
        oracle: oraclePda,
        vault: vaultPda,
      })
      .rpc();
  });
});
