/**
 * Admin Routes - User management, activity tracking, and combat debugging
 * Protected by x-admin-code header authentication with rate limiting.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { World } from "@hyperscape/shared";
import { bfsPool, tilePool, quaternionPool } from "@hyperscape/shared";
import type { ServerConfig } from "../config.js";
import type { DatabaseSystem } from "../../systems/DatabaseSystem/index.js";
import { eq, like, sql, desc, and, type SQL } from "drizzle-orm";
import * as schema from "../../database/schema.js";
import { timingSafeEqual } from "crypto";

/**
 * Rate limiter for admin authentication attempts.
 * Tracks failed attempts per IP address.
 */
interface AdminAuthAttempt {
  failures: number;
  lastAttempt: number;
  blockedUntil: number;
}

const adminAuthAttempts = new Map<string, AdminAuthAttempt>();

// Rate limit config: 5 attempts per minute, 5 minute lockout
const ADMIN_AUTH_MAX_ATTEMPTS = 5;
const ADMIN_AUTH_WINDOW_MS = 60 * 1000; // 1 minute
const ADMIN_AUTH_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Returns true if strings are equal.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time, but will fail
    const buf = Buffer.alloc(b.length);
    timingSafeEqual(buf, Buffer.from(b, "utf8"));
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Check if IP is rate limited for admin auth.
 * Returns remaining lockout time in ms, or 0 if not locked.
 */
function checkAdminRateLimit(ip: string): number {
  const now = Date.now();
  const attempt = adminAuthAttempts.get(ip);

  if (!attempt) return 0;

  // Check if currently blocked
  if (attempt.blockedUntil > now) {
    return attempt.blockedUntil - now;
  }

  // Reset if window expired
  if (now - attempt.lastAttempt > ADMIN_AUTH_WINDOW_MS) {
    adminAuthAttempts.delete(ip);
    return 0;
  }

  return 0;
}

/**
 * Record a failed admin auth attempt.
 * Returns true if the IP is now blocked.
 */
function recordFailedAttempt(ip: string): boolean {
  const now = Date.now();
  const attempt = adminAuthAttempts.get(ip);

  if (!attempt) {
    adminAuthAttempts.set(ip, {
      failures: 1,
      lastAttempt: now,
      blockedUntil: 0,
    });
    return false;
  }

  // Reset if window expired
  if (now - attempt.lastAttempt > ADMIN_AUTH_WINDOW_MS) {
    attempt.failures = 1;
    attempt.lastAttempt = now;
    return false;
  }

  attempt.failures++;
  attempt.lastAttempt = now;

  if (attempt.failures >= ADMIN_AUTH_MAX_ATTEMPTS) {
    attempt.blockedUntil = now + ADMIN_AUTH_LOCKOUT_MS;
    console.warn(
      `[AdminAuth] IP ${ip} blocked for ${ADMIN_AUTH_LOCKOUT_MS / 1000}s after ${attempt.failures} failed attempts`,
    );
    return true;
  }

  return false;
}

/**
 * Clear rate limit state for an IP on successful auth.
 */
function clearRateLimit(ip: string): void {
  adminAuthAttempts.delete(ip);
}

