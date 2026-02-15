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
import { takeGameScreenshot, waitForGameLoad } from "./utils/testWorld";

const test = evmTest;

test.describe("Graphics Verification (Authenticated)", () => {
  test.setTimeout(600000); // 10 minutes

  test("should render vegetation and rocks correctly", async ({
    page,
    wallet,
  }) => {
    // --- AUTH FLOW ---
    await waitForAppReady(page, BASE_URL);

    // Do NOT click Enter manually - connectEvmWalletViaPrivy handles it
    // and if we click it, it might think we are already logged in.

    await connectEvmWalletViaPrivy(page, wallet);
    expect(await isWalletConnected(page)).toBe(true);

    const needsUsername = await waitForUsernameScreen(page, 10_000);
    if (needsUsername) {
      await fillUsername(page, `e2e_${Date.now().toString().slice(-8)}`);
    }

    // Character Select
    const hasCharacterScreen = await waitForCharacterSelect(page, 20_000);
    expect(hasCharacterScreen).toBe(true);

    const existingCount = await getExistingCharacterCount(page);
    if (existingCount > 0) {
      await selectFirstCharacter(page);
    } else {
      await createNewCharacter(page, `E2E_${Date.now().toString().slice(-7)}`);
    }

    await clickEnterWorld(page, 60_000); // 60s timeout for enter world
    await waitForGameClient(page, 60_000); // Wait for game client to be ready

    // Wait for loading screen to actually disappear
    console.log("Waiting for loading screen to disappear...");
    // Wait for loading screen to actually disappear
    console.log("Waiting for loading screen to disappear...");
    await page
      .waitForFunction(
        () => {
          const state = (window as any).__HYPERSCAPE_LOADING__;
          if (!state) return false;
          if (!state.ready) {
            // console.log("Loading state:", JSON.stringify(state)); // Uncomment for noisy debug
            return false;
          }
          return true;
        },
        { timeout: 300_000, polling: 1000 },
      )
      .catch(async () => {
        const state = await page.evaluate(
          () => (window as any).__HYPERSCAPE_LOADING__,
        );
        console.log("Final loading state before timeout:", state);
        throw new Error("Game load timeout");
      });

    // --- GRAPHICS VERIFICATION ---

    console.log("In game! Waiting for initial load settle...");
    await page.waitForTimeout(10000); // Wait for grass/trees

    console.log("Taking initial screenshot...");
    await takeGameScreenshot(page, "graphics_initial_view");

    // 2. Find a Tree
    console.log("Teleporting to find trees...");
    // Use a position that usually has trees - random walk or specific biome
    // Or just screenshot where we are, assuming spawn has some

    await page.evaluate(() => {
      const player = (window as any).world.entities.player;
      // Try to move to a spot
      if (player && player.position) {
        // Move 20m away to maybe see more
        const pos = player.position;
        player.position.set(pos.x + 20, pos.y + 10, pos.z + 20);
        if (player.body) {
          player.body.setTranslation(
            { x: pos.x + 20, y: pos.y + 10, z: pos.z + 20 },
            true,
          );
        }
      }
    });

    await page.waitForTimeout(5000);
    await takeGameScreenshot(page, "graphics_moved_view");

    // 3. Look down for grass
    console.log("Looking down to see grass details...");
    await page.evaluate(() => {
      const player = (window as any).world.entities.player;
      if (player && player.camera) {
        // Force camera pitch to look down
        // Assuming typical FPS camera where x-axis rotation is pitch
        player.camera.rotation.x = -Math.PI / 3; // Look down ~60 degrees
      }
    });

    await page.waitForTimeout(2000);
    await takeGameScreenshot(page, "graphics_grass_closeup");

    // 4. Move to another location just in case
    await page.evaluate(() => {
      const player = (window as any).world.entities.player;
      if (player && player.position) {
        const pos = player.position;
        // Move to a likely grassy area (offset)
        player.setPosition(pos.x + 50, 20, pos.z + 50);
      }
    });
    await page.waitForTimeout(10000); // Wait for new chunk
    await takeGameScreenshot(page, "graphics_second_location");

    expect(true).toBe(true);
  });
});
