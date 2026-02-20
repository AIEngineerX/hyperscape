import { chromium } from 'playwright';

async function expectVisibleEither(page, a, b, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const aVisible = await page.getByText(a, { exact: false }).first().isVisible().catch(() => false);
    if (aVisible) return a;
    const bVisible = await page.getByText(b, { exact: false }).first().isVisible().catch(() => false);
    if (bVisible) return b;
    await page.waitForTimeout(150);
  }
  throw new Error(`Neither text became visible: ${a} | ${b}`);
}

async function run(viewport, name) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);

  await page.getByText('Wallets', { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /Add EVM Wallet/i }).first().waitFor({ timeout: 5000 });

  // Wallet-link button can be either active or disabled copy based on connection state.
  await page
    .getByRole('button', { name: /Link Solana \+ EVM wallets|Connect both wallets to link/i })
    .first()
    .waitFor({ timeout: 5000 });

  await page.getByRole('button', { name: /Leaderboard/i }).first().click();
  await page.getByText('All Agents', { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Close' }).first().click();

  const hasSelector = await page.locator('#chain-selector').count();
  if (hasSelector > 0) {
    await page.selectOption('#chain-selector', 'bsc');
    await expectVisibleEither(page, 'BSC Bet', 'BSC betting market is currently unavailable');

    await page.selectOption('#chain-selector', 'base');
    await expectVisibleEither(page, 'BASE Bet', 'BASE betting market is currently unavailable');

    await page.selectOption('#chain-selector', 'solana');
    await page.getByText('Bet on Match Winner', { exact: false }).first().waitFor({ timeout: 5000 });
  }

  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    hasTopBar: Boolean(document.querySelector('.top-bar')),
    hasLeftPanel: Boolean(document.querySelector('.panel-left')),
    hasRightPanel: Boolean(document.querySelector('.panel-right')),
  }));

  await page.screenshot({ path: `.codex-artifacts/smoke-${name}.png`, fullPage: true });
  await browser.close();
  return metrics;
}

const desktop = await run({ width: 1440, height: 900 }, 'desktop');
const mobile = await run({ width: 390, height: 844 }, 'mobile');
console.log({ desktop, mobile });
