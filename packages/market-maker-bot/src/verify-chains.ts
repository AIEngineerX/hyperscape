import { ethers } from "ethers";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_CLOB_ADDRESS = "0x1224094aAe93bc9c52FA6F02a0B1F4700721E26E";
const DEFAULT_SOLANA_PROGRAM_ID =
  process.env.SOLANA_VERIFY_PROGRAM_ID ||
  "9NdidShnVzy1fc1WHWJTvyuXmH47ynfNGA6QFdyfAuSU";
const DEFAULT_SOLANA_RPC_URL =
  process.env.SOLANA_VERIFY_RPC_URL || "https://api.mainnet-beta.solana.com";

const EVM_CLOB_ABI = ["function nextMatchId() view returns (uint256)"];

type CheckResult = {
  chain: "bsc" | "base" | "solana";
  ok: boolean;
  details: string;
};

const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();
  try {
    return ethers.getAddress(trimmed);
  } catch {
    return ethers.getAddress(trimmed.toLowerCase());
  }
};

const verifyEvmChain = async (params: {
  chain: "bsc" | "base";
  rpcUrl: string;
  expectedChainId: bigint;
  clobAddress: string;
}): Promise<CheckResult> => {
  try {
    const provider = new ethers.JsonRpcProvider(params.rpcUrl);
    const network = await provider.getNetwork();
    if (network.chainId !== params.expectedChainId) {
      return {
        chain: params.chain,
        ok: false,
        details: `wrong chainId ${network.chainId.toString()} (expected ${params.expectedChainId.toString()})`,
      };
    }

    const code = await provider.getCode(params.clobAddress);
    if (code === "0x") {
      return {
        chain: params.chain,
        ok: false,
        details: `no contract at ${params.clobAddress}`,
      };
    }

    const clob = new ethers.Contract(
      params.clobAddress,
      EVM_CLOB_ABI,
      provider,
    );
    const nextMatchId = (await clob.nextMatchId()) as bigint;
    return {
      chain: params.chain,
      ok: true,
      details: `chainId=${network.chainId.toString()} clob=${params.clobAddress} nextMatchId=${nextMatchId.toString()}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      chain: params.chain,
      ok: false,
      details: message,
    };
  }
};

const verifySolanaChain = async (params: {
  rpcUrl: string;
  programId: string;
}): Promise<CheckResult> => {
  try {
    const connection = new Connection(params.rpcUrl, "confirmed");
    const programId = new PublicKey(params.programId);
    const [version, programInfo] = await Promise.all([
      connection.getVersion(),
      connection.getAccountInfo(programId, "confirmed"),
    ]);
    if (!programInfo?.executable) {
      return {
        chain: "solana",
        ok: false,
        details: `rpc=${params.rpcUrl} program ${programId.toBase58()} missing or not executable`,
      };
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      programId,
    );
    const configInfo = await connection.getAccountInfo(configPda, "confirmed");
    const coreVersion = version["solana-core"] ?? "unknown";
    return {
      chain: "solana",
      ok: true,
      details: `rpc=${params.rpcUrl} program=${programId.toBase58()} configPda=${
        configInfo ? "present" : "missing"
      } core=${coreVersion}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      chain: "solana",
      ok: false,
      details: `rpc=${params.rpcUrl} ${message}`,
    };
  }
};

const run = async () => {
  const results = await Promise.all([
    verifyEvmChain({
      chain: "bsc",
      rpcUrl:
        process.env.EVM_BSC_RPC_URL ||
        process.env.BSC_TESTNET_RPC ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
      expectedChainId: 97n,
      clobAddress: normalizeAddress(
        process.env.CLOB_CONTRACT_ADDRESS_BSC || DEFAULT_CLOB_ADDRESS,
      ),
    }),
    verifyEvmChain({
      chain: "base",
      rpcUrl:
        process.env.EVM_BASE_RPC_URL ||
        process.env.BASE_SEPOLIA_RPC ||
        "https://sepolia.base.org",
      expectedChainId: 84532n,
      clobAddress: normalizeAddress(
        process.env.CLOB_CONTRACT_ADDRESS_BASE || DEFAULT_CLOB_ADDRESS,
      ),
    }),
    verifySolanaChain({
      rpcUrl: DEFAULT_SOLANA_RPC_URL,
      programId: DEFAULT_SOLANA_PROGRAM_ID,
    }),
  ]);

  console.log("chain | status | details");
  for (const result of results) {
    console.log(
      `${result.chain} | ${result.ok ? "ok" : "fail"} | ${result.details}`,
    );
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[verify-chains] fatal: ${message}`);
  process.exit(1);
});
