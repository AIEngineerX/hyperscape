import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
  type Hex,
  type Address,
  encodeFunctionData,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type ChainConfig,
  resolveChainConfig,
  getChainName,
} from "../config/chains.js";
import { BatchWriter } from "../tx/BatchWriter.js";

/**
 * ChainWriter is the core service that bridges the game server to the blockchain.
 *
 * Architecture:
 * - The game server runs exactly as before (PostgreSQL, real-time WebSocket)
 * - ChainWriter listens for game events and writes to chain OPTIMISTICALLY
 * - The game does NOT wait for chain confirmation -- it continues immediately
 * - Chain writes are batched for gas efficiency via BatchWriter
 *
 * For P2P transactions (trades, duels), the flow is different:
 * - Players sign transactions directly via their Privy embedded wallets
 * - The server coordinates the flow but the chain is authoritative
 *
 * Lifecycle:
 * 1. Server starts, creates ChainWriter instance
 * 2. ChainWriter connects to chain, verifies World contract
 * 3. Game events trigger queueXxx() methods
 * 4. BatchWriter accumulates and flushes calls every ~2 seconds
 * 5. On server shutdown, ChainWriter flushes remaining writes
 */
export class ChainWriter {
  private chainConfig: ChainConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient<Transport, Chain, Account>;
  private batchWriter: BatchWriter;
  private operatorAccount: Account;
  private worldAddress: Address;
  private isInitialized = false;

