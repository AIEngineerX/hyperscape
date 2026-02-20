import { chromium } from 'playwright';

const views = [
  { name: 'fresh3-desktop', width: 1440, height: 900 },
  { name: 'fresh3-mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
for (const view of views) {
  const context = await browser.newContext({ viewport: { width: view.width, height: view.height } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `.codex-artifacts/${view.name}.png`, fullPage: true });
  await context.close();
}
await browser.close();
console.log('saved fresh3 screenshots');
