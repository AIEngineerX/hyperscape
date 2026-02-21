/**
 * Full Login-to-Game E2E Tests (STRICT)
 *
 * These tests only pass when we actually complete:
 *   Login -> (optional username) -> Character Select -> Enter World -> In-game
 */

import { expect } from "@playwright/test";
import { evmTest } from "./fixtures/wallet-fixtures";
import {
  completeFullLoginFlow,
  selectFirstCharacter,
  waitForAppReady,
  waitForCharacterSelect,
  waitForGameClient,
} from "./fixtures/privy-helpers";
import { BASE_URL } from "./fixtures/test-config";

const test = evmTest;

test.describe("Full Login-to-Game Flow (Strict)", () => {
  test.setTimeout(6 * 60 * 1000);

  test("logs in, reaches character select, and enters the world", async ({
    page,
    wallet,
  }) => {
    await waitForAppReady(page, BASE_URL);
    expect(await completeFullLoginFlow(page, wallet)).toBe(true);

    await expect(
      page
        .locator("#game-canvas, .App__viewport, [data-component='viewport']")
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("exposes world state after entering game", async ({ page, wallet }) => {
    await waitForAppReady(page, BASE_URL);
    expect(await completeFullLoginFlow(page, wallet)).toBe(true);

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

  test("keeps character available across refresh and reconnects cleanly", async ({
    page,
    wallet,
  }) => {
    await waitForAppReady(page, BASE_URL);
    expect(await completeFullLoginFlow(page, wallet)).toBe(true);

    const authBeforeRefresh = await page.evaluate(() => ({
      authToken: localStorage.getItem("privy_auth_token"),
      privyUserId: localStorage.getItem("privy_user_id"),
    }));
    expect(authBeforeRefresh.authToken).toBeTruthy();
    expect(authBeforeRefresh.privyUserId).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });

    const backInGameDirectly = await waitForGameClient(page, 10_000);
    if (!backInGameDirectly) {
      expect(await waitForCharacterSelect(page, 20_000)).toBe(true);

      // Re-select if needed, then use the resilient full flow helper to re-enter.
      await selectFirstCharacter(page);
      expect(await completeFullLoginFlow(page, wallet)).toBe(true);
    }

    await page.waitForTimeout(5_000);

    const runtimeState = await page.evaluate(() => {
      const win = window as unknown as {
        world?: {
          entities?: {
            player?: { id?: string };
            get?: (id: string) => unknown;
          };
          network?: { id?: string | null };
        };
      };
      const localPlayerId =
        win.world?.entities?.player?.id ?? win.world?.network?.id ?? null;
      const hasLocalEntity =
        typeof localPlayerId === "string" &&
        localPlayerId.length > 0 &&
        (Boolean(win.world?.entities?.player) ||
          (typeof win.world?.entities?.get === "function" &&
            Boolean(win.world.entities.get(localPlayerId))));

      return {
        hasWorld: Boolean(win.world),
        localPlayerId,
        hasLocalEntity,
      };
    });

    expect(runtimeState.hasWorld).toBe(true);
    expect(runtimeState.localPlayerId).toBeTruthy();
    expect(runtimeState.hasLocalEntity).toBe(true);
  });
});
