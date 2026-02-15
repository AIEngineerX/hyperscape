/**
 * Chain Configuration Tests
 *
 * Tests environment-based chain resolution for all three modes:
 * Anvil (local), Base Sepolia (testnet), Base Mainnet (production).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveChainConfig, getChainName } from "../src/config/chains.js";

// Save original env
const originalEnv = { ...process.env };

afterEach(() => {
  // Restore original env after each test
  process.env = { ...originalEnv };
});

describe("Chain Config - Default (Anvil)", () => {
  beforeEach(() => {
    delete process.env.MAINNET;
    delete process.env.CHAIN;
  });

  it("defaults to Anvil when no env vars set", () => {
    const config = resolveChainConfig();
    expect(config.chain.id).toBe(31337);
  });

  it("defaults to localhost RPC", () => {
    const config = resolveChainConfig();
    expect(config.rpcUrl).toContain("127.0.0.1:8545");
  });

  it("returns 'Anvil (Local)' as chain name", () => {
    const config = resolveChainConfig();
    expect(getChainName(config)).toBe("Anvil (Local)");
  });
});

describe("Chain Config - Anvil Explicit", () => {
  beforeEach(() => {
    delete process.env.MAINNET;
    process.env.CHAIN = "anvil";
  });

  it("selects Anvil when CHAIN=anvil", () => {
    const config = resolveChainConfig();
    expect(config.chain.id).toBe(31337);
  });
});

describe("Chain Config - Base Sepolia", () => {
  beforeEach(() => {
    delete process.env.MAINNET;
    process.env.CHAIN = "base-sepolia";
  });

  it("selects Base Sepolia when CHAIN=base-sepolia", () => {
    const config = resolveChainConfig();
    expect(config.chain.id).toBe(84532);
  });

  it("uses sepolia.base.org as default RPC", () => {
    const config = resolveChainConfig();
    expect(config.rpcUrl).toContain("sepolia.base.org");
  });

  it("respects custom RPC URL", () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://custom-rpc.example.com";
    const config = resolveChainConfig();
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("returns 'Base Sepolia (Testnet)' as chain name", () => {
    const config = resolveChainConfig();
    expect(getChainName(config)).toBe("Base Sepolia (Testnet)");
  });
});

describe("Chain Config - Base Mainnet", () => {
  beforeEach(() => {
    process.env.MAINNET = "true";
    delete process.env.CHAIN;
  });

  it("selects Base Mainnet when MAINNET=true", () => {
    const config = resolveChainConfig();
    expect(config.chain.id).toBe(8453);
  });

  it("MAINNET=true overrides CHAIN env var", () => {
    process.env.CHAIN = "anvil";
    const config = resolveChainConfig();
    expect(config.chain.id).toBe(8453);
  });

  it("uses mainnet.base.org as default RPC", () => {
    const config = resolveChainConfig();
    expect(config.rpcUrl).toContain("mainnet.base.org");
  });

  it("returns 'Base (Mainnet)' as chain name", () => {
    const config = resolveChainConfig();
    expect(getChainName(config)).toBe("Base (Mainnet)");
  });
});

describe("Chain Config - World Address", () => {
  it("reads WORLD_ADDRESS from env", () => {
    process.env.WORLD_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
    const config = resolveChainConfig();
    expect(config.worldAddress).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  it("defaults to 0x0 when WORLD_ADDRESS not set", () => {
    delete process.env.WORLD_ADDRESS;
    const config = resolveChainConfig();
    expect(config.worldAddress).toBe("0x0");
  });
});
