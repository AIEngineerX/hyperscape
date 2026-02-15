/**
 * Health Routes Module - Server health and status endpoints
 *
 * Provides endpoints for monitoring server health and retrieving current
 * server status including uptime and connected players.
 *
 * Endpoints:
 * - GET /health - Basic health check (uptime, timestamp)
 * - GET /status - Detailed status (world time, connected players, commit hash)
 *
 * ## Production Monitoring Setup
 *
 * These endpoints must be configured with external monitoring:
 * - **Railway**: Use Railway's built-in health checks pointing to /health
 * - **External**: Configure uptime monitoring (e.g., UptimeRobot, Pingdom) to poll /health
 * - **Alerting**: Set up alerts for non-200 responses or high response times
 *
 * **Important**: These endpoints only provide data - they do NOT send alerts.
 * You must configure external monitoring to poll these endpoints and trigger alerts.
 *
 * Usage:
 * ```typescript
 * import { registerHealthRoutes } from './routes/health-routes';
 * registerHealthRoutes(fastify, world, config);
 * ```
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { World } from "@hyperscape/shared";
import type { ServerConfig } from "../config.js";
import { DatabaseSystem } from "../../systems/DatabaseSystem/index.js";

/**
 * Register health and status endpoints
 *
 * Sets up monitoring endpoints that return server health metrics
 * and current game state information.
 *
 * @param fastify - Fastify server instance
 * @param world - Game world instance
 * @param config - Server configuration
 */
export function registerHealthRoutes(
  fastify: FastifyInstance,
  world: World,
  config: ServerConfig,
): void {
  // Basic health check
  fastify.get(
    "/health",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const databaseSystem = world.getSystem("database") as
        | DatabaseSystem
        | undefined;
      const databaseHealth = databaseSystem
        ? await databaseSystem.checkHealthAsync()
        : {
            healthy: false,
            latencyMs: 0,
            error: "Database system not available",
          };

      const health = {
        status: databaseHealth.healthy ? "ok" : "error",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: databaseHealth,
      };

      return reply.code(databaseHealth.healthy ? 200 : 503).send(health);
    },
  );

  // Detailed status with connected players
  fastify.get(
    "/status",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const status = {
        uptime: Math.round(world.time),
        protected: config.adminCode !== undefined,
        connectedUsers: [] as Array<{
          id: string;
          position: number[];
          name: string;
        }>,
        commitHash: config.commitHash,
      };

      // Import type from our local types
      const network =
        world.network as unknown as import("../../types.js").ServerNetworkWithSockets;

      for (const socket of network.sockets.values()) {
        if (socket.player?.node?.position) {
          const pos = socket.player.node.position;
          status.connectedUsers.push({
            id: socket.player.data.userId as string,
            position: [pos.x, pos.y, pos.z],
            name: socket.player.data.name as string,
          });
        }
      }

      return reply.code(200).send(status);
    },
  );
}
