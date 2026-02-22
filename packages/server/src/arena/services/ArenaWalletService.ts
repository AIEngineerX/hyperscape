import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import * as schema from "../../database/schema.js";
import type { ArenaContext } from "../ArenaContext.js";
import type {
  ArenaWhitelistEntry,
  ArenaWhitelistUpsertInput,
  ArenaFeeChain,
  InviteSummary,
  InviteRedemptionResult,
  WalletLinkResult,
  ReferralInfo,
} from "../types.js";
import {
  normalizeWallet,
  normalizeInviteCode,
  normalizeFeeChain,
  normalizeFeePlatform,
  normalizeWalletForChain,
  feeChainsForPlatform,
  walletChainFamily,
  walletLinkPairKey,
  sha256Hex,
  nowMs,
} from "../arena-utils.js";

export class ArenaWalletService {
  private static readonly REFERRAL_VELOCITY_MAX_PER_DAY = 10;
  private static readonly ONE_DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly SIGNUP_BONUS_REFEREE = 25;
  private static readonly WALLET_LINK_BONUS_POINTS = 100;

  private readonly ctx: ArenaContext;
  private readonly awardFlatPoints: (params: {
    wallet: string;
    points: number;
    betId: string;
    referral: ReferralInfo | null;
  }) => Promise<void>;
  private readonly awardSignupBonusReferee: (
    wallet: string,
    inviteCode: string,
    inviterWallet: string,
  ) => Promise<void>;
  private readonly awardSignupBonusReferrer: (
    inviterWallet: string,
    invitedWallet: string,
    inviteCode: string,
  ) => Promise<void>;

  constructor(
    ctx: ArenaContext,
    awardFlatPoints: (params: {
      wallet: string;
      points: number;
      betId: string;
      referral: ReferralInfo | null;
    }) => Promise<void>,
    awardSignupBonusReferee: (
      wallet: string,
      inviteCode: string,
      inviterWallet: string,
    ) => Promise<void>,
    awardSignupBonusReferrer: (
      inviterWallet: string,
      invitedWallet: string,
      inviteCode: string,
    ) => Promise<void>,
  ) {
    this.ctx = ctx;
    this.awardFlatPoints = awardFlatPoints;
    this.awardSignupBonusReferee = awardSignupBonusReferee;
    this.awardSignupBonusReferrer = awardSignupBonusReferrer;
  }

  // ---------------------------------------------------------------------------
  // Whitelist
  // ---------------------------------------------------------------------------

  public async listWhitelist(limit = 200): Promise<ArenaWhitelistEntry[]> {
    const db = this.ctx.getDb();
    if (!db) return [];
    try {
      const rows = await db
        .select()
        .from(schema.arenaAgentWhitelist)
        .orderBy(
          desc(schema.arenaAgentWhitelist.priority),
          desc(schema.arenaAgentWhitelist.updatedAt),
        )
        .limit(Math.max(1, Math.min(limit, 1_000)));
      return rows.map((row) => ({
        characterId: row.characterId,
        enabled: row.enabled,
        minPowerScore: row.minPowerScore,
        maxPowerScore: row.maxPowerScore,
        priority: row.priority,
        cooldownUntil: row.cooldownUntil,
        notes: row.notes,
        updatedAt: row.updatedAt,
      }));
    } catch (error) {
      this.ctx.logTableMissingError(error);
      return [];
    }
  }

