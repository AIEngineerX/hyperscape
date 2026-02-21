import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import mockErc20Artifact from "../../../../evm-contracts/artifacts/contracts/MockERC20.sol/MockERC20.json";
import goldClobArtifact from "../../../../evm-contracts/artifacts/contracts/GoldClob.sol/GoldClob.json";

type E2eState = Record<string, unknown> & {
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldTokenAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
  evmSeedOrderPrice?: number;
  evmSeedOrderAmount?: string;
};

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_CHAIN_ID = 97;
const DEFAULT_ADMIN_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

function parseDotEnv(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    result[key] = value;
  }
  return result;
}

function serializeDotEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function readJson<T>(filepath: string): Promise<T | null> {
  try {
    const body = await fs.readFile(filepath, "utf8");
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

async function readEnv(filepath: string): Promise<Record<string, string>> {
  try {
    const body = await fs.readFile(filepath, "utf8");
    return parseDotEnv(body);
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(__dirname, "../..");
  const statePath = path.resolve(__dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");

  const rpcUrl = process.env.E2E_EVM_RPC_URL || DEFAULT_RPC_URL;
  const chainId = Number(process.env.E2E_EVM_CHAIN_ID || DEFAULT_CHAIN_ID);
  const adminPrivateKey =
    process.env.E2E_EVM_ADMIN_PRIVATE_KEY || DEFAULT_ADMIN_PRIVATE_KEY;
  const seedOrderPrice = Number(process.env.E2E_EVM_SEED_ORDER_PRICE || 600);
  const seedOrderAmountUi = process.env.E2E_EVM_SEED_ORDER_AMOUNT || "3";

  const localChain = {
    id: chainId,
    name: "e2e-local-evm",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  } as const;

  const publicClient = createPublicClient({
    chain: localChain,
    transport: http(rpcUrl),
  });

  const adminAccount = privateKeyToAccount(adminPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account: adminAccount,
    chain: localChain,
    transport: http(rpcUrl),
  });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== chainId) {
    throw new Error(
      `Unexpected EVM chain id. expected=${chainId}, got=${onChainId}`,
    );
  }

  const tokenDeployTx = await walletClient.deployContract({
    abi: mockErc20Artifact.abi,
    bytecode: mockErc20Artifact.bytecode as `0x${string}`,
    args: ["Mock Gold", "GOLD"],
  });
  const tokenDeployReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenDeployTx,
  });
  const goldTokenAddress = tokenDeployReceipt.contractAddress;
  if (!goldTokenAddress) {
    throw new Error("Token deployment did not return contract address");
  }

  const clobDeployTx = await walletClient.deployContract({
    abi: goldClobArtifact.abi,
    bytecode: goldClobArtifact.bytecode as `0x${string}`,
    args: [
      goldTokenAddress as Address,
      adminAccount.address as Address,
      adminAccount.address as Address,
    ],
  });
  const clobDeployReceipt = await publicClient.waitForTransactionReceipt({
    hash: clobDeployTx,
  });
  const goldClobAddress = clobDeployReceipt.contractAddress;
  if (!goldClobAddress) {
    throw new Error("GoldClob deployment did not return contract address");
  }

  const mintTx = await walletClient.writeContract({
    address: goldTokenAddress as Address,
    abi: mockErc20Artifact.abi,
    functionName: "mint",
    args: [adminAccount.address, parseUnits("100000", 18)],
    account: adminAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });

  const approveTx = await walletClient.writeContract({
    address: goldTokenAddress as Address,
    abi: mockErc20Artifact.abi,
    functionName: "approve",
    args: [goldClobAddress as Address, MAX_UINT256],
    account: adminAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const createMatchTx = await walletClient.writeContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "createMatch",
    args: [],
    account: adminAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: createMatchTx });

  const nextMatchId = (await publicClient.readContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "nextMatchId",
  })) as bigint;
  const currentMatchId = nextMatchId > 1n ? nextMatchId - 1n : 1n;

  const seedOrderTx = await walletClient.writeContract({
    address: goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      currentMatchId,
      false,
      seedOrderPrice,
      parseUnits(seedOrderAmountUi, 18),
    ],
    account: adminAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: seedOrderTx });

  const env = await readEnv(envPath);
  env.VITE_BSC_RPC_URL = rpcUrl;
  env.VITE_BSC_CHAIN_ID = String(chainId);
  env.VITE_BSC_GOLD_CLOB_ADDRESS = goldClobAddress;
  env.VITE_BSC_GOLD_TOKEN_ADDRESS = goldTokenAddress;
  env.VITE_E2E_EVM_PRIVATE_KEY = adminPrivateKey;
  await fs.writeFile(envPath, serializeDotEnv(env), "utf8");

  const existingState = (await readJson<E2eState>(statePath)) || {};
  const state: E2eState = {
    ...existingState,
    evmRpcUrl: rpcUrl,
    evmChainId: chainId,
    evmHeadlessAddress: adminAccount.address,
    evmGoldTokenAddress: goldTokenAddress,
    evmGoldClobAddress: goldClobAddress,
    evmMatchId: Number(currentMatchId),
    evmSeedOrderPrice: seedOrderPrice,
    evmSeedOrderAmount: seedOrderAmountUi,
  };

  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        rpcUrl,
        chainId,
        evmHeadlessAddress: adminAccount.address,
        evmGoldTokenAddress: goldTokenAddress,
        evmGoldClobAddress: goldClobAddress,
        evmMatchId: Number(currentMatchId),
        tx: {
          tokenDeployTx,
          clobDeployTx,
          mintTx,
          approveTx,
          createMatchTx,
          seedOrderTx,
        },
        envPath,
        statePath,
      },
      null,
      2,
    ),
  );
}

void main();
