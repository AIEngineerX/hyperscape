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
    } = request.body;

    if (
      !roundId ||
      !bettorWallet ||
      !side ||
      !sourceAsset ||
      !sourceAmount ||
      !goldAmount
    ) {
      return reply.code(400).send({
        error:
          "Missing required fields: roundId, bettorWallet, side, sourceAsset, sourceAmount, goldAmount",
      });
    }

    const betId = await arena.recordBet({
      roundId,
      bettorWallet,
      side,
      sourceAsset,
      sourceAmount,
      goldAmount,
      txSignature: txSignature ?? null,
      quoteJson: quoteJson ?? null,
    });

    return reply.send({ success: true, betId });
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
}
