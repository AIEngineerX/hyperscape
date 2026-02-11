#!/usr/bin/env bun
/**
 * Seed Items On-Chain
 *
 * Reads all item manifests and seeds them into the MUD World contract:
 * 1. Registers all item IDs in the bidirectional mapping (ItemRegistrySystem)
 * 2. Sets item definitions (name, type, value, etc.)
 * 3. Sets combat bonuses for equipment items
 * 4. Sets level requirements for equipment items
 *
 * Run after `mud deploy`:
 *   bun packages/web3/src/mapping/seed-items.ts
 *
 * Requires env vars:
 *   WORLD_ADDRESS - deployed World contract address
 *   PRIVATE_KEY or OPERATOR_PRIVATE_KEY - deployer/operator private key
 *   CHAIN - "anvil" (default), "base-sepolia", or set MAINNET=true
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveChainConfig, getChainName } from "../config/chains.js";
import {
  buildItemIdMap,
  loadAllManifestItems,
  getManifestsDir,
  itemTypeToCategory,
  equipSlotToUint8,
} from "./ItemIdMapping.js";

// Batch size for on-chain writes (too many in one tx = out of gas)
const REGISTRATION_BATCH_SIZE = 50;
const DEFINITION_BATCH_SIZE = 20;

async function main() {
  const config = resolveChainConfig();
  const chainName = getChainName(config);
  console.log(`[seed-items] Chain: ${chainName}`);
  console.log(`[seed-items] World: ${config.worldAddress}`);

  const operatorKey =
    process.env.OPERATOR_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!operatorKey) {
    console.error(
      "[seed-items] ERROR: OPERATOR_PRIVATE_KEY or PRIVATE_KEY required",
    );
    process.exit(1);
  }

  const account = privateKeyToAccount(operatorKey as `0x${string}`);
  console.log(`[seed-items] Operator: ${account.address}`);

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  // Load manifests
  const manifestsDir = getManifestsDir();
  const mapping = await buildItemIdMap(manifestsDir);
  const allItems = await loadAllManifestItems(manifestsDir);

  console.log(
    `[seed-items] Found ${allItems.length} base items, ${mapping.totalItemCount} total with noted`,
  );

  // Step 1: Register all item IDs in batches
  console.log("\n[seed-items] Step 1: Registering item IDs...");
  const sortedItems = [...allItems].sort((a, b) => a.id.localeCompare(b.id));
  const stringIds = sortedItems.map((item) => item.id);

  for (let i = 0; i < stringIds.length; i += REGISTRATION_BATCH_SIZE) {
    const batch = stringIds.slice(i, i + REGISTRATION_BATCH_SIZE);
    const callData = encodeFunctionData({
      abi: ITEM_REGISTRY_ABI,
      functionName: "hyperscape__registerItemBatch",
      args: [batch],
    });

    const txHash = await walletClient.sendTransaction({
      to: config.worldAddress,
      data: callData,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    console.log(
      `  Registered items ${i + 1}-${Math.min(i + batch.length, stringIds.length)} ` +
        `(tx: ${txHash.slice(0, 10)}..., gas: ${receipt.gasUsed})`,
    );
  }

  // Register noted variants with explicit IDs
  console.log("\n[seed-items] Registering noted variants...");
  let notedCount = 0;
  for (const item of sortedItems) {
    const shouldNote =
      item.tradeable !== false && !item.stackable && item.type !== "currency";
    if (!shouldNote) continue;

    const notedStringId = `${item.id}_noted`;
    const baseNumericId = mapping.stringToNumeric.get(item.id);
    if (baseNumericId === undefined) continue;

    const notedNumericId = baseNumericId + 10000;
    const callData = encodeFunctionData({
      abi: ITEM_REGISTRY_ABI,
      functionName: "hyperscape__registerItemWithId",
      args: [notedNumericId, notedStringId],
    });

    const txHash = await walletClient.sendTransaction({
      to: config.worldAddress,
      data: callData,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    notedCount++;
  }
  console.log(`  Registered ${notedCount} noted variants`);

  // Step 2: Set item definitions in batches
  console.log("\n[seed-items] Step 2: Setting item definitions...");

  for (let i = 0; i < sortedItems.length; i += DEFINITION_BATCH_SIZE) {
    const batch = sortedItems.slice(i, i + DEFINITION_BATCH_SIZE);

    const numericIds = batch.map(
      (item) => mapping.stringToNumeric.get(item.id) ?? 0,
    );
    const names = batch.map((item) => item.name);
    const itemTypes = batch.map((item) => itemTypeToCategory(item.type));
    const values = batch.map((item) => item.value ?? 0);
    const stackables = batch.map((item) => item.stackable ?? false);
    const tradeables = batch.map((item) => item.tradeable ?? true);
    const equipSlots = batch.map((item) => equipSlotToUint8(item.equipSlot));
    const healAmounts = batch.map((item) => item.healAmount ?? 0);

    const callData = encodeFunctionData({
      abi: ITEM_REGISTRY_ABI,
      functionName: "hyperscape__setItemDefinitionBatch",
      args: [
        numericIds,
        names,
        itemTypes,
        values,
        stackables,
        tradeables,
        equipSlots,
        healAmounts,
      ],
    });

    const txHash = await walletClient.sendTransaction({
      to: config.worldAddress,
      data: callData,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    console.log(
      `  Defined items ${i + 1}-${Math.min(i + batch.length, sortedItems.length)} ` +
        `(tx: ${txHash.slice(0, 10)}..., gas: ${receipt.gasUsed})`,
    );
  }

  // Step 3: Set combat bonuses for items that have them
  console.log("\n[seed-items] Step 3: Setting combat bonuses...");
  let bonusCount = 0;

  for (const item of sortedItems) {
    if (!item.bonuses) continue;
    const numericId = mapping.stringToNumeric.get(item.id);
    if (numericId === undefined) continue;

    const b = item.bonuses;
    const callData = encodeFunctionData({
      abi: ITEM_REGISTRY_ABI,
      functionName: "hyperscape__setItemCombatBonuses",
      args: [
        numericId,
        b.attackStab ?? 0,
        b.attackSlash ?? 0,
        b.attackCrush ?? 0,
        b.attackRanged ?? 0,
        b.attackMagic ?? 0,
        b.defenseStab ?? 0,
        b.defenseSlash ?? 0,
        b.defenseCrush ?? 0,
        b.defenseRanged ?? 0,
        b.defenseMagic ?? 0,
        b.meleeStrength ?? b.strength ?? 0,
        b.rangedStrength ?? 0,
        b.magicDamage ?? 0,
        b.prayer ?? b.prayerBonus ?? 0,
      ],
    });

    const txHash = await walletClient.sendTransaction({
      to: config.worldAddress,
      data: callData,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    bonusCount++;
  }
  console.log(`  Set bonuses for ${bonusCount} items`);

  // Step 4: Set level requirements for items that have them
  console.log("\n[seed-items] Step 4: Setting level requirements...");
  let reqCount = 0;

  for (const item of sortedItems) {
    if (!item.requirements?.skills) continue;
    const numericId = mapping.stringToNumeric.get(item.id);
    if (numericId === undefined) continue;

    const skills = item.requirements.skills;
    const callData = encodeFunctionData({
      abi: ITEM_REGISTRY_ABI,
      functionName: "hyperscape__setItemRequirements",
      args: [
        numericId,
        skills.attack ?? 0,
        skills.strength ?? 0,
        skills.defense ?? 0,
        skills.ranged ?? 0,
        skills.magic ?? 0,
        skills.prayer ?? 0,
      ],
    });

    const txHash = await walletClient.sendTransaction({
      to: config.worldAddress,
      data: callData,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    reqCount++;
  }
  console.log(`  Set requirements for ${reqCount} items`);

  console.log("\n[seed-items] COMPLETE");
  console.log(`  ${mapping.baseItemCount} base items registered`);
  console.log(`  ${notedCount} noted variants registered`);
  console.log(`  ${bonusCount} combat bonus sets`);
  console.log(`  ${reqCount} requirement sets`);
}

// ABI fragments for ItemRegistrySystem calls
const ITEM_REGISTRY_ABI = [
  {
    name: "hyperscape__registerItemBatch",
    type: "function",
    inputs: [{ name: "stringIds", type: "string[]" }],
    outputs: [{ name: "numericIds", type: "uint32[]" }],
  },
  {
    name: "hyperscape__registerItemWithId",
    type: "function",
    inputs: [
      { name: "numericId", type: "uint32" },
      { name: "stringId", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__setItemDefinitionBatch",
    type: "function",
    inputs: [
      { name: "numericIds", type: "uint32[]" },
      { name: "names", type: "string[]" },
      { name: "itemTypes", type: "uint8[]" },
      { name: "values", type: "uint32[]" },
      { name: "stackables", type: "bool[]" },
      { name: "tradeables", type: "bool[]" },
      { name: "equipSlots", type: "uint8[]" },
      { name: "healAmounts", type: "uint16[]" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__setItemCombatBonuses",
    type: "function",
    inputs: [
      { name: "numericId", type: "uint32" },
      { name: "attackStab", type: "int16" },
      { name: "attackSlash", type: "int16" },
      { name: "attackCrush", type: "int16" },
      { name: "attackRanged", type: "int16" },
      { name: "attackMagic", type: "int16" },
      { name: "defenseStab", type: "int16" },
      { name: "defenseSlash", type: "int16" },
      { name: "defenseCrush", type: "int16" },
      { name: "defenseRanged", type: "int16" },
      { name: "defenseMagic", type: "int16" },
      { name: "meleeStrength", type: "int16" },
      { name: "rangedStrength", type: "int16" },
      { name: "magicDamage", type: "int16" },
      { name: "prayer", type: "int16" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__setItemRequirements",
    type: "function",
    inputs: [
      { name: "numericId", type: "uint32" },
      { name: "attackReq", type: "uint8" },
      { name: "strengthReq", type: "uint8" },
      { name: "defenseReq", type: "uint8" },
      { name: "rangedReq", type: "uint8" },
      { name: "magicReq", type: "uint8" },
      { name: "prayerReq", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

main().catch((err) => {
  console.error("[seed-items] FATAL:", err);
  process.exit(1);
});
