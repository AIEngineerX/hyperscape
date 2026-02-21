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
  if (/spectator|camera|stream|error|warn|loading|world|renderer|webgpu|webgl/i.test(t)) {
    logs.push(`[${m.type()}] ${t}`);
  }
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e?.message || e}`));

await page.goto(
  "http://localhost:3333/?embedded=true&mode=spectator&forceWebGL=1&disableWebGPU=1",
  { waitUntil: "domcontentloaded", timeout: 60000 },
);
await page.waitForTimeout(30000);

const state = await page.evaluate(() => {
  const world = window.world;
  const text = document.body?.innerText || "";
  return {
    text: text.slice(0, 300),
    hasCanvas: !!document.querySelector("canvas"),
    players: world?.entities?.players?.size ?? null,
    items: world?.entities?.items?.size ?? null,
    hasWorld: !!world,
    cam: world?.camera
      ? {
          x: world.camera.position.x,
          y: world.camera.position.y,
          z: world.camera.position.z,
        }
      : null,
  };
});

await page.screenshot({ path: "/root/hyperscape/tmp-spectator-state.png", fullPage: true });
console.log(JSON.stringify({ state, logs: logs.slice(-160) }, null, 2));
await browser.close();
