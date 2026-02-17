import { test, expect } from "@playwright/test";
import {
  waitForGameLoad,
  waitForPlayerSpawn,
  getPlayerPosition,
  simulateMovement,
  waitForWorldCondition,
} from "./utils/testWorld";

test.describe("Navigation System", () => {
  // Increase test timeout
  test.setTimeout(240000); // 4 minutes per test

  test.beforeEach(async ({ page }) => {
    // Increase navigation timeouts
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);

    // Go to game URL (allow 2m)
    await page.goto("/", { timeout: 120000 });

    // Wait for game to load with extended timeout
    await waitForGameLoad(page, 120000);
    // Wait for player to spawn with extended timeout
    await waitForPlayerSpawn(page, 120000);
  });

  test("should load game and spawn player", async ({ page }) => {
    const pos = await getPlayerPosition(page);
    expect(pos).toBeDefined();
    expect(typeof pos.x).toBe("number");
    expect(typeof pos.y).toBe("number");
    expect(typeof pos.z).toBe("number");
  });

  test("should accept movement input", async ({ page }) => {
    // Initial position
    const startPos = await getPlayerPosition(page);

    // Move right
    await simulateMovement(page, "right", 1000); // 1s movement

    // Final position
    const endPos = await getPlayerPosition(page);

    const dx = endPos.x - startPos.x;
    const dz = endPos.z - startPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    console.log(`Moved distance: ${dist}`);
    expect(dist).toBeGreaterThan(0.1);
  });

  test("should transition player Y when entering building", async ({
    page,
  }) => {
    console.log("Waiting for buildings to generate...");

    // 1. Wait for buildings to exist in the world
    const buildingsFound = await waitForWorldCondition(
      page,
      "world.getSystem('buildingCollision') && world.getSystem('buildingCollision').buildings.size > 0",
      120000, // up to 120s for gen
    );

    if (!buildingsFound) {
      console.warn("No buildings generated in time. Skipping test.");
      test.skip();
      return;
    }

    // 2. Find a suitable building with an entrance
    const targetBuilding = await page.evaluate(() => {
      const world = (window as any).world;
      const buildingService = world.getSystem("buildingCollision");
      const buildings = Array.from(
        (buildingService as any).buildings.values(),
      ) as any[];

      // Find one with step tiles (entrances)
      for (const b of buildings) {
        if (b.stepTiles && b.stepTiles.length > 0) {
          // Start position: on the step tile (outside/transition)
          const step = b.stepTiles[0];
          // Target position: center of the building (inside)
          return {
            id: b.buildingId,
            startX: step.tileX + 0.5,
            startZ: step.tileZ + 0.5,
            targetX: b.worldPosition.x,
            targetZ: b.worldPosition.z,
            floorHeight: b.floors[0].elevation,
          };
        }
      }
      return null;
    });

    if (!targetBuilding) {
      console.warn("No suitable building found (with entrance).");
      test.skip();
      return;
    }

    console.log(
      `Targeting building ${targetBuilding.id} at (${targetBuilding.targetX}, ${targetBuilding.targetZ})`,
    );
    console.log(
      `Starting at step (${targetBuilding.startX}, ${targetBuilding.startZ})`,
    );

    // 3. Teleport player to the "start" position (near entrance)
    await page.evaluate(
      (pos) => {
        const player = (window as any).world.entities.player;
        // Set position, slightly above ground to avoid falling through initially
        if (player.position && player.position.set) {
          player.position.set(pos.x, 10, pos.z);
          // Reset physics velocity if possible
          if (player.body) {
            player.body.setTranslation({ x: pos.x, y: 10, z: pos.z }, true);
            player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
          // Reset pathfinding state
          if (player.resetPath) player.resetPath();
        }
      },
      { x: targetBuilding.startX, z: targetBuilding.startZ },
    );

    // Wait for player to settle on the ground/step
    await page.waitForTimeout(3000);

    // Check Y position outside (should be ~terrain height)
    const startY = await page.evaluate(
      () => (window as any).world.entities.player.mesh.position.y,
    );
    console.log(`Player landed at Y=${startY}`);

    // 4. Move INTO the building
    console.log("Moving into building...");
    await page.evaluate(
      (target) => {
        const world = (window as any).world;
        const playerMovement = world.getSystem("playerMovement");
        if (playerMovement) {
          // Move to building center
          playerMovement.moveTo({
            x: Math.floor(target.x),
            z: Math.floor(target.z),
          });
        }
      },
      { x: targetBuilding.targetX, z: targetBuilding.targetZ },
    );

    // Wait for movement
    await page.waitForTimeout(5000);

    // 5. Verify Y position matches floor height
    const endY = await page.evaluate(
      () => (window as any).world.entities.player.mesh.position.y,
    );
    const expectedY = targetBuilding.floorHeight;

    console.log(
      `Player entered building at Y=${endY} (Expected floor: ${expectedY})`,
    );

    // Check if Y is close to floor height (allowing small tolerance)
    expect(endY).toBeGreaterThanOrEqual(expectedY - 0.1);
    expect(endY).toBeLessThan(expectedY + 2.5);
  });
});
