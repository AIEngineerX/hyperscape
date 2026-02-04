/**
 * Bank Coins Handler Integration Tests
 *
 * Exercises real handler logic with an in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/database/schema";
import {
  handleBankDepositCoins,
  handleBankWithdrawCoins,
} from "../../../src/systems/ServerNetwork/handlers/bank";
import { rateLimiter } from "../../../src/systems/ServerNetwork/handlers/bank/utils";
import {
  createTestDatabase,
  createTestPlayer,
  createTestSocket,
  createTestWorld,
  seedBankStorage,
  seedCharacter,
  type TestDatabase,
  type TestSocket,
  type TestWorld,
} from "./helpers";

describe("Bank coin handlers (integration)", () => {
  let db: TestDatabase;
  let world: TestWorld;
  let socket: TestSocket;
  const playerId = "player-test-123";

  beforeEach(async () => {
    db = createTestDatabase();
    await seedCharacter(db.db, playerId, 0);
    world = createTestWorld(db, {}, [], playerId, "bank-entity-1");
    socket = createTestSocket();
    socket.player = createTestPlayer({ id: playerId });
    rateLimiter.reset(playerId);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it("rejects invalid deposit amount", async () => {
    await handleBankDepositCoins(
      socket as never,
      { amount: -10 },
      world as never,
    );

    const toast = socket.sent.find((msg) => msg.packet === "showToast");
    expect(toast?.data).toEqual({ message: "Invalid amount", type: "error" });
  });

  it("deposits coins into bank storage", async () => {
    await db.db
      .update(schema.characters)
      .set({ coins: 2000 })
      .where(eq(schema.characters.id, playerId));

    await handleBankDepositCoins(
      socket as never,
      { amount: 500 },
      world as never,
    );

    const [character] = await db.db
      .select({ coins: schema.characters.coins })
      .from(schema.characters)
      .where(eq(schema.characters.id, playerId));

    const [bankCoins] = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(character?.coins).toBe(1500);
    expect(bankCoins?.itemId).toBe("coins");
    expect(bankCoins?.quantity).toBe(500);
  });

  it("rejects invalid withdraw amount", async () => {
    await handleBankWithdrawCoins(
      socket as never,
      { amount: 0 },
      world as never,
    );

    const toast = socket.sent.find((msg) => msg.packet === "showToast");
    expect(toast?.data).toEqual({ message: "Invalid amount", type: "error" });
  });

  it("withdraws coins from bank storage", async () => {
    await db.db
      .update(schema.characters)
      .set({ coins: 100 })
      .where(eq(schema.characters.id, playerId));
    await seedBankStorage(db.db, playerId, [
      { itemId: "coins", quantity: 1000, slot: 0, tabIndex: 0 },
    ]);

    await handleBankWithdrawCoins(
      socket as never,
      { amount: 400 },
      world as never,
    );

    const [character] = await db.db
      .select({ coins: schema.characters.coins })
      .from(schema.characters)
      .where(eq(schema.characters.id, playerId));

    const [bankCoins] = await db.db
      .select()
      .from(schema.bankStorage)
      .where(eq(schema.bankStorage.playerId, playerId));

    expect(character?.coins).toBe(500);
    expect(bankCoins?.quantity).toBe(600);
  });
});
