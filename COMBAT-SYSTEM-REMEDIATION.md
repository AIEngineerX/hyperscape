# Combat System Remediation Plan

**Current Rating:** 8.2/10
**Target Rating:** 9.5/10
**Scope:** ~98 combat files across shared/server/client packages

---

## Phase 1: P0 Bug Fixes (8.2 → 8.6)

### 1.1 Fix AggroSystem `shouldIgnorePlayer()` backwards logic
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:1069`
- **Bug:** Condition is inverted — checks raw `levelIgnoreThreshold` instead of calculating 2x mob level
- **Fix:** Change to `if (playerCombatLevel > 2 * mobLevel)` per OSRS double-level rule
- **Impact:** Mobs currently aggro wrong players based on combat level

### 1.2 Fix AggroSystem iterator race condition
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:841`
- **Bug:** `updatePlayerPosition()` can modify `aggroTargets` Map while `updateMobAI()` iterates it
- **Fix:** Defensive copy before iteration in `updateMobAI()` loop (snapshot keys/values before iterating)
- **Impact:** Iterator corruption under concurrent position updates

### 1.3 Add AggroSystem aggro logic tests
- **File:** `packages/shared/src/systems/shared/combat/__tests__/AggroSystem.test.ts`
- **Add tests for:**
  - Level-based aggro (double-level ignore rule)
  - Tolerance expiration
  - Region transitions (playersByRegion consistency)
  - Dead player handling

---

## Phase 2: Memory Leak Fixes (8.6 → 8.9)

### 2.1 CombatAntiCheat automatic cleanup
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:206-208`
- **Bug:** `playerXPHistory`, `playersKicked`, `playersBanned` grow unbounded
- **Fix:**
  - Add `cleanupPlayer(playerId)` call on `PLAYER_UNREGISTERED` event
  - Add periodic pruning of `playerXPHistory` (e.g., entries older than 60s)
  - Add expiration timestamps to `playersKicked` (auto-expire after configurable duration)
- **Add tests:** Memory cleanup on disconnect, pruning behavior

### 2.2 ProjectileService cancelled projectile cleanup
- **File:** `packages/shared/src/systems/shared/combat/ProjectileService.ts:177`
- **Bug:** Cancelled projectiles not removed from `projectilesByTarget` Sets
- **Fix:** When cancelling a projectile, also remove its ID from the target's Set in `projectilesByTarget`. Delete empty Sets.
- **Add tests:** Orphaned projectile cleanup, large projectile counts

### 2.3 CombatAntiCheat `trackAttack()` early return
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:373`
- **Bug:** Continues incrementing counters after recording a rate violation
- **Fix:** Return immediately after recording violation — don't increment further

---

## Phase 3: Error Handling & Logging (8.9 → 9.1)

### 3.1 Add try-catch around damage application
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts` (around line 1614-1619)
- **Current:** No error handling around `handler.applyDamage()` call
- **Fix:** Wrap in try-catch, log error with structured logger, prevent combat state corruption on failure

### 3.2 Migrate PlayerDeathSystem to structured logger
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts`
- **Current:** Mix of `console.log` and structured `this.logger` calls
- **Fix:** Replace all `console.log/error/warn` calls with `this.logger.info/error/warn`
- **Scope:** ~15-20 console.log calls to migrate

### 3.3 Add error handling to AggroSystem region transitions
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts`
- **Current:** No error handling if `updatePlayerTolerance()` fails to remove from old region
- **Fix:** Wrap region transitions in try-catch, log failures, ensure bidirectional index consistency

### 3.4 RangeSystem bounds validation for large NPCs
- **File:** `packages/shared/src/systems/shared/combat/RangeSystem.ts:130`
- **Current:** Silently truncates NPCs > 5x5 tiles (25 tile buffer)
- **Fix:** Log a warning when NPC size exceeds buffer capacity. Consider dynamic buffer sizing or throw if size > max.

---

## Phase 4: Security Hardening (9.1 → 9.3)

### 4.1 Integrate CombatRequestValidator into attack flow
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts`
- **Current:** `CombatRequestValidator` has full HMAC-SHA256 validation but is never called
- **Fix:** Wire `validateRequest()` into `handleMeleeAttack()`, `handleRangedAttack()`, and `handleMagicAttack()` entry points
- **Note:** May require client-side request signing — evaluate if WebSocket auth makes this redundant for same-process deployments. If redundant, document the decision and remove the unused validator.

### 4.2 Add projectile count limit per player
- **File:** `packages/shared/src/systems/shared/combat/ProjectileService.ts`
- **Current:** No max cap on active projectiles per player
- **Fix:** Add `MAX_ACTIVE_PROJECTILES_PER_PLAYER` constant (e.g., 10). Reject new projectile creation if limit reached. Log as anti-cheat violation.

