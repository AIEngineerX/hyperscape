# Market Maker Bot

## Single instance

```bash
bun run start
```

Uses `.env` values in this package. You can provide one shared EVM key via `EVM_PRIVATE_KEY`, or chain-specific keys via `EVM_PRIVATE_KEY_BSC` and `EVM_PRIVATE_KEY_BASE`.

## Generate multiple wallet configs

```bash
bun run wallets:generate -- --count 5 --out wallets.generated.json --prefix mm
```

This writes wallet key material to `wallets.generated.json`. Keep that file private.

## Run multiple wallet instances

```bash
bun run start:multi -- --config wallets.generated.json --stagger-ms 1200
```

Optional:

```bash
bun run start:multi -- --config wallets.generated.json --dry-run
```

Use `/Users/sasankchunduri/hyperscape/packages/market-maker-bot/wallets.example.json` as the schema reference.

## Export generated Solana wallets to UI env

```bash
bun run wallets:ui-env -- --config wallets.generated.json --out ../gold-betting-demo/app/.env.local
```

This writes `VITE_HEADLESS_WALLETS=...` for the UI headless wallet adapters.
