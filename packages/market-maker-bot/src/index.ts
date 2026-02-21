import { ethers } from "ethers";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";

dotenv.config();

const readEnvBoolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
};

// ─── Configuration ────────────────────────────────────────────────────────────
const TARGET_SPREAD_BPS = Number(process.env.TARGET_SPREAD_BPS || 200);
const MAX_INVENTORY_CAP = Number(process.env.MAX_INVENTORY_CAP || 500_000);
const RELOAD_DELAY_MIN_MS = Number(process.env.RELOAD_DELAY_MIN_MS || 500);
const RELOAD_DELAY_MAX_MS = Number(process.env.RELOAD_DELAY_MAX_MS || 2000);
const ORDER_SIZE_MIN = 10;
const ORDER_SIZE_MAX = 50;
const DEFAULT_CLOB_ADDRESS = "0x1224094aAe93bc9c52FA6F02a0B1F4700721E26E";
const SOLANA_PROGRAM_ID =
  process.env.SOLANA_ARENA_MARKET_PROGRAM_ID ||
  "23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6";
const SOLANA_HEALTHCHECK_INTERVAL_MS = Number(
  process.env.SOLANA_HEALTHCHECK_INTERVAL_MS || 60_000,
);
const MM_ENABLE_BSC = readEnvBoolean("MM_ENABLE_BSC", true);
const MM_ENABLE_BASE = readEnvBoolean("MM_ENABLE_BASE", true);
const MM_ENABLE_SOLANA = readEnvBoolean("MM_ENABLE_SOLANA", true);
const MM_ENABLE_TAKER_FLOW = readEnvBoolean("MM_ENABLE_TAKER_FLOW", true);
const MM_TAKER_INTERVAL_CYCLES = Math.max(
  1,
  Number(process.env.MM_TAKER_INTERVAL_CYCLES || 4),
);
const MM_TAKER_SIZE_MIN = Math.max(
  1,
  Number(process.env.MM_TAKER_SIZE_MIN || 1),
);
const MM_TAKER_SIZE_MAX = Math.max(
  MM_TAKER_SIZE_MIN,
  Number(process.env.MM_TAKER_SIZE_MAX || 8),
);

// Anti-bot strategy parameters
const TOXICITY_THRESHOLD_BPS = 1000; // If spread is > 10%, widen quotes by 2x
const MAX_ORDERS_PER_SIDE = 3; // Never have more than 3 resting orders per side
const CANCEL_STALE_AGE_MS = 30_000; // Cancel orders older than 30s to prevent sniping

// ─── EVM ABI (minimal interface) ──────────────────────────────────────────────
const GOLD_CLOB_ABI = [
  "function bestBids(uint256 matchId) view returns (uint16)",
  "function bestAsks(uint256 matchId) view returns (uint16)",
  "function orders(uint64 orderId) view returns (uint64 id, uint16 price, bool isBuy, address maker, uint128 amount, uint128 filled)",
  "function nextOrderId() view returns (uint64)",
  "function nextMatchId() view returns (uint256)",
  "function goldToken() view returns (address)",
  "function matches(uint256 matchId) view returns (uint8 status, uint8 winner, uint256 yesPool, uint256 noPool)",
  "function positions(uint256 matchId, address user) view returns (uint256 yesShares, uint256 noShares)",
  "function placeOrder(uint256 matchId, bool isBuy, uint16 price, uint256 amount)",
  "function cancelOrder(uint256 matchId, uint64 orderId, uint16 price)",
  "event OrderPlaced(uint256 indexed matchId, uint64 indexed orderId, address indexed maker, bool isBuy, uint16 price, uint256 amount)",
  "event OrderMatched(uint256 indexed matchId, uint64 makerOrderId, uint64 takerOrderId, uint256 matchedAmount, uint16 price)",
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

// ─── Tracked Order ────────────────────────────────────────────────────────────
interface TrackedOrder {
  orderId: number;
  chain: "evm-bsc" | "evm-base" | "solana";
  isBuy: boolean;
  price: number;
  amount: number;
  placedAt: number;
  matchId: number | string;
}

const decodeSolanaSecretKey = (raw: string): Uint8Array => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("missing key material");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      const bytes = new Uint8Array(parsed);
      if (bytes.length === 32 || bytes.length === 64) {
        return bytes;
      }
    }
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 32 || decoded.length === 64) {
      return decoded;
    }
  } catch {
    // Continue with other formats.
  }

  try {
    if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
      const decoded = Uint8Array.from(Buffer.from(trimmed, "base64"));
      if (decoded.length === 32 || decoded.length === 64) {
        return decoded;
      }
    }
  } catch {
    // Continue with other formats.
  }

  throw new Error("unsupported key format");
};

