import { PublicKey } from "@solana/web3.js";

export function findClobConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
}

export function findClobVaultAuthorityPda(
  programId: PublicKey,
  matchState: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_auth"), matchState.toBuffer()],
    programId,
  )[0];
}
