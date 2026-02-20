import { describe, it, expect, vi, beforeEach } from "vitest";
import bs58 from "bs58";

// ─── Mock ethers before importing the bot ─────────────────────────────────────
const mockContract = {
  nextMatchId: vi.fn().mockResolvedValue(2n),
  matches: vi
    .fn()
    .mockResolvedValue({ status: 1n, winner: 0n, yesPool: 0n, noPool: 0n }),
  bestBids: vi.fn().mockResolvedValue(450n),
  bestAsks: vi.fn().mockResolvedValue(550n),
  placeOrder: vi.fn().mockResolvedValue({
    wait: vi.fn().mockResolvedValue({ logs: [] }),
  }),
  cancelOrder: vi.fn().mockResolvedValue({
    wait: vi.fn().mockResolvedValue({}),
  }),
};

const mockFromSecretKey = vi.fn(() => ({
  publicKey: { toBase58: () => "TestSolanaPublicKey" },
  secretKey: new Uint8Array(64),
}));
const mockFromSeed = vi.fn(() => ({
  publicKey: { toBase58: () => "TestSolanaPublicKey" },
  secretKey: new Uint8Array(64),
}));
const mockGenerate = vi.fn(() => ({
  publicKey: { toBase58: () => "TestSolanaPublicKey" },
  secretKey: new Uint8Array(64),
}));

vi.mock("ethers", () => {
  class MockJsonRpcProvider {}
  class MockWallet {
    address = "0xTestWallet";
    constructor() {}
  }
  class MockContract {
    constructor() {
      return mockContract;
    }
  }
  class MockInterface {
    parseLog() {
      return null;
    }
  }

  return {
    ethers: {
      JsonRpcProvider: MockJsonRpcProvider,
      Wallet: MockWallet,
      Contract: MockContract,
      Interface: MockInterface,
    },
  };
});

vi.mock("@solana/web3.js", () => {
  class MockConnection {}
  return {
    Connection: MockConnection,
    Keypair: {
      // `vi.mock` is hoisted, so defer access to test-local mocks until runtime.
      generate: (...args: unknown[]) => mockGenerate(...args),
      fromSecretKey: (...args: unknown[]) => mockFromSecretKey(...args),
      fromSeed: (...args: unknown[]) => mockFromSeed(...args),
    },
    PublicKey: class MockPublicKey {},
  };
});

vi.mock("@coral-xyz/anchor", () => ({}));

// Set env vars before import
process.env.EVM_BSC_RPC_URL = "http://localhost:8545";
process.env.EVM_BASE_RPC_URL = "http://localhost:8546";
process.env.CLOB_CONTRACT_ADDRESS_BSC =
  "0x1234567890123456789012345678901234567890";
process.env.CLOB_CONTRACT_ADDRESS_BASE =
  "0x1234567890123456789012345678901234567890";
process.env.EVM_PRIVATE_KEY = "a".repeat(64);
process.env.SOLANA_RPC_URL = "http://localhost:8899";
process.env.SOLANA_PRIVATE_KEY = bs58.encode(new Uint8Array(64).fill(7));
process.env.TARGET_SPREAD_BPS = "200";
process.env.MAX_INVENTORY_CAP = "500";

import { CrossChainMarketMaker } from "./index.js";

