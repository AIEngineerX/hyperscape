/**
 * Streaming Mode API Routes
 *
 * Provides endpoints for streaming mode functionality:
 * - Leaderboard data
 * - Current duel state
 * - Streaming configuration
 * - RTMP bridge status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { World } from "@hyperscape/shared";
import { getStreamingDuelScheduler } from "../systems/StreamingDuelScheduler/index.js";
import { STREAMING_TIMING } from "../systems/StreamingDuelScheduler/types.js";
import { getRTMPBridge } from "../streaming/index.js";

type InventorySnapshotItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

type ThoughtSnapshot = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

type StreamingSseFrame = {
  seq: number;
  payload: string;
};

type SseSendStatus = "ok" | "closed" | "slow" | "error";
type SseDropReason =
  | "client-close"
  | "shutdown"
  | "slow-consumer"
  | "write-failed"
  | "closed-socket";

const STREAMING_SSE_REPLAY_BUFFER = Math.max(
  128,
  Number.parseInt(process.env.STREAMING_SSE_REPLAY_BUFFER || "2048", 10),
);
const STREAMING_SSE_PUSH_INTERVAL_MS = Math.max(
  250,
  Number.parseInt(process.env.STREAMING_SSE_PUSH_INTERVAL_MS || "500", 10),
);
const STREAMING_SSE_HEARTBEAT_MS = Math.max(
  5000,
  Number.parseInt(process.env.STREAMING_SSE_HEARTBEAT_MS || "15000", 10),
);
const STREAMING_SSE_MAX_PENDING_BYTES = Math.max(
  128 * 1024,
  Number.parseInt(process.env.STREAMING_SSE_MAX_PENDING_BYTES || "1048576", 10),
);

function getInventorySnapshot(
  world: World,
  characterId: string,
): InventorySnapshotItem[] {
  const inventorySystem = world.getSystem("inventory") as
    | {
        getInventoryData?: (id: string) => {
          items: Array<{
            slot?: number;
            itemId?: string;
            quantity?: number;
          }>;
        };
        getInventory?: (id: string) => {
          items: Array<{
            slot?: number;
            itemId?: string;
            quantity?: number;
          }>;
        };
      }
    | undefined;

  const sourceItems =
    inventorySystem?.getInventoryData?.(characterId)?.items ??
    inventorySystem?.getInventory?.(characterId)?.items ??
    [];

  return sourceItems
    .map((item, index) => ({
      slot: item.slot ?? index,
      itemId: item.itemId ?? "unknown",
      quantity: item.quantity ?? 1,
    }))
    .sort((a, b) => a.slot - b.slot);
}

async function getThoughtsSnapshot(
  characterId: string,
  limit: number = 10,
): Promise<ThoughtSnapshot[]> {
  const { ServerNetwork } = await import("../systems/ServerNetwork/index.js");
  const thoughts =
    (
      ServerNetwork as {
        agentThoughts?: Map<string, ThoughtSnapshot[]>;
      }
    ).agentThoughts?.get(characterId) || [];

  return thoughts.slice(0, Math.max(1, Math.min(limit, 50)));
}

/**
 * Register streaming routes
 */
