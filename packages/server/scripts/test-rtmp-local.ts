#!/usr/bin/env bun
/**
 * Test RTMP Local
 *
 * Tests the streaming pipeline with a local RTMP server (nginx-rtmp).
 *
 * Prerequisites:
 *   docker run -d -p 1935:1935 --name rtmp-test tiangolo/nginx-rtmp
 *
 * Usage:
 *   bun run stream:test
 *
 * View the stream:
 *   ffplay rtmp://localhost:1935/live/test
 *   or
 *   vlc rtmp://localhost:1935/live/test
 */

import { chromium, type Browser, type Page } from "playwright";
import { RTMPBridge, generateCaptureScript } from "../src/streaming/index.js";

const LOCAL_RTMP_URL = "rtmp://localhost:1935/live/test";
const GAME_URL = process.env.GAME_URL || "http://localhost:3333/stream";
const BRIDGE_PORT = 8765;

let browser: Browser | null = null;
let bridge: RTMPBridge | null = null;

async function main() {
  console.log("=".repeat(60));
  console.log("RTMP Streaming Test (Local)");
  console.log("=".repeat(60));
  console.log("");
  console.log("This test streams to a local RTMP server.");
  console.log("");
  console.log("Prerequisites:");
  console.log(
    "  docker run -d -p 1935:1935 --name rtmp-test tiangolo/nginx-rtmp",
  );
  console.log("");
  console.log("View the stream:");
  console.log("  ffplay rtmp://localhost:1935/live/test");
  console.log("  vlc rtmp://localhost:1935/live/test");
  console.log("");
  console.log("=".repeat(60));
  console.log("");

  // Create bridge with local destination
  bridge = new RTMPBridge({
    videoBitrate: 2500, // Lower for testing
    preset: "ultrafast",
  });

  // Add local test destination
  bridge.addDestination({
    name: "Local Test",
    url: LOCAL_RTMP_URL,
    key: "",
    enabled: true,
  });

  // Start bridge
  bridge.start(BRIDGE_PORT);

  // Launch browser
  console.log("[Test] Launching browser...");
  browser = await chromium.launch({
    headless: false, // Visible for testing
    args: ["--use-gl=egl", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    console.log("[Browser]", msg.text());
  });

  // Navigate
  console.log(`[Test] Navigating to ${GAME_URL}...`);
  try {
    await page.goto(GAME_URL, { timeout: 30000 });
  } catch (err) {
    console.error("[Test] Failed to load game. Is the server running?");
    console.error("[Test] Start with: bun run dev");
    await cleanup();
    process.exit(1);
  }

  // Wait for canvas
  console.log("[Test] Waiting for canvas...");
  await page.waitForSelector("canvas", { timeout: 20000 });
  await page.waitForTimeout(3000);

  // Inject capture
  console.log("[Test] Starting capture...");
  const script = generateCaptureScript({
    bridgeUrl: `ws://localhost:${BRIDGE_PORT}`,
    fps: 30,
    bitrate: 3000000,
  });
  await page.evaluate(script);

  console.log("");
  console.log("[Test] Streaming started!");
  console.log("[Test] View at: ffplay rtmp://localhost:1935/live/test");
  console.log("[Test] Press Ctrl+C to stop");
  console.log("");

  // Status updates
  setInterval(() => {
    const stats = bridge?.getStats();
    if (stats) {
      console.log(
        `[Status] Received: ${(stats.bytesReceived / 1024 / 1024).toFixed(2)} MB | ` +
          `Uptime: ${Math.floor(stats.uptime / 1000)}s`,
      );
    }
  }, 10000);

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  await new Promise(() => {});
}

async function cleanup() {
  console.log("\n[Test] Stopping...");
  bridge?.stop();
  if (browser) await browser.close();
}

main().catch(console.error);