### 4.3 CombatRateLimiter stats accuracy
- **File:** `packages/shared/src/systems/shared/combat/CombatRateLimiter.ts:132`
- **Current:** `getStats()` includes expired cooldowns (checks `> 0` not `> currentTick`)
- **Fix:** Change to `state.cooldownUntilTick > currentTick`

---

## Phase 5: CombatSystem Refactor (9.3 → 9.4)

### 5.1 Extract `enterCombat()` into focused helpers
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:1665-1953`
- **Current:** 288 lines handling state creation, rotation, retaliation, movement coordination
- **Fix:** Extract into:
  - `createCombatState()` — state initialization
  - `setupRetaliation()` — auto-retaliate logic
  - `emitCombatStartEvents()` — event emission
- **Target:** Each method < 80 lines

### 5.2 Consolidate duplicate validation
- **Files:** `CombatSystem.ts` — `validateMeleeAttack()` vs `validateCombatActors()`
- **Current:** Both check entity existence and alive status with similar code
- **Fix:** Extract shared `validateCombatActors()` and call from both paths

### 5.3 Extract `getInventorySystem()` / `getPlayerSystem()` helpers
- **Current:** Double-cast pattern (`as unknown as { ... }`) repeated for system access
- **Fix:** Private helper methods that centralize the cast and null check

### 5.4 Fix minor code issues
- **PidManager.ts:79** — Remove useless ternary (`a.id : a.id`), use `String(a.id)`
- **AmmunitionService.ts:118** — Always lowercase `weaponType`: `(bow?.weaponType ?? "").toLowerCase()`
- **CombatAnimationManager.ts:235** — Use optional chaining for `deathState` access
- **CombatRotationManager.ts:84** — Improve PvP rotation failure log to distinguish which entity is missing

---

## Phase 6: Test Coverage (9.4 → 9.5)

### 6.1 AggroSystem comprehensive tests (from Phase 1.3, expand)
- **Add:** Leashing mechanics, chase behavior, multi-mob scenarios

### 6.2 ProjectileService cleanup tests
- **File:** `packages/shared/src/systems/shared/combat/__tests__/ProjectileService.test.ts`
- **Add:** Orphaned cancelled projectile cleanup, large projectile stress test, multiple targets

### 6.3 CombatRateLimiter comprehensive tests
- **File:** `packages/shared/src/systems/shared/combat/__tests__/CombatRateLimiter.test.ts`
- **Add:** Per-tick and per-second limit edge cases, cooldown expiration, stats accuracy

### 6.4 MobDeathSystem entity removal tests
- **File:** `packages/shared/src/systems/shared/combat/__tests__/MobDeathSystem.test.ts`
- **Add:** Entity removal validation, timer cleanup on destroy

### 6.5 CombatAnimationManager network tests
- **Add:** Death animation preservation, `c: false` on idle emote, network broadcast verification

### 6.6 Memory cleanup integration tests
- **Add:** Anti-cheat cleanup on player disconnect, projectile cleanup on target death, rate limiter state after disconnect

---

## Estimated Impact by Category

| Category | Current | After Phase 1 | After Phase 2 | After Phase 3 | After Phase 4 | After Phase 5 | After Phase 6 |
|----------|---------|---------------|---------------|---------------|---------------|---------------|---------------|
| OSRS Accuracy | 8.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.5 |
| Security | 8.5 | 8.5 | 8.5 | 8.5 | 9.5 | 9.5 | 9.5 |
| SOLID | 8.0 | 8.0 | 8.0 | 8.0 | 8.0 | 9.5 | 9.5 |
| Clean Code | 8.5 | 8.5 | 8.5 | 9.0 | 9.0 | 9.5 | 9.5 |
| Performance | 9.0 | 9.0 | 9.5 | 9.5 | 9.5 | 9.5 | 9.5 |
| ECS | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 9.0 | 9.5 |
| Anti-Cheat | 8.0 | 8.0 | 9.0 | 9.0 | 9.5 | 9.5 | 9.5 |
| Error Handling | 7.0 | 7.0 | 7.0 | 9.5 | 9.5 | 9.5 | 9.5 |
| Test Coverage | 8.0 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 9.5 |
| TypeScript | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 9.5 | 9.5 |
| **Overall** | **8.2** | **8.4** | **8.7** | **8.9** | **9.1** | **9.3** | **9.5** |

---

## Verification

```bash
# After each phase, run:
npx vitest run packages/shared/src/systems/shared/combat/__tests__/ --reporter=verbose
npx tsc --noEmit
npm run lint
```

## Total Steps: 23 across 6 phases
