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
    account: {
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    },
  };

  const publicClient = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status: sendResult.success ? "success" : "reverted",
      gasUsed: sendResult.gasUsed,
    }),
    getTransactionCount: vi.fn().mockResolvedValue(0),
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
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValueOnce({ status: "reverted", gasUsed: 21000n })
        .mockResolvedValueOnce({ status: "success", gasUsed: 50000n }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
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
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        gasUsed: 21000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
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

// ============================================================================
// Nonce Sequencing
// ============================================================================

describe("BatchWriter - Nonce Sequencing", () => {
  it("assigns sequential nonces starting from current count", async () => {
    const walletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xabc" as Hex),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        gasUsed: 30000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(42),
    };

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
    writer.queueCall("0x03" as Hex, "call3");
    await writer.flush();

    // Verify nonces are 42, 43, 44
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(3);
    expect(walletClient.sendTransaction.mock.calls[0][0].nonce).toBe(42);
    expect(walletClient.sendTransaction.mock.calls[1][0].nonce).toBe(43);
    expect(walletClient.sendTransaction.mock.calls[2][0].nonce).toBe(44);
  });

  it("fetches nonce with pending block tag", async () => {
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
    await writer.flush();

    expect(publicClient.getTransactionCount).toHaveBeenCalledWith({
      address: walletClient.account.address,
      blockTag: "pending",
    });
  });
});

// ============================================================================
// Deduplication
// ============================================================================

describe("BatchWriter - Deduplication", () => {
  it("assigns automatic dedupeKey when not provided", () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      { worldAddress: "0x1" as Address, maxBatchDelayMs: 99999 },
    );

    writer.queueCall("0x01" as Hex, "call1");
    // Access pending count — dedupeKey is internal, just verify it doesn't error
    expect(writer.pendingCount).toBe(1);
  });

  it("preserves explicit dedupeKey", async () => {
    const persistCalls: Array<{
      dedupeKey: string | undefined;
    }> = [];
    const mockPersistence = {
      persistFailedTx: vi.fn(),
      markDeadLetter: vi.fn(async (call: { dedupeKey?: string }) => {
        persistCalls.push({ dedupeKey: call.dedupeKey });
      }),
    };

    const walletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xfail" as Hex),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        gasUsed: 21000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    };

    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        maxRetries: 0,
        persistence: mockPersistence,
      },
    );

    writer.queueCall("0x01" as Hex, "my-call", "custom-key-123");
    await writer.flush();

    expect(mockPersistence.markDeadLetter).toHaveBeenCalledTimes(1);
    expect(persistCalls[0].dedupeKey).toBe("custom-key-123");
  });
});

// ============================================================================
// Concurrent Flush Prevention
// ============================================================================

describe("BatchWriter - Concurrent Flush Prevention", () => {
  it("returns null if flush is already in progress", async () => {
    const walletClient = {
      sendTransaction: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve("0xabc" as Hex), 50),
            ),
        ),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        gasUsed: 30000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    };

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

    // Start first flush (will be slow due to setTimeout in mock)
    const flush1 = writer.flush();

    // Second flush should return null (concurrent guard)
    writer.queueCall("0x02" as Hex, "call2");
    const flush2 = await writer.flush();

    expect(flush2).toBeNull();

    // Wait for first flush to complete
    await flush1;
  });
});

// ============================================================================
// Persistence Integration
// ============================================================================

