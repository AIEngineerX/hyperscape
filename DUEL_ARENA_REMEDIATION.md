# Duel Arena Remediation Plan

**Goal**: Bring every audit category to a minimum 9/10 rating.
**Current Overall**: 6.8/10 | **Target**: 9.0+/10

---

## Current Scores & Targets

| # | Category | Current | Target | Gap |
|---|----------|---------|--------|-----|
| 1 | SOLID / GRASP / Clean Code | 6.3 | 9.0 | +2.7 |
| 2 | OWASP / CWE / Security | 8.0 | 9.0 | +1.0 |
| 3 | Economic Integrity / PostgreSQL | 6.7 | 9.0 | +2.3 |
| 4 | Network / Server Authority | 7.3 | 9.0 | +1.7 |
| 5 | Performance / Memory | 7.25 | 9.0 | +1.75 |
| 6 | TypeScript Rigor / Type Safety | 5.0 | 9.0 | +4.0 |
| 7 | Client UI / Game Patterns | 8.0 | 9.0 | +1.0 |
| 8 | Testing / Data Architecture | 5.5 | 9.0 | +3.5 |

---

## Phase 1 — Critical (Blocks Everything Else)

### 1.1 Fix `pool.query()` Transaction Safety
**Category**: Economic Integrity (6.7 -> 8.5)
**File**: `packages/server/src/systems/ServerNetwork/index.ts` (lines 3474-3667)

**Problem**: `pool.query("BEGIN")` / `pool.query("COMMIT")` may acquire different connections from the pool, silently breaking transaction atomicity on stake transfers.

**Fix**:
```typescript
// BEFORE (broken)
await pool.query("BEGIN");
// ... queries ...
await pool.query("COMMIT");

// AFTER (correct)
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // ... all queries use `client.query()` ...
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

**Scope**: `executeDuelStakeTransfer()` method only.

---

### 1.2 Enforce `MAX_STAKES_PER_PLAYER`
**Category**: Security (8.0 -> 8.5), Testing (5.5 -> 6.0)
**File**: `packages/server/src/systems/DuelSystem/index.ts`, `addStake()` (~line 679)

**Problem**: `MAX_STAKES_PER_PLAYER = 28` is defined in `config.ts` but never checked.

**Fix**: Add guard at the top of `addStake()`:
```typescript
if (stakes.length >= MAX_STAKES_PER_PLAYER) {
  return { success: false, error: "Maximum stakes reached.", errorCode: DuelErrorCode.INVALID_QUANTITY };
}
```

**Test**: Add unit test for exceeding 28 stakes.

---

### 1.3 Validate `quantity` and `stakeIndex` as Positive Integers
**Category**: Security (8.0 -> 8.5)
**File**: `packages/server/src/systems/DuelSystem/index.ts`

**Problem**: `quantity` accepted as float/NaN, `stakeIndex: NaN` silently passes bounds check.

**Fix** in `addStake()`:
```typescript
if (!Number.isInteger(quantity) || quantity <= 0) {
  return { success: false, error: "Invalid quantity.", errorCode: DuelErrorCode.INVALID_QUANTITY };
}
```

**Fix** in `removeStake()`:
```typescript
if (!Number.isInteger(stakeIndex) || stakeIndex < 0 || stakeIndex >= stakes.length) {
  return { success: false, error: "Invalid stake index.", errorCode: DuelErrorCode.STAKE_NOT_FOUND };
}
```

---

### 1.4 Server-Side Stake Value Lookup
**Category**: Security (8.5 -> 9.0)
**File**: `packages/server/src/systems/DuelSystem/index.ts`, `addStake()`

**Problem**: `value` field is whatever the client sends. Opponent sees unverified stake values during negotiation.

**Fix**: Look up item value from the server's item database during `addStake()` instead of trusting client-provided `value`. Use `DataManager.getItem(itemId)?.value ?? 0` or the equivalent item pricing system.

---

## Phase 2 — TypeScript Rigor (5.0 -> 9.0)

### 2.1 Reconcile `DuelSession` Types
**File**: `packages/server/src/systems/DuelSystem/DuelSessionManager.ts`

**Problem**: Server `DuelSession` and shared `DuelSession` are structurally incompatible with the same name.

**Fix**:
- Rename server's interface to `ServerDuelSession` in `DuelSessionManager.ts`
- Add a `toClientSession(session: ServerDuelSession): DuelSession` serialization method that maps the flat server structure to the shared `DuelSession` shape with `DuelParticipant` objects
- Use `ServerDuelSession` throughout the server; only convert when sending to client

---

### 2.2 Unify `EquipmentRestrictions` (5 Definitions -> 1)
**Files**:
- `packages/shared/src/types/game/duel-types.ts` (canonical)
- `packages/server/src/systems/DuelSystem/DuelSessionManager.ts`
- `packages/client/src/game/panels/DuelPanel/DuelPanel.tsx`
- `packages/client/src/game/panels/DuelPanel/RulesScreen.tsx`
- `packages/client/src/game/panels/DuelPanel/ConfirmScreen.tsx`

**Fix**: Choose one representation (boolean map is more ergonomic for toggles), update the shared type to use it, delete all local definitions, import from `@hyperscape/shared` everywhere.

---

### 2.3 Add Duel Events to Shared `EventMap`
**Files**:
- `packages/shared/src/types/events/event-payloads.ts`
- `packages/shared/src/types/game/duel-types.ts`

**Fix**:
1. Define a `DuelEventPayloads` interface mapping every `duel:*` event name to its payload type
2. Extend the shared `EventMap` interface with these entries
3. All `world.emit("duel:*", ...)` calls will then be compile-time checked

```typescript
// In duel-types.ts
export interface DuelEventMap {
  "duel:challenge:created": { challengeId: string; challengerId: string; targetId: string };
  "duel:countdown:tick": { duelId: string; count: number };
  "duel:stakes:settle": { playerId: string; duelId: string; /* ... */ };
  "duel:completed": DuelCompletedPayload;
  // ... all 20+ events
}

