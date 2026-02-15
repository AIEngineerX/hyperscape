/**
 * Full Login-to-Game E2E Tests (STRICT)
 *
 * These tests only pass when we actually complete:
 *   Login -> (optional username) -> Character Select -> Enter World -> In-game
 */

import { expect } from "@playwright/test";
import { evmTest } from "./fixtures/wallet-fixtures";
import {
  clickEnterWorld,
  connectEvmWalletViaPrivy,
  createNewCharacter,
  fillUsername,
  getExistingCharacterCount,
  isWalletConnected,
  selectFirstCharacter,
  waitForAppReady,
  waitForCharacterSelect,
  waitForGameClient,
  waitForUsernameScreen,
} from "./fixtures/privy-helpers";
import { BASE_URL } from "./fixtures/test-config";

const test = evmTest;

async function expectCharacterReady(
  page: Parameters<typeof waitForAppReady>[0],
): Promise<"character-select" | "in-game"> {
  // Returning players can land directly in-game depending on session restore.
  if (await waitForGameClient(page, 4_000)) {
    return "in-game";
  }

  let hasCharacterScreen = await waitForCharacterSelect(page, 20_000);
  if (!hasCharacterScreen) {
    // Username UI can appear with delayed hydration. Handle it here as a fallback.
    const needsUsername = await waitForUsernameScreen(page, 6_000);
    if (needsUsername) {
      expect(
        await fillUsername(page, `e2e_${Date.now().toString().slice(-8)}`),
      ).toBe(true);
      hasCharacterScreen = await waitForCharacterSelect(page, 20_000);
    }
  }

  if (!hasCharacterScreen && (await waitForGameClient(page, 6_000))) {
    return "in-game";
  }

  expect(hasCharacterScreen).toBe(true);

  const existingCount = await getExistingCharacterCount(page);
  if (existingCount > 0) {
    const selected = await selectFirstCharacter(page);
    expect(selected).toBe(true);
  } else {
    const created = await createNewCharacter(
      page,
      `E2E_${Date.now().toString().slice(-7)}`,
    );
    expect(created).toBe(true);
  }

  await expect(
    page.locator('button:has-text("Enter World")').first(),
  ).toBeVisible({
    timeout: 10_000,
  });

  return "character-select";
}

test.describe("Full Login-to-Game Flow (Strict)", () => {
  test.setTimeout(6 * 60 * 1000);

  test("logs in, reaches character select, and enters the world", async ({
    page,
    wallet,
  }) => {
    await waitForAppReady(page, BASE_URL);

    await expect(page.locator('button:has-text("Enter")').first()).toBeVisible({
      timeout: 20_000,
    });

    await connectEvmWalletViaPrivy(page, wallet);

    const connected = await isWalletConnected(page);
    expect(connected).toBe(true);

    const needsUsername = await waitForUsernameScreen(page, 10_000);
    if (needsUsername) {
      const submitted = await fillUsername(
        page,
        `e2e_${Date.now().toString().slice(-8)}`,
      );
      expect(submitted).toBe(true);
    }

    const state = await expectCharacterReady(page);
    if (state !== "in-game") {
      const enteredWorld = await clickEnterWorld(page, 45_000);
      expect(enteredWorld).toBe(true);

      const inGame = await waitForGameClient(page, 20_000);
      expect(inGame).toBe(true);
    }

    await expect(
      page
        .locator("#game-canvas, .App__viewport, [data-component='viewport']")
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("exposes world state after entering game", async ({ page, wallet }) => {
    await waitForAppReady(page, BASE_URL);

    await connectEvmWalletViaPrivy(page, wallet);
    expect(await isWalletConnected(page)).toBe(true);

    const needsUsername = await waitForUsernameScreen(page, 10_000);
    if (needsUsername) {
      expect(
        await fillUsername(page, `e2e_${Date.now().toString().slice(-8)}`),
      ).toBe(true);
    }

    const state = await expectCharacterReady(page);
    if (state !== "in-game") {
      expect(await clickEnterWorld(page, 45_000)).toBe(true);
      expect(await waitForGameClient(page, 20_000)).toBe(true);
    }

    await page.waitForTimeout(6_000);

    const worldState = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      const world = win.world as Record<string, unknown> | undefined;
      if (!world) return null;

      return {
        hasEntities: typeof world.entities !== "undefined",
        hasNetwork: typeof world.network !== "undefined",
      };
    });

    expect(worldState).not.toBeNull();
    expect(worldState?.hasEntities).toBe(true);
    expect(worldState?.hasNetwork).toBe(true);
  });
});
