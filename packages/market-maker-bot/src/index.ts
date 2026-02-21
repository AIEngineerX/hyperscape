import { ethers } from "ethers";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";

dotenv.config();

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
  "function matches(uint256 matchId) view returns (uint8 status, uint8 winner, uint256 yesPool, uint256 noPool)",
  "function positions(uint256 matchId, address user) view returns (uint256 yesShares, uint256 noShares)",
  "function placeOrder(uint256 matchId, bool isBuy, uint16 price, uint256 amount)",
  "function cancelOrder(uint256 matchId, uint64 orderId, uint16 price)",
  "event OrderPlaced(uint256 indexed matchId, uint64 indexed orderId, address indexed maker, bool isBuy, uint16 price, uint256 amount)",
  "event OrderMatched(uint256 indexed matchId, uint64 makerOrderId, uint64 takerOrderId, uint256 matchedAmount, uint16 price)",
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

  // State
  private inventoryYes = 0;
  private inventoryNo = 0;
  private activeOrders: TrackedOrder[] = [];
  private cycleCount = 0;
  private nextNonceByChain: Record<"bsc" | "base", number | null> = {
    bsc: null,
    base: null,
  };

  constructor() {
    // ─ EVM Setup ─
    this.bscProvider = new ethers.JsonRpcProvider(
      process.env.EVM_BSC_RPC_URL ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
    );
    this.baseProvider = new ethers.JsonRpcProvider(
      process.env.EVM_BASE_RPC_URL || "https://sepolia.base.org",
    );

    const evmKey = process.env.EVM_PRIVATE_KEY!;
    this.bscWallet = new ethers.Wallet(evmKey, this.bscProvider);
    this.baseWallet = new ethers.Wallet(evmKey, this.baseProvider);
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
  }

  async start() {
    console.log(
      "╔══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║       Hyperscape Cross-Chain Market Maker Bot v2.0          ║",
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
          if (label === "bsc") this.bscEnabled = false;
          if (label === "base") this.baseEnabled = false;
          console.warn(
            `[${label.toUpperCase()}] Disabled: no contract deployed at ${clob.target as string} on chain ${network.chainId.toString()}.`,
          );
          return;
        }
        await clob.nextMatchId();
        console.log(
          `[${label.toUpperCase()}] Ready on chain ${network.chainId.toString()} with CLOB ${clob.target as string}.`,
        );
      } catch (error: any) {
        if (label === "bsc") this.bscEnabled = false;
        if (label === "base") this.baseEnabled = false;
        console.warn(
          `[${label.toUpperCase()}] Disabled during readiness check: ${error.message}`,
        );
      }
    };

    await validateEvm("bsc", this.bscProvider, this.bscClob);
    await validateEvm("base", this.baseProvider, this.baseClob);

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
    } catch (e: any) {
      console.error(`[${chain.toUpperCase()}] Market make error:`, e.message);
    }
  }

  async placeEvmOrder(
    chain: "bsc" | "base",
    clob: ethers.Contract,
    matchId: number,
    isBuy: boolean,
    price: number,
    amount: number,
  ) {
    try {
      const nonce = await this.reserveNonce(chain);
      const tx = await clob.placeOrder(matchId, isBuy, price, amount, {
        nonce,
      });
      const receipt = await tx.wait();

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
        `[${chain.toUpperCase()}] ✓ ${isBuy ? "BID" : "ASK"} @ ${price} x${amount} (orderId: ${orderId})`,
      );
    } catch (e: any) {
      if (this.isNonceError(e)) {
        this.resetNonce(chain);
      }
      console.error(`[${chain.toUpperCase()}] Order failed:`, e.message);
    }
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
          const chain = order.chain === "evm-bsc" ? "bsc" : "base";
          const clob = chain === "bsc" ? this.bscClob : this.baseClob;
          const nonce = await this.reserveNonce(chain);
          const tx = await clob.cancelOrder(
            order.matchId,
            order.orderId,
            order.price,
            { nonce },
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
        if (order.chain === "evm-bsc" || order.chain === "evm-base") {
          this.resetNonce(order.chain === "evm-bsc" ? "bsc" : "base");
        }
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

  private async reserveNonce(chain: "bsc" | "base"): Promise<number> {
    const cached = this.nextNonceByChain[chain];
    if (cached !== null) {
      this.nextNonceByChain[chain] = cached + 1;
      return cached;
    }

    const provider = chain === "bsc" ? this.bscProvider : this.baseProvider;
    const wallet = chain === "bsc" ? this.bscWallet : this.baseWallet;
    const nonce = await provider.getTransactionCount(wallet.address, "pending");
    this.nextNonceByChain[chain] = nonce + 1;
    return nonce;
  }

  private resetNonce(chain: "bsc" | "base") {
    this.nextNonceByChain[chain] = null;
  }

  private isNonceError(error: unknown): boolean {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    return (
      code.toUpperCase() === "NONCE_EXPIRED" ||
      message.toLowerCase().includes("nonce too low") ||
      message.toLowerCase().includes("nonce has already been used")
    );
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
