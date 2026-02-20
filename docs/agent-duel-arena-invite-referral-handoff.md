# Agent Duel Arena Handoff: Invite / Referral + Points

## Scope

This handoff is for the **agent duel arena flow** that runs under:

```bash
bun run duel
```

It covers invite/referral, fee-share accounting, points, GOLD multipliers, and the betting UI integration points.

Primary backend path:

- `packages/server/src/arena/ArenaService.ts`
- `packages/server/src/startup/routes/arena-routes.ts`

Primary frontend path (betting interface):

- `packages/gold-betting-demo/app/src/components/ReferralPanel.tsx`
- `packages/gold-betting-demo/app/src/components/PointsDisplay.tsx`
- `packages/gold-betting-demo/app/src/components/PointsLeaderboard.tsx`
- `packages/gold-betting-demo/app/src/components/EvmBettingPanel.tsx`
- `packages/gold-betting-demo/app/src/App.tsx`

## Runtime Context (`bun run duel`)

`bun run duel` starts the full agent duel stack and enables arena betting APIs/UI:

1. Game server + client
2. Duel bots
3. RTMP bridge + HLS
4. Betting app (`packages/gold-betting-demo/app`)
5. Keeper bot

Key script:

- `scripts/duel-stack.mjs`

The betting app calls `/api/arena/*` endpoints on the game server.

## Invite / Referral System

### Invite code ownership

- One invite code per inviter wallet (deterministic `DUEL...` code).
- Generated/managed in `arena_invite_codes`.
- `inviterWallet` is unique.

### Invite redemption

- Endpoint: `POST /api/arena/invite/redeem`
- Flow:
1. Normalize wallet + code
2. Reject if code does not exist
3. Reject self-referral
4. Enforce one invite tree per invited wallet (including linked-wallet network)
5. Persist in `arena_invited_wallets`

### Cross-chain wallet linking

- Endpoint: `POST /api/arena/wallet-link`
- Supports only EVM↔Solana pairings.
- Uses `arena_wallet_links` with canonical pair key (`EVM:<wallet>|SOLANA:<wallet>` ordering).
- If one side already has referral mapping, mapping is propagated to the linked side.
- Link initiator can receive one-time `+100` points (`wallet-link:*` synthetic bet id).

## Fee Share Accounting

Implemented in `recordFeeShare(...)` in `ArenaService`.

Formula per bet:

- `totalFee = wagerGold * feeBps / 10_000`
- If referred:
  - `inviterFee = totalFee * 10%`
  - `treasuryFee = totalFee * 90%`
- If not referred:
  - `inviterFee = 0`
  - `treasuryFee = totalFee`

Constants:

- `REFERRAL_FEE_SHARE_BPS = 1000` (10% of fee)
- `GOLD_DECIMALS = 6`

Storage table:

- `arena_fee_shares`

Important:

- `betId` is unique (`uidx_arena_fee_shares_bet`) to enforce idempotency.
- External bets (`/api/arena/bet/record-external`) currently use fixed accounting fee `EXTERNAL_TRACKING_FEE_BPS = 100` (1.0%).

## Points System

### Base points per bet

Implemented in `awardPoints(...)`:

- Uses verified GOLD amount only (on-chain verification checks).
- `basePoints = max(1, round(verifiedGoldAmount * 0.001))`

### GOLD multiplier tiers (wallet liquid + staked combined)

Implemented in `computeGoldMultiplier(...)`:

- `< 1,000 GOLD` -> `0x`
- `1,000 - 99,999 GOLD` -> `1x`
- `100,000 - 999,999 GOLD` -> `2x`
- `1,000,000+ GOLD` -> `3x`
- Additional bonus: if `>= 100,000 GOLD` and held `>= 10` days -> `+1x`

So practical top multiplier is `4x` at `1M+` with `10+` hold days.

Constants:

