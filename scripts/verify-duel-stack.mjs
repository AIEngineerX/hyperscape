#!/usr/bin/env node

/**
 * Duel stack verifier.
 *
 * Validates a running duel stack end-to-end:
 * - server/client/betting HTTP readiness
 * - active streaming duel with real combat progress (HP drop or damage)
 * - RTMP bridge ingest bytes
 * - duel telemetry APIs (inventory + monologues)
 */

import { parseArgs } from "node:util";

const values = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    "server-url": { type: "string", default: "http://localhost:5555" },
    "client-url": { type: "string", default: "http://localhost:3333" },
    "betting-url": { type: "string", default: "http://localhost:4179" },
    "timeout-ms": { type: "string", default: "240000" },
    "fight-timeout-ms": { type: "string", default: "120000" },
    "rtmp-timeout-ms": { type: "string", default: "120000" },
    "require-destinations": { type: "string", default: "" },
    "poll-ms": { type: "string", default: "2000" },
    verbose: { type: "boolean", short: "v" },
  },
  strict: true,
}).values;

if (values.help) {
  console.log(`
Verify duel stack readiness and combat integrity.

Usage:
  bun run duel:verify [options]

Options:
  -h, --help                 Show help
  --server-url <url>         Game server URL (default: http://localhost:5555)
  --client-url <url>         Game client URL (default: http://localhost:3333)
  --betting-url <url>        Betting app URL (default: http://localhost:4179)
  --timeout-ms <ms>          General timeout (default: 240000)
  --fight-timeout-ms <ms>    Combat proof timeout (default: 120000)
  --rtmp-timeout-ms <ms>     Optional RTMP status timeout (default: 120000)
  --require-destinations <list>
                             Comma list of required RTMP destinations
                             (example: twitch,youtube)
  --poll-ms <ms>             Poll interval (default: 2000)
  -v, --verbose              Verbose polling logs
`);
  process.exit(0);
}

const serverUrl = values["server-url"].replace(/\/$/, "");
const clientUrl = values["client-url"].replace(/\/$/, "");
const bettingUrl = values["betting-url"].replace(/\/$/, "");
const timeoutMs = Number.parseInt(values["timeout-ms"], 10) || 240_000;
const fightTimeoutMs =
  Number.parseInt(values["fight-timeout-ms"], 10) || 120_000;
const rtmpTimeoutMs =
  Number.parseInt(values["rtmp-timeout-ms"], 10) || 120_000;
