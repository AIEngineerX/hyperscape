import { defineConfig, devices } from "@playwright/test";

const CLIENT_PORT = Number(process.env.VITE_PORT ?? 3333);
const SERVER_PORT = Number(process.env.PORT ?? 5555);

// Playwright sets FORCE_COLOR; if NO_COLOR is also present it emits noisy startup warnings.
delete process.env.NO_COLOR;

/**
 * Playwright Configuration for Client Tests
 *
 * Tests run against real Hyperscape instances - NO MOCKS.
 * Uses visual testing with colored cube proxies per project rules.
 *
 * Supports two test categories:
 *   1. Web3 Login tests (web3-login.spec.ts) — headless wallet injection via
 *      headless-web3-provider + Phantom mock. No browser extensions needed.
 *   2. Game E2E tests (auth.spec.ts, combat.spec.ts, etc.) — full game testing.
 *
 * Run all:       bunx playwright test
 * Run web3:      bunx playwright test tests/e2e/web3-login.spec.ts
 * Run auth:      bunx playwright test tests/e2e/auth.spec.ts
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 15000,
  },
  fullyParallel: false, // Run tests sequentially for reliable screenshots
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["github"],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  use: {
    // WebGPU is required; run headed browser sessions for all E2E tests.
    headless: false,
    // Base URL for the client
    baseURL: `http://localhost:${CLIENT_PORT}`,
    // Capture trace on first retry
    trace: "on-first-retry",
    // Screenshot on failure
    screenshot: "only-on-failure",
    // Video on failure
    video: "on-first-retry",
    // Action and navigation timeouts
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // Auto-start dev servers before tests
  webServer: [
    // Start the game server
    {
      command: "env -u NO_COLOR bun run start",
      cwd: "../server",
      port: SERVER_PORT,
      timeout: 120 * 1000,
      reuseExistingServer: true,
    },
    // Start the client
    {
      command: "env -u NO_COLOR bun run dev",
      url: "http://localhost:3333",
      reuseExistingServer: true,
      timeout: 300000, // 5 minutes
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