const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();
  try {
    return ethers.getAddress(trimmed);
  } catch {
    return ethers.getAddress(trimmed.toLowerCase());
  }
};

// ─── Market Maker Bot ─────────────────────────────────────────────────────────
class CrossChainMarketMaker {
  // EVM
  private bscProvider: ethers.JsonRpcProvider;
  private baseProvider: ethers.JsonRpcProvider;
  private bscWallet: ethers.Wallet;
  private baseWallet: ethers.Wallet;
  private bscClob: ethers.Contract;
  private baseClob: ethers.Contract;
  private bscGoldToken: ethers.Contract | null = null;
  private baseGoldToken: ethers.Contract | null = null;
  private bscEnabled = true;
  private baseEnabled = true;

  // Solana
  private solanaConnection: Connection;
  private solanaWallet: Keypair;
  private solanaProgramId: PublicKey;
  private solanaEnabled = true;
  private solanaHealthcheckWarned = false;
  private lastSolanaHealthcheckAt = 0;
  private startupValidated = false;
  private instanceId: string;

  // State
  private inventoryYes = 0;
  private inventoryNo = 0;
  private activeOrders: TrackedOrder[] = [];
  private cycleCount = 0;

  constructor() {
    this.instanceId = (process.env.MM_INSTANCE_ID || "mm-1").trim() || "mm-1";

    // ─ EVM Setup ─
    this.bscProvider = new ethers.JsonRpcProvider(
      process.env.EVM_BSC_RPC_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
    );
    this.baseProvider = new ethers.JsonRpcProvider(
      process.env.EVM_BASE_RPC_URL || "https://sepolia.base.org",
    );

    const sharedEvmKey = process.env.EVM_PRIVATE_KEY || "";
    const bscEvmKey = process.env.EVM_PRIVATE_KEY_BSC || sharedEvmKey;
    const baseEvmKey = process.env.EVM_PRIVATE_KEY_BASE || sharedEvmKey;
    if (!bscEvmKey || !baseEvmKey) {
      throw new Error(
        "Missing EVM private key. Set EVM_PRIVATE_KEY or both EVM_PRIVATE_KEY_BSC and EVM_PRIVATE_KEY_BASE.",
      );
    }

    this.bscWallet = new ethers.Wallet(bscEvmKey, this.bscProvider);
    this.baseWallet = new ethers.Wallet(baseEvmKey, this.baseProvider);
    const bscAddress = normalizeAddress(
      process.env.CLOB_CONTRACT_ADDRESS_BSC || DEFAULT_CLOB_ADDRESS,
    );
    const baseAddress = normalizeAddress(
      process.env.CLOB_CONTRACT_ADDRESS_BASE || DEFAULT_CLOB_ADDRESS,
    );

    this.bscClob = new ethers.Contract(
      bscAddress,
      GOLD_CLOB_ABI,
      this.bscWallet,
    );
    this.baseClob = new ethers.Contract(
      baseAddress,
      GOLD_CLOB_ABI,
      this.baseWallet,
    );
    this.bscEnabled = MM_ENABLE_BSC;
    this.baseEnabled = MM_ENABLE_BASE;

    // ─ Solana Setup ─
    this.solanaConnection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    );
    // Accept JSON byte-array, bs58, or base64 secret-key material.
    try {
      const keyBytes = decodeSolanaSecretKey(
        process.env.SOLANA_PRIVATE_KEY || "",
      );
      this.solanaWallet =
        keyBytes.length === 32
          ? Keypair.fromSeed(keyBytes)
          : Keypair.fromSecretKey(keyBytes);
    } catch {
      this.solanaWallet = Keypair.generate();
      console.warn(
        "[SOLANA] Using a generated wallet. Set SOLANA_PRIVATE_KEY for production.",
      );
    }
    this.solanaProgramId = new PublicKey(SOLANA_PROGRAM_ID);
    this.solanaEnabled = MM_ENABLE_SOLANA;
  }

  async start() {
    console.log(
      "╔══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      `║ Hyperscape Cross-Chain Market Maker Bot v2.0 [${this.instanceId}] ║`,
    );
    console.log(
      "╠══════════════════════════════════════════════════════════════╣",
    );
    console.log(`║ BSC Wallet:    ${this.bscWallet.address}  ║`);
    console.log(`║ Base Wallet:   ${this.baseWallet.address}  ║`);
    console.log(
      `║ Solana Wallet: ${this.solanaWallet.publicKey.toBase58().slice(0, 22)}... ║`,
    );
    console.log(
      `║ Target Spread: ${TARGET_SPREAD_BPS} bps                                     ║`,
    );
    console.log(
      `║ Max Inventory: ${MAX_INVENTORY_CAP}                                      ║`,
    );
    console.log(
      `║ Solana Mode:   health-check (${this.solanaProgramId.toBase58().slice(0, 18)}...)     ║`,
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝",
    );

    await this.validateChainReadiness();

    // Main event loop with jittered delay
    this.runLoop();
  }

  private async runLoop() {
    while (true) {
      try {
        await this.marketMakeCycle();
      } catch (e: any) {
        console.error(`[CYCLE ${this.cycleCount}] Error:`, e.message);
      }
      // Randomized jitter to thwart predictive MEV bots
      const jitter =
        RELOAD_DELAY_MIN_MS +
        Math.random() * (RELOAD_DELAY_MAX_MS - RELOAD_DELAY_MIN_MS);
      await sleep(jitter);
    }
  }

  private async validateChainReadiness() {
    if (this.startupValidated) return;
    this.startupValidated = true;

    const setChainEnabled = (label: "bsc" | "base", enabled: boolean) => {
      if (label === "bsc") this.bscEnabled = enabled;
      if (label === "base") this.baseEnabled = enabled;
    };

    const setChainToken = (label: "bsc" | "base", token: ethers.Contract) => {
      if (label === "bsc") this.bscGoldToken = token;
      if (label === "base") this.baseGoldToken = token;
    };

    const getWallet = (label: "bsc" | "base") =>
      label === "bsc" ? this.bscWallet : this.baseWallet;

    const ensureSettlementTokenReady = async (
      label: "bsc" | "base",
      clob: ethers.Contract,
    ) => {
      if (typeof (clob as { goldToken?: unknown }).goldToken !== "function") {
        console.warn(
          `[${label.toUpperCase()}] Skipping token readiness check: clob.goldToken() unavailable.`,
        );
        return;
      }

      const wallet = getWallet(label);
      const walletAddress = wallet.address;
      const tokenAddress = normalizeAddress(await clob.goldToken());
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const [balance, initialAllowance] = await Promise.all([
        token.balanceOf(walletAddress),
        token.allowance(walletAddress, clob.target as string),
      ]);

      if (balance <= 0n) {
        setChainEnabled(label, false);
        console.warn(
          `[${label.toUpperCase()}] Disabled: zero GOLD token balance for ${walletAddress} on ${tokenAddress}.`,
        );
        return;
      }

      let allowance = initialAllowance;
      if (allowance <= 0n) {
        const approveTx = await token.approve(
          clob.target as string,
          ethers.MaxUint256,
        );
        await approveTx.wait();
        allowance = await token.allowance(walletAddress, clob.target as string);
        console.log(
          `[${label.toUpperCase()}] Approved GOLD spend for CLOB (${clob.target as string}).`,
        );
      }

      setChainToken(label, token);
      console.log(
        `[${label.toUpperCase()}] GOLD balance=${balance.toString()} allowance=${allowance.toString()} token=${tokenAddress}.`,
      );
    };

    const validateEvm = async (
      label: "bsc" | "base",
      provider: ethers.JsonRpcProvider,
      clob: ethers.Contract,
    ) => {
      try {
        const [network, code] = await Promise.all([
          provider.getNetwork(),
          provider.getCode(clob.target as string),
        ]);
        if (code === "0x") {
          setChainEnabled(label, false);
          console.warn(
            `[${label.toUpperCase()}] Disabled: no contract deployed at ${clob.target as string} on chain ${network.chainId.toString()}.`,
          );
          return;
        }
        await clob.nextMatchId();
        await ensureSettlementTokenReady(label, clob);
        if (
          (label === "bsc" && !this.bscEnabled) ||
          (label === "base" && !this.baseEnabled)
        ) {
          return;
        }
        console.log(
          `[${label.toUpperCase()}] Ready on chain ${network.chainId.toString()} with CLOB ${clob.target as string}.`,
        );
      } catch (error: any) {
        setChainEnabled(label, false);
        console.warn(
          `[${label.toUpperCase()}] Disabled during readiness check: ${error.message}`,
        );
      }
    };

    if (this.bscEnabled) {
      await validateEvm("bsc", this.bscProvider, this.bscClob);
    } else {
      console.log("[BSC] Disabled via MM_ENABLE_BSC=false.");
    }

    if (this.baseEnabled) {
      await validateEvm("base", this.baseProvider, this.baseClob);
    } else {
      console.log("[BASE] Disabled via MM_ENABLE_BASE=false.");
    }

    if (!this.solanaEnabled) {
      console.log("[SOLANA] Disabled via MM_ENABLE_SOLANA=false.");
      return;
    }

    try {
      const [version, account] = await Promise.all([
        this.solanaConnection.getVersion(),
        this.solanaConnection.getAccountInfo(this.solanaProgramId, "confirmed"),
      ]);
      if (!account?.executable) {
        this.solanaEnabled = false;
        console.warn(
          `[SOLANA] Disabled: program ${this.solanaProgramId.toBase58()} missing or not executable.`,
        );
        return;
      }
      console.log(
        `[SOLANA] Ready on RPC ${this.solanaConnection.rpcEndpoint} (core ${version["solana-core"] ?? "unknown"})`,
      );
    } catch (error: any) {
      this.solanaEnabled = false;
      console.warn(
        `[SOLANA] Disabled during readiness check: ${error.message}`,
      );
    }
  }

  // ─── Core Market Making Cycle ───────────────────────────────────────────────
  async marketMakeCycle() {
    if (!this.startupValidated) {
      await this.validateChainReadiness();
    }
    this.cycleCount++;
    const ts = new Date().toISOString();

    // 1. Cancel stale orders first (anti-snipe)
    await this.cancelStaleOrders();

    // 2. Run EVM market making on BSC
    if (this.bscEnabled) {
      await this.evmMarketMake("bsc", this.bscClob);
    }

    // 3. Run EVM market making on Base
    if (this.baseEnabled) {
      await this.evmMarketMake("base", this.baseClob);
    }

    // 4. Solana market making
    await this.solanaMarketMake();

    // 5. Log state
    if (this.cycleCount % 10 === 0) {
      console.log(
        `[${ts}] Cycle #${this.cycleCount} | Inventory YES: ${this.inventoryYes} NO: ${this.inventoryNo} | Active orders: ${this.activeOrders.length}`,
      );
    }
  }

  // ─── EVM Market Making ──────────────────────────────────────────────────────
  async evmMarketMake(chain: "bsc" | "base", clob: ethers.Contract) {
    try {
      // Find the latest active match
      const nextMatchId = await clob.nextMatchId();
      if (nextMatchId <= 1n) return; // No matches exist
      const activeMatchId = nextMatchId - 1n;

      const matchInfo = await clob.matches(activeMatchId);
      if (matchInfo.status !== 1n) return; // Not OPEN

      const bestBid = Number(await clob.bestBids(activeMatchId));
      const bestAsk = Number(await clob.bestAsks(activeMatchId));

      // Calculate mid/spread
      const mid = (bestBid + bestAsk) / 2 || 500; // Default 50% if no orders
      const spread = bestAsk - bestBid;
      const spreadBps = mid > 0 ? (spread * 10000) / mid : 10000;

      // Determine quote width based on toxicity
      let quoteWidth = Math.max(
        Math.ceil((TARGET_SPREAD_BPS * mid) / 10000),
        5,
      );
      if (spreadBps > TOXICITY_THRESHOLD_BPS) {
        quoteWidth = quoteWidth * 2; // Widen quotes during volatile conditions
        console.log(
          `[${chain.toUpperCase()}] ⚠ Toxic flow detected (spread: ${spreadBps}bps). Widening quotes.`,
        );
      }

      const bidPrice = Math.max(1, Math.floor(mid - quoteWidth / 2));
      const askPrice = Math.min(999, Math.ceil(mid + quoteWidth / 2));
      const orderSize = this.computeOrderSize();

      // Inventory-aware quoting
      const existingBuys = this.activeOrders.filter(
        (o) => o.chain === `evm-${chain}` && o.isBuy,
      ).length;
      const existingSells = this.activeOrders.filter(
        (o) => o.chain === `evm-${chain}` && !o.isBuy,
      ).length;

      if (
        this.inventoryYes < MAX_INVENTORY_CAP &&
        existingBuys < MAX_ORDERS_PER_SIDE
      ) {
        await this.placeEvmOrder(
          chain,
          clob,
          Number(activeMatchId),
          true,
          bidPrice,
          orderSize,
        );
      }

      if (
        this.inventoryNo < MAX_INVENTORY_CAP &&
        existingSells < MAX_ORDERS_PER_SIDE
      ) {
        await this.placeEvmOrder(
          chain,
          clob,
          Number(activeMatchId),
          false,
          askPrice,
          orderSize,
        );
      }

      if (
        MM_ENABLE_TAKER_FLOW &&
        this.cycleCount % MM_TAKER_INTERVAL_CYCLES === 0
      ) {
        await this.placeEvmTakerOrder(
          chain,
          clob,
          Number(activeMatchId),
          bestBid,
          bestAsk,
        );
      }
    } catch (e: any) {
      console.error(`[${chain.toUpperCase()}] Market make error:`, e.message);
    }
  }

  async placeEvmTakerOrder(
    chain: "bsc" | "base",
    clob: ethers.Contract,
    matchId: number,
    bestBid: number,
    bestAsk: number,
  ) {
    if (bestBid <= 0 || bestAsk >= 1000) return;

    const canTakeYes = this.inventoryYes < MAX_INVENTORY_CAP;
    const canTakeNo = this.inventoryNo < MAX_INVENTORY_CAP;
    if (!canTakeYes && !canTakeNo) return;

    const takeBuy = canTakeYes && (!canTakeNo || Math.random() >= 0.5);
    const takerPrice = takeBuy ? bestAsk : bestBid;
    const takerSize = Math.max(
      MM_TAKER_SIZE_MIN,
      Math.min(MM_TAKER_SIZE_MAX, Math.floor(this.computeOrderSize() / 2)),
    );

    await this.placeEvmOrder(
      chain,
      clob,
      matchId,
      takeBuy,
      takerPrice,
      takerSize,
      "taker",
    );
  }

  async placeEvmOrder(
    chain: "bsc" | "base",
    clob: ethers.Contract,
    matchId: number,
    isBuy: boolean,
    price: number,
    amount: number,
    intent: "maker" | "taker" = "maker",
  ) {
    try {
      const tx = await clob.placeOrder(matchId, isBuy, price, amount);
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Missing transaction receipt");

      // Parse OrderPlaced event to get the order ID
      const iface = new ethers.Interface(GOLD_CLOB_ABI);
      let orderId = 0;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed && parsed.name === "OrderPlaced") {
            orderId = Number(parsed.args.orderId);
            break;
          }
        } catch {
          /* skip unparseable logs */
        }
      }

      this.activeOrders.push({
        orderId,
        chain: `evm-${chain}`,
        isBuy,
        price,
        amount,
        placedAt: Date.now(),
        matchId,
      });

      if (isBuy) this.inventoryYes += amount;
      else this.inventoryNo += amount;

      console.log(
        `[${chain.toUpperCase()}] ✓ ${intent === "taker" ? (isBuy ? "TAKER-BUY" : "TAKER-SELL") : isBuy ? "BID" : "ASK"} @ ${price} x${amount} (orderId: ${orderId})`,
      );
    } catch (e: any) {
      if (this.isRetryableNonceError(e)) {
        console.warn(
          `[${chain.toUpperCase()}] Skipped order due nonce race; will retry next cycle.`,
        );
        return;
      }
      console.error(`[${chain.toUpperCase()}] Order failed:`, e.message);
    }
  }

  private isRetryableNonceError(error: any): boolean {
    const message = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "");
    return (
      code === "NONCE_EXPIRED" ||
      code === "REPLACEMENT_UNDERPRICED" ||
      message.includes("nonce has already been used") ||
      message.includes("replacement fee too low") ||
      message.includes("replacement transaction underpriced")
    );
  }

  // ─── Solana Market Making ───────────────────────────────────────────────────
  async solanaMarketMake() {
    if (!this.solanaEnabled) {
      return;
    }

    const now = Date.now();
    if (now - this.lastSolanaHealthcheckAt < SOLANA_HEALTHCHECK_INTERVAL_MS) {
      return;
    }

    this.lastSolanaHealthcheckAt = now;
    try {
      const [latest, account] = await Promise.all([
        this.solanaConnection.getLatestBlockhash("confirmed"),
        this.solanaConnection.getAccountInfo(this.solanaProgramId, "confirmed"),
      ]);
      if (!account?.executable) {
        this.solanaEnabled = false;
        console.warn(
          `[SOLANA] Disabled: program ${this.solanaProgramId.toBase58()} missing or not executable.`,
        );
        return;
      }

      if (!this.solanaHealthcheckWarned) {
        this.solanaHealthcheckWarned = true;
        console.warn(
          "[SOLANA] Health-check mode only in this bot. No synthetic/fake Solana orders are emitted.",
        );
      }
      console.log(`[SOLANA] ✓ RPC healthy at slot hash ${latest.blockhash}`);
    } catch (e: any) {
      this.solanaEnabled = false;
      console.error("[SOLANA] Market make error:", e.message);
    }
  }

  // ─── Anti-Bot: Cancel Stale Orders ──────────────────────────────────────────
  async cancelStaleOrders() {
    const now = Date.now();
    const stale = this.activeOrders.filter(
      (o) => now - o.placedAt > CANCEL_STALE_AGE_MS,
    );

    for (const order of stale) {
      try {
        if (order.chain.startsWith("evm-")) {
          const clob = order.chain === "evm-bsc" ? this.bscClob : this.baseClob;
          const tx = await clob.cancelOrder(
            order.matchId,
            order.orderId,
            order.price,
          );
          await tx.wait();
          console.log(
            `[${order.chain.toUpperCase()}] ✗ Cancelled stale order #${order.orderId}`,
          );
        } else {
          // Solana cancel would go through the cancel_order instruction
          console.log(`[SOLANA] ✗ Cancelled stale order #${order.orderId}`);
        }

        // Refund inventory
        if (order.isBuy) this.inventoryYes -= order.amount;
        else this.inventoryNo -= order.amount;
      } catch (e: any) {
        console.warn(
          `[CANCEL] Failed to cancel order #${order.orderId}:`,
          e.message,
        );
      }
    }

    // Remove stale from tracking
    this.activeOrders = this.activeOrders.filter(
      (o) => now - o.placedAt <= CANCEL_STALE_AGE_MS,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  private computeOrderSize(): number {
    // Randomized size to prevent pattern detection by adversarial bots
    const base =
      ORDER_SIZE_MIN +
      Math.floor(Math.random() * (ORDER_SIZE_MAX - ORDER_SIZE_MIN));
    // Skew size based on inventory imbalance
    const imbalance = this.inventoryYes - this.inventoryNo;
    const skewFactor =
      Math.abs(imbalance) > MAX_INVENTORY_CAP * 0.5 ? 0.5 : 1.0;
    return Math.max(1, Math.floor(base * skewFactor));
  }

  // ─── Public Getters for Testing ─────────────────────────────────────────────
  getInventory() {
    return { yes: this.inventoryYes, no: this.inventoryNo };
  }

  getActiveOrders() {
    return [...this.activeOrders];
  }

  getConfig() {
    return {
      instanceId: this.instanceId,
      targetSpreadBps: TARGET_SPREAD_BPS,
      maxInventoryCap: MAX_INVENTORY_CAP,
      toxicityThresholdBps: TOXICITY_THRESHOLD_BPS,
      maxOrdersPerSide: MAX_ORDERS_PER_SIDE,
      cancelStaleAgeMs: CANCEL_STALE_AGE_MS,
      bscEnabled: this.bscEnabled,
      baseEnabled: this.baseEnabled,
      solanaEnabled: this.solanaEnabled,
      solanaProgramId: this.solanaProgramId.toBase58(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export { CrossChainMarketMaker, TrackedOrder };

// ─── Entrypoint ───────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const mm = new CrossChainMarketMaker();
  mm.start().catch(console.error);
}
