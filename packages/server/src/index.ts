/**
 * Hyperscape Server - Main entry point for the game server
 *
 * This is the primary server file that initializes and runs the Hyperscape multiplayer game server.
 * It orchestrates all startup modules in the correct sequence.
 *
 *
 * **Server Architecture**:
 * ```
 * Client (Browser) ←→ Fastify HTTP Server ←→ Hyperscape World (ECS)
 *                          ↓                        ↓
 *                    WebSocket Handler        Game Systems
 *                          ↓                   (Combat, Inventory, etc.)
 *                    ServerNetwork                 ↓
 *                          ↓              PostgreSQL + Drizzle ORM
 *                    DatabaseSystem
 * ```
 *
 * **Initialization Sequence**:
 * 1. Load polyfills (make Node.js browser-compatible for Three.js)
 * 2. Load configuration (environment variables, paths)
 * 3. Initialize database (Docker PostgreSQL, Drizzle ORM, migrations)
 * 4. Create Hyperscape World (ECS with all systems)
 * 5. Set up HTTP server (Fastify with static files)
 * 6. Register API routes (health, status, actions, uploads)
 * 7. Register WebSocket endpoint (multiplayer)
 * 8. Start listening for connections
 * 9. Register graceful shutdown handlers
 *
 * **Key Features**:
 * - **Hot Reload**: SIGUSR2 signal triggers graceful restart in development
 * - **Graceful Shutdown**: Cleans up database, WebSockets, Docker on SIGINT/SIGTERM
 * - **Modular Architecture**: Each concern is in its own module under /startup/
 * - **Production-Ready**: Proper error handling, logging, and resource cleanup
 * - **Static Assets**: Serves game assets with aggressive caching
 * - **WebSocket Multiplayer**: Real-time player synchronization
 * - **Privy Auth**: Optional wallet/social authentication
 * - **CDN Support**: Configurable asset CDN (R2, S3, local)
 *
 * **Environment Variables**:
 * See startup/config.ts for complete list of environment variables.
 *
 * **Modules**:
 * - startup/config.ts - Configuration and path resolution
 * - startup/database.ts - Database initialization and Docker management
 * - startup/world.ts - World creation and system registration
 * - startup/http-server.ts - Fastify setup and static file serving
 * - startup/api-routes.ts - REST API endpoint handlers
 * - startup/websocket.ts - WebSocket connection handling
 * - startup/shutdown.ts - Graceful shutdown and cleanup
 *
 * **Referenced by**: Package scripts (npm run dev, npm start), Docker containers
 */

// ============================================================================
// POLYFILLS - MUST BE FIRST
// ============================================================================
// Load polyfills before ANY other imports to set up browser-like globals
// for Three.js and other client libraries running on the server.
import "./shared/polyfills.js";

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
 *
 * @returns Promise that resolves when server is fully initialized
 * @throws Error if initialization fails at any stage
 *
 * @public
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

  // Step 3b: Initialize Web3 (optional, only when MODE=web3)
  let web3Context: import("./startup/web3.js").Web3Context | null = null;
  if (process.env.MODE === "web3") {
    console.log("[Server] Step 3b: Initializing Web3 mode...");
    const { initializeWeb3 } = await import("./startup/web3.js");
    web3Context = await initializeWeb3(world);
    console.log(
      "[Server] ✅ Web3 mode initialized (optimistic chain writes active)",
    );
  }

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
  // NOTE: Agent system disabled due to ElizaOS PGLite initialization bug
  // The bug is that ensureAgentExists() is called before runPluginMigrations()
  // causing SELECT queries on non-existent tables. Re-enable when fixed.
  const disableAgents = process.env.DISABLE_AGENTS !== "false";
  if (disableAgents) {
    console.log(
      "[Server] Step 8/8: Agent system disabled (DISABLE_AGENTS=true)",
    );
    console.log("[Server] ✅ Skipped agent initialization");
  } else {
    console.log("[Server] Step 8/8: Initializing embedded agents...");
    const agentManager = await initializeAgents(world, {
      autoStartAgents: process.env.AUTO_START_AGENTS !== "false",
    });
    console.log(
      `[Server] ✅ Embedded agents initialized (${agentManager.getAllAgents().length} agent(s))`,
    );
  }

  // Register shutdown handlers
  registerShutdownHandlers(fastify, world, dbContext);

  // Register Web3 shutdown hook (flushes pending chain writes)
  if (web3Context) {
    process.on("beforeExit", async () => {
      await web3Context.shutdown();
    });
  }

  const gameMode = process.env.MODE === "web3" ? "web3" : "web2";

  console.log("=".repeat(60));
  console.log("✅ Hyperscape Server Ready");
  console.log("=".repeat(60));
  console.log(`   Port:        ${config.port}`);
  console.log(`   Mode:        ${gameMode.toUpperCase()}`);
  if (gameMode === "web3") {
    console.log(
      `   Chain:       ${process.env.MAINNET === "true" ? "Base Mainnet" : process.env.CHAIN === "base-sepolia" ? "Base Sepolia" : "Anvil (Local)"}`,
    );
    console.log(`   World:       ${process.env.WORLD_ADDRESS ?? "not set"}`);
  }
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   World Dir:   ${config.worldDir}`);
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
