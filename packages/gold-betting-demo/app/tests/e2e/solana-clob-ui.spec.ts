import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { Connection } from "@solana/web3.js";

type E2eState = {
  solanaRpcUrl?: string;
};

async function loadState(): Promise<E2eState> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw) as E2eState;
}

async function readTxSignature(page: Page, testId: string): Promise<string> {
  const text = ((await page.getByTestId(testId).textContent()) || "").trim();
  const [, value = ""] = text.split(":");
  return value.trim();
}

async function waitForNewTxSignature(
  page: Page,
  testId: string,
  previousSignature = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readTxSignature(page, testId);
        if (next && next !== "-" && next !== previousSignature) {
          matched = next;
          return next;
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

async function waitForStatusAny(
  page: Page,
  expectedSubstrings: string[],
  timeoutMs: number,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const text =
          (await page.getByTestId("solana-clob-status").textContent()) || "";
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

async function ensureWalletConnected(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const connected = await page
      .getByText(/Wallet connected/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (connected) return;

    const connectButton = page
      .getByRole("button", { name: /connect wallet|select wallet|connect/i })
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }
    await page.waitForTimeout(2_000);
  }

  await expect(page.getByText(/Wallet connected/i).first()).toBeVisible({
    timeout: 60_000,
  });
}

test("runs non-debug Solana CLOB UI E2E and validates txs", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const state = await loadState();
  const connection = new Connection(
    state.solanaRpcUrl || "http://127.0.0.1:8899",
    "confirmed",
  );

  await page.goto("/");
  const chainSelector = page.locator("#chain-selector");
  if ((await chainSelector.count()) > 0) {
    await chainSelector.selectOption("solana");
  }
  const expandButton = page.locator('button[title="Expand panel"]').first();
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }
  await expect(page.getByTestId("solana-clob-panel")).toBeVisible({
    timeout: 60_000,
  });

  await ensureWalletConnected(page);

  await page.getByTestId("solana-clob-refresh").click();
  await page.getByTestId("solana-clob-price-input").fill("500");
  await page.getByLabel("Bet amount in GOLD").fill("1");

  await page.getByTestId("solana-clob-create-match").click();
  await waitForStatusAny(
    page,
    ["Created new Solana CLOB market", "Market open"],
    180_000,
  );

  const initConfigTx = await readTxSignature(
    page,
    "solana-clob-init-config-tx",
  );
  if (initConfigTx && initConfigTx !== "-") {
    await expectSolanaTxSuccess(
      connection,
      initConfigTx,
      "Solana CLOB init config",
    );
  }
  await expectSolanaTxSuccess(
    connection,
    await readTxSignature(page, "solana-clob-create-match-tx"),
    "Solana CLOB create match",
  );
  await expectSolanaTxSuccess(
    connection,
    await readTxSignature(page, "solana-clob-init-orderbook-tx"),
    "Solana CLOB init order book",
  );

  await page.locator(".gm-btn-agent1").first().click();
  await page
    .getByRole("button", { name: /buy yes/i })
    .first()
    .click();
  const firstOrderTx = await waitForNewTxSignature(
    page,
    "solana-clob-place-order-tx",
    "",
    180_000,
  );
  await expectSolanaTxSuccess(
    connection,
    firstOrderTx,
    "Solana CLOB first order",
  );

  const previousCancelTx = await readTxSignature(
    page,
    "solana-clob-cancel-order-tx",
  );
  await page.getByTestId("solana-clob-cancel-order").click();
  const cancelTx = await waitForNewTxSignature(
    page,
    "solana-clob-cancel-order-tx",
    previousCancelTx,
    120_000,
  );
  await expectSolanaTxSuccess(connection, cancelTx, "Solana CLOB cancel order");

  const previousPlaceTx = await readTxSignature(
    page,
    "solana-clob-place-order-tx",
  );
  await page.locator(".gm-btn-agent1").first().click();
  await page
    .getByRole("button", { name: /buy yes/i })
    .first()
    .click();
  const secondOrderTx = await waitForNewTxSignature(
    page,
    "solana-clob-place-order-tx",
    previousPlaceTx,
    180_000,
  );
  await expect(secondOrderTx).not.toBe(firstOrderTx);
  await expectSolanaTxSuccess(
    connection,
    secondOrderTx,
    "Solana CLOB second order",
  );

  const previousCrossTx = await readTxSignature(
    page,
    "solana-clob-place-order-tx",
  );
  await page.locator(".gm-btn-agent2").first().click();
  await page
    .getByRole("button", { name: /buy no/i })
    .first()
    .click();
  const crossingOrderTx = await waitForNewTxSignature(
    page,
    "solana-clob-place-order-tx",
    previousCrossTx,
    180_000,
  );
  await expectSolanaTxSuccess(
    connection,
    crossingOrderTx,
    "Solana CLOB crossing order",
  );

  const previousResolveTx = await readTxSignature(
    page,
    "solana-clob-resolve-tx",
  );
  await page.locator(".gm-btn-agent1").first().click();
  await page.getByTestId("solana-clob-resolve").click();
  await waitForStatusAny(
    page,
    ["Resolved. Winner: YES", "Resolved (YES)"],
    180_000,
  );
  const resolveTx = await waitForNewTxSignature(
    page,
    "solana-clob-resolve-tx",
    previousResolveTx,
    180_000,
  );
  await expectSolanaTxSuccess(connection, resolveTx, "Solana CLOB resolve");

  let claimTx = await readTxSignature(page, "solana-clob-claim-tx");
  if (!claimTx || claimTx === "-") {
    const previousClaimTx = claimTx || "-";
    await page.getByTestId("solana-clob-claim").click();
    claimTx = await waitForNewTxSignature(
      page,
      "solana-clob-claim-tx",
      previousClaimTx,
      180_000,
    );
  }

  await expectSolanaTxSuccess(connection, claimTx, "Solana CLOB claim");
});