  constructor() {
    this.chainConfig = resolveChainConfig();
    this.worldAddress = this.chainConfig.worldAddress;

    // Create the operator account from private key
    const operatorKey =
      process.env.OPERATOR_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
    if (!operatorKey) {
      throw new Error(
        "[ChainWriter] OPERATOR_PRIVATE_KEY or PRIVATE_KEY environment variable required",
      );
    }
    this.operatorAccount = privateKeyToAccount(operatorKey as `0x${string}`);

    // Create viem clients
    this.publicClient = createPublicClient({
      chain: this.chainConfig.chain,
      transport: http(this.chainConfig.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.operatorAccount,
      chain: this.chainConfig.chain,
      transport: http(this.chainConfig.rpcUrl),
    });

    this.batchWriter = new BatchWriter(this.walletClient, this.publicClient, {
      worldAddress: this.worldAddress,
      maxBatchSize: 15,
      maxBatchDelayMs: 2000,
      maxRetries: 3,
    });
  }

  /**
   * Initialize the chain writer. Verifies the World contract is accessible.
   */
  async initialize(): Promise<void> {
    const chainName = getChainName(this.chainConfig);
    console.log(`[ChainWriter] Initializing on ${chainName}`);
    console.log(`[ChainWriter] World address: ${this.worldAddress}`);
    console.log(`[ChainWriter] Operator: ${this.operatorAccount.address}`);

    // Verify the World contract exists
    const code = await this.publicClient.getCode({
      address: this.worldAddress,
    });
    if (!code || code === "0x") {
      throw new Error(
        `[ChainWriter] No contract found at World address ${this.worldAddress} on ${chainName}. ` +
          `Run 'mud deploy' first.`,
      );
    }

    // Check operator balance
    const balance = await this.publicClient.getBalance({
      address: this.operatorAccount.address,
    });
    console.log(`[ChainWriter] Operator balance: ${balance} wei`);

    if (balance === 0n && this.chainConfig.chain.id !== 31337) {
      console.warn(
        "[ChainWriter] WARNING: Operator has zero balance. Transactions will fail.",
      );
    }

    this.isInitialized = true;
    console.log(`[ChainWriter] Ready on ${chainName}`);
  }

  // =========================================================================
  // Player Registration
  // =========================================================================

  /**
   * Register a player on-chain after character creation.
   */
  queuePlayerRegistration(
    walletAddress: Address,
    characterUuid: string,
    playerName: string,
  ): void {
    const characterId = keccak256(stringToHex(characterUuid));

    const callData = encodeFunctionData({
      abi: PLAYER_REGISTRY_ABI,
      functionName: "hyperscape__registerPlayer",
      args: [walletAddress, characterId, playerName],
    });

    this.batchWriter.queueCall(callData, `registerPlayer(${playerName})`);
  }

  // =========================================================================
  // Skills & Stats
  // =========================================================================

  /**
   * Queue a combat skills update after XP changes.
   */
  queueCombatSkillsUpdate(
    characterUuid: string,
    skills: {
      attackLevel: number;
      attackXp: number;
      strengthLevel: number;
      strengthXp: number;
      defenseLevel: number;
      defenseXp: number;
      constitutionLevel: number;
      constitutionXp: number;
      rangedLevel: number;
      rangedXp: number;
      magicLevel: number;
      magicXp: number;
      prayerLevel: number;
      prayerXp: number;
    },
  ): void {
    const characterId = keccak256(stringToHex(characterUuid));
    const levels = [
      skills.attackLevel,
      skills.strengthLevel,
      skills.defenseLevel,
      skills.constitutionLevel,
      skills.rangedLevel,
      skills.magicLevel,
      skills.prayerLevel,
    ] as const;
    const xps = [
      skills.attackXp,
      skills.strengthXp,
      skills.defenseXp,
      skills.constitutionXp,
      skills.rangedXp,
      skills.magicXp,
      skills.prayerXp,
    ] as const;

    const callData = encodeFunctionData({
      abi: SKILL_SYSTEM_ABI,
      functionName: "hyperscape__updateCombatSkills",
      args: [characterId, levels, xps],
    });

    this.batchWriter.queueCall(
      callData,
      `updateCombatSkills(${characterUuid.slice(0, 8)})`,
    );
  }

  /**
   * Queue a gathering skills update.
   */
  queueGatheringSkillsUpdate(
    characterUuid: string,
    skills: {
      woodcuttingLevel: number;
      woodcuttingXp: number;
      miningLevel: number;
      miningXp: number;
      fishingLevel: number;
      fishingXp: number;
      firemakingLevel: number;
      firemakingXp: number;
      cookingLevel: number;
      cookingXp: number;
      smithingLevel: number;
      smithingXp: number;
      agilityLevel: number;
      agilityXp: number;
      craftingLevel: number;
      craftingXp: number;
      fletchingLevel: number;
      fletchingXp: number;
      runecraftingLevel: number;
      runecraftingXp: number;
    },
  ): void {
    const characterId = keccak256(stringToHex(characterUuid));
    const levels = [
      skills.woodcuttingLevel,
      skills.miningLevel,
      skills.fishingLevel,
      skills.firemakingLevel,
      skills.cookingLevel,
      skills.smithingLevel,
      skills.agilityLevel,
      skills.craftingLevel,
      skills.fletchingLevel,
      skills.runecraftingLevel,
    ] as const;
    const xps = [
      skills.woodcuttingXp,
      skills.miningXp,
      skills.fishingXp,
      skills.firemakingXp,
      skills.cookingXp,
      skills.smithingXp,
      skills.agilityXp,
      skills.craftingXp,
      skills.fletchingXp,
      skills.runecraftingXp,
    ] as const;

    const callData = encodeFunctionData({
      abi: SKILL_SYSTEM_ABI,
      functionName: "hyperscape__updateGatheringSkills",
      args: [characterId, levels, xps],
    });

    this.batchWriter.queueCall(
      callData,
      `updateGatheringSkills(${characterUuid.slice(0, 8)})`,
    );
  }

  // =========================================================================
  // Inventory
  // =========================================================================

  /**
   * Queue inventory slot updates (delta only - changed slots).
   */
  queueInventoryUpdate(
    characterUuid: string,
    changedSlots: Array<{
      slotIndex: number;
      itemId: number;
      quantity: number;
    }>,
  ): void {
    if (changedSlots.length === 0) return;

    const characterId = keccak256(stringToHex(characterUuid));
    const slotIndices = changedSlots.map((s) => s.slotIndex);
    const itemIds = changedSlots.map((s) => s.itemId);
    const quantities = changedSlots.map((s) => s.quantity);

    const callData = encodeFunctionData({
      abi: INVENTORY_SYSTEM_ABI,
      functionName: "hyperscape__setInventorySlotBatch",
      args: [characterId, slotIndices, itemIds, quantities],
    });

    this.batchWriter.queueCall(
      callData,
      `inventoryUpdate(${characterUuid.slice(0, 8)}, ${changedSlots.length} slots)`,
    );
  }

  /**
   * Queue gold balance update.
   */
  queueGoldUpdate(characterUuid: string, amount: number): void {
    const characterId = keccak256(stringToHex(characterUuid));

    const callData = encodeFunctionData({
      abi: INVENTORY_SYSTEM_ABI,
      functionName: "hyperscape__setGold",
      args: [characterId, BigInt(amount)],
    });

    this.batchWriter.queueCall(
      callData,
      `setGold(${characterUuid.slice(0, 8)}, ${amount})`,
    );
  }

  // =========================================================================
  // Equipment
  // =========================================================================

  /**
   * Queue equipment slot updates.
   */
  queueEquipmentUpdate(
    characterUuid: string,
    changedSlots: Array<{ slotType: number; itemId: number; quantity: number }>,
  ): void {
    if (changedSlots.length === 0) return;

    const characterId = keccak256(stringToHex(characterUuid));
    const slotTypes = changedSlots.map((s) => s.slotType);
    const itemIds = changedSlots.map((s) => s.itemId);
    const quantities = changedSlots.map((s) => s.quantity);

    const callData = encodeFunctionData({
      abi: EQUIPMENT_SYSTEM_ABI,
      functionName: "hyperscape__setEquipmentSlotBatch",
      args: [characterId, slotTypes, itemIds, quantities],
    });

    this.batchWriter.queueCall(
      callData,
      `equipmentUpdate(${characterUuid.slice(0, 8)}, ${changedSlots.length} slots)`,
    );
  }

  // =========================================================================
  // Stats
  // =========================================================================

  /**
   * Queue a mob kill record.
   */
  queueMobKill(
    characterUuid: string,
    npcStringId: string,
    isBoss: boolean,
  ): void {
    const characterId = keccak256(stringToHex(characterUuid));
    const npcId = keccak256(stringToHex(npcStringId));

    const callData = encodeFunctionData({
      abi: STATS_SYSTEM_ABI,
      functionName: "hyperscape__recordMobKill",
      args: [characterId, npcId, isBoss],
    });

    this.batchWriter.queueCall(callData, `mobKill(${npcStringId})`);
  }

  /**
   * Queue a death record.
   */
  queueDeath(characterUuid: string): void {
    const characterId = keccak256(stringToHex(characterUuid));

    const callData = encodeFunctionData({
      abi: STATS_SYSTEM_ABI,
      functionName: "hyperscape__recordDeath",
      args: [characterId],
    });

    this.batchWriter.queueCall(callData, `death(${characterUuid.slice(0, 8)})`);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Get batch writer statistics.
   */
  getStats(): ReturnType<BatchWriter["getStats"]> {
    return this.batchWriter.getStats();
  }

  /**
   * Force flush all pending writes.
   */
  async flush(): Promise<void> {
    await this.batchWriter.flush();
  }

  /**
   * Graceful shutdown - flush remaining writes.
   */
  async shutdown(): Promise<void> {
    console.log("[ChainWriter] Shutting down...");
    await this.batchWriter.shutdown();
    console.log("[ChainWriter] Shutdown complete.");
  }
}

// =========================================================================
// ABI fragments for system calls
// =========================================================================

const PLAYER_REGISTRY_ABI = [
  {
    name: "hyperscape__registerPlayer",
    type: "function",
    inputs: [
      { name: "playerAddress", type: "address" },
      { name: "characterId", type: "bytes32" },
      { name: "name", type: "string" },
    ],
    outputs: [],
  },
] as const;

const SKILL_SYSTEM_ABI = [
  {
    name: "hyperscape__updateCombatSkills",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "levels", type: "uint16[7]" },
      { name: "xps", type: "uint32[7]" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__updateGatheringSkills",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "levels", type: "uint16[10]" },
      { name: "xps", type: "uint32[10]" },
    ],
    outputs: [],
  },
] as const;

const INVENTORY_SYSTEM_ABI = [
  {
    name: "hyperscape__setInventorySlotBatch",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "slotIndices", type: "uint8[]" },
      { name: "itemIds", type: "uint32[]" },
      { name: "quantities", type: "uint32[]" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__setGold",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "amount", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

const EQUIPMENT_SYSTEM_ABI = [
  {
    name: "hyperscape__setEquipmentSlotBatch",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "slotTypes", type: "uint8[]" },
      { name: "itemIds", type: "uint32[]" },
      { name: "quantities", type: "uint32[]" },
    ],
    outputs: [],
  },
] as const;

const STATS_SYSTEM_ABI = [
  {
    name: "hyperscape__recordMobKill",
    type: "function",
    inputs: [
      { name: "characterId", type: "bytes32" },
      { name: "npcId", type: "bytes32" },
      { name: "isBoss", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "hyperscape__recordDeath",
    type: "function",
    inputs: [{ name: "characterId", type: "bytes32" }],
    outputs: [],
  },
] as const;
