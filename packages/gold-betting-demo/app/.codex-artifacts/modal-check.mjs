import { chromium } from 'playwright';

async function run(name, viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Leaderboard/i }).click();
  await page.waitForTimeout(250);

  const metrics = await page.evaluate(() => {
    const modal = document.querySelector('[style*="position: fixed"][style*="z-index: 60"]');
    const panel = modal?.firstElementChild;
    const rect = panel?.getBoundingClientRect();
    return rect
      ? {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          vw: window.innerWidth,
          vh: window.innerHeight,
          overflowX: Math.max(0, rect.right - window.innerWidth) + Math.max(0, -rect.left),
        }
      : null;
  });

  await page.screenshot({ path: `.codex-artifacts/${name}.png`, fullPage: true });
  await browser.close();
  console.log(name, metrics);
}

await run('modal-desktop', { width: 1440, height: 900 });
await run('modal-mobile', { width: 390, height: 844 });
