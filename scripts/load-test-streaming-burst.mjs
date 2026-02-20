#!/usr/bin/env node

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const parsed = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    workers: { type: "string", default: "4" },
    "sse-clients": { type: "string", default: "2000" },
    "hls-clients": { type: "string", default: "400" },
    "state-pollers": { type: "string", default: "40" },
    "duel-context-pollers": { type: "string", default: "8" },
    "duration-s": { type: "string", default: "30" },
    "warmup-timeout-ms": { type: "string", default: "10000" },
    "stats-interval-ms": { type: "string", default: "15000" },
    "max-http-connections": { type: "string", default: "20000" },
    "server-url": { type: "string", default: "http://localhost:5555" },
    "betting-url": { type: "string", default: "http://localhost:4179" },
    "hls-url": { type: "string" },
    "allow-fail": { type: "boolean" },
  },
  strict: true,
}).values;

if (parsed.help) {
  console.log(`
Streaming burst load orchestrator.

Runs multiple load-test-streaming workers in parallel and aggregates results.

Usage:
  bun scripts/load-test-streaming-burst.mjs [options]

Options:
  --workers <n>                  Number of parallel worker processes (default: 4)
  --sse-clients <n>              Total SSE clients across all workers (default: 2000)
  --hls-clients <n>              Total HLS watcher loops across all workers (default: 400)
  --state-pollers <n>            Total state pollers (default: 40)
  --duel-context-pollers <n>     Total duel-context pollers (default: 8)
  --duration-s <seconds>         Per-worker duration (default: 30)
  --allow-fail                   Always exit 0 even if checks fail

Example:
  bun scripts/load-test-streaming-burst.mjs --workers=8 --sse-clients=3000 --hls-clients=400
`);
  process.exit(0);
}

const workers = Math.max(1, Number.parseInt(parsed.workers, 10) || 1);
const totalSse = Math.max(0, Number.parseInt(parsed["sse-clients"], 10) || 0);
const totalHls = Math.max(0, Number.parseInt(parsed["hls-clients"], 10) || 0);
const totalStatePollers = Math.max(
  0,
  Number.parseInt(parsed["state-pollers"], 10) || 0,
);
const totalDuelContextPollers = Math.max(
  0,
  Number.parseInt(parsed["duel-context-pollers"], 10) || 0,
);
const allowFail = parsed["allow-fail"] === true;

const sharedOptions = {
  durationS: String(parsed["duration-s"]),
  warmupTimeoutMs: String(parsed["warmup-timeout-ms"]),
  statsIntervalMs: String(parsed["stats-interval-ms"]),
  maxHttpConnections: String(parsed["max-http-connections"]),
  serverUrl: parsed["server-url"],
  bettingUrl: parsed["betting-url"],
  hlsUrl: parsed["hls-url"] || "",
};

function distribute(total, count) {
  const base = Math.floor(total / count);
  let remainder = total % count;
  return Array.from({ length: count }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return value;
  });
}

function log(message) {
  console.log(`[stream-burst] ${message}`);
}

function extractWorkerJson(stdoutText) {
  const idx = stdoutText.lastIndexOf('{\n  "ok"');
  if (idx < 0) return null;
  try {
    return JSON.parse(stdoutText.slice(idx));
  } catch {
    return null;
  }
}

function spawnWorker(workerId, workerTargets) {
  return new Promise((resolve) => {
    const args = [
      "scripts/load-test-streaming.mjs",
      `--duration-s=${sharedOptions.durationS}`,
      `--warmup-timeout-ms=${sharedOptions.warmupTimeoutMs}`,
      `--stats-interval-ms=${sharedOptions.statsIntervalMs}`,
      `--max-http-connections=${sharedOptions.maxHttpConnections}`,
      `--server-url=${sharedOptions.serverUrl}`,
      `--betting-url=${sharedOptions.bettingUrl}`,
      `--sse-clients=${workerTargets.sseClients}`,
      `--hls-clients=${workerTargets.hlsClients}`,
      `--state-pollers=${workerTargets.statePollers}`,
      `--duel-context-pollers=${workerTargets.duelContextPollers}`,
      "--allow-fail",
    ];
    if (sharedOptions.hlsUrl) {
      args.push(`--hls-url=${sharedOptions.hlsUrl}`);
    }

    const child = spawn("bun", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        workerId,
        targets: workerTargets,
        exitCode: null,
        signal: null,
        parseError: `spawn error: ${error.message}`,
        result: null,
        stderr,
      });
    });

    child.on("close", (code, signal) => {
      resolve({
        workerId,
        targets: workerTargets,
        exitCode: code,
        signal,
        parseError: null,
        result: extractWorkerJson(stdout),
        stderr,
      });
    });
  });
}

