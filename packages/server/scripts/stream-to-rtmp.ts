#!/usr/bin/env bun
/**
 * Stream to RTMP — CDP Screencast Capture
 *
 * High-performance streaming pipeline that uses Chrome DevTools Protocol (CDP)
 * Page.startScreencast to capture frames directly from the Chromium compositor
 * and pipes them to FFmpeg for H.264 encoding.
 *
 * This is ~2-3x faster than the legacy MediaRecorder → WebSocket path because:
 * - No browser-side VP8/VP9 encoding (MediaRecorder eliminated)
 * - No WebSocket serialization/transfer overhead
 * - Single encode step: raw JPEG → H.264 (hardware accelerated on Mac)
 * - CDP captures from compositor regardless of headless/headful mode
 *
 * Architecture:
 *   Chromium Compositor → CDP screencastFrame → Node.js → FFmpeg stdin (JPEG pipe) → RTMP fanout
 *
 * Falls back to the legacy MediaRecorder + WebSocket path if CDP capture fails
 * or STREAM_CAPTURE_MODE=mediarecorder is set.
 *
 * Usage:
 *   bun run stream:rtmp
 *   bun run packages/server/scripts/stream-to-rtmp.ts
 *
 * Environment Variables:
 *   STREAM_CAPTURE_MODE      - 'cdp' (default) or 'mediarecorder' (legacy)
 *   STREAM_CAPTURE_HEADLESS  - 'true' for headless (default: false for better GPU rendering)
 *   STREAM_CAPTURE_CHANNEL   - Browser channel ('chrome', 'msedge', etc.)
 *   STREAM_CAPTURE_ANGLE     - ANGLE backend (default: metal on macOS, vulkan elsewhere)
 *   STREAM_CDP_QUALITY       - JPEG quality for CDP screencast (1-100, default: 80)
 *   STREAM_FPS               - Target frames per second (default: 30)
 *   TWITCH_STREAM_KEY / TWITCH_RTMP_STREAM_KEY - Twitch stream key
 *   TWITCH_STREAM_URL / TWITCH_RTMP_URL / TWITCH_RTMP_SERVER - Twitch ingest URL
 *   YOUTUBE_STREAM_KEY / YOUTUBE_RTMP_STREAM_KEY - YouTube stream key
 *   YOUTUBE_STREAM_URL / YOUTUBE_RTMP_URL - YouTube ingest URL
 *   KICK_STREAM_KEY          - Kick stream key
 *   PUMPFUN_RTMP_URL         - Pump.fun RTMP URL
 *   X_RTMP_URL               - X/Twitter RTMP URL
 *   RTMP_DESTINATIONS_JSON   - JSON array fanout config
 *   STREAMING_VIEWER_ACCESS_TOKEN - Optional token appended as streamToken for gated viewer WS
 *   GAME_URL                 - URL to Hyperscape (default: http://localhost:3333/?page=stream)
 *   GAME_FALLBACK_URLS       - Comma-separated fallback URLs
 *   RTMP_BRIDGE_PORT         - WebSocket port for legacy bridge (default: 8765)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page, type CDPSession } from "playwright";
import {
  getRTMPBridge,
  startRTMPBridge,
  generateCaptureScript,
  generateWebCodecsCaptureScript,
} from "../src/streaming/index.js";
import { errMsg } from "../src/shared/errMsg.ts";

// ── Configuration ──────────────────────────────────────────────────────────

const GAME_URL = process.env.GAME_URL || "http://localhost:3333/?page=stream";
const GAME_FALLBACK_URLS = (
  process.env.GAME_FALLBACK_URLS ||
  "http://localhost:3333/?embedded=true&mode=spectator,http://localhost:3333/"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const STREAMING_VIEWER_ACCESS_TOKEN = (
  process.env.STREAMING_VIEWER_ACCESS_TOKEN || ""
).trim();

function withViewerAccessToken(rawUrl: string): string {
  if (!STREAMING_VIEWER_ACCESS_TOKEN) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("streamToken", STREAMING_VIEWER_ACCESS_TOKEN);
    return url.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}streamToken=${encodeURIComponent(STREAMING_VIEWER_ACCESS_TOKEN)}`;
  }
}

function withRendererCaptureHints(rawUrl: string): string {
  const disableWebGPU = /^(1|true|yes|on)$/i.test(
    process.env.STREAM_CAPTURE_DISABLE_WEBGPU || "",
  );
  if (!disableWebGPU) return rawUrl;
  try {
    const url = new URL(rawUrl);
    // Ensure frontend renderer policy matches capture browser flags.
    url.searchParams.set("forceWebGL", "1");
    url.searchParams.set("disableWebGPU", "1");
    return url.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}forceWebGL=1&disableWebGPU=1`;
  }
}

const GAME_URL_CANDIDATES = Array.from(
  new Set(
    [GAME_URL, ...GAME_FALLBACK_URLS]
      .map(withViewerAccessToken)
      .map(withRendererCaptureHints),
  ),
);

const BRIDGE_PORT = parseInt(process.env.RTMP_BRIDGE_PORT || "8765", 10);
const BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
const SPECTATOR_PORT = parseInt(process.env.SPECTATOR_PORT || "4180", 10);
const EXTERNAL_STATUS_FILE = (process.env.RTMP_STATUS_FILE || "").trim();
let externalStatusWriteErrored = false;

/** Capture mode: 'cdp' (fast) or 'mediarecorder' (legacy) or 'webcodecs' (holy grail) */
const CAPTURE_MODE = (process.env.STREAM_CAPTURE_MODE?.trim() || "cdp") as
  | "cdp"
  | "mediarecorder"
  | "webcodecs";
