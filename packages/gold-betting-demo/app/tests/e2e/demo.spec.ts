import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

type E2eState = {
  goldMint: string;
  currentMatchId: number;
  lastResolvedMatchId: number;
};

async function loadState(): Promise<E2eState> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw) as E2eState;
}

test("covers all primary demo actions with headless wallet", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const state = await loadState();

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "GOLD Binary Fight Market" }),
  ).toBeVisible();

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

  await page.getByTestId("refresh-market").click();
  await expect(page.getByTestId("seed-liquidity")).toBeEnabled();

  await page.waitForTimeout(11_000);
  await page.getByTestId("seed-liquidity").click();
  await expect(page.getByTestId("status")).toContainText("seeded");

  await page.getByTestId("side-select").selectOption("YES");
  await page.getByTestId("pay-asset-select").selectOption("GOLD");
  await page.getByTestId("amount-input").fill("1");
  await page.getByTestId("place-bet").click();
  await expect(page.getByTestId("status")).toContainText("Bet placed");

  await expect
    .poll(async () => page.getByTestId("countdown").textContent(), {
      timeout: 90_000,
      intervals: [1_000],
    })
    .toContain("00:00");

  await page.waitForTimeout(3_000);
  await page.getByTestId("resolve-market").click();
  const firstResolveStatus =
    (await page.getByTestId("status").textContent()) || "";
  if (firstResolveStatus.includes("BetWindowStillOpen")) {
    await page.waitForTimeout(3_000);
    await page.getByTestId("resolve-market").click();
  }
  await expect(page.getByTestId("status")).toContainText("Resolved");

  await page.getByTestId("claim-payout").click();
  await expect(page.getByTestId("status")).toContainText("Claim complete");

  await page.getByTestId("start-market").click();
  await expect(page.getByTestId("status")).toContainText("Created market");
  await expect(page.getByTestId("current-match-id")).toContainText(/\d+/);
});
