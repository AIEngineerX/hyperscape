# Combat System Remediation Plan V2

**Current Rating:** ~7.2/10 (full combat surface)
**Target Rating:** 9.5/10
**Scope:** All combat-related files across shared, server, and client packages (~120+ files)
**Previous Remediation:** V1 addressed narrow CombatSystem/AggroSystem/ProjectileService/AntiCheat scope (now 9.5 in isolation)

---

## Phase 1: Crash Bugs & Critical Fixes (7.2 → 7.8)

### 1.1 Fix `opponent!.name` non-null crash in CombatSystem
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:2010`
- **Bug:** `opponent!` crashes if entity was destroyed between `enterCombat()` start and this line
- **Fix:** Replace `opponent!.name` with `opponent?.name ?? "Unknown"`, add early return if opponent is null

### 1.2 Fix unhandled async in combat tick loop
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:2546`
- **Bug:** `processAutoAttackOnTick` is `async` but called without `await` in sync `for` loop. Unhandled rejections crash Node.
- **Fix:** Collect promises and `await Promise.all()` after the loop, or wrap each call in try-catch with `.catch()` handler

### 1.3 Fix `getBestAggroTarget` undefined access
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:884-896`
- **Bug:** `bestTarget` uses `!` definite assignment assertion but is never assigned if `aggroTargets` is empty. Concurrent map deletion can cause crash.
- **Fix:** Initialize `bestTarget` to `null`, add null check before returning, guard caller

### 1.4 Fix permanent death state on system unavailability
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:728-738`
- **Bug:** Early return when database/inventory unavailable, but player already marked `DYING` and `PLAYER_SET_DEAD` already emitted. Player stuck dead forever.
- **Fix:** Move `PLAYER_SET_DEAD` emission and `deathState = DYING` to AFTER system availability checks pass. Add recovery path that resets death state on early return.

### 1.5 Fix `world.entities.items.get(playerId)` wrong collection
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:712`
- **Bug:** `getPlayersInNearbyRegions` queries the items collection for player IDs — returns empty results
- **Fix:** Change to `this.world.entities.get(playerId)` or `this.world.getPlayer(playerId)`

### 1.6 Fix MobDeathSystem missing `super.destroy()`
- **File:** `packages/shared/src/systems/shared/combat/MobDeathSystem.ts:57`
- **Bug:** `destroy()` clears timers but never calls `super.destroy()`, leaking event subscriptions
- **Fix:** Add `super.destroy()` call

### 1.7 Fix CombatAntiCheat threshold ordering
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:663-762`
- **Bug:** Alert check (75) does NOT return, so it falls through to kick check (50). Every alert also triggers a kick. Also, kick threshold (50) fires before alert threshold (75), making alerts unreachable on first pass.
- **Fix:** Reorder checks: ban (150) → alert+kick (75) → kick (50) → warning (25), add `return` after each action. Or rationalize thresholds so alert < kick < ban.

### 1.8 Fix CombatStateService hardcoded `weaponType: MELEE`
- **File:** `packages/shared/src/systems/shared/combat/CombatStateService.ts:172-173, 203-204`
- **Bug:** `createAttackerState` and `createRetaliatorState` always set `weaponType: AttackType.MELEE` regardless of actual weapon. Any system reading `CombatData.weaponType` gets wrong data for ranged/magic.
- **Fix:** Accept `weaponType` as parameter, derive from equipped weapon or attack context