const STREAM_CAPTURE_HEADLESS = process.env.STREAM_CAPTURE_HEADLESS === "true";
const STREAM_CAPTURE_CHANNEL = process.env.STREAM_CAPTURE_CHANNEL?.trim() || "";
const ANGLE_BACKEND =
  process.env.STREAM_CAPTURE_ANGLE?.trim() ||
  (process.platform === "darwin" ? "metal" : "vulkan");
const STREAM_CAPTURE_DISABLE_WEBGPU = /^(1|true|yes|on)$/i.test(
  process.env.STREAM_CAPTURE_DISABLE_WEBGPU || "",
);
const CDP_QUALITY = Math.min(
  100,
  Math.max(1, parseInt(process.env.STREAM_CDP_QUALITY || "80", 10)),
);
const TARGET_FPS = parseInt(process.env.STREAM_FPS || "30", 10);

function parseEvenDimension(
  rawValue: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(rawValue || "", 10);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.max(2, candidate);
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

// Viewport settings (default 720p for stream stability)
const VIEWPORT = {
  width: parseEvenDimension(process.env.STREAM_CAPTURE_WIDTH, 1280),
  height: parseEvenDimension(process.env.STREAM_CAPTURE_HEIGHT, 720),
};

let browser: Browser | null = null;
let page: Page | null = null;
let cdpSession: CDPSession | null = null;
let selectedGameUrl: string | null = null;
let launchTime = Date.now();
const BROWSER_RESTART_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 Hour

// ── CDP Frame Rate Tracking ────────────────────────────────────────────────

let cdpFrameCount = 0;
let cdpFps = 0;
let cdpFpsIntervalId: ReturnType<typeof setInterval> | null = null;
let cdpDroppedFrames = 0;

function startFpsTracking() {
  if (cdpFpsIntervalId) clearInterval(cdpFpsIntervalId);
  cdpFrameCount = 0;
  cdpFps = 0;
  cdpFpsIntervalId = setInterval(() => {
    cdpFps = cdpFrameCount;
    cdpFrameCount = 0;
  }, 1000);
}

function stopFpsTracking() {
  if (cdpFpsIntervalId) {
    clearInterval(cdpFpsIntervalId);
    cdpFpsIntervalId = null;
  }
}

type ActiveCaptureMode = "cdp" | "webcodecs" | "mediarecorder";

function writeExternalStatusSnapshot(
  bridge: ReturnType<typeof getRTMPBridge>,
  captureMode: ActiveCaptureMode,
): void {
  if (!EXTERNAL_STATUS_FILE) return;

  const bridgeStatus = bridge.getStatus();
  const stats = bridge.getStats();
  const processMemory = process.memoryUsage();
  const payload = {
    ...bridgeStatus,
    stats: {
      bytesReceived: stats.bytesReceived,
      bytesReceivedMB: (stats.bytesReceived / 1024 / 1024).toFixed(2),
      uptimeSeconds: Math.floor(stats.uptime / 1000),
      destinations: stats.destinations,
      healthy: stats.healthy,
      droppedFrames: stats.droppedFrames,
      backpressured: stats.backpressured,
      spectators: stats.spectators,
      processMemory: stats.processMemory,
    },
    captureMode,
    processRssBytes: processMemory.rss,
    updatedAt: Date.now(),
    source: "external-rtmp-bridge",
  };

  try {
    fs.mkdirSync(path.dirname(EXTERNAL_STATUS_FILE), { recursive: true });
    fs.writeFileSync(EXTERNAL_STATUS_FILE, JSON.stringify(payload));
    externalStatusWriteErrored = false;
  } catch (err) {
    if (!externalStatusWriteErrored) {
      externalStatusWriteErrored = true;
      console.warn(
        `[Main] Failed to write RTMP status file (${EXTERNAL_STATUS_FILE}):`,
        err,
      );
    }
  }
}

function clearExternalStatusSnapshot(): void {
  if (!EXTERNAL_STATUS_FILE) return;
  try {
    fs.unlinkSync(EXTERNAL_STATUS_FILE);
  } catch {
    // Ignore stale/missing status file cleanup errors.
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function isTransientPageEvalError(err: unknown): boolean {
  const message = errMsg(err);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id") ||
    message.includes("Most likely because of a navigation") ||
    message.includes("Target page, context or browser has been closed")
  );
}

function hasConfiguredOutput(): boolean {
  const hasTwitchKey = Boolean(
    process.env.TWITCH_STREAM_KEY || process.env.TWITCH_RTMP_STREAM_KEY,
  );
  const hasYoutubeKey = Boolean(
    process.env.YOUTUBE_STREAM_KEY || process.env.YOUTUBE_RTMP_STREAM_KEY,
  );
  return Boolean(
    process.env.RTMP_MULTIPLEXER_URL ||
    hasTwitchKey ||
    hasYoutubeKey ||
    process.env.KICK_STREAM_KEY ||
    process.env.PUMPFUN_RTMP_URL ||
    process.env.X_RTMP_URL ||
    process.env.RTMP_DESTINATIONS_JSON,
  );
}

async function waitForStreamReadiness(
  pageRef: Page,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const probe = await pageRef.evaluate(() => {
        const win = window as unknown as {
          __HYPERSCAPE_STREAM_READY__?: boolean;
        };
        const text = (document.body?.innerText || "").slice(0, 240);
        return {
          hasCanvas: document.querySelector("canvas") !== null,
          readyFlag: win.__HYPERSCAPE_STREAM_READY__ === true,
          hasStreamingBootUi:
            text.includes("Waiting for duel data") ||
            text.includes("Initializing world systems"),
        };
      });

      if (probe.hasCanvas || probe.readyFlag) {
        return true;
      }

      // Some browser/GPU combinations render the stream world but do not
      // satisfy the explicit readiness signal quickly. If the stream boot UI
      // is present for a sustained period, proceed with capture.
      if (probe.hasStreamingBootUi && Date.now() - startedAt >= 20_000) {
        return true;
      }
    } catch (err) {
      if (!isTransientPageEvalError(err)) {
        console.warn("[Main] Stream readiness probe failed:", errMsg(err));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return false;
}

// ── Browser Launch ─────────────────────────────────────────────────────────

async function launchCaptureBrowser() {
  const featureFlags = STREAM_CAPTURE_DISABLE_WEBGPU
    ? "--enable-features=UseSkiaRenderer"
    : "--enable-features=Vulkan,UseSkiaRenderer,WebGPU";
  const launchConfig = {
    headless: STREAM_CAPTURE_HEADLESS,
    args: [
      "--use-gl=angle",
      "--enable-webgl",
      ...(STREAM_CAPTURE_DISABLE_WEBGPU
        ? ["--disable-webgpu"]
        : ["--enable-unsafe-webgpu"]),
      featureFlags,
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--enable-zero-copy",
      "--disable-gpu-vsync",
      `--use-angle=${ANGLE_BACKEND}`,
      "--disable-web-security",
      "--autoplay-policy=no-user-gesture-required",
      // Prevent Chromium from throttling rendering/timers
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-frame-rate-limit",
      "--run-all-compositor-stages-before-draw",
      "--disable-hang-monitor",
    ],
  };

  if (STREAM_CAPTURE_CHANNEL) {
    console.log(
      `[Main] Launching with explicit browser channel: ${STREAM_CAPTURE_CHANNEL}`,
    );
    return await chromium.launch({
      ...launchConfig,
      channel: STREAM_CAPTURE_CHANNEL,
    });
  }

  try {
    return await chromium.launch(launchConfig);
  } catch (err) {
    const message = errMsg(err);
    const likelyMissingBrowser =
      message.includes("Executable doesn't exist") ||
      message.includes("browser executable") ||
      message.includes("Please run the following command");

    if (!likelyMissingBrowser) {
      throw err;
    }

    console.warn(
      "[Main] Playwright Chromium is missing. Installing bundled Chromium...",
    );
    const install = spawnSync(
      process.platform === "win32" ? "bunx.cmd" : "bunx",
      ["playwright", "install", "chromium"],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    if (install.status !== 0) {
      throw new Error(
        `Failed to install Playwright Chromium (exit ${install.status ?? "unknown"}).`,
      );
    }

    console.log("[Main] Chromium installed. Retrying browser launch...");
    return chromium.launch(launchConfig);
  }
}

async function setupBrowser() {
  if (browser) await cleanup();

  console.log(
    `[Main] Launching browser (headless=${STREAM_CAPTURE_HEADLESS}, angle=${ANGLE_BACKEND}${STREAM_CAPTURE_CHANNEL ? `, channel=${STREAM_CAPTURE_CHANNEL}` : ""}, mode=${CAPTURE_MODE})...`,
  );
  browser = await launchCaptureBrowser();

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  page = await context.newPage();

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") {
      console.error("[Browser]", text);
    } else if (text.includes("[Capture]") || text.includes("[StreamingMode]")) {
      console.log("[Browser]", text);
    }
  });

  if (!selectedGameUrl) {
    for (const candidateUrl of GAME_URL_CANDIDATES) {
      console.log(`[Main] Navigating to ${candidateUrl}...`);
      try {
        await page.goto(candidateUrl, {
          timeout: 60_000,
          waitUntil: "domcontentloaded",
        });
      } catch (err) {
        console.warn(`[Main] Failed to load ${candidateUrl}:`, err);
        continue;
      }

      console.log(`[Main] Waiting for stream readiness on ${candidateUrl}...`);
      const isReady = await waitForStreamReadiness(page, 90_000);
      if (isReady) {
        selectedGameUrl = candidateUrl;
        break;
      }
      console.warn(
        `[Main] Stream readiness not detected on ${candidateUrl}, trying fallback...`,
      );
    }
  } else {
    try {
      await page.goto(selectedGameUrl, {
        timeout: 60_000,
        waitUntil: "domcontentloaded",
      });
    } catch (err) {
      console.error(
        `[Main] Failed to reload configured URL ${selectedGameUrl}`,
        err,
      );
    }
  }

  if (!selectedGameUrl) {
    console.error(
      `[Main] Could not find a game canvas on any candidate URL: ${GAME_URL_CANDIDATES.join(", ")}`,
    );
    console.error(
      "[Main] Make sure the game client is running and supports stream/spectator mode.",
    );
    await cleanup();
    process.exit(1);
  }

  console.log(`[Main] Using game page: ${selectedGameUrl}`);
  console.log("[Main] Waiting for game to initialize...");
  await page.waitForTimeout(5000);

  launchTime = Date.now();
}

// ── CDP Screencast Capture ─────────────────────────────────────────────────

async function startCdpCapture(bridge: ReturnType<typeof getRTMPBridge>) {
  if (!page) throw new Error("No page available for CDP capture");

  // Create CDP session
  cdpSession = await page.context().newCDPSession(page);

  console.log(
    `[CDP] Starting screencast capture (quality=${CDP_QUALITY}, fps=${TARGET_FPS}, ${VIEWPORT.width}x${VIEWPORT.height})...`,
  );

  // Start FFmpeg in direct mode (JPEG piping)
  bridge.startFFmpegDirect();

  startFpsTracking();

  // Handle incoming frames from CDP
  cdpSession.on("Page.screencastFrame", async (params) => {
    const { sessionId, data: base64Data } = params;

    // Acknowledge the frame immediately to request the next one
    try {
      await cdpSession?.send("Page.screencastFrameAck", { sessionId });
    } catch {
      // Session may have been destroyed during page navigation
    }

    // Decode base64 JPEG and feed to FFmpeg
    const jpegBuffer = Buffer.from(base64Data, "base64");
    const written = bridge.feedFrame(jpegBuffer);

    if (written) {
      cdpFrameCount++;
    } else {
      cdpDroppedFrames++;
    }
  });

  // Start the screencast
  await cdpSession.send("Page.startScreencast", {
    format: "jpeg",
    quality: CDP_QUALITY,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1, // Capture every frame
  });

  console.log("[CDP] ✅ Screencast capture started — frames piping to FFmpeg");
}

async function stopCdpCapture() {
  stopFpsTracking();

  if (cdpSession) {
    try {
      await cdpSession.send("Page.stopScreencast");
      await cdpSession.detach();
    } catch {
      // Session may already be closed
    }
    cdpSession = null;
  }
}

// ── Legacy MediaRecorder Capture ───────────────────────────────────────────

async function startLegacyCapture(bridge: ReturnType<typeof getRTMPBridge>) {
  if (!page) return;

  // Start WebSocket bridge for MediaRecorder chunks
  bridge.start(BRIDGE_PORT);

  const captureScript = generateCaptureScript({
    bridgeUrl: BRIDGE_URL,
    fps: TARGET_FPS,
    bitrate: 6000000,
  });

  const ensureCaptureRunning = async (reason: string) => {
    if (!page || page.isClosed()) return;

    let state: {
      hasCanvas: boolean;
      hasControl: boolean;
      recording: boolean;
      wsConnected: boolean;
    };
    try {
      state = await page.evaluate(() => {
        const control = (
          window as unknown as {
            __captureControl__?: { getStatus: () => unknown };
          }
        ).__captureControl__;
        const status = (control?.getStatus?.() || {}) as {
          recording?: boolean;
          wsConnected?: boolean;
        };
        return {
          hasCanvas: document.querySelector("canvas") !== null,
          hasControl: Boolean(control),
          recording: status.recording === true,
          wsConnected: status.wsConnected === true,
        };
      });
    } catch (err) {
      if (isTransientPageEvalError(err)) return;
      throw err;
    }

    if (!state.hasCanvas) return;
    if (state.hasControl && state.recording && state.wsConnected) return;

    console.log(
      `[Main] Legacy capture inactive (reason=${reason}), injecting script...`,
    );
    try {
      await page.evaluate(captureScript);
      await page.waitForTimeout(1500);
    } catch (err) {
      if (isTransientPageEvalError(err)) return;
      throw err;
    }
  };

  // Inject and verify capture
  try {
    await ensureCaptureRunning("initial");
  } catch (err) {
    console.warn("[Main] Initial capture injection failed:", err);
  }

  // Watchdog to recover from page reloads
  return setInterval(() => {
    void ensureCaptureRunning("watchdog").catch((err) => {
      console.warn("[Main] Capture watchdog error:", err);
    });
  }, 5000);
}

// ── WebCodecs Canvas Capture ───────────────────────────────────────────────

async function startWebCodecsCapture(bridge: ReturnType<typeof getRTMPBridge>) {
  if (!page) return;

  // Start WebSocket bridge for WebCodecs NAL chunks (stream copy)
  bridge.startWebCodecs(BRIDGE_PORT);

  const captureScript = generateWebCodecsCaptureScript({
    bridgeUrl: BRIDGE_URL,
    fps: TARGET_FPS,
    bitrate: 6000000,
  });

  const ensureCaptureRunning = async (reason: string) => {
    if (!page || page.isClosed()) return;

    let state: {
      hasCanvas: boolean;
      hasControl: boolean;
      recording: boolean;
      wsConnected: boolean;
    };
    try {
      state = await page.evaluate(() => {
        const control = (
          window as unknown as {
            __captureControl__?: { getStatus: () => unknown };
          }
        ).__captureControl__;
        const status = (control?.getStatus?.() || {}) as {
          recording?: boolean;
          wsConnected?: boolean;
        };
        return {
          hasCanvas: document.querySelector("canvas") !== null,
          hasControl: Boolean(control),
          recording: status.recording === true,
          wsConnected: status.wsConnected === true,
        };
      });
    } catch (err) {
      if (isTransientPageEvalError(err)) return;
      throw err;
    }

    if (!state.hasCanvas) return;
    if (state.hasControl && state.recording && state.wsConnected) return;

    console.log(
      `[Main] WebCodecs capture inactive (reason=${reason}), injecting script...`,
    );
    try {
      await page.evaluate(captureScript);
      await page.waitForTimeout(1500);
    } catch (err) {
      if (isTransientPageEvalError(err)) return;
      throw err;
    }
  };

  // Inject and verify capture
  try {
    await ensureCaptureRunning("initial");
  } catch (err) {
    console.warn("[Main] Initial WebCodecs capture injection failed:", err);
  }

  // Watchdog to recover from page reloads
  return setInterval(() => {
    void ensureCaptureRunning("watchdog").catch((err) => {
      console.warn("[Main] Capture watchdog error:", err);
    });
  }, 5000);
}

type BrowserCaptureStatus = {
  recording?: boolean;
  wsConnected?: boolean;
  chunkCount?: number;
  bytesSent?: number;
  uptime?: number;
  lastChunkMs?: number;
  captureFps?: number;
};

async function getBrowserCaptureStatus(): Promise<BrowserCaptureStatus | null> {
  if (!page || page.isClosed()) return null;

  try {
    return (await page.evaluate(() => {
      return (
        window as unknown as {
          __captureControl__?: { getStatus: () => unknown };
        }
      ).__captureControl__?.getStatus?.();
    })) as BrowserCaptureStatus | null;
  } catch (err) {
    if (isTransientPageEvalError(err)) return null;
    throw err;
  }
}

async function stopInPageCaptureControl(): Promise<void> {
  if (!page || page.isClosed()) return;

  try {
    await page.evaluate(() => {
      (
        window as unknown as { __captureControl__?: { stop: () => void } }
      ).__captureControl__?.stop?.();
    });
  } catch (err) {
    if (!isTransientPageEvalError(err)) {
      console.warn("[Main] Failed to stop in-page capture control:", err);
    }
  }
}

async function waitForCaptureTraffic(
  bridge: ReturnType<typeof getRTMPBridge>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const captureStatus = await getBrowserCaptureStatus();
    const bridgeStats = bridge.getStats();
    const captureActive =
      captureStatus?.recording === true && captureStatus?.wsConnected === true;
    const hasTraffic = bridgeStats.bytesReceived > 0;

    if (captureActive && hasTraffic) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

// ── Main Entry Point ───────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log(`Hyperscape RTMP Streaming (${CAPTURE_MODE.toUpperCase()} mode)`);
  console.log("=".repeat(60));
  console.log("");

  // Check if any destinations are configured
  if (!hasConfiguredOutput()) {
    console.warn("");
    console.warn("WARNING: No RTMP outputs configured!");
    console.warn("Set environment variables:");
    console.warn("  - TWITCH_STREAM_KEY (or TWITCH_RTMP_STREAM_KEY)");
    console.warn(
      "  - Optional Twitch URL: TWITCH_STREAM_URL / TWITCH_RTMP_URL / TWITCH_RTMP_SERVER",
    );
    console.warn("  - YOUTUBE_STREAM_KEY (or YOUTUBE_RTMP_STREAM_KEY)");
    console.warn(
      "  - Optional YouTube URL: YOUTUBE_STREAM_URL / YOUTUBE_RTMP_URL",
    );
    console.warn("  - KICK_STREAM_KEY");
    console.warn("  - PUMPFUN_RTMP_URL");
    console.warn("  - X_RTMP_URL");
    console.warn("  - RTMP_DESTINATIONS_JSON");
    console.warn("");
    console.warn("Streaming will run but output will be discarded.");
    console.warn("");
  }

  // Get bridge instance
  const bridge = getRTMPBridge();

  // Start Spectator Server for zero-latency WebSockets stream
  bridge.startSpectatorServer(SPECTATOR_PORT);

  // Setup browser
  await setupBrowser();

  let captureWatchdog: ReturnType<typeof setInterval> | null = null;
  let activeCaptureMode: "cdp" | "webcodecs" | "mediarecorder" = CAPTURE_MODE;

  if (CAPTURE_MODE === "cdp") {
    // ── CDP Mode: Direct screencast frame piping ──
    await startCdpCapture(bridge);
  } else if (CAPTURE_MODE === "webcodecs") {
    // ── WebCodecs Mode: Native VideoEncoder API to FFmpeg -c:v copy ──
    captureWatchdog = (await startWebCodecsCapture(bridge)) ?? null;
    const healthy = await waitForCaptureTraffic(bridge, 20000);
    if (!healthy) {
      console.warn(
        "[Main] WebCodecs capture produced no media within 20s; falling back to CDP screencast capture.",
      );
      if (captureWatchdog) {
        clearInterval(captureWatchdog);
        captureWatchdog = null;
      }
      await stopInPageCaptureControl();
      bridge.stop();
      bridge.startSpectatorServer(SPECTATOR_PORT);
      await startCdpCapture(bridge);
      activeCaptureMode = "cdp";
    }
  } else {
    // ── Legacy Mode: MediaRecorder + WebSocket ──
    captureWatchdog = (await startLegacyCapture(bridge)) ?? null;
    activeCaptureMode = "mediarecorder";
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Streaming active! Press Ctrl+C to stop.");
  console.log("=".repeat(60));
  console.log("");

  writeExternalStatusSnapshot(bridge, activeCaptureMode);
  const statusSnapshotInterval = setInterval(() => {
    writeExternalStatusSnapshot(bridge, activeCaptureMode);
  }, 2000);

  // Status updates every 30 seconds
  const statusInterval = setInterval(async () => {
    const bridgeStatus = bridge.getStatus();
    const stats = bridge.getStats();
    const processMemory = process.memoryUsage();

    console.log("[Status] Active:", bridgeStatus.active);
    console.log(
      "[Status] Bytes received:",
      (stats.bytesReceived / 1024 / 1024).toFixed(2),
      "MB",
    );
    console.log(
      "[Status] Process RSS:",
      (processMemory.rss / 1024 / 1024).toFixed(1),
      "MB",
      "| Heap:",
      (processMemory.heapUsed / 1024 / 1024).toFixed(1),
      "MB",
    );
    console.log("[Status] Uptime:", Math.floor(stats.uptime / 1000), "seconds");
    console.log(
      "[Status] Destinations:",
      bridgeStatus.destinations
        .map((d) => `${d.name}: ${d.connected ? "OK" : "ERROR"}`)
        .join(", ") || "(none configured)",
    );

    if (activeCaptureMode === "cdp") {
      console.log(
        `[Stream Health] CDP FPS: ${cdpFps} | Frames: ${bridge.getDirectFrameCount()} | Dropped: ${cdpDroppedFrames} | BridgeDrops: ${stats.droppedFrames} | Backpressure: ${stats.backpressured ? "ON" : "off"}`,
      );
    } else {
      try {
        const captureStatus = await getBrowserCaptureStatus();
        if (captureStatus) {
          console.log("[Status] Capture:", captureStatus);
          if (typeof captureStatus.captureFps === "number") {
            const uptime = captureStatus.uptime ?? 0;
            const chunkCount = captureStatus.chunkCount ?? 0;
            const chunksPerSec =
              uptime > 0 ? (chunkCount / (uptime / 1000)).toFixed(1) : "0";
            console.log(
              `[Stream Health] Capture FPS: ${captureStatus.captureFps} | Latency: ${captureStatus.lastChunkMs}ms | Chunks/sec: ${chunksPerSec}`,
            );
          }
        }
        console.log(
          `[Stream Health] BridgeDrops: ${stats.droppedFrames} | Backpressure: ${stats.backpressured ? "ON" : "off"}`,
        );
      } catch {
        console.log("[Status] Capture: unavailable");
      }
    }
    console.log("");

    // Check for periodic restart to clear memory leaks
    if (Date.now() - launchTime > BROWSER_RESTART_INTERVAL_MS) {
      console.log(
        "[Main] 🔄 Scheduled browser rotation to prevent WebGL memory leaks.",
      );
      try {
        if (activeCaptureMode === "cdp") {
          await stopCdpCapture();
        } else {
          await stopInPageCaptureControl();
        }
        await setupBrowser();
        if (activeCaptureMode === "cdp") {
          await startCdpCapture(bridge);
        } else if (activeCaptureMode === "webcodecs") {
          // Watchdog will automatically inject script on new page
        }
      } catch (err) {
        console.error("[Main] Failed to rotate browser!", err);
      }
    }
  }, 30000);

  // Handle shutdown
  const shutdown = async () => {
    console.log("\n[Main] Shutting down...");
    if (captureWatchdog) clearInterval(captureWatchdog);
    clearInterval(statusSnapshotInterval);
    clearInterval(statusInterval);
    await stopCdpCapture();
    getRTMPBridge().stop();
    clearExternalStatusSnapshot();
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

async function cleanup() {
  console.log("[Main] Cleaning up...");

  if (page) {
    try {
      await page.evaluate(() => {
        (
          window as unknown as { __captureControl__?: { stop: () => void } }
        ).__captureControl__?.stop?.();
      });
    } catch {
      // Page might already be closed
    }
  }

  const bridge = getRTMPBridge();
  bridge.stopProcessing();

  if (browser) {
    await browser.close();
    browser = null;
  }

  clearExternalStatusSnapshot();
  console.log("[Main] Cleanup complete");
}

// Run
main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  cleanup().then(() => process.exit(1));
});
