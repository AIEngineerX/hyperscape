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
  if (/client-network|streaming|ws|socket|error|warn|ready|connected|state/i.test(t)) {
    logs.push(`[${m.type()}] ${t}`);
  }
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e?.message || e}`));

await page.goto(
  "http://localhost:3333/?page=stream&disableBridgeCapture=1&forceWebGL=1&disableWebGPU=1",
  { waitUntil: "domcontentloaded", timeout: 60000 },
);
await page.waitForTimeout(25000);

const state = await page.evaluate(async () => {
  const world = window.world;
  const net = world?.getSystem?.("network");
  const ws = net?.ws || net?.socket || null;
  let httpState = null;
  try {
    const res = await fetch("http://localhost:5555/api/streaming/state", { method: "GET" });
    const text = await res.text();
    httpState = { ok: res.ok, status: res.status, bodyStart: text.slice(0, 180) };
  } catch (e) {
    httpState = { ok: false, error: String(e) };
  }
  return {
    ready: window.__HYPERSCAPE_STREAM_READY__ === true,
    hasWorld: !!world,
    players: world?.entities?.players?.size ?? null,
    wsReadyState: ws?.readyState ?? null,
    wsUrl: ws?.url ?? net?.url ?? null,
    netId: net?.id ?? null,
    netConnected:
      net?.connected ??
      net?._connected ??
      net?.isConnected ??
      null,
    hasStreamingState: !!net?.streamingState,
    lastStreamingStateType: net?.streamingState?.type ?? null,
    httpState,
  };
});

console.log(JSON.stringify({ state, logs: logs.slice(-160) }, null, 2));
await browser.close();
