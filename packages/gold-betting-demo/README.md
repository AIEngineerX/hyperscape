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

## Run the Vite app

From `/Users/shawwalters/eliza-workspace/hyperscape/packages/gold-betting-demo`:

```bash
bun run dev
```

For mainnet mode:

```bash
bun run dev:mainnet
```

Build:

```bash
bun run build
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

- App localnet mode does not execute SOL/USDC conversion in UI; use direct GOLD in local mode. Jupiter conversion path is wired for mainnet.
- Anchor build uses a vendored `zmij` patch in `anchor/vendor/zmij` to avoid a toolchain incompatibility during IDL build on this machine.