// In event-payloads.ts
interface EventMap extends DuelEventMap {
  // existing events...
}
```

---

### 2.4 Create Shared System Interfaces for Cross-System Access
**File**: New file `packages/shared/src/types/systems/system-interfaces.ts`

**Problem**: Ad-hoc inline `as` casts for prayer, inventory, and stamina access duplicated across files.

**Fix**: Define shared interfaces:
```typescript
export interface IPrayerSystem {
  restorePrayerPoints(playerId: string, amount: number): void;
  getMaxPrayerPoints(playerId: string): number;
}

export interface IInventorySystem {
  getInventoryData(id: string): { items: Array<{ slot: number; itemId: string; quantity: number }> };
}
```

Replace all inline `as` casts with imports of these interfaces. Wire `World.getSystem()` to return typed systems via a system registry type.

---

### 2.5 Eliminate `as unknown as` Double Assertion
**File**: `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts` (line 439)

**Problem**: `(playerEntity as unknown as { playerData?: { stamina?: { max: number } } })` bypasses all type checking.

**Fix**: Add a `getMaxStamina(): number` public method to `PlayerEntity`, then call it directly:
```typescript
playerEntity.setStamina(playerEntity.getMaxStamina());
```

---

### 2.6 Use Branded `PlayerID` in Server DuelSession
**File**: `packages/server/src/systems/DuelSystem/DuelSessionManager.ts`

**Fix**: Change `challengerId: string` / `targetId: string` to `challengerId: PlayerID` / `targetId: PlayerID` in the server's `ServerDuelSession` interface. Update all DuelSystem public methods to accept `PlayerID` instead of plain `string`.

---

### 2.7 Remove Unused Import and Dead Code
**Files**:
- `packages/server/src/systems/DuelSystem/index.ts` — remove unused `DeathState` import
- `packages/server/src/systems/DuelSystem/config.ts` — remove stale `ARENA_COUNT`, `ARENA_BASE_X`, `ARENA_BASE_Z`, `ARENA_WIDTH`, `ARENA_LENGTH`, `ARENA_GAP_X`, `ARENA_GAP_Z`, `SPAWN_OFFSET_Z` constants (dead code, replaced by manifest)
- `packages/server/src/systems/DuelSystem/config.ts` — remove duplicate `DuelState` array (already imported from shared)

---

### 2.8 Add Runtime Validation in Network Handlers
**Files**: `packages/server/src/systems/ServerNetwork/handlers/duel/*.ts`

**Problem**: Handler payloads cast with `as` without runtime type guards.

**Fix**: Add validation functions (like `validation.ts` already does for `EntityDeathPayload`) for every client->server message type. Reject malformed payloads with `DuelErrorCode.SERVER_ERROR` before processing.

---

### 2.9 Enable `noImplicitAny: true`
**Files**:
- `packages/server/tsconfig.json` — remove `"noImplicitAny": false` (line 29)
- `packages/shared/tsconfig.json` — remove `"noImplicitAny": false` (line 22)

**Note**: This will surface implicit `any` errors across the entire codebase, not just duel code. May require a separate PR and broader fix pass. If project-wide is too large, at minimum add `// @ts-check` or per-file `noImplicitAny` via `tsconfig` path overrides for all `DuelSystem/` files.

---

### 2.10 Add `readonly` to Immutable Session Fields
**File**: `packages/server/src/systems/DuelSystem/DuelSessionManager.ts`

**Fix**:
```typescript
export interface ServerDuelSession {
  readonly duelId: string;
  readonly challengerId: PlayerID;
  readonly challengerName: string;
  readonly targetId: PlayerID;
  readonly targetName: string;
  readonly createdAt: number;
  // ... mutable fields remain without readonly
  state: DuelState;
  winnerId?: PlayerID;
  // ...
}
```

---

### 2.11 Consistent `markNetworkDirty` Access
**File**: `packages/server/src/systems/DuelSystem/index.ts` (line 1302)

**Problem**: Uses `"markNetworkDirty" in playerEntity` + cast, while `DuelCombatResolver.ts:458` calls it directly.

**Fix**: Call `playerEntity.markNetworkDirty()` directly (method exists on `PlayerEntity`). Remove the `in` check and cast.

---

## Phase 3 — SOLID / Architecture (6.3 -> 9.0)

### 3.1 Extract Participant Role Helper
**File**: `packages/server/src/systems/DuelSystem/DuelSessionManager.ts`

**Problem**: `winnerId === session.challengerId` pattern repeated 10+ times.

**Fix**:
```typescript
getParticipantRole(session: ServerDuelSession, playerId: string): "challenger" | "target" | null {
  if (playerId === session.challengerId) return "challenger";
  if (playerId === session.targetId) return "target";
  return null;
}

getStakes(session: ServerDuelSession, role: "challenger" | "target"): StakedItem[] {
  return role === "challenger" ? session.challengerStakes : session.targetStakes;
}

getName(session: ServerDuelSession, role: "challenger" | "target"): string {
  return role === "challenger" ? session.challengerName : session.targetName;
}
```

Use these helpers throughout `DuelSystem` and `DuelCombatResolver`.

---

### 3.2 Extract `DuelPlayerStateManager`
**Files**: New file `packages/server/src/systems/DuelSystem/DuelPlayerStateManager.ts`

**Problem**: `DuelCombatResolver` mixes combat resolution with health restoration and teleportation.

**Fix**: Move `restorePlayerHealth()` and `teleportToLobby()` into a new `DuelPlayerStateManager` class. `DuelCombatResolver.resolveDuel()` calls it after resolving stakes.

```typescript
export class DuelPlayerStateManager {
  constructor(private world: World) {}
  restoreAndTeleport(playerId: string, isWinner: boolean): void { /* moved logic */ }
}
```

---

### 3.3 Extract Stake Validation into `DuelStakeValidator`
**Files**: New file `packages/server/src/systems/DuelSystem/DuelStakeValidator.ts`

**Problem**: Stake validation logic (duplicate slot check, quantity validation, max stakes, server-side item lookup) is embedded in the 1683-line `index.ts`.

**Fix**: Move stake validation into a focused class:
```typescript
export class DuelStakeValidator {
  validateAddStake(session, playerId, inventorySlot, itemId, quantity): StakeValidationResult { }
  validateRemoveStake(session, playerId, stakeIndex): StakeValidationResult { }
}
```

---

### 3.4 Extract Rule Validation into `DuelRuleValidator`
**Files**: New file `packages/server/src/systems/DuelSystem/DuelRuleValidator.ts`

**Problem**: Rule toggle validation, equipment restriction validation, and `canUseX()` methods add ~150 lines to `index.ts`.

**Fix**: Move into focused class. `DuelSystem` delegates to it.

---

### 3.5 Consolidate Challenge Timeout to Single Source
**Files**:
- `packages/server/src/systems/DuelSystem/config.ts` (line 22)
- `packages/shared/src/data/duel-manifest.ts` (line 14)

**Problem**: `CHALLENGE_TIMEOUT_TICKS = 50` and `DUEL_CHALLENGE_TIMEOUT_MS = 30000` define the same value in different units.

**Fix**: Derive one from the other:
```typescript
// config.ts
export const CHALLENGE_TIMEOUT_TICKS = Math.ceil(DUEL_CHALLENGE_TIMEOUT_MS / TICK_DURATION_MS);
```

---

## Phase 4 — Economic Integrity (6.7 -> 9.0)

### 4.1 Persist Idempotency Guard to Database
**File**: `packages/server/src/systems/ServerNetwork/index.ts`

**Problem**: `processedDuelSettlements` Set is in-memory only — lost on server restart.

**Fix**: Create a `duel_settlements` table:
```sql
CREATE TABLE IF NOT EXISTS duel_settlements (
  duel_id TEXT PRIMARY KEY,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  winner_id TEXT NOT NULL,
  loser_id TEXT NOT NULL
);
```

Check/insert inside the settlement transaction (same DB connection):
```typescript
const existing = await client.query("SELECT 1 FROM duel_settlements WHERE duel_id = $1", [duelId]);
if (existing.rows.length > 0) {
  await client.query("ROLLBACK");
  return; // Already settled
}
await client.query("INSERT INTO duel_settlements (duel_id, winner_id, loser_id) VALUES ($1, $2, $3)", [duelId, winnerId, loserId]);
```

---

### 4.2 Wrap `SELECT FOR UPDATE` in Transaction
**File**: `packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts`

**Problem**: TOCTOU — `SELECT FOR UPDATE` outside explicit transaction, lock released immediately.

**Fix**: Wrap the inventory check in an explicit transaction using a dedicated client from the pool.

---

### 4.3 Add DB Constraints
**File**: Database migration

**Fix**:
```sql
ALTER TABLE player_inventory ADD CONSTRAINT chk_quantity CHECK (quantity > 0);
ALTER TABLE player_inventory ADD CONSTRAINT chk_slot CHECK (slot BETWEEN 0 AND 27);
```

---

### 4.4 Persist Audit Logs to Database
**File**: `packages/server/src/systems/ServerNetwork/services/AuditLogger.ts`

**Problem**: Audit logs only go to stdout.

**Fix**: Add a `duel_audit_log` table and write structured audit events to it alongside stdout logging.

---

## Phase 5 — Network / Server Authority (7.3 -> 9.0)

### 5.1 Standardize Timing to Tick-Based
**File**: `packages/server/src/systems/DuelSystem/index.ts`, `processCountdown()`

**Problem**: Countdown uses `Date.now()` while all other timeouts use tick counts.

**Fix**: Convert countdown to tick-based. Store `countdownStartTick` instead of `countdownStartedAt`. Derive countdown number from elapsed ticks.

---

### 5.2 Add Grace Period for Setup-Phase Disconnects
**File**: `packages/server/src/systems/DuelSystem/index.ts`, `handleDisconnect()`

**Problem**: Disconnect during RULES/STAKES/CONFIRMING immediately cancels with no grace.

**Fix**: Use a shorter grace period (10-15 ticks / ~1.5-2.5 seconds) for setup phases. If the player reconnects within the window, resume the session.

---

### 5.3 Send Rate-Limit Feedback to Client
**File**: `packages/server/src/systems/ServerNetwork/handlers/duel/*.ts`

**Problem**: Rate-limited messages silently dropped.

**Fix**: When rate-limited, emit a `duel:error` event to the player with `DuelErrorCode.SERVER_ERROR` and message "Too many requests, please slow down."

---

### 5.4 Add Rate Limiting to Rule/Equipment Toggle Handlers
**Files**: `packages/server/src/systems/ServerNetwork/handlers/duel/rules.ts`

**Problem**: Rule and equipment toggle handlers have no rate limiting.

**Fix**: Apply the same `IntervalRateLimiter` (50ms) used by other duel handlers.

---

## Phase 6 — Performance / Memory (7.25 -> 9.0)

### 6.1 Remove World Event Listeners in `destroy()`
**File**: `packages/server/src/systems/DuelSystem/index.ts`

**Problem**: `init()` registers listeners via `this.world.on(...)` but `destroy()` never removes them.

**Fix**: Store listener references in the constructor, remove them in `destroy()`:
```typescript
private readonly listeners: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

init() {
  const onEntityDeath = (payload: unknown) => { /* ... */ };
  this.world.on(EventType.ENTITY_DEATH, onEntityDeath);
  this.listeners.push({ event: EventType.ENTITY_DEATH, fn: onEntityDeath });
  // ... repeat for all listeners
}