  public async upsertWhitelist(
    input: ArenaWhitelistUpsertInput,
  ): Promise<ArenaWhitelistEntry> {
    const db = this.ctx.getDb();
    const now = nowMs();
    const value = {
      characterId: input.characterId,
      enabled: input.enabled ?? true,
      minPowerScore: input.minPowerScore ?? 0,
      maxPowerScore: input.maxPowerScore ?? 10_000,
      priority: input.priority ?? 0,
      cooldownUntil: input.cooldownUntil ?? null,
      notes: input.notes ?? null,
      updatedAt: now,
    };

    if (!db) {
      return value;
    }

    try {
      await db
        .insert(schema.arenaAgentWhitelist)
        .values(value)
        .onConflictDoUpdate({
          target: schema.arenaAgentWhitelist.characterId,
          set: {
            enabled: value.enabled,
            minPowerScore: value.minPowerScore,
            maxPowerScore: value.maxPowerScore,
            priority: value.priority,
            cooldownUntil: value.cooldownUntil,
            notes: value.notes,
            updatedAt: value.updatedAt,
          },
        });

      const row = await db.query.arenaAgentWhitelist.findFirst({
        where: eq(schema.arenaAgentWhitelist.characterId, input.characterId),
      });
      if (!row) return value;
      return {
        characterId: row.characterId,
        enabled: row.enabled,
        minPowerScore: row.minPowerScore,
        maxPowerScore: row.maxPowerScore,
        priority: row.priority,
        cooldownUntil: row.cooldownUntil,
        notes: row.notes,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      this.ctx.logDbWriteError("upsert whitelist entry", error);
      return value;
    }
  }

  public async removeWhitelist(characterId: string): Promise<boolean> {
    const db = this.ctx.getDb();
    if (!db) return false;
    try {
      const deleted = await db
        .delete(schema.arenaAgentWhitelist)
        .where(eq(schema.arenaAgentWhitelist.characterId, characterId))
        .returning({ characterId: schema.arenaAgentWhitelist.characterId });
      return deleted.length > 0;
    } catch (error) {
      this.ctx.logDbWriteError("remove whitelist entry", error);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Invite code helpers
  // ---------------------------------------------------------------------------

  public buildInviteCode(wallet: string, attempt = 0): string {
    const digest = sha256Hex(`arena:invite:${wallet}:${attempt}`)
      .slice(0, 10)
      .toUpperCase();
    return `DUEL${digest}`;
  }

  public async getOrCreateInviteCode(walletRaw: string): Promise<string> {
    const db = this.ctx.getDb();
    if (!db) {
      return this.buildInviteCode(normalizeWallet(walletRaw), 0);
    }

    const wallet = normalizeWallet(walletRaw);
    const existing = await db.query.arenaInviteCodes.findFirst({
      where: eq(schema.arenaInviteCodes.inviterWallet, wallet),
    });
    if (existing) return existing.code;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.buildInviteCode(wallet, attempt);
      try {
        await db.insert(schema.arenaInviteCodes).values({
          code,
          inviterWallet: wallet,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
        return code;
      } catch (error) {
        const codeConflict =
          error instanceof Error &&
          (error.message.includes("duplicate") ||
            error.message.includes("unique"));
        if (!codeConflict) throw error;
      }
    }

    throw new Error("Failed to allocate invite code");
  }

  // ---------------------------------------------------------------------------
  // Linked wallets / identity graph
  // ---------------------------------------------------------------------------

  public async listLinkedWallets(walletRaw: string): Promise<string[]> {
    const db = this.ctx.getDb();
    if (!db) return [];

    const wallet = normalizeWallet(walletRaw);
    const discovered = new Set<string>([wallet]);
    const queue: string[] = [wallet];

    while (queue.length > 0 && discovered.size < 256) {
      const current = queue.shift();
      if (!current) break;

      let cursorId = 0;
      while (discovered.size < 256) {
        let rows: Array<{ id: number; walletA: string; walletB: string }> = [];
        try {
          rows = await db
            .select({
              id: schema.arenaWalletLinks.id,
              walletA: schema.arenaWalletLinks.walletA,
              walletB: schema.arenaWalletLinks.walletB,
            })
            .from(schema.arenaWalletLinks)
            .where(
              and(
                or(
                  eq(schema.arenaWalletLinks.walletA, current),
                  eq(schema.arenaWalletLinks.walletB, current),
                ),
                gt(schema.arenaWalletLinks.id, cursorId),
              ),
            )
            .orderBy(asc(schema.arenaWalletLinks.id))
            .limit(256);
        } catch (error) {
          this.ctx.logTableMissingError(error);
          return [];
        }

        if (rows.length === 0) break;

        for (const row of rows) {
          const candidates = [row.walletA, row.walletB];
          for (const candidate of candidates) {
            if (discovered.size >= 256) break;
            if (!discovered.has(candidate)) {
              discovered.add(candidate);
              queue.push(candidate);
            }
          }
          if (discovered.size >= 256) break;
        }

        cursorId = rows[rows.length - 1]?.id ?? cursorId;
        if (rows.length < 256) break;
      }
    }

    discovered.delete(wallet);
    return [...discovered];
  }

  public async listIdentityWallets(walletRaw: string): Promise<string[]> {
    const wallet = normalizeWallet(walletRaw);
    const discovered = new Set<string>([wallet]);
    const linkedWallets = await this.listLinkedWallets(wallet);
    for (const linkedWallet of linkedWallets) {
      discovered.add(normalizeWallet(linkedWallet));
    }
    return [...discovered].slice(0, 256);
  }

  public async isSelfReferralIdentity(
    walletRaw: string,
    inviterWalletRaw: string,
  ): Promise<boolean> {
    const wallet = normalizeWallet(walletRaw);
    const inviterWallet = normalizeWallet(inviterWalletRaw);
    if (wallet === inviterWallet) return true;

    try {
      const identityWallets = await this.listIdentityWallets(wallet);
      return identityWallets.some(
        (candidateWallet) => normalizeWallet(candidateWallet) === inviterWallet,
      );
    } catch (error: unknown) {
      this.ctx.logTableMissingError(error);
      return false;
    }
  }

  public assertSingleWalletPerChainFamily(identityWallets: string[]): void {
    const solanaWallets = new Set<string>();
    const evmWallets = new Set<string>();

    for (const candidateRaw of identityWallets) {
      const candidate = normalizeWallet(candidateRaw);
      if (candidate.startsWith("0x")) {
        evmWallets.add(candidate);
      } else {
        solanaWallets.add(candidate);
      }
    }

    if (solanaWallets.size > 1 || evmWallets.size > 1) {
      throw new Error(
        "A linked identity can only contain one Solana wallet and one EVM wallet",
      );
    }
  }

  public async hasWalletLinkBonusInIdentity(
    identityWalletsRaw: string[],
  ): Promise<boolean> {
    const db = this.ctx.getDb();
    if (!db || !db.query?.arenaPoints?.findFirst) return false;

    const identityWallets = [
      ...new Set(identityWalletsRaw.map((wallet) => normalizeWallet(wallet))),
    ].slice(0, 256);
    if (identityWallets.length === 0) return false;

    const walletWhere =
      identityWallets.length === 1
        ? eq(schema.arenaPoints.wallet, identityWallets[0]!)
        : inArray(schema.arenaPoints.wallet, identityWallets);

    try {
      const existingBonus = await db.query.arenaPoints.findFirst({
        where: and(
          walletWhere,
          sql`${schema.arenaPoints.betId} LIKE 'wallet-link:%'`,
        ),
      });
      return Boolean(existingBonus);
    } catch (error: unknown) {
      this.ctx.logTableMissingError(error);
      return false;
    }
  }

  public async findReferralMappingForWalletNetwork(walletRaw: string): Promise<{
    id: number;
    inviteCode: string;
    inviterWallet: string;
    invitedWallet: string;
    firstBetId: string | null;
  } | null> {
    const db = this.ctx.getDb();
    if (!db) return null;

    const wallet = normalizeWallet(walletRaw);
    const direct = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });
    if (direct) return direct;

    const linkedWallets = await this.listLinkedWallets(wallet);
    if (linkedWallets.length === 0) return null;

    const linkedRows = await db
      .select()
      .from(schema.arenaInvitedWallets)
      .where(inArray(schema.arenaInvitedWallets.invitedWallet, linkedWallets))
      .limit(128);

    if (linkedRows.length === 0) return null;

    const uniqueCodes = new Set(linkedRows.map((row) => row.inviteCode));
    if (uniqueCodes.size > 1) {
      throw new Error(
        "Linked wallets are already associated with different invite codes",
      );
    }

    return linkedRows[0] ?? null;
  }

  public async ensureWalletInviteMapping(params: {
    wallet: string;
    inviteCode: string;
    inviterWallet: string;
    firstBetId: string | null;
  }): Promise<void> {
    const db = this.ctx.getDb();
    if (!db) return;

    const wallet = normalizeWallet(params.wallet);
    const existing = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });

    if (existing) {
      if (existing.inviteCode !== params.inviteCode) {
        throw new Error("Wallet is already linked to a different invite code");
      }
      if (!existing.firstBetId && params.firstBetId) {
        await db
          .update(schema.arenaInvitedWallets)
          .set({
            firstBetId: params.firstBetId,
            updatedAt: nowMs(),
          })
          .where(eq(schema.arenaInvitedWallets.id, existing.id));
      }
      return;
    }

    try {
      await db.insert(schema.arenaInvitedWallets).values({
        inviteCode: params.inviteCode,
        inviterWallet: params.inviterWallet,
        invitedWallet: wallet,
        firstBetId: params.firstBetId,
      });
    } catch (error) {
      const mappingConflict =
        error instanceof Error &&
        (error.message.includes("duplicate") ||
          error.message.includes("unique") ||
          error.message.includes("constraint"));
      if (!mappingConflict) {
        throw error;
      }

      // Concurrent insert race: reload and enforce consistency.
      const concurrent = await db.query.arenaInvitedWallets.findFirst({
        where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
      });
      if (!concurrent) {
        throw error;
      }
      if (concurrent.inviteCode !== params.inviteCode) {
        throw new Error("Wallet is already linked to a different invite code");
      }
      if (!concurrent.firstBetId && params.firstBetId) {
        await db
          .update(schema.arenaInvitedWallets)
          .set({
            firstBetId: params.firstBetId,
            updatedAt: nowMs(),
          })
          .where(eq(schema.arenaInvitedWallets.id, concurrent.id));
      }
    }
  }

