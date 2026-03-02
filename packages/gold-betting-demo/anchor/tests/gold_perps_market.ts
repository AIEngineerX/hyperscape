import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldPerpsMarket } from "../target/types/gold_perps_market";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as assert from "assert";

/**
 * gold_perps_market tests — Native SOL collateral.
 *
 * The program no longer uses SPL tokens. Margin is held as lamports by the vault PDA.
 * All amounts below use 9 decimal SOL precision (1 SOL = 1_000_000_000 lamports).
 */
describe("gold_perps_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GoldPerpsMarket as Program<GoldPerpsMarket>;

  const authority = Keypair.generate();
  const trader = Keypair.generate();

  let vaultPda: PublicKey;
  let oraclePda: PublicKey;
  let positionPda: PublicKey;

  const agentId = 1;
  // Use 1M SOL equivalent as skew scale (expressed in lamports)
  const SKEW_SCALE = new anchor.BN(1_000_000 * LAMPORTS_PER_SOL);
  const FUNDING_VELOCITY = new anchor.BN(1_000);

  before(async () => {
    // Fund both accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        authority.publicKey,
        20 * LAMPORTS_PER_SOL,
      ),
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        trader.publicKey,
        20 * LAMPORTS_PER_SOL,
      ),
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
  });

  it("Initializes vault with skew_scale and funding_velocity", async () => {
    await program.methods
      .initializeVault(SKEW_SCALE, FUNDING_VELOCITY)
      .accountsPartial({
        vault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultPda);
    assert.ok(
      vaultState.authority.equals(authority.publicKey),
      "Authority mismatch",
    );
    assert.strictEqual(
      vaultState.skewScale.toString(),
      SKEW_SCALE.toString(),
      "Skew scale mismatch",
    );
  });

  it("Updates oracle with TrueSkill ratings", async () => {
    // Spot index: 100 SOL (expressed in lamports with 9-decimal precision)
    const spotIndex = new anchor.BN(100 * LAMPORTS_PER_SOL);
    const mu = new anchor.BN(1000 * 1_000_000); // mu = 1000, scaled 1e6
    const sigma = new anchor.BN(300 * 1_000_000); // sigma = 300, scaled 1e6

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
    assert.strictEqual(
      state.spotIndex.toString(),
      spotIndex.toString(),
      "Spot index not stored correctly",
    );
  });

  it("Opens a 2x Long position depositing native SOL as collateral", async () => {
    // 0.5 SOL collateral, 2x leverage → 1 SOL position size
    const collateralLamports = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
    const leverage = new anchor.BN(2);

    const traderBalanceBefore = await provider.connection.getBalance(
      trader.publicKey,
    );

    await program.methods
      .openPosition(agentId, 0, collateralLamports, leverage)
      .accountsPartial({
        position: positionPda,
        trader: trader.publicKey,
        vault: vaultPda,
        oracle: oraclePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const pos = await program.account.positionState.fetch(positionPda);
    assert.strictEqual(
      pos.collateral.toString(),
      collateralLamports.toString(),
      "Collateral mismatch",
    );
    assert.strictEqual(
      pos.size.toString(),
      collateralLamports.mul(leverage).toString(),
      "Size should be collateral * leverage",
    );
    assert.strictEqual(pos.positionType, 0, "Should be a Long (0)");
    assert.ok(pos.entryPrice.toNumber() > 0, "Entry price must be non-zero");

    // Verify SOL actually left the trader's wallet
    const traderBalanceAfter = await provider.connection.getBalance(
      trader.publicKey,
    );
    assert.ok(
      traderBalanceBefore - traderBalanceAfter >= 0.5 * LAMPORTS_PER_SOL,
      "Trader should have lost at least 0.5 SOL",
    );

    // Verify vault received the funds
    const vaultBal = await provider.connection.getBalance(vaultPda);
    assert.ok(
      vaultBal >= 0.5 * LAMPORTS_PER_SOL,
      "Vault should hold collateral lamports",
    );
  });

  it("Simulates oracle price drop (precursor to liquidation)", async () => {
    // Drop the index 60% — a 2x long becomes deeply underwater
    const spotIndexLower = new anchor.BN(40 * LAMPORTS_PER_SOL);
    await program.methods
      .updateOracle(agentId, spotIndexLower, new anchor.BN(0), new anchor.BN(0))
      .accountsPartial({
        oracle: oraclePda,
        vault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const state = await program.account.oracleState.fetch(oraclePda);
    assert.strictEqual(
      state.spotIndex.toString(),
      spotIndexLower.toString(),
      "Oracle not updated",
    );
  });
});
