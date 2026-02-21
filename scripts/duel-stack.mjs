#!/usr/bin/env node
/**
 * Duel Stack Orchestrator
 *
 * Starts the full agent duel arena stack with one command:
 * - game server + client (streaming duel scheduler)
 * - duel bot matchmaker
 * - RTMP bridge fanout to public platforms
 * - betting app (devnet mode)
 * - keeper bot (devnet automation)
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { parseArgs } from "node:util";

const options = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    bots: { type: "string", short: "b", default: "4" },
    "betting-port": { type: "string", default: "4179" },
    "rtmp-port": { type: "string", default: "8765" },
    "server-url": { type: "string", default: "http://localhost:5555" },
    "ws-url": { type: "string", default: "ws://localhost:5555/ws" },
    "client-url": { type: "string", default: "http://localhost:3333" },
    "remote-betting": { type: "boolean" },
    "skip-chain-setup": { type: "boolean" },
    "skip-keeper": { type: "boolean" },
    "skip-stream": { type: "boolean" },
    "skip-betting": { type: "boolean" },
    "skip-bots": { type: "boolean" },
    fresh: { type: "boolean" },
    verify: { type: "boolean" },
    "verify-timeout-ms": { type: "string", default: "240000" },
    "startup-timeout-ms": {
      type: "string",
      default: process.env.DUEL_STARTUP_TIMEOUT_MS || "420000",
    },
    verbose: { type: "boolean", short: "v" },
  },
  strict: true,
}).values;

if (options.help) {
  console.log(`
Full Duel Stack bootstrap

Usage:
  bun run duel [options]

Options:
  -h, --help              Show this help
  -b, --bots <n>          Duel bot count (default: 4)
  --betting-port <n>      Betting app dev port (default: 4179)
  --rtmp-port <n>         RTMP bridge websocket port (default: 8765)
  --server-url <url>      Game HTTP base URL (default: http://localhost:5555)
  --ws-url <url>          Game WS URL (default: ws://localhost:5555/ws)
  --client-url <url>      Game client URL (default: http://localhost:3333)
  --remote-betting        Do not start local betting app (external platform mode)
  --skip-chain-setup      Start server without setup-chain/anvil bootstrap
  --skip-keeper           Skip devnet keeper bot
  --skip-stream           Skip RTMP bridge process
  --skip-betting          Skip betting app
  --skip-bots             Skip duel matchmaker bots
  --fresh                 Force fresh restart of game server + client
  --verify                Run startup verification checks after boot
  --verify-timeout-ms <n> Verification timeout in ms (default: 240000)
  --startup-timeout-ms <n> Readiness timeout for game/client/betting startup (default: 420000)
  -v, --verbose           Verbose status logs
`);
  process.exit(0);
}

const ROOT = process.cwd();
const bettingPort = Number.parseInt(options["betting-port"], 10);
const rtmpPort = Number.parseInt(options["rtmp-port"], 10);
const serverHttpUrl = options["server-url"].replace(/\/$/, "");
const serverWsUrl = options["ws-url"];
const clientUrl = options["client-url"].replace(/\/$/, "");
const bots = Math.max(2, Number.parseInt(options.bots, 10) || 4);
const verifyEnabled = options.verify === true;
const remoteBettingMode = options["remote-betting"] === true;
const skipChainSetup =
  options["skip-chain-setup"] === true ||
  remoteBettingMode ||
  /^(1|true|yes|on)$/i.test(process.env.DUEL_SKIP_CHAIN_SETUP || "");
const skipBettingApp = options["skip-betting"] === true || remoteBettingMode;
const verifyTimeoutMs =
  Number.parseInt(options["verify-timeout-ms"], 10) || 240_000;
const startupTimeoutMs =
  Number.parseInt(options["startup-timeout-ms"], 10) || 420_000;
const streamingStateTimeoutMs =
  Number.parseInt(process.env.DUEL_STREAMING_STATE_TIMEOUT_MS || "", 10) ||
  30_000;

const streamPageUrl = `${clientUrl}/?page=stream`;
const embeddedSpectatorUrl = `${clientUrl}/?embedded=true&mode=spectator`;
const forceWebglFallback = /^(1|true|yes|on)$/i.test(
  process.env.DUEL_FORCE_WEBGL_FALLBACK || "",
);
const disableBridgeCapture = !/^(0|false|no|off)$/i.test(
  process.env.DUEL_DISABLE_BRIDGE_CAPTURE || "",
);
const hasDisplayServer = Boolean(
  process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
);
const defaultStreamCaptureHeadless =
  process.platform === "linux" && hasDisplayServer ? "false" : "true";
const defaultStreamCaptureChannel =
  process.platform === "linux" ? "chrome" : "";
const streamCaptureUrl = withCaptureParams(streamPageUrl);
const embeddedSpectatorCaptureUrl = withCaptureParams(embeddedSpectatorUrl);
const homeCaptureUrl = withCaptureParams(`${clientUrl}/`);

const managed = [];
let shuttingDown = false;
const BUN_EXECUTABLE = process.execPath || "bun";
const BUN_BIN_DIR = path.dirname(BUN_EXECUTABLE);

function log(message) {
  console.log(`[duel] ${message}`);
}

function resolveExecutable(command) {
  if (command === "bun") {
    return BUN_EXECUTABLE;
  }
  return command;
}

function withBunOnPath(env) {
  const currentPath = env.PATH || "";
  const pathEntries = currentPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (pathEntries.includes(BUN_BIN_DIR)) {
    return env;
  }
  return {
    ...env,
    PATH: currentPath
      ? `${BUN_BIN_DIR}${path.delimiter}${currentPath}`
      : BUN_BIN_DIR,
  };
}

function withCaptureParams(rawUrl) {
  const params = [];
  if (disableBridgeCapture) {
    params.push(["disableBridgeCapture", "1"]);
  }
  if (forceWebglFallback) {
    params.push(["webglFallback", "true"]);
  }
  if (params.length === 0) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    for (const [key, value] of params) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${rawUrl}${separator}${query}`;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function spawnManaged(name, command, args, opts = {}) {
  const {
    critical = true,
    restart = false,
    restartDelayMs = 3000,
    maxRestarts = restart ? Number.POSITIVE_INFINITY : 0,
    ...spawnOptions
  } = opts;

  const entry = {
    name,
    command,
    args,
    spawnOptions,
    critical,
    restart,
    restartDelayMs: Math.max(
      250,
      Number.isFinite(restartDelayMs) ? restartDelayMs : 3000,
    ),
    maxRestarts:
      Number.isFinite(maxRestarts) && maxRestarts >= 0
        ? Math.floor(maxRestarts)
        : Number.POSITIVE_INFINITY,
    restarts: 0,
    restartTimer: null,
    proc: null,
  };

  const launch = () => {
    if (shuttingDown) return;
    const executable = resolveExecutable(command);
    const { env: spawnEnv, ...spawnOptions } = entry.spawnOptions;

    const proc = spawn(executable, args, {
      cwd: ROOT,
      env: withBunOnPath({ ...process.env, ...(spawnEnv || {}) }),
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    entry.proc = proc;

    const prefix = `[${name}]`;
    proc.stdout?.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) console.log(`${prefix} ${line}`);
    });
    proc.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) console.error(`${prefix} ${line}`);
    });
    proc.on("exit", (code, signal) => {
      entry.proc = null;
      if (shuttingDown) return;

      const canRestart =
        entry.restart &&
        (entry.restarts < entry.maxRestarts ||
          entry.maxRestarts === Number.POSITIVE_INFINITY);

      if (canRestart) {
        entry.restarts += 1;
        console.warn(
          `${prefix} exited (code=${code ?? "null"} signal=${signal ?? "null"}) - restarting in ${entry.restartDelayMs}ms (attempt ${entry.restarts})`,
        );
        entry.restartTimer = setTimeout(() => {
          entry.restartTimer = null;
          launch();
        }, entry.restartDelayMs);
        return;
      }

      if (!entry.critical) {
        console.warn(
          `${prefix} exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
        );
        return;
      }
      console.error(
        `${prefix} exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"})`,
      );
      void shutdown(1);
    });
  };

  managed.push(entry);
  launch();
  return entry;
}

function runCommand(name, command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const executable = resolveExecutable(command);
    const { env: commandEnv, ...commandOptions } = opts;
    const proc = spawn(executable, args, {
      cwd: ROOT,
      env: withBunOnPath({ ...process.env, ...(commandEnv || {}) }),
      stdio: ["ignore", "pipe", "pipe"],
      ...commandOptions,
    });

    const prefix = `[${name}]`;
    proc.stdout?.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) console.log(`${prefix} ${line}`);
    });
    proc.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) console.error(`${prefix} ${line}`);
    });
    proc.on("error", (error) => {
      reject(error);
    });
    proc.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${name} exited with code=${code ?? "null"} signal=${signal ?? "null"}`,
        ),
      );
    });
  });
}

async function waitForHttp(url, label, timeoutMs = 180_000) {
  const timeoutWindowMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000;
  const maxAttempts = Math.max(1, Math.ceil(timeoutWindowMs / 1_000));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 2_000);
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        log(`${label} ready at ${url}`);
        return;
      }
    } catch {
      // retry
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function isHttpReady(url, timeoutMs = 2_000) {
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getPortFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.port) {
      const parsedPort = Number.parseInt(parsed.port, 10);
      if (Number.isFinite(parsedPort) && parsedPort > 0) return parsedPort;
    }
    if (parsed.protocol === "https:" || parsed.protocol === "wss:") return 443;
    if (parsed.protocol === "http:" || parsed.protocol === "ws:") return 80;
  } catch {
    // ignore invalid URL
  }
  return null;
}

function getListeningPids(port) {
  if (!Number.isFinite(port) || port <= 0) return [];
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    );
    return output
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

async function clearUnhealthyListener(label, rawUrl, force = false) {
  const port = getPortFromUrl(rawUrl);
  if (!port) return;

  const pids = getListeningPids(port);
  if (pids.length === 0) return;

  if (force) {
    log(
      `${label} fresh restart requested; terminating listener(s) on port ${port}: ${pids.join(", ")}`,
    );
  } else {
    log(
      `${label} is unhealthy but port ${port} is occupied by pid(s): ${pids.join(", ")}. terminating stale listener(s)...`,
    );
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore dead/unowned pid
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const stillListening = getListeningPids(port);
  if (stillListening.length > 0) {
    for (const pid of stillListening) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore dead/unowned pid
      }
    }
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down duel stack...");

  for (const entry of [...managed].reverse()) {
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    const activeProc = entry.proc;
    if (activeProc && activeProc.exitCode == null && !activeProc.killed) {
      if (options.verbose) {
        log(`stopping ${entry.name} (pid ${activeProc.pid})`);
      }
      activeProc.kill("SIGTERM");
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const entry of managed) {
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    const proc = entry.proc;
    if (proc && proc.exitCode == null && !proc.killed) {
      proc.kill("SIGKILL");
    }
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

async function main() {
  const serverEnv = readEnvFile(path.join(ROOT, "packages/server/.env"));
  const resolvedPublicCdnUrl = (
    process.env.DUEL_PUBLIC_CDN_URL ||
    process.env.PUBLIC_CDN_URL ||
    serverEnv.PUBLIC_CDN_URL ||
    serverHttpUrl
  ).replace(/\/$/, "");
  const verifyRequiredDestinations = [];
  const externalRtmpStatusFile =
    process.env.RTMP_STATUS_FILE ||
    path.join(ROOT, ".duel-rtmp-status.json");

  try {
    fs.unlinkSync(externalRtmpStatusFile);
  } catch {
    // Ignore stale file cleanup errors.
  }

  const gameEnv = {
    ...process.env,
    ...serverEnv,
    // Duel stack should always target the local game server endpoints unless
    // explicitly overridden by duel-specific env vars.
    PUBLIC_API_URL:
      process.env.DUEL_PUBLIC_API_URL ||
      process.env.VITE_GAME_API_URL ||
      serverHttpUrl,
    PUBLIC_WS_URL:
      process.env.DUEL_PUBLIC_WS_URL ||
      process.env.VITE_GAME_WS_URL ||
      serverWsUrl,
    PUBLIC_CDN_URL: resolvedPublicCdnUrl,
    STREAMING_DUEL_ENABLED: process.env.STREAMING_DUEL_ENABLED || "true",
    DUEL_MARKET_MAKER_ENABLED:
      process.env.DUEL_MARKET_MAKER_ENABLED || "true",
    DUEL_BETTING_ENABLED: process.env.DUEL_BETTING_ENABLED || "true",
    AUTO_START_AGENTS: process.env.AUTO_START_AGENTS || "true",
    STREAMING_ANNOUNCEMENT_MS:
      process.env.STREAMING_ANNOUNCEMENT_MS || "30000",
    STREAMING_FIGHTING_MS: process.env.STREAMING_FIGHTING_MS || "150000",
    STREAMING_END_WARNING_MS:
      process.env.STREAMING_END_WARNING_MS || "10000",
    STREAMING_RESOLUTION_MS:
      process.env.STREAMING_RESOLUTION_MS || "10000",
    // Prevent duplicate RTMP publishers when duel-stack runs external
    // stream-to-rtmp capture.
    STREAMING_CAPTURE_ENABLED:
      process.env.STREAMING_CAPTURE_ENABLED ||
      (options["skip-stream"] ? "true" : "false"),
    RTMP_STATUS_FILE: externalRtmpStatusFile,
  };

  const gameServerHealthUrl = `${serverHttpUrl}/health`;
  const gameStreamingStateUrl = `${serverHttpUrl}/api/streaming/state`;
  const serverHealthReady = await isHttpReady(gameServerHealthUrl);
  const serverStreamingReady = await isHttpReady(gameStreamingStateUrl);
  let serverWasReady = serverHealthReady && serverStreamingReady;
  let clientWasReady = await isHttpReady(clientUrl);
  const forceFreshGame =
    options.fresh === true ||
    verifyEnabled ||
    process.env.DUEL_FORCE_FRESH === "true";

  if (forceFreshGame) {
    log("forcing fresh game server + client startup");
    await clearUnhealthyListener("game server", serverHttpUrl, true);
    await clearUnhealthyListener("game client", clientUrl, true);
    serverWasReady = false;
    clientWasReady = false;
  }

  if (options.verbose) {
    log(
      `initial readiness: server health=${serverHealthReady}, streaming api=${serverStreamingReady}, client=${clientWasReady}`,
    );
  }

  if (serverWasReady && clientWasReady) {
    log("reusing existing game server + client");
  } else {
    if (!serverWasReady) {
      await clearUnhealthyListener("game server", serverHttpUrl);
    }
    if (!clientWasReady) {
      await clearUnhealthyListener("game client", clientUrl);
    }

    const missing = [];
    if (!serverWasReady) {
      missing.push("server");
    }
    if (!clientWasReady) {
      missing.push("client");
    }

    log(
      `starting missing game components (${missing.join(" + ")}) while preserving any running services`,
    );

    if (!serverWasReady) {
      log("building shared package for fresh server startup...");
      await runCommand(
        "shared-build",
        "bun",
        ["run", "--cwd", "packages/shared", "build"],
        { env: gameEnv },
      );
      log("building server package for stable runtime startup...");
      await runCommand(
        "server-build",
        "bun",
        ["run", "--cwd", "packages/server", "build"],
        { env: gameEnv },
      );
      const gameServerCommand = skipChainSetup
        ? {
          command: "bun",
          args: ["--preload", "./src/shared/polyfills.ts", "./dist/index.js"],
          opts: {
            cwd: path.join(ROOT, "packages/server"),
            env: gameEnv,
          },
        }
        : {
          command: "bun",
          args: ["run", "--cwd", "packages/server", "start"],
          opts: { env: gameEnv },
        };
      if (skipChainSetup) {
        log("starting game server without setup-chain bootstrap");
      }
      spawnManaged(
        "game-server",
        gameServerCommand.command,
        gameServerCommand.args,
        gameServerCommand.opts,
      );
    }

    if (!clientWasReady) {
      spawnManaged("game-client", "bun", ["run", "--cwd", "packages/client", "dev"], {
        env: gameEnv,
      });
    }
  }

  await waitForHttp(gameServerHealthUrl, "game server", startupTimeoutMs);
  try {
    await waitForHttp(
      gameStreamingStateUrl,
      "streaming duel api",
      streamingStateTimeoutMs,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(
      `warning: streaming duel api not ready at ${gameStreamingStateUrl} (${reason}) - continuing startup`,
    );
  }
  // Game client is optional for the duel/betting stack — only wait if it was
  // explicitly started or was already running at boot.
  if (!clientWasReady || options.fresh) {
    await waitForHttp(`${clientUrl}`, "game client", startupTimeoutMs);
  } else {
    const clientOk = await isHttpReady(clientUrl);
    if (clientOk) {
      log(`game client ready at ${clientUrl}`);
    } else {
      log(`warning: game client not reachable at ${clientUrl} - continuing without it`);
    }
  }

  if (!options["skip-bots"]) {
    log("starting duel matchmaker bots...");
    spawnManaged(
      "duel-bots",
      "bun",
      [
        "run",
        "dev:duel:skip-dev",
        `--bots=${bots}`,
        `--url=${serverWsUrl}`,
        `--client-url=${clientUrl}`,
      ],
      {
        env: gameEnv,
        critical: false,
        restart: true,
        restartDelayMs: 2500,
      },
    );
  }

  if (!skipBettingApp) {
    const bettingStreamEmbedUrl =
      process.env.VITE_STREAM_EMBED_URL ||
      process.env.VITE_STREAM_URL ||
      process.env.YOUTUBE_STREAM_EMBED_URL ||
      serverEnv.VITE_STREAM_EMBED_URL ||
      serverEnv.VITE_STREAM_URL ||
      serverEnv.YOUTUBE_STREAM_EMBED_URL ||
      "";
    if (!bettingStreamEmbedUrl) {
      log(
        "warning: no betting stream embed URL configured (set VITE_STREAM_EMBED_URL or VITE_STREAM_URL)",
      );
    }
    const bettingEnv = {
      ...process.env,
      ...readEnvFile(path.join(ROOT, "packages/gold-betting-demo/.env.devnet")),
      ...readEnvFile(path.join(ROOT, "packages/gold-betting-demo/app/.env.devnet")),
      VITE_STREAM_EMBED_URL: bettingStreamEmbedUrl,
      VITE_STREAM_URL: bettingStreamEmbedUrl,
      VITE_GAME_API_URL: process.env.VITE_GAME_API_URL || serverHttpUrl,
      VITE_GAME_WS_URL: process.env.VITE_GAME_WS_URL || serverWsUrl,
      VITE_WS_URL: process.env.VITE_WS_URL || serverWsUrl,
    };

    await clearUnhealthyListener("betting-app", `http://localhost:${bettingPort}`, options.fresh === true);
    log(`starting betting app on :${bettingPort}...`);
    spawnManaged(
      "betting-app",
      "bun",
      [
        "run",
        "--cwd",
        "packages/gold-betting-demo/app",
        "dev",
        "--mode",
        "devnet",
        "--host",
        "--port",
        String(bettingPort),
      ],
      {
        env: bettingEnv,
        restart: true,
        restartDelayMs: 2500,
      },
    );
    await waitForHttp(
      `http://localhost:${bettingPort}`,
      "betting app",
      startupTimeoutMs,
    );
  }

  if (!options["skip-stream"]) {
    log("starting RTMP bridge fanout...");
    const streamEnv = {
      ...process.env,
      ...serverEnv,
      RTMP_STATUS_FILE: externalRtmpStatusFile,
      GAME_URL: process.env.GAME_URL || streamCaptureUrl,
      GAME_FALLBACK_URLS:
        process.env.GAME_FALLBACK_URLS ||
        `${embeddedSpectatorCaptureUrl},${homeCaptureUrl}`,
      RTMP_BRIDGE_PORT: String(rtmpPort),
      // Default to CDP for reliability; WebCodecs can still be opted in explicitly.
      STREAM_CAPTURE_MODE: process.env.STREAM_CAPTURE_MODE || "cdp",
      STREAM_CAPTURE_ANGLE: process.env.STREAM_CAPTURE_ANGLE ||
        (process.platform === "darwin" ? "metal" : "vulkan"),
      STREAM_CAPTURE_HEADLESS:
        process.env.STREAM_CAPTURE_HEADLESS || defaultStreamCaptureHeadless,
      STREAM_CAPTURE_CHANNEL:
        process.env.STREAM_CAPTURE_CHANNEL || defaultStreamCaptureChannel,
    };

    const hasTwitchDestination = Boolean(
      streamEnv.TWITCH_STREAM_KEY || streamEnv.TWITCH_RTMP_STREAM_KEY,
    );
    const hasYoutubeDestination = Boolean(
      streamEnv.YOUTUBE_STREAM_KEY || streamEnv.YOUTUBE_RTMP_STREAM_KEY,
    );
    const strictDestinationVerification =
      process.env.DUEL_VERIFY_REQUIRE_DESTINATIONS === "true";
    if (strictDestinationVerification) {
      if (hasTwitchDestination) verifyRequiredDestinations.push("twitch");
      if (hasYoutubeDestination) verifyRequiredDestinations.push("youtube");
    } else if (hasTwitchDestination || hasYoutubeDestination) {
      log(
        "RTMP destination verification is in soft mode; set DUEL_VERIFY_REQUIRE_DESTINATIONS=true for strict destination checks.",
      );
    }

    spawnManaged(
      "rtmp-bridge",
      "bun",
      ["run", "--cwd", "packages/server", "stream:rtmp"],
      {
        env: streamEnv,
        critical: false,
        restart: true,
        restartDelayMs: 3000,
      },
    );
  }

  if (!options["skip-keeper"]) {
    log("starting keeper bot (devnet automation)...");
    const keeperEnv = {
      ...process.env,
      ...readEnvFile(path.join(ROOT, "packages/gold-betting-demo/.env.devnet")),
      GAME_URL: process.env.GAME_URL || serverHttpUrl,
    };
    spawnManaged(
      "keeper-bot",
      "bun",
      ["run", "--cwd", "packages/gold-betting-demo", "keeper:bot:devnet"],
      {
        env: keeperEnv,
        critical: false,
        restart: true,
        restartDelayMs: 5000,
      },
    );
  }

  if (verifyEnabled) {
    log("running startup verification checks...");
    const verifyArgs = [
      "scripts/verify-duel-stack.mjs",
      "--server-url",
      serverHttpUrl,
      "--client-url",
      clientUrl,
      "--timeout-ms",
      String(verifyTimeoutMs),
      "--fight-timeout-ms",
      String(Math.min(verifyTimeoutMs, 120_000)),
      "--rtmp-timeout-ms",
      String(Math.min(verifyTimeoutMs, 120_000)),
    ];
    if (!skipBettingApp) {
      verifyArgs.push("--betting-url", `http://localhost:${bettingPort}`);
    }
    if (verifyRequiredDestinations.length > 0) {
      verifyArgs.push(
        "--require-destinations",
        verifyRequiredDestinations.join(","),
      );
    }
    await runCommand("duel-verify", "bun", verifyArgs);
    log("startup verification passed");
  }

  log("stack online");
  log(`stream page: ${streamPageUrl}`);
  log(`stream capture url: ${streamCaptureUrl}`);
  log(`embedded spectator: ${embeddedSpectatorUrl}`);
  log(
    skipBettingApp
      ? "betting app: skipped (remote betting mode)"
      : `betting app: http://localhost:${bettingPort}`,
  );
  log("press Ctrl+C to stop");

  await new Promise(() => { });
}

main().catch((err) => {
  console.error("[duel] failed to start duel stack:", err);
  void shutdown(1);
});
