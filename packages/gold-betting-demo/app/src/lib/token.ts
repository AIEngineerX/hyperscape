import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

export async function findTokenAccountForMint(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<PublicKey | null> {
  const response = await connection.getTokenAccountsByOwner(owner, {
    mint,
    programId: tokenProgram,
  });

  if (response.value.length > 0) {
    return response.value[0]?.pubkey ?? null;
  }

  return null;
}

export async function findAnyGoldAccount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey | null> {
  const t22 = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
  );
  if (t22) return t22;

  const legacy = await findTokenAccountForMint(
    connection,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
  );
  return legacy;
}

export function getToken2022Ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
}

export async function confirmTx(
  connection: Connection,
  signature: string,
): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
}

export async function sendTx(
  connection: Connection,
  signedTx: Transaction,
): Promise<string> {
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await confirmTx(connection, signature);
  return signature;
}