  public async resolveReferralForWallet(params: {
    wallet: string;
    betId: string;
    inviteCode: string | null;
  }): Promise<{ inviteCode: string; inviterWallet: string } | null> {
    const db = this.ctx.getDb();
    if (!db) return null;

    const wallet = normalizeWallet(params.wallet);

    if (params.inviteCode?.trim()) {
      const code = normalizeInviteCode(params.inviteCode);
      const invite = await db.query.arenaInviteCodes.findFirst({
        where: eq(schema.arenaInviteCodes.code, code),
      });
      if (!invite) {
        throw new Error("Invite code not found");
      }
      if (await this.isSelfReferralIdentity(wallet, invite.inviterWallet)) {
        throw new Error("You cannot use your own invite code");
      }
      if (await this.areWalletsLinked(wallet, invite.inviterWallet)) {
        throw new Error("You cannot use an invite code from a linked wallet");
      }

      const existing = await this.findReferralMappingForWalletNetwork(wallet);
      if (existing && existing.inviteCode !== code) {
        throw new Error(
          "Referral bindings are permanent and cannot be changed",
        );
      }

      await this.ensureWalletInviteMapping({
        wallet,
        inviteCode: code,
        inviterWallet: invite.inviterWallet,
        firstBetId: params.betId,
      });

      return {
        inviteCode: code,
        inviterWallet: invite.inviterWallet,
      };
    }

    const existing = await this.findReferralMappingForWalletNetwork(wallet);
    if (!existing) return null;

    await this.ensureWalletInviteMapping({
      wallet,
      inviteCode: existing.inviteCode,
      inviterWallet: existing.inviterWallet,
      firstBetId: existing.firstBetId ?? params.betId,
    });

    return {
      inviteCode: existing.inviteCode,
      inviterWallet: existing.inviterWallet,
    };
  }

