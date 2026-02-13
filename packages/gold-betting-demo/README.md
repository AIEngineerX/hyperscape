# GOLD Binary Fight Demo (Anchor + Vite + Helius)

Standalone demo package for a binary YES/NO betting market settled from a separate fight oracle.

## What this includes

- `anchor/programs/fight_oracle`: on-chain match lifecycle and winner posting.
- `anchor/programs/gold_binary_market`: on-chain GOLD-only binary market, market-maker seed logic, and winner claims.
- `anchor/tests/gold-betting-demo.ts`: local end-to-end tests using mock GOLD token accounts and local validator.
- `app`: standalone Vite app for wallet connect, market creation, bet placement, Jupiter conversion (SOL/USDC -> GOLD), settlement, and claiming.
- `keeper`: CLI automation scripts for market-maker seeding and oracle resolution, using Helius RPC.

## Core behavior

- Betting window is created on oracle match creation (`300s` by default in app / `.env.mainnet`).
- Market maker can seed equal liquidity on both sides only if no user bets exist after 10 seconds.
- Oracle and betting are separate programs.
- Market resolves only from oracle result.
- Payouts are in GOLD.
- SOL/USDC conversion in app is done via Jupiter before placing bet.

## Programs

- Fight oracle program id: `EW9GwxawnPEHA4eFgqd2oq9t55gSG4ReNqPRyG6Ui6PF`
- Market program id: `23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6`
- Mainnet GOLD mint: `DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump`

## Local E2E tests (Anchor + mock GOLD)

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/anchor`:

```bash
bun install
anchor build
anchor test --skip-build
```

Passing tests currently:

- market-maker auto seed after 10 seconds when market is empty
- oracle resolve + winner claim payout flow

## UI E2E tests (headless wallet + mock GOLD localnet)

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/app`:

```bash
bun run test:e2e
```

What this command does:

- builds Anchor programs
- starts a local validator with both demo programs preloaded
- seeds a deterministic mock GOLD mint + test wallet
- creates one resolved historical market and one open current market
- runs Playwright headless tests that click all primary UI actions:
  - refresh
  - seed-liquidity
  - place bet
  - resolve
  - claim
  - start new round

The app runs in `--mode e2e` with generated `/app/.env.e2e`.

## UI E2E tests on public clusters (headless wallet)

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/app`:

```bash
bun run test:e2e:testnet
bun run test:e2e:mainnet
```

What public E2E does:

- loads keypair from `E2E_HEADLESS_KEYPAIR_PATH` (defaults to `~/.config/solana/id.json`) or `E2E_HEADLESS_WALLET_SECRET_KEY`
- verifies oracle + market programs are deployed and executable on selected cluster
- initializes oracle config (if needed), then creates:
  - one short resolved market (for "last result")
  - one open current market (for bet flow)
- writes `/app/.env.e2e` for Vite headless wallet auto-connect
- runs Playwright against the live app in headless mode

Useful public E2E env vars:

- `E2E_CLUSTER`: `testnet` or `mainnet-beta` (script sets this for you)
- `E2E_HEADLESS_KEYPAIR_PATH`: wallet keypair path for headless test signing
- `E2E_RPC_URL`: override RPC endpoint
- `E2E_TESTNET_GOLD_MINT`: optional existing testnet GOLD-like mint; when omitted a mock Token-2022 mint is created automatically
- `E2E_DEPLOY_TESTNET_PROGRAMS=true`: optional one-time deploy attempt before testnet E2E run

Notes for balances:

- Mainnet E2E uses real GOLD mint `DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump`.
- If the wallet has no GOLD, test automatically places bet using `SOL` (swap-to-GOLD path), while seed-liquidity is expected to fail unless wallet already has GOLD.
- For full mainnet button-success flow (including seed), pre-fund the headless wallet with GOLD.

## Run the Vite app

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo`:

```bash
bun run dev
```

For mainnet mode:

```bash
bun run dev:mainnet
```

For testnet mode:

```bash
bun run dev:testnet
```

Build:

```bash
bun run build
bun run build:testnet
bun run build:mainnet
```

## Keeper scripts

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/keeper`:

```bash
bun install
```

Seed liquidity (after 10s if empty):

```bash
HELIUS_API_KEY=... \
MARKET_MAKER_KEYPAIR=~/.config/solana/id.json \
bun run seed -- --match-id 123456 --seed-gold 1
```

Resolve from oracle:

```bash
HELIUS_API_KEY=... \
ORACLE_AUTHORITY_KEYPAIR=~/.config/solana/id.json \
bun run resolve -- --match-id 123456
```

## Mainnet environment

Prepared files:

- `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/.env.mainnet`
- `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo/app/.env.mainnet`

These include provided Helius and Birdeye keys and default GOLD mint settings.

## Notes

- App now auto-discovers and displays `current market` + `last resolved result` and continuously refreshes state.
- Market setup inputs are removed from the UI for the demo path (fixed mint, no manual PDA loading).
- App localnet mode does not execute SOL/USDC conversion in UI; use direct GOLD in local mode. Jupiter conversion path is wired for mainnet.
- Anchor build uses a vendored `zmij` patch in `anchor/vendor/zmij` to avoid a toolchain incompatibility during IDL build on this machine.