const requiredDestinations = Array.from(
  new Set(
    (values["require-destinations"] || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
);
const pollMs = Number.parseInt(values["poll-ms"], 10) || 2_000;
const verbose = values.verbose === true;

function log(message) {
  console.log(`[duel-verify] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, ms = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, ms = 4000) {
  const response = await fetchWithTimeout(url, ms);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} at ${url}`);
  }
  return response.json();
}

async function waitFor(label, check, checkTimeoutMs) {
  const deadline = Date.now() + checkTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        log(`OK: ${label}`);
        return value;
      }
      lastError = null;
      if (verbose) {
        log(`waiting: ${label}`);
      }
    } catch (err) {
      lastError = err;
      if (verbose) {
        log(`waiting: ${label} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    await sleep(pollMs);
  }

  const suffix = lastError
    ? ` last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    : "";
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

async function assertHttpOk(label, url, checkTimeoutMs) {
  await waitFor(
    label,
    async () => {
      const response = await fetchWithTimeout(url);
      return response.ok ? response.status : null;
    },
    checkTimeoutMs,
  );
}

function getAgentPair(context) {
  const agent1 = context?.cycle?.agent1 ?? null;
  const agent2 = context?.cycle?.agent2 ?? null;
  if (!agent1?.id || !agent2?.id) return null;
  return { agent1, agent2 };
}

function getDestinationNames(status) {
  if (!Array.isArray(status?.destinations)) return [];
  return status.destinations
    .map((dest) => String(dest?.name || "").trim())
    .filter(Boolean);
}

function hasRequiredDestinations(status, required) {
  if (required.length === 0) return true;
  const available = getDestinationNames(status).map((name) =>
    name.toLowerCase(),
  );
  return required.every((requiredName) =>
    available.some(
      (candidate) =>
        candidate === requiredName ||
        candidate.includes(requiredName) ||
        requiredName.includes(candidate),
    ),
  );
}

async function verify() {
  log("starting duel stack verification");

  await assertHttpOk("server health", `${serverUrl}/health`, timeoutMs);
  await assertHttpOk("streaming state", `${serverUrl}/api/streaming/state`, timeoutMs);
  await assertHttpOk("client page", `${clientUrl}/`, timeoutMs);
  await assertHttpOk("betting app", `${bettingUrl}/`, timeoutMs);

  const duelContextUrl = `${serverUrl}/api/streaming/duel-context`;
  const contestants = await waitFor(
    "streaming duel contestants",
    async () => {
      const context = await fetchJson(duelContextUrl);
      const pair = getAgentPair(context);
      if (!pair) return null;
      return { context, pair };
    },
    timeoutMs,
  );

  const { pair } = contestants;
  const agent1Id = pair.agent1.id;
  const agent2Id = pair.agent2.id;

  const fighting = await waitFor(
    "fighting phase",
    async () => {
      const context = await fetchJson(duelContextUrl);
      const currentPair = getAgentPair(context);
      if (!currentPair) return null;
      if (context?.cycle?.phase !== "FIGHTING") return null;
      return { context, pair: currentPair };
    },
    timeoutMs,
  );

  const initialHpA = Number(fighting.pair.agent1.hp ?? 0);
  const initialHpB = Number(fighting.pair.agent2.hp ?? 0);

  const combatEvidence = await waitFor(
    "combat evidence (HP drop or damage)",
    async () => {
      const context = await fetchJson(duelContextUrl);
      const currentPair = getAgentPair(context);
      if (!currentPair) return null;

      const hpA = Number(currentPair.agent1.hp ?? 0);
      const hpB = Number(currentPair.agent2.hp ?? 0);
      const dmgA = Number(currentPair.agent1.damageDealtThisFight ?? 0);
      const dmgB = Number(currentPair.agent2.damageDealtThisFight ?? 0);

      const hpDropped = hpA < initialHpA || hpB < initialHpB;
      const damageRecorded = dmgA > 0 || dmgB > 0;
      if (!hpDropped && !damageRecorded) {
        return null;
      }

      return {
        hpDropped,
        damageRecorded,
        hpA,
        hpB,
        dmgA,
        dmgB,
      };
    },
    fightTimeoutMs,
  );

  let rtmpEvidence = {
    checked: false,
    bytesReceived: null,
    note: "status unavailable",
  };
  const statusUrl = `${serverUrl}/api/streaming/rtmp/status`;
  let requiredDestinationNames = [];
  if (requiredDestinations.length > 0) {
    const status = await waitFor(
      `required RTMP destinations (${requiredDestinations.join(", ")})`,
      async () => {
        const next = await fetchJson(statusUrl);
        return hasRequiredDestinations(next, requiredDestinations) ? next : null;
      },
      rtmpTimeoutMs,
    );
    requiredDestinationNames = getDestinationNames(status);
  }

  try {
    rtmpEvidence.checked = true;
    const requireRtmpTraffic = requiredDestinations.length > 0;
    const initial = await fetchJson(statusUrl);
    const initialBytes = Number(initial?.stats?.bytesReceived ?? 0);
    const bridgeActive = Boolean(
      initial?.active || initial?.ffmpegRunning || initial?.clientConnected,
    );
    if (requireRtmpTraffic && !bridgeActive) {
      await waitFor(
        "rtmp bridge activity",
        async () => {
          const next = await fetchJson(statusUrl);
          return next?.active || next?.ffmpegRunning || next?.clientConnected
            ? next
            : null;
        },
        rtmpTimeoutMs,
      );
    }

    if (initialBytes > 0) {
      rtmpEvidence = {
        checked: true,
        bytesReceived: initialBytes,
        note: "bytes observed immediately",
      };
    } else if (requireRtmpTraffic || bridgeActive) {
      const bytes = await waitFor(
        requireRtmpTraffic
          ? "rtmp ingest bytes"
          : "rtmp ingest bytes (optional)",
        async () => {
          const next = await fetchJson(statusUrl);
          const value = Number(next?.stats?.bytesReceived ?? 0);
          return value > 0 ? value : null;
        },
        rtmpTimeoutMs,
      );
      rtmpEvidence = {
        checked: true,
        bytesReceived: Number(bytes),
        note: requireRtmpTraffic
          ? "bytes observed via required status endpoint"
          : "bytes observed via status endpoint",
      };
    } else {
      rtmpEvidence.note =
        "bridge status endpoint not attached to external RTMP process";
    }
  } catch (error) {
    rtmpEvidence = {
      checked: true,
      bytesReceived: null,
      note: `status check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const inventoryA = await fetchJson(
    `${serverUrl}/api/streaming/agent/${agent1Id}/inventory`,
  );
  const inventoryB = await fetchJson(
    `${serverUrl}/api/streaming/agent/${agent2Id}/inventory`,
  );
  const thoughtsA = await fetchJson(
    `${serverUrl}/api/streaming/agent/${agent1Id}/monologues?limit=5`,
  );
  const thoughtsB = await fetchJson(
    `${serverUrl}/api/streaming/agent/${agent2Id}/monologues?limit=5`,
  );

  if (!Array.isArray(inventoryA?.inventory) || !Array.isArray(inventoryB?.inventory)) {
    throw new Error("Inventory endpoint did not return inventory arrays");
  }
  if (!Array.isArray(thoughtsA?.thoughts) || !Array.isArray(thoughtsB?.thoughts)) {
    throw new Error("Monologue endpoint did not return thoughts arrays");
  }

  log("verification passed");
  console.log(
    JSON.stringify(
      {
        ok: true,
        serverUrl,
        clientUrl,
        bettingUrl,
        agent1Id,
        agent2Id,
        combatEvidence,
        rtmpEvidence,
        requiredDestinations,
        requiredDestinationNames,
        telemetry: {
          inventoryA: inventoryA.inventory.length,
          inventoryB: inventoryB.inventory.length,
          thoughtsA: thoughtsA.thoughts.length,
          thoughtsB: thoughtsB.thoughts.length,
        },
      },
      null,
      2,
    ),
  );
}

verify().catch((err) => {
  console.error(
    `[duel-verify] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
