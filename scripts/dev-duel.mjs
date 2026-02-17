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
    } catch {}
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

async function loadShared() {
  return import("@hyperscape/shared").catch((e) => {
    console.error("Cannot load @hyperscape/shared. Run: bun run build:shared");
    console.error(e);
    process.exit(1);
  });
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
  const { DuelMatchmaker } = await loadShared();

  const botCount = Math.max(2, parseInt(opts.bots, 10));
  const matchIntervalMs = parseInt(opts["match-interval"], 10);
  const rampUpDelayMs = parseInt(opts["ramp-delay"], 10);
  const duration = opts.duration ? parseInt(opts.duration, 10) * 1000 : null;

  const clientUrl = opts["client-url"];

  console.log(`
====================================================
            DUEL MATCHMAKER
====================================================
  Bots: ${botCount}
  Match Interval: ${matchIntervalMs}ms
  Server: ${opts.url}
  Duration: ${duration ? formatTime(duration) : "Continuous"}
====================================================

  Spectator Mode (for streaming):
  ${clientUrl}/?embedded=true&mode=spectator

  For Twitch/RTMP streaming:
  1. Open spectator URL in browser
  2. Use OBS Window Capture or Browser Source
  3. Stream to rtmp://live.twitch.tv/app/{stream_key}

====================================================
`);

  const matchmaker = new DuelMatchmaker({
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
    console.log(`\n[Match] ${data.matchId}: ${data.bot1Name} vs ${data.bot2Name}`);
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
    console.log(`\n[Result] ${result.winnerName} defeated ${result.loserName}!`);
    console.log(`  Duration: ${Math.round(result.durationMs / 1000)}s`);

    // Show leaderboard
    const leaderboard = matchmaker.getLeaderboard();
    console.log("\n[Leaderboard]");
    leaderboard.slice(0, 5).forEach((entry, i) => {
      const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
      console.log(
        `  ${medal} ${entry.name}: ${entry.wins}W-${entry.losses}L (${entry.winRate.toFixed(0)}%)`
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
      console.log(
        `  ${medal} ${entry.name}: ${entry.wins}W-${entry.losses}L (${entry.winRate.toFixed(0)}%)`
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
  await new Promise(() => {}); // Never resolves
}

async function main() {
  let devProcess = null;

  const cleanup = () => {
    if (devProcess) {
      console.log("\nStopping dev server...");
      try {
        process.kill(-devProcess.pid, "SIGTERM");
      } catch {
        devProcess.kill("SIGTERM");
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Start dev server unless skipped
  if (!opts["skip-dev"]) {
    devProcess = await startDev();

    // Wait for server to be ready
    const ready = await waitForServer();
    if (!ready) {
      console.error("Server failed to start within 2 minutes");
      cleanup();
      process.exit(1);
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

  process.exit(exitCode || 0);
}

main().catch((err) => {
  console.error("Dev duel failed:", err);
  process.exit(1);
});