### 1.9 Fix spell `attackSpeed: 0` exploit
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:1121`
- **Bug:** Unlike ranged path (line 946-949 with `Math.max(1, ...)`), magic path does not clamp `spell.attackSpeed`. A spell with `attackSpeed: 0` creates infinite-attack-speed exploit.
- **Fix:** Add `Math.max(1, spell.attackSpeed)` guard

### 1.10 Fix duel handler `result.error!` non-null assertions
- **Files:** 9 locations across `packages/server/src/systems/ServerNetwork/handlers/duel/*.ts`
- **Bug:** `sendDuelError(socket, result.error!, ...)` — if result has no `error` field, sends `undefined` to client
- **Fix:** Replace all `result.error!` with `result.error ?? "Unknown error"`

---

## Phase 2: Memory Leaks & Cleanup (7.8 → 8.2)

### 2.1 Add AggroSystem disconnect cleanup
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts`
- **Bug:** `playerSkills` (line 60), `playerTolerance` (line 69), `playersByRegion` (line 76) never cleaned on player disconnect
- **Fix:** Subscribe to `PLAYER_UNREGISTERED` / `PLAYER_LEFT`, call `removePlayerTolerance(playerId)` and delete from `playerSkills`

### 2.2 Fix CombatSystem `lastCombatTargetTile` leak
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:189`
- **Bug:** `cleanupPlayerDisconnect` (line 2443) does not delete from `lastCombatTargetTile`
- **Fix:** Add `this.lastCombatTargetTile.delete(playerId)` to `cleanupPlayerDisconnect`

### 2.3 Fix CombatSystem pooled tile leak
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:183-184`
- **Bug:** `_attackerTile` and `_targetTile` acquired from `tilePool` in constructor but never released in `destroy()`
- **Fix:** Release tiles back to pool in `destroy()`

### 2.4 Fix CombatAntiCheat `playersBanned` unbounded growth
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:208`
- **Bug:** `playersBanned` grows forever, only cleared on `destroy()`
- **Fix:** Add TTL-based expiration (e.g., banned entries expire after configurable duration) or prune on periodic interval

### 2.5 Fix CombatAntiCheat `decayScores` cleanup unreachable
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:491-501`
- **Bug:** Cleanup condition requires `state.violations.length === 0` but violations are never emptied by decay. Players with any violation stay tracked forever.
- **Fix:** Also prune old violations during decay (e.g., violations older than 10 minutes), or change condition to only require `score === 0`

### 2.6 Fix CombatAntiCheat missing try-catch on callbacks
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:276-284, 682-690, 732-739`
- **Bug:** `metricsCallback` and `autoActionCallback` can throw and crash the caller
- **Fix:** Wrap both in try-catch

### 2.7 Fix PlayerDeathSystem untracked setTimeout
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:1320-1328`
- **Bug:** `setTimeout` in `onPlayerReconnect` not added to `this.respawnTimers`. Fires on stale player if they disconnect again.
- **Fix:** Store timer reference in `respawnTimers` map, clear on disconnect

### 2.8 Fix PlayerDeathSystem double `PLAYER_UNREGISTERED` subscription
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:321-323, 385-387`
- **Bug:** Two separate subscriptions to same event with non-deterministic ordering
- **Fix:** Unify into single handler that calls both `cleanupPlayerDeath` and `playerInventories.delete`

---

## Phase 3: Race Conditions & Async Safety (8.2 → 8.5)

### 3.1 Fix async magic attacks in sync combat tick loop
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:2523-2546`
- **Bug:** `for` loop iterates combat states synchronously but `processAutoAttackOnTick` is async. Two players casting spells on same target → rune consumption races.
- **Fix:** Collect all combat state processing as promises, `await Promise.allSettled()` at end of tick. Or make `consumeRunesForSpell` synchronous (preferred — rune inventory is local state).

### 3.2 Fix non-atomic death transaction
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:748-861`
- **Bug:** DB transaction commits, then `persistInventoryImmediate` runs separately. Server crash between = items lost.
- **Fix:** Include inventory persistence inside the same transaction, or implement a write-ahead log for recovery

### 3.3 Fix double `PLAYER_SET_DEAD` emission
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:719, 884`
- **Bug:** `PLAYER_SET_DEAD` with `isDead: true` emitted twice per death — before transaction and in `postDeathCleanup`
- **Fix:** Remove the first emission (line 719) — only emit after death processing is complete

### 3.4 Fix CombatStateService `clearStatesTargeting` iteration mutation
- **File:** `packages/shared/src/systems/shared/combat/CombatStateService.ts:401-407`
- **Bug:** Iterates `combatStates` while deleting entries and calling side-effect methods
- **Fix:** Collect IDs first into array, then iterate the array for deletions

### 3.5 Fix ProjectileService `processTick` iteration mutation
- **File:** `packages/shared/src/systems/shared/combat/ProjectileService.ts:149-162`
- **Bug:** Deletes from `activeProjectiles` Map during `for...of` iteration (inconsistent with defensive pattern at line 208)
- **Fix:** Collect IDs to remove, delete after iteration completes (match existing pattern in `cancelProjectilesFromAttacker`)

### 3.6 Fix CombatAntiCheat `decayScores` iteration mutation
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:491-501`
- **Fix:** Collect player IDs to delete, delete after iteration

### 3.7 Fix duel challenge race condition
- **File:** `packages/server/src/systems/ServerNetwork/handlers/duel/challenge.ts:172-296`
- **Bug:** `sendChallengeToTarget` closure captures state at creation, but between walk and execution target could start another duel or leave lobby
- **Fix:** Re-validate `isInDuelArenaLobby` inside the deferred closure before sending challenge

---

## Phase 4: Logging & Dead Code Cleanup (8.5 → 8.8)

### 4.1 Migrate all `console.log/warn/error` to structured logging
Replace every instance with the appropriate structured logger. Files and counts:

| File | Count | Notes |
|------|-------|-------|
| CombatAnimationManager.ts:236,243 | 2 | Hot path — fires every emote reset |
| CombatRotationManager.ts:83,97,115 | 3 | Line 115 fires every PvP tick |
| CombatStateService.ts:338 | 1 | |
| MobDamageHandler.ts:53 | 1 | |
| PlayerDamageHandler.ts:68,78 | 2 | |
| AggroSystem.ts:832,930 | 2 | |
| CombatAntiCheat.ts:347,671,699,720,748 | 5 | Security-critical |
| CombatRateLimiter.ts:190 | 1 | |
| CombatEventBus.ts:238 | 1 | |
| SafeAreaDeathHandler.ts:78-85 | 2 | Logs all items on death |
| Server combat.ts:269 | 1 | Every PvP attack |

**Total: ~21 instances**

For files without access to `this.logger` (standalone services), use `Logger.systemInfo/systemWarn/systemError` from `utils/Logger`.

### 4.2 Remove dead methods in AggroSystem
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts`
- Remove `returnToHome()` (line 814-818) — empty body
- Remove `updatePatrol()` (line 960-964) — empty body
- Remove `onCombatEnded()` (line 985-1002) — never called or subscribed
- Remove `shouldIgnorePlayer()` (line 1071-1080) — duplicates `shouldMobAggroPlayer`

### 4.3 Remove dead code in MobDeathSystem
- **File:** `packages/shared/src/systems/shared/combat/MobDeathSystem.ts`
- Remove `mobRespawnTimers` Map (line 7) — never populated
- Fix `despawnMob` to log error if `entities.remove` doesn't exist instead of silently failing

### 4.4 Remove dead singletons and interfaces
- Remove `combatRateLimiter` singleton export (CombatRateLimiter.ts:197) — never imported
- Remove `ArrowConsumeResult` interface (AmmunitionService.ts:39-45) — never used
- Remove `_getDefenseValue` function (CombatCalculations.ts:233-244) — dead code with "kept for future use" comment
- Remove `CombatRateLimiter.cleanup/resetPlayer` duplication — make one call the other or remove one

### 4.5 Remove empty lifecycle overrides in PlayerDeathSystem
- **File:** `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts:1598-1611`
- Remove 10 empty lifecycle methods (`preTick`, `preFixedUpdate`, `fixedUpdate`, `postFixedUpdate`, `preUpdate`, `postUpdate`, `lateUpdate`, `postLateUpdate`, `commit`, `postTick`) if SystemBase provides default no-ops

### 4.6 Fix typo `mosbAffected` → `mobsAffected`
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:1013`

### 4.7 Remove stale comments
- CombatSystem.ts:1584 — "MVP: calculateRangedDamage removed" (method now exists)
- CombatSystem.ts:1005 — "Arrow consumption will be handled when projectile hits" (verify if implemented or create issue)

---

## Phase 5: Anti-Cheat & Security Fixes (8.8 → 9.0)

### 5.1 Fix CombatRateLimiter mixed timing
- **File:** `packages/shared/src/systems/shared/combat/CombatRateLimiter.ts:49`
- **Bug:** `Date.now()` for per-second limits in a tick-based system. Lag spikes cause incorrect rate limiting.
- **Fix:** Convert per-second limiting to tick-based: `maxRequestsPerSecond` becomes `maxRequestsPer17Ticks` (17 ticks ≈ 1 second at 600ms/tick). Use tick arithmetic exclusively.

### 5.2 Fix CombatAntiCheat mixed timing
- **File:** `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts:281,320,549,664`
- **Bug:** `Date.now()` mixed with tick-based scoring. Same issue as 5.1.
- **Fix:** Convert timestamp-based tracking to tick-based where possible. For human-readable logging, convert ticks to time only at log emission.

### 5.3 Fix AggroSystem mixed timing
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:261,367,380,874,878,949`
- **Bug:** `Date.now()` for `lastStateChange`, `lastAction`, `lastSeen`, `lastDamageTime` while tolerance uses ticks
- **Fix:** Convert to tick-based timing. Store `lastActionTick` instead of `lastAction` timestamp.

### 5.4 Add projectile TTL / stale cleanup
- **File:** `packages/shared/src/systems/shared/combat/ProjectileService.ts`
- **Bug:** No expiration mechanism. If `processTick` stops being called, projectiles accumulate forever.
- **Fix:** Add `maxLifetimeTicks` constant (e.g., 20 ticks). In `processTick`, purge any projectile older than TTL.

### 5.5 Fix duel missing `FOR UPDATE` lock
- **File:** `packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts:86-90`
- **Bug:** Inventory SELECT lacks `FOR UPDATE`. TOCTOU race could allow item duplication during concurrent stake operations.
- **Fix:** Add `FOR UPDATE` to the inventory query

### 5.6 Fix duel attack type enforcement at wrong layer
- **File:** `packages/server/src/systems/ServerNetwork/handlers/combat.ts:172-198`
- **Bug:** Duel ranged/magic/special rules checked in handler, but actual attack type determined by CombatSystem based on equipped weapon. Rules can be bypassed.
- **Fix:** Move duel rule enforcement into CombatSystem where actual attack type is resolved, or pass duel rules down and check after weapon-type resolution

### 5.7 Validate NaN in ProjectileService inputs
- **File:** `packages/shared/src/systems/shared/combat/ProjectileService.ts:81-98`
- **Bug:** No validation on `sourcePosition`/`targetPosition`. NaN propagates through distance calculation.
- **Fix:** Add `Number.isFinite()` guard on position components

### 5.8 Fix duel `duelId` not validated in forfeit
- **File:** `packages/server/src/systems/ServerNetwork/handlers/duel/combat.ts:28-46`
- **Bug:** `data.duelId` declared but never used or validated
- **Fix:** Validate `duelId` matches the player's active duel, or remove from parameter type if unnecessary

---

## Phase 6: Type System Remediation (9.0 → 9.2)

### 6.1 Consolidate `DamageResult` to single definition
- **Current:** 3 different `DamageResult` interfaces with same name, different shapes
- **Files:**
  - `utils/game/CombatCalculations.ts:61-66` (hit result: damage, isCritical, damageType, didHit)
  - `types/systems/npc-strategies.ts:51-56` (identical duplicate of above)
  - `handlers/DamageHandler.ts:17-24` (apply result: actualDamage, targetDied, success)
- **Fix:** Rename to `HitCalculationResult` and `DamageApplicationResult`. Delete duplicate in npc-strategies.ts, import from CombatCalculations.ts.

### 6.2 Consolidate `calculateCombatLevel` to single formula
- **Current:** 3 different formulas producing different results
- **Files:**
  - `utils/game/CombatLevelCalculator.ts:64` — OSRS-accurate (canonical)
  - `types/entities/player-types.ts:310` — PlayerMigration simplified formula (wrong)
  - `data/npcs.ts:155` — NPC formula with different weights
- **Fix:** Make `CombatLevelCalculator` the single source. `PlayerMigration` and NPC calculator import from it. NPC variant can add overrides if needed, but base formula must match.

### 6.3 Unify AI state enums
- **Current:** 4 different string unions for mob AI state
- **File:** `types/entities/npc-mob-types.ts` lines 34, 57, 120, 571
- **Fix:** Define single `MobAIState` enum: `IDLE | WANDERING | CHASING | ATTACKING | COMBAT | RETURNING | FLEEING | DEAD`. Use this enum everywhere. Remove `"wander"`, `"chase"`, `"patrol"`, `"patrolling"` variants.

### 6.4 Fix equipment `item: unknown | null` (20 instances)
- **File:** `types/entities/entity-types.ts:139-356`
- **Bug:** 20 equipment slot definitions use `unknown | null` instead of `Item | null`
- **Fix:** Import `Item` type, change all 20 instances to `Item | null`

### 6.5 Fix `CombatStyle` vs `PlayerCombatData.combatStyle` naming conflict
- **Current:** `CombatStyle` = `"accurate"|"aggressive"|"defensive"|"controlled"` (stance), `PlayerCombatData.combatStyle` = `"attack"|"strength"|"defense"|"ranged"` (XP target)
- **Fix:** Rename `PlayerCombatData.combatStyle` to `xpTarget` or `trainingSkill` to clarify it's the skill gaining XP, not the combat stance

### 6.6 Add EventMap payload types for combat events
- **File:** `types/events/event-types.ts`
- **Bug:** 25+ combat EventType entries have no corresponding payload in EventMap
- **Fix:** Define payload interfaces for all combat events and add them to EventMap. Priority events:
  - `COMBAT_ATTACK_REQUEST`, `COMBAT_DAMAGE_DEALT`, `COMBAT_KILL`
  - `COMBAT_PROJECTILE_LAUNCHED`, `COMBAT_PROJECTILE_HIT`
  - `COMBAT_SPELL_CAST`, `COMBAT_RUNE_CONSUMED`, `COMBAT_AMMO_CONSUMED`
  - `PLAYER_DAMAGE`, `ENTITY_DAMAGE_TAKEN`, `ATTACK_STYLE_CHANGED`
  - All `AGGRO_*` events

### 6.7 Fix `CombatHitEvent.hitType` from `string` to union
- **File:** `types/events/event-payloads.ts:421`
- **Fix:** Change to `"melee" | "ranged" | "magic" | "miss"`

### 6.8 Fix `validateAttackType` to allow ranged/magic
- **File:** `utils/game/CombatValidation.ts:47-49`
- **Bug:** Only allows `"melee"` despite full ranged/magic implementation
- **Fix:** Update to `type is AttackType`: `return type === "melee" || type === "ranged" || type === "magic"`

### 6.9 Remove unused `AttackStyle.damageModifier/accuracyModifier`
- **File:** `types/game/combat-types.ts:134-150`
- **Fix:** Remove fields with "unused" comments per project rules

### 6.10 Fix duplicate equipment slot definitions
- **Current:** 3 definitions of 10-slot equipment (`StatsComponent`, `EquipmentComponent`, `PlayerEquipmentItems`)
- **Fix:** Define single `EquipmentSlots` interface, import everywhere. Include `arrows` slot in all definitions.

### 6.11 Consolidate `CombatStateData` / `CombatComponentData` duplicates
- **Fix:** Delete `CombatComponentData`, use `CombatStateData` everywhere (or vice versa)

### 6.12 Fix `MobStats` / `NPCStats` duplication
- **Fix:** Deprecate `MobStats`, migrate to `NPCStats` with required `defenseBonus`

### 6.13 Unify `Position3D` definitions
- **Current:** Locally redefined in CombatAuditLog.ts, CombatEventBus.ts, CombatRotationManager.ts
- **Fix:** Import from `types/index.ts` everywhere

---

## Phase 7: Architecture, Performance & Data (9.2 → 9.5)

### 7.1 Cache `PrayerSystem` lookup in CombatSystem
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:1297,1364,1547`
- **Bug:** `world.getSystem("prayer")` called in hot path on every damage calculation
- **Fix:** Cache as `this.prayerSystem` during `init()` like other systems

### 7.2 Cache repeated `world.getSystem("player")` lookups
- **File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts:803,934,1310,1373,2887`
- **Bug:** `PlayerSystem` is cached as `this.playerSystem` but 5 additional call sites re-fetch it
- **Fix:** Use `this.playerSystem` everywhere

### 7.3 Fix AggroSystem O(M) per-player position update
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:299-309`
- **Bug:** `updatePlayerPosition` iterates ALL mobs for every player position update
- **Fix:** Add spatial index for mobs (region-based, matching the player region system). Only check mobs in nearby regions.

### 7.4 Fix CombatAuditLog O(n) shift
- **File:** `packages/shared/src/systems/shared/combat/CombatAuditLog.ts:250`
- **Bug:** `this.logs.shift()` on potentially 10,000-element array — O(n) per entry
- **Fix:** Replace with ring buffer (circular array with head/tail pointers)

### 7.5 Fix CombatAnimationSync O(n²) splice
- **File:** `packages/shared/src/systems/shared/combat/CombatAnimationSync.ts:356-357`
- **Bug:** `splice(index, 1)` in loop creates O(n²) behavior
- **Fix:** Collect indices to remove, then filter once. Or use a swap-and-pop removal pattern.

### 7.6 Fix RangeSystem `getSWTile` buffer aliasing
- **File:** `packages/shared/src/systems/shared/combat/RangeSystem.ts:117-121`
- **Bug:** `getSWTile()` always returns the same `_tileBuffer` object. Any caller storing the return value across calls gets corrupted data.
- **Fix:** Return a new `{ x, z }` object from `getSWTile`, or document that return value must be consumed immediately and never stored

### 7.7 Fix `getPlayersInNearbyRegions` buffer aliasing
- **File:** `packages/shared/src/systems/shared/combat/AggroSystem.ts:671-719`
- **Bug:** Returns `this._nearbyPlayersBuffer` directly — callers storing the reference get stale data on next call
- **Fix:** Return a copy (`[...this._nearbyPlayersBuffer]`) or document the consumption contract clearly

### 7.8 Fix duplicate `calculateHitChance` across calculators
- **Files:** `MagicDamageCalculator.ts:139`, `RangedDamageCalculator.ts:104`
- **Fix:** Extract to shared utility function, import from both

### 7.9 Fix DamageCalculator missing mob `strength` stat
- **File:** `packages/shared/src/systems/shared/combat/DamageCalculator.ts:133-137`
- **Bug:** Mob attackers only extract `attack` stat, not `strength`. Max hit calculation may use undefined strength.
- **Fix:** Extract `strength` from `getMobData()` alongside `attack`

### 7.10 Externalize hardcoded data to manifests
- **Files and data to externalize:**
  - `SpellService.ts:41-155` — spell definitions → `data/spells.json` or `data/combat-spells.ts`
  - `RuneService.ts:43-48,177-201` — elemental staves, rune names → `data/runes.ts`
  - `AmmunitionService.ts:51-97` — bow tiers, arrow data → `data/ammunition.ts`
  - `RangeSystem.ts:34-60` — NPC sizes → derive from mob manifest
- **Note:** Per project rules: "No hardcoded data - use JSON files and general systems"

### 7.11 Add missing longbow support to AmmunitionService
- **File:** `packages/shared/src/systems/shared/combat/AmmunitionService.ts:51-56`
- **Bug:** Only shortbows in `BOW_TIERS`. Longbows default to tier 1, allowing any arrows.
- **Fix:** Add longbow entries when externalizing data (Phase 7.10)

### 7.12 Fix duel rule incompatibility mismatch
- **Files:** `types/game/duel-types.ts:77-82` vs `data/duel-manifest.ts:71-85`
- **Bug:** `INVALID_RULE_COMBINATIONS` has `noForfeit + noMovement` but manifest `incompatibleWith` does not
- **Fix:** Sync manifest `incompatibleWith` arrays with `INVALID_RULE_COMBINATIONS`, or derive one from the other

### 7.13 Fix CombatConstants inconsistencies
- **File:** `constants/CombatConstants.ts`
- `MELEE_RANGE: 2` vs `MELEE_RANGE_STANDARD: 1` — remove obsolete `MELEE_RANGE` or align values
- `EFFECTIVE_LEVEL_CONSTANT: 8` and `BASE_CONSTANT: 64` defined but not imported in `CombatCalculations.ts` — use them
- `hitpoints` vs `constitution` in `CombatLevelCalculator` — use `constitution` to match rest of codebase

### 7.14 Fix equipment slot naming inconsistency
- `"head"` (duel system) vs `"helmet"` (equipment system), `"ammo"` vs `"arrows"`
- **Fix:** Define canonical slot names in one place, add mapping layer or unify naming

### 7.15 Move runtime constants out of type files
- `RANGED_STYLE_BONUSES` / `MAGIC_STYLE_BONUSES` in `types/game/combat-types.ts` → move to `constants/`
- `PlayerMigration` class in `types/entities/player-types.ts` → move to `utils/` or `data/`
- `DUEL_CHALLENGE_TIMEOUT_MS` in `types/game/duel-types.ts` → move to `constants/`

### 7.16 Fix CombatRequestValidator Node.js import in shared package
- **File:** `packages/shared/src/systems/shared/combat/CombatRequestValidator.ts:14`
- **Bug:** `import { createHmac } from "crypto"` in shared package breaks browser bundles
- **Fix:** Since the file is intentionally unused, either move to server package only or delete entirely

---

## Estimated Impact by Category

| Category | Current | Ph1 | Ph2 | Ph3 | Ph4 | Ph5 | Ph6 | Ph7 |
|----------|---------|-----|-----|-----|-----|-----|-----|-----|
| OSRS Accuracy | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 9.0 | 9.0 | 9.5 |
| Security | 8.0 | 8.5 | 8.5 | 8.5 | 8.5 | 9.5 | 9.5 | 9.5 |
| SOLID / Architecture | 6.5 | 6.5 | 7.0 | 7.0 | 7.5 | 7.5 | 8.5 | 9.5 |
| Clean Code | 7.0 | 7.0 | 7.5 | 7.5 | 9.0 | 9.0 | 9.5 | 9.5 |
| Performance | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 9.5 |
| Type Safety | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 9.5 | 9.5 |
| Error Handling | 7.0 | 8.5 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.5 |
| Memory Safety | 6.5 | 7.0 | 9.0 | 9.5 | 9.5 | 9.5 | 9.5 | 9.5 |
| Test Coverage | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 9.0 | 9.0 | 9.5 |
| **Overall** | **~7.2** | **~7.8** | **~8.2** | **~8.5** | **~8.8** | **~9.0** | **~9.2** | **~9.5** |

---

## Verification

After each phase:
```bash
# Type check
npx tsc --noEmit

# Run all combat tests
npx vitest run packages/shared/src/systems/shared/combat/__tests__/ --reporter=verbose

# Run full shared test suite
npm test --workspace=@hyperscape/shared

# Grep for remaining console.log/warn/error (after Phase 4)
grep -rn "console\.\(log\|warn\|error\)" packages/shared/src/systems/shared/combat/ --include="*.ts" | grep -v "__tests__" | grep -v "node_modules"

# Grep for remaining `any` types
grep -rn ": any" packages/shared/src/systems/shared/combat/ --include="*.ts" | grep -v "__tests__" | grep -v "node_modules"
```

---

## Total Steps: 72 across 7 phases
- Phase 1: 10 items (crash bugs)
- Phase 2: 8 items (memory leaks)
- Phase 3: 7 items (race conditions)
- Phase 4: 7 items (logging & dead code)
- Phase 5: 8 items (security)
- Phase 6: 13 items (type system)
- Phase 7: 16 items (architecture & performance)

---

## Notes

- Each phase should be its own PR for reviewability
- Phase 6 (type system) is the highest-effort phase — touching type definitions affects many consumers
- Phase 7.10 (data externalization) may require coordination with content/design team
- Tests should be added alongside fixes, especially for Phases 1-3
- The previous V1 remediation work (6 phases, now merged) does NOT need to be redone — those fixes are solid
