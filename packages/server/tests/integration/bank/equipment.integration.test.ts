/**
 * Bank Equipment Handler Integration Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/database/schema";
import { handleBankDepositAllEquipment } from "../../../src/systems/ServerNetwork/handlers/bank";
import { rateLimiter } from "../../../src/systems/ServerNetwork/handlers/bank/utils";
import { createTestEquipmentSystem, setupBankTestEnv } from "./helpers";

describe("Bank equipment handlers (integration)", () => {
  let cleanup: () => Promise<void>;
  let world: Awaited<ReturnType<typeof setupBankTestEnv>>["world"];
  let socket: Awaited<ReturnType<typeof setupBankTestEnv>>["socket"];
  let db: Awaited<ReturnType<typeof setupBankTestEnv>>["db"];
  let playerId: string;

  beforeEach(async () => {
    const env = await setupBankTestEnv({
      systems: {
        equipment: createTestEquipmentSystem({
          getAllEquippedItems: () => [
            { slot: "weapon", itemId: "bronze_sword" },
          ],
          unequipItemDirect: async () => ({
            success: true,
            itemId: "bronze_sword",
            quantity: 1,
          }),
        }),
      },
    });
    cleanup = env.cleanup;
    world = env.world;
    socket = env.socket;
    db = env.db;
    playerId = env.playerId;
    rateLimiter.reset(playerId);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("deposits equipped items into the bank", async () => {
    await handleBankDepositAllEquipment(socket as never, {}, world as never);

    const [row] = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(row?.itemId).toBe("bronze_sword");
    expect(row?.quantity).toBe(1);
  });
});
