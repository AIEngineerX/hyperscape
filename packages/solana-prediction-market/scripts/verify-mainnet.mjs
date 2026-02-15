import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID =
  process.env.SOLANA_ARENA_MARKET_PROGRAM_ID;
const GOLD_MINT =
  process.env.SOLANA_GOLD_MINT ??
  "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump";
const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const JUPITER_QUOTE_URL =
  process.env.JUPITER_QUOTE_URL ?? "https://lite-api.jup.ag/swap/v1/quote";
const SOL_MINT =
  process.env.SOLANA_SOL_MINT ?? "So11111111111111111111111111111111111111112";
const USDC_MINT =
  process.env.SOLANA_USDC_MINT ??
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkQuote(inputMint, inputAmountRaw, outputMint) {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", inputAmountRaw);
  url.searchParams.set("slippageBps", "100");
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  assert(response.ok, `Jupiter quote failed (${response.status}) for ${inputMint}`);
  const payload = await response.json();
  const outAmount = BigInt(payload.outAmount ?? "0");
  assert(outAmount > 0n, `Jupiter returned no output amount for ${inputMint}`);
  return outAmount.toString();
}

async function main() {
  assert(
    PROGRAM_ID,
    "SOLANA_ARENA_MARKET_PROGRAM_ID is required for mainnet verification",
  );

  const connection = new Connection(RPC_URL, "confirmed");
  const programId = new PublicKey(PROGRAM_ID);
  const mint = new PublicKey(GOLD_MINT);

  console.log("[verify-mainnet] RPC:", RPC_URL);
  console.log("[verify-mainnet] Program:", programId.toBase58());
  console.log("[verify-mainnet] GOLD mint:", mint.toBase58());

  const programAccount = await connection.getAccountInfo(programId, "confirmed");
  assert(programAccount, "Program account not found on chain");
  assert(programAccount.executable, "Program account exists but is not executable");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config", "utf8")],
    programId,
  );
  const configAccount = await connection.getAccountInfo(configPda, "confirmed");
  if (configAccount) {
    console.log("[verify-mainnet] Config PDA found:", configPda.toBase58());
  } else {
    console.log(
      "[verify-mainnet] Config PDA missing (program may be deployed but not initialized):",
      configPda.toBase58(),
    );
  }

  const mintAccount = await connection.getParsedAccountInfo(mint, "confirmed");
  const mintValue = mintAccount.value;
  assert(mintValue, "GOLD mint account not found");
  const parsed = mintValue.data?.parsed;
  if (parsed?.info?.decimals !== undefined) {
    console.log("[verify-mainnet] GOLD decimals:", parsed.info.decimals);
  }

  const solOut = await checkQuote(SOL_MINT, "10000000", GOLD_MINT);
  console.log("[verify-mainnet] SOL -> GOLD quote outAmount:", solOut);

  const usdcOut = await checkQuote(USDC_MINT, "1000000", GOLD_MINT);
  console.log("[verify-mainnet] USDC -> GOLD quote outAmount:", usdcOut);

  console.log("[verify-mainnet] ✅ Mainnet verification passed");
}

main().catch((error) => {
  console.error("[verify-mainnet] ❌ Failed:", error.message);
  process.exit(1);
});
