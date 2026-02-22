# Super Audit Report: Agent-Dueling-Betting-Streaming System

**Date**: 2026-02-21
**Scope**: All code related to agent dueling, betting, streaming, and supporting infrastructure
**Passes**: 3 (initial audit + gap-fill + unaudited areas)
**Files Analyzed**: ~160+ files, ~45,000+ lines of code
**Overall Score**: **4.3 / 10**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Category Scores](#category-scores)
3. [Critical Blockers](#critical-blockers)
4. [Top 5 Priorities](#top-5-priorities)
5. [Detailed Findings by Component](#detailed-findings-by-component)
   - [ArenaService (Server)](#arenaservice-server)
   - [Arena Routes](#arena-routes)
   - [SolanaArenaOperator](#solanaarenaoperator)
   - [DuelMarketMaker](#duelmarketmaker)
   - [DuelCombatAI](#duelcombatai)
   - [DuelSystem](#duelsystem)
   - [DuelSessionManager](#duelsessionmanager)
   - [PendingDuelManager](#pendingduelmanager)
   - [DuelCombatResolver](#duelcombatresolver)
   - [ArenaPoolManager](#arenapoolmanager)
   - [Duel Network Handlers](#duel-network-handlers)
   - [Duel Settlement](#duel-settlement)
   - [Duel Events](#duel-events)
   - [StreamingDuelScheduler](#streamingduelscheduler)
   - [DuelBettingBridge](#duelbettingbridge)
   - [RTMP Bridge (Streaming)](#rtmp-bridge-streaming)
   - [Browser Capture](#browser-capture)
   - [AgentManager (Eliza)](#agentmanager-eliza)
   - [ModelAgentSpawner](#modelagentspawner)
   - [ElizaDuelBot](#elizaduelbot)
   - [ElizaDuelMatchmaker](#elizaduelmatchmaker)
   - [EmbeddedHyperscapeService](#embeddedhyperscapeservice)
   - [Plugin-Hyperscape](#plugin-hyperscape)
   - [Shared Types & Manifests](#shared-types--manifests)
   - [Client UI](#client-ui)
   - [Database Migrations](#database-migrations)
   - [Server Startup & Shutdown](#server-startup--shutdown)
   - [Dev Scripts](#dev-scripts)
   - [Test Coverage](#test-coverage)
6. [Pass 3: Previously Unaudited Areas](#pass-3-previously-unaudited-areas)
   - [Gold-Betting-Demo Package](#gold-betting-demo-package)
   - [Web3 Package](#web3-package)
   - [Smart Contracts](#smart-contracts)
   - [Infrastructure & Middleware](#infrastructure--middleware)
7. [Remediation Roadmap](#remediation-roadmap)

---

## Executive Summary

The agent-dueling-betting-streaming system spans ~45,000+ lines across 160+ files covering: DuelSystem state machine, StreamingDuelScheduler, ArenaService (Solana prediction market betting), SolanaArenaOperator, DuelMarketMaker, DuelCombatAI, RTMP streaming infrastructure, ElizaOS AI agent integration, gold-betting-demo keeper bot & UI, web3 on-chain writer, Solidity smart contracts, and full client UI.

**Strengths**: The duel settlement system (`duel-settlement.ts`) demonstrates excellent crash-safe design with dual idempotency guards, PostgreSQL transactions with `SELECT FOR UPDATE`, and quantity clamping. The DuelSystem state machine uses exhaustive `assertNever` checks. Rate limiting infrastructure is well-designed with operation-specific limits.

**Weaknesses**: The system has critical security gaps in the betting financial stack (no auth on endpoints, non-atomic pool updates, no bet idempotency), a functional bug preventing agents from receiving duel challenges (`duelChallengeIncoming` field mismatch), zero tests for the entire financial stack, and multiple god classes exceeding 4,000 lines.

---

## Category Scores

| # | Category | Score | Notes |
|---|----------|-------|-------|
| 1 | Production Quality Code | 4/10 | God classes, dead code, `any` types |
| 2 | Best Practices (DRY/KISS/YAGNI) | 4/10 | Heavy duplication (amounts.ts x3), types not shared |
| 3 | Testing Coverage | 2/10 | DuelSystem excellent; financial stack has ZERO tests |
| 4 | OWASP Security | 3/10 | No auth on betting, plaintext secrets in logs, injection vectors |
| 5 | CWE Top 25 | 4/10 | Input validation gaps, credential management weak |
| 6 | SOLID Principles | 4/10 | ArenaService, AgentManager, StreamingDuelScheduler violate SRP |
| 7 | GRASP Principles | 5/10 | Reasonable domain ownership, coupling could improve |
| 8 | Clean Code | 4/10 | Functions too large, side effects mixed with queries |
| 9 | Law of Demeter | 5/10 | Some deep property chains but generally decent |
| 10 | Memory & Allocation | 6/10 | Pre-allocated pools in combat, some leaks in streaming |
| 11 | TypeScript Rigor | 4/10 | 15+ `any` violations, `as` casts without runtime guards |
| 12 | Rendering & GPU | N/A | Not applicable to server-side audit |
| 13 | UI Framework Integration | 5/10 | Optimistic updates without rollback, dead components |
| 14 | Game Programming Patterns | 6/10 | Good state machine, good object pooling in arenas |
| 15 | Server Authority | 7/10 | Strong server-side validation, some TOCTOU gaps |
| 16 | Client Responsiveness | 4/10 | Optimistic bets without rollback, no disconnect handling |
| 17 | Anti-Cheat | 5/10 | Server validates most actions, but stakes not locked |
| 18 | Economic Integrity | 3/10 | Non-atomic pool updates, no idempotency on bets |
| 19 | Persistence & Database | 5/10 | Good settlement transactions, missing indexes |
| 20 | Distributed Systems | 4/10 | No horizontal scaling strategy, single-point failures |
| 21 | Smart Contract Security | 6/10 | No critical vulns, some missing overflow checks |
| **Overall** | | **4.3/10** | |

---

## Critical Blockers

These **must** be fixed before any production deployment:

1. **No authentication on betting endpoints** — `/api/arena/bet/record`, `/api/arena/bet/record-external`, whitelist PUT/DELETE are fully public
2. **Non-atomic pool updates** — Bet inserted to DB, then in-memory pool updated separately; race condition window for concurrent bets
3. **No bet idempotency** — `recordBet()` generates new random ID every call with no dedup on `txSignature`
4. **`duelChallengeIncoming` field name mismatch** — Plugin expects `challengerId` but server sends `fromPlayerId`; agents can NEVER receive incoming challenges
5. **Zero tests for financial stack** — ArenaService, SolanaArenaOperator, DuelBettingBridge, amounts.ts have NO tests
6. **3 systems never destroyed on shutdown** — StreamingDuelScheduler, ArenaService, DuelMarketMaker leak timers/listeners
7. **Secret propagation** — Dev scripts pass ALL env vars (including Solana/EVM private keys) to every child process
8. **Failed on-chain resolution has no retry** — DuelBettingBridge moves market to history on failure; funds locked permanently
9. **Deterministic fight simulation** — Keeper bot's `fight.ts` uses seed-only PRNG; if seed is revealed early, outcome is predictable
10. **RPC proxy has no method whitelist** — Keeper service proxies arbitrary Solana RPC calls including `sendTransaction`

---

## Top 5 Priorities

1. **Secure the betting endpoints** — Add Privy auth, wallet ownership verification, rate limiting, and bet idempotency
2. **Fix the financial atomicity** — Wrap pool updates + bet insertion in single transaction; add `txSignature` dedup
3. **Fix the agent challenge bug** — Align field names between plugin-hyperscape and server (`fromPlayerId` vs `challengerId`)
4. **Add financial stack tests** — ArenaService, SolanaArenaOperator, amounts.ts, DuelBettingBridge need comprehensive test suites
5. **Add graceful shutdown** — Call `destroy()` on StreamingDuelScheduler, ArenaService, DuelMarketMaker; implement retry for failed on-chain resolution

---

## Detailed Findings by Component

### ArenaService (Server)

**File**: `packages/server/src/arena/ArenaService.ts` (5,018 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | Non-atomic pool updates — bet inserted to DB, then in-memory pool updated, then persisted separately. Race condition window for concurrent bets. (lines ~752-772) |
| CRITICAL | No idempotency on `recordBet()` — generates new random ID every call, no dedup on `txSignature` |
| HIGH | No max bet size validation |
| HIGH | No rate limiting on bet operations |
| HIGH | `void` fire-and-forget on financial operations |
| HIGH | God class — 5,018 lines handling 10+ responsibilities: round lifecycle, betting, Solana ops, payouts, points, referrals, wallet linking, staking, gold balance fetching |
| MEDIUM | Pool update code: `this.currentRound.market.poolA = addDecimalAmounts(...)` without transaction |
| MEDIUM | `swapQuote` typed as `Record<string, unknown>` — opaque blob |

**Score**: 2/10
**Priority**: Critical

---

### Arena Routes

**File**: `packages/server/src/startup/routes/arena-routes.ts` (~700 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | No authentication on `/api/arena/bet/record`, whitelist PUT/DELETE, payout job management |
| HIGH | Timing-vulnerable API key comparison (`!==` instead of `timingSafeEqual`) |
| HIGH | Auth bypass in non-production when write key not configured |
| HIGH | No rate limiting on any endpoint despite infrastructure existing |
| MEDIUM | No Fastify JSON Schema validation on any route |
| MEDIUM | Unbounded `limit` on listing endpoints |

**Score**: 2/10
**Priority**: Critical

---

### SolanaArenaOperator

**File**: `packages/server/src/arena/SolanaArenaOperator.ts` (924 lines)

| Severity | Finding |
|----------|---------|
| HIGH | `reportAndResolve` sends two separate transactions; first can succeed while second fails, leaving funds locked |
| MEDIUM | Duplicate `formatBaseUnitsToDecimal` implementation (should import from `amounts.ts`) |
| LOW | Zero tests |

**Score**: 3/10
**Priority**: High

---

### DuelMarketMaker

**File**: `packages/server/src/arena/DuelMarketMaker.ts` (500 lines)

| Severity | Finding |
|----------|---------|
| HIGH | `toGoldBaseUnits` uses floating-point intermediate instead of `parseDecimalToBaseUnits` |
| MEDIUM | `seedLiquidityIfEmpty` places both side bets via `Promise.all` for same wallet — potential PDA conflict |
| MEDIUM | Event payload casts from `unknown` with no runtime guards |

**Score**: 4/10
**Priority**: High

---

### DuelCombatAI

**File**: `packages/server/src/arena/DuelCombatAI.ts` (681 lines)

| Severity | Finding |
|----------|---------|
| HIGH | LLM prompt injection vector via `agentName` interpolation |
| MEDIUM | Timeout promise timer leak (setTimeout never cleared after Promise.race resolves) |

**Score**: 5/10
**Priority**: Medium

---

### DuelSystem

**File**: `packages/server/src/systems/DuelSystem/index.ts` (2,056 lines)

| Severity | Finding |
|----------|---------|
| HIGH | `addStake` doesn't verify player owns the item in inventory until resolution time |
| MEDIUM | Items not locked in inventory during duel setup |
| POSITIVE | Strong server authority — all state mutations server-side, item values looked up server-side |
| POSITIVE | Exhaustive state machine with `assertNever` |

**Score**: 7/10
**Priority**: Medium

---

### DuelSessionManager

**File**: `packages/server/src/systems/DuelSystem/DuelSessionManager.ts` (288 lines)

| Severity | Finding |
|----------|---------|
| LOW | No pre-existing session guard on `createSession` (mitigated by parent checks) |
| POSITIVE | Session-to-player mapping consistency is sound |

**Score**: 8/10
**Priority**: Low

---

### PendingDuelManager

**File**: `packages/server/src/systems/DuelSystem/PendingDuelManager.ts` (359 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | `processTick` mutates Map during `for...of` iteration (safe per spec but fragile) |
| POSITIVE | Expired challenge acceptance properly guarded |

**Score**: 7/10
**Priority**: Low

---

### DuelCombatResolver

**File**: `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts` (512 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Stake transfer not atomic — TOCTOU window between memory verification and event-driven settlement |
| MEDIUM | No idempotency guard in `resolveDuel` itself (relies on caller guards) |
| MEDIUM | `Number.MAX_SAFE_INTEGER` used for stamina instead of actual max |
| POSITIVE | Excellent error isolation — each step individually try/caught |

**Score**: 6/10
**Priority**: Medium

---

### ArenaPoolManager

**File**: `packages/server/src/systems/DuelSystem/ArenaPoolManager.ts` (267 lines)

| Severity | Finding |
|----------|---------|
| LOW | Redundant `inUse`/`currentDuelId` state between `Arena` and `ArenaState` |
| LOW | `releaseArena` doesn't verify duelId ownership |
| POSITIVE | Fixed-size pool, no double-allocation risk |

**Score**: 7/10
**Priority**: Low

---

### Duel Network Handlers

**Files**: `packages/server/src/systems/ServerNetwork/handlers/duel/` (challenge.ts, rules.ts, stakes.ts, confirmation.ts, combat.ts)

| Severity | Finding |
|----------|---------|
| MEDIUM | No runtime type validation on `duelId` fields — TypeScript `as` casts only |
| MEDIUM | Stakes handler doesn't verify duel is still in STAKES state |
| LOW | Self-challenge not prevented at handler level |
| LOW | TOCTOU in deferred callback — challenger state not re-validated |
| POSITIVE | Player ID from `socket.player.id` (server-set, not client-spoofable) |
| POSITIVE | Rate limiting via shared `IntervalRateLimiter` (50ms interval) |

**Score**: 6/10
**Priority**: Medium

---

### Duel Settlement

**File**: `packages/server/src/systems/ServerNetwork/duel-settlement.ts` (575 lines)

| Severity | Finding |
|----------|---------|
| LOW | Partial settlement on item validation failure (continues, then commits) |
| MEDIUM | No support ticket generation on settlement failure |
| POSITIVE | Dual idempotency (in-memory Set + DB table) |
| POSITIVE | PostgreSQL transaction with `SELECT FOR UPDATE` |
| POSITIVE | Quantity clamping and integer overflow protection |
| POSITIVE | Crash-safe design — items remain with owner until atomic transfer |
| POSITIVE | Deadlock handling with exponential backoff |

**Score**: 9/10
**Priority**: Low

---

### Duel Events

**File**: `packages/server/src/systems/ServerNetwork/duel-events.ts`

| Severity | Finding |
|----------|---------|
| LOW | In-memory idempotency guard auto-cleanup at 60s (covered by DB guard) |

**Score**: 8/10
**Priority**: Low

---

### StreamingDuelScheduler

**File**: `packages/server/src/systems/StreamingDuelScheduler/index.ts` (4,668 lines)

| Severity | Finding |
|----------|---------|
| HIGH | 4,668-line god class with ~60 methods |
| HIGH | Race condition between tick-driven and event-driven phase transitions (`void this.startCountdown()` fire-and-forget async) |
| HIGH | Two independent state trackers (`schedulerState` + `currentCycle.phase`) with no formal coupling |
| MEDIUM | `any` types in `types.ts` (6 occurrences, lines 26-27) |
| MEDIUM | Dead exports: `DUEL_FOOD_ITEM`, `DUEL_FOOD_HEAL_AMOUNT` |

**Score**: 3/10
**Priority**: High

---

### DuelBettingBridge

**File**: `packages/server/src/systems/DuelScheduler/DuelBettingBridge.ts` (484 lines)

| Severity | Finding |
|----------|---------|
| HIGH | On-chain resolution failure has no retry — market moved to history, funds locked permanently |
| MEDIUM | Market lookup by agent IDs instead of duelId |
| LOW | Zero tests |

**Score**: 3/10
**Priority**: Critical

---

### RTMP Bridge (Streaming)

**File**: `packages/server/src/streaming/rtmp-bridge.ts` (1,594 lines)

| Severity | Finding |
|----------|---------|
| HIGH | RTMP stream keys logged in plaintext via FFmpeg args |
| MEDIUM | `exec()` shell injection pattern for port conflict resolution |
| MEDIUM | No WebSocket authentication on producer/spectator connections |
| MEDIUM | No spectator connection limit |
| POSITIVE | Backpressure handling, crash recovery with exponential backoff |

**Score**: 4/10
**Priority**: High

---

### Browser Capture

**Files**: `packages/server/src/streaming/browser-capture.ts` (377 lines), `browser-capture-webcodecs.ts` (301 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | Script injection — `bridgeUrl` interpolated without `JSON.stringify()` in CDP version |
| MEDIUM | Missing backpressure check on WebSocket send in WebCodecs encoder output callback |

**Score**: 5/10
**Priority**: Medium

---

### AgentManager (Eliza)

**File**: `packages/server/src/eliza/AgentManager.ts` (2,493 lines)

| Severity | Finding |
|----------|---------|
| HIGH | SRP violation — 14+ responsibilities in one class |
| HIGH | Dead code — unused imports (lines 15-135), TODO comment (line 604) |
| HIGH | First tick race condition — `setTimeout` doesn't check `tickInProgress` |
| MEDIUM | No production agent count limit (`Number.MAX_SAFE_INTEGER`) |
| MEDIUM | No timeout on behavior tick operations |

**Score**: 3/10
**Priority**: High

---

### ModelAgentSpawner

**File**: `packages/server/src/eliza/ModelAgentSpawner.ts` (1,399 lines)

| Severity | Finding |
|----------|---------|
| HIGH | `process.env` mutation during agent spawning — race condition |
| HIGH | Module-level mutable maps with no bulk cleanup guarantee |
| HIGH | `@ts-ignore` suppression |
| MEDIUM | No LLM rate limiting or cost tracking |

**Score**: 3/10
**Priority**: High

---

### ElizaDuelBot

**File**: `packages/server/src/eliza/ElizaDuelBot.ts` (410 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | 5 `any` types (violates project's no-any rule) |

**Score**: 4/10
**Priority**: Medium

---

### ElizaDuelMatchmaker

**File**: `packages/server/src/eliza/ElizaDuelMatchmaker.ts` (488 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | 4 `any` types (violates project's no-any rule) |

**Score**: 4/10
**Priority**: Medium

---

### EmbeddedHyperscapeService

**File**: `packages/server/src/eliza/EmbeddedHyperscapeService.ts` (2,026 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | O(N*M) entity scan every 2 ticks |
| MEDIUM | `nearbyBuffer` reuse leaks references |

**Score**: 5/10
**Priority**: Medium

---

### Plugin-Hyperscape

**File**: `packages/plugin-hyperscape/src/services/HyperscapeService.ts`

| Severity | Finding |
|----------|---------|
| CRITICAL | `duelChallengeIncoming` field name mismatch — plugin expects `challengerId` but server sends `fromPlayerId`. **Agents can NEVER receive incoming challenges.** |
| MEDIUM | `duelBot` flag sent client-side, server may trust it |
| HIGH | 11+ `as any` usages |

**Files**: `packages/plugin-hyperscape/src/routes/message.ts`, `settings.ts`, `logs.ts`

| Severity | Finding |
|----------|---------|
| MEDIUM-HIGH | All HTTP routes marked `public: true` — message injection, log exposure |

**File**: `packages/plugin-hyperscape/src/actions/duel.ts`

| Severity | Finding |
|----------|---------|
| MEDIUM | No Duel Arena zone check in `validate()` |

**Score**: 2/10
**Priority**: Critical

---

### Shared Types & Manifests

**File**: `packages/shared/src/types/game/duel-types.ts`

| Severity | Finding |
|----------|---------|
| MEDIUM | `DuelErrorMessage.errorCode` is `string`, should be `DuelErrorCode` |
| HIGH | Arena coordinates divergent across 3 sources (duel-arenas.json, duel-manifest.ts, DuelSystem/config.ts) |
| POSITIVE | Well-architected shared types with branded identifiers |

**File**: `packages/shared/src/data/duel-manifest.ts`

| Severity | Finding |
|----------|---------|
| POSITIVE | Centralized rule/equipment definitions with labels, descriptions, incompatibility metadata |

**Score**: 6/10
**Priority**: Medium

---

### Client UI

**File**: `packages/client/src/game/panels/BettingPanel/useBettingPanel.ts`

| Severity | Finding |
|----------|---------|
| CRITICAL | Optimistic bet placement without rollback mechanism |
| HIGH | No WebSocket disconnect handling — stale data displayed silently |
| MEDIUM | Potential payout calculated client-side, may drift from server |

**File**: `packages/client/src/screens/StreamingMode.tsx` (880 lines)

| Severity | Finding |
|----------|---------|
| HIGH | 340-line monolithic useEffect for canvas capture |
| HIGH | Dead `StreamingCameraController.ts` (stub with only `console.log`) |
| MEDIUM | `any` types in `AgentInfo` interface |

**File**: `packages/client/src/game/panels/DuelPanel/` (15 files)

| Severity | Finding |
|----------|---------|
| MEDIUM | `StakedItem` interface duplicated in 4 files |
| MEDIUM | Fixed pixel widths don't support mobile/Capacitor |
| POSITIVE | Server-authoritative state flow, anti-scam banners, two-click forfeit |

**File**: `packages/client/src/game/interface/InterfaceModals.tsx`

| Severity | Finding |
|----------|---------|
| MEDIUM | Uses different event name strings than canonical `DuelEvents` constants — shared constants are dead code |

**Score**: 4/10
**Priority**: High

---

### Database Migrations

**Files**: Migrations 0039 through 0049 (arena/betting tables)

| Severity | Finding |
|----------|---------|
| MEDIUM | No DOWN migration / no reversibility |
| MEDIUM | Multiplier default changed from 1 to 0 (silent behavior change) |
| MEDIUM | Missing composite indexes for common query patterns |

**Score**: 5/10
**Priority**: Medium

---

### Server Startup & Shutdown

**File**: `packages/server/src/startup/main.ts`

| Severity | Finding |
|----------|---------|
| HIGH | No try/catch around `initializeAgents()`, `initStreamCapture()`, `DuelMarketMaker.init()` |
| POSITIVE | Correct initialization order (dependencies before dependents) |

**File**: `packages/server/src/startup/shutdown.ts`

| Severity | Finding |
|----------|---------|
| HIGH | StreamingDuelScheduler, ArenaService, DuelMarketMaker never destroyed on shutdown |

**Score**: 4/10
**Priority**: High

---

### Dev Scripts

**Files**: `scripts/duel-stack.mjs`, `scripts/dev-duel.mjs`

| Severity | Finding |
|----------|---------|
| HIGH | All env vars (including Solana/EVM private keys) propagated to every child process |
| LOW | `.duel-rtmp-status.json` not in `.gitignore` |

**Score**: 3/10
**Priority**: High

---

### Test Coverage

**Files**: 14 test files examined

| Area | Coverage | Quality |
|------|----------|---------|
| DuelSystem state machine | 1,822 lines | EXCELLENT |
| DuelCombatResolver | Good | EXCELLENT error resilience tests |
| StreamingDuelScheduler | Regression | GOOD |
| ArenaService | **ZERO tests** | N/A |
| SolanaArenaOperator | **ZERO tests** | N/A |
| DuelBettingBridge | **ZERO tests** | N/A |
| amounts.ts | **ZERO tests** | N/A |
| ArenaPointsSystem | Has tests | Re-implements logic locally instead of testing actual code |

**Additional Issues**:
- Pervasive mock usage despite project's "NO MOCKS" rule
- Financial stack (the highest-risk code) has zero test coverage

**Score**: 2/10
**Priority**: Critical

---

## Pass 3: Previously Unaudited Areas

### Gold-Betting-Demo Package

**Total**: ~6,819 lines across 10 critical files

#### Keeper Bot

**File**: `packages/gold-betting-demo/keeper/src/bot.ts` (815 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | Missing seed/replayHash validation — falls back to `new BN(Date.now())` for seed and `Buffer.alloc(32)` (all zeros) for hash if missing from event. Attackers can predict oracle outcomes. |
| CRITICAL | 15-second hardcoded wait before posting result — creates arbitrage window where outcome is known but not posted |
| CRITICAL | Private key path handling falls through multiple env vars with no guidance |
| HIGH | Unsafe match ID conversion — string hash via `charCodeAt` loop has collision risk |
| HIGH | Market creation failure silently ignored, no retry mechanism |
| MEDIUM | Funding check state machine — bot appears healthy but silently stops processing when underfunded |
| MEDIUM | Race condition in market resolution — no check if resolution already in progress |

**File**: `packages/gold-betting-demo/keeper/src/service.ts` (1,577 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | Unauthenticated API endpoints — auth only checks header match with no per-wallet rate limiting |
| CRITICAL | Points inflation — `pointsAwarded = Math.round(Math.max(goldAmount, sourceAmount) * 10)` where `sourceAmount` is user input |
| CRITICAL | RPC proxy missing method whitelist — can proxy arbitrary Solana RPC calls including `sendTransaction` |
| HIGH | Write key stored as empty string fallback — if env var not set, auth bypassed |
| HIGH | Invite code derivation is deterministic from wallet address — anyone can compute codes for any wallet |
| HIGH | Identity merging without on-chain signature verification |
| HIGH | Referral points awarded based on user-supplied inviteCode without on-chain verification |
| MEDIUM | Leaderboard allows full enumeration via offset pagination |
| MEDIUM | EVM contract polling without timeout |

**File**: `packages/gold-betting-demo/keeper/src/fight.ts` (45 lines)

| Severity | Finding |
|----------|---------|
| CRITICAL | Fight outcome 100% deterministic from seed — `seededRandom(seed)` with XOR-shift PRNG. If seed is revealed early (e.g., on-chain transaction is public), outcome is predictable before resolution. |

**File**: `packages/gold-betting-demo/keeper/src/common.ts` (323 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Keypair file reading without permission check (should verify 0600) |
| HIGH | Accepts keypair as plaintext JSON array in env var — visible in process inspection |
| MEDIUM | Hardcoded fallback program IDs if IDL is missing |

**File**: `packages/gold-betting-demo/keeper/src/game-client.ts` (152 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Cycle ID to match ID conversion via `charCodeAt` hash has collision risk |
| MEDIUM | No validation of game server response structure |

**Score**: 2/10
**Priority**: Critical

#### App UI

**File**: `packages/gold-betting-demo/app/src/components/SolanaClobPanel.tsx` (1,042 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Unvalidated amount input — no check for extremely large amounts (1e308 overflow) |
| MEDIUM | Price input clamping doesn't check for NaN before clamp |
| MEDIUM | Incomplete null checks on ActiveMatch fields |

**File**: `packages/gold-betting-demo/app/src/components/EvmBettingPanel.tsx` (742 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Private key in environment variable (even for E2E) — could leak in build artifacts |
| HIGH | Unvalidated chain ID switch — user could send on wrong chain |
| MEDIUM | Missing allowance double-spend check |
| MEDIUM | XSS risk on status messages from API error responses |

**File**: `packages/gold-betting-demo/app/src/lib/config.ts` (469 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Private keys can be set via env vars — would be bundled in build if not careful |
| HIGH | Write key exported from client config (comment acknowledges it shouldn't be there) |
| MEDIUM | Hardcoded program IDs without IDL verification |

**File**: `packages/gold-betting-demo/app/src/lib/evmClient.ts` (417 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | ABI result cast without validation |
| MEDIUM | Magic numbers in status/side mapping not documented |

**File**: Environment files

| Severity | Finding |
|----------|---------|
| CRITICAL | `.env` file checked into git containing environment-specific config |
| HIGH | Missing documentation of all required secret env vars in `.env.example` |

**Score**: 2/10
**Priority**: Critical

---

### Web3 Package

**Total**: ~1,711 lines across 4 critical files

**File**: `packages/web3/src/chain-writer/ChainWriter.ts` (626 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Private key loaded from env vars — could be logged/exposed in process dumps |
| HIGH | Fallback RPC endpoints not validated for chain ID match — malicious RPC could return stale/wrong data |
| MEDIUM | Race condition in nonce assignment if multiple server instances use same operator account |
| MEDIUM | Unvalidated item ID mapping — missing items silently become ID 0 (data loss) |
| LOW | World address validated for code existence but not contract type |

**File**: `packages/web3/src/chain-writer/ChainWriterBridge.ts` (356 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Race condition — if duel completes before `player:registered` event, duel record skipped (asset loss) |
| HIGH | Agent exclusion not applied consistently — duel completion handler doesn't check `shouldMirrorPlayer()` |
| MEDIUM | Unsafe type assertion on all event payloads (no runtime validation) |
| MEDIUM | Equipment slot mapping hardcoded — new slots silently ignored |

**File**: `packages/web3/src/tx/BatchWriter.ts` (393 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Nonce query not atomic with `sendTransaction` calls — race if operator account used from multiple processes |
| HIGH | `Promise.all()` on receipts can mask individual failures |
| HIGH | Timeout marks transaction as dead-letter even if it succeeds on-chain later |
| MEDIUM | Exponential backoff has no cap (attempt 10 = 512s delay) |
| MEDIUM | Failed batch requeue doesn't track which calls were already persisted (duplicate risk) |
| LOW | No backpressure on queue depth — unbounded memory growth |

**File**: `packages/web3/src/tx/DatabaseTxPersistence.ts` (336 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | Lenient database type casting with `as` assertions |
| MEDIUM | `onConflictDoUpdate` assumes dedupeKey UNIQUE constraint without validation |
| LOW | No bounds on error message storage |

**Score**: 4/10
**Priority**: High

---

### Smart Contracts

**Total**: ~1,489 lines across 7 Solidity files

**File**: `packages/contracts/src/systems/DuelSystem.sol` (78 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | No validation that challenger != opponent (self-duel possible) |
| MEDIUM | Character IDs fetched at record time, not duel start — if character re-registered, stats go to wrong character |

**File**: `packages/contracts/src/systems/GoldSystem.sol` (181 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Silent failure on ERC-20 minting — low-level `call()` return value not checked |
| HIGH | If character not registered, ERC-20 mint skipped but in-game gold still updated (balance desync) |
| MEDIUM | `_transferERC20` burns from sender and mints to receiver instead of actual transfer — incompatible with external DEX trading |

**File**: `packages/contracts/src/systems/InventorySystem.sol` (178 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | `BalanceLib.decrease()` clamps to zero instead of reverting — optimistic writes can race and produce wrong counts |

**File**: `packages/contracts/src/systems/TradeSystem.sol` (431 lines)

| Severity | Finding |
|----------|---------|
| HIGH | Inventory full on trade cancel — items returned to ERC-1155 balance but not in inventory slots (invisible items). Bank fallback is TODO. |
| MEDIUM | Gold overflow not checked in trade completion — receiver could exceed MAX_GOLD |
| LOW | No trade timeout — offers stay open indefinitely |

**File**: `packages/contracts/src/systems/EquipmentSystem.sol` (130 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | No level requirement validation on-chain (relies entirely on server) |

**File**: `packages/contracts/src/systems/BankSystem.sol` (89 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | Slot boundary check compares to MAX_BANK_SLOTS (480 global) instead of per-tab limit — allows out-of-bounds slot assignment |

**File**: `packages/contracts/src/systems/PlayerRegistrySystem.sol` (177 lines)

| Severity | Finding |
|----------|---------|
| MEDIUM | No check for existing characterId — same character could be registered to different addresses |

**Score**: 6/10
**Priority**: Medium

---

### Infrastructure & Middleware

#### Rate Limiting

**File**: `packages/server/src/systems/ServerNetwork/services/SlidingWindowRateLimiter.ts` (515 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Excellent two-tier strategy: global (100/sec) + operation-specific (combat 3/sec, movement 15/sec, chat 2/sec) |
| POSITIVE | Automatic cleanup of stale entries every 60s |
| MEDIUM | Arena betting endpoints NOT covered by rate limiting despite infrastructure existing |

#### Authentication

**File**: `packages/server/src/infrastructure/auth/privy-auth.ts` (201 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Proper server-side Privy token verification |
| POSITIVE | Singleton pattern with lazy init |

**File**: `packages/server/src/startup/websocket.ts` (66 lines)

| Severity | Finding |
|----------|---------|
| HIGH | No authentication on WebSocket connection — accepts ANY connection immediately, auth deferred to handler |
| MEDIUM | No rate limiting on WebSocket connection attempts |
| MEDIUM | Query parameters (potentially containing auth tokens) exposed in logs |

#### CSRF & CORS

**File**: `packages/server/src/middleware/csrf.ts` (223 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Cryptographically secure tokens (32 bytes, `crypto.randomBytes`) |
| POSITIVE | Timing-safe comparison |
| LOW | Manual cookie string building instead of native methods |

**File**: `packages/server/src/startup/http-server.ts` (909 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Allowlist-based CORS with production domains hardcoded |
| POSITIVE | Cloudflare origin secret for proxied deployments |
| LOW | Regex DoS risk in origin pattern matching |

#### Audit Logging

**File**: `packages/server/src/systems/ServerNetwork/services/AuditLogger.ts` (226 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Structured JSON logging with `[AUDIT]` prefix |
| POSITIVE | Comprehensive duel logging with item values |
| MEDIUM | Not called in all critical paths — missing from settlement success, betting operations, challenge creation |

#### Health Checks

**File**: `packages/server/src/startup/routes/health-routes.ts` (107 lines)

| Severity | Finding |
|----------|---------|
| POSITIVE | Database health check returns 503 when unhealthy |
| MEDIUM | No alert thresholds — relies entirely on external monitoring |

#### Environment & Secrets

**File**: `packages/server/.env.example` (467 lines)

| Severity | Finding |
|----------|---------|
| HIGH | No startup validation of production secrets (length, complexity) |
| HIGH | No fail-fast if insecure flags (`DISABLE_RATE_LIMIT`, `LOAD_TEST_MODE`) enabled in production |
| MEDIUM | No rotation schedule documented for any secret |

**Infrastructure Score**: 6/10
**Priority**: High (for betting endpoint gaps)

---

## Integration Plans: 4.3/10 → 9/10

This section provides the complete integration plan for every audit category, organized into execution phases. Each category includes the current score, gap analysis, specific tasks with file references, and the architectural approach to reach 9/10.

### Target Score Table

| # | Category | Current | Target | Delta | Phase |
|---|----------|---------|--------|-------|-------|
| 1 | Production Quality Code | 4 | 9 | +5 | 2-3 |
| 2 | Best Practices (DRY/KISS/YAGNI) | 4 | 9 | +5 | 2-3 |
| 3 | Testing Coverage | 2 | 9 | +7 | 1-4 |
| 4 | OWASP Security | 3 | 9 | +6 | 1 |
| 5 | CWE Top 25 | 4 | 9 | +5 | 1-2 |
| 6 | SOLID Principles | 4 | 9 | +5 | 2-3 |
| 7 | GRASP Principles | 5 | 9 | +4 | 2-3 |
| 8 | Clean Code | 4 | 9 | +5 | 2-3 |
| 9 | Law of Demeter | 5 | 9 | +4 | 3 |
| 10 | Memory & Allocation | 6 | 9 | +3 | 2 |
| 11 | TypeScript Rigor | 4 | 9 | +5 | 2 |
| 12 | UI Framework Integration | 5 | 9 | +4 | 3 |
| 13 | Game Programming Patterns | 6 | 9 | +3 | 3 |
| 14 | Server Authority | 7 | 9 | +2 | 1-2 |
| 15 | Client Responsiveness | 4 | 9 | +5 | 3 |
| 16 | Anti-Cheat | 5 | 9 | +4 | 2 |
| 17 | Economic Integrity | 3 | 9 | +6 | 1 |
| 18 | Persistence & Database | 5 | 9 | +4 | 2 |
| 19 | Distributed Systems | 4 | 9 | +5 | 3-4 |
| 20 | Smart Contract Security | 6 | 9 | +3 | 2 |

---

### Phase 1: Security & Financial Integrity (Week 1-2)

*Fixes all CRITICAL and HIGH security issues. Directly lifts: OWASP 3→8, CWE 4→8, Economic Integrity 3→8, Server Authority 7→9.*

#### 1A. Authentication & Authorization Layer

**Goal**: Zero unauthenticated access to state-changing endpoints.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 1 | Create `ArenaAuthMiddleware` Fastify plugin | `packages/server/src/arena/middleware/arena-auth.ts` (new) | Extracts and verifies Privy JWT from `Authorization: Bearer` header. Returns `{ privyUserId, walletAddress, farcasterFid }`. Rejects with 401 if missing/invalid. Use existing `verifyPrivyToken()` from `privy-auth.ts`. |
| 2 | Create `requireWalletOwnership` guard | Same file | Compares `req.auth.walletAddress` against request body `bettorWallet`. Rejects with 403 on mismatch. Normalizes both to lowercase before comparison. |
| 3 | Apply auth to all arena bet endpoints | `packages/server/src/startup/routes/arena-routes.ts` | Add `preHandler: [arenaAuth, requireWalletOwnership]` to `POST /api/arena/bet/record`, `POST /api/arena/bet/quote`. Keep `x-arena-write-key` as alternative auth for external integrators (keeper bot) but switch to `timingSafeEqual` comparison. |
| 4 | Protect whitelist endpoints | Same file | Add `preHandler: [arenaAuth]` to `PUT/DELETE /api/arena/whitelist/:characterId`. Add admin role check — only server operator or designated admin wallets can modify whitelist. |
| 5 | Protect payout management endpoints | Same file | Add `preHandler: [arenaAuth, requireAdmin]` to payout job start/stop endpoints. |
| 6 | Fix timing-safe comparison for write key | Same file | Replace `providedWriteKey !== configuredWriteKey` with `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(configured))`. Handle length mismatch before comparison. |
| 7 | Add auth bypass fail-safe in production | `packages/server/src/startup/main.ts` | On startup, if `NODE_ENV=production` and `ARENA_EXTERNAL_BET_WRITE_KEY` is empty, throw fatal error and refuse to start. Same for missing `PRIVY_APP_SECRET`. |
| 8 | Secure plugin-hyperscape routes | `packages/plugin-hyperscape/src/routes/message.ts`, `settings.ts`, `logs.ts` | Remove `public: true` from all routes. Add API key authentication or JWT verification. At minimum, require the Eliza runtime auth token. |

**Integration approach**: The `ArenaAuthMiddleware` is a Fastify plugin registered once in `arena-routes.ts` setup. It decorates `request` with an `auth` object. Guards are composable preHandlers, not inline checks. This pattern matches the existing `privy-auth.ts` singleton and Fastify plugin conventions already used in `http-server.ts`.

#### 1B. Financial Atomicity & Idempotency

**Goal**: Every bet operation is ACID-compliant with zero race conditions.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 9 | Atomic bet recording transaction | `packages/server/src/arena/ArenaService.ts` | Wrap `recordBet` in a single PostgreSQL transaction: (1) `INSERT INTO bets` with `ON CONFLICT (tx_signature) DO NOTHING`, (2) `UPDATE arena_rounds SET pool_a = pool_a + $amount` using SQL arithmetic (not in-memory), (3) read-back updated pools, (4) update in-memory state from DB result. Use `SELECT FOR UPDATE` on the round row. |
| 10 | Add `txSignature` UNIQUE constraint | New migration `0050-bet-idempotency.ts` | `ALTER TABLE bets ADD CONSTRAINT bets_tx_signature_unique UNIQUE (tx_signature)`. This is the database-level dedup. |
| 11 | Add in-memory dedup cache | `packages/server/src/arena/ArenaService.ts` | Maintain `Set<string>` of recent `txSignature` values (last 60s, same pattern as `duel-events.ts`). Check before starting DB transaction. Return existing betId if duplicate. |
| 12 | Max bet size validation | Same file | Add `MAX_BET_AMOUNT` to arena config (e.g., 10,000 GOLD). Validate `goldAmount <= MAX_BET_AMOUNT` before recording. Return 400 with clear message if exceeded. |
| 13 | Remove `void` fire-and-forget on financial ops | Same file | Every `async` financial operation (`recordBet`, `processPayouts`, `resolveRound`) must be `await`ed. Replace all `void someAsyncOp()` patterns with `await someAsyncOp()` inside try/catch. If fire-and-forget is intentional (background job), wrap in `queueMicrotask(() => op().catch(err => auditLog.error(...)))`. |
| 14 | Atomic on-chain report+resolve | `packages/server/src/arena/SolanaArenaOperator.ts` | Combine `reportOutcome` and `resolveMarket` into a single Solana transaction using Anchor's `transaction.add(ix1).add(ix2)` pattern. Both instructions execute atomically — if either fails, both revert. |
| 15 | Retry queue for failed on-chain resolution | `packages/server/src/systems/DuelScheduler/DuelBettingBridge.ts` | Instead of moving market to history on failure: (1) Add to `pendingResolutions: Map<string, { attempts: number, lastAttempt: number }>`. (2) Retry with exponential backoff (1s, 5s, 30s, 5min) up to 10 attempts. (3) Only move to history after all retries exhausted. (4) Emit `arena:resolution:failed` event for monitoring. (5) Add `/api/arena/admin/retry-resolution/:marketId` endpoint for manual retry. |

**Integration approach**: The key change is moving pool arithmetic from JavaScript memory (`this.currentRound.market.poolA = addDecimalAmounts(...)`) to SQL (`SET pool_a = pool_a + $1`). This makes concurrent bets safe because PostgreSQL serializes row-level updates. The in-memory pool state is refreshed from the DB after each bet, not the other way around. This inverts the current flow but uses the same `ArenaService` methods — callers don't change.

#### 1C. Input Validation & Injection Prevention

**Goal**: Every trust boundary validates every field at runtime.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 16 | Fastify JSON Schema for all arena routes | `packages/server/src/startup/routes/arena-routes.ts` | Add Fastify `schema: { body: {...}, querystring: {...}, params: {...} }` to every route. Fastify validates automatically and returns 400 with specific field errors. Define schemas for: `BetRecordBody`, `BetQuoteBody`, `WhitelistBody`, `PayoutBody`. |
| 17 | Bound all listing endpoints | Same file | Add `schema: { querystring: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } } }` to all GET listing routes. |
| 18 | Runtime Zod schemas for WebSocket duel packets | `packages/server/src/systems/ServerNetwork/handlers/duel/schemas.ts` (new) | Define `DuelChallengeSchema`, `DuelStakeSchema`, `DuelRuleSchema`, `DuelConfirmSchema` as Zod schemas. Each handler calls `schema.safeParse(data)` before proceeding. On failure, send `duelError` with field-specific message. |
| 19 | Sanitize LLM prompt inputs | `packages/server/src/arena/DuelCombatAI.ts` | Escape `agentName` before interpolation into LLM prompts: strip control characters, limit to 32 alphanumeric chars + spaces + hyphens. Add `sanitizeAgentName(name: string): string` helper. |
| 20 | Fix `bridgeUrl` script injection | `packages/server/src/streaming/browser-capture.ts` | Replace string interpolation `\`...${bridgeUrl}...\`` with `JSON.stringify(bridgeUrl)` (matching the WebCodecs version which already does this correctly). |
| 21 | RPC proxy method whitelist | `packages/gold-betting-demo/keeper/src/service.ts` | Create `ALLOWED_RPC_METHODS = new Set(['getBalance', 'getTokenAccountBalance', 'getAccountInfo', 'getSlot', 'getBlockHeight', 'getLatestBlockhash', 'getTransaction', 'getSignatureStatuses'])`. Reject any request with method not in set. Block `sendTransaction`, `simulateTransaction`, `requestAirdrop`. |
| 22 | Validate duel handler state before mutations | `packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts`, `rules.ts` | Add `const session = duelSystem.getDuelSession(duelId); if (!session) return; if (session.state !== DuelSessionState.STAKES) { sendDuelError(socket, 'Duel not in stakes phase', 'INVALID_STATE'); return; }` before any mutation. Same pattern in rules.ts for RULES state. |
| 23 | Self-challenge prevention | `packages/server/src/systems/ServerNetwork/handlers/duel/challenge.ts` | Add early check: `if (socket.player.id === targetId) { sendDuelError(socket, 'Cannot challenge yourself', 'SELF_CHALLENGE'); return; }` |

**Integration approach**: Zod schemas live in a shared `schemas.ts` file per handler domain. Each handler imports and calls `schema.safeParse()` as the first line. This is a non-breaking addition — existing handler logic stays the same, just guarded by runtime validation. Fastify JSON Schema is registered inline per route definition, which is the standard Fastify pattern already used elsewhere in the server.

#### 1D. Secrets & Credential Management

**Goal**: Zero plaintext secrets in logs, env, or process inspection. Fail-fast on misconfiguration.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 24 | Production secrets startup validator | `packages/server/src/startup/config-validator.ts` (new) | On startup, validate: (a) `JWT_SECRET` ≥ 32 chars, (b) `ADMIN_CODE` ≥ 16 chars, (c) `ARENA_EXTERNAL_BET_WRITE_KEY` ≥ 32 chars if arena enabled, (d) `DISABLE_RATE_LIMIT !== "true"` in production, (e) `LOAD_TEST_MODE !== "true"` in production, (f) all Solana keypair env vars point to existing files with 0600 permissions. Call from `main.ts` before any service init. Exit with code 1 and specific error on failure. |
| 25 | Scope env var propagation in dev scripts | `scripts/duel-stack.mjs`, `scripts/dev-duel.mjs` | Replace `spawn(cmd, { env: process.env })` with explicit env allowlist per child: game server gets game-related vars, keeper gets keeper-related vars, streaming gets streaming-related vars. Never pass `SOLANA_*_SECRET`, `PRIVATE_KEY`, or `EVM_PRIVATE_KEY` to processes that don't need them. |
| 26 | Redact secrets from FFmpeg args | `packages/server/src/streaming/rtmp-bridge.ts` | Replace plaintext RTMP key logging with `rtmpUrl.replace(/\/[^/]+$/, '/***REDACTED***')`. Apply to all `console.log` and `console.error` calls that include FFmpeg command strings. |
| 27 | Remove `.env` from git in gold-betting-demo | `packages/gold-betting-demo/.gitignore` | Add `.env` and `.env.local` to `.gitignore`. Run `git rm --cached .env` to unstage. Add `.env.example` with all required vars documented as `REQUIRED` or `OPTIONAL`. |
| 28 | Remove private key from client bundle risk | `packages/gold-betting-demo/app/src/lib/config.ts` | Remove `VITE_EVM_PRIVATE_KEY` / `VITE_HEADLESS_EVM_PRIVATE_KEY` from config. Create separate `e2e-config.ts` that's only imported in test files. Add Vite `define` guard that throws at build time if private key vars are set in production build. |
| 29 | Keypair file permission check | `packages/gold-betting-demo/keeper/src/common.ts` | After `fs.readFileSync`, check `fs.statSync(path).mode & 0o077`. If world-readable, log warning in dev, throw error in production. Remove inline JSON array keypair support — only accept file paths. |

**Integration approach**: `config-validator.ts` is called as the very first step in `main.ts`, before Fastify, before DB, before anything. It's a pure synchronous function that reads `process.env` and validates. On failure it prints a clear table of which vars failed and why, then exits. This is a one-time gate, not ongoing overhead.

#### 1E. Rate Limiting Extension

**Goal**: Every state-changing endpoint has appropriate rate limiting.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 30 | Arena-specific rate limit config | `packages/server/src/infrastructure/rate-limit/rate-limit-config.ts` | Add `getArenaBetRateLimit(): { max: 10, timeWindow: '1 minute' }`, `getArenaQuoteRateLimit(): { max: 30, timeWindow: '1 minute' }`, `getArenaAdminRateLimit(): { max: 5, timeWindow: '1 minute' }`. |
| 31 | Apply rate limits to arena routes | `packages/server/src/startup/routes/arena-routes.ts` | Add `config: { rateLimit: getArenaBetRateLimit() }` to bet record/external routes. Quote routes get higher limit. Admin routes get lower limit. Key by `request.auth.walletAddress` (per-wallet) not just IP. |
| 32 | WebSocket connection rate limiting | `packages/server/src/startup/websocket.ts` | Add per-IP connection rate limiter: max 5 connections per 10 seconds. Use the existing `SlidingWindowRateLimiter` class. Reject excess with `ws.close(4029, 'Rate limited')` before passing to `onConnection`. |
| 33 | Keeper service per-wallet rate limiting | `packages/gold-betting-demo/keeper/src/service.ts` | Add `SlidingWindowRateLimiter` keyed by `normalizedWallet` to `handleBetRecord`. Max 10 bets per minute per wallet. Return 429 with `Retry-After` header. |

---

### Phase 2: Architecture & Type Safety (Week 3-5)

*Decomposes god classes, eliminates type violations, adds proper abstractions. Directly lifts: Production Quality 4→9, SOLID 4→9, TypeScript Rigor 4→9, Clean Code 4→8, Memory 6→9, Anti-Cheat 5→9, Smart Contracts 6→9.*

#### 2A. ArenaService Decomposition (5,018 → ~6 modules of 400-800 lines each)

**Goal**: Single Responsibility — each module owns one domain.

**Target architecture**:
```
packages/server/src/arena/
├── ArenaService.ts              # Facade: orchestrates sub-services, ~300 lines
├── services/
│   ├── ArenaBettingService.ts   # Bet recording, pool management, quotes (~800)
│   ├── ArenaRoundService.ts     # Round lifecycle, phase transitions (~600)
│   ├── ArenaPayoutService.ts    # Payout calculation, distribution (~500)
│   ├── ArenaPointsService.ts    # Points, leaderboard, referrals (~600)
│   ├── ArenaWalletService.ts    # Wallet linking, identity merging (~400)
│   └── ArenaStakingService.ts   # Staking operations (~400)
├── SolanaArenaOperator.ts       # On-chain ops (unchanged, fix duplication)
├── DuelMarketMaker.ts           # Market making (unchanged, fix float math)
├── DuelCombatAI.ts              # Combat AI (unchanged, fix injection)
├── middleware/
│   └── arena-auth.ts            # Auth middleware (new from Phase 1)
├── config.ts                    # Config (unchanged)
├── types.ts                     # Types (expand to shared)
└── amounts.ts                   # Financial math (single source of truth)
```

| # | Task | Detail |
|---|------|--------|
| 34 | Extract `ArenaBettingService` | Move all bet-related methods: `recordBet`, `getBetQuote`, `getPoolState`, `getBetHistory`, pool update logic. This service owns the atomic transaction from Phase 1. Constructor takes DB pool and config. |
| 35 | Extract `ArenaRoundService` | Move round lifecycle: `startRound`, `endRound`, `getCurrentRound`, phase transition logic, round history. Emits events that `ArenaBettingService` and `ArenaPayoutService` listen to. |
| 36 | Extract `ArenaPayoutService` | Move payout calculation, distribution, payout job management. Takes `ArenaBettingService` for pool data and `SolanaArenaOperator` for on-chain payouts. |
| 37 | Extract `ArenaPointsService` | Move points accumulation, leaderboard queries, referral logic. This has no dependency on Solana — pure DB operations. |
| 38 | Extract `ArenaWalletService` | Move wallet linking, identity merging, wallet lookup. |
| 39 | Convert `ArenaService` to facade | ArenaService becomes thin orchestrator (~300 lines). Constructor creates sub-services via dependency injection. Public methods delegate to appropriate sub-service. Exposes `destroy()` that calls `destroy()` on all sub-services. |

**Integration approach**: The facade preserves the existing public API so callers (`arena-routes.ts`, `StreamingDuelScheduler`, `DuelBettingBridge`) don't change. Sub-services communicate through the facade or typed events, never directly referencing each other. Each sub-service gets its own test file.

#### 2B. StreamingDuelScheduler Decomposition (4,668 → ~5 modules of 400-900 lines each)

**Target architecture**:
```
packages/server/src/systems/StreamingDuelScheduler/
├── index.ts                     # Facade: tick loop + phase orchestration (~500)
├── managers/
│   ├── CycleManager.ts          # Cycle state, phase transitions (~600)
│   ├── MatchmakingManager.ts    # Agent selection, matchmaking (~500)
│   ├── BroadcastManager.ts      # WebSocket state broadcasting (~400)
│   ├── StreamManager.ts         # RTMP/streaming coordination (~500)
│   └── BettingIntegration.ts    # Bridge to ArenaService (~400)
├── types.ts                     # Shared types (fix all `any`)
└── config.ts                    # Scheduler configuration
```

| # | Task | Detail |
|---|------|--------|
| 40 | Extract `CycleManager` | Owns `currentCycle`, phase transitions, state machine. Eliminates the dual `schedulerState`/`currentCycle.phase` trackers — single source of truth. All phase transitions go through `CycleManager.transitionTo(phase)` which validates legal transitions. |
| 41 | Extract `MatchmakingManager` | Agent selection, readiness checks, spawn coordination. |
| 42 | Extract `BroadcastManager` | All WebSocket broadcasting: state updates, phase changes, agent info. |
| 43 | Extract `StreamManager` | RTMP stream start/stop, browser capture coordination. |
| 44 | Extract `BettingIntegration` | Bridge between scheduler phases and ArenaService round lifecycle. |
| 45 | Unify state tracking | Remove `schedulerState` enum. `CycleManager` is the single state authority. Index.ts tick loop reads state from `CycleManager.currentPhase` only. Replace all `void this.startCountdown()` fire-and-forget patterns with `await this.cycleManager.transitionTo('COUNTDOWN')` — awaited, not fire-and-forget. |

#### 2C. AgentManager Decomposition (2,493 → ~4 modules of 400-600 lines each)

**Target architecture**:
```
packages/server/src/eliza/
├── AgentManager.ts              # Facade: agent lifecycle orchestration (~400)
├── managers/
│   ├── AgentLifecycleManager.ts # Spawn, destroy, health checks (~500)
│   ├── AgentBehaviorTicker.ts   # Tick loop, behavior execution (~400)
│   ├── AgentConfigManager.ts    # Configuration, personality loading (~300)
│   └── AgentWorldBridge.ts      # Bridge between agents and game world (~400)
├── ModelAgentSpawner.ts         # External process spawning (fix env mutation)
├── ElizaDuelBot.ts              # Duel bot (fix `any` types)
├── ElizaDuelMatchmaker.ts       # Matchmaker (fix `any` types)
└── EmbeddedHyperscapeService.ts # World interaction (fix O(N*M) scan)
```

| # | Task | Detail |
|---|------|--------|
| 46 | Extract lifecycle, behavior tick, config, and world bridge | Each gets single responsibility. `AgentLifecycleManager` owns the `agents: Map`. `AgentBehaviorTicker` runs the tick loop with proper mutex (fix first-tick race). `AgentConfigManager` loads personalities. `AgentWorldBridge` handles entity scanning (fix O(N*M) with spatial index). |
| 47 | Fix `process.env` mutation race condition | `ModelAgentSpawner.ts`: Clone env object per spawn call instead of mutating global `process.env`. `const childEnv = { ...process.env, AGENT_ID: id, ... }; spawn(cmd, { env: childEnv })`. |
| 48 | Remove `@ts-ignore` suppression | Replace with proper type definitions or `as unknown as TargetType` with documented justification. |
| 49 | Add agent count limit | `AgentLifecycleManager`: configurable `MAX_AGENTS` (default 50). Reject spawn requests above limit with logged warning. |
| 50 | Add behavior tick timeout | `AgentBehaviorTicker`: wrap each agent's tick in `Promise.race([agent.tick(), timeout(5000)])`. Log and skip on timeout. Prevents single agent from blocking the entire tick loop. |

#### 2D. TypeScript Rigor Enforcement

**Goal**: Zero `any` types, runtime validation at all trust boundaries, discriminated unions for state.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 51 | Eliminate all `any` types | `StreamingDuelScheduler/types.ts` (6), `ElizaDuelBot.ts` (5), `ElizaDuelMatchmaker.ts` (4), `plugin-hyperscape/HyperscapeService.ts` (11+), `StreamingMode.tsx` | Replace each with concrete types. `equipment: any` → `equipment: Record<EquipSlot, EquippedItem \| null>`. `inventory: any` → `inventory: InventorySlot[]`. Agent info `any` → `AgentInfo` interface. Every replacement must compile. |
| 52 | Share arena/betting types | `packages/shared/src/types/game/arena-types.ts` (new) | Move arena types from `packages/server/src/arena/types.ts` to shared. Export: `ArenaBet`, `ArenaRound`, `ArenaPool`, `BetQuoteRequest`, `BetQuoteResponse`, `BetRecordRequest`, `BetRecordResponse`. Import in both server and client. |
| 53 | Fix `DuelErrorMessage.errorCode` type | `packages/shared/src/types/game/duel-types.ts` | Change `errorCode: string` → `errorCode: DuelErrorCode`. Ensure `DuelErrorCode` enum covers all error codes used in handlers. |
| 54 | Add Zod schemas for all WebSocket event payloads | `packages/server/src/systems/ServerNetwork/handlers/duel/schemas.ts` (new) | One Zod schema per event type. Export `validateDuelChallenge`, `validateDuelStake`, `validateDuelRule`, etc. Each returns `{ success: true, data: T } | { success: false, error: string }`. |
| 55 | Add Zod schemas for ChainWriterBridge events | `packages/web3/src/chain-writer/schemas.ts` (new) | `InventoryUpdateSchema`, `SkillUpdateSchema`, `DuelCompletedSchema`, `PlayerRegisteredSchema`. Parse in `attachToWorld()` event handlers before processing. |
| 56 | Typed `swapQuote` | `packages/server/src/arena/types.ts` | Replace `swapQuote: Record<string, unknown>` with `swapQuote: JupiterQuoteResponse` (define interface matching Jupiter API response structure) or `swapQuote: { inputMint: string; outputMint: string; inAmount: string; outAmount: string; priceImpactPct: string }`. |
| 57 | Fix `duelChallengeIncoming` field name mismatch | `packages/plugin-hyperscape/src/services/HyperscapeService.ts` | Change `challengerId` → `fromPlayerId` to match server payload. Or define shared event type in `packages/shared/src/types/game/duel-types.ts` that both server and plugin import. The shared type is the authoritative contract. |
| 58 | `DuelMarketMaker` float → BigInt | `packages/server/src/arena/DuelMarketMaker.ts` | Replace `toGoldBaseUnits` float intermediate with `parseDecimalToBaseUnits` from `amounts.ts`. Import instead of reimplementing. |
| 59 | Deduplicate `formatBaseUnitsToDecimal` | `SolanaArenaOperator.ts`, `gold-betting-demo/app/src/lib/config.ts` | Delete duplicate implementations. Import from canonical `packages/server/src/arena/amounts.ts`. For client-side (gold-betting-demo app), create `packages/shared/src/utils/amounts.ts` and import from there in both server and client. |

#### 2E. Memory & Timer Leak Fixes

**Goal**: Zero leaked timers, proper cleanup on all lifecycle events.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 60 | Add `destroy()` to shutdown sequence | `packages/server/src/startup/shutdown.ts` | Add: `streamingDuelScheduler?.destroy()`, `arenaService?.destroy()`, `duelMarketMaker?.destroy()`. Call in order: streaming → arena → market maker (reverse of init). Add try/catch per destroy to prevent cascade failures. |
| 61 | Fix timeout timer leak in DuelCombatAI | `packages/server/src/arena/DuelCombatAI.ts` | Store `setTimeout` return value. In `Promise.race`, when the main promise wins, call `clearTimeout(timerId)`. Pattern: `const timerId = setTimeout(...); try { result = await Promise.race([main, timeoutPromise]); } finally { clearTimeout(timerId); }` |
| 62 | Fix `nearbyBuffer` reference leak | `packages/server/src/eliza/EmbeddedHyperscapeService.ts` | Clear buffer array after each use: `nearbyBuffer.length = 0`. Or allocate new array per call (simpler, GC handles it outside hot path since this runs every 2 ticks not every frame). |
| 63 | Fix startup try/catch coverage | `packages/server/src/startup/main.ts` | Wrap `initializeAgents()`, `initStreamCapture()`, `DuelMarketMaker.init()` in individual try/catch blocks. On failure: log error, mark service as degraded, continue startup for remaining services. |
| 64 | Optimize entity scan | `EmbeddedHyperscapeService.ts` | Replace O(N*M) entity scan with spatial query using existing spatial partition system (if available) or maintain a `Set<entityId>` of nearby entities, doing incremental add/remove instead of full scan every 2 ticks. |

#### 2F. Anti-Cheat Hardening

**Goal**: Comprehensive server-side validation preventing all exploitable gaps.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 65 | Lock staked items in inventory | `packages/server/src/systems/DuelSystem/index.ts` | When `addStake` is called: (a) verify player owns item at specified slot with sufficient quantity, (b) mark items as "locked" in a `lockedStakes: Map<playerId, Map<slot, quantity>>`, (c) prevent dropping/trading/equipping locked items by checking in those handlers, (d) unlock on duel cancel or completion. |
| 66 | Verify item ownership at stake time | Same file | In `addStake`: query player's inventory for the item at the specified slot. If item doesn't exist or quantity insufficient, reject with error. Don't defer this check to resolution time. |
| 67 | Add `duelBot` flag server-side enforcement | `packages/server/src/systems/ServerNetwork/handlers/duel/challenge.ts` | Ignore `duelBot` flag from client. Server determines bot status from `AgentManager.isAgent(playerId)`. Never trust client claims about bot status. |
| 68 | Self-duel prevention on-chain | `packages/contracts/src/systems/DuelSystem.sol` | Add `if (challengerAddress == opponentAddress) revert Errors.SelfDuel(duelId);` before recording. |
| 69 | Sequence validation for duel actions | `packages/server/src/systems/ServerNetwork/handlers/duel/` | Each handler validates the duel is in the expected state before proceeding. Create helper: `function assertDuelState(session: DuelSession, expected: DuelSessionState, socket: ServerSocket): boolean` used across all handlers. |

#### 2G. Smart Contract Fixes

**Goal**: All overflow checks, return value validation, proper boundary enforcement.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 70 | Check ERC-20 mint/burn return values | `packages/contracts/src/systems/GoldSystem.sol` | Replace `IWorldCall(_world()).call(...)` with `(bool success, bytes memory returnData) = IWorldCall(_world()).call(...); if (!success) revert Errors.ERC20MintFailed(characterId, amount);`. Apply to `_mintERC20`, `_burnERC20`, `_transferERC20`. |
| 71 | Revert on missing character registration | Same file | Change `if (playerAddress != address(0)) { _mintERC20(...) }` to `if (playerAddress == address(0)) revert Errors.CharacterNotRegistered(characterId); _mintERC20(...)`. Server must ensure registration before gold operations. |
| 72 | Gold overflow check in trade | `packages/contracts/src/systems/TradeSystem.sol` | In `_completeTrade`, add: `uint64 newGold = currentGold + initiatorGold; if (newGold > Constants.MAX_GOLD || newGold < currentGold) revert Errors.GoldOverflow(recipientCharId, currentGold, initiatorGold);` for both directions. |
| 73 | Implement bank fallback for trade cancel | Same file | Replace TODO in `_returnEscrowedItems()`: if no empty inventory slot, call `BankSystem.setBankSlot(characterId, firstEmptyBankSlot, itemId, quantity)`. If bank also full, revert entire cancellation with `Errors.StorageFull(characterId)`. |
| 74 | Fix bank slot boundary | `packages/contracts/src/systems/BankSystem.sol` | Add `uint8 constant SLOTS_PER_TAB = MAX_BANK_SLOTS / MAX_BANK_TABS;`. Change check to `if (slot >= SLOTS_PER_TAB) revert Errors.BankSlotOutOfBounds(characterId, tabIndex, slot);`. |
| 75 | Prevent duplicate character registration | `packages/contracts/src/systems/PlayerRegistrySystem.sol` | Add: `address existingOwner = CharacterOwner.getPlayerAddress(characterId); if (existingOwner != address(0)) revert Errors.CharacterAlreadyRegistered(characterId);` |
| 76 | setGold overflow check | `packages/contracts/src/systems/GoldSystem.sol` | Add `if (amount > Constants.MAX_GOLD) revert Errors.GoldOverflow(characterId, 0, amount);` in `setGold()`. |

#### 2H. Persistence & Database

**Goal**: Full indexing, reversible migrations, optimized queries.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 77 | Add composite indexes | New migration `0050-arena-indexes.ts` | `CREATE INDEX idx_bets_round_wallet ON bets (round_id, bettor_wallet);` `CREATE INDEX idx_bets_tx_signature ON bets (tx_signature);` `CREATE INDEX idx_arena_rounds_status ON arena_rounds (status, created_at);` `CREATE INDEX idx_points_wallet ON arena_points (wallet_address);` |
| 78 | Add DOWN migrations | All arena migrations (0039-0049) | Add `down()` function to each migration that reverses the `up()`. For table creation → `DROP TABLE IF EXISTS`. For column adds → `ALTER TABLE DROP COLUMN`. For index creation → `DROP INDEX`. |
| 79 | Add `dedupeKey` UNIQUE constraint | `packages/web3/` migration | Verify/add `CREATE UNIQUE INDEX idx_failed_tx_dedupe ON failed_transactions (dedupe_key);` so `DatabaseTxPersistence` upsert works correctly. |
| 80 | Schema validation in `DatabaseTxPersistence` | `packages/web3/src/tx/DatabaseTxPersistence.ts` | In constructor, run `SELECT column_name FROM information_schema.columns WHERE table_name = $1` and verify expected columns exist. Throw clear error if schema mismatch. |
| 81 | Explicit column selection | `packages/server/src/arena/ArenaService.ts` (after decomposition: `ArenaBettingService.ts`) | Replace any `SELECT *` with explicit column lists. Verify no `SELECT *` exists in arena/betting queries. |

---

### Phase 3: Clean Code, Patterns & Client (Week 6-8)

*Refines code quality, implements proper client patterns, adds missing game patterns. Directly lifts: Clean Code 4→9, Best Practices 4→9, GRASP 5→9, Law of Demeter 5→9, UI Framework Integration 5→9, Client Responsiveness 4→9, Game Programming Patterns 6→9.*

#### 3A. Clean Code Pass

**Goal**: Small functions, CQS, no side effects mixed with return values, meaningful names.

| # | Task | Scope | Detail |
|---|------|-------|--------|
| 82 | Extract large methods in decomposed services | All refactored modules | No method exceeds 40 lines. Methods that do exceed this are extracted into private helpers with descriptive names. Target: every function operates at a single level of abstraction. |
| 83 | Enforce Command-Query Separation | Arena services, DuelSystem, handlers | Audit all methods: if a method both mutates state AND returns data, split into a command (void return, mutates state) and a query (returns data, no mutation). Exception: `recordBet` returns `betId` — acceptable because the ID is a byproduct of the command; document this. |
| 84 | Remove all dead code | `AgentManager.ts` (unused imports lines 15-135), `StreamingDuelScheduler/types.ts` (dead exports `DUEL_FOOD_ITEM`, `DUEL_FOOD_HEAL_AMOUNT`), `StreamingCameraController.ts` (stub file), `AgentManager.ts` TODO (line 604) | Delete dead code. Remove dead files entirely. |
| 85 | Consistent error handling pattern | All arena/duel services | Standardize: (a) use `Result<T, E>` pattern for expected failures (bet rejection, invalid state), (b) throw only for unexpected failures (DB down, null deref), (c) every catch block either handles the error specifically or re-throws with added context. No empty catch blocks. No `catch (e) { console.log(e) }` without re-throw or recovery. |
| 86 | Meaningful names pass | `ArenaService` pool vars, `StreamingDuelScheduler` phase vars, `DuelCombatResolver` stamina vars | Rename: `poolA`/`poolB` → `yesPool`/`noPool` (or `challengerPool`/`opponentPool`). `Number.MAX_SAFE_INTEGER` stamina → `INFINITE_STAMINA` constant. `swapQuote: Record<string, unknown>` → typed interface. Phase variables consistently named across scheduler. |

#### 3B. Best Practices & DRY

**Goal**: Single source of truth for all data, shared types, zero duplication.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 87 | Unify arena coordinates | `packages/shared/src/data/duel-arenas.json` (authoritative) | Remove arena coordinate definitions from `duel-manifest.ts` and `DuelSystem/config.ts`. Both import from `duel-arenas.json`. Single JSON file owns all arena positions. |
| 88 | Deduplicate `StakedItem` interface | `packages/shared/src/types/game/duel-types.ts` (authoritative) | Define `StakedItem` once in shared types. Remove duplicates from 4 DuelPanel files. All client components import from shared. |
| 89 | Align event name strings | `packages/shared/src/types/game/duel-types.ts` → `DuelEvents` | `InterfaceModals.tsx` and all client components must import event names from `DuelEvents` constants. Delete any hardcoded event name strings. Grep for all `"duel:` string literals and replace with `DuelEvents.` constant references. |
| 90 | Single `amounts.ts` source | `packages/shared/src/utils/amounts.ts` (new canonical location) | Move `parseDecimalToBaseUnits` and `formatBaseUnitsToDecimal` here. Delete copies from `packages/server/src/arena/amounts.ts` (re-export from shared), `SolanaArenaOperator.ts` (import), and `gold-betting-demo/app/src/lib/` (import). |
| 91 | Consistent config pattern | All config files | Every configurable value has: (a) a default in a config object, (b) env var override capability, (c) validation at startup. No magic numbers in code — all in config objects with JSDoc comments. |

#### 3C. GRASP & Law of Demeter

**Goal**: Proper responsibility assignment, minimal coupling, no deep property chains.

| # | Task | Scope | Detail |
|---|------|-------|--------|
| 92 | Encapsulate pool access | `ArenaBettingService` | Replace `this.currentRound.market.poolA` chain with `this.roundService.getPool('yes')` or `this.bettingService.getCurrentPools()` returning `{ yes: string, no: string, total: string }`. The pool data is accessed through its owning service, not through chain traversal. |
| 93 | Encapsulate duel session access | `DuelSystem` handlers | Instead of handlers reaching into `duelSystem.sessions.get(id).state`, expose `duelSystem.getSessionState(id): DuelSessionState | null`. Handlers call this method, never access internal maps. |
| 94 | Controller pattern for arena operations | Arena routes | Routes become thin controllers that: (a) validate input (Fastify schema), (b) call service method, (c) transform response. No business logic in routes. No direct DB access from routes. Every route handler is ≤15 lines. |
| 95 | Information Expert for payout calculation | `ArenaPayoutService` | Payout calculation lives in the service that owns pool data. Client never calculates payouts — server provides `estimatedPayout` in bet quote response. Client displays server-provided value. |
| 96 | Protected Variations for chain operations | `SolanaArenaOperator` | Wrap Solana RPC calls behind an interface: `ChainOperator { reportAndResolve(...), placeBet(...), createMarket(...) }`. `SolanaArenaOperator` implements it. Tests can substitute a `MockChainOperator`. This also enables future EVM chain support without changing consumers. |

#### 3D. Client Shadow State & Responsiveness

**Goal**: Full optimistic UI with proper rollback, disconnect resilience, and clear feedback classification.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 97 | Implement shadow state for betting | `packages/client/src/game/panels/BettingPanel/useBettingPanel.ts` | Create `BettingShadowState` class: `{ pendingBets: Map<txId, PendingBet>, confirmedPools: PoolState, shadowPools: PoolState }`. On bet placement: (a) generate client-side `txId`, (b) add to `pendingBets`, (c) compute `shadowPools` from `confirmedPools + all pending`, (d) render from `shadowPools`. On server confirm: remove from `pendingBets`, update `confirmedPools`. On server reject: remove from `pendingBets`, show smooth rollback animation (pools animate back to confirmed state), show rejection toast. |
| 98 | WebSocket disconnect detection | Same file + `packages/client/src/game/panels/BettingPanel/BettingPanel.tsx` | Monitor WebSocket connection state. On disconnect: (a) show yellow "Reconnecting..." banner, (b) freeze bet placement (disable button), (c) keep displaying last known state. On reconnect: (a) request full state resync from server, (b) reconcile pending bets (server may have processed some), (c) remove banner. On timeout (>30s): show red "Connection lost" with manual reconnect button. |
| 99 | Pending bet timeout | Shadow state class | Each pending bet has a 10-second timeout. If server doesn't confirm/reject within 10s: (a) mark bet as "uncertain", (b) show "Bet may not have been placed" message, (c) query server for bet status on next reconnect. |
| 100 | Server-provided payout estimates | Server: `ArenaBettingService`, Client: `useBettingPanel.ts` | Server includes `estimatedPayout` in pool state broadcasts. Client displays server value instead of computing locally. Eliminates drift between client/server calculations. |
| 101 | Classify feedback types | Client betting panel | Tag each UI update: `COSMETIC` (pool animation), `PREDICTIVE` (optimistic bet), `SERVER_GATED` (payout claim). Cosmetic = instant. Predictive = optimistic with rollback. Server-gated = spinner until server confirms. |

#### 3E. UI Framework Cleanup

**Goal**: Proper lifecycle, no dead components, responsive layout.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 102 | Delete dead `StreamingCameraController.ts` | `packages/client/src/streaming/StreamingCameraController.ts` | File is a stub with only `console.log`. Delete entirely. Remove imports. |
| 103 | Break up 340-line useEffect | `packages/client/src/screens/StreamingMode.tsx` | Extract into: `useCanvasCapture()` (capture logic), `useStreamConnection()` (WebSocket connection), `useStreamState()` (state management). Each hook is ≤80 lines with clear responsibility. |
| 104 | Responsive DuelPanel | `packages/client/src/game/panels/DuelPanel/` | Replace fixed pixel widths with responsive units. Use `clamp()` for font sizes, `min()/max()` for container widths. Test at 320px (mobile), 768px (tablet), 1280px (desktop). |
| 105 | Proper cleanup on unmount | All client components with intervals/listeners | Audit every `useEffect` in betting/duel/streaming panels. Every `setInterval`, `setTimeout`, `addEventListener`, WebSocket listener must have cleanup in the effect's return function. No orphaned listeners after unmount. |
| 106 | External state management for betting | `packages/client/src/stores/bettingStore.ts` (new) | Move betting state out of component-local `useState` into a Zustand store (or React Context with `useReducer`). State persists across panel open/close. Includes: `confirmedPools`, `pendingBets`, `connectionStatus`, `betHistory`. |

#### 3F. Game Programming Patterns

**Goal**: Proper event queue, formalized state machines, service locator for arena systems.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 107 | Formalize event queue for arena broadcasts | `packages/server/src/arena/events/ArenaEventQueue.ts` (new) | Typed event queue decoupling producers (ArenaService, DuelSystem) from consumers (BroadcastManager, AuditLogger, BettingBridge). Events: `ROUND_STARTED`, `BET_PLACED`, `ROUND_ENDED`, `PAYOUT_DISTRIBUTED`, `MARKET_CREATED`, `MARKET_RESOLVED`. Queue processes in tick order, not ad-hoc. |
| 108 | Arena service locator | `packages/server/src/arena/ArenaServiceLocator.ts` (new) | Replaces global singleton access. Register services at startup: `ArenaServiceLocator.register('betting', bettingService)`. Systems access: `ArenaServiceLocator.get<ArenaBettingService>('betting')`. Typed access via generic. Enables testing with mock services. |
| 109 | Double-buffer for broadcast state | `BroadcastManager` | Server maintains two copies of broadcast state: `currentState` (what clients see) and `nextState` (being built this tick). At tick boundary, swap. Clients always see a consistent snapshot, never partial updates. |
| 110 | Scheduler state machine formalization | `CycleManager` (from 2B decomposition) | Replace implicit phase transitions with explicit `StateMachine<CyclePhase>` class. Define transition table: `IDLE → MATCHMAKING → COUNTDOWN → FIGHTING → RESOLUTION → IDLE`. Each transition has: guard condition, entry action, exit action. Illegal transitions throw with descriptive error. |

---

### Phase 4: Testing & Distributed Systems (Week 9-12)

*Comprehensive test coverage, horizontal scaling readiness. Directly lifts: Testing 2→9, Distributed Systems 4→9, Persistence 5→9.*

#### 4A. Financial Stack Test Suite

**Goal**: 100% coverage of all financial paths with property-based testing for edge cases.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 111 | `amounts.ts` unit tests | `packages/shared/src/utils/amounts.test.ts` (new) | Test: (a) round-trip: `formatBaseUnitsToDecimal(parseDecimalToBaseUnits(v, d), d) === v` for 100 random values, (b) edge cases: "0", "0.000001", "999999999.999999", (c) truncation: "1.123456789" with 6 decimals → truncates not rounds, (d) negative inputs → throws, (e) non-numeric inputs → throws. |
| 112 | `ArenaBettingService` integration tests | `packages/server/src/arena/services/ArenaBettingService.test.ts` (new) | Test with real PostgreSQL (use `pg-mem` or test container): (a) concurrent bet recording — 10 simultaneous bets, all pools correct, (b) idempotency — same `txSignature` twice → same `betId`, pool only updated once, (c) max bet exceeded → 400 error, (d) bet on ended round → rejected, (e) pool arithmetic accuracy — 1000 sequential bets, final pool matches sum. |
| 113 | `SolanaArenaOperator` integration tests | `packages/server/src/arena/SolanaArenaOperator.test.ts` (new) | Test against local Solana validator (`solana-test-validator`): (a) market creation, (b) bet placement, (c) report + resolve (atomic), (d) settlement, (e) failure recovery — kill validator mid-transaction → retry succeeds. |
| 114 | `DuelBettingBridge` integration tests | `packages/server/src/systems/DuelScheduler/DuelBettingBridge.test.ts` (new) | Test: (a) duel complete → market resolved, (b) resolution failure → retry queue, (c) market lookup by agent IDs, (d) 10 retries exhausted → market moved to history with audit log. |
| 115 | `ArenaPayoutService` unit tests | Tests for payout calculation | Test: (a) winner gets proportional pool share, (b) house fee deducted correctly (2%), (c) rounding doesn't lose dust (accumulated and distributed), (d) zero-pool edge case → no payout, no error. |

#### 4B. Duel System Extended Tests

**Goal**: Cover all gaps in existing excellent test suite.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 116 | Stake locking tests | `DuelSystem.test.ts` extension | Test: (a) staked item cannot be dropped during duel, (b) staked item cannot be traded, (c) staked item cannot be equipped elsewhere, (d) cancel duel → items unlocked, (e) duel complete → items transferred to winner and unlocked. |
| 117 | Handler state validation tests | New handler test files | Test: (a) stake change during CONFIRMING → rejected, (b) rule change during COUNTDOWN → rejected, (c) challenge self → rejected, (d) challenge disconnected player → rejected, (e) concurrent challenges from same player → second rejected. |
| 118 | Settlement edge case tests | `duel-settlement.test.ts` extension | Test: (a) inventory full → items go to bank, (b) bank full → settlement still succeeds but items tracked in overflow table, (c) concurrent identical settlements → only one executes (idempotency), (d) partial item validation failure → logged but settlement continues. |

#### 4C. Keeper & Web3 Tests

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 119 | Keeper bot unit tests | `packages/gold-betting-demo/keeper/src/bot.test.ts` (new) | Test: (a) missing seed → throws (not fallback to Date.now), (b) market creation retry logic, (c) funding check correctly pauses processing, (d) match ID collision detection. |
| 120 | Keeper service API tests | `packages/gold-betting-demo/keeper/src/service.test.ts` (new) | Test: (a) RPC proxy rejects `sendTransaction`, (b) points calculation from verified amounts only, (c) rate limiting per wallet, (d) write key required in production. |
| 121 | `BatchWriter` unit tests | `packages/web3/src/tx/BatchWriter.test.ts` (new) | Test: (a) batch accumulation up to `maxBatchSize`, (b) flush sends all batched calls, (c) nonce assignment sequential, (d) retry on transient error, (e) dead-letter after max retries, (f) dedup key prevents duplicate calls. |
| 122 | `ChainWriterBridge` integration tests | `packages/web3/src/chain-writer/ChainWriterBridge.test.ts` (new) | Test: (a) inventory update → correct chain write, (b) agent player → skipped, (c) duel without wallet registration → skipped with warning, (d) equipment slot mapping completeness. |

#### 4D. Smart Contract Tests

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 123 | `GoldSystem` Foundry tests | `packages/contracts/test/GoldSystem.t.sol` (new) | Test: (a) mint → ERC-20 balance matches, (b) mint to unregistered character → reverts, (c) gold overflow → reverts, (d) transfer burn+mint → supply unchanged, (e) sync balances correctness. |
| 124 | `TradeSystem` Foundry tests | `packages/contracts/test/TradeSystem.t.sol` (new) | Test: (a) full trade flow, (b) cancel → items returned, (c) cancel with full inventory → items to bank, (d) gold overflow on trade → reverts, (e) non-participant cancel → reverts. |
| 125 | `BankSystem` boundary tests | `packages/contracts/test/BankSystem.t.sol` (new) | Test: (a) slot 0 valid, (b) slot = SLOTS_PER_TAB - 1 valid, (c) slot = SLOTS_PER_TAB → reverts, (d) tab 0-9 valid, (e) tab 10 → reverts. |
| 126 | `DuelSystem` self-duel test | `packages/contracts/test/DuelSystem.t.sol` (new) | Test: (a) challenger == opponent → reverts with `SelfDuel`, (b) winner not participant → reverts, (c) stats update correctly on win/loss. |

#### 4E. End-to-End Integration Tests

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 127 | Full duel betting E2E | `tests/e2e/duel-betting.test.ts` (new) | Playwright test: (a) start server + streaming, (b) open client, (c) wait for duel cycle, (d) place bet via UI, (e) verify pool update, (f) wait for resolution, (g) verify payout. Uses real server, real client, real WebSocket. |
| 128 | Keeper bot E2E | `tests/e2e/keeper-bot.test.ts` (new) | Start local Solana validator + keeper + game server. Run full cycle: market creation → bet placement → duel resolution → market settlement. Verify on-chain state matches expected. |
| 129 | Disconnection resilience E2E | `tests/e2e/disconnect-resilience.test.ts` (new) | Playwright: (a) place bet, (b) kill WebSocket mid-flight, (c) verify reconnect, (d) verify state reconciliation, (e) verify bet was either confirmed or rolled back (no orphan). |

#### 4F. Distributed Systems Readiness

**Goal**: Documented scaling strategy, graceful degradation, session recovery.

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 130 | Session affinity design | `packages/server/src/infrastructure/session/SessionManager.ts` (new) | Design session storage that can be backed by either in-memory (single instance) or Redis (multi-instance). Interface: `getSession(id)`, `setSession(id, data, ttl)`, `deleteSession(id)`. Current in-memory Maps become the default implementation. Redis implementation ready but not required. |
| 131 | Graceful degradation middleware | `packages/server/src/infrastructure/circuit-breaker.ts` (new) | Circuit breaker for external dependencies: Solana RPC, database, Privy auth. States: CLOSED (healthy) → OPEN (failing) → HALF_OPEN (testing). When Solana RPC circuit opens: (a) betting continues to record in DB, (b) on-chain settlement queued for retry, (c) UI shows "On-chain settlement delayed" instead of error. |
| 132 | Interest management for arena broadcasts | `BroadcastManager` | Only send arena state updates to clients that have the betting panel open. Add `socket.subscribe('arena')` / `socket.unsubscribe('arena')`. Reduces bandwidth for players not engaged in betting. |
| 133 | Connection quality monitoring | Client betting panel | Track: (a) WebSocket round-trip latency (ping/pong), (b) missed heartbeats, (c) reconnection count. Display connection quality indicator (green/yellow/red). Automatically reduce update frequency on poor connection (send every 5th update instead of every update). |
| 134 | Horizontal scaling documentation | `docs/architecture/scaling.md` (new) | Document: (a) which components are stateful (ArenaService, DuelSystem, StreamingDuelScheduler), (b) what blocks horizontal scaling (in-memory pools, singleton scheduler), (c) path to multi-instance: Redis-backed pools, distributed lock for scheduler, sticky sessions for WebSocket, (d) estimated effort and prerequisites. |

#### 4G. Database Operational Readiness

| # | Task | File(s) | Detail |
|---|------|---------|--------|
| 135 | Reversible migrations for all arena tables | Migrations 0039-0049 | Add `down()` to every migration. Test by running `up()` then `down()` then `up()` — verify no data loss and schema matches. |
| 136 | Query performance audit | Arena queries | Run `EXPLAIN ANALYZE` on: (a) bet listing by round, (b) leaderboard query, (c) points history by wallet, (d) active round lookup. Add indexes where sequential scan appears. Document expected query times. |
| 137 | Backup and recovery runbook | `docs/operations/backup.md` (new) | Document: (a) PostgreSQL WAL archiving config, (b) point-in-time recovery procedure, (c) backup frequency (every 4 hours for arena data), (d) recovery time objective (RTO) and recovery point objective (RPO), (e) tested recovery procedure with step-by-step instructions. |
| 138 | Dead-letter transaction recovery | `packages/web3/src/tx/DatabaseTxPersistence.ts` | Add `recoverDeadLetters()` method: (a) query all `status = 'dead_letter'` rows, (b) for each, check on-chain if tx actually succeeded (by calldata hash), (c) if succeeded → mark `status = 'confirmed'`, (d) if not → re-queue for retry, (e) expose via admin API endpoint. |

---

### Execution Summary

| Phase | Weeks | Focus | Categories Lifted |
|-------|-------|-------|-------------------|
| **Phase 1** | 1-2 | Security & Financial Integrity | OWASP 3→8, CWE 4→8, Economic Integrity 3→8, Server Authority 7→9 |
| **Phase 2** | 3-5 | Architecture & Type Safety | Production Quality 4→9, SOLID 4→9, TypeScript Rigor 4→9, Memory 6→9, Anti-Cheat 5→9, Smart Contracts 6→9, Persistence 5→8 |
| **Phase 3** | 6-8 | Clean Code, Patterns & Client | Clean Code 4→9, Best Practices 4→9, GRASP 5→9, Law of Demeter 5→9, UI Integration 5→9, Client Responsiveness 4→9, Game Patterns 6→9 |
| **Phase 4** | 9-12 | Testing & Distributed Systems | Testing 2→9, Distributed Systems 4→9, Persistence 8→9 |

### Final Category Projections After All Phases

| # | Category | Before | After | Justification |
|---|----------|--------|-------|---------------|
| 1 | Production Quality Code | 4 | 9 | God classes decomposed, dead code removed, proper error handling |
| 2 | Best Practices | 4 | 9 | Zero duplication, shared types, single source of truth |
| 3 | Testing Coverage | 2 | 9 | Full financial tests, E2E, smart contract tests, keeper tests |
| 4 | OWASP Security | 3 | 9 | Auth on all endpoints, input validation, secrets management |
| 5 | CWE Top 25 | 4 | 9 | Runtime validation, credential hardening, injection prevention |
| 6 | SOLID Principles | 4 | 9 | SRP via decomposition, DI, interface segregation |
| 7 | GRASP Principles | 5 | 9 | Proper responsibility assignment, low coupling, controllers |
| 8 | Clean Code | 4 | 9 | Small functions, CQS, meaningful names, consistent patterns |
| 9 | Law of Demeter | 5 | 9 | Encapsulated access, facade methods, no deep chains |
| 10 | Memory & Allocation | 6 | 9 | All timer leaks fixed, proper cleanup, buffer management |
| 11 | TypeScript Rigor | 4 | 9 | Zero `any`, Zod runtime validation, shared types |
| 12 | UI Framework Integration | 5 | 9 | Shadow state, proper cleanup, responsive, external state mgmt |
| 13 | Game Programming Patterns | 6 | 9 | Event queue, state machine, service locator, double buffer |
| 14 | Server Authority | 7 | 9 | Stakes locked, TOCTOU closed, sequence validation |
| 15 | Client Responsiveness | 4 | 9 | Shadow state, rollback, disconnect resilience, feedback classification |
| 16 | Anti-Cheat | 5 | 9 | Inventory locking, server-side bot detection, sequence validation |
| 17 | Economic Integrity | 3 | 9 | ACID bets, idempotency, audit logging, overflow protection |
| 18 | Persistence & Database | 5 | 9 | Full indexes, reversible migrations, backup strategy, query optimization |
| 19 | Distributed Systems | 4 | 9 | Circuit breakers, interest management, scaling documentation, session abstraction |
| 20 | Smart Contract Security | 6 | 9 | All overflow checks, return value validation, bank fallback, boundary fixes |
| **Projected Overall** | | **4.3** | **9.0** | |

### Total Task Count

| Phase | Tasks | Estimated Effort |
|-------|-------|------------------|
| Phase 1: Security | 33 tasks (#1-33) | ~2 weeks |
| Phase 2: Architecture | 45 tasks (#34-81) | ~3 weeks |
| Phase 3: Clean Code & Client | 29 tasks (#82-110) | ~3 weeks |
| Phase 4: Testing & Distributed | 28 tasks (#111-138) | ~4 weeks |
| **Total** | **138 tasks** | **~12 weeks** |

---

## Issue Count Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 18 |
| HIGH | 42 |
| MEDIUM | 51 |
| LOW | 19 |
| **Total** | **130** |

## Files Analyzed Summary

| Area | Files | Lines |
|------|-------|-------|
| Core Arena/Betting (Server) | 8 | ~8,500 |
| DuelSystem + Sub-managers | 5 | ~3,500 |
| Duel Network Handlers | 7 | ~2,800 |
| StreamingDuelScheduler | 2 | ~4,900 |
| Streaming/RTMP | 3 | ~2,300 |
| Agent/Eliza Integration | 5 | ~7,500 |
| Plugin-Hyperscape | 6 | ~3,000 |
| Shared Types & Manifests | 3 | ~1,200 |
| Client UI | 20+ | ~5,000 |
| Database Migrations | 11 | ~500 |
| Gold-Betting-Demo | 10 | ~6,800 |
| Web3 Package | 4 | ~1,700 |
| Smart Contracts | 7 | ~1,500 |
| Infrastructure & Middleware | 8 | ~2,800 |
| Dev Scripts & Config | 5 | ~500 |
| Tests | 14 | ~4,000 |
| **Total** | **~160+** | **~45,000+** |

---

*Report generated by super-audit across 3 passes. Integration plans added covering 138 tasks across 4 phases targeting 9/10 in all 20 categories.*
