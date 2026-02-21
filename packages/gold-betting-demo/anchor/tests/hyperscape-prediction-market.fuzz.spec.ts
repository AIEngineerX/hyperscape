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
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

type ProgramAny = anchor.Program<anchor.Idl>;
type Rng = () => number;

const SIDE_A = 1;
const SIDE_B = 2;
const STATUS_RESOLVED = 3;
const MAX_BPS = 10_000n;

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

function toU64Bn(value: bigint): BN {
  return new BN(value.toString());
}

function createRng(seed: bigint): Rng {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const out = Number(state & 0xffff_ffffn);
    return Math.abs(out) / 0xffff_ffff;
  };
}

function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomBytes32(
  rng: Rng,
  scenarioTag: number,
  round: number,
): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = scenarioTag & 0xff;
  bytes[1] = round & 0xff;
  for (let i = 2; i < bytes.length; i += 1) {
    bytes[i] = randomInt(rng, 0, 255);
  }
  return bytes;
}

function asBigInt(value: BN | bigint | number): bigint {
  return BigInt(value.toString());
}

async function airdrop(
  provider: anchor.AnchorProvider,
  wallet: PublicKey,
): Promise<void> {
  const signature = await provider.connection.requestAirdrop(
    wallet,
    1 * anchor.web3.LAMPORTS_PER_SOL,
  );
  await provider.connection.confirmTransaction(signature, "confirmed");
}