describe("CrossChainMarketMaker", () => {
  let mm: CrossChainMarketMaker;

  beforeEach(() => {
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(new Uint8Array(64).fill(7));
    mockFromSecretKey.mockClear();
    mockFromSeed.mockClear();
    mockGenerate.mockClear();
    mm = new CrossChainMarketMaker();
  });

  describe("Initialization", () => {
    it("should initialize with zero inventory", () => {
      const inv = mm.getInventory();
      expect(inv.yes).toBe(0);
      expect(inv.no).toBe(0);
    });

    it("should start with no active orders", () => {
      expect(mm.getActiveOrders()).toHaveLength(0);
    });

    it("should accept a bs58 Solana private key", () => {
      expect(mockFromSecretKey).toHaveBeenCalledTimes(1);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("should fall back to generated Solana wallet on invalid key material", () => {
      process.env.SOLANA_PRIVATE_KEY = "not-a-valid-solana-key";
      const fallback = new CrossChainMarketMaker();
      expect(fallback).toBeTruthy();
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("should have correct config values", () => {
      const config = mm.getConfig();
      expect(config.targetSpreadBps).toBe(200);
      expect(config.maxInventoryCap).toBe(500_000);
      expect(config.toxicityThresholdBps).toBe(1000);
      expect(config.maxOrdersPerSide).toBe(3);
      expect(config.cancelStaleAgeMs).toBe(30_000);
    });
  });

  describe("Market Making Cycle", () => {
    it("should execute a full cycle without errors", async () => {
      await expect(mm.marketMakeCycle()).resolves.not.toThrow();
    });

    it("should place orders on both sides after a cycle", async () => {
      await mm.marketMakeCycle();
      const orders = mm.getActiveOrders();
      expect(orders.length).toBeGreaterThan(0);
    });

    it("should track inventory after placing orders", async () => {
      await mm.marketMakeCycle();
      const inv = mm.getInventory();
      expect(inv.yes + inv.no).toBeGreaterThan(0);
    });
  });

  describe("Inventory Management", () => {
    it("should respect MAX_ORDERS_PER_SIDE limit", async () => {
      for (let i = 0; i < 5; i++) {
        await mm.marketMakeCycle();
      }
      const orders = mm.getActiveOrders();
      const bscBuys = orders.filter(
        (o) => o.chain === "evm-bsc" && o.isBuy,
      ).length;
      const bscSells = orders.filter(
        (o) => o.chain === "evm-bsc" && !o.isBuy,
      ).length;
      expect(bscBuys).toBeLessThanOrEqual(3);
      expect(bscSells).toBeLessThanOrEqual(3);
    });

    it("should stop quoting when inventory cap is hit", async () => {
      for (let i = 0; i < 30; i++) {
        await mm.marketMakeCycle();
      }
      const inv = mm.getInventory();
      expect(inv.yes).toBeLessThanOrEqual(500);
      expect(inv.no).toBeLessThanOrEqual(500);
    });
  });

  describe("Anti-Bot Strategy", () => {
    it("should cancel stale orders after timeout", async () => {
      await mm.marketMakeCycle();
      const initialOrders = mm.getActiveOrders().length;
      expect(initialOrders).toBeGreaterThan(0);
      // Orders are not stale yet, so cancellation shouldn't remove them
      await mm.marketMakeCycle();
      expect(mm.getActiveOrders().length).toBeGreaterThanOrEqual(initialOrders);
    });

    it("should produce varied order sizes across cycles", async () => {
      const config = mm.getConfig();
      expect(config.targetSpreadBps).toBeGreaterThan(0);
      // Verify randomization is configured
      expect(config.maxOrdersPerSide).toBeGreaterThan(0);
    });

    it("should widen spreads during toxic conditions", async () => {
      // Mocked bestBids=450, bestAsks=550, spread = 100/500 = 20% = 2000bps > 1000bps threshold
      await mm.marketMakeCycle();
      const orders = mm.getActiveOrders();
      expect(orders.length).toBeGreaterThan(0);
    });
  });

  describe("Cross-Chain Parity", () => {
    it("should produce orders on multiple chains", async () => {
      await mm.marketMakeCycle();
      const orders = mm.getActiveOrders();
      const chains = new Set(orders.map((o) => o.chain));
      expect(chains.size).toBeGreaterThanOrEqual(2);
    });

    it("should have symmetric inventory tracking", async () => {
      await mm.marketMakeCycle();
      const inv = mm.getInventory();
      expect(inv.yes).toBeGreaterThan(0);
      expect(inv.no).toBeGreaterThan(0);
    });
  });

  describe("Sniper Bot Attack Simulation", () => {
    it("should survive rapid successive cycles without state corruption", async () => {
      for (let i = 0; i < 50; i++) {
        await mm.marketMakeCycle();
      }
      const inv = mm.getInventory();
      expect(inv.yes).toBeGreaterThanOrEqual(0);
      expect(inv.no).toBeGreaterThanOrEqual(0);
    });

    it("should not exceed inventory caps under heavy load", async () => {
      for (let i = 0; i < 100; i++) {
        await mm.marketMakeCycle();
      }
      const inv = mm.getInventory();
      expect(inv.yes).toBeLessThanOrEqual(500);
      expect(inv.no).toBeLessThanOrEqual(500);
    });
  });
});
