import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--disable-webgpu", "--enable-webgl", "--ignore-gpu-blocklist"],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];

page.on("console", (m) => {
  const t = m.text();
  if (
    /StreamingMode|streaming|duel|camera|error|warn|RendererFactory|WebGPU|WebGL|loading/i.test(
      t,
    )
  ) {
    logs.push(`[${m.type()}] ${t}`);
  }
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e?.message || e}`));

await page.goto(
  "http://localhost:3333/?page=stream&disableBridgeCapture=1&forceWebGL=1&disableWebGPU=1",
  {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  },
);

await page.waitForTimeout(40000);

const state = await page.evaluate(() => {
  const network = window.world?.getSystem?.("network");
  return {
    ready: window.__HYPERSCAPE_STREAM_READY__ === true,
    text: (document.body?.innerText || "").slice(0, 400),
    hasCanvas: Boolean(document.querySelector("canvas")),
    hasStreamingState: Boolean(network?.streamingState),
    terrainReady: window.world?.getSystem?.("terrain")?.isReady?.() ?? null,
    players: window.world?.entities?.players?.size ?? null,
  };
});

await page.screenshot({
  path: "/root/hyperscape/tmp-stream-state.png",
  fullPage: true,
});

console.log(JSON.stringify({ state, logs: logs.slice(-120) }, null, 2));
await browser.close();