async function fetchServerMetrics(serverUrl) {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/streaming/metrics`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  const sseDist = distribute(totalSse, workers);
  const hlsDist = distribute(totalHls, workers);
  const stateDist = distribute(totalStatePollers, workers);
  const duelDist = distribute(totalDuelContextPollers, workers);

  const workerTargets = Array.from({ length: workers }, (_, index) => ({
    sseClients: sseDist[index],
    hlsClients: hlsDist[index],
    statePollers: stateDist[index],
    duelContextPollers: duelDist[index],
  }));

  log(
    `starting burst: workers=${workers}, sse=${totalSse}, hls=${totalHls}, state-pollers=${totalStatePollers}, duel-context-pollers=${totalDuelContextPollers}`,
  );

  const startedAt = Date.now();
  const workerResults = await Promise.all(
    workerTargets.map((targets, index) => spawnWorker(index + 1, targets)),
  );
  const finishedAt = Date.now();

  const parsedRuns = workerResults.filter((worker) => worker.result);
  const failedParses = workerResults.filter((worker) => !worker.result);

  const aggregate = {
    workers,
    elapsedMs: finishedAt - startedAt,
    targetSseTotal: totalSse,
    targetHlsTotal: totalHls,
    targetStatePollersTotal: totalStatePollers,
    targetDuelContextPollersTotal: totalDuelContextPollers,
    openedSseTotal: parsedRuns.reduce(
      (sum, worker) => sum + (worker.result?.sse?.opened || 0),
      0,
    ),
    peakConnectedSum: parsedRuns.reduce(
      (sum, worker) => sum + (worker.result?.sse?.peakConnected || 0),
      0,
    ),
    failedWorkers: parsedRuns.filter((worker) => worker.result?.ok === false)
      .length,
    parseFailures: failedParses.length,
  };

  const runs = workerResults.map((worker) => {
    if (!worker.result) {
      return {
        workerId: worker.workerId,
        targets: worker.targets,
        ok: false,
        parseError: worker.parseError || "missing worker JSON result",
        exitCode: worker.exitCode,
        signal: worker.signal,
      };
    }

    return {
      workerId: worker.workerId,
      targets: worker.targets,
      ok: worker.result.ok,
      opened: worker.result.sse?.opened,
      peakConnected: worker.result.sse?.peakConnected,
      sseP95LagMs: worker.result.sse?.lagMs?.p95,
      hlsManifestFailureRate: worker.result.hls?.manifestFailureRate,
      hlsSegmentFailureRate: worker.result.hls?.segmentFailureRate,
      apiStateFailureRate: worker.result.api?.state?.failureRate,
      apiDuelFailureRate: worker.result.api?.duelContext?.failureRate,
    };
  });

  const serverMetrics = await fetchServerMetrics(sharedOptions.serverUrl);
  const pass =
    aggregate.failedWorkers === 0 &&
    aggregate.parseFailures === 0 &&
    aggregate.openedSseTotal >= totalSse;

  const summary = {
    ok: pass,
    aggregate,
    runs,
    serverMetrics: serverMetrics
      ? {
          emittedAt: serverMetrics.emittedAt,
          clients: serverMetrics.sse?.clients,
          events: serverMetrics.sse?.events,
          fanout: serverMetrics.sse?.fanout,
        }
      : null,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!pass && !allowFail) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `[stream-burst] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
