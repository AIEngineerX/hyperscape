/**
 * BatchWriter Tests
 *
 * Tests the transaction batching logic without requiring a real chain.
 * Uses mock wallet/public clients to verify queuing, flushing,
 * timing, and retry behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BatchWriter } from "../src/tx/BatchWriter.js";
import type { Hex, Address } from "viem";

// Mock clients
function createMockClients(
  sendResult: { hash: Hex; success: boolean; gasUsed: bigint } = {
    hash: "0xabc123" as Hex,
    success: true,
    gasUsed: 50000n,
  },
) {
  const walletClient = {
    sendTransaction: vi.fn().mockResolvedValue(sendResult.hash),
    chain: { id: 31337, name: "Anvil" },
  };

  const publicClient = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status: sendResult.success ? "success" : "reverted",
      gasUsed: sendResult.gasUsed,
    }),
  };

  return { walletClient, publicClient };
}

describe("BatchWriter - Queuing", () => {
  it("tracks pending call count", () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      { worldAddress: "0x1" as Address, maxBatchDelayMs: 99999 },
    );

    expect(writer.pendingCount).toBe(0);
    writer.queueCall("0x1234" as Hex, "test1");
    expect(writer.pendingCount).toBe(1);
    writer.queueCall("0x5678" as Hex, "test2");
    expect(writer.pendingCount).toBe(2);
  });

  it("reports stats correctly", () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      { worldAddress: "0x1" as Address, maxBatchDelayMs: 99999 },
    );

    const stats = writer.getStats();
    expect(stats.totalCallsFlushed).toBe(0);
    expect(stats.totalFlushes).toBe(0);
    expect(stats.failedFlushes).toBe(0);
    expect(stats.pending).toBe(0);
  });
});

describe("BatchWriter - Flushing", () => {
  it("flushes when batch size is reached", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchSize: 3,
        maxBatchDelayMs: 99999,
      },
    );

    writer.queueCall("0x01" as Hex, "call1");
    writer.queueCall("0x02" as Hex, "call2");
    expect(walletClient.sendTransaction).not.toHaveBeenCalled();

    // Third call triggers flush - sends 3 parallel txs (one per call)
    writer.queueCall("0x03" as Hex, "call3");

    // Wait for async flush to complete (flush is fire-and-forget in queueCall)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // BatchWriter sends each call as a separate tx in parallel
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(3);
    expect(writer.pendingCount).toBe(0);
  });

  it("manual flush sends pending calls (one tx per call)", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
      },
    );

    writer.queueCall("0x01" as Hex, "call1");
    writer.queueCall("0x02" as Hex, "call2");

    const result = await writer.flush();

    expect(result).not.toBeNull();
    expect(result!.callCount).toBe(2);
    expect(result!.success).toBe(true);
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(2);
    expect(writer.pendingCount).toBe(0);
  });

  it("flush returns null when no pending calls", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      { worldAddress: "0x1" as Address },
    );

    const result = await writer.flush();
    expect(result).toBeNull();
    expect(walletClient.sendTransaction).not.toHaveBeenCalled();
  });

  it("updates stats after successful flush", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
      },
    );

    writer.queueCall("0x01" as Hex, "call1");
    writer.queueCall("0x02" as Hex, "call2");
    await writer.flush();

    const stats = writer.getStats();
    expect(stats.totalCallsFlushed).toBe(2);
    expect(stats.totalFlushes).toBe(1);
    expect(stats.failedFlushes).toBe(0);
    expect(stats.pending).toBe(0);
  });
});

describe("BatchWriter - Retry", () => {
  it("retries on transaction failure", async () => {
    // First call fails, second succeeds
    const walletClient = {
      sendTransaction: vi
        .fn()
        .mockResolvedValueOnce("0xfail" as Hex)
        .mockResolvedValueOnce("0xsuccess" as Hex),
      chain: { id: 31337, name: "Anvil" },
    };

    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValueOnce({ status: "reverted", gasUsed: 21000n })
        .mockResolvedValueOnce({ status: "success", gasUsed: 50000n }),
    };

    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        maxRetries: 2,
        retryBaseDelayMs: 10, // Short delay for testing
      },
    );

    writer.queueCall("0x01" as Hex, "retryable");
    const result = await writer.flush();

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("increments failedFlushes when all retries exhausted", async () => {
    const walletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xfail" as Hex),
      chain: { id: 31337, name: "Anvil" },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        gasUsed: 21000n,
      }),
    };

    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        maxRetries: 1,
        retryBaseDelayMs: 10,
      },
    );

    writer.queueCall("0x01" as Hex, "will-fail");
    await writer.flush();

    const stats = writer.getStats();
    expect(stats.failedFlushes).toBe(1);
    // Failed calls should be re-queued
    expect(stats.pending).toBe(1);
  });
});

describe("BatchWriter - Shutdown", () => {
  it("flushes remaining calls on shutdown", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
      },
    );

    writer.queueCall("0x01" as Hex, "pending1");
    writer.queueCall("0x02" as Hex, "pending2");

    await writer.shutdown();

    // Each pending call sent as its own tx
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(2);
    expect(writer.pendingCount).toBe(0);
  });

  it("is safe to call shutdown with no pending calls", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      { worldAddress: "0x1" as Address },
    );

    await writer.shutdown();
    expect(walletClient.sendTransaction).not.toHaveBeenCalled();
  });
});
