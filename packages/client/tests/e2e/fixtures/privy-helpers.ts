/**
 * Privy Login Helpers for Hyperscape E2E Tests
 *
 * Hyperscape auth flow:
 *   1. LoginScreen renders with "Enter" button
 *   2. Click "Enter" → Privy modal opens (wallet / email / google / farcaster)
 *   3. In Privy modal, "Continue with a wallet" → wallet list appears
 *   4. Click MetaMask (headless provider) → auto-approves eth_requestAccounts + personal_sign
 *   5. Privy authenticates → LoginScreen calls onAuthenticated()
 *   6. App transitions to UsernameSelection → CharacterSelect → Game
 *
 * For Solana:
 *   Same flow but select Phantom instead of MetaMask.
 *
 * These helpers interact with the actual Privy UI — no mocks.
 * The headless wallet providers handle the crypto operations.
 */

import type { Page } from "@playwright/test";
import type { HeadlessWeb3Wallet } from "./wallet-fixtures";

// =============================================================================
// AUTH STATE DETECTION
// =============================================================================

/**
 * Check if a wallet is connected (user is past the LoginScreen).
 * In Hyperscape, the login screen has an "Enter" button.
 * If it's gone, the user is authenticated.
 */
export async function isWalletConnected(page: Page): Promise<boolean> {
  await page.waitForTimeout(1000);

  // Check for the "Enter" button on the LoginScreen
  const enterButton = page.locator('button:has-text("Enter")').first();
  const enterVisible = await enterButton
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (enterVisible) return false;

  // Also check for "Sign In" or login-related buttons
  const signInButton = page.locator('button:has-text("Sign In")').first();
  const signInVisible = await signInButton
    .isVisible({ timeout: 1000 })
    .catch(() => false);

  return !signInVisible;
}

/**
 * Check if Privy SDK has initialized.
 * Useful for verifying the app is ready before attempting login.
 */
export async function isPrivyReady(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Check for Privy initialization markers
    const win = window as Record<string, unknown>;

    // Privy stores state in various ways - check common indicators
    const hasPrivyRoot = document.querySelector("[id*='privy']") !== null;
    const hasPrivyIframe =
      document.querySelector("iframe[src*='privy']") !== null;

    return hasPrivyRoot || hasPrivyIframe;
  });
}

// =============================================================================
// EVM WALLET CONNECTION
// =============================================================================

/**
 * Connect EVM wallet via Privy in Hyperscape.
 *
 * Flow: Click "Enter" → Privy modal → "Continue with a wallet" → MetaMask
 *
 * The headless-web3-provider is configured with AUTO_PERMIT_ALL, so it
 * auto-responds to eth_requestAccounts, personal_sign, etc.
 *
 * @param page - Playwright page
 * @param _wallet - HeadlessWeb3Wallet reference (auto-approves, but passed for type safety)
 */
