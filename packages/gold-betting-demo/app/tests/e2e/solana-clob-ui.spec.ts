import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { Connection } from "@solana/web3.js";

type E2eState = {
  solanaRpcUrl?: string;
  placeBetAmount?: string;
};

async function loadState(): Promise<E2eState> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw) as E2eState;
}

async function readTxSignature(page: Page, testId: string): Promise<string> {
  const text = ((await page.getByTestId(testId).textContent()) || "").trim();
  if (!text) return "";
  const delimiterIndex = text.indexOf(":");
  if (delimiterIndex >= 0) {
    return text.slice(delimiterIndex + 1).trim();
  }
  return text;
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
  const hasConnectedSolanaWallet = async (): Promise<boolean> => {
    const desktopWalletChip = page
      .getByRole("button", { name: /^SOL\s+[A-Za-z0-9].*/i })
      .first();
    if (await desktopWalletChip.isVisible().catch(() => false)) return true;

    const mobileWalletChip = page
      .getByRole("button", { name: /^◎\s*[A-Za-z0-9].*/i })
      .first();
    if (await mobileWalletChip.isVisible().catch(() => false)) return true;

    const genericConnectedText = page.getByText(/Wallet connected/i).first();
    if (await genericConnectedText.isVisible().catch(() => false)) return true;

    return false;
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasConnectedSolanaWallet()) return;

    const connectButton = page
      .getByRole("button", {
        name: /connect wallet|select wallet|connect|add sol wallet|connect sol/i,
      })
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }
    await page.waitForTimeout(2_000);
  }

  await expect.poll(hasConnectedSolanaWallet, { timeout: 60_000 }).toBe(true);
}

