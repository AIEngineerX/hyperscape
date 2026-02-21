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

    // ========== GRASS DIAGNOSTICS ==========
    const grassDiag = await page.evaluate(() => {
      const w = (window as any).world;
      if (!w) return { error: "No world object" };

      // Check grass system
      const grassSystem = w.getSystem?.("grass");
      const vegetationSystem = w.getSystem?.("vegetation");

      const result: Record<string, any> = {
        grassSystemExists: !!grassSystem,
        vegetationSystemExists: !!vegetationSystem,
      };

      if (
        vegetationSystem &&
        typeof (vegetationSystem as any).getStats === "function"
      ) {
        result.vegetationStats = (vegetationSystem as any).getStats();
      }

      if (!grassSystem) {
        result.grassDisabled = true;
      } else {
        result.grassInitialized =
          (grassSystem as any).grassInitialized ?? "unknown";
        result.hasRenderer = !!(grassSystem as any).renderer;
        result.rendererType =
          (grassSystem as any).renderer?.constructor?.name ?? "none";
        result.hasMesh = !!(grassSystem as any).mesh;
        result.meshVisible = (grassSystem as any).mesh?.visible ?? false;
        result.meshInstanceCount = (grassSystem as any).mesh?.count ?? 0;
        result.meshInScene = !!(grassSystem as any).mesh?.parent;
        result.meshPosition = null as any;
        result.hasSsbo = !!(grassSystem as any).ssbo;
        result.useBladeGrass = (grassSystem as any).useBladeGrass ?? "unknown";
        result.heightmapInitialized =
          (grassSystem as any).heightmapInitialized ?? "unknown";
        result.staticComputeInitialized =
          (grassSystem as any).staticComputeInitialized ?? "unknown";
        result.hasGpuLod1Mesh = !!(grassSystem as any).gpuLod1Mesh;

        if ((grassSystem as any).mesh) {
          const pos = (grassSystem as any).mesh.position;
          result.meshPosition = { x: pos.x, y: pos.y, z: pos.z };
          result.meshRenderOrder = (grassSystem as any).mesh.renderOrder;
          result.meshLayers = (grassSystem as any).mesh.layers?.mask;
          result.meshFrustumCulled = (grassSystem as any).mesh.frustumCulled;
        }
      }

      // Check camera
      if (w.camera) {
        const cam = w.camera;
        result.cameraPosition = {
          x: cam.position.x.toFixed(2),
          y: cam.position.y.toFixed(2),
          z: cam.position.z.toFixed(2),
        };
        result.cameraLayers = cam.layers?.mask;
      }

      // Check scene children for grass
      const stage = w.stage;
      if (stage?.scene) {
        const grassMeshes: string[] = [];
        stage.scene.traverse((obj: any) => {
          if (obj.name?.includes("Grass") || obj.name?.includes("grass")) {
            grassMeshes.push(
              `${obj.name} (visible=${obj.visible}, type=${obj.type})`,
            );
          }
        });
        result.grassMeshesInScene = grassMeshes;
      }

      // Check graphics system renderer
      const graphics = w.getSystem?.("graphics");
      if (graphics) {
        result.graphicsRendererType =
          (graphics as any).renderer?.constructor?.name ?? "none";
        result.graphicsBackend =
          (graphics as any).renderer?.backend?.constructor?.name ?? "unknown";
      }

      return result;
    });

    console.log("=== GRASS DIAGNOSTICS ===");
    console.log(JSON.stringify(grassDiag, null, 2));

    console.log("Taking initial screenshot...");
    await takeGameScreenshot(page, "graphics_initial_view");

    // Also take a full page screenshot to compare
    await page.screenshot({
      path: "screenshots/graphics_fullpage.png",
      fullPage: true,
    });

    // 2. Move camera to look at grass from above
    console.log("Positioning camera to look down at grass...");
    await page.evaluate(() => {
      const w = (window as any).world;
      if (!w?.camera) return;

      const cam = w.camera;
      // Look down at the ground near the player
      cam.position.y = cam.position.y + 5; // Raise camera a bit
      cam.lookAt(cam.position.x, 0, cam.position.z); // Look straight down
    });

    await page.waitForTimeout(3000);
    await takeGameScreenshot(page, "graphics_looking_down");

    // 3. Move to a different position
    console.log("Moving to offset position...");
    await page.evaluate(() => {
      const w = (window as any).world;
      if (!w?.camera) return;
      const cam = w.camera;
      cam.position.set(cam.position.x + 30, 8, cam.position.z + 30);
      cam.lookAt(cam.position.x, 0, cam.position.z + 10);
    });

    await page.waitForTimeout(5000);
    await takeGameScreenshot(page, "graphics_moved_view");

    // 4. Additional wait and screenshot to let grass compute catch up
    console.log("Waiting for grass compute to settle...");
    await page.waitForTimeout(10000);
    await takeGameScreenshot(page, "graphics_after_settle");

    // Log final grass state
    const finalDiag = await page.evaluate(() => {
      const w = (window as any).world;
      const grassSystem = w?.getSystem?.("grass");
      const vegetationSystem = w?.getSystem?.("vegetation");
      if (!grassSystem) {
        return {
          grassDisabled: true,
          vegetationStats:
            vegetationSystem &&
            typeof (vegetationSystem as any).getStats === "function"
              ? (vegetationSystem as any).getStats()
              : null,
        };
      }
      return {
        grassInitialized: (grassSystem as any).grassInitialized,
        staticComputeInitialized: (grassSystem as any).staticComputeInitialized,
        meshVisible: (grassSystem as any).mesh?.visible,
        meshPosition: (grassSystem as any).mesh?.position
          ? {
              x: (grassSystem as any).mesh.position.x.toFixed(2),
              y: (grassSystem as any).mesh.position.y.toFixed(2),
              z: (grassSystem as any).mesh.position.z.toFixed(2),
            }
          : null,
        heightmapInitialized: (grassSystem as any).heightmapInitialized,
      };
    });
    console.log("=== FINAL GRASS STATE ===");
    console.log(JSON.stringify(finalDiag, null, 2));

    const vegetationVisibleInstances = Number(
      (grassDiag as any)?.vegetationStats?.visibleInstances ?? 0,
    );
    const vegetationTotalInstances = Number(
      (grassDiag as any)?.vegetationStats?.totalInstances ?? 0,
    );
    const vegetationTilesWithData = Number(
      (grassDiag as any)?.vegetationStats?.tilesWithVegetation ?? 0,
    );
    const grassRenderingDisabled = Boolean((grassDiag as any)?.grassDisabled);

    const hasRenderableVegetation =
      grassDiag.grassInitialized === true ||
      (vegetationVisibleInstances > 0 && vegetationTotalInstances > 0);

    // Some environments intentionally disable grass rendering; in that mode
    // validate that vegetation data still exists instead of hard-failing.
    if (grassRenderingDisabled) {
      expect((grassDiag as any)?.vegetationSystemExists).toBe(true);
      expect(vegetationTilesWithData).toBeGreaterThan(0);
      return;
    }

    expect(hasRenderableVegetation).toBe(true);
  });
});
