import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { Connection } from "@solana/web3.js";
import { createPublicClient, http, type Address, type Hash } from "viem";

import { GOLD_CLOB_ABI } from "../../src/lib/goldClobAbi";

type E2eState = {
  mode?: "localnet" | "public";
  cluster?: "localnet" | "testnet" | "mainnet-beta";
  solanaRpcUrl?: string;
  goldMint: string;
  currentMatchId: number;
  lastResolvedMatchId: number;
  expectedSeedSuccess?: boolean;
  canStartNewRound?: boolean;
  placeBetPayAsset?: "GOLD" | "SOL" | "USDC";
  placeBetAmount?: string;
  placeBetSide?: "YES" | "NO";
  currentBetWindowSeconds?: number;
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldTokenAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
};

async function loadState(): Promise<E2eState> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw) as E2eState;
}

async function waitForStatusAny(
  page: Page,
  expectedSubstrings: string[],
  timeoutMs: number,
  statusTestId = "status",
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId(statusTestId).textContent()) || "";
        const hit = expectedSubstrings.find((value) => text.includes(value));
        if (hit) {
          matched = hit;
          return hit;
        }
        return "";
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");

  return matched;
}

async function readTestValue(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) || "").trim();
}

async function expectSolanaTxSuccess(
  connection: Connection,
  signature: string,
  label: string,
): Promise<void> {
  expect(signature, `${label} signature missing`).not.toBe("");
  expect(signature, `${label} signature missing`).not.toBe("-");

  await expect
    .poll(
      async () => {
        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        if (!status) return "missing";
        if (status.err) return "failed";
        return status.confirmationStatus || "confirmed";
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("missing");

  const statuses = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = statuses.value[0];
  expect(status, `${label} status not found`).toBeTruthy();
  expect(status?.err ?? null, `${label} failed on-chain`).toBeNull();
}

async function expectEvmTxSuccess(
  rpcUrl: string,
  txHash: string,
  label: string,
): Promise<void> {
  expect(txHash, `${label} tx hash missing`).not.toBe("");
  expect(txHash, `${label} tx hash missing`).not.toBe("-");

  const client = createPublicClient({ transport: http(rpcUrl) });
  await expect
    .poll(
      async () => {
        try {
          const receipt = await client.getTransactionReceipt({
            hash: txHash as Hash,
          });
          return receipt.status;
        } catch {
          return "pending";
        }
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBe("success");
}

test("runs dual-chain localnet E2E and validates on-chain txs", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const state = await loadState();
  const strictSeedAssertions =
    state.cluster === "localnet" || state.mode === "localnet";
  const solanaConnection = new Connection(
    state.solanaRpcUrl || "http://127.0.0.1:8899",
    "confirmed",
  );

  await page.goto("/?debug=1");
  await expect(
    page.getByRole("heading", { name: "Ultra Simple Fight Bet" }),
  ).toBeVisible();

  await page.getByTestId("e2e-chain-select").selectOption("solana");
  await expect(page.getByTestId("e2e-active-chain")).toContainText("solana");

  await expect(page.getByTestId("gold-mint")).toContainText(state.goldMint);
  await expect(page.getByTestId("current-match-id")).toContainText(
    String(state.currentMatchId),
  );
  await expect(page.getByTestId("last-result")).toContainText(
    String(state.lastResolvedMatchId),
  );

  const connectButton = page.getByRole("button", { name: /connect/i }).first();
  if (await connectButton.isVisible().catch(() => false)) {
    await connectButton.click();
  }

  await expect(page.getByTestId("place-bet")).toBeEnabled();

  await page.getByRole("button", { name: "Pick NO" }).click();
  await expect(page.getByTestId("side-select")).toHaveValue("NO");
  await page.getByRole("button", { name: "Pick YES" }).click();
  await expect(page.getByTestId("side-select")).toHaveValue("YES");

  await page.getByTestId("refresh-market").click();
  await expect(page.getByTestId("seed-liquidity")).toBeEnabled();

  await page.waitForTimeout(11_000);
  await page.getByTestId("seed-liquidity").click();
  if (!strictSeedAssertions) {
    await waitForStatusAny(
      page,
      ["seeded", "Seed failed", "Seeding market-maker liquidity"],
      25_000,
    );
  } else if (state.expectedSeedSuccess === false) {
    await waitForStatusAny(
      page,
      ["Seed failed", "Market-maker liquidity seeded"],
      90_000,
    );
  } else {
    const seedStatus = await waitForStatusAny(
      page,
      ["Market-maker liquidity seeded", "Seed failed"],
      120_000,
    );
    if (seedStatus === "Seed failed") {
      await page.getByTestId("refresh-market").click();
    }
  }

  const solanaSeedTx = await readTestValue(page, "solana-last-seed-tx");
  if (solanaSeedTx && solanaSeedTx !== "-") {
    await expectSolanaTxSuccess(solanaConnection, solanaSeedTx, "Solana seed");
  }

  const betSide = state.placeBetSide || "YES";
  const payAsset = state.placeBetPayAsset || "GOLD";
  const amount = state.placeBetAmount || "1";

  await page.getByTestId("side-select").selectOption(betSide);
  await page.getByTestId("pay-asset-select").selectOption(payAsset);
  await page.getByTestId("amount-input").fill(amount);
  await page.getByTestId("place-bet").click();
  await waitForStatusAny(page, ["Bet placed", "Order placed"], 240_000);

  await expectSolanaTxSuccess(
    solanaConnection,
    await readTestValue(page, "solana-last-place-bet-tx"),
    "Solana place bet",
  );

  const betWindowSeconds = state.currentBetWindowSeconds || 45;
  await expect
    .poll(async () => page.getByTestId("countdown").textContent(), {
      timeout: Math.max(120_000, (betWindowSeconds + 90) * 1_000),
      intervals: [1_000, 2_000, 5_000],
    })
    .toContain("00:00");

  await page.waitForTimeout(3_000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.getByTestId("resolve-market").click();
    await page.waitForTimeout(4_000);
    const statusText = (await page.getByTestId("status").textContent()) || "";
    const marketStatusText =
      (await page.getByTestId("market-status").textContent()) || "";
    if (statusText.includes("Resolved")) break;
    if (
      marketStatusText.includes("RESOLVED") ||
      marketStatusText.includes("VOID")
    ) {
      break;
    }
    if (
      !statusText.includes("BetWindowStillOpen") &&
      !statusText.includes("not confirmed in 30.00 seconds") &&
      !statusText.includes("Resolve failed")
    ) {
      break;
    }
    await page.getByTestId("refresh-market").click();
  }

  await expect
    .poll(
      async () => {
        const statusText =
          (await page.getByTestId("status").textContent()) || "";
        const marketStatusText =
          (await page.getByTestId("market-status").textContent()) || "";
        return (
          statusText.includes("Resolved") ||
          marketStatusText.includes("RESOLVED") ||
          marketStatusText.includes("VOID")
        );
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBe(true);

  await expectSolanaTxSuccess(
    solanaConnection,
    await readTestValue(page, "solana-last-resolve-oracle-tx"),
    "Solana oracle result",
  );
  await expectSolanaTxSuccess(
    solanaConnection,
    await readTestValue(page, "solana-last-resolve-market-tx"),
    "Solana resolve market",
  );

  let solanaClaimTx = await readTestValue(page, "solana-last-claim-tx");
  if (!solanaClaimTx || solanaClaimTx === "-") {
    await page.getByTestId("claim-payout").click();
    await waitForStatusAny(page, ["Claim complete", "Claim failed"], 180_000);
    await expect(page.getByTestId("status")).toContainText("Claim complete");
    await expect
      .poll(async () => readTestValue(page, "solana-last-claim-tx"), {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .not.toBe("-");
    solanaClaimTx = await readTestValue(page, "solana-last-claim-tx");
  }

  await expectSolanaTxSuccess(solanaConnection, solanaClaimTx, "Solana claim");

  await page.getByTestId("start-market").click();
  const startResult = await waitForStatusAny(
    page,
    ["Created market", "Create round failed"],
    180_000,
  );
  if (!startResult.includes("Created market")) {
    throw new Error(`Solana start-market action failed: ${startResult}`);
  }
  await expectSolanaTxSuccess(
    solanaConnection,
    await readTestValue(page, "solana-last-start-market-tx"),
    "Solana start market",
  );

  if (
    !state.evmRpcUrl ||
    !state.evmGoldClobAddress ||
    !state.evmHeadlessAddress ||
    typeof state.evmMatchId !== "number"
  ) {
    throw new Error("Missing EVM setup state fields for dual-chain E2E");
  }

  const evmRpcUrl = state.evmRpcUrl;
  const evmClobAddress = state.evmGoldClobAddress as Address;
  const evmHeadlessAddress = state.evmHeadlessAddress as Address;
  const evmMatchId = BigInt(state.evmMatchId);

  const evmClient = createPublicClient({
    transport: http(evmRpcUrl),
  });

  await page.getByTestId("e2e-chain-select").selectOption("bsc");
  await expect(page.getByTestId("e2e-active-chain")).toContainText("bsc");
  await expect(page.getByTestId("evm-panel")).toBeVisible();
  await page.getByTestId("evm-refresh-market").click();

  await expect(page.getByTestId("evm-match-id")).toContainText(
    `Match #${state.evmMatchId}`,
  );

  await page.getByTestId("evm-pick-yes").click();
  await page.getByTestId("evm-amount-input").fill("1");
  await page.getByTestId("evm-place-order").click();
  await waitForStatusAny(
    page,
    ["Order placed", "Order placed on-chain"],
    180_000,
    "evm-status",
  );

  const evmOrderTx = await readTestValue(page, "evm-last-order-tx");
  await expectEvmTxSuccess(evmRpcUrl, evmOrderTx, "EVM place order");

  await page.getByTestId("evm-resolve-match").click();
  await expect
    .poll(
      async () => {
        const resolveTx = await readTestValue(page, "evm-last-resolve-tx");
        if (resolveTx && resolveTx !== "-") return "tx";
        const meta = (await evmClient.readContract({
          address: evmClobAddress,
          abi: GOLD_CLOB_ABI,
          functionName: "matches",
          args: [evmMatchId],
        })) as [number, number, bigint, bigint];
        return Number(meta[0]) === 2 ? "resolved" : "pending";
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("pending");

  const evmResolveTx = await readTestValue(page, "evm-last-resolve-tx");
  if (evmResolveTx && evmResolveTx !== "-") {
    await expectEvmTxSuccess(evmRpcUrl, evmResolveTx, "EVM resolve match");
  }

  let evmClaimTx = await readTestValue(page, "evm-last-claim-tx");
  if (!evmClaimTx || evmClaimTx === "-") {
    await page.getByTestId("evm-claim-payout").click();
    await expect
      .poll(
        async () => {
          const claimTx = await readTestValue(page, "evm-last-claim-tx");
          if (claimTx && claimTx !== "-") return "tx";
          const pos = (await evmClient.readContract({
            address: evmClobAddress,
            abi: GOLD_CLOB_ABI,
            functionName: "positions",
            args: [evmMatchId, evmHeadlessAddress],
          })) as [bigint, bigint];
          return pos[0] === 0n ? "claimed" : "pending";
        },
        {
          timeout: 180_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .not.toBe("pending");
    evmClaimTx = await readTestValue(page, "evm-last-claim-tx");
  }

  if (evmClaimTx && evmClaimTx !== "-") {
    await expectEvmTxSuccess(evmRpcUrl, evmClaimTx, "EVM claim");
  }

  const nextMatchIdBeforeCreate = (await evmClient.readContract({
    address: evmClobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "nextMatchId",
  })) as bigint;

  await page.getByTestId("evm-create-match").click();
  await waitForStatusAny(page, ["Match created"], 180_000, "evm-status");

  const evmCreateTx = await readTestValue(page, "evm-last-create-tx");
  await expectEvmTxSuccess(evmRpcUrl, evmCreateTx, "EVM create match");

  const nextMatchIdAfterCreate = (await evmClient.readContract({
    address: evmClobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "nextMatchId",
  })) as bigint;
  expect(nextMatchIdAfterCreate).toBe(nextMatchIdBeforeCreate + 1n);

  const evmMatchMeta = (await evmClient.readContract({
    address: evmClobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "matches",
    args: [evmMatchId],
  })) as [number, number, bigint, bigint];
  expect(Number(evmMatchMeta[0])).toBe(2); // RESOLVED
  expect(Number(evmMatchMeta[1])).toBe(1); // YES

  const evmPosition = (await evmClient.readContract({
    address: evmClobAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [evmMatchId, evmHeadlessAddress],
  })) as [bigint, bigint];
  expect(evmPosition[0]).toBe(0n);
});
