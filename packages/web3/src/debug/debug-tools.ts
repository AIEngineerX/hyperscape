#!/usr/bin/env bun
import { createPublicClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainName, resolveChainConfig } from "../config/chains.js";

const DEFAULT_ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ABI = [
  {
    name: "hyperscape__getItemCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "count", type: "uint32" }],
  },
  {
    name: "hyperscape__getNumericId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stringId", type: "string" }],
    outputs: [{ name: "numericId", type: "uint32" }],
  },
  {
    name: "hyperscape__getStringId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "numericId", type: "uint32" }],
    outputs: [{ name: "stringId", type: "string" }],
  },
  {
    name: "hyperscape__getPlayerAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "characterId", type: "bytes32" }],
    outputs: [{ name: "playerAddress", type: "address" }],
  },
  {
    name: "hyperscape__balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function usage(): never {
  console.log("Usage:");
  console.log("  bun src/debug/debug-tools.ts chain");
  console.log(
    "  bun src/debug/debug-tools.ts item --string bronze_arrow | --id 1",
  );
  console.log(
    "  bun src/debug/debug-tools.ts player --address 0x... [--item-id 1 | --item-string bronze_arrow] [--character 0x...]",
  );
  process.exit(1);
}

async function main() {
  const command = process.argv[2] ?? "chain";
  const config = resolveChainConfig();
  const chainName = getChainName(config);
  const world = config.worldAddress;

  if (!world || world === "0x0") {
    throw new Error("WORLD_ADDRESS is not set");
  }

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  const readKey =
    process.env.OPERATOR_PRIVATE_KEY ??
    process.env.PRIVATE_KEY ??
    (config.chain.id === 31337 ? DEFAULT_ANVIL_PRIVATE_KEY : undefined);
  const readAccount = readKey
    ? privateKeyToAccount(readKey as `0x${string}`)
    : undefined;

  if (command === "chain") {
    const block = await client.getBlockNumber();
    const code = await client.getCode({ address: world });
    const itemCount = (await client.readContract({
      address: world,
      abi: ABI,
      functionName: "hyperscape__getItemCount",
      account: readAccount?.address,
    })) as number;

    console.log(`[debug:chain] ${chainName}`);
    console.log(`[debug:chain] RPC: ${config.rpcUrl}`);
    console.log(`[debug:chain] World: ${world}`);
    console.log(`[debug:chain] Block: ${block}`);
    console.log(
      `[debug:chain] Code: ${code && code !== "0x" ? "present" : "missing"}`,
    );
    console.log(`[debug:chain] Registered items: ${itemCount}`);
    return;
  }

  if (command === "item") {
    const stringId = getArg("--string");
    const idArg = getArg("--id");

    if (!stringId && !idArg) usage();

    if (stringId) {
      const numericId = (await client.readContract({
        address: world,
        abi: ABI,
        functionName: "hyperscape__getNumericId",
        args: [stringId],
        account: readAccount?.address,
      })) as number;
      console.log(`[debug:item] ${stringId} -> ${numericId}`);
      return;
    }

    const numericId = Number(idArg);
    const resolved = (await client.readContract({
      address: world,
      abi: ABI,
      functionName: "hyperscape__getStringId",
      args: [numericId],
      account: readAccount?.address,
    })) as string;
    console.log(`[debug:item] ${numericId} -> ${resolved || "<not found>"}`);
    return;
  }

  if (command === "player") {
    const address = getArg("--address") as Address | undefined;
    const characterId = getArg("--character") as `0x${string}` | undefined;
    const itemString = getArg("--item-string");
    const itemIdArg = getArg("--item-id");

    if (!address) usage();

    console.log(`[debug:player] Address: ${address}`);

    if (characterId) {
      const owner = (await client.readContract({
        address: world,
        abi: ABI,
        functionName: "hyperscape__getPlayerAddress",
        args: [characterId],
        account: readAccount?.address,
      })) as Address;
      console.log(`[debug:player] Character owner: ${owner}`);
    }

    let itemId: number | undefined;
    if (itemString) {
      itemId = (await client.readContract({
        address: world,
        abi: ABI,
        functionName: "hyperscape__getNumericId",
        args: [itemString],
        account: readAccount?.address,
      })) as number;
      console.log(`[debug:player] Item ${itemString} -> ${itemId}`);
    } else if (itemIdArg) {
      itemId = Number(itemIdArg);
    }

    if (itemId !== undefined) {
      const balance = (await client.readContract({
        address: world,
        abi: ABI,
        functionName: "hyperscape__balanceOf",
        args: [address, BigInt(itemId)],
        account: readAccount?.address,
      })) as bigint;
      console.log(`[debug:player] balanceOf(${itemId}) = ${balance}`);
    }
    return;
  }

  usage();
}

main().catch((err) => {
  console.error("[debug-tools] ERROR:", err);
  process.exit(1);
});