  public async areWalletsLinked(
    walletA: string,
    walletB: string,
  ): Promise<boolean> {
    if (walletA === walletB) return true;
    try {
      const linkedWallets = await this.listLinkedWallets(walletA);
      return linkedWallets.includes(walletB);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Wallet linking
  // ---------------------------------------------------------------------------

  public async linkWallets(params: {
    wallet: string;
    walletPlatform: ArenaFeeChain;
    linkedWallet: string;
    linkedWalletPlatform: ArenaFeeChain;
  }): Promise<WalletLinkResult> {
    const db = this.ctx.getDb();
    if (!db) {
      throw new Error("Database unavailable");
    }

    const walletPlatform = normalizeFeeChain(params.walletPlatform);
    const linkedWalletPlatform = normalizeFeeChain(params.linkedWalletPlatform);
    const wallet = normalizeWalletForChain(params.wallet, walletPlatform);
    const linkedWallet = normalizeWalletForChain(
      params.linkedWallet,
      linkedWalletPlatform,
    );

    if (wallet === linkedWallet) {
      throw new Error("Cannot link the same wallet");
    }
    if (
      walletChainFamily(walletPlatform) ===
      walletChainFamily(linkedWalletPlatform)
    ) {
      throw new Error("Wallet links only support EVM↔Solana connections");
    }

    const pairKey = walletLinkPairKey({
      leftWallet: wallet,
      leftPlatform: walletPlatform,
      rightWallet: linkedWallet,
      rightPlatform: linkedWalletPlatform,
    });

    const existingLink = await db.query.arenaWalletLinks.findFirst({
      where: eq(schema.arenaWalletLinks.pairKey, pairKey),
    });
    if (existingLink) {
      return {
        wallet,
        walletPlatform,
        linkedWallet,
        linkedWalletPlatform,
        alreadyLinked: true,
        awardedPoints: 0,
        propagatedInviteCode: null,
        inviterWallet: null,
      };
    }

    const leftReferral = await this.findReferralMappingForWalletNetwork(wallet);
    const rightReferral =
      await this.findReferralMappingForWalletNetwork(linkedWallet);

    if (
      leftReferral &&
      rightReferral &&
      leftReferral.inviteCode !== rightReferral.inviteCode
    ) {
      throw new Error(
        "Linked wallets are associated with different invite codes",
      );
    }

    const propagatedReferral = leftReferral ?? rightReferral;

    const inserted = await db
      .insert(schema.arenaWalletLinks)
      .values({
        walletA: wallet,
        walletAPlatform: walletPlatform,
        walletB: linkedWallet,
        walletBPlatform: linkedWalletPlatform,
        pairKey,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })
      .onConflictDoNothing({
        target: [schema.arenaWalletLinks.pairKey],
      })
      .returning({
        id: schema.arenaWalletLinks.id,
      });
    if (inserted.length === 0) {
      return {
        wallet,
        walletPlatform,
        linkedWallet,
        linkedWalletPlatform,
        alreadyLinked: true,
        awardedPoints: 0,
        propagatedInviteCode: null,
        inviterWallet: null,
      };
    }

    if (propagatedReferral) {
      await this.ensureWalletInviteMapping({
        wallet,
        inviteCode: propagatedReferral.inviteCode,
        inviterWallet: propagatedReferral.inviterWallet,
        firstBetId: propagatedReferral.firstBetId ?? null,
      });
      await this.ensureWalletInviteMapping({
        wallet: linkedWallet,
        inviteCode: propagatedReferral.inviteCode,
        inviterWallet: propagatedReferral.inviterWallet,
        firstBetId: propagatedReferral.firstBetId ?? null,
      });
    }

    let awardedPoints = ArenaWalletService.WALLET_LINK_BONUS_POINTS;
    if (db.query?.arenaPoints?.findFirst) {
      try {
        const existingBonus = await db.query.arenaPoints.findFirst({
          where: and(
            eq(schema.arenaPoints.wallet, wallet),
            sql`${schema.arenaPoints.betId} LIKE 'wallet-link:%'`,
          ),
        });
        if (existingBonus) {
          awardedPoints = 0;
        }
      } catch (error: unknown) {
        this.ctx.logTableMissingError(error);
      }
    }

    if (awardedPoints > 0) {
      const initiatorReferral =
        await this.findReferralMappingForWalletNetwork(wallet);
      const betId = `wallet-link:${pairKey}:${wallet}`;
      await this.awardFlatPoints({
        wallet,
        points: awardedPoints,
        betId,
        referral: initiatorReferral
          ? {
              inviteCode: initiatorReferral.inviteCode,
              inviterWallet: initiatorReferral.inviterWallet,
            }
          : null,
      });
    }

    return {
      wallet,
      walletPlatform,
      linkedWallet,
      linkedWalletPlatform,
      alreadyLinked: false,
      awardedPoints,
      propagatedInviteCode: propagatedReferral?.inviteCode ?? null,
      inviterWallet: propagatedReferral?.inviterWallet ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Invite code redemption
  // ---------------------------------------------------------------------------

  public async redeemInviteCode(params: {
    wallet: string;
    inviteCode: string;
  }): Promise<InviteRedemptionResult> {
    const db = this.ctx.getDb();
    if (!db) {
      throw new Error("Database unavailable");
    }

    const wallet = normalizeWallet(params.wallet);
    const inviteCode = normalizeInviteCode(params.inviteCode);

    const invite = await db.query.arenaInviteCodes.findFirst({
      where: eq(schema.arenaInviteCodes.code, inviteCode),
    });
    if (!invite) {
      throw new Error("Invite code not found");
    }
    if (await this.isSelfReferralIdentity(wallet, invite.inviterWallet)) {
      throw new Error("You cannot use your own invite code");
    }
    if (await this.areWalletsLinked(wallet, invite.inviterWallet)) {
      throw new Error("You cannot use an invite code from a linked wallet");
    }

    const existing = await this.findReferralMappingForWalletNetwork(wallet);
    if (existing && existing.inviteCode !== inviteCode) {
      throw new Error("Referral bindings are permanent and cannot be changed");
    }

    const oneDayAgo = nowMs() - ArenaWalletService.ONE_DAY_MS;
    const recentReferrals = await db
      .select({ count: sql<number>`COUNT(*)`.as("count") })
      .from(schema.arenaInvitedWallets)
      .where(
        and(
          eq(schema.arenaInvitedWallets.inviterWallet, invite.inviterWallet),
          gt(schema.arenaInvitedWallets.createdAt, oneDayAgo),
        ),
      );
    if (
      Number(recentReferrals[0]?.count ?? 0) >=
      ArenaWalletService.REFERRAL_VELOCITY_MAX_PER_DAY
    ) {
      throw new Error(
        "This referrer has reached the maximum referrals for today. Please try again later.",
      );
    }

    const direct = await db.query.arenaInvitedWallets.findFirst({
      where: eq(schema.arenaInvitedWallets.invitedWallet, wallet),
    });
    if (direct) {
      return {
        wallet,
        inviteCode: direct.inviteCode,
        inviterWallet: direct.inviterWallet,
        alreadyLinked: true,
        signupBonus: 0,
      };
    }

    await this.ensureWalletInviteMapping({
      wallet,
      inviteCode,
      inviterWallet: invite.inviterWallet,
      firstBetId: null,
    });

    await this.awardSignupBonusReferee(
      wallet,
      inviteCode,
      invite.inviterWallet,
    );
    await this.awardSignupBonusReferrer(
      invite.inviterWallet,
      wallet,
      inviteCode,
    );

    return {
      wallet,
      inviteCode,
      inviterWallet: invite.inviterWallet,
      alreadyLinked: false,
      signupBonus: ArenaWalletService.SIGNUP_BONUS_REFEREE,
    };
  }

  // ---------------------------------------------------------------------------
  // Invite summary
  // ---------------------------------------------------------------------------

  public async getInviteSummary(
    walletRaw: string,
    platformRaw?: string | null,
  ): Promise<InviteSummary> {
    const wallet = normalizeWallet(walletRaw);
    const platformView = normalizeFeePlatform(platformRaw);
    const feeChains = feeChainsForPlatform(platformView);
    const db = this.ctx.getDb();

    if (!db) {
      return {
        wallet,
        platformView,
        inviteCode: this.buildInviteCode(wallet, 0),
        invitedWalletCount: 0,
        invitedWallets: [],
        invitedWalletsTruncated: false,
        pointsFromReferrals: 0,
        feeShareFromReferralsGold: "0",
        treasuryFeesFromReferredBetsGold: "0",
        referredByWallet: null,
        referredByCode: null,
        activeReferralCount: 0,
        pendingSignupBonuses: 0,
        totalReferralWinPoints: 0,
      };
    }

    const inviteCode = await this.getOrCreateInviteCode(wallet);

    const [links, invitedCountRows, referralPointRows, feeRows, referredBy] =
      await Promise.all([
        db.query.arenaInvitedWallets.findMany({
          where: eq(schema.arenaInvitedWallets.inviterWallet, wallet),
          orderBy: desc(schema.arenaInvitedWallets.createdAt),
          limit: 500,
        }),
        db
          .select({
            count: sql<number>`COUNT(*)`.as("count"),
          })
          .from(schema.arenaInvitedWallets)
          .where(eq(schema.arenaInvitedWallets.inviterWallet, wallet)),
        db
          .select({
            totalPoints:
              sql<number>`COALESCE(SUM(${schema.arenaReferralPoints.totalPoints}), 0)`.as(
                "totalPoints",
              ),
          })
          .from(schema.arenaReferralPoints)
          .where(eq(schema.arenaReferralPoints.inviterWallet, wallet)),
        db
          .select({
            inviterFeeGold:
              sql<string>`COALESCE(SUM((${schema.arenaFeeShares.inviterFeeGold})::numeric), 0)::text`.as(
                "inviterFeeGold",
              ),
            treasuryFeeGold:
              sql<string>`COALESCE(SUM((${schema.arenaFeeShares.treasuryFeeGold})::numeric), 0)::text`.as(
                "treasuryFeeGold",
              ),
          })
          .from(schema.arenaFeeShares)
          .where(
            and(
              eq(schema.arenaFeeShares.inviterWallet, wallet),
              inArray(schema.arenaFeeShares.chain, feeChains),
            ),
          ),
        this.findReferralMappingForWalletNetwork(wallet),
      ]);

    const invitedWalletCount = Number(invitedCountRows[0]?.count ?? 0);
    const pointsFromReferrals = Number(referralPointRows[0]?.totalPoints ?? 0);
    const feeShareFromReferralsGold = feeRows[0]?.inviterFeeGold ?? "0";
    // Legacy response field name; sourced from legacy column storing market-maker fee share.
    const treasuryFeesFromReferredBetsGold = feeRows[0]?.treasuryFeeGold ?? "0";

    let activeReferralCount = 0;
    let pendingSignupBonuses = 0;
    let totalReferralWinPoints = 0;
    try {
      const activeRows = await db
        .select({
          count:
            sql<number>`COUNT(DISTINCT ${schema.arenaInvitedWallets.invitedWallet})`.as(
              "count",
            ),
        })
        .from(schema.arenaInvitedWallets)
        .where(
          and(
            eq(schema.arenaInvitedWallets.inviterWallet, wallet),
            sql`${schema.arenaInvitedWallets.firstBetId} IS NOT NULL`,
          ),
        );
      activeReferralCount = Number(activeRows[0]?.count ?? 0);

      const pendingRows = await db
        .select({
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(schema.arenaPointLedger)
        .where(
          and(
            eq(schema.arenaPointLedger.wallet, wallet),
            eq(schema.arenaPointLedger.eventType, "SIGNUP_REFERRER"),
            eq(schema.arenaPointLedger.status, "PENDING"),
          ),
        );
      pendingSignupBonuses = Number(pendingRows[0]?.count ?? 0);

      const winRefRows = await db
        .select({
          totalPoints:
            sql<number>`COALESCE(SUM(${schema.arenaPointLedger.totalPoints}), 0)`.as(
              "totalPoints",
            ),
        })
        .from(schema.arenaPointLedger)
        .where(
          and(
            eq(schema.arenaPointLedger.wallet, wallet),
            eq(schema.arenaPointLedger.eventType, "REFERRAL_WIN"),
            eq(schema.arenaPointLedger.status, "CONFIRMED"),
          ),
        );
      totalReferralWinPoints = Number(winRefRows[0]?.totalPoints ?? 0);
    } catch (error: unknown) {
      this.ctx.logTableMissingError(error);
    }

    return {
      wallet,
      platformView,
      inviteCode,
      invitedWalletCount,
      invitedWallets: links.map((row) => row.invitedWallet),
      invitedWalletsTruncated: invitedWalletCount > links.length,
      pointsFromReferrals,
      feeShareFromReferralsGold,
      treasuryFeesFromReferredBetsGold,
      referredByWallet: referredBy?.inviterWallet ?? null,
      referredByCode: referredBy?.inviteCode ?? null,
      activeReferralCount,
      pendingSignupBonuses,
      totalReferralWinPoints,
    };
  }
}
