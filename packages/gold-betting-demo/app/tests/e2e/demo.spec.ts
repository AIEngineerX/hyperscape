import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

type E2eState = {
  mode?: "localnet" | "public";
  cluster?: "localnet" | "testnet" | "mainnet-beta";
  goldMint: string;
  currentMatchId: number;
  lastResolvedMatchId: number;
  expectedSeedSuccess?: boolean;
  canStartNewRound?: boolean;
  placeBetPayAsset?: "GOLD" | "SOL" | "USDC";
  placeBetAmount?: string;
  placeBetSide?: "YES" | "NO";
  currentBetWindowSeconds?: number;
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
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId("status").textContent()) || "";
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

test("covers all primary demo actions with headless wallet", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const state = await loadState();
  const strictSeedAssertions =
    state.cluster === "localnet" || state.mode === "localnet";

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ultra Simple Fight Bet" }),
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
      ["seeded", "Seed failed"],
      120_000,
    );
    if (seedStatus === "Seed failed") {
      await page.getByTestId("refresh-market").click();
      await expect
        .poll(async () => page.getByTestId("pool-totals").textContent(), {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        })
        .not.toContain("YES pool: 0.000000 GOLD | NO pool: 0.000000 GOLD");
    }
  }

  const betSide = state.placeBetSide || "YES";
  const payAsset = state.placeBetPayAsset || "GOLD";
  const amount = state.placeBetAmount || "1";

  await page.getByTestId("side-select").selectOption(betSide);
  await page.getByTestId("pay-asset-select").selectOption(payAsset);
  await page.getByTestId("amount-input").fill(amount);
  await page.getByTestId("place-bet").click();
  await waitForStatusAny(page, ["Bet placed"], 240_000);

  const betWindowSeconds = state.currentBetWindowSeconds || 45;
  await expect
    .poll(async () => page.getByTestId("countdown").textContent(), {
      timeout: Math.max(120_000, (betWindowSeconds + 90) * 1_000),
      intervals: [1_000, 2_000, 5_000],
    })
    .toContain("00:00");

  await page.waitForTimeout(3_000);
  const resolveAttempts = strictSeedAssertions ? 3 : 8;
  for (let attempt = 0; attempt < resolveAttempts; attempt += 1) {
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

  const claimAttempts = strictSeedAssertions ? 1 : 4;
  for (let attempt = 0; attempt < claimAttempts; attempt += 1) {
    await page.getByTestId("claim-payout").click();
    const claimResult = await waitForStatusAny(
      page,
      [
        "Claim complete",
        "Claim failed: Transaction was not confirmed in 30.00 seconds",
        "Claim failed: AnchorError",
        "Claim failed: Error:",
      ],
      120_000,
    );
    if (
      claimResult === "Claim complete" ||
      claimResult === "Claim failed: AnchorError" ||
      claimResult === "Claim failed: Error:"
    ) {
      break;
    }
    await page.getByTestId("refresh-market").click();
  }

  if (state.canStartNewRound !== false) {
    await page.getByTestId("start-market").click();
    await waitForStatusAny(page, ["Created market"], 120_000);
    await expect(page.getByTestId("current-match-id")).toContainText(/\d+/);
  }
});