async function waitForCloseSlot(
  provider: anchor.AnchorProvider,
  closeSlot: number,
): Promise<void> {
  while ((await provider.connection.getSlot("confirmed")) < closeSlot) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("hyperscape_prediction_market randomized invariants", () => {
  const provider = providerFromEnv();
  anchor.setProvider(provider);
  const program = anchor.workspace.hyperscapePredictionMarket as ProgramAny;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const reporter = authority.publicKey;
  const keeper = authority.publicKey;

  it("preserves fee and payout invariants across randomized rounds", async () => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      program.programId,
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

    const scenarioSeeds = [0xa11ce01n, 0xa11ce02n];
    const roundsPerScenario = 2;
    const bettorCount = 12;

    for (
      let scenarioIndex = 0;
      scenarioIndex < scenarioSeeds.length;
      scenarioIndex += 1
    ) {
      const rng = createRng(scenarioSeeds[scenarioIndex]!);
      const mint = await createMint(
        provider.connection,
        authority,
        authority.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID,
      );

      const bettors: Array<{ wallet: Keypair; tokenAccount: PublicKey }> = [];
      for (let i = 0; i < bettorCount; i += 1) {
        const wallet = Keypair.generate();
        await airdrop(provider, wallet.publicKey);
        const tokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          authority,
          mint,
          wallet.publicKey,
          undefined,
          TOKEN_PROGRAM_ID,
        );
        await mintTo(
          provider.connection,
          authority,
          mint,
          tokenAccount,
          authority,
          250_000_000n,
          [],
          undefined,
          TOKEN_PROGRAM_ID,
        );
        bettors.push({ wallet, tokenAccount });
      }

      let cumulativeFee = 0n;

      for (let round = 1; round <= roundsPerScenario; round += 1) {
        const roundSeed = randomBytes32(rng, scenarioIndex + 1, round);
        const [oraclePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("oracle", "utf8"), Buffer.from(roundSeed)],
          program.programId,
        );
        const [marketPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("market", "utf8"), Buffer.from(roundSeed)],
          program.programId,
        );
        const marketVault = await getAssociatedTokenAddress(
          mint,
          marketPda,
          true,
          TOKEN_PROGRAM_ID,
        );
        const feeVault = await getAssociatedTokenAddress(
          mint,
          configPda,
          true,
          TOKEN_PROGRAM_ID,
        );

        await program.methods
          .initOracleRound(Array.from(roundSeed))
          .accountsStrict({
            authority: authority.publicKey,
            config: configPda,
            oracleRound: oraclePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        const closeSlot = (await provider.connection.getSlot("confirmed")) + 35;
        await program.methods
          .initMarket(Array.from(roundSeed), toU64Bn(BigInt(closeSlot)))
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

        let poolA = 0n;
        let poolB = 0n;
        const bets = new Map<
          string,
          {
            side: number;
            amount: bigint;
            position: PublicKey;
            tokenAccount: PublicKey;
          }
        >();

        for (const bettor of bettors) {
          const side = rng() > 0.5 ? SIDE_A : SIDE_B;
          const amount = 3_000_000n + BigInt(randomInt(rng, 0, 6_000_000));
          const [positionPda] = PublicKey.findProgramAddressSync(
            [
              Buffer.from("position", "utf8"),
              marketPda.toBuffer(),
              bettor.wallet.publicKey.toBuffer(),
            ],
            program.programId,
          );

          await program.methods
            .placeBet(side, toU64Bn(amount))
            .accountsStrict({
              bettor: bettor.wallet.publicKey,
              mint,
              market: marketPda,
              marketVault,
              bettorTokenAccount: bettor.tokenAccount,
              position: positionPda,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([bettor.wallet])
            .rpc();

          if (side === SIDE_A) poolA += amount;
          else poolB += amount;
          bets.set(bettor.wallet.publicKey.toBase58(), {
            side,
            amount,
            position: positionPda,
            tokenAccount: bettor.tokenAccount,
          });
        }

        await waitForCloseSlot(provider, closeSlot);

        await program.methods
          .lockMarket()
          .accountsStrict({
            resolver: authority.publicKey,
            config: configPda,
            market: marketPda,
          })
          .rpc();

        const winnerSide = rng() > 0.5 ? SIDE_A : SIDE_B;
        const resultHash = randomBytes32(rng, scenarioIndex + 1, round + 10);
        await program.methods
          .reportOutcome(
            Array.from(roundSeed),
            winnerSide,
            Array.from(resultHash),
            `fuzz://scenario/${scenarioIndex + 1}/round/${round}`,
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

        const marketState = await program.account.marketRound.fetch(marketPda);
        expect(marketState.status).to.equal(STATUS_RESOLVED);

        const onChainPoolA = asBigInt(marketState.poolA as BN);
        const onChainPoolB = asBigInt(marketState.poolB as BN);
        expect(onChainPoolA).to.equal(poolA);
        expect(onChainPoolB).to.equal(poolB);

        const winnerPool = winnerSide === SIDE_A ? poolA : poolB;
        const loserPool = winnerSide === SIDE_A ? poolB : poolA;
        const feeBps = asBigInt(marketState.feeBps as number);
        const expectedFee = (loserPool * feeBps) / MAX_BPS;
        const expectedDistributable = loserPool - expectedFee;

        expect(asBigInt(marketState.winnerSide as number)).to.equal(
          BigInt(winnerSide),
        );
        expect(asBigInt(marketState.winnerPool as BN)).to.equal(winnerPool);
        expect(asBigInt(marketState.loserPool as BN)).to.equal(loserPool);
        expect(asBigInt(marketState.feeAmount as BN)).to.equal(expectedFee);
        expect(asBigInt(marketState.distributableLoserPool as BN)).to.equal(
          expectedDistributable,
        );

        let totalExpectedPayout = 0n;
        let winnerCount = 0n;
        for (const bettor of bettors) {
          const key = bettor.wallet.publicKey.toBase58();
          const bet = bets.get(key)!;

          const before = (
            await getAccount(
              provider.connection,
              bet.tokenAccount,
              "confirmed",
              TOKEN_PROGRAM_ID,
            )
          ).amount;

          let expectedPayout = 0n;
          if (bet.side === winnerSide) {
            winnerCount += 1n;
            const bonus =
              winnerPool === 0n
                ? 0n
                : (bet.amount * expectedDistributable) / winnerPool;
            expectedPayout = bet.amount + bonus;
          }

          await program.methods
            .claim()
            .accountsStrict({
              bettor: bettor.wallet.publicKey,
              mint,
              market: marketPda,
              marketVault,
              position: bet.position,
              destinationAta: bet.tokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([bettor.wallet])
            .rpc();

          const after = (
            await getAccount(
              provider.connection,
              bet.tokenAccount,
              "confirmed",
              TOKEN_PROGRAM_ID,
            )
          ).amount;
          expect(after - before).to.equal(expectedPayout);
          totalExpectedPayout += expectedPayout;

          try {
            await program.methods
              .claim()
              .accountsStrict({
                bettor: bettor.wallet.publicKey,
                mint,
                market: marketPda,
                marketVault,
                position: bet.position,
                destinationAta: bet.tokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([bettor.wallet])
              .rpc();
            expect.fail("Expected double-claim to fail");
          } catch (error: any) {
            expect(error.message).to.include("Position already claimed");
          }
        }

        cumulativeFee += expectedFee;
        const feeVaultAmount = (
          await getAccount(
            provider.connection,
            feeVault,
            "confirmed",
            TOKEN_PROGRAM_ID,
          )
        ).amount;
        expect(feeVaultAmount).to.equal(cumulativeFee);

        const marketVaultAmount = (
          await getAccount(
            provider.connection,
            marketVault,
            "confirmed",
            TOKEN_PROGRAM_ID,
          )
        ).amount;
        const expectedRemainder =
          poolA + poolB - expectedFee - totalExpectedPayout;
        expect(marketVaultAmount).to.equal(expectedRemainder);
        if (winnerCount > 0n) {
          expect(marketVaultAmount < winnerCount + 1n).to.equal(true);
        }
      }
    }
  });
});
