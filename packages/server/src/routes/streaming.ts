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
import { getStreamingDuelScheduler } from "../systems/StreamingDuelScheduler/index.js";
import { getRTMPBridge } from "../streaming/index.js";

/**
 * Register streaming routes
 */
export function registerStreamingRoutes(fastify: FastifyInstance): void {
  // Get current streaming state
  fastify.get(
    "/api/streaming/state",
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

  // Get leaderboard
  fastify.get(
    "/api/streaming/leaderboard",
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

  // Get streaming configuration
  fastify.get(
    "/api/streaming/config",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        enabled: process.env.STREAMING_DUEL_ENABLED !== "false",
        cycleDuration: 15 * 60 * 1000, // 15 minutes
        announcementDuration: 5 * 60 * 1000, // 5 minutes
        fightDuration: 10 * 60 * 1000, // 10 minutes (including end warning)
        wsUrl: process.env.PUBLIC_WS_URL || "ws://localhost:5555/ws",
      });
    },
  );

  // Get RTMP bridge status
  fastify.get(
    "/api/streaming/rtmp/status",
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