export async function connectEvmWalletViaPrivy(
  page: Page,
  _wallet?: HeadlessWeb3Wallet,
): Promise<void> {
  // If already connected, nothing to do
  if (await isWalletConnected(page)) {
    console.log("[connectEvmWalletViaPrivy] Already connected, skipping");
    return;
  }

  // Step 1: Click "Enter" on the Hyperscape LoginScreen
  const enterButton = page.locator('button:has-text("Enter")').first();
  if (!(await enterButton.isVisible({ timeout: 8000 }).catch(() => false))) {
    console.log(
      "[connectEvmWalletViaPrivy] No Enter button found — may already be past login",
    );
    return;
  }

  console.log("[connectEvmWalletViaPrivy] Clicking Enter button...");
  await enterButton.click();
  await page.waitForTimeout(2000);

  // Step 2: Click "Continue with a wallet" in Privy modal
  const continueWithWalletSelectors = [
    'button:has-text("Continue with a wallet")',
    'button:has-text("Connect wallet")',
    'button:has-text("Wallet")',
    'div[role="button"]:has-text("Continue with a wallet")',
  ];

  let clickedContinue = false;
  for (const selector of continueWithWalletSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(
        `[connectEvmWalletViaPrivy] Clicking wallet option: ${selector}`,
      );
      await btn.click();
      clickedContinue = true;
      break;
    }
  }

  if (!clickedContinue) {
    console.log(
      "[connectEvmWalletViaPrivy] No 'Continue with wallet' button found — Privy may show wallets directly",
    );
  }

  await page.waitForTimeout(2000);

  // Step 3: Click MetaMask (our headless provider masquerades as MetaMask)
  const walletSelectors = [
    'button:has-text("MetaMask")',
    'div[role="button"]:has-text("MetaMask")',
    '[data-testid*="metamask"]',
    'button:has-text("Headless Web3")',
    'div[role="button"]:has-text("Headless Web3")',
    'button:has-text("Browser Wallet")',
    'button:has-text("Injected")',
  ];

  let clickedWallet = false;
  for (const selector of walletSelectors) {
    const option = page.locator(selector).first();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[connectEvmWalletViaPrivy] Clicking wallet: ${selector}`);
      await option.click();
      clickedWallet = true;
      break;
    }
  }

  if (!clickedWallet) {
    // Debug: log all visible buttons
    await page
      .screenshot({ path: "/tmp/hyperscape-privy-wallet-debug.png" })
      .catch(() => {});
    const buttons = await page.locator("button, [role='button']").all();
    for (const btn of buttons.slice(0, 20)) {
      const text = (await btn.textContent().catch(() => ""))?.trim();
      if (text && text.length > 0 && text.length < 100) {
        console.log(`[connectEvmWalletViaPrivy] Visible button: "${text}"`);
      }
    }
    console.log(
      "[connectEvmWalletViaPrivy] No wallet option found in Privy modal",
    );
    return;
  }

  // Step 4: Wait for connection to complete
  // The headless provider auto-approves everything, so just wait for
  // the login screen to transition away
  await waitForAuthCompletion(page);
}

// =============================================================================
// SOLANA WALLET CONNECTION
// =============================================================================

/**
 * Connect Solana wallet (Phantom) via Privy in Hyperscape.
 *
 * Flow: Click "Enter" → Privy modal → "Continue with a wallet" → Phantom
 *
 * The Phantom mock is already injected via addInitScript and auto-handles
 * connect() and signMessage() operations.
 *
 * @param page - Playwright page
 */
export async function connectSolanaWalletViaPrivy(page: Page): Promise<void> {
  if (await isWalletConnected(page)) {
    console.log("[connectSolanaWalletViaPrivy] Already connected, skipping");
    return;
  }

  // Step 1: Click "Enter" on the Hyperscape LoginScreen
  const enterButton = page.locator('button:has-text("Enter")').first();
  if (!(await enterButton.isVisible({ timeout: 8000 }).catch(() => false))) {
    console.log(
      "[connectSolanaWalletViaPrivy] No Enter button found — may already be past login",
    );
    return;
  }

  console.log("[connectSolanaWalletViaPrivy] Clicking Enter button...");
  await enterButton.click();
  await page.waitForTimeout(2000);

  // Step 2: Click "Continue with a wallet"
  const continueBtn = page
    .locator('button:has-text("Continue with a wallet")')
    .first();
  if (await continueBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(2000);
  }

  // Step 3: Click Phantom — Privy shows detected Phantom wallet
  const phantomOptions = await page
    .locator(
      'button:has-text("Phantom"), div[role="button"]:has-text("Phantom")',
    )
    .all();

  if (phantomOptions.length >= 2) {
    // If multiple Phantom entries, the last one is usually the "Solana" variant
    await phantomOptions[phantomOptions.length - 1].click();
  } else if (phantomOptions.length === 1) {
    await phantomOptions[0].click();
  } else {
    console.log(
      "[connectSolanaWalletViaPrivy] No Phantom option found in Privy modal",
    );
    return;
  }

  await page.waitForTimeout(2000);

  // Dismiss any intermediate modals
  const gotIt = page.locator('button:has-text("Got it")').first();
  if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) {
    await gotIt.click();
    await page.waitForTimeout(500);
  }

  await waitForAuthCompletion(page);
}

// =============================================================================
// AUTH COMPLETION & POST-LOGIN FLOW
// =============================================================================

/**
 * Wait for Privy auth to complete and the LoginScreen to transition away.
 * After wallet connect, Hyperscape goes through:
 *   LoginScreen → UsernameSelection (if new user) → CharacterSelect → Game
 *
 * This helper waits until the "Enter" button is gone, indicating successful auth.
 */
export async function waitForAuthCompletion(
  page: Page,
  timeoutMs: number = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check if "Enter" button is gone (login complete)
    const enterGone = !(await page
      .locator('button:has-text("Enter")')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false));

    if (enterGone) {
      console.log("[waitForAuthCompletion] Auth completed — Enter button gone");
      return true;
    }

    // Dismiss any intermediate "Got it" or confirmation buttons
    const gotIt = page.locator('button:has-text("Got it")').first();
    if (await gotIt.isVisible({ timeout: 300 }).catch(() => false)) {
      await gotIt.click();
    }

    await page.waitForTimeout(500);
  }

  console.log(
    `[waitForAuthCompletion] Auth did not complete within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Wait for the username selection screen to appear (after first login).
 * Returns true if it appeared, false if we're past it already.
 */
export async function waitForUsernameScreen(
  page: Page,
  timeoutMs: number = 10_000,
): Promise<boolean> {
  const usernameInput = page
    .locator(
      'input[placeholder*="username" i], input[name="username"], [data-testid="username-input"]',
    )
    .first();

  return usernameInput.isVisible({ timeout: timeoutMs }).catch(() => false);
}

/**
 * Fill in a username if the username selection screen is shown.
 * Returns true if username was submitted, false if screen wasn't shown.
 */
export async function fillUsername(
  page: Page,
  username: string,
): Promise<boolean> {
  const usernameInput = page
    .locator(
      'input[placeholder*="username" i], input[name="username"], [data-testid="username-input"]',
    )
    .first();

  if (!(await usernameInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }

  await usernameInput.fill(username);
  await page.waitForTimeout(500);

  // Submit the username
  const submitSelectors = [
    '[data-testid="submit-username"]',
    'button[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Create")',
    'button:has-text("Play")',
    'button:has-text("Confirm")',
  ];

  for (const selector of submitSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      console.log(`[fillUsername] Submitted username via ${selector}`);
      return true;
    }
  }

  // Try pressing Enter as fallback
  await usernameInput.press("Enter");
  console.log("[fillUsername] Submitted username via Enter key");
  return true;
}

// =============================================================================
// CHARACTER SELECTION / CREATION HELPERS
// =============================================================================

/**
 * Wait for the CharacterSelectScreen to appear.
 * This screen shows after username is set (or after login for returning users).
 * Detects the character list, "Create New" button, or "Enter World" button.
 */
export async function waitForCharacterSelect(
  page: Page,
  timeoutMs: number = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check for character select indicators
    const hasCharacterUI =
      (await page
        .locator('button:has-text("Create New")')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false)) ||
      (await page
        .locator('button:has-text("Enter World")')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false)) ||
      (await page
        .locator("text=No characters yet.")
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false)) ||
      (await page
        .locator('button:has-text("Sign out")')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false));

    if (hasCharacterUI) {
      console.log("[waitForCharacterSelect] Character select screen detected");
      return true;
    }

    await page.waitForTimeout(500);
  }

  console.log(
    `[waitForCharacterSelect] Character select did not appear within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Check if any existing characters are listed on the CharacterSelectScreen.
 * Returns the count of character buttons found.
 */
export async function getExistingCharacterCount(page: Page): Promise<number> {
  // Character buttons are inside the scrollable list. Each character has a
  // button with the character name (font-semibold text-xl class).
  // The "Create New" button also has text-xl but says "Create New", so exclude it.
  // Character entries have an arrow "›" next to them.
  const characterEntries = await page
    .locator('.space-y-3 button:not(:has-text("Create New"))')
    .all();

  // Filter out non-character buttons (the list should only contain character buttons)
  let count = 0;
  for (const entry of characterEntries) {
    const text = (await entry.textContent().catch(() => ""))?.trim() ?? "";
    // Character buttons contain the character name (not "Create New", "Cancel", etc.)
    if (
      text.length > 0 &&
      !text.includes("Create New") &&
      !text.includes("Cancel") &&
      !text.includes("Sign out")
    ) {
      count++;
    }
  }

  return count;
}

/**
 * Select the first existing character from the list.
 * Clicks the character button which transitions to the "confirm" view.
 */
export async function selectFirstCharacter(page: Page): Promise<boolean> {
  // Find character buttons in the scrollable list
  // Characters are buttons that contain a name span with text-xl font-semibold
  // They are NOT "Create New" or "Cancel"
  const characterButtons = page.locator(
    '.space-y-3 button:not(:has-text("Create New")):not(:has-text("Cancel")):not(:has-text("Sign out"))',
  );

  const count = await characterButtons.count();
  if (count === 0) {
    console.log("[selectFirstCharacter] No characters found in list");
    return false;
  }

  const firstChar = characterButtons.first();
  const charName = (await firstChar.textContent().catch(() => ""))?.trim();
  console.log(
    `[selectFirstCharacter] Selecting character: "${charName}" (1 of ${count})`,
  );
  await firstChar.click();
  await page.waitForTimeout(1000);

  // Verify we transitioned to confirm view (Enter World button should appear)
  const enterWorldBtn = page.locator('button:has-text("Enter World")').first();
  const hasConfirmView = await enterWorldBtn
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (hasConfirmView) {
    console.log("[selectFirstCharacter] Confirm view shown with Enter World");
  }

  return hasConfirmView;
}

/**
 * Create a new character on the CharacterSelectScreen.
 *
 * Flow:
 *   1. Click "Create New" to open the creation form
 *   2. Fill in character name
 *   3. Click "Create" to submit
 *   4. Wait for character to appear in the list or confirm view
 *
 * @param page - Playwright page
 * @param characterName - Name for the new character (3-20 chars)
 * @returns true if character was created and selected
 */
export async function createNewCharacter(
  page: Page,
  characterName: string,
): Promise<boolean> {
  // Step 1: Click "Create New" to open the creation form
  const createNewBtn = page.locator('button:has-text("Create New")').first();
  if (!(await createNewBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(
      "[createNewCharacter] Create New button not found - form may already be open",
    );
  } else {
    await createNewBtn.click();
    await page.waitForTimeout(1000);
  }

  // Step 2: Fill in character name
  // The input has a special dash character in the placeholder: "Name (3–20 chars)"
  const nameInput = page.locator('input[placeholder*="Name"]').first();

  if (!(await nameInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("[createNewCharacter] Name input not found");
    return false;
  }

  await nameInput.clear();
  await nameInput.fill(characterName);
  await page.waitForTimeout(500);

  // Step 3: Click "Create" button (not "Create New" or "Create Account")
  // The Create button is a submit button inside the character creation form
  const createBtn = page
    .locator('button[type="submit"]:has-text("Create")')
    .first();

  if (!(await createBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    // Fallback: try any button that says exactly "Create"
    const fallbackBtn = page.locator('button:has-text("Create")').first();
    if (await fallbackBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      const btnText =
        (await fallbackBtn.textContent().catch(() => ""))?.trim() ?? "";
      if (btnText === "Create" || btnText === "Creating...") {
        await fallbackBtn.click();
      }
    } else {
      console.log("[createNewCharacter] Create button not found");
      return false;
    }
  } else {
    await createBtn.click();
  }

  console.log(
    `[createNewCharacter] Submitted character creation: "${characterName}"`,
  );

  // Step 4: Wait for the character to be created
  // After creation, the character should appear in the list, or we go to confirm view
  await page.waitForTimeout(3000);

  // Check if we went to confirm view automatically
  const enterWorldBtn = page.locator('button:has-text("Enter World")').first();
  if (await enterWorldBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("[createNewCharacter] Character created - confirm view shown");
    return true;
  }

  // Check if character appeared in the list (creation form closed)
  const createNewVisible = await page
    .locator('button:has-text("Create New")')
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  if (createNewVisible) {
    console.log(
      "[createNewCharacter] Character created - returned to list view",
    );
    // Now select it
    return selectFirstCharacter(page);
  }

  // Check for error messages
  const errorMsg = page.locator(".bg-red-900").first();
  if (await errorMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
    const errorText =
      (await errorMsg.textContent().catch(() => ""))?.trim() ?? "";
    console.log(`[createNewCharacter] Error: "${errorText}"`);
    return false;
  }

  console.log("[createNewCharacter] Character creation status unclear");
  return false;
}

/**
 * Click "Enter World" to enter the game.
 * Must be on the confirm view (after selecting a character).
 * Waits for the GameClient to load.
 */
export async function clickEnterWorld(
  page: Page,
  timeoutMs: number = 30_000,
): Promise<boolean> {
  const enterWorldBtn = page.locator('button:has-text("Enter World")').first();

  if (!(await enterWorldBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("[clickEnterWorld] Enter World button not found");
    return false;
  }

  // Make sure button is enabled
  const isDisabled = await enterWorldBtn.isDisabled();
  if (isDisabled) {
    console.log("[clickEnterWorld] Enter World button is disabled — waiting");
    await page.waitForTimeout(3000);
    if (await enterWorldBtn.isDisabled()) {
      console.log("[clickEnterWorld] Enter World still disabled after wait");
      return false;
    }
  }

  console.log("[clickEnterWorld] Clicking Enter World...");
  await enterWorldBtn.click();

  // Wait for game canvas to appear (GameClient renders #game-canvas)
  return waitForGameClient(page, timeoutMs);
}

/**
 * Wait for the GameClient to render (indicates we're in the game).
 * Checks for #game-canvas and #main-content elements.
 */
export async function waitForGameClient(
  page: Page,
  timeoutMs: number = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check for GameClient DOM elements
    const hasGameCanvas = await page
      .locator("#game-canvas, .App__viewport, [data-component='viewport']")
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (hasGameCanvas) {
      console.log(
        "[waitForGameClient] Game canvas detected — player is in game",
      );
      return true;
    }

    // Check for "Entering..." text (transitioning)
    const entering = await page
      .locator("text=Entering...")
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (entering) {
      console.log("[waitForGameClient] Entering world...");
    }

    await page.waitForTimeout(1000);
  }

  console.log(
    `[waitForGameClient] Game client did not appear within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Check if the player is currently in the game (GameClient is rendered).
 */
export async function isInGame(page: Page): Promise<boolean> {
  return page
    .locator("#game-canvas, .App__viewport, [data-component='viewport']")
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
}

// =============================================================================
// FULL FLOW HELPER: Login → Username → Character → Enter World
// =============================================================================

/**
 * Complete the full login-to-game flow.
 *
 * Handles all states:
 *   1. Wallet connect via Privy (LoginScreen)
 *   2. Username creation if first-time user (UsernameSelectionScreen)
 *   3. Character selection or creation (CharacterSelectScreen)
 *   4. Enter World (confirm view → GameClient)
 *
 * @param page - Playwright page
 * @param wallet - HeadlessWeb3Wallet (optional, for EVM auto-approve)
 * @param options - Configuration for the flow
 * @returns true if successfully entered the game
 */
export async function completeFullLoginFlow(
  page: Page,
  wallet?: HeadlessWeb3Wallet,
  options: {
    username?: string;
    characterName?: string;
    /** If true, skip entering the world (stop at character select) */
    skipEnterWorld?: boolean;
  } = {},
): Promise<boolean> {
  const username = options.username ?? `e2e_${Date.now().toString().slice(-8)}`;
  const characterName =
    options.characterName ?? `TestChar_${Date.now().toString().slice(-6)}`;

  // Step 1: Connect wallet via Privy
  console.log("[fullFlow] Step 1: Connecting wallet via Privy...");
  await connectEvmWalletViaPrivy(page, wallet);

  // Give Privy time to complete auth and the app to check username
  await page.waitForTimeout(3000);

  // Step 2: Handle username selection (first-time users)
  console.log("[fullFlow] Step 2: Checking for username selection...");
  const usernameInput = page
    .locator('input[placeholder*="Enter username"]')
    .first();
  const needsUsername = await usernameInput
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (needsUsername) {
    console.log(`[fullFlow] New user — creating username: ${username}`);
    await usernameInput.fill(username);
    await page.waitForTimeout(500);

    const createAccountBtn = page
      .locator('button:has-text("Create Account")')
      .first();
    if (
      await createAccountBtn.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await createAccountBtn.click();
      console.log("[fullFlow] Submitted username creation");
      await page.waitForTimeout(3000);
    }
  } else {
    console.log("[fullFlow] Existing user — skipping username selection");
  }

  // Step 3: Handle character selection
  console.log("[fullFlow] Step 3: Handling character selection...");
  const charScreenReady = await waitForCharacterSelect(page, 15000);
  if (!charScreenReady) {
    // Check if we're already in game (Privy disabled mode, or fast transition)
    if (await isInGame(page)) {
      console.log("[fullFlow] Already in game — skipping character select");
      return true;
    }
    console.log("[fullFlow] Character select screen not found");
    return false;
  }

  // Check for existing characters
  const existingCount = await getExistingCharacterCount(page);
  console.log(`[fullFlow] Found ${existingCount} existing character(s)`);

  if (existingCount > 0) {
    // Select the first existing character
    console.log("[fullFlow] Selecting first existing character...");
    const selected = await selectFirstCharacter(page);
    if (!selected) {
      console.log("[fullFlow] Failed to select existing character");
      return false;
    }
  } else {
    // Create a new character
    console.log(
      `[fullFlow] No characters found — creating: "${characterName}"`,
    );
    const created = await createNewCharacter(page, characterName);
    if (!created) {
      console.log("[fullFlow] Failed to create character");
      return false;
    }
  }

  // Step 4: Enter the world
  if (options.skipEnterWorld) {
    console.log("[fullFlow] Skipping Enter World (as requested)");
    return true;
  }

  console.log("[fullFlow] Step 4: Entering world...");
  const enteredGame = await clickEnterWorld(page, 30_000);
  if (enteredGame) {
    console.log("[fullFlow] Successfully entered the game!");
  } else {
    console.log("[fullFlow] Failed to enter the game");
  }

  return enteredGame;
}

// =============================================================================
// DISCONNECT / LOGOUT
// =============================================================================

/**
 * Disconnect wallet / log out of Hyperscape.
 * Looks for logout/disconnect buttons in various UI locations.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  // Try clicking settings/menu first
  const menuSelectors = [
    '[data-testid="settings-button"]',
    '[data-testid="user-menu"]',
    'button:has-text("Settings")',
    'button:has-text("Account")',
    // Hyperscape may have a gear icon or similar
    '[data-panel-id="settings"]',
  ];

  for (const selector of menuSelectors) {
    const menu = page.locator(selector).first();
    if (await menu.isVisible({ timeout: 1000 }).catch(() => false)) {
      await menu.click();
      await page.waitForTimeout(500);
      break;
    }
  }

  // Find and click disconnect/logout
  const logoutSelectors = [
    'button:has-text("Disconnect")',
    'button:has-text("Sign Out")',
    'button:has-text("Log Out")',
    'button:has-text("Logout")',
    '[data-testid="logout-button"]',
  ];

  for (const selector of logoutSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1000);
      console.log(`[disconnectWallet] Logged out via ${selector}`);
      return;
    }
  }

  // Fallback: use Privy's global logout function
  await page
    .evaluate(() => {
      const win = window as typeof window & { privyLogout?: () => void };
      if (typeof win.privyLogout === "function") {
        win.privyLogout();
      }
    })
    .catch(() => {});
  await page.waitForTimeout(1000);

  console.log("[disconnectWallet] Used privy global logout fallback");
}

// =============================================================================
// PAGE NAVIGATION HELPERS
// =============================================================================

/**
 * Navigate to the Hyperscape app and wait for initial load.
 */
export async function waitForAppReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  // Give React time to hydrate and Privy SDK time to initialize
  await page.waitForTimeout(2000);
}
