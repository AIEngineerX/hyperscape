#!/usr/bin/env bun
/**
 * Stream to RTMP
 *
 * Playwright-based script that:
 * 1. Starts the RTMP bridge server
 * 2. Launches a headless browser to Hyperscape streaming mode
 * 3. Injects canvas capture script
 * 4. Streams to configured RTMP destinations
 *
 * Usage:
 *   bun run stream:rtmp
 *   bun run packages/server/scripts/stream-to-rtmp.ts
 *
 * Environment Variables:
 *   TWITCH_STREAM_KEY    - Twitch stream key
 *   YOUTUBE_STREAM_KEY   - YouTube stream key
 *   PUMPFUN_RTMP_URL     - Pump.fun RTMP URL
 *   X_RTMP_URL           - X/Twitter RTMP URL
 *   GAME_URL             - URL to Hyperscape (default: http://localhost:3333/stream)
 *   RTMP_BRIDGE_PORT     - WebSocket port for bridge (default: 8765)
 */

import { chromium, type Browser, type Page } from "playwright";
import {
  startRTMPBridge,
  generateCaptureScript,
} from "../src/streaming/index.js";

// Configuration
const GAME_URL = process.env.GAME_URL || "http://localhost:3333/stream";
const BRIDGE_PORT = parseInt(process.env.RTMP_BRIDGE_PORT || "8765", 10);
const BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;

// Viewport settings (1080p)
const VIEWPORT = {
  width: 1920,
  height: 1080,
};

let browser: Browser | null = null;
let page: Page | null = null;

async function main() {
  console.log("=".repeat(60));
  console.log("Hyperscape RTMP Streaming");
  console.log("=".repeat(60));
  console.log("");

  // Start RTMP bridge
  console.log(`[Main] Starting RTMP bridge on port ${BRIDGE_PORT}...`);
  const bridge = startRTMPBridge(BRIDGE_PORT);

  // Check if any destinations are configured
  const status = bridge.getStatus();
  if (status.destinations.length === 0) {
    console.warn("");
    console.warn("WARNING: No RTMP destinations configured!");
    console.warn("Set environment variables:");
    console.warn("  - TWITCH_STREAM_KEY");
    console.warn("  - YOUTUBE_STREAM_KEY");
    console.warn("  - PUMPFUN_RTMP_URL");
    console.warn("  - X_RTMP_URL");
    console.warn("");
    console.warn("Streaming will run but output will be discarded.");
    console.warn("");
  }

  // Launch browser
  console.log("[Main] Launching browser...");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=egl", // Enable WebGL in headless
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-web-security", // Allow WebSocket connections
      "--autoplay-policy=no-user-gesture-required", // Allow audio autoplay
    ],
  });

  // Create page with viewport
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  page = await context.newPage();

  // Log browser console messages
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") {
      console.error("[Browser]", text);
    } else if (text.includes("[Capture]") || text.includes("[StreamingMode]")) {
      console.log("[Browser]", text);
    }
  });

  // Navigate to streaming mode
  console.log(`[Main] Navigating to ${GAME_URL}...`);
  try {
    await page.goto(GAME_URL, { timeout: 60000, waitUntil: "networkidle" });
  } catch (err) {
    console.error("[Main] Failed to load page:", err);
    console.error("[Main] Make sure the game server is running: bun run dev");
    await cleanup();
    process.exit(1);
  }

  // Wait for canvas to appear
  console.log("[Main] Waiting for game canvas...");
  try {
    await page.waitForSelector("canvas", { timeout: 30000 });
  } catch (err) {
    console.error("[Main] Canvas not found. Is the game loading correctly?");
    await cleanup();
    process.exit(1);
  }

  // Extra wait for game to initialize
  console.log("[Main] Waiting for game to initialize...");
  await page.waitForTimeout(5000);

  // Inject capture script
  console.log("[Main] Injecting capture script...");
  const captureScript = generateCaptureScript({
    bridgeUrl: BRIDGE_URL,
    fps: 30,
    bitrate: 6000000,
  });
  await page.evaluate(captureScript);

  // Wait a moment for capture to start
  await page.waitForTimeout(2000);

  // Check capture status
  const captureStatus = await page.evaluate(() => {
    return (
      window as unknown as { __captureControl__?: { getStatus: () => unknown } }
    ).__captureControl__?.getStatus?.();
  });
  console.log("[Main] Capture status:", captureStatus);

  console.log("");
  console.log("=".repeat(60));
  console.log("Streaming active! Press Ctrl+C to stop.");
  console.log("=".repeat(60));
  console.log("");

  // Status updates every 30 seconds
  const statusInterval = setInterval(async () => {
    const bridgeStatus = bridge.getStatus();
    const stats = bridge.getStats();

    console.log("[Status] Active:", bridgeStatus.active);
    console.log(
      "[Status] Bytes received:",
      (stats.bytesReceived / 1024 / 1024).toFixed(2),
      "MB",
    );
    console.log("[Status] Uptime:", Math.floor(stats.uptime / 1000), "seconds");
    console.log(
      "[Status] Destinations:",
      bridgeStatus.destinations
        .map((d) => `${d.name}: ${d.connected ? "OK" : "ERROR"}`)
        .join(", "),
    );
    console.log("");
  }, 30000);

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\n[Main] Shutting down...");
    clearInterval(statusInterval);
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n[Main] Received SIGTERM, shutting down...");
    clearInterval(statusInterval);
    await cleanup();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

async function cleanup() {
  console.log("[Main] Cleaning up...");

  if (page) {
    try {
      // Stop capture
      await page.evaluate(() => {
        (
          window as unknown as { __captureControl__?: { stop: () => void } }
        ).__captureControl__?.stop?.();
      });
    } catch {
      // Page might already be closed
    }
  }

  if (browser) {
    await browser.close();
    browser = null;
  }

  console.log("[Main] Cleanup complete");
}

// Run
main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  cleanup().then(() => process.exit(1));
});