async function switchToSolanaChain(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const markers = [
          page.locator("#chain-selector").first(),
          page.getByTestId("e2e-chain-select").first(),
          page.locator(".chain-badge-name").first(),
          page.getByTestId("solana-clob-panel").first(),
        ];
        for (const marker of markers) {
          if (await marker.isVisible().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: 90_000,
        intervals: [500, 1_000, 2_000, 5_000],
      },
    )
    .toBe(true);

  const debugActiveChain = page.getByTestId("e2e-active-chain");
  if (await debugActiveChain.isVisible().catch(() => false)) {
    const current = (
      (await debugActiveChain.textContent()) || ""
    ).toLowerCase();
    if (current.includes("solana")) return;
  }

  const chainSelectors = page.locator("#chain-selector");
  const selectorCount = await chainSelectors.count();
  for (let index = 0; index < selectorCount; index += 1) {
    const selector = chainSelectors.nth(index);
    if (!(await selector.isVisible().catch(() => false))) continue;

    const values = await selector
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("value") || ""),
      );
    const solanaValue =
      values.find((value) => value.toLowerCase().includes("sol")) || "solana";
    await selector.selectOption(solanaValue);
    await expect(selector).toHaveValue(solanaValue);
    return;
  }

  const debugChainSelector = page.getByTestId("e2e-chain-select");
  if (await debugChainSelector.isVisible().catch(() => false)) {
    await debugChainSelector.selectOption("solana");
    return;
  }

  const fallbackComboboxes = page.getByRole("combobox");
  const comboboxCount = await fallbackComboboxes.count();
  for (let index = 0; index < comboboxCount; index += 1) {
    const fallbackChainSelector = fallbackComboboxes.nth(index);
    if (!(await fallbackChainSelector.isVisible().catch(() => false))) {
      continue;
    }
    const hasSolanaOption = await fallbackChainSelector
      .locator("option")
      .evaluateAll((options) =>
        options.some((option) =>
          ((option.textContent || "") + (option.getAttribute("value") || ""))
            .toLowerCase()
            .includes("sol"),
        ),
      )
      .catch(() => false);
    if (!hasSolanaOption) continue;

    await fallbackChainSelector
      .selectOption({ label: /sol/i })
      .catch(async () => {
        await fallbackChainSelector.selectOption("solana");
      });
    return;
  }

  const chainBadgeName = page.locator(".chain-badge-name").first();
  if (await chainBadgeName.isVisible().catch(() => false)) {
    const badge = ((await chainBadgeName.textContent()) || "").toLowerCase();
    if (badge.includes("sol")) return;
  }

  if (
    await page
      .getByTestId("solana-clob-panel")
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }

  throw new Error(
    "Unable to locate a visible chain selector or confirm Solana mode",
  );
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
  await switchToSolanaChain(page);

  const expandButton = page.locator('button[title="Expand panel"]').first();
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }

  await expect(page.getByTestId("solana-clob-panel")).toBeVisible({
    timeout: 60_000,
  });
  await ensureWalletConnected(page);

  const betAmountInput = page.getByLabel("Bet amount in GOLD").first();
  if (await betAmountInput.isVisible().catch(() => false)) {
    await betAmountInput.fill(state.placeBetAmount ?? "1");
  }

  const priceInput = page.getByTestId("solana-clob-price-input");
  if (await priceInput.isVisible().catch(() => false)) {
    await priceInput.fill("500");
  }

  const currentMatchText = (
    (await page.getByTestId("solana-clob-match").textContent()) || ""
  ).trim();
  if (currentMatchText.endsWith("-")) {
    const previousInitConfigTx = await readTxSignature(
      page,
      "solana-clob-init-config-tx",
    );
    const previousCreateMatchTx = await readTxSignature(
      page,
      "solana-clob-create-match-tx",
    );
    const previousInitOrderbookTx = await readTxSignature(
      page,
      "solana-clob-init-orderbook-tx",
    );

    await page.getByTestId("solana-clob-create-match").click();

    const createMatchTx = await waitForNewTxSignature(
      page,
      "solana-clob-create-match-tx",
      previousCreateMatchTx,
      180_000,
    );
    await expectSolanaTxSuccess(
      connection,
      createMatchTx,
      "Solana create match",
    );

    const initOrderbookTx = await waitForNewTxSignature(
      page,
      "solana-clob-init-orderbook-tx",
      previousInitOrderbookTx,
      180_000,
    );
    await expectSolanaTxSuccess(
      connection,
      initOrderbookTx,
      "Solana init orderbook",
    );

    const initConfigTx = await readTxSignature(
      page,
      "solana-clob-init-config-tx",
    );
    if (
      initConfigTx &&
      initConfigTx !== "-" &&
      initConfigTx !== previousInitConfigTx
    ) {
      await expectSolanaTxSuccess(
        connection,
        initConfigTx,
        "Solana init config",
      );
    }
  }

  const clobPanel = page.getByTestId("solana-clob-panel");
  const buyYesButton = clobPanel
    .getByRole("button", { name: /buy yes/i })
    .first();
  await expect(buyYesButton).toBeEnabled({ timeout: 60_000 });
  const previousPlaceOrderTx = await readTxSignature(
    page,
    "solana-clob-place-order-tx",
  );
  await buyYesButton.click({ force: true });
  await page.waitForTimeout(1_500);
  const immediatePlaceOrderTx = await readTxSignature(
    page,
    "solana-clob-place-order-tx",
  );
  if (
    !immediatePlaceOrderTx ||
    immediatePlaceOrderTx === "-" ||
    immediatePlaceOrderTx === previousPlaceOrderTx
  ) {
    const immediateStatus = (
      (await page.getByTestId("solana-clob-status").textContent()) || ""
    ).trim();
    console.log(
      `[e2e] first BUY YES attempt did not produce tx; status="${immediateStatus}"`,
    );
    await buyYesButton.click({ force: true });
  }

  const placeBetTx = await waitForNewTxSignature(
    page,
    "solana-clob-place-order-tx",
    previousPlaceOrderTx,
    180_000,
  );
  await expectSolanaTxSuccess(connection, placeBetTx, "Solana place bet");
});