describe("BatchWriter - Persistence", () => {
  it("marks dead-letter on exhausted retries with persistence", async () => {
    const mockPersistence = {
      persistFailedTx: vi.fn(),
      markDeadLetter: vi.fn().mockResolvedValue(undefined),
    };

    const walletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xfail" as Hex),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        gasUsed: 21000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    };

    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        maxRetries: 0,
        persistence: mockPersistence,
      },
    );

    writer.queueCall("0x01" as Hex, "will-fail-1");
    writer.queueCall("0x02" as Hex, "will-fail-2");
    await writer.flush();

    // Both calls should be dead-lettered
    expect(mockPersistence.markDeadLetter).toHaveBeenCalledTimes(2);
    // With persistence, calls should NOT be re-queued
    expect(writer.pendingCount).toBe(0);
  });

  it("re-queues failed calls without persistence", async () => {
    const walletClient = {
      sendTransaction: vi.fn().mockResolvedValue("0xfail" as Hex),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        gasUsed: 21000n,
      }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    };

    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        maxRetries: 0,
        // No persistence configured
      },
    );

    writer.queueCall("0x01" as Hex, "will-fail");
    await writer.flush();

    // Without persistence, calls are re-queued for in-memory retry
    expect(writer.pendingCount).toBe(1);
  });

  it("loads pending transactions on initialize", async () => {
    const mockPersistence = {
      persistFailedTx: vi.fn(),
      markDeadLetter: vi.fn(),
      loadPendingTxs: vi.fn().mockResolvedValue([
        {
          callData: "0xrecovered1" as Hex,
          description: "recovered-call-1",
          queuedAt: 1000,
          dedupeKey: "key-1",
        },
        {
          callData: "0xrecovered2" as Hex,
          description: "recovered-call-2",
          queuedAt: 2000,
          dedupeKey: "key-2",
        },
      ]),
    };

    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        maxBatchSize: 100,
        persistence: mockPersistence,
      },
    );

    await writer.initialize();

    expect(mockPersistence.loadPendingTxs).toHaveBeenCalledTimes(1);
    expect(writer.pendingCount).toBe(2);
  });

  it("handles loadPendingTxs error gracefully", async () => {
    const mockPersistence = {
      persistFailedTx: vi.fn(),
      markDeadLetter: vi.fn(),
      loadPendingTxs: vi.fn().mockRejectedValue(new Error("DB down")),
    };

    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 99999,
        persistence: mockPersistence,
      },
    );

    // Should not throw
    await writer.initialize();
    expect(writer.pendingCount).toBe(0);
  });
});

// ============================================================================
// Gas Aggregation
// ============================================================================

describe("BatchWriter - Gas Aggregation", () => {
  it("sums gas used across all receipts", async () => {
    const walletClient = {
      sendTransaction: vi
        .fn()
        .mockResolvedValueOnce("0xhash1" as Hex)
        .mockResolvedValueOnce("0xhash2" as Hex)
        .mockResolvedValueOnce("0xhash3" as Hex),
      chain: { id: 31337, name: "Anvil" },
      account: {
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    };

    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValueOnce({ status: "success", gasUsed: 10000n })
        .mockResolvedValueOnce({ status: "success", gasUsed: 20000n })
        .mockResolvedValueOnce({ status: "success", gasUsed: 30000n }),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    };

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
    writer.queueCall("0x03" as Hex, "call3");
    const result = await writer.flush();

    expect(result).not.toBeNull();
    expect(result!.gasUsed).toBe(60000n);
    expect(result!.callCount).toBe(3);
  });
});

// ============================================================================
// Timer-based Auto-flush
// ============================================================================

describe("BatchWriter - Timer Auto-flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-flushes after maxBatchDelayMs", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 500,
        maxBatchSize: 100,
      },
    );

    writer.queueCall("0x01" as Hex, "timed-call");
    expect(walletClient.sendTransaction).not.toHaveBeenCalled();

    // Advance past the delay
    vi.advanceTimersByTime(600);

    // Allow async flush to resolve
    await vi.runAllTimersAsync();

    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("cancels timer on manual flush", async () => {
    const { walletClient, publicClient } = createMockClients();
    const writer = new BatchWriter(
      walletClient as never,
      publicClient as never,
      {
        worldAddress: "0x1" as Address,
        maxBatchDelayMs: 5000,
        maxBatchSize: 100,
      },
    );

    writer.queueCall("0x01" as Hex, "manual-call");
    await writer.flush();

    // Advance timer — should NOT cause another flush since manual flush cleared it
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    // Only 1 call from manual flush, not 2
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
