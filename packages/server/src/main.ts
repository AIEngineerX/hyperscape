/**
 * Hyperscape Server - Startup orchestrator
 *
 * This module contains the actual server initialization logic.
 * It is loaded dynamically from `src/index.ts` after polyfills are installed.
 */

// Import startup modules
import { loadConfig } from "./startup/config.js";
import { initializeDatabase } from "./startup/database.js";
import { initializeWorld } from "./startup/world.js";
import { createHttpServer } from "./startup/http-server.js";
import { registerApiRoutes } from "./startup/api-routes.js";
import { registerWebSocket } from "./startup/websocket.js";
import { registerShutdownHandlers } from "./startup/shutdown.js";

// Import embedded agent system
import { initializeAgents } from "./eliza/index.js";

/**
 * Starts the Hyperscape server
 *
 * This is the main entry point for server initialization. It orchestrates
 * all startup modules in the correct sequence to bring the server online.
 *
 * The server supports hot reload in development via SIGUSR2 signal.
 */
async function startServer() {
  // Prevent duplicate server initialization
  const globalWithFlag = globalThis as typeof globalThis & {
    __HYPERSCAPE_SERVER_STARTING__?: boolean;
  };

  if (globalWithFlag.__HYPERSCAPE_SERVER_STARTING__) {
    console.log(
      "[Server] Server already starting, skipping duplicate initialization",
    );
    return;
  }

  globalWithFlag.__HYPERSCAPE_SERVER_STARTING__ = true;

  console.log("=".repeat(60));
  console.log("🚀 Hyperscape Server Starting...");
  console.log("=".repeat(60));

  // Step 1: Load configuration
  console.log("[Server] Step 1/8: Loading configuration...");
  const config = await loadConfig();
  console.log(`[Server] ✅ Configuration loaded (port: ${config.port})`);

  // Step 2: Initialize database
  console.log("[Server] Step 2/8: Initializing database...");
  const dbContext = await initializeDatabase(config);
  console.log("[Server] ✅ Database initialized");

  // Step 3: Initialize world
  console.log("[Server] Step 3/8: Initializing world...");
  const world = await initializeWorld(config, dbContext);
  console.log("[Server] ✅ World initialized");

  // Step 4: Create HTTP server
  console.log("[Server] Step 4/8: Creating HTTP server...");
  const fastify = await createHttpServer(config);
  console.log("[Server] ✅ HTTP server created");

  // Step 5: Register API routes
  console.log("[Server] Step 5/8: Registering API routes...");
  registerApiRoutes(fastify, world, config);
  console.log("[Server] ✅ API routes registered");

  // Step 6: Register WebSocket
  console.log("[Server] Step 6/8: Registering WebSocket...");
  registerWebSocket(fastify, world);
  console.log("[Server] ✅ WebSocket registered");

  // Step 7: Start listening
  console.log("[Server] Step 7/8: Starting HTTP server...");
  await fastify.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`[Server] ✅ Server listening on http://0.0.0.0:${config.port}`);

  // Step 8: Initialize embedded agents
  console.log("[Server] Step 8/8: Initializing embedded agents...");
  const agentManager = await initializeAgents(world, {
    autoStartAgents: process.env.AUTO_START_AGENTS !== "false",
  });
  console.log(
    `[Server] ✅ Embedded agents initialized (${agentManager.getAllAgents().length} agent(s))`,
  );

  // Register shutdown handlers
  registerShutdownHandlers(fastify, world, dbContext);

  console.log("=".repeat(60));
  console.log("✅ Hyperscape Server Ready");
  console.log("=".repeat(60));
  console.log(`   Port:        ${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   World:       ${config.worldDir}`);
  console.log(`   Assets:      ${config.assetsDir}`);
  console.log(`   CDN:         ${config.cdnUrl}`);
  if (config.commitHash) {
    console.log(`   Commit:      ${config.commitHash}`);
  }
  console.log("=".repeat(60));
}

// Start the server with error handling
startServer().catch((err) => {
  console.error("=".repeat(60));
  console.error("❌ FATAL ERROR DURING STARTUP");
  console.error("=".repeat(60));
  console.error(err);
  console.error("=".repeat(60));

  // Clear the flag so hot reload can retry
  const globalWithFlag = globalThis as typeof globalThis & {
    __HYPERSCAPE_SERVER_STARTING__?: boolean;
  };
  globalWithFlag.__HYPERSCAPE_SERVER_STARTING__ = false;

  process.exit(1);
});
