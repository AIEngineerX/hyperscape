import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export function findOracleConfigPda(
  fightOracleProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightOracleProgramId,
  )[0];
}

export function findMarketConfigPda(marketProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market_config")],
    marketProgramId,
  )[0];
}

export function findMatchPda(
  fightOracleProgramId: PublicKey,
  matchId: BN,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 8)],
    fightOracleProgramId,
  )[0];
}

export function findMarketPda(
  marketProgramId: PublicKey,
  matchPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), matchPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findVaultAuthorityPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_auth"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findYesVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findNoVaultPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_vault"), marketPda.toBuffer()],
    marketProgramId,
  )[0];
}

export function findPositionPda(
  marketProgramId: PublicKey,
  marketPda: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPda.toBuffer(), owner.toBuffer()],
    marketProgramId,
  )[0];
}
