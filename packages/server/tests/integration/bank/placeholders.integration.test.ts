/**
 * Bank Placeholder Handler Integration Tests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/database/schema";
import { handleBankToggleAlwaysPlaceholder } from "../../../src/systems/ServerNetwork/handlers/bank";
import { setupBankTestEnv } from "./helpers";

// Skipped: pg-mem + Drizzle ORM 0.44+ compatibility
describe.skip("Bank placeholder handlers (integration)", () => {
  let cleanup: () => Promise<void>;
  let world: Awaited<ReturnType<typeof setupBankTestEnv>>["world"];
  let socket: Awaited<ReturnType<typeof setupBankTestEnv>>["socket"];
  let db: Awaited<ReturnType<typeof setupBankTestEnv>>["db"];
  let playerId: string;

  beforeEach(async () => {
    const env = await setupBankTestEnv({ alwaysSetPlaceholder: 0 });
    cleanup = env.cleanup;
    world = env.world;
    socket = env.socket;
    db = env.db;
    playerId = env.playerId;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("toggles always-set-placeholder setting", async () => {
    await handleBankToggleAlwaysPlaceholder(
      socket as never,
      {},
      world as never,
    );

    const [rowAfterFirst] = await db.db
      .select({ alwaysSetPlaceholder: schema.characters.alwaysSetPlaceholder })
      .from(schema.characters)
      .where(eq(schema.characters.id, playerId));
    expect(rowAfterFirst?.alwaysSetPlaceholder).toBe(1);

    await handleBankToggleAlwaysPlaceholder(
      socket as never,
      {},
      world as never,
    );

    const [rowAfterSecond] = await db.db
      .select({ alwaysSetPlaceholder: schema.characters.alwaysSetPlaceholder })
      .from(schema.characters)
      .where(eq(schema.characters.id, playerId));
    expect(rowAfterSecond?.alwaysSetPlaceholder).toBe(0);
  });
});