destroy() {
  for (const { event, fn } of this.listeners) {
    this.world.off(event, fn);
  }
  this.listeners.length = 0;
  // ... existing cleanup
}
```

---

### 6.2 Add Periodic Cleanup for `challengeCooldowns`
**File**: `packages/server/src/systems/DuelSystem/PendingDuelManager.ts`

**Problem**: `challengeCooldowns` Map grows unbounded.

**Fix**: In the existing `cleanupExpiredChallenges()` interval (runs every 10s), also prune expired cooldowns:
```typescript
const now = Date.now();
for (const [key, expiry] of this.challengeCooldowns) {
  if (now > expiry) this.challengeCooldowns.delete(key);
}
```

---

### 6.3 Cache `stakedSlots` Set on Session
**File**: `packages/server/src/systems/DuelSystem/index.ts`

**Problem**: `getStakedSlots()` allocates a new Set with `flatMap` on every call.

**Fix**: Maintain a cached `Set<number>` per participant on the session. Update it in `addStake()` and `removeStake()` instead of recomputing.

---

## Phase 7 — Client UI / Game Patterns (8.0 -> 9.0)

### 7.1 Memoize Inline Stake Value Calculations
**File**: `packages/client/src/game/interface/InterfaceModals.tsx` (lines 1006-1013)

**Fix**: Move the `reduce()` calls into the `useModalPanels` hook and return pre-computed values, or wrap in `useMemo`.

---

### 7.2 Add Error State UI to Duel Panel
**File**: `packages/client/src/game/panels/DuelPanel/DuelPanel.tsx`

**Problem**: No explicit error display in the duel panel.

**Fix**: Add a dismissible error banner component that shows when `duel:error` events arrive. Auto-dismiss after 3 seconds.

---

### 7.3 Keyboard Focus Trapping During Duel Setup
**File**: `packages/client/src/game/panels/DuelPanel/DuelPanel.tsx`

**Fix**: When the duel panel is open, suppress game hotkeys by calling `inputManager.pushContext("duel")` (or equivalent) to prevent opening inventory/skills/etc. Release on panel close.

---

## Phase 8 — Testing (5.0 -> 9.0)

### 8.1 Add E2E Playwright Tests
**File**: New file `packages/server/src/systems/DuelSystem/__tests__/DuelSystem.e2e.ts`

**Required scenarios** (per project testing mandate):
1. Complete duel flow: challenge -> accept -> rules -> stakes -> confirm -> countdown -> fight -> death -> resolution
2. Forfeit during combat
3. Disconnect during FIGHTING with reconnect within grace period
4. Disconnect during setup (immediate cancel)
5. Stake display matches between both players
6. Anti-scam: acceptance resets on stake modification
7. Rule validation: reject all-attack-types-disabled
8. Arena pool exhaustion with 7th concurrent duel attempt

---

### 8.2 Add Missing Unit Tests
**File**: `packages/server/src/systems/DuelSystem/__tests__/DuelSystem.test.ts`

**Tests to add**:
- `handlePlayerDeath` via `ENTITY_DEATH` event emission through world
- `verifyStakesInMemory` — mock inventory with missing/changed items
- Cross-duel action prevention for `toggleEquipmentRestriction`, `addStake`, `removeStake`, `acceptStakes`, `acceptFinal`
- `MAX_STAKES_PER_PLAYER` enforcement
- `quantity` validation (NaN, float, negative, zero)
- `stakeIndex` validation (NaN, float)
- All `canUseX()` methods (`canUseMagic`, `canUseSpecialAttack`, `canUsePrayer`, `canUsePotions`, `canForfeit`)
- `getStakedSlots()`, `getArenaSpawnPoints()`, `getArenaBounds()`, `getPlayerDuelRules()`
- Invalid rule combinations: `noForfeit + funWeapons`, `noMelee + noRanged + noMagic`
- Disconnect during RULES, STAKES, CONFIRMING, COUNTDOWN (each individually)
- `startDuelCountdown()` tick-based progression

---

### 8.3 Add Integration Tests
**File**: New file `packages/server/src/systems/DuelSystem/__tests__/DuelSystem.integration.ts`

**Tests to add**:
- DuelSystem + CombatSystem: rule enforcement blocks restricted attack types
- DuelSystem + InventorySystem: stake settlement moves items correctly
- DuelSystem + PlayerDeathSystem: death event chain triggers resolution
- DuelSystem + ServerNetwork: WebSocket message round-trip for full duel flow

---

### 8.4 Remove Stale Arena Constants
**File**: `packages/server/src/systems/DuelSystem/config.ts`

**Fix**: Delete lines 80-113 (`ARENA_COUNT`, `ARENA_BASE_X`, etc.) — these are dead code superseded by manifest-driven `getDuelArenaConfig()`.

---

## Phase 9 — Data Architecture (6.0 -> 9.0)

### 9.1 Add Schema Validation for Manifests
**File**: `packages/shared/src/data/duel-manifest.ts`

**Fix**: Add runtime schema validation for `getDuelArenaConfig()` return value. Use a lightweight validator (or manual checks) since the project doesn't use Zod:
```typescript
function validateArenaConfig(config: unknown): ArenaConfig {
  // Validate shape, throw on invalid data
}
```

---

### 9.2 Extract Error Messages to Constants
**File**: New file `packages/server/src/systems/DuelSystem/error-messages.ts`

**Fix**: Move all inline error strings to a single constants file:
```typescript
export const DUEL_ERRORS = {
  SELF_CHALLENGE: "You can't challenge yourself to a duel.",
  ALREADY_IN_DUEL: "You're already in a duel.",
  TARGET_IN_DUEL: "That player is already in a duel.",
  INVALID_STATE_RULES: "Cannot modify rules at this stage.",
  // ...
} as const;
```

---

### 9.3 Consolidate Equipment Slot Source of Truth
**File**: `packages/shared/src/data/duel-manifest.ts`

**Fix**: Derive the `EquipmentRestrictions` type from `EQUIPMENT_SLOT_DEFINITIONS` so adding a slot only requires one change:
```typescript
export type EquipmentSlotKey = keyof typeof EQUIPMENT_SLOT_DEFINITIONS;
export type EquipmentRestrictions = Record<EquipmentSlotKey, boolean>;
```

Delete all local definitions in `DuelSessionManager.ts`, `DuelPanel.tsx`, `RulesScreen.tsx`, `ConfirmScreen.tsx`.

---

## Implementation Order

Execute in dependency order — later phases build on earlier ones:

```
Phase 1 (Critical)          ~1 day    — Transaction safety, stake limits, input validation
    |
