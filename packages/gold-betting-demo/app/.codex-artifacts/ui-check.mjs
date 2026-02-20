import { chromium } from 'playwright';

const views = [
  { name: 'desktop-lg', width: 1440, height: 900 },
  { name: 'desktop-md', width: 1200, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-small', width: 360, height: 740 },
];

const results = [];

const browser = await chromium.launch({ headless: true });
for (const view of views) {
  const context = await browser.newContext({ viewport: { width: view.width, height: view.height } });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:4179/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const overflowX = Math.max(0, html.scrollWidth - html.clientWidth, body.scrollWidth - html.clientWidth);
      const overflowY = Math.max(0, html.scrollHeight - html.clientHeight, body.scrollHeight - html.clientHeight);

      const important = ['.top-bar', '.main-layout', '.panel-left', '.panel-right', '.panel-inner', '.place-order-btn', '.evm-connect-btn'];
      const bounds = important.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            selector,
            left: Math.round(r.left),
            top: Math.round(r.top),
            right: Math.round(r.right),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
            height: Math.round(r.height),
            outOfViewport: r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1,
          };
        }),
      );

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        overflowX,
        overflowY,
        outOfViewport: bounds.filter((b) => b.outOfViewport),
      };
    });

    await page.screenshot({ path: `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/app/.codex-artifacts/${view.name}.png`, fullPage: true });

    results.push({ view, ok: true, metrics });
  } catch (error) {
    results.push({ view, ok: false, error: String(error) });
  }
  await context.close();
}
await browser.close();

for (const result of results) {
  if (!result.ok) {
    console.log(`\n[${result.view.name}] ERROR ${result.error}`);
    continue;
  }
  const { viewport, overflowX, overflowY, outOfViewport } = result.metrics;
  console.log(`\n[${result.view.name}] ${viewport.width}x${viewport.height}`);
  console.log(`overflowX=${overflowX}, overflowY=${overflowY}, outOfViewportElements=${outOfViewport.length}`);
  for (const item of outOfViewport.slice(0, 8)) {
    console.log(`  - ${item.selector} @ [${item.left},${item.top},${item.right},${item.bottom}]`);
  }
}

console.log('\nScreenshots: /Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/app/.codex-artifacts/*.png');
