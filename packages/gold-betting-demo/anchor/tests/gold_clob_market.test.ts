import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldClobMarket } from "../target/types/gold_clob_market";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount, createMint } from "@solana/spl-token";
import * as assert from "assert";

describe("gold_clob_market", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const payer = (
    provider.wallet as anchor.Wallet & { payer: anchor.web3.Keypair }
  ).payer;

  const program = anchor.workspace.GoldClobMarket as Program<GoldClobMarket>;

  it("initializes config and match state", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    const existingConfig =
      await program.account.marketConfig.fetchNullable(configPda);
    if (!existingConfig) {
      const mint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      const treasuryOwner = anchor.web3.Keypair.generate();
      const marketMakerOwner = anchor.web3.Keypair.generate();
      const treasuryTokenAccount = await createAccount(
        provider.connection,
        payer,
        mint,
        treasuryOwner.publicKey,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      const marketMakerTokenAccount = await createAccount(
        provider.connection,
        payer,
        mint,
        marketMakerOwner.publicKey,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID,
      );
      await program.methods
        .initializeConfig(
          treasuryTokenAccount,
          marketMakerTokenAccount,
          100,
          100,
          200,
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const matchState = anchor.web3.Keypair.generate();
    const [derivedVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_auth"), matchState.publicKey.toBuffer()],
      program.programId,
    );

    await program.methods
      .initializeMatch(500)
      .accounts({
        matchState: matchState.publicKey,
        user: provider.wallet.publicKey,
        config: configPda,
        vaultAuthority: derivedVaultAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([matchState])
      .rpc();

    const state = await program.account.matchState.fetch(matchState.publicKey);
    assert.ok(state.isOpen);
    assert.strictEqual(state.nextOrderId.toNumber(), 1);
  });
});
