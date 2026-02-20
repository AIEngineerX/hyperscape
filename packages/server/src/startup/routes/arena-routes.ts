import type { FastifyInstance } from "fastify";
import type { World } from "@hyperscape/shared";
import { ArenaService } from "../../arena/ArenaService.js";
import type {
  ArenaWhitelistUpsertInput,
  BetQuoteRequest,
  ClaimBuildRequest,
  IngestDepositRequest,
} from "../../arena/types.js";

/**
 * Register streamed arena + Solana betting endpoints.
 *
 * The arena loop is initialized lazily at route registration time so it runs
 * continuously while the server is online.
 */
export function registerArenaRoutes(
  fastify: FastifyInstance,
  world: World,
): void {
  const arena = ArenaService.forWorld(world);
  arena.init();
  void arena.hydrateRecentRounds();

  fastify.get("/api/arena/current", async (_request, reply) => {
    return reply.send({
      round: arena.getCurrentRound(),
    });
  });

  fastify.get<{
    Querystring: { limit?: string };
  }>("/api/arena/rounds", async (request, reply) => {
    const limit = Number(request.query.limit ?? "20");
    return reply.send({
      rounds: arena.listRecentRounds(Number.isFinite(limit) ? limit : 20),
    });
  });

  fastify.get<{
    Params: { roundId: string };
  }>("/api/arena/round/:roundId", async (request, reply) => {
    const round = arena.getRound(request.params.roundId);
    if (!round) {
      return reply.code(404).send({ error: "Round not found" });
    }
    return reply.send({ round });
  });

  fastify.get<{
    Params: { roundId: string };
  }>("/api/arena/market/:roundId", async (request, reply) => {
    const round = arena.getRound(request.params.roundId);
    if (!round?.market) {
      return reply.code(404).send({ error: "Market not found for round" });
    }
    return reply.send({ market: round.market });
  });

  fastify.get("/api/arena/stream-state", async (_request, reply) => {
    const round = arena.getCurrentRound();
    if (!round) {
      return reply.send({
        state: "IDLE",
        cameraMode: "PREVIEW",
        splitScreen: true,
        previewAgents: [],
      });
    }

    const previewAgents = [round.previewAgentAId, round.previewAgentBId].filter(
      Boolean,
    ) as string[];
    const activeDuelists = [round.agentAId, round.agentBId];

    return reply.send({
      state: round.phase,
      cameraMode: round.phase === "DUEL_ACTIVE" ? "DUEL" : "PREVIEW",
      splitScreen: true,
      duelCameraLayout: "SIDE_BY_SIDE",
      previewAgents,
      activeDuelists,
    });
  });

  fastify.get<{
    Querystring: { limit?: string };
  }>("/api/arena/whitelist", async (request, reply) => {
    const limit = Number(request.query.limit ?? "200");
    const entries = await arena.listWhitelist(
      Number.isFinite(limit) ? limit : 200,
    );
    return reply.send({ entries });
  });

  fastify.put<{
    Params: { characterId: string };
    Body: Omit<ArenaWhitelistUpsertInput, "characterId">;
  }>("/api/arena/whitelist/:characterId", async (request, reply) => {
    try {
      const entry = await arena.upsertWhitelist({
        characterId: request.params.characterId,
        ...request.body,
      });
      return reply.send({ success: true, entry });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "Failed to update whitelist",
      });
    }
  });

  fastify.delete<{
    Params: { characterId: string };
  }>("/api/arena/whitelist/:characterId", async (request, reply) => {
    const removed = await arena.removeWhitelist(request.params.characterId);
    return reply.send({ success: removed });
  });

  fastify.post<{
    Body: BetQuoteRequest;
  }>("/api/arena/bet/quote", async (request, reply) => {
    try {
      const quote = await arena.buildBetQuote(request.body);
      return reply.send({ quote });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to build quote",
      });
    }
  });

  fastify.post<{
    Body: {
      roundId: string;
      bettorWallet: string;
      side: "A" | "B";
      sourceAsset: "GOLD" | "SOL" | "USDC";
      sourceAmount: string;
      goldAmount: string;
      txSignature?: string;
      quoteJson?: Record<string, unknown>;
      inviteCode?: string;
    };
  }>("/api/arena/bet/record", async (request, reply) => {
    const {
      roundId,
      bettorWallet,
      side,
      sourceAsset,
      sourceAmount,
      goldAmount,
      txSignature,
      quoteJson,
      inviteCode,
    } = request.body;

    if (
      !roundId ||
      !bettorWallet ||
      !side ||
      !sourceAsset ||
      !sourceAmount ||
      !goldAmount ||
      (sourceAsset !== "GOLD" &&
        sourceAsset !== "SOL" &&
        sourceAsset !== "USDC")
    ) {
      return reply.code(400).send({
        error:
          "Missing required fields: roundId, bettorWallet, side, sourceAsset (GOLD|SOL|USDC), sourceAmount, goldAmount",
      });
    }

    try {
      const betId = await arena.recordBet({
        roundId,
        bettorWallet,
        side,
        sourceAsset,
        sourceAmount,
        goldAmount,
        txSignature: txSignature ?? null,
        quoteJson: quoteJson ?? null,
        inviteCode: inviteCode ?? null,
      });

      return reply.send({ success: true, betId });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to record bet",
      });
    }
  });

  fastify.post<{
    Body: {
      bettorWallet: string;
      chain: "SOLANA" | "BSC" | "BASE";
      sourceAsset: "GOLD" | "SOL" | "USDC";
      sourceAmount: string;
      goldAmount: string;
      txSignature?: string;
      inviteCode?: string;
      externalBetRef?: string;
      marketPda?: string;
      skipPoints?: boolean;
    };
  }>("/api/arena/bet/record-external", async (request, reply) => {
    const configuredWriteKey =
      process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ?? "";
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !configuredWriteKey) {
      return reply.code(503).send({
        error: "External bet recording is disabled on this server",
      });
    }
    if (configuredWriteKey) {
      const providedWriteKeyHeader = request.headers["x-arena-write-key"];
      const providedWriteKey = Array.isArray(providedWriteKeyHeader)
        ? providedWriteKeyHeader[0]
        : providedWriteKeyHeader;
      if (!providedWriteKey || providedWriteKey !== configuredWriteKey) {
        return reply
          .code(401)
          .send({ error: "Unauthorized external bet write" });
      }
    }

    const {
      bettorWallet,
      chain,
      sourceAsset,
      sourceAmount,
      goldAmount,
      txSignature,
      inviteCode,
      externalBetRef,
      marketPda,
      skipPoints,
    } = request.body;

    if (
      !bettorWallet ||
      !chain ||
      !sourceAsset ||
      !sourceAmount ||
      !goldAmount ||
      !txSignature ||
      (sourceAsset !== "GOLD" &&
        sourceAsset !== "SOL" &&
        sourceAsset !== "USDC")
    ) {
      return reply.code(400).send({
        error:
          "Missing required fields: bettorWallet, chain, sourceAsset (GOLD|SOL|USDC), sourceAmount, goldAmount, txSignature",
      });
    }

    try {
      const betId = await arena.recordExternalBet({
        bettorWallet,
        chain,
        sourceAsset,
        sourceAmount,
        goldAmount,
        feeBps: 100,
        txSignature: txSignature ?? null,
        inviteCode: inviteCode ?? null,
        externalBetRef: externalBetRef ?? null,
        marketPda: marketPda ?? null,
        skipPoints: skipPoints === true,
      });
      return reply.send({ success: true, betId });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to record external bet",
      });
    }
  });

  fastify.post<{
    Body: ClaimBuildRequest;
  }>("/api/arena/claim/build", async (request, reply) => {
    try {
      const claim = arena.buildClaimInfo(request.body);
      return reply.send({ claim });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to build claim",
      });
    }
  });

  fastify.get<{
    Querystring: { roundId: string; side: "A" | "B" };
  }>("/api/arena/deposit/address", async (request, reply) => {
    try {
      const response = arena.buildDepositAddress({
        roundId: request.query.roundId,
        side: request.query.side,
      });
      return reply.send(response);
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to build deposit address",
      });
    }
  });

  fastify.post<{
    Body: IngestDepositRequest;
  }>("/api/arena/deposit/ingest", async (request, reply) => {
    try {
      const settled = await arena.ingestDepositBySignature(request.body);
      return reply.send({ settled });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "Failed to ingest deposit",
      });
    }
  });

  fastify.get<{
    Querystring: { limit?: string; status?: string };
  }>("/api/arena/payout/jobs", async (request, reply) => {
    const limit = Number(request.query.limit ?? "50");
    const jobs = await arena.listPayoutJobs({
      limit: Number.isFinite(limit) ? limit : 50,
      status: request.query.status,
    });
    return reply.send({ jobs });
  });

  fastify.post<{
    Params: { id: string };
    Body: {
      status: "PENDING" | "PROCESSING" | "PAID" | "FAILED";
      claimSignature?: string;
      lastError?: string;
      nextAttemptAt?: number;
    };
  }>("/api/arena/payout/jobs/:id/result", async (request, reply) => {
    const ok = await arena.markPayoutJobResult({
      id: request.params.id,
      status: request.body.status,
      claimSignature: request.body.claimSignature ?? null,
      lastError: request.body.lastError ?? null,
      nextAttemptAt: request.body.nextAttemptAt ?? null,
    });
    if (!ok) {
      return reply.code(404).send({ error: "Payout job not found" });
    }
    return reply.send({ success: true });
  });

  // ============================================================================
  // Points System Endpoints
  // ============================================================================

  fastify.get<{
    Params: { wallet: string };
    Querystring: { platform?: string };
  }>("/api/arena/invite/:wallet", async (request, reply) => {
    try {
      const summary = await arena.getInviteSummary(
        request.params.wallet,
        request.query.platform ?? null,
      );
      return reply.send(summary);
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch invite info",
      });
    }
  });

  fastify.post<{
    Body: {
      wallet?: string;
      walletPlatform?: "SOLANA" | "BSC" | "BASE";
      linkedWallet?: string;
      linkedWalletPlatform?: "SOLANA" | "BSC" | "BASE";
    };
  }>("/api/arena/wallet-link", async (request, reply) => {
    const wallet = request.body.wallet?.trim();
    const walletPlatform = request.body.walletPlatform?.trim();
    const linkedWallet = request.body.linkedWallet?.trim();
    const linkedWalletPlatform = request.body.linkedWalletPlatform?.trim();
    const configuredWriteKey =
      process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ?? "";
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !configuredWriteKey) {
      return reply.code(503).send({
        error: "Wallet-link writes are disabled on this server",
      });
    }
    if (configuredWriteKey) {
      const providedWriteKeyHeader = request.headers["x-arena-write-key"];
      const providedWriteKey = Array.isArray(providedWriteKeyHeader)
        ? providedWriteKeyHeader[0]
        : providedWriteKeyHeader;
      if (!providedWriteKey || providedWriteKey !== configuredWriteKey) {
        return reply
          .code(401)
          .send({ error: "Unauthorized wallet-link write" });
      }
    }

    if (!wallet || !walletPlatform || !linkedWallet || !linkedWalletPlatform) {
      return reply.code(400).send({
        error:
          "Missing required fields: wallet, walletPlatform, linkedWallet, linkedWalletPlatform",
      });
    }

    try {
      const result = await arena.linkWallets({
        wallet,
        walletPlatform: walletPlatform as "SOLANA" | "BSC" | "BASE",
        linkedWallet,
        linkedWalletPlatform: linkedWalletPlatform as "SOLANA" | "BSC" | "BASE",
      });
      return reply.send({ success: true, result });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "Failed to link wallets",
      });
    }
  });

  fastify.post<{
    Body: { wallet?: string; inviteCode?: string };
  }>("/api/arena/invite/redeem", async (request, reply) => {
    const configuredWriteKey =
      process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ?? "";
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !configuredWriteKey) {
      return reply.code(503).send({
        error: "Invite redeem writes are disabled on this server",
      });
    }
    if (configuredWriteKey) {
      const providedWriteKeyHeader = request.headers["x-arena-write-key"];
      const providedWriteKey = Array.isArray(providedWriteKeyHeader)
        ? providedWriteKeyHeader[0]
        : providedWriteKeyHeader;
      if (!providedWriteKey || providedWriteKey !== configuredWriteKey) {
        return reply.code(401).send({ error: "Unauthorized invite write" });
      }
    }

    const wallet = request.body.wallet?.trim();
    const inviteCode = request.body.inviteCode?.trim();
    if (!wallet || !inviteCode) {
      return reply.code(400).send({
        error: "Missing required fields: wallet, inviteCode",
      });
    }

    try {
      const result = await arena.redeemInviteCode({ wallet, inviteCode });
      return reply.send({ success: true, result });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "Failed to redeem invite",
      });
    }
  });

  fastify.get<{
    Params: { wallet: string };
    Querystring: { scope?: string };
  }>("/api/arena/points/:wallet", async (request, reply) => {
    try {
      const scope =
        request.query.scope?.trim().toLowerCase() === "wallet"
          ? "wallet"
          : "linked";
      const points = await arena.getWalletPoints(request.params.wallet, {
        scope,
      });
      return reply.send(points);
    } catch (error) {
      return reply.code(500).send({
        error:
          error instanceof Error ? error.message : "Failed to fetch points",
      });
    }
  });

  fastify.get<{
    Querystring: { limit?: string; scope?: string };
  }>("/api/arena/points/leaderboard", async (request, reply) => {
    try {
      const limit = Number(request.query.limit ?? "20");
      const scope =
        request.query.scope?.trim().toLowerCase() === "wallet"
          ? "wallet"
          : "linked";
      const leaderboard = await arena.getPointsLeaderboard(
        Number.isFinite(limit) ? limit : 20,
        { scope },
      );
      return reply.send({ leaderboard });
    } catch (error) {
      return reply.code(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch leaderboard",
      });
    }
  });

  fastify.get<{
    Params: { wallet: string };
  }>("/api/arena/points/multiplier/:wallet", async (request, reply) => {
    try {
      const info = await arena.getWalletGoldMultiplier(request.params.wallet);
      return reply.send(info);
    } catch (error) {
      return reply.code(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch multiplier info",
      });
    }
  });
}
