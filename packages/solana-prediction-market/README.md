# Hyperscape Solana Prediction Market

This package contains the Solana on-chain program for:

- duel outcome oracle reports (`OracleRound`)
- GOLD-denominated prediction markets (`MarketRound`)
- bettor positions (`Position`)
- settlement with protocol fee (`fee_bps = 100` by default)
- manual claim and keeper-assisted claim (`claim_for`)

## Program

Path:

- `programs/hyperscape_prediction_market/src/lib.rs`

Core instruction flow:

1. `initialize_config`
2. `init_oracle_round`
3. `init_market`
4. `place_bet`
5. `lock_market`
6. `report_outcome`
7. `resolve_market_from_oracle`
8. `claim` or `claim_for`

Custodial/direct-deposit flow:

9. `place_bet_for` (keeper/authority places bet for original bettor wallet after inbound transfer)

The program is token-program agnostic via `TokenInterface`, so SPL Token and
Token-2022 mints are supported. Hyperscape GOLD on Solana is Token-2022.

## Local development

```bash
cd packages/solana-prediction-market
anchor build
bun run test:e2e:local
```

Run verification scripts:

```bash
# local end-to-end lifecycle test (local validator + contract interactions)
bun run test:e2e:local

# mainnet deployment/readiness verification (no write txs)
# requires SOLANA_ARENA_MARKET_PROGRAM_ID to be set
bun run test:e2e:mainnet
```

`test:e2e:local` uses `scripts/run-anchor-test.mjs`, which builds the program,
boots an isolated local validator, deploys the program, runs the lifecycle test,
and tears down automatically.

## Notes

- `claim_for` is keeper-friendly but always pays directly to the bettor ATA.
- `place_bet_for` enables direct wallet-to-address deposit ingestion flows.
- `Position` enforces one side per market per bettor.
- Betting is closed by slot (`close_slot`) on-chain.
