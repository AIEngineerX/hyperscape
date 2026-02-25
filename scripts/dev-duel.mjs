#!/usr/bin/env node
/**
 * Dev Duel - Continuous agent-vs-agent duel matchmaker
 *
 * Spawns headless DuelBots and pairs them for continuous automated duels.
 * Use this for:
 * - Testing duel system functionality
 * - Streaming duel content
 * - Betting system development
 *
 * Usage: bun run dev:duel [options]
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockFile(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function acquireSingletonLock(lockName) {
  const lockDir = path.join(process.cwd(), ".runtime-locks");
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${lockName}.json`);

  const writeLock = () => {
    const fd = fs.openSync(lockPath, "wx");
    const payload = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      command: process.argv.join(" "),
      cwd: process.cwd(),
    };
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
  };

  try {
    writeLock();
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;

    const existing = readLockFile(lockPath);
    const existingPid = Number.parseInt(String(existing?.pid ?? ""), 10);

    if (isProcessAlive(existingPid) && existingPid !== process.pid) {
      console.error(
        `[dev-duel] Another dev-duel instance is already running (pid ${existingPid}). Stop it before starting a new one.`,
      );
      process.exit(1);
    }

    try {
      fs.rmSync(lockPath, { force: true });
      writeLock();
    } catch {
      console.error(
        "[dev-duel] Failed to acquire run lock. Delete .runtime-locks/dev-duel.json and retry.",
      );
      process.exit(1);
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = readLockFile(lockPath);
    if (Number.parseInt(String(current?.pid ?? ""), 10) === process.pid) {
      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        // ignore lock cleanup failures
      }
    }
  };
}

// Ensure server vars are loaded if dev-duel is run directly
const serverEnv = readEnvFile(path.join(process.cwd(), "packages/server/.env"));
for (const [k, v] of Object.entries(serverEnv)) {
  if (process.env[k] === undefined) {
    process.env[k] = v;
  }
}

// Node environments used by the duel harness do not expose WebGPU globals.
// Provide minimal constants so Three's WebGPU bundle can initialize.
if (!globalThis.GPUShaderStage) {
  globalThis.GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  };
}

const opts = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    bots: { type: "string", short: "b", default: "4" },
    "skip-dev": { type: "boolean" },
    "match-interval": { type: "string", default: "5000" },
    "ramp-delay": { type: "string", default: "500" },
    url: { type: "string", default: "ws://localhost:5555/ws" },
    "client-url": { type: "string", default: "http://localhost:3333" },
    verbose: { type: "boolean", short: "v" },
    duration: { type: "string", short: "d" },
    "show-spectator-urls": { type: "boolean" },
  },
  strict: true,
}).values;

if (opts.help) {
  console.log(`
Dev Duel - Continuous agent-vs-agent matchmaker

Usage: bun run dev:duel [options]

Options:
  -h, --help               Show help
  -b, --bots <n>           Number of bots (default: 4, min: 2)
  --skip-dev               Don't start dev server (assume already running)
  --match-interval <ms>    Time between match scheduling (default: 5000)
  --ramp-delay <ms>        Delay between bot connections (default: 500)
  --url <ws>               Server WebSocket URL (default: ws://localhost:5555/ws)
  --client-url <http>      Client URL for spectator links (default: http://localhost:3333)
  --show-spectator-urls    Print spectator URLs for each match
  -v, --verbose            Show detailed logging
  -d, --duration <s>       Run for specific duration (omit for continuous)

Examples:
  bun run dev:duel                      # 4 bots, continuous dueling
  bun run dev:duel --bots=8             # 8 bots for more simultaneous duels
  bun run dev:duel --skip-dev           # Use existing server
  bun run dev:duel -d 300               # Run for 5 minutes then stop
  bun run dev:duel --show-spectator-urls # Show URLs for OBS/streaming

Spectator Mode:
  Open a spectator view in your browser to watch duels:
  ${opts["client-url"]}/?embedded=true&mode=spectator

  To stream to Twitch via RTMP, capture the spectator browser window
  using OBS, FFmpeg, or LiveKit Egress.
`);
  process.exit(0);
}

const releaseRunLock = acquireSingletonLock("dev-duel");

const HEALTH_URL = "http://localhost:5555/health";
const MAX_WAIT = 120000; // 2 minutes

async function waitForServer() {
  const start = Date.now();
  process.stdout.write("Waiting for server");

  while (Date.now() - start < MAX_WAIT) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(HEALTH_URL, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        console.log(" ready!");
        return true;
      }
    } catch { }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(" timeout!");
  return false;
}

async function startDev() {
  console.log("Starting dev server...\n");

  const dev = spawn("bun", ["run", "dev"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  // Stream server output with prefix
  dev.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`[dev] ${line}`);
    }
  });

  dev.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`[dev] ${line}`);
    }
  });

  dev.on("error", (err) => {
    console.error("Failed to start dev server:", err.message);
  });

  return dev;
}

async function loadMatchmaker() {
  // Import ElizaDuelMatchmaker from the server package.
  // This uses real ElizaOS agents with different AI models instead of
  // hardcoded DuelBot scripts.
  const serverEntrypoints = [
    "../packages/server/src/eliza/ElizaDuelMatchmaker.ts",
    "../packages/server/src/eliza/ElizaDuelMatchmaker.js",
  ];

  for (const entry of serverEntrypoints) {
    try {
      const mod = await import(entry);
      if (mod?.ElizaDuelMatchmaker) {
        return mod;
      }
    } catch { }
  }

  // Fallback: try the compiled server build
  try {
    const mod = await import("@hyperscape/server/eliza");
    if (mod?.ElizaDuelMatchmaker) return mod;
  } catch { }

  // Final fallback: try loading the old DuelMatchmaker from shared
  try {
    const mod = await import("../packages/shared/src/testing/index.ts");
    if (mod?.DuelMatchmaker) {
      console.warn("[dev-duel] Falling back to old DuelMatchmaker (no LLM)");
      return { ElizaDuelMatchmaker: mod.DuelMatchmaker };
    }
  } catch { }

  console.error("Cannot load ElizaDuelMatchmaker.");
  console.error(
    "Tried ../packages/server/src/eliza/ElizaDuelMatchmaker.ts",
  );
  process.exit(1);
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

async function runMatchmaker() {
  const { ElizaDuelMatchmaker } = await loadMatchmaker();

  const botCount = Math.max(2, parseInt(opts.bots, 10));
  const matchIntervalMs = parseInt(opts["match-interval"], 10);
  const rampUpDelayMs = parseInt(opts["ramp-delay"], 10);
  const duration = opts.duration ? parseInt(opts.duration, 10) * 1000 : null;

  const clientUrl = opts["client-url"];

  console.log(`
====================================================
        ELIZA AI DUEL MATCHMAKER
====================================================
  Bots: ${botCount} (capped to available API keys)
  Match Interval: ${matchIntervalMs}ms
  Server: ${opts.url}
  Duration: ${duration ? formatTime(duration) : "Continuous"}
  Mode: ElizaOS LLM agents (each bot = different AI model)
====================================================

  Spectator Mode (for streaming):
  ${clientUrl}/?embedded=true&mode=spectator

  For Twitch/RTMP streaming:
  1. Open spectator URL in browser
  2. Use OBS Window Capture or Browser Source
  3. Stream to rtmp://live.twitch.tv/app/{stream_key}

====================================================
`);

  const matchmaker = new ElizaDuelMatchmaker({
    wsUrl: opts.url,
    botCount,
    rampUpDelayMs,
    matchIntervalMs,
    verbose: opts.verbose,
  });

  // Event handlers
  matchmaker.on("ready", (data) => {
    console.log(`\n[Matchmaker] Ready! ${data.connectedBots}/${data.totalBots} bots connected`);
    console.log("[Matchmaker] Duels will begin automatically...\n");
  });

  matchmaker.on("matchScheduled", (data) => {
    const p1 = data.bot1Personality ? ` [${data.bot1Personality}]` : "";
    const p2 = data.bot2Personality ? ` [${data.bot2Personality}]` : "";
    console.log(`\n[Match] ${data.matchId}: ${data.bot1Name}${p1} vs ${data.bot2Name}${p2}`);
    console.log(`  ${data.bot1Name}: ${data.bot1Stats.wins}W-${data.bot1Stats.losses}L`);
    console.log(`  ${data.bot2Name}: ${data.bot2Stats.wins}W-${data.bot2Stats.losses}L`);

    if (opts["show-spectator-urls"]) {
      const clientUrl = opts["client-url"];
      const wsUrl = encodeURIComponent(opts.url);
      console.log(`\n  [Spectator URLs]`);
      console.log(`  Watch ${data.bot1Name}: ${clientUrl}/?embedded=true&mode=spectator&followEntity=${data.bot1Id}&wsUrl=${wsUrl}`);
      console.log(`  Watch ${data.bot2Name}: ${clientUrl}/?embedded=true&mode=spectator&followEntity=${data.bot2Id}&wsUrl=${wsUrl}`);
    }
  });

  matchmaker.on("matchComplete", (result) => {
    const wp = result.winnerPersonality ? ` [${result.winnerPersonality}]` : "";
    const lp = result.loserPersonality ? ` [${result.loserPersonality}]` : "";
    console.log(`\n[Result] ${result.winnerName}${wp} defeated ${result.loserName}${lp}!`);
    console.log(`  Duration: ${Math.round(result.durationMs / 1000)}s`);

    // Show leaderboard
    const leaderboard = matchmaker.getLeaderboard();
    console.log("\n[Leaderboard]");
    leaderboard.slice(0, 5).forEach((entry, i) => {
      const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
      const personality = entry.personality ? ` [${entry.personality}]` : "";
      console.log(
        `  ${medal} ${entry.name}${personality}: ${entry.wins}W-${entry.losses}L (${entry.winRate.toFixed(0)}%)`
      );
    });
  });

  matchmaker.on("botDisconnected", (data) => {
    console.log(`[Warning] ${data.name} disconnected: ${data.reason || "unknown"}`);
  });

  // Start matchmaker
  await matchmaker.start();

  // Handle shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;

    console.log("\n\n[Matchmaker] Shutting down...");

    const stats = matchmaker.getStats();
    console.log(`
====================================================
            FINAL RESULTS
====================================================
  Total Matches: ${stats.totalMatchesCompleted}
  Uptime: ${formatTime(stats.uptime)}
====================================================
`);

    const leaderboard = matchmaker.getLeaderboard();
    console.log("[Final Leaderboard]");
    leaderboard.forEach((entry, i) => {
      const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
      const personality = entry.personality ? ` [${entry.personality}]` : "";
      console.log(
        `  ${medal} ${entry.name}${personality}: ${entry.wins}W-${entry.losses}L (${entry.winRate.toFixed(0)}%)`
      );
    });

    await matchmaker.stop();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Run for duration or indefinitely
  if (duration) {
    console.log(`[Matchmaker] Will run for ${formatTime(duration)}...`);
    await new Promise((r) => setTimeout(r, duration));
    await shutdown();
    return 0;
  }

  // Run indefinitely
  console.log("[Matchmaker] Running continuously. Press Ctrl+C to stop.\n");
  await new Promise(() => { }); // Never resolves
}

async function main() {
  let devProcess = null;

  const cleanup = (codeOrSignal) => {
    const exitCode = typeof codeOrSignal === 'number' ? codeOrSignal : 0;
    if (devProcess) {
      console.log("\nStopping dev server...");
      try {
        process.kill(-devProcess.pid, "SIGTERM");
      } catch {
        devProcess.kill("SIGTERM");
      }
    }
    releaseRunLock();
    process.exit(exitCode);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
  process.on("uncaughtException", (err) => {
    console.error("[dev-duel] uncaught exception:", err);
    cleanup(1);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[dev-duel] unhandled rejection:", err);
    cleanup(1);
  });

  // Start dev server unless skipped
  if (!opts["skip-dev"]) {
    devProcess = await startDev();

    // Wait for server to be ready
    const ready = await waitForServer();
    if (!ready) {
      console.error("Server failed to start within 2 minutes");
      cleanup(1);
    }

    // Extra settle time for world initialization
    console.log("Waiting for world to initialize...");
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    // Verify server is already running
    console.log("Checking if server is running...");
    const ready = await waitForServer();
    if (!ready) {
      console.error("Server not running. Start with 'bun run dev' or remove --skip-dev");
      process.exit(1);
    }
  }

  // Run matchmaker
  const exitCode = await runMatchmaker();

  // Cleanup
  if (devProcess) {
    console.log("\nStopping dev server...");
    try {
      process.kill(-devProcess.pid, "SIGTERM");
    } catch {
      devProcess.kill("SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  releaseRunLock();
  process.exit(exitCode || 0);
}

main().catch((err) => {
  console.error("Dev duel failed:", err);
  releaseRunLock();
  process.exit(1);
});
