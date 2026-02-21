import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--disable-webgpu", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:3333/?embedded=true&mode=spectator&forceWebGL=1&disableWebGPU=1", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(35000);
const result = await page.evaluate(() => {
  const world = window.world;
  const statuses = (world?.systems || []).map((s) => ({
    id: s.id || s.name || s.constructor?.name || null,
    initialized:
      s._initialized ??
      s.initialized ??
      s.ready ??
      s.isInitialized ??
      null,
    started: s._started ?? s.started ?? null,
  }));
  const pending = statuses.filter((s) => s.initialized !== true || s.started !== true).slice(0, 40);
  return {
    systemCount: statuses.length,
    pendingCount: pending.length,
    pending,
    worldInitializedFlag: world?._initialized ?? null,
    text: (document.body?.innerText || "").slice(0, 180),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
