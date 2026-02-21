import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { ethers } from "ethers";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

type FeeConfig = {
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
  winningsMarketMakerFeeBps: number;
};

type AnchorWalletLike = {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
};

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return Math.floor(parsed);
}

function parsePubkeyEnv(name: string, fallback?: PublicKey): PublicKey {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (fallback) return fallback;
    throw new Error(`Missing required env: ${name}`);
  }
  return new PublicKey(raw);
}

function readKeypairFromFile(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid keypair JSON at ${path}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function validateFeeConfig(config: FeeConfig): void {
  const {
    tradeTreasuryFeeBps,
    tradeMarketMakerFeeBps,
    winningsMarketMakerFeeBps,
  } = config;

  const all = [
    ["TRADE_TREASURY_FEE_BPS", tradeTreasuryFeeBps],
    ["TRADE_MARKET_MAKER_FEE_BPS", tradeMarketMakerFeeBps],
    ["WINNINGS_MARKET_MAKER_FEE_BPS", winningsMarketMakerFeeBps],
  ] as const;
  for (const [name, value] of all) {
    if (value < 0 || value > 10_000) {
      throw new Error(`${name} must be between 0 and 10_000`);
    }
  }
  if (tradeTreasuryFeeBps + tradeMarketMakerFeeBps > 10_000) {
    throw new Error("Total trade fee bps must be <= 10_000");
  }
}

function loadAnchorIdl(name: string): any {
  const idlPath = resolve(
    process.cwd(),
    "packages/gold-betting-demo/anchor/target/idl",
    `${name}.json`,
  );
  return JSON.parse(readFileSync(idlPath, "utf8"));
}

function createAnchorProvider(
  connection: Connection,
  signer: Keypair,
): AnchorProvider {
  const wallet: AnchorWalletLike = {
    publicKey: signer.publicKey,
    signTransaction: async (tx: any): Promise<any> => {
      tx.partialSign(signer);
      return tx;
    },
    signAllTransactions: async (txs: any[]): Promise<any[]> => {
      for (const tx of txs) tx.partialSign(signer);
      return txs;
    },
  };
  return new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

async function tuneEvmFees(config: FeeConfig): Promise<string> {
  const rpcUrl = process.env.EVM_RPC_URL?.trim();
  const privateKey = process.env.EVM_PRIVATE_KEY?.trim();
  const contractAddress = process.env.EVM_GOLD_CLOB_ADDRESS?.trim();
  if (!rpcUrl || !privateKey || !contractAddress) {
    return "skipped (set EVM_RPC_URL, EVM_PRIVATE_KEY, EVM_GOLD_CLOB_ADDRESS)";
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(
    contractAddress,
    [
      "function setFeeConfig(uint256,uint256,uint256) external",
      "function tradeTreasuryFeeBps() view returns (uint256)",
      "function tradeMarketMakerFeeBps() view returns (uint256)",
      "function winningsMarketMakerFeeBps() view returns (uint256)",
    ],
    signer,
  );

  const tx = await contract.setFeeConfig(
    config.tradeTreasuryFeeBps,
    config.tradeMarketMakerFeeBps,
    config.winningsMarketMakerFeeBps,
  );
  await tx.wait();

  return `updated (${tx.hash})`;
}

async function tuneSolanaBinaryFees(
  connection: Connection,
  authority: Keypair,
  config: FeeConfig,
): Promise<string> {
  const idl = loadAnchorIdl("gold_binary_market");
  const programId = parsePubkeyEnv(
    "SOLANA_GOLD_BINARY_MARKET_PROGRAM_ID",
    new PublicKey(idl.address),
  );
  const [marketConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market_config")],
    programId,
  );

  const provider = createAnchorProvider(connection, authority);
  const program = new Program(
    { ...idl, address: programId.toBase58() },
    provider,
  ) as any;

  const marketMaker = parsePubkeyEnv(
    "BINARY_MARKET_MAKER_WALLET",
    authority.publicKey,
  );
  const tradeTreasuryWallet = parsePubkeyEnv(
    "BINARY_TRADE_TREASURY_WALLET",
    authority.publicKey,
  );
  const tradeMarketMakerWallet = parsePubkeyEnv(
    "BINARY_TRADE_MARKET_MAKER_WALLET",
    marketMaker,
  );

  const signature = (await program.methods
    .initializeMarketConfig(
      marketMaker,
      tradeTreasuryWallet,
      tradeMarketMakerWallet,
      config.tradeTreasuryFeeBps,
      config.tradeMarketMakerFeeBps,
      config.winningsMarketMakerFeeBps,
    )
    .accounts({
      authority: authority.publicKey,
      marketConfig: marketConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc()) as string;

  return `updated (${signature})`;
}

async function tuneSolanaClobFees(
  connection: Connection,
  authority: Keypair,
  config: FeeConfig,
): Promise<string> {
  const treasuryTokenAccountRaw =
    process.env.CLOB_TREASURY_TOKEN_ACCOUNT?.trim();
  const marketMakerTokenAccountRaw =
    process.env.CLOB_MARKET_MAKER_TOKEN_ACCOUNT?.trim();
  if (!treasuryTokenAccountRaw || !marketMakerTokenAccountRaw) {
    return "skipped (set CLOB_TREASURY_TOKEN_ACCOUNT, CLOB_MARKET_MAKER_TOKEN_ACCOUNT)";
  }

  const idl = loadAnchorIdl("gold_clob_market");
  const programId = parsePubkeyEnv(
    "SOLANA_GOLD_CLOB_MARKET_PROGRAM_ID",
    new PublicKey(idl.address),
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  const treasuryTokenAccount = new PublicKey(treasuryTokenAccountRaw);
  const marketMakerTokenAccount = new PublicKey(marketMakerTokenAccountRaw);

  const provider = createAnchorProvider(connection, authority);
  const program = new Program(
    { ...idl, address: programId.toBase58() },
    provider,
  ) as any;

  const configExists = Boolean(
    await connection.getAccountInfo(configPda, "confirmed"),
  );
  if (configExists) {
    const signature = (await program.methods
      .updateConfig(
        treasuryTokenAccount,
        marketMakerTokenAccount,
        config.tradeTreasuryFeeBps,
        config.tradeMarketMakerFeeBps,
        config.winningsMarketMakerFeeBps,
      )
      .accounts({
        authority: authority.publicKey,
        config: configPda,
      })
      .rpc()) as string;
    return `updated (${signature})`;
  }

  const signature = (await program.methods
    .initializeConfig(
      treasuryTokenAccount,
      marketMakerTokenAccount,
      config.tradeTreasuryFeeBps,
      config.tradeMarketMakerFeeBps,
      config.winningsMarketMakerFeeBps,
    )
    .accounts({
      authority: authority.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc()) as string;
  return `initialized (${signature})`;
}

async function main(): Promise<void> {
  const feeConfig: FeeConfig = {
    tradeTreasuryFeeBps: parseNumberEnv("TRADE_TREASURY_FEE_BPS", 100),
    tradeMarketMakerFeeBps: parseNumberEnv("TRADE_MARKET_MAKER_FEE_BPS", 100),
    winningsMarketMakerFeeBps: parseNumberEnv(
      "WINNINGS_MARKET_MAKER_FEE_BPS",
      200,
    ),
  };
  validateFeeConfig(feeConfig);

  const solanaRpcUrl =
    process.env.SOLANA_RPC_URL?.trim() || "http://127.0.0.1:8899";
  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ||
    process.env.ANCHOR_WALLET ||
    `${process.env.HOME}/.config/solana/id.json`;
  const solanaAuthority = readKeypairFromFile(authorityPath);
  const solanaConnection = new Connection(solanaRpcUrl, "confirmed");

  const [evmResult, binaryResult, clobResult] = await Promise.all([
    tuneEvmFees(feeConfig),
    tuneSolanaBinaryFees(solanaConnection, solanaAuthority, feeConfig).catch(
      (error: unknown) => `failed (${(error as Error).message})`,
    ),
    tuneSolanaClobFees(solanaConnection, solanaAuthority, feeConfig).catch(
      (error: unknown) => `failed (${(error as Error).message})`,
    ),
  ]);

  console.log("Cross-chain betting fee tuning complete:");
  console.log(`- EVM GoldClob: ${evmResult}`);
  console.log(`- Solana gold_binary_market: ${binaryResult}`);
  console.log(`- Solana gold_clob_market: ${clobResult}`);
  console.log(
    `Applied fee config -> trade treasury: ${feeConfig.tradeTreasuryFeeBps} bps, trade MM: ${feeConfig.tradeMarketMakerFeeBps} bps, winnings MM: ${feeConfig.winningsMarketMakerFeeBps} bps`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
