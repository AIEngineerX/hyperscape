# Gameplay Test Environment (Web2 + Web3)

Run the full validation matrix:

```bash
bun run test:gameplay:matrix
```

This command uses real systems (terrain, world simulation, contracts, Anvil) and executes:

1. Web2 server gameplay tests:
   - `packages/server/tests/integration/building-navigation.integration.test.ts`
   - `packages/server/tests/integration/trade/trade.integration.test.ts`
   - `packages/server/tests/integration/inventory-move.integration.test.ts`
   - `packages/server/tests/unit/systems/ServerNetwork/InteractionSessionManager.combat.test.ts`
2. Headed client login flow (web2):
   - `packages/client/tests/e2e/full-flow.spec.ts` (strict login->character->enter-world test)
3. Web3 chain validation:
   - Auto-start/reuse Anvil
   - Auto-deploy contracts
   - Auto-seed items + shops
   - On-chain smoke checks (`packages/web3/src/testing/onchain-smoke.ts`)
   - On-chain E2E + anti-cheat checks (`packages/web3/src/testing/onchain-e2e.ts`)
4. Headed client login flow (web3 mode):
   - `packages/client/tests/e2e/full-flow.spec.ts` with `MODE=web3`

## Scenario Coverage Map

- Player on terrain walking into a house:
  - `building-navigation.integration.test.ts`
- Two players trading:
  - `trade.integration.test.ts`
  - `onchain-e2e.ts` (on-chain escrow + accept flow)
- Two players dueling to the death:
  - `onchain-e2e.ts` (`recordDeath`, `recordPlayerKill`, `recordDuel`)
- Picking up item and equipping:
  - `onchain-e2e.ts` (`commitCombatResult` loot + `setEquipmentSlotBatch`)
  - `inventory-move.integration.test.ts`
- Killing mob and looting:
  - `onchain-e2e.ts` (`commitCombatResult` + stat checks)
- Anti-cheat / hacking resistance:
  - `onchain-e2e.ts` unauthorized write reverts for trade/combat/death/duel/inventory
- Web2 + Web3 runtime login/character/world entry:
  - `full-flow.spec.ts` in both modes

## Useful Environment Flags

- `RUN_WEB2=false` to skip web2 suite
- `RUN_WEB3=false` to skip web3 suite
- `RUN_CLIENT_WEB2=false` to skip web2 headed client flow
- `RUN_CLIENT_WEB3=false` to skip web3 headed client flow
- `CLIENT_PROJECT=chromium` (default) or another Playwright project
- `CLIENT_FLOW_GREP="..."` to choose a specific full-flow test
- `FORCE_REDEPLOY=true` (default) to force fresh local contract deployment

Example:

```bash
RUN_CLIENT_WEB3=false bun run test:gameplay:matrix
```