- `GOLD_TIER_0 = 1_000`
- `GOLD_TIER_1 = 100_000`
- `GOLD_TIER_2 = 1_000_000`
- `GOLD_HOLD_DAYS_BONUS = 10`

### Referral points behavior

Implemented behavior:

- Referrer receives **fixed 1x points** from the invited user’s verified bet points.
- Referral row always writes:
  - `basePoints = invited user basePoints`
  - `multiplier = 1`
  - `totalPoints = basePoints`
- Holder multiplier tiers (`100k`, `1m`, `10+ day bonus`) apply to the bettor’s own points only, not the referrer’s referral credit.
- Fee-share remains unchanged: referrer gets 10% of fee, treasury gets 90%.

### Staking points accrual

Implemented in `accrueStakingPointsIfDue(...)`:

- Daily accrual based on snapshot windows.
- Formula:
  - `dailyBasePoints = round(stakedGoldBalance * 0.001)`
  - `basePoints = dailyBasePoints * elapsedDays`
  - `totalPoints = basePoints * snapshotMultiplier`
- Snapshot anchored each day with `(wallet, periodStartAt, periodEndAt)` unique constraint.

Table:

- `arena_staking_points`

## Betting Interface Integration

### Invite + referral widgets

- `ReferralPanel.tsx`
  - GET `/api/arena/points/:wallet`
  - GET `/api/arena/invite/:wallet?platform=...`
  - POST `/api/arena/invite/redeem`
  - POST `/api/arena/wallet-link`

### Points widgets

- `PointsDisplay.tsx`: shows total points + multiplier badge and tier explainer.
- `PointsLeaderboard.tsx`: polls `/api/arena/points/leaderboard`.

### Bet tracking writes

- Solana flow (`App.tsx`) and EVM flow (`EvmBettingPanel.tsx`) post to:
  - `POST /api/arena/bet/record-external`
- Solana external tracking sends `marketPda` so server-side points verification can validate market-bet vault transfers even when `roundSeedHex` is not present.
- Referral mapping is resolved server-side from existing wallet mapping or explicit invite code if provided.

## API Surface (Arena points/referral)

- `GET /api/arena/invite/:wallet`
- `POST /api/arena/invite/redeem`
- `POST /api/arena/wallet-link`
- `GET /api/arena/points/:wallet`
- `GET /api/arena/points/leaderboard`
- `GET /api/arena/points/multiplier/:wallet`
- `POST /api/arena/bet/record`
- `POST /api/arena/bet/record-external`

## Persistence Tables

- `arena_invite_codes`
- `arena_invited_wallets`
- `arena_wallet_links`
- `arena_fee_shares`
- `arena_points`
- `arena_referral_points`
- `arena_staking_points`

Migrations that introduced/refined this area:

- `0043_add_arena_invite_and_fee_share_tracking.sql`
- `0044_add_arena_staking_points.sql`
- `0045_add_arena_chain_fees_and_wallet_links.sql`
- `0047_add_arena_staking_points_wallet_period_unique.sql`
- `0048_restore_arena_multiplier_floor_at_1k.sql`
- `0049_make_arena_fee_share_bet_unique.sql`

## Quick Validation Checklist

1. Start stack:
   - `bun run duel`
2. Verify betting app + server:
   - `http://localhost:4179`
   - `http://localhost:5555/api/arena/current`
3. Verify invite summary:
   - `GET /api/arena/invite/:wallet?platform=evm|solana|all`
4. Verify points + multiplier:
   - `GET /api/arena/points/:wallet`
   - `GET /api/arena/points/multiplier/:wallet`
5. Verify referral fee split rows in DB:
   - `arena_fee_shares.inviterFeeGold` = 10% of fee for referred bets
6. Verify referral points are fixed 1x:
   - `arena_referral_points.multiplier = 1`
   - `arena_referral_points.totalPoints = arena_referral_points.basePoints`
7. Run unit tests for this subsystem:
   - `bun run --cwd packages/server test tests/unit/arena/ArenaService.referrals.test.ts`
