/**
 * Bank Move Handler Integration Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/database/schema";
import { handleBankMoveToTab } from "../../../src/systems/ServerNetwork/handlers/bank";
import { rateLimiter } from "../../../src/systems/ServerNetwork/handlers/bank/utils";
import { seedBankStorage, seedBankTabs, setupBankTestEnv } from "./helpers";

// Skipped: pg-mem + Drizzle ORM 0.44+ compatibility
describe.skip("Bank move handlers (integration)", () => {
  let cleanup: () => Promise<void>;
  let world: Awaited<ReturnType<typeof setupBankTestEnv>>["world"];
  let socket: Awaited<ReturnType<typeof setupBankTestEnv>>["socket"];
  let db: Awaited<ReturnType<typeof setupBankTestEnv>>["db"];
  let playerId: string;

  beforeEach(async () => {
    const env = await setupBankTestEnv();
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

  it("moves an item to another tab", async () => {
    await seedBankStorage(db.db, playerId, [
      { itemId: "logs", quantity: 1, slot: 0, tabIndex: 0 },
    ]);
    await seedBankTabs(db.db, playerId, [{ tabIndex: 1, iconItemId: null }]);

    await handleBankMoveToTab(
      socket as never,
      { fromSlot: 0, fromTabIndex: 0, toTabIndex: 1 },
      world as never,
    );

    const [row] = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(row?.tabIndex).toBe(1);
  });
});