/** Safely parse int with NaN protection */
function safeParseInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Parse optional timestamp - returns undefined if missing/invalid */
function parseOptionalTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Parse pagination params with bounds and NaN protection */
function parsePagination(
  query: { page?: string; limit?: string },
  maxLimit = 100,
  defaultLimit = 50,
) {
  const page = Math.max(1, safeParseInt(query.page, 1));
  const limit = Math.min(
    maxLimit,
    Math.max(1, safeParseInt(query.limit, defaultLimit)),
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function registerAdminRoutes(
  fastify: FastifyInstance,
  world: World,
  config: ServerConfig,
): void {
  // SECURITY: Validate ADMIN_CODE is set in production
  if (process.env.NODE_ENV === "production" && !config.adminCode) {
    console.warn(
      "[AdminRoutes] WARNING: ADMIN_CODE not set in production. Admin panel disabled.",
    );
  }

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    // Get client IP for rate limiting
    const clientIp =
      request.ip || request.headers["x-forwarded-for"] || "unknown";
    const ip = Array.isArray(clientIp) ? clientIp[0] : clientIp;

    // SECURITY: Check rate limit before any other validation
    const lockoutRemaining = checkAdminRateLimit(ip);
    if (lockoutRemaining > 0) {
      const secondsRemaining = Math.ceil(lockoutRemaining / 1000);
      return reply.code(429).send({
        error: "Too many failed attempts",
        retryAfter: secondsRemaining,
      });
    }

    // Always require admin code - if not configured, admin panel is disabled
    if (!config.adminCode) {
      return reply.code(403).send({ error: "Admin panel not configured" });
    }

    const providedCode = request.headers["x-admin-code"];
    if (typeof providedCode !== "string") {
      recordFailedAttempt(ip);
      return reply.code(403).send({ error: "Unauthorized" });
    }

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!safeCompare(providedCode, config.adminCode)) {
      const blocked = recordFailedAttempt(ip);
      if (blocked) {
        return reply.code(429).send({
          error: "Too many failed attempts",
          retryAfter: ADMIN_AUTH_LOCKOUT_MS / 1000,
        });
      }
      return reply.code(403).send({ error: "Unauthorized" });
    }

    // Successful auth - clear any rate limit state
    clearRateLimit(ip);
  };

  /** Get database system or return error response */
  const getDb = (reply: FastifyReply) => {
    const dbSystem = world.getSystem<DatabaseSystem>("database");
    if (!dbSystem) {
      reply.code(500).send({ error: "DatabaseSystem not found" });
      return null;
    }
    const db = dbSystem.getDb();
    if (!db) {
      reply.code(500).send({ error: "Database not initialized" });
      return null;
    }
    return { dbSystem, db };
  };

  /**
   * GET /admin/combat/stats
   * Get EventStore statistics
   */
  fastify.get(
    "/admin/combat/stats",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const combatSystem = world.getSystem("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store stats directly via public eventStore
      const eventStore = combatSystem.eventStore;
      const stats = {
        eventCount: eventStore.getEventCount(),
        snapshotCount: eventStore.getSnapshotCount(),
        oldestTick: eventStore.getOldestEventTick(),
        newestTick: eventStore.getNewestEventTick(),
      };
      // Access anti-cheat stats directly via public antiCheat
      const antiCheatStats = combatSystem.antiCheat.getStats();

      return reply.send({
        eventStore: stats,
        antiCheat: antiCheatStats,
        currentTick: world.currentTick,
      });
    },
  );

  /**
   * GET /admin/pools/stats
   * Get object pool utilization metrics
   */
  fastify.get(
    "/admin/pools/stats",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const bfsStats = bfsPool.getStats();
      const tileStats = tilePool.getStats();
      const quaternionStats = quaternionPool.getStats();

      return reply.send({
        bfs: {
          ...bfsStats,
          utilization:
            bfsStats.poolSize > 0
              ? Math.round((bfsStats.inUse / bfsStats.poolSize) * 100)
              : 0,
        },
        tile: tileStats,
        quaternion: quaternionStats,
      });
    },
  );

  /**
   * GET /admin/combat/:playerId
   * Get raw combat events for a player
   *
   * Query params:
   * - startTick: Start of range (default: currentTick - 500)
   * - endTick: End of range (default: currentTick)
   */
  fastify.get<{
    Params: { playerId: string };
    Querystring: { startTick?: string; endTick?: string };
  }>(
    "/admin/combat/:playerId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { playerId } = request.params;
      const startTick = safeParseInt(
        request.query.startTick,
        world.currentTick - 500,
      );
      const endTick = safeParseInt(request.query.endTick, world.currentTick);

      const combatSystem = world.getSystem("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store directly via public eventStore
      const events = combatSystem.eventStore.getEntityEvents(
        playerId,
        startTick,
        endTick,
      );

      return reply.send({
        playerId,
        tickRange: { startTick, endTick },
        eventCount: events.length,
        events,
      });
    },
  );

  /**
   * GET /admin/combat/:playerId/report
   * Get full investigation report with suspicious event detection
   *
   * Query params:
   * - startTick: Start of range (default: currentTick - 500)
   * - endTick: End of range (default: currentTick)
   * - maxDamage: Threshold for suspicious damage (default: 50)
   */
  fastify.get<{
    Params: { playerId: string };
    Querystring: {
      startTick?: string;
      endTick?: string;
      maxDamage?: string;
    };
  }>(
    "/admin/combat/:playerId/report",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { playerId } = request.params;
      const startTick = safeParseInt(
        request.query.startTick,
        world.currentTick - 500,
      );
      const endTick = safeParseInt(request.query.endTick, world.currentTick);
      const maxDamage = safeParseInt(request.query.maxDamage, 50);

      const combatSystem = world.getSystem("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store directly via public eventStore
      const events = combatSystem.eventStore.getEntityEvents(
        playerId,
        startTick,
        endTick,
      );

      // Build a simple report from the events
      let totalDamageDealt = 0;
      let totalDamageTaken = 0;
      let maxDamageDealt = 0;
      let hitCount = 0;
      const suspiciousEvents: Array<{
        tick: number;
        reason: string;
        damage?: number;
        entityId: string;
      }> = [];

      for (const event of events) {
        const payload = event.payload as {
          damage?: number;
          targetId?: string;
        };

        if (event.type === "COMBAT_DAMAGE") {
          const damage = payload.damage ?? 0;

          if (event.entityId === playerId) {
            // Player dealt damage
            totalDamageDealt += damage;
            maxDamageDealt = Math.max(maxDamageDealt, damage);
            hitCount++;
          } else if (payload.targetId === playerId) {
            // Player took damage
            totalDamageTaken += damage;
          }

          // Check for suspicious damage
          if (damage > maxDamage) {
            suspiciousEvents.push({
              tick: event.tick,
              reason: `Damage ${damage} exceeds threshold ${maxDamage}`,
              damage,
              entityId: event.entityId,
            });
          }
        }
      }

      return reply.send({
        playerId,
        tickRange: { startTick, endTick },
        stats: {
          totalDamageDealt,
          totalDamageTaken,
          maxDamageDealt,
          hitCount,
          averageDamagePerHit: hitCount > 0 ? totalDamageDealt / hitCount : 0,
        },
        suspiciousEvents,
        eventCount: events.length,
      });
    },
  );

  /**
   * GET /admin/combat/range/:startTick/:endTick
   * Get all combat events in a tick range (for investigating specific incidents)
   */
  fastify.get<{
    Params: { startTick: string; endTick: string };
  }>(
    "/admin/combat/range/:startTick/:endTick",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const startTick = parseInt(request.params.startTick, 10);
      const endTick = parseInt(request.params.endTick, 10);

      if (Number.isNaN(startTick) || Number.isNaN(endTick)) {
        return reply.code(400).send({
          error: "Invalid tick range - startTick and endTick must be numbers",
        });
      }

      const combatSystem = world.getSystem("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      const events = combatSystem.eventStore.getCombatEvents(
        startTick,
        endTick,
      );

      return reply.send({
        tickRange: { startTick, endTick },
        eventCount: events.length,
        events,
      });
    },
  );

  /**
   * GET /admin/anticheat/flagged
   * Get players flagged by anti-cheat system
   */
  fastify.get(
    "/admin/anticheat/flagged",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const combatSystem = world.getSystem("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      const flaggedPlayers = combatSystem.antiCheat.getPlayersRequiringReview();
      const reports = flaggedPlayers.map((playerId: string) => ({
        playerId,
        ...combatSystem.antiCheat.getPlayerReport(playerId),
      }));

      return reply.send({
        flaggedCount: flaggedPlayers.length,
        players: reports,
      });
    },
  );

  /**
   * GET /admin/anticheat/history
   * Paginated violation history from database (persisted across restarts)
   *
   * Query params:
   * - playerId: Filter by player ID (optional)
   * - severity: Filter by severity level (optional)
   * - limit: Results per page (default: 50, max: 100)
   * - page: Page number (default: 1)
   */
  fastify.get<{
    Querystring: {
      playerId?: string;
      severity?: string;
      page?: string;
      limit?: string;
    };
  }>(
    "/admin/anticheat/history",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;

      const { page, limit, offset } = parsePagination(request.query, 100, 50);
      const { playerId, severity } = request.query;

      const conditions: SQL<unknown>[] = [];
      if (playerId)
        conditions.push(eq(schema.antiCheatViolations.playerId, playerId));
      if (severity)
        conditions.push(eq(schema.antiCheatViolations.severity, severity));

      let countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.antiCheatViolations);
      if (conditions.length)
        countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
      const total = (await countQuery)[0]?.count ?? 0;

      let violationsQuery = db
        .select()
        .from(schema.antiCheatViolations)
        .orderBy(desc(schema.antiCheatViolations.timestamp))
        .limit(limit)
        .offset(offset);
      if (conditions.length)
        violationsQuery = violationsQuery.where(
          and(...conditions),
        ) as typeof violationsQuery;

      return reply.send({
        violations: await violationsQuery,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  // ============================================================================
  // ADMIN PANEL ENDPOINTS
  // ============================================================================

  /** GET /admin/users - List users with search/pagination */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      search?: string;
      role?: string;
    };
  }>("/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const ctx = getDb(reply);
    if (!ctx) return;
    const { db } = ctx;

    const { page, limit, offset } = parsePagination(request.query, 100, 50);
    const { search, role: roleFilter } = request.query;

    const conditions: SQL<unknown>[] = [];
    if (search) conditions.push(like(schema.users.name, `%${search}%`));
    if (roleFilter)
      conditions.push(like(schema.users.roles, `%${roleFilter}%`));

    let countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);
    if (conditions.length)
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    const total = (await countQuery)[0]?.count ?? 0;

    let usersQuery = db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        roles: schema.users.roles,
        createdAt: schema.users.createdAt,
        avatar: schema.users.avatar,
        wallet: schema.users.wallet,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length)
      usersQuery = usersQuery.where(and(...conditions)) as typeof usersQuery;

    return reply.send({
      users: await usersQuery,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  /** GET /admin/users/:userId - User details with characters */
  fastify.get<{ Params: { userId: string } }>(
    "/admin/users/:userId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;
      const { userId } = request.params;

      const userResult = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (userResult.length === 0)
        return reply.code(404).send({ error: "User not found" });

      let user: (typeof userResult)[0];
      let characters: Array<{
        id: string;
        name: string;
        combatLevel: number | null;
        createdAt: number | null;
        lastLogin: number | null;
        isAgent: number;
        avatar: string | null;
      }>;
      let activeBan: Array<typeof schema.userBans.$inferSelect>;
      try {
        [user, characters, activeBan] = await Promise.all([
          Promise.resolve(userResult[0]),
          db
            .select({
              id: schema.characters.id,
              name: schema.characters.name,
              combatLevel: schema.characters.combatLevel,
              createdAt: schema.characters.createdAt,
              lastLogin: schema.characters.lastLogin,
              isAgent: schema.characters.isAgent,
              avatar: schema.characters.avatar,
            })
            .from(schema.characters)
            .where(eq(schema.characters.accountId, userId)),
          db
            .select()
            .from(schema.userBans)
            .where(
              and(
                eq(schema.userBans.bannedUserId, userId),
                eq(schema.userBans.active, 1),
              ),
            )
            .limit(1),
        ]);
      } catch (err) {
        request.log.error(
          err,
          `[AdminRoutes] Failed to load user details for ${userId}`,
        );
        return reply.code(500).send({ error: "Failed to load user details" });
      }

      return reply.send({
        user: { ...user, roles: (user.roles ?? "").split(",").filter(Boolean) },
        characters,
        ban: activeBan[0] ?? null,
      });
    },
  );

  /** GET /admin/players/:playerId - Full player details */
  fastify.get<{ Params: { playerId: string } }>(
    "/admin/players/:playerId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;
      const { playerId } = request.params;

      const charResult = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, playerId))
        .limit(1);
      if (charResult.length === 0)
        return reply.code(404).send({ error: "Player not found" });
      const character = charResult[0];

      // Parallel fetch all related data
      let inventory: Array<typeof schema.inventory.$inferSelect>;
      let equipment: Array<typeof schema.equipment.$inferSelect>;
      let bank: Array<typeof schema.bankStorage.$inferSelect>;
      let npcKills: Array<typeof schema.npcKills.$inferSelect>;
      let sessions: Array<typeof schema.playerSessions.$inferSelect>;
      let accountResult: Array<{
        id: string;
        name: string;
        roles: string | null;
      }>;
      try {
        [inventory, equipment, bank, npcKills, sessions, accountResult] =
          await Promise.all([
            db
              .select()
              .from(schema.inventory)
              .where(eq(schema.inventory.playerId, playerId))
              .orderBy(schema.inventory.slotIndex),
            db
              .select()
              .from(schema.equipment)
              .where(eq(schema.equipment.playerId, playerId)),
            db
              .select()
              .from(schema.bankStorage)
              .where(eq(schema.bankStorage.playerId, playerId))
              .orderBy(schema.bankStorage.tabIndex, schema.bankStorage.slot),
            db
              .select()
              .from(schema.npcKills)
              .where(eq(schema.npcKills.playerId, playerId)),
            db
              .select()
              .from(schema.playerSessions)
              .where(eq(schema.playerSessions.playerId, playerId))
              .orderBy(desc(schema.playerSessions.sessionStart))
              .limit(10),
            db
              .select({
                id: schema.users.id,
                name: schema.users.name,
                roles: schema.users.roles,
              })
              .from(schema.users)
              .where(eq(schema.users.id, character.accountId))
              .limit(1),
          ]);
      } catch (err) {
        request.log.error(
          err,
          `[AdminRoutes] Failed to load player details for ${playerId}`,
        );
        return reply.code(500).send({ error: "Failed to load player details" });
      }

      // Build skills from character columns
      const skillDef = (
        lvl: number | null,
        xp: number | null,
        defaultLvl = 1,
        defaultXp = 0,
      ) => ({
        level: lvl ?? defaultLvl,
        xp: xp ?? defaultXp,
      });

      return reply.send({
        player: {
          id: character.id,
          name: character.name,
          accountId: character.accountId,
          combatLevel: character.combatLevel,
          health: character.health,
          maxHealth: character.maxHealth,
          coins: character.coins,
          position: {
            x: character.positionX,
            y: character.positionY,
            z: character.positionZ,
          },
          attackStyle: character.attackStyle,
          autoRetaliate: character.autoRetaliate === 1,
          isAgent: character.isAgent === 1,
          createdAt: character.createdAt,
          lastLogin: character.lastLogin,
        },
        account: accountResult[0] ?? null,
        skills: {
          attack: skillDef(character.attackLevel, character.attackXp),
          strength: skillDef(character.strengthLevel, character.strengthXp),
          defense: skillDef(character.defenseLevel, character.defenseXp),
          constitution: skillDef(
            character.constitutionLevel,
            character.constitutionXp,
            10,
            1154,
          ),
          ranged: skillDef(character.rangedLevel, character.rangedXp),
          prayer: skillDef(character.prayerLevel, character.prayerXp),
          magic: skillDef(character.magicLevel, character.magicXp),
          woodcutting: skillDef(
            character.woodcuttingLevel,
            character.woodcuttingXp,
          ),
          mining: skillDef(character.miningLevel, character.miningXp),
          fishing: skillDef(character.fishingLevel, character.fishingXp),
          firemaking: skillDef(
            character.firemakingLevel,
            character.firemakingXp,
          ),
          cooking: skillDef(character.cookingLevel, character.cookingXp),
          smithing: skillDef(character.smithingLevel, character.smithingXp),
        },
        inventory: inventory.map((i) => {
          let metadata = null;
          if (i.metadata) {
            try {
              metadata = JSON.parse(i.metadata);
            } catch {
              /* invalid JSON, leave as null */
            }
          }
          return {
            itemId: i.itemId,
            quantity: i.quantity,
            slotIndex: i.slotIndex,
            metadata,
          };
        }),
        equipment: equipment.map((e) => ({
          slotType: e.slotType,
          itemId: e.itemId,
          quantity: e.quantity,
        })),
        bank: bank.map((b) => ({
          itemId: b.itemId,
          quantity: b.quantity,
          slot: b.slot,
          tabIndex: b.tabIndex,
        })),
        npcKills: npcKills.map((k) => ({
          npcId: k.npcId,
          killCount: k.killCount,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionStart: s.sessionStart,
          sessionEnd: s.sessionEnd,
          playtimeMinutes: s.playtimeMinutes,
          reason: s.reason,
        })),
      });
    },
  );

  /** GET /admin/players/:playerId/activity - Player activity history */
  fastify.get<{
    Params: { playerId: string };
    Querystring: {
      page?: string;
      limit?: string;
      eventType?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/admin/players/:playerId/activity",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        playerId: request.params.playerId,
        eventType: request.query.eventType,
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      let activities: Awaited<ReturnType<typeof dbSystem.queryActivitiesAsync>>;
      let total: Awaited<ReturnType<typeof dbSystem.countActivitiesAsync>>;
      try {
        [activities, total] = await Promise.all([
          dbSystem.queryActivitiesAsync(options),
          dbSystem.countActivitiesAsync(options),
        ]);
      } catch (err) {
        request.log.error(
          err,
          `[AdminRoutes] Failed to load activity for ${options.playerId}`,
        );
        return reply.code(500).send({ error: "Failed to load activity logs" });
      }

      return reply.send({
        activities,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/players/:playerId/trades - Player trade history */
  fastify.get<{
    Params: { playerId: string };
    Querystring: { page?: string; limit?: string; from?: string; to?: string };
  }>(
    "/admin/players/:playerId/trades",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        playerId: request.params.playerId,
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      let trades: Awaited<ReturnType<typeof dbSystem.queryTradesAsync>>;
      let total: Awaited<ReturnType<typeof dbSystem.countTradesAsync>>;
      try {
        [trades, total] = await Promise.all([
          dbSystem.queryTradesAsync(options),
          dbSystem.countTradesAsync(options),
        ]);
      } catch (err) {
        request.log.error(
          err,
          `[AdminRoutes] Failed to load trades for ${options.playerId}`,
        );
        return reply.code(500).send({ error: "Failed to load trade history" });
      }

      return reply.send({
        trades,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/activity - Query all activity logs */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      eventType?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/admin/activity",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        eventTypes: request.query.eventType?.split(",").filter(Boolean),
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      let activities: Awaited<ReturnType<typeof dbSystem.queryActivitiesAsync>>;
      let total: Awaited<ReturnType<typeof dbSystem.countActivitiesAsync>>;
      try {
        [activities, total] = await Promise.all([
          dbSystem.queryActivitiesAsync(options),
          dbSystem.countActivitiesAsync(options),
        ]);
      } catch (err) {
        request.log.error(err, "[AdminRoutes] Failed to load activity logs");
        return reply.code(500).send({ error: "Failed to load activity logs" });
      }

      return reply.send({
        activities,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/activity/types - Event types for filter dropdown */
  fastify.get(
    "/admin/activity/types",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      return reply.send({
        eventTypes: await ctx.dbSystem.getActivityEventTypesAsync(),
      });
    },
  );

  /** GET /admin/stats - Dashboard statistics */
  fastify.get(
    "/admin/stats",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;

      let users: Array<{ count: number }>;
      let characters: Array<{ count: number }>;
      let active: Array<{ count: number }>;
      let banned: Array<{ count: number }>;
      try {
        [users, characters, active, banned] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(schema.users),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.characters),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.playerSessions)
            .where(sql`${schema.playerSessions.sessionEnd} IS NULL`),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.userBans)
            .where(eq(schema.userBans.active, 1)),
        ]);
      } catch (err) {
        reply.log.error(err, "[AdminRoutes] Failed to load admin stats");
        return reply.code(500).send({ error: "Failed to load admin stats" });
      }

      return reply.send({
        totalUsers: users[0]?.count ?? 0,
        totalCharacters: characters[0]?.count ?? 0,
        activeSessions: active[0]?.count ?? 0,
        bannedUsers: banned[0]?.count ?? 0,
      });
    },
  );
}
