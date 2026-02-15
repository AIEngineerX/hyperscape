/**
 * Bank Tab Handler Integration Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/database/schema";
import {
  handleBankCreateTab,
  handleBankDeleteTab,
} from "../../../src/systems/ServerNetwork/handlers/bank";
import { rateLimiter } from "../../../src/systems/ServerNetwork/handlers/bank/utils";
import { seedBankStorage, setupBankTestEnv } from "./helpers";

// Skipped: pg-mem + Drizzle ORM 0.44+ compatibility
describe.skip("Bank tab handlers (integration)", () => {
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

  it("creates a new tab and moves the item", async () => {
    await seedBankStorage(db.db, playerId, [
      { itemId: "logs", quantity: 1, slot: 0, tabIndex: 0 },
    ]);

    await handleBankCreateTab(
      socket as never,
      { fromSlot: 0, fromTabIndex: 0, newTabIndex: 1 },
      world as never,
    );

    const tabs = await db.db
      .select()
      .from(schema.bankTabs)
      .where(eq(schema.bankTabs.playerId, playerId));
    const bankRows = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(tabs.find((tab) => tab.tabIndex === 1)).toBeDefined();
    expect(bankRows.find((row) => row.itemId === "logs")?.tabIndex).toBe(1);
  });

  it("deletes a tab and keeps items in main tab", async () => {
    await seedBankStorage(db.db, playerId, [
      { itemId: "logs", quantity: 1, slot: 0, tabIndex: 1 },
    ]);
    await db.db.insert(schema.bankTabs).values({
      playerId,
      tabIndex: 1,
      iconItemId: "logs",
      createdAt: Date.now(),
    });

    await handleBankDeleteTab(socket as never, { tabIndex: 1 }, world as never);

    const tabs = await db.db
      .select()
      .from(schema.bankTabs)
      .where(eq(schema.bankTabs.playerId, playerId));
    const bankRows = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(tabs.find((tab) => tab.tabIndex === 1)).toBeUndefined();
    expect(bankRows.find((row) => row.itemId === "logs")?.tabIndex).toBe(0);
  });
});