export function registerStreamingRoutes(
  fastify: FastifyInstance,
  world: World,
): void {
  const sseClients = new Map<number, FastifyReply>();
  const replayFrames: StreamingSseFrame[] = [];
  const sseMetrics = {
    startedAt: Date.now(),
    totalConnected: 0,
    totalDisconnected: 0,
    peakConnected: 0,
    droppedSlowConsumers: 0,
    droppedWriteFailures: 0,
    droppedClosedSockets: 0,
    generatedFrames: 0,
    broadcastBatches: 0,
    deliveredLiveStateEvents: 0,
    deliveredReplayStateEvents: 0,
    deliveredBootstrapStateEvents: 0,
    deliveredReplayResetEvents: 0,
    deliveredUnavailableEvents: 0,
    heartbeatsSent: 0,
    heartbeatFailures: 0,
    lastFanoutDurationMs: 0,
    averageFanoutDurationMs: 0,
    maxFanoutDurationMs: 0,
    fanoutOver50Ms: 0,
    fanoutOver100Ms: 0,
  };
  let nextClientId = 1;
  let sequence = 0;
  let lastSerializedState = "";
  let statePushInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const formatSseEvent = (event: string, data: string, id?: number): string => {
    const normalizedData = data.replace(/\n/g, "\ndata: ");
    const idLine = typeof id === "number" ? `id: ${id}\n` : "";
    return `${idLine}event: ${event}\ndata: ${normalizedData}\n\n`;
  };

  const writeSseMessage = (
    reply: FastifyReply,
    message: string,
  ): SseSendStatus => {
    const raw = reply.raw;
    if (raw.destroyed || raw.writableEnded) {
      return "closed";
    }
    if (raw.writableLength > STREAMING_SSE_MAX_PENDING_BYTES) {
      return "slow";
    }

    try {
      raw.write(message);
      return "ok";
    } catch {
      return "error";
    }
  };

  const writeSseEvent = (
    reply: FastifyReply,
    event: string,
    data: string,
    id?: number,
  ): SseSendStatus => writeSseMessage(reply, formatSseEvent(event, data, id));

  const removeSseClient = (
    clientId: number,
    reason: SseDropReason = "client-close",
  ): void => {
    const clientReply = sseClients.get(clientId);
    if (!clientReply) return;

    sseClients.delete(clientId);
    sseMetrics.totalDisconnected += 1;
    if (reason === "slow-consumer") sseMetrics.droppedSlowConsumers += 1;
    if (reason === "write-failed") sseMetrics.droppedWriteFailures += 1;
    if (reason === "closed-socket") sseMetrics.droppedClosedSockets += 1;

    try {
      if (!clientReply.raw.writableEnded) {
        clientReply.raw.end();
      }
    } catch {
      // ignore socket close errors
    }
    if (sseClients.size === 0) {
      if (statePushInterval) {
        clearInterval(statePushInterval);
        statePushInterval = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }
  };

  const removeSseClientForStatus = (
    clientId: number,
    status: SseSendStatus,
  ): void => {
    if (status === "slow") {
      removeSseClient(clientId, "slow-consumer");
      return;
    }
    if (status === "error") {
      removeSseClient(clientId, "write-failed");
      return;
    }
    removeSseClient(clientId, "closed-socket");
  };

  const recordFanoutDuration = (durationMs: number): void => {
    sseMetrics.lastFanoutDurationMs = durationMs;
    sseMetrics.maxFanoutDurationMs = Math.max(
      sseMetrics.maxFanoutDurationMs,
      durationMs,
    );
    const batches = sseMetrics.broadcastBatches;
    sseMetrics.averageFanoutDurationMs =
      batches <= 1
        ? durationMs
        : (sseMetrics.averageFanoutDurationMs * (batches - 1) + durationMs) /
          batches;
    if (durationMs >= 50) sseMetrics.fanoutOver50Ms += 1;
    if (durationMs >= 100) sseMetrics.fanoutOver100Ms += 1;
  };

  const pushFrame = (event: string, frame: StreamingSseFrame): void => {
    const startedAt = Date.now();
    const message = formatSseEvent(event, frame.payload, frame.seq);
    sseMetrics.broadcastBatches += 1;
    let delivered = 0;
    for (const [clientId, clientReply] of sseClients.entries()) {
      const status = writeSseMessage(clientReply, message);
      if (status !== "ok") {
        removeSseClientForStatus(clientId, status);
        continue;
      }
      delivered += 1;
    }
    sseMetrics.deliveredLiveStateEvents += delivered;
    recordFanoutDuration(Date.now() - startedAt);
  };

  const getFirstReplayIndexAfter = (seqValue: number): number => {
    let low = 0;
    let high = replayFrames.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (replayFrames[mid].seq <= seqValue) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const captureStreamingFrame = (
    forceNewFrame = false,
  ): StreamingSseFrame | null => {
    const scheduler = getStreamingDuelScheduler();
    if (!scheduler) return null;

    const state = scheduler.getStreamingState();
    const serialized = JSON.stringify(state);
    if (
      !forceNewFrame &&
      serialized === lastSerializedState &&
      replayFrames.length > 0
    ) {
      return null;
    }

    lastSerializedState = serialized;
    sequence += 1;

    const frame: StreamingSseFrame = {
      seq: sequence,
      payload: JSON.stringify({
        ...state,
        type: "STREAMING_STATE_UPDATE",
        seq: sequence,
        emittedAt: Date.now(),
      }),
    };

    replayFrames.push(frame);
    sseMetrics.generatedFrames += 1;
    if (replayFrames.length > STREAMING_SSE_REPLAY_BUFFER) {
      replayFrames.splice(0, replayFrames.length - STREAMING_SSE_REPLAY_BUFFER);
    }

    return frame;
  };

  const startSseLoopsIfNeeded = (): void => {
    if (statePushInterval) return;

    statePushInterval = setInterval(() => {
      const frame = captureStreamingFrame(false);
      if (frame) {
        pushFrame("state", frame);
      }
    }, STREAMING_SSE_PUSH_INTERVAL_MS);

    heartbeatInterval = setInterval(() => {
      const heartbeatMessage = `:hb ${Date.now()}\n\n`;
      for (const [clientId, clientReply] of sseClients.entries()) {
        const status = writeSseMessage(clientReply, heartbeatMessage);
        if (status === "ok") {
          sseMetrics.heartbeatsSent += 1;
          continue;
        }
        sseMetrics.heartbeatFailures += 1;
        removeSseClientForStatus(clientId, status);
      }
    }, STREAMING_SSE_HEARTBEAT_MS);
  };

  fastify.addHook("onClose", (_instance, done) => {
    if (statePushInterval) {
      clearInterval(statePushInterval);
      statePushInterval = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    for (const clientId of [...sseClients.keys()]) {
      removeSseClient(clientId, "shutdown");
    }
    done();
  });

  // Get current streaming state
  fastify.get(
    "/api/streaming/state",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const scheduler = getStreamingDuelScheduler();

      if (!scheduler) {
        return reply.status(503).send({
          error: "Streaming mode not active",
          message: "The streaming duel scheduler is not running",
        });
      }

      const state = scheduler.getStreamingState();
      return reply.send(state);
    },
  );

  fastify.get(
    "/api/streaming/metrics",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        type: "STREAMING_METRICS",
        emittedAt: Date.now(),
        uptimeMs: Date.now() - sseMetrics.startedAt,
        sse: {
          config: {
            replayBuffer: STREAMING_SSE_REPLAY_BUFFER,
            pushIntervalMs: STREAMING_SSE_PUSH_INTERVAL_MS,
            heartbeatMs: STREAMING_SSE_HEARTBEAT_MS,
            maxPendingBytes: STREAMING_SSE_MAX_PENDING_BYTES,
          },
          clients: {
            connected: sseClients.size,
            peakConnected: sseMetrics.peakConnected,
            totalConnected: sseMetrics.totalConnected,
            totalDisconnected: sseMetrics.totalDisconnected,
            droppedSlowConsumers: sseMetrics.droppedSlowConsumers,
            droppedWriteFailures: sseMetrics.droppedWriteFailures,
            droppedClosedSockets: sseMetrics.droppedClosedSockets,
          },
          replay: {
            size: replayFrames.length,
            oldestSeq: replayFrames[0]?.seq ?? null,
            latestSeq: replayFrames[replayFrames.length - 1]?.seq ?? null,
          },
          events: {
            generatedFrames: sseMetrics.generatedFrames,
            broadcastBatches: sseMetrics.broadcastBatches,
            deliveredLiveStateEvents: sseMetrics.deliveredLiveStateEvents,
            deliveredReplayStateEvents: sseMetrics.deliveredReplayStateEvents,
            deliveredBootstrapStateEvents:
              sseMetrics.deliveredBootstrapStateEvents,
            deliveredReplayResetEvents: sseMetrics.deliveredReplayResetEvents,
            deliveredUnavailableEvents: sseMetrics.deliveredUnavailableEvents,
            heartbeatsSent: sseMetrics.heartbeatsSent,
            heartbeatFailures: sseMetrics.heartbeatFailures,
          },
          fanout: {
            lastDurationMs: sseMetrics.lastFanoutDurationMs,
            averageDurationMs: Number(
              sseMetrics.averageFanoutDurationMs.toFixed(3),
            ),
            maxDurationMs: sseMetrics.maxFanoutDurationMs,
            batchesOver50Ms: sseMetrics.fanoutOver50Ms,
            batchesOver100Ms: sseMetrics.fanoutOver100Ms,
          },
        },
      });
    },
  );

  // SSE push endpoint with replay support (Last-Event-ID / ?since=)
  fastify.get<{
    Querystring: { since?: string };
  }>(
    "/api/streaming/state/events",
    {
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const raw = reply.raw;
      reply.hijack();

      raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      raw.setHeader("Cache-Control", "no-cache, no-transform");
      raw.setHeader("Connection", "keep-alive");
      raw.setHeader("X-Accel-Buffering", "no");
      raw.setHeader("Access-Control-Allow-Origin", "*");
      raw.socket?.setNoDelay?.(true);
      raw.socket?.setKeepAlive?.(true, STREAMING_SSE_HEARTBEAT_MS * 2);
      raw.flushHeaders?.();
      raw.write("retry: 2000\n\n");

      const clientId = nextClientId++;
      sseClients.set(clientId, reply);
      sseMetrics.totalConnected += 1;
      sseMetrics.peakConnected = Math.max(
        sseMetrics.peakConnected,
        sseClients.size,
      );

      const headerLastEventId = request.headers["last-event-id"];
      const normalizedHeaderId = Array.isArray(headerLastEventId)
        ? headerLastEventId[0]
        : headerLastEventId;
      const querySince = Number.parseInt(request.query.since || "", 10);
      const headerSince = Number.parseInt(normalizedHeaderId || "", 10);
      const lastSeenSeq = Number.isFinite(querySince)
        ? querySince
        : Number.isFinite(headerSince)
          ? headerSince
          : 0;

      if (replayFrames.length === 0) {
        captureStreamingFrame(true);
      }

      const oldestSeq = replayFrames[0]?.seq ?? 0;
      const latestFrame = replayFrames[replayFrames.length - 1] ?? null;

      if (lastSeenSeq > 0 && latestFrame) {
        if (lastSeenSeq < oldestSeq) {
          // Gap beyond replay window: send a reset snapshot so client can resync.
          const status = writeSseEvent(
            reply,
            "reset",
            latestFrame.payload,
            latestFrame.seq,
          );
          if (status !== "ok") {
            removeSseClientForStatus(clientId, status);
            return;
          }
          sseMetrics.deliveredReplayResetEvents += 1;
        } else {
          let deliveredReplayFrames = 0;
          const replayIndex = getFirstReplayIndexAfter(lastSeenSeq);
          for (
            let index = replayIndex;
            index < replayFrames.length;
            index += 1
          ) {
            const frame = replayFrames[index];
            const status = writeSseEvent(
              reply,
              "state",
              frame.payload,
              frame.seq,
            );
            if (status !== "ok") {
              removeSseClientForStatus(clientId, status);
              return;
            }
            deliveredReplayFrames += 1;
          }
          sseMetrics.deliveredReplayStateEvents += deliveredReplayFrames;
        }
      } else if (latestFrame) {
        const status = writeSseEvent(
          reply,
          "state",
          latestFrame.payload,
          latestFrame.seq,
        );
        if (status !== "ok") {
          removeSseClientForStatus(clientId, status);
          return;
        }
        sseMetrics.deliveredBootstrapStateEvents += 1;
      } else {
        const status = writeSseEvent(
          reply,
          "unavailable",
          JSON.stringify({
            error: "Streaming mode not active",
            emittedAt: Date.now(),
          }),
        );
        if (status !== "ok") {
          removeSseClientForStatus(clientId, status);
          return;
        }
        sseMetrics.deliveredUnavailableEvents += 1;
      }

      request.raw.on("close", () => {
        removeSseClient(clientId, "client-close");
      });

      startSseLoopsIfNeeded();
    },
  );

  // Get enriched duel context (state + inventories + internal monologues)
  fastify.get(
    "/api/streaming/duel-context",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const scheduler = getStreamingDuelScheduler();
      if (!scheduler) {
        return reply.status(503).send({
          error: "Streaming mode not active",
          message: "The streaming duel scheduler is not running",
        });
      }

      const state = scheduler.getStreamingState();
      const enrichAgent = async (
        agent: {
          id: string;
          name: string;
          provider: string;
          model: string;
          hp: number;
          maxHp: number;
          combatLevel: number;
          wins: number;
          losses: number;
          damageDealtThisFight: number;
        } | null,
      ) => {
        if (!agent) return null;
        return {
          ...agent,
          inventory: getInventorySnapshot(world, agent.id),
          monologues: await getThoughtsSnapshot(agent.id, 10),
        };
      };

      return reply.send({
        type: "STREAMING_DUEL_CONTEXT",
        cycle: {
          ...state.cycle,
          agent1: await enrichAgent(state.cycle.agent1),
          agent2: await enrichAgent(state.cycle.agent2),
        },
        leaderboard: state.leaderboard,
        cameraTarget: state.cameraTarget,
      });
    },
  );

  fastify.get<{
    Params: { characterId: string };
    Querystring: { limit?: string };
  }>(
    "/api/streaming/agent/:characterId/monologues",
    {
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const limit = Number.parseInt(request.query.limit || "20", 10);
      const thoughts = await getThoughtsSnapshot(
        request.params.characterId,
        limit,
      );
      return reply.send({
        characterId: request.params.characterId,
        thoughts,
        count: thoughts.length,
      });
    },
  );

  fastify.get<{
    Params: { characterId: string };
  }>(
    "/api/streaming/agent/:characterId/inventory",
    {
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const inventory = getInventorySnapshot(world, request.params.characterId);
      return reply.send({
        characterId: request.params.characterId,
        inventory,
        count: inventory.length,
      });
    },
  );

  // Get leaderboard
  fastify.get(
    "/api/streaming/leaderboard",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const scheduler = getStreamingDuelScheduler();

      if (!scheduler) {
        return reply.status(503).send({
          error: "Streaming mode not active",
          message: "The streaming duel scheduler is not running",
        });
      }

      const leaderboard = scheduler.getLeaderboard();
      return reply.send({ leaderboard });
    },
  );

  // Get leaderboard + current duel cycle + recent duel history
  fastify.get<{
    Querystring: { historyLimit?: string };
  }>(
    "/api/streaming/leaderboard/details",
    {
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const scheduler = getStreamingDuelScheduler();

      if (!scheduler) {
        return reply.status(503).send({
          error: "Streaming mode not active",
          message: "The streaming duel scheduler is not running",
        });
      }

      const parsedLimit = Number.parseInt(
        request.query.historyLimit || "40",
        10,
      );
      const historyLimit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 200))
        : 40;

      const state = scheduler.getStreamingState();
      return reply.send({
        leaderboard: state.leaderboard,
        cycle: state.cycle,
        recentDuels: scheduler.getRecentDuels(historyLimit),
        updatedAt: Date.now(),
      });
    },
  );

  // Get streaming configuration
  fastify.get(
    "/api/streaming/config",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        enabled: process.env.STREAMING_DUEL_ENABLED !== "false",
        cycleDuration: STREAMING_TIMING.CYCLE_DURATION,
        announcementDuration: STREAMING_TIMING.ANNOUNCEMENT_DURATION,
        fightDuration: STREAMING_TIMING.FIGHTING_DURATION,
        endWarningDuration: STREAMING_TIMING.END_WARNING_DURATION,
        resolutionDuration: STREAMING_TIMING.RESOLUTION_DURATION,
        wsUrl: process.env.PUBLIC_WS_URL || "ws://localhost:5555/ws",
      });
    },
  );

  // Get RTMP bridge status
  fastify.get(
    "/api/streaming/rtmp/status",
    {
      config: { rateLimit: false },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const bridge = getRTMPBridge();
        const status = bridge.getStatus();
        const stats = bridge.getStats();

        return reply.send({
          ...status,
          stats: {
            bytesReceived: stats.bytesReceived,
            bytesReceivedMB: (stats.bytesReceived / 1024 / 1024).toFixed(2),
            uptimeSeconds: Math.floor(stats.uptime / 1000),
            destinations: stats.destinations,
          },
        });
      } catch {
        return reply.status(503).send({
          error: "RTMP bridge not initialized",
          message: "The RTMP streaming bridge has not been started",
        });
      }
    },
  );
}