Phase 2 (TypeScript)        ~2 days   — Type reconciliation, EventMap, system interfaces
    |
Phase 3 (SOLID)             ~1.5 days — Extract helpers, validators, state manager
    |
Phase 4 (Economic)          ~1 day    — DB idempotency, constraints, audit persistence
    |
Phase 5 (Network)           ~0.5 day  — Tick-based countdown, rate limiting, grace periods
    |
Phase 6 (Performance)       ~0.5 day  — Listener cleanup, cooldown pruning, Set caching
    |
Phase 7 (Client UI)         ~0.5 day  — Memoization, error UI, focus trapping
    |
Phase 8 (Testing)           ~2 days   — E2E tests, missing unit tests, integration tests
    |
Phase 9 (Data Architecture) ~0.5 day  — Schema validation, error constants, slot consolidation
```

**Total estimated work**: ~9.5 days

---

## Verification Checklist

After all phases, re-audit against these criteria:

- [ ] `pool.connect()` used for all transactions (no `pool.query("BEGIN")`)
- [ ] `MAX_STAKES_PER_PLAYER` enforced in `addStake()`
- [ ] `quantity` and `stakeIndex` validated as positive integers
- [ ] Stake values looked up server-side, not from client
- [ ] Server `DuelSession` renamed to `ServerDuelSession`
- [ ] `EquipmentRestrictions` has exactly 1 definition (shared)
- [ ] All `duel:*` events in shared `EventMap` with typed payloads
- [ ] No `as unknown as` assertions in duel code
- [ ] No ad-hoc inline system type casts (use shared interfaces)
- [ ] `noImplicitAny: true` enabled (or duel files covered)
- [ ] Branded `PlayerID` used in `ServerDuelSession`
- [ ] `DuelSystem/index.ts` under 1000 lines
- [ ] `destroy()` removes all world event listeners
- [ ] `challengeCooldowns` pruned periodically
- [ ] `stakedSlots` cached, not recomputed
- [ ] Countdown uses tick-based timing (no `Date.now()`)
- [ ] Rate limiting on rule/equipment toggle handlers
- [ ] Setup-phase disconnect has grace period
- [ ] Idempotency key persisted to DB
- [ ] `SELECT FOR UPDATE` wrapped in transaction
- [ ] DB constraints on `quantity` and `slot`
- [ ] Audit logs written to database
- [ ] Error UI in duel panel
- [ ] Keyboard focus trapped during duel setup
- [ ] Inline stake value calculations memoized
- [ ] E2E Playwright tests for full duel flow
- [ ] Unit tests for all untested public methods
- [ ] Integration tests for cross-system interactions
- [ ] Dead arena constants removed from `config.ts`
- [ ] Unused `DeathState` import removed
- [ ] Error messages extracted to constants file
- [ ] Schema validation on manifest data
- [ ] Challenge timeout derived from single source
