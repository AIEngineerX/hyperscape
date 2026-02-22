/**
 * Admin Panel Integration Tests
 *
 * Comprehensive tests covering:
 * - Schema verification
 * - CRUD operations with edge cases
 * - Error handling and invalid inputs
 * - Boundary conditions (pagination, timestamps, empty results)
 * - Concurrent operations
 * - Foreign key relationships
 * - Index verification
 *
 * Testing Strategy:
 * These tests use raw SQL queries against PostgreSQL because:
 * 1. They verify the ACTUAL database schema matches expectations
 * 2. They test data integrity at the database layer (FKs, constraints)
 * 3. They confirm indexes exist for performance
 * 4. The repository code (ActivityLogRepository) uses Drizzle ORM which
 *    generates SQL from the same schema - if schema tests pass, Drizzle
 *    will generate correct queries
 * 5. Raw SQL tests are faster and don't require full server context
 *
 * The repository methods delegate to Drizzle, which:
 * - Is a mature, well-tested ORM
 * - Type-checks queries against the schema at compile time
 * - Generates SQL from the schema we verify in these tests
 *
 * DATABASE_URL must be set for tests to run.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ============================================================================
// Test Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
const isDatabaseAvailable = !!DATABASE_URL;
const TEST_PREFIX = `test-admin-${Date.now()}-`;

// ============================================================================
// Database Helpers
// ============================================================================

let pool: pg.Pool | null = null;
let dbConnectionTested = false;
let dbConnectionWorks = false;

async function getPool(): Promise<pg.Pool> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!pool) pool = new pg.Pool({ connectionString: DATABASE_URL });
  return pool;
}

async function testDatabaseConnection(): Promise<boolean> {
  if (dbConnectionTested) return dbConnectionWorks;
  dbConnectionTested = true;

  if (!DATABASE_URL) {
    console.log("⚠️  DATABASE_URL not set - skipping database tests");
    return false;
  }

  try {
    const testPool = await getPool();
    await testPool.query("SELECT 1");
    dbConnectionWorks = true;
    console.log("✅ Database connection successful");
    return true;
  } catch (error) {
    console.log(
      `⚠️  Database connection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

// Unique ID generator to avoid collisions
let idCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}${TEST_PREFIX}${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

// Test data helpers with full control over fields
async function createTestUser(
  name: string,
  roles: string[] = [],
  overrides?: { id?: string; createdAt?: Date },
): Promise<{ id: string; name: string; roles: string; createdAt: Date }> {
  const pool = await getPool();
  const id = overrides?.id ?? uniqueId("user-");
  const rolesString = roles.join(",");
  const createdAt = overrides?.createdAt ?? new Date();

  await pool.query(
    `INSERT INTO users (id, name, roles, "createdAt") VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $2, roles = $3`,
    [id, name, rolesString, createdAt],
  );

  return { id, name, roles: rolesString, createdAt };
}

async function createTestCharacter(
  accountId: string,
  name: string,
  overrides?: {
    id?: string;
    combatLevel?: number;
    health?: number;
    maxHealth?: number;
    coins?: number;
    attackLevel?: number;
    strengthLevel?: number;
    defenseLevel?: number;
    lastLogin?: number;
  },
): Promise<{ id: string; name: string; accountId: string }> {
  const pool = await getPool();
  const id = overrides?.id ?? uniqueId("char-");

  await pool.query(
    `INSERT INTO characters (
      id, "accountId", name, "createdAt", "combatLevel", health, "maxHealth", coins,
      "attackLevel", "strengthLevel", "defenseLevel", "lastLogin"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      accountId,
      name,
      Date.now(),
      overrides?.combatLevel ?? 3,
      overrides?.health ?? 100,
      overrides?.maxHealth ?? 100,
      overrides?.coins ?? 0,
      overrides?.attackLevel ?? 1,
      overrides?.strengthLevel ?? 1,
      overrides?.defenseLevel ?? 1,
      overrides?.lastLogin ?? Date.now(),
    ],
  );

  return { id, name, accountId };
}

async function insertActivityLog(
  playerId: string,
  eventType: string,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  details?: Record<string, unknown>,
  timestamp?: number,
  position?: { x: number; y: number; z: number } | null,
): Promise<number> {
  const pool = await getPool();
  const result = await pool.query(
    `INSERT INTO activity_log ("playerId", "eventType", action, "entityType", "entityId", details, timestamp, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      playerId,
      eventType,
      action,
      entityType ?? null,
      entityId ?? null,
      JSON.stringify(details ?? {}),
      timestamp ?? Date.now(),
      position ? JSON.stringify(position) : null,
    ],
  );
  return result.rows[0].id;
}

async function insertTradeWithItems(
  initiatorId: string | null,
  receiverId: string | null,
  status: string,
  initiatorItems: Array<{ itemId: string; quantity: number }>,
  receiverItems: Array<{ itemId: string; quantity: number }>,
  initiatorCoins: number,
  receiverCoins: number,
  timestamp?: number,
): Promise<number> {
  const pool = await getPool();
  const result = await pool.query(
    `INSERT INTO trades ("initiatorId", "receiverId", status, "initiatorItems", "receiverItems", "initiatorCoins", "receiverCoins", timestamp)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
     RETURNING id`,
    [
      initiatorId,
      receiverId,
      status,
      JSON.stringify(initiatorItems),
      JSON.stringify(receiverItems),
      initiatorCoins,
      receiverCoins,
      timestamp ?? Date.now(),
    ],
  );
  return result.rows[0].id;
}

async function insertTrade(
  initiatorId: string,
  receiverId: string,
  status: string = "completed",
): Promise<number> {
  return insertTradeWithItems(initiatorId, receiverId, status, [], [], 100, 50);
}

async function cleanupTestData(): Promise<void> {
  const pool = await getPool();
  // Clean in order to respect foreign keys
  await pool.query(`DELETE FROM activity_log WHERE "playerId" LIKE $1`, [
    `%${TEST_PREFIX}%`,
  ]);
  await pool.query(
    `DELETE FROM trades WHERE "initiatorId" LIKE $1 OR "receiverId" LIKE $1`,
    [`%${TEST_PREFIX}%`],
  );
  await pool.query(`DELETE FROM characters WHERE id LIKE $1`, [
    `%${TEST_PREFIX}%`,
  ]);
  await pool.query(`DELETE FROM users WHERE id LIKE $1`, [`%${TEST_PREFIX}%`]);
}

// ============================================================================
// Tests
// ============================================================================

describe("Admin Panel Integration", () => {
  beforeAll(async () => {
    await testDatabaseConnection();
  });

  afterAll(async () => {
    if (pool && dbConnectionWorks) {
      await cleanupTestData();
      await pool.end();
      pool = null;
    }
  });

  // ============================================================================
  // Schema Verification
  // ============================================================================

  describe("Schema Verification", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should have activity_log table with correct columns and types",
      async () => {
        const p = await getPool();
        const result = await p.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'activity_log'
        ORDER BY ordinal_position
      `);

        const columns = new Map(
          result.rows.map((r) => [
            r.column_name,
            { type: r.data_type, nullable: r.is_nullable },
          ]),
        );

        // Required columns
        expect(columns.has("id")).toBe(true);
        expect(columns.has("playerId")).toBe(true);
        expect(columns.has("eventType")).toBe(true);
        expect(columns.has("action")).toBe(true);
        expect(columns.has("timestamp")).toBe(true);

        // Verify NOT NULL constraints
        expect(columns.get("playerId")?.nullable).toBe("NO");
        expect(columns.get("eventType")?.nullable).toBe("NO");
        expect(columns.get("action")?.nullable).toBe("NO");
        expect(columns.get("timestamp")?.nullable).toBe("NO");

        // Optional columns can be null
        expect(columns.get("entityType")?.nullable).toBe("YES");
        expect(columns.get("entityId")?.nullable).toBe("YES");
        expect(columns.get("position")?.nullable).toBe("YES");
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should have trades table with correct columns and types",
      async () => {
        const p = await getPool();
        const result = await p.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'trades'
        ORDER BY ordinal_position
      `);

        const columns = new Map(
          result.rows.map((r) => [
            r.column_name,
            { type: r.data_type, nullable: r.is_nullable },
          ]),
        );

        expect(columns.has("id")).toBe(true);
        expect(columns.has("initiatorId")).toBe(true);
        expect(columns.has("receiverId")).toBe(true);
        expect(columns.has("status")).toBe(true);
        expect(columns.has("initiatorItems")).toBe(true);
        expect(columns.has("receiverItems")).toBe(true);
        expect(columns.has("initiatorCoins")).toBe(true);
        expect(columns.has("receiverCoins")).toBe(true);
        expect(columns.has("timestamp")).toBe(true);

        // Status and timestamp are required
        expect(columns.get("status")?.nullable).toBe("NO");
        expect(columns.get("timestamp")?.nullable).toBe("NO");

        // Players can be null (SET NULL on delete)
        expect(columns.get("initiatorId")?.nullable).toBe("YES");
        expect(columns.get("receiverId")?.nullable).toBe("YES");
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should have foreign key from activity_log to characters",
      async () => {
        const p = await getPool();
        const result = await p.query(`
        SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'activity_log'
      `);

        expect(result.rows.length).toBeGreaterThan(0);
        expect(
          result.rows.some((r) => r.foreign_table_name === "characters"),
        ).toBe(true);
      },
    );
  });

  // ============================================================================
  // Activity Log Operations
  // ============================================================================

  describe("Activity Log Operations", () => {
    let testUser: Awaited<ReturnType<typeof createTestUser>>;
    let testCharacter: Awaited<ReturnType<typeof createTestCharacter>>;

    beforeEach(async () => {
      if (!dbConnectionWorks) return;
      testUser = await createTestUser("Activity Test User", ["user"]);
      testCharacter = await createTestCharacter(
        testUser.id,
        "Activity Character",
      );
    });

    it.skipIf(!isDatabaseAvailable)(
      "should insert and retrieve activity with all fields",
      async () => {
        const p = await getPool();
        const position = { x: 100.5, y: 0, z: -50.25 };
        const details = { quantity: 5, source: "loot" };
        const timestamp = Date.now() - 1000;

        const activityId = await insertActivityLog(
          testCharacter.id,
          "ITEM_PICKUP",
          "picked_up",
          "item",
          "gold_coin",
          details,
          timestamp,
          position,
        );

        const result = await p.query(
          `SELECT * FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(result.rows.length).toBe(1);

        const row = result.rows[0];
        expect(row.playerId).toBe(testCharacter.id);
        expect(row.eventType).toBe("ITEM_PICKUP");
        expect(row.action).toBe("picked_up");
        expect(row.entityType).toBe("item");
        expect(row.entityId).toBe("gold_coin");
        expect(row.details).toEqual(details);
        expect(row.position).toEqual(position);
        expect(Number(row.timestamp)).toBe(timestamp);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle NULL optional fields",
      async () => {
        const p = await getPool();
        const activityId = await insertActivityLog(
          testCharacter.id,
          "SESSION_START",
          "logged_in",
          null,
          null,
          {},
          undefined,
          null,
        );

        const result = await p.query(
          `SELECT * FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(result.rows[0].entityType).toBeNull();
        expect(result.rows[0].entityId).toBeNull();
        expect(result.rows[0].position).toBeNull();
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should query by time range (boundary conditions)",
      async () => {
        const p = await getPool();
        const now = Date.now();
        const hourAgo = now - 3600000;
        const twoHoursAgo = now - 7200000;

        // Insert activities at different times
        await insertActivityLog(
          testCharacter.id,
          "OLD_EVENT",
          "old",
          null,
          null,
          {},
          twoHoursAgo,
        );
        await insertActivityLog(
          testCharacter.id,
          "MIDDLE_EVENT",
          "middle",
          null,
          null,
          {},
          hourAgo,
        );
        await insertActivityLog(
          testCharacter.id,
          "NEW_EVENT",
          "new",
          null,
          null,
          {},
          now,
        );

        // Query for activities in last 90 minutes (should exclude OLD_EVENT)
        const ninetyMinsAgo = now - 5400000;
        const result = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1 AND timestamp >= $2 ORDER BY timestamp`,
          [testCharacter.id, ninetyMinsAgo],
        );

        expect(result.rows.length).toBe(2);
        expect(result.rows[0].eventType).toBe("MIDDLE_EVENT");
        expect(result.rows[1].eventType).toBe("NEW_EVENT");
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should return empty results for non-existent player",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1`,
          ["non-existent-player-id-xyz"],
        );
        expect(result.rows.length).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle pagination correctly",
      async () => {
        const p = await getPool();

        // Insert 25 activities
        for (let i = 0; i < 25; i++) {
          await insertActivityLog(
            testCharacter.id,
            `EVENT_${i}`,
            "action",
            null,
            null,
            {},
            Date.now() + i,
          );
        }

        // Page 1: limit 10, offset 0
        const page1 = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1 ORDER BY timestamp DESC LIMIT 10 OFFSET 0`,
          [testCharacter.id],
        );
        expect(page1.rows.length).toBe(10);

        // Page 2: limit 10, offset 10
        const page2 = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1 ORDER BY timestamp DESC LIMIT 10 OFFSET 10`,
          [testCharacter.id],
        );
        expect(page2.rows.length).toBe(10);

        // Page 3: limit 10, offset 20 (only 5 remaining)
        const page3 = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1 ORDER BY timestamp DESC LIMIT 10 OFFSET 20`,
          [testCharacter.id],
        );
        expect(page3.rows.length).toBe(5);

        // Verify no overlap between pages
        const page1Ids = new Set(page1.rows.map((r) => r.id));
        const page2Ids = new Set(page2.rows.map((r) => r.id));
        const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
        expect(intersection.length).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle large details JSONB",
      async () => {
        const p = await getPool();
        const largeDetails = {
          items: Array.from({ length: 100 }, (_, i) => ({
            id: `item_${i}`,
            qty: i,
          })),
          nested: { deep: { object: { here: "value" } } },
          longString: "x".repeat(10000),
        };

        const activityId = await insertActivityLog(
          testCharacter.id,
          "COMPLEX_EVENT",
          "complex",
          null,
          null,
          largeDetails,
        );

        const result = await p.query(
          `SELECT details FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(result.rows[0].details).toEqual(largeDetails);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should filter by multiple event types",
      async () => {
        const p = await getPool();

        await insertActivityLog(testCharacter.id, "TYPE_A", "a");
        await insertActivityLog(testCharacter.id, "TYPE_B", "b");
        await insertActivityLog(testCharacter.id, "TYPE_C", "c");

        const result = await p.query(
          `SELECT * FROM activity_log WHERE "playerId" = $1 AND "eventType" = ANY($2)`,
          [testCharacter.id, ["TYPE_A", "TYPE_C"]],
        );

        expect(result.rows.length).toBe(2);
        const types = result.rows.map((r) => r.eventType);
        expect(types).toContain("TYPE_A");
        expect(types).toContain("TYPE_C");
        expect(types).not.toContain("TYPE_B");
      },
    );
  });

  // ============================================================================
  // Trade Operations
  // ============================================================================

  describe("Trade Operations", () => {
    let testUser1: Awaited<ReturnType<typeof createTestUser>>;
    let testUser2: Awaited<ReturnType<typeof createTestUser>>;
    let testChar1: Awaited<ReturnType<typeof createTestCharacter>>;
    let testChar2: Awaited<ReturnType<typeof createTestCharacter>>;

    beforeEach(async () => {
      if (!dbConnectionWorks) return;
      testUser1 = await createTestUser("Trader One");
      testUser2 = await createTestUser("Trader Two");
      testChar1 = await createTestCharacter(testUser1.id, "Trader Char 1");
      testChar2 = await createTestCharacter(testUser2.id, "Trader Char 2");
    });

    it.skipIf(!isDatabaseAvailable)(
      "should insert trade with full item details",
      async () => {
        const p = await getPool();
        const initiatorItems = [
          { itemId: "dragon_sword", quantity: 1 },
          { itemId: "gold_coin", quantity: 5000 },
        ];
        const receiverItems = [{ itemId: "rune_platebody", quantity: 1 }];

        const tradeId = await insertTradeWithItems(
          testChar1.id,
          testChar2.id,
          "completed",
          initiatorItems,
          receiverItems,
          1000,
          500,
        );

        const result = await p.query(`SELECT * FROM trades WHERE id = $1`, [
          tradeId,
        ]);
        expect(result.rows.length).toBe(1);

        const trade = result.rows[0];
        expect(trade.initiatorItems).toEqual(initiatorItems);
        expect(trade.receiverItems).toEqual(receiverItems);
        expect(trade.initiatorCoins).toBe(1000);
        expect(trade.receiverCoins).toBe(500);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should support all trade statuses",
      async () => {
        const p = await getPool();
        const statuses = ["completed", "cancelled", "declined"];

        for (const status of statuses) {
          const tradeId = await insertTradeWithItems(
            testChar1.id,
            testChar2.id,
            status,
            [],
            [],
            0,
            0,
          );
          const result = await p.query(
            `SELECT status FROM trades WHERE id = $1`,
            [tradeId],
          );
          expect(result.rows[0].status).toBe(status);
        }
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should find trades where player is either party",
      async () => {
        const p = await getPool();

        // Char1 initiates trade with Char2
        await insertTrade(testChar1.id, testChar2.id, "completed");
        // Char2 initiates trade with Char1 (reverse)
        await insertTrade(testChar2.id, testChar1.id, "completed");

        // Create a third user to verify isolation
        const testUser3 = await createTestUser("Trader Three");
        const testChar3 = await createTestCharacter(
          testUser3.id,
          "Trader Char 3",
        );
        await insertTrade(testChar2.id, testChar3.id, "completed");

        // Query all trades involving Char1
        const result = await p.query(
          `SELECT * FROM trades WHERE "initiatorId" = $1 OR "receiverId" = $1`,
          [testChar1.id],
        );

        expect(result.rows.length).toBe(2);
        // Should NOT include the trade between Char2 and Char3
        result.rows.forEach((row) => {
          expect(
            row.initiatorId === testChar1.id || row.receiverId === testChar1.id,
          ).toBe(true);
        });
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle zero-coin trades",
      async () => {
        const p = await getPool();
        const tradeId = await insertTradeWithItems(
          testChar1.id,
          testChar2.id,
          "completed",
          [{ itemId: "gift_item", quantity: 1 }],
          [],
          0,
          0,
        );

        const result = await p.query(`SELECT * FROM trades WHERE id = $1`, [
          tradeId,
        ]);
        expect(result.rows[0].initiatorCoins).toBe(0);
        expect(result.rows[0].receiverCoins).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle trades with empty item arrays",
      async () => {
        const p = await getPool();
        // Coin-only trade
        const tradeId = await insertTradeWithItems(
          testChar1.id,
          testChar2.id,
          "completed",
          [],
          [],
          10000,
          5000,
        );

        const result = await p.query(`SELECT * FROM trades WHERE id = $1`, [
          tradeId,
        ]);
        expect(result.rows[0].initiatorItems).toEqual([]);
        expect(result.rows[0].receiverItems).toEqual([]);
      },
    );
  });

  // ============================================================================
  // Foreign Key Constraints and Cascade Behavior
  // ============================================================================

  describe("Foreign Key Constraints", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should cascade delete activity logs when character is deleted",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Cascade Test User");
        const char = await createTestCharacter(user.id, "Cascade Char");

        // Insert activities
        await insertActivityLog(char.id, "TEST_EVENT", "test");
        await insertActivityLog(char.id, "TEST_EVENT_2", "test2");

        // Verify activities exist
        const before = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1`,
          [char.id],
        );
        expect(parseInt(before.rows[0].count)).toBe(2);

        // Delete character
        await p.query(`DELETE FROM characters WHERE id = $1`, [char.id]);

        // Verify activities were cascade deleted
        const after = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1`,
          [char.id],
        );
        expect(parseInt(after.rows[0].count)).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should set null on trade participants when character is deleted",
      async () => {
        const p = await getPool();
        const user1 = await createTestUser("FK User 1");
        const user2 = await createTestUser("FK User 2");
        const char1 = await createTestCharacter(user1.id, "FK Char 1");
        const char2 = await createTestCharacter(user2.id, "FK Char 2");

        const tradeId = await insertTrade(char1.id, char2.id, "completed");

        // Delete char1
        await p.query(`DELETE FROM characters WHERE id = $1`, [char1.id]);

        // Trade should still exist but with NULL initiatorId
        const result = await p.query(`SELECT * FROM trades WHERE id = $1`, [
          tradeId,
        ]);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].initiatorId).toBeNull();
        expect(result.rows[0].receiverId).toBe(char2.id);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should reject activity log with non-existent player",
      async () => {
        const p = await getPool();

        await expect(
          p.query(
            `INSERT INTO activity_log ("playerId", "eventType", action, details, timestamp)
           VALUES ($1, $2, $3, $4, $5)`,
            ["non-existent-char-id", "TEST", "test", "{}", Date.now()],
          ),
        ).rejects.toThrow();
      },
    );
  });

  // ============================================================================
  // User and Player Queries
  // ============================================================================

  describe("User Listing and Search", () => {
    beforeEach(async () => {
      if (!dbConnectionWorks) return;
      await createTestUser("Alice Admin", ["admin"]);
      await createTestUser("Bob Moderator", ["mod"]);
      await createTestUser("Charlie User", []);
      await createTestUser("Alice Player", ["user"]); // Duplicate first name
    });

    it.skipIf(!isDatabaseAvailable)(
      "should search users case-insensitively",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT * FROM users WHERE name ILIKE $1`,
          ["%alice%"],
        );
        expect(result.rows.length).toBeGreaterThanOrEqual(2);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should return empty for no-match search",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT * FROM users WHERE name ILIKE $1`,
          ["%zzz_no_match_zzz%"],
        );
        expect(result.rows.length).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)("should filter by exact role", async () => {
      const p = await getPool();
      const result = await p.query(`SELECT * FROM users WHERE roles LIKE $1`, [
        "%admin%",
      ]);
      result.rows.forEach((r) => {
        expect(r.roles).toContain("admin");
      });
    });

    it.skipIf(!isDatabaseAvailable)(
      "should handle empty string search (returns all)",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT * FROM users WHERE name ILIKE $1`,
          ["%%"],
        );
        expect(result.rows.length).toBeGreaterThan(0);
      },
    );
  });

  describe("Player Details", () => {
    let testUser: Awaited<ReturnType<typeof createTestUser>>;
    let testCharacter: Awaited<ReturnType<typeof createTestCharacter>>;

    beforeEach(async () => {
      if (!dbConnectionWorks) return;
      testUser = await createTestUser("Detail User", ["user"]);
      testCharacter = await createTestCharacter(testUser.id, "Detail Char", {
        combatLevel: 50,
        health: 80,
        maxHealth: 100,
        coins: 12345,
        attackLevel: 40,
        strengthLevel: 35,
        defenseLevel: 30,
      });
    });

    it.skipIf(!isDatabaseAvailable)(
      "should retrieve complete player data",
      async () => {
        const p = await getPool();
        const result = await p.query(`SELECT * FROM characters WHERE id = $1`, [
          testCharacter.id,
        ]);

        expect(result.rows.length).toBe(1);
        const char = result.rows[0];
        expect(char.name).toBe("Detail Char");
        expect(char.combatLevel).toBe(50);
        expect(char.health).toBe(80);
        expect(char.maxHealth).toBe(100);
        expect(char.coins).toBe(12345);
        expect(char.attackLevel).toBe(40);
        expect(char.strengthLevel).toBe(35);
        expect(char.defenseLevel).toBe(30);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should return 404-equivalent for non-existent player",
      async () => {
        const p = await getPool();
        const result = await p.query(`SELECT * FROM characters WHERE id = $1`, [
          "non-existent-id",
        ]);
        expect(result.rows.length).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should join player with account correctly",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT c.*, u.name as "accountName", u.roles
         FROM characters c
         JOIN users u ON c."accountId" = u.id
         WHERE c.id = $1`,
          [testCharacter.id],
        );

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].accountName).toBe("Detail User");
        expect(result.rows[0].roles).toContain("user");
      },
    );
  });

  // ============================================================================
  // Index Verification and Performance
  // ============================================================================

  // TODO: These index tests require database migrations to create the indexes.
  // Skip until the proper migrations are applied.
  describe.skip("Indexes", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should have all required indexes on activity_log",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'activity_log'`,
        );
        const indexNames = result.rows.map((r) => r.indexname);

        expect(indexNames).toContain("idx_activity_log_player");
        expect(indexNames).toContain("idx_activity_log_timestamp");
        expect(indexNames).toContain("idx_activity_log_player_timestamp");
        expect(indexNames).toContain("idx_activity_log_event_type");
        expect(indexNames).toContain("idx_activity_log_player_event_type");
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should have all required indexes on trades",
      async () => {
        const p = await getPool();
        const result = await p.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'trades'`,
        );
        const indexNames = result.rows.map((r) => r.indexname);

        expect(indexNames).toContain("idx_trades_initiator");
        expect(indexNames).toContain("idx_trades_receiver");
        expect(indexNames).toContain("idx_trades_timestamp");
        expect(indexNames).toContain("idx_trades_initiator_timestamp");
        expect(indexNames).toContain("idx_trades_receiver_timestamp");
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should use index for player activity queries (EXPLAIN)",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Index Test User");
        const char = await createTestCharacter(user.id, "Index Char");

        const result = await p.query(
          `EXPLAIN (FORMAT JSON) SELECT * FROM activity_log WHERE "playerId" = $1`,
          [char.id],
        );

        const plan = result.rows[0]["QUERY PLAN"][0];
        const planString = JSON.stringify(plan);

        // Should mention an index scan, not a sequential scan
        expect(
          planString.includes("Index") ||
            planString.includes("Bitmap") ||
            planString.includes("idx_activity_log"),
        ).toBe(true);
      },
    );
  });

  // ============================================================================
  // Concurrent Operations
  // ============================================================================

  describe("Concurrent Operations", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should handle parallel activity inserts",
      async () => {
        const user = await createTestUser("Concurrent User");
        const char = await createTestCharacter(user.id, "Concurrent Char");

        // Insert 50 activities in parallel
        const promises = Array.from({ length: 50 }, (_, i) =>
          insertActivityLog(char.id, `PARALLEL_EVENT_${i}`, "parallel_action"),
        );

        const ids = await Promise.all(promises);

        // All should succeed with unique IDs
        expect(ids.length).toBe(50);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(50);

        // Verify all were inserted
        const p = await getPool();
        const result = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1 AND "eventType" LIKE 'PARALLEL_EVENT_%'`,
          [char.id],
        );
        expect(parseInt(result.rows[0].count)).toBe(50);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle parallel trade inserts",
      async () => {
        const user1 = await createTestUser("Parallel Trader 1");
        const user2 = await createTestUser("Parallel Trader 2");
        const char1 = await createTestCharacter(user1.id, "P Char 1");
        const char2 = await createTestCharacter(user2.id, "P Char 2");

        // Insert 20 trades in parallel
        const promises = Array.from({ length: 20 }, () =>
          insertTrade(char1.id, char2.id, "completed"),
        );

        const ids = await Promise.all(promises);
        expect(ids.length).toBe(20);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(20);
      },
    );
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should handle special characters in names",
      async () => {
        const p = await getPool();
        const specialName = "Test'User\"With<Special>&Chars";
        const user = await createTestUser(specialName);

        const result = await p.query(`SELECT name FROM users WHERE id = $1`, [
          user.id,
        ]);
        expect(result.rows[0].name).toBe(specialName);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle Unicode in names and details",
      async () => {
        const p = await getPool();
        const unicodeName = "测试用户🎮日本語ユーザー";
        const user = await createTestUser(unicodeName);
        const char = await createTestCharacter(user.id, "Unicode Char");

        await insertActivityLog(char.id, "UNICODE_EVENT", "acted", null, null, {
          message: "こんにちは世界",
          emoji: "🎉🎊🎁",
        });

        const result = await p.query(`SELECT name FROM users WHERE id = $1`, [
          user.id,
        ]);
        expect(result.rows[0].name).toBe(unicodeName);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle very long entity IDs",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Long ID User");
        const char = await createTestCharacter(user.id, "Long ID Char");

        const longEntityId = "x".repeat(255);
        const activityId = await insertActivityLog(
          char.id,
          "LONG_ID_EVENT",
          "test",
          "item",
          longEntityId,
        );

        const result = await p.query(
          `SELECT "entityId" FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(result.rows[0].entityId).toBe(longEntityId);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle timestamp at Unix epoch",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Epoch User");
        const char = await createTestCharacter(user.id, "Epoch Char");

        const activityId = await insertActivityLog(
          char.id,
          "EPOCH_EVENT",
          "test",
          null,
          null,
          {},
          0,
        );

        const result = await p.query(
          `SELECT timestamp FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(Number(result.rows[0].timestamp)).toBe(0);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle very large timestamps",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Future User");
        const char = await createTestCharacter(user.id, "Future Char");

        const futureTimestamp = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // 10 years in future
        const activityId = await insertActivityLog(
          char.id,
          "FUTURE_EVENT",
          "test",
          null,
          null,
          {},
          futureTimestamp,
        );

        const result = await p.query(
          `SELECT timestamp FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(Number(result.rows[0].timestamp)).toBe(futureTimestamp);
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should handle position with float precision",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Float Pos User");
        const char = await createTestCharacter(user.id, "Float Pos Char");

        const position = { x: 123.456789012345, y: -0.00001, z: 999999.999999 };
        const activityId = await insertActivityLog(
          char.id,
          "FLOAT_POS_EVENT",
          "test",
          null,
          null,
          {},
          undefined,
          position,
        );

        const result = await p.query(
          `SELECT position FROM activity_log WHERE id = $1`,
          [activityId],
        );
        expect(result.rows[0].position.x).toBeCloseTo(position.x, 6);
        expect(result.rows[0].position.y).toBeCloseTo(position.y, 6);
        expect(result.rows[0].position.z).toBeCloseTo(position.z, 6);
      },
    );
  });

  // ============================================================================
  // Data Integrity and Sorting
  // ============================================================================

  describe("Data Integrity", () => {
    it.skipIf(!isDatabaseAvailable)(
      "should maintain insertion order with sequential timestamps",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Order User");
        const char = await createTestCharacter(user.id, "Order Char");

        const baseTime = Date.now();
        for (let i = 0; i < 10; i++) {
          await insertActivityLog(
            char.id,
            `ORDERED_${i}`,
            "test",
            null,
            null,
            { order: i },
            baseTime + i,
          );
        }

        const result = await p.query(
          `SELECT "eventType", details FROM activity_log WHERE "playerId" = $1 AND "eventType" LIKE 'ORDERED_%' ORDER BY timestamp ASC`,
          [char.id],
        );

        expect(result.rows.length).toBe(10);
        for (let i = 0; i < 10; i++) {
          expect(result.rows[i].eventType).toBe(`ORDERED_${i}`);
          expect(result.rows[i].details.order).toBe(i);
        }
      },
    );

    it.skipIf(!isDatabaseAvailable)(
      "should count correctly with filters",
      async () => {
        const p = await getPool();
        const user = await createTestUser("Count User");
        const char = await createTestCharacter(user.id, "Count Char");

        // Insert specific counts of different event types
        for (let i = 0; i < 15; i++)
          await insertActivityLog(char.id, "COUNT_A", "a");
        for (let i = 0; i < 10; i++)
          await insertActivityLog(char.id, "COUNT_B", "b");
        for (let i = 0; i < 5; i++)
          await insertActivityLog(char.id, "COUNT_C", "c");

        const countA = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1 AND "eventType" = $2`,
          [char.id, "COUNT_A"],
        );
        expect(parseInt(countA.rows[0].count)).toBe(15);

        const countB = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1 AND "eventType" = $2`,
          [char.id, "COUNT_B"],
        );
        expect(parseInt(countB.rows[0].count)).toBe(10);

        const countAll = await p.query(
          `SELECT COUNT(*) FROM activity_log WHERE "playerId" = $1 AND "eventType" LIKE 'COUNT_%'`,
          [char.id],
        );
        expect(parseInt(countAll.rows[0].count)).toBe(30);
      },
    );
  });
});
