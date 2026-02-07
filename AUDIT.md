# Hyperscape Production Readiness Audit

**Date:** 2026-02-06
**Branch:** `fix/combat-system-remediation`
**Auditor:** Claude Code (Opus 4.6)
**Overall Score: 6.6 / 10**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Score Overview](#score-overview)
3. [Production Quality Code](#1-production-quality-code)
4. [TypeScript Rigor](#2-typescript-rigor)
5. [Clean Code & Law of Demeter](#3-clean-code--law-of-demeter)
6. [OWASP Security](#4-owasp-security)
7. [CWE Top 25](#5-cwe-top-25)
8. [Anti-Cheat & Exploit Prevention](#6-anti-cheat--exploit-prevention)
9. [SOLID Principles](#7-solid-principles)
10. [GRASP Principles](#8-grasp-principles)
11. [Code Organization](#9-code-organization)
12. [Best Practices (DRY/KISS/YAGNI)](#10-best-practices)
13. [Memory & Allocation Hygiene](#11-memory--allocation-hygiene)
14. [Data-Oriented Design](#12-data-oriented-design)
15. [Game Programming Patterns](#13-game-programming-patterns)
16. [Tick System & Timing](#14-tick-system--timing)
17. [Persistence & Database](#15-persistence--database)
18. [PostgreSQL Discipline](#16-postgresql-discipline)
19. [Economic Integrity](#17-economic-integrity)
20. [Server Authority](#18-server-authority)
21. [Client Responsiveness](#19-client-responsiveness)
22. [Network Resilience & Distributed Systems](#20-network-resilience--distributed-systems)
23. [ECS Discipline](#21-ecs-discipline)
24. [AI & NPC Behavior](#22-ai--npc-behavior)
25. [Rendering & GPU Hygiene](#23-rendering--gpu-hygiene)
26. [UI Framework Integration](#24-ui-framework-integration)
27. [Manifest-Driven Data Architecture](#25-manifest-driven-data-architecture)
28. [Implementation Plan to 9.5/10](#implementation-plan-to-reach-9510)

---

## Executive Summary

Hyperscape is an ambitious MMORPG built on a custom 3D engine with OSRS-style gameplay. The codebase demonstrates **strong server authority**, **excellent tick-system design**, and **mature combat architecture**. The recent combat refactor (handler extraction, damage calculators, anti-cheat) shows a team actively improving quality.

**Key Strengths:**
- Tick system is OSRS-accurate with deterministic phase ordering (9/10)
- Anti-cheat and rate limiting are comprehensive and multi-layered (9/10)
- Transaction atomicity for economic operations is excellent (9/10)
- Manifest-driven data with 37 JSON manifests, validation, and normalization (8/10)
- AI state machines with OSRS-accurate aggro mechanics (8/10)

**Critical Gaps:**
- Package discipline: 30 client/server-only files live in the shared package (5/10)
- TypeScript rigor: `noImplicitAny: false` in shared and server packages (5/10)
- Persistence: 8 of 17 skills COMPLETELY MISSING from both save paths, no XP saved on disconnect, prayer points lost, WAL dead code (4/10)
- Combat logout timer: exists (`canLogout()`) but NOT enforced — players can disconnect mid-combat (4/10)
- Client responsiveness: No optimistic updates or shadow state (4/10)
- Distributed systems: No interest management or delta compression (4/10)

---

## Score Overview

| # | Area | Score | Priority |
|---|------|-------|----------|
| 1 | Production Quality Code | 7/10 | Medium |
| 2 | TypeScript Rigor | 5/10 | **Critical** |
| 3 | Clean Code & Law of Demeter | 7/10 | Medium |
| 4 | OWASP Security | 7.5/10 | High |
| 5 | CWE Top 25 | 7.5/10 | High |
| 6 | Anti-Cheat & Exploit Prevention | 8.5/10 | Low |
| 7 | SOLID Principles | 6.5/10 | High |
| 8 | GRASP Principles | 7.5/10 | Medium |
| 9 | Code Organization | 6.5/10 | **Critical** |
| 10 | Best Practices (DRY/KISS/YAGNI) | 6.5/10 | High |
| 11 | Memory & Allocation Hygiene | 7/10 | High |
| 12 | Data-Oriented Design | 5/10 | Medium |
| 13 | Game Programming Patterns | 8/10 | Medium |
| 14 | Tick System & Timing | 9/10 | Low |
| 15 | Persistence & Database | 4/10 | **Critical** |
| 16 | PostgreSQL Discipline | 6/10 | High |
| 17 | Economic Integrity | 7/10 | Medium |
| 18 | Server Authority | 8/10 | Medium |
| 19 | Client Responsiveness | 4/10 | High |
| 20 | Network Resilience & Distributed Systems | 4.5/10 | **Critical** |
| 21 | ECS Discipline | 5/10 | High |
| 22 | AI & NPC Behavior | 8/10 | Medium |
| 23 | Rendering & GPU Hygiene | 7/10 | Medium |
| 24 | UI Framework Integration | 7/10 | Low |
| 25 | Manifest-Driven Data | 8/10 | Medium |

**Weighted Overall: 6.6/10**

---

## 1. Production Quality Code

**Score: 7/10** | Priority: Medium

### Findings

**Strengths:**
- File-level JSDoc blocks are thorough with purpose, architecture, and usage docs (e.g., `World.ts:1-21`, `CombatSystem.ts` header, `SystemBase.ts:1-79`)
- Constants use clear section headers (`// ============================================================================`) for logical grouping
- Pre-allocated buffers and pools throughout hot paths (`CombatSystem.ts:124-126`, `tile-movement.ts:96-99`)
- OSRS wiki references cited inline for game mechanic accuracy

**Issues:**
- 7 files exceed 2,000 lines: `ClientNetwork.ts` (4,564), `ServerNetwork/index.ts` (4,023), `TerrainSystem.ts` (3,731), `MobEntity.ts` (3,146), `PlayerLocal.ts` (2,771), `CombatSystem.ts` (2,592), `PlayerSystem.ts` (2,346)
- ~20 TODO comments remain in production code, including `Stage.ts:786` (`console.warn("TODO: remove if you dont ever see this")`)
- Some handlers return silently without logging on failure (`ServerNetwork/index.ts:2031-2033`)

### Recommendations
1. Break files >2,000 lines using the handler extraction pattern already applied to combat
2. Resolve TODOs or convert to tracked issues
3. Add structured logging for silent early-return paths in handlers

---

## 2. TypeScript Rigor

**Score: 5/10** | Priority: Critical

### Findings

**Strengths:**
- Client package has `"noImplicitAny": true` properly enforced
- 127 `readonly` usages across shared package (good adoption in newer code)
- Shared types between client/server via `@hyperscape/shared` imports
- `typeGuards.ts` with 20+ type guard functions

**Issues:**
- `packages/shared/tsconfig.json:22`: `"noImplicitAny": false` — undermines `"strict": true`
- `packages/server/tsconfig.json:29`: `"noImplicitAny": false` — same issue
- 41 explicit `any` usages in shared, 11 in server (with ESLint suppressions)
- 30+ `as unknown as` type assertion chains in shared and server
- `ServerNetwork/index.ts` has 15+ inline `event as { ... }` structural type assertions for event payloads
- `ServerNetwork/index.ts:548-549,566-569,577-578` casts `this.world as {...}` to attach properties, circumventing the World type
- Only 1 `const enum` in entire codebase (`NPCFlag`); all other enums generate runtime objects
- Exhaustive `assertNever` pattern used in only ~8 locations

### Recommendations
1. **P0:** Enable `noImplicitAny: true` in shared and server tsconfigs
2. **P0:** Define typed event payload interfaces in shared package; replace inline `as { ... }` casts
3. **P1:** Create typed `SystemRegistry` to replace `getSystem()` string-based lookups with `as unknown as` casts
4. **P1:** Convert high-traffic enums (`EventType`, `AttackType`) to `const enum`
5. **P2:** Extend World type properly instead of casting `this.world as {...}` to attach properties

---

## 3. Clean Code & Law of Demeter

**Score: 7/10** | Priority: Medium

### Findings

**Strengths:**
- System, manager, and handler names are clear and descriptive (`PendingAttackManager`, `CombatRotationManager`, `MovementInputValidator`)
- Event naming follows clear namespace convention: `EventType.COMBAT_ATTACK_REQUEST`
- `_` prefix convention for pre-allocated buffers signals internal/pool objects
- CombatSystem demonstrates excellent decomposition into services
- No 5-level property chains in server code

**Issues:**
- "Cancel all pending actions" sequence duplicated 3+ times in `ServerNetwork/index.ts:1948-1965, 1978-1993`
- `assertNever` defined independently in 3 locations instead of shared
- `ServerNetwork/index.ts initializeManagers()` spans 800+ lines mixing multiple abstraction levels
- `World.ts` encourages Law of Demeter violations by exposing deep internal structure
- `ServerNetwork/index.ts:462-473` reaches through entities with inline structural type casts

### Recommendations
1. Extract `cancelAllPendingActions(playerId)` method to DRY up duplicated sequences
2. Move `assertNever` to shared package
3. Split `initializeManagers()` into focused setup methods per domain
4. Create typed accessor methods on entities instead of exposing raw property bags

---

## 4. OWASP Security

**Score: 7.5/10** | Priority: High

### Findings

**Strengths:**
- All SQL uses Drizzle ORM parameterized queries or `sql` tagged template literals — zero raw string concatenation found (Injection: 8/10)
- Multi-layered rate limiting: HTTP (Fastify plugin, 4 tiers), WebSocket (SlidingWindowRateLimiter, 16+ limiters), Transaction (IntervalRateLimiter), Combat (CombatRateLimiter) (Rate Limiting: 9/10)
- `AuditLogger` provides structured JSON logging with `[AUDIT]` prefix (Logging: 8/10)
- Path traversal prevented: `EntityIdValidator.ts:65` checks for `..`, `/`, `\`; file uploads use SHA-256 content-addressable naming (Path Traversal: 9/10)
- First-message auth pattern prevents token leakage in URLs/logs

**Issues:**
- **JWT tokens never expire**: `utils.ts:90-96` signs without `expiresIn`. Stolen tokens grant permanent access
- **Hardcoded JWT secret fallback**: `utils.ts:68-69` — `"hyperscape-dev-secret-key-12345"` used when `JWT_SECRET` env var is missing
- **Chat handler broadcasts unvalidated client data**: `handlers/chat.ts:16-28` — no sanitization, no `from` field verification, no rate limiting
- **`/name` command allows unrestricted name changes**: `commands.ts:90-108` — no permission check, no sanitization, no length limit
- **`/move` command allows any player to teleport**: `commands.ts:112-162` — no permission check (unlike `/teleport` which requires mod)
- **`ADMIN_CODE` comparison is timing-unsafe**: `commands.ts:62` uses `===` instead of `crypto.timingSafeEqual()`
- **Dev mode auto-admin**: `authentication.ts:364-371` grants `~admin` to ALL users in development mode
- No explicit TLS enforcement in server configuration

### Recommendations
1. **P0:** Add JWT expiration (`expiresIn: '7d'`) and remove hardcoded secret fallback
2. **P0:** Add server-side chat validation: sanitize body, verify `from` matches authenticated player, enforce length limits
3. **P0:** Add permission checks to `/name` and `/move` commands
4. **P1:** Use `crypto.timingSafeEqual()` for `ADMIN_CODE` comparison
5. **P1:** Add safeguard against NODE_ENV misconfiguration for auto-admin
6. **P2:** Document WSS/HTTPS enforcement for production

---

## 5. CWE Top 25

**Score: 7.5/10** | Priority: High

### Findings

**Strengths:**
- TypeScript strict typing eliminates most memory safety concerns (CWE-119, CWE-120)
- NaN/Infinity injection detected as CRITICAL in movement validation (CWE-20)
- Integer overflow protection: `MAX_COINS = 2147483647`, `wouldPriceOverflow()` checks (CWE-190)
- Null byte and control character blocking via `CONTROL_CHAR_REGEX` (CWE-626)
- No `dangerouslySetInnerHTML` usage found (CWE-79)

**Issues:**
- Server-side chat lacks sanitization (CWE-79 risk via broadcast to other clients)
- JWT no-expiry (CWE-613: Insufficient Session Expiration)
- Timing-unsafe ADMIN_CODE comparison (CWE-208: Observable Timing Discrepancy)

### Recommendations
Same as OWASP section above

---

## 6. Anti-Cheat & Exploit Prevention

**Score: 8.5/10** | Priority: Low

### Findings

**Strengths:**
- All combat is server-authoritative with `if (!this.world.isServer) return` guards (`CombatSystem.ts:235,248,264,280,287`)
- Damage validated against max-hit formulas with 10% tolerance (`CombatAntiCheat.ts:871-903`)
- XP rate monitoring with sliding windows (`CombatAntiCheat.ts:813-865`)
- Score-based detection: decay rewards good behavior, auto-kick at 50pts, auto-ban at 150pts
- Movement validation: world bounds, anti-teleport (200-tile limit), NaN/Infinity detection
- Position correction broadcast to all clients (`position-validator.ts:166`)
- Melee cooldown claimed BEFORE damage applied (prevents cooldown-skip exploits)
- PvP zone and duel arena boundary enforcement
- Attacker position validated against walkable tiles
- Store transactions use `SELECT FOR UPDATE` row locking

**Issues:**
- No velocity-based movement speed validation (only per-request distance check)
- No bot detection heuristics beyond rate limiting (no click pattern analysis, behavioral entropy)
- Movement anti-cheat is monitoring-only, not blocking (`MovementAntiCheat.ts:8-9`)
- Anti-cheat violation history not persisted to database for cross-session analysis

### Recommendations
1. **P1:** Add velocity-based movement validation (distance per tick)
2. **P2:** Wire movement anti-cheat to auto-kick/ban system
3. **P2:** Persist anti-cheat history to database

---

## 7. SOLID Principles

**Score: 6.5/10** | Priority: High

### Findings

**Single Responsibility (6/10):**
- 7 files exceed 2,000 lines (see Production Quality)
- CombatSystem remains a mega-orchestrator despite extracted handlers
- World.ts serves as both system container AND god-API surface (40+ optional methods at lines 550-776)

**Open/Closed (7/10):**
- `DamageHandler` strategy pattern is textbook OCP
- `CombatAttackContext` interface provides clean extension point
- Weakness: `handleAttack()` uses `switch` on `AttackType` — adding new types requires modification

**Liskov Substitution (8/10):**
- Entity hierarchy (`Entity -> CombatantEntity -> PlayerEntity/MobEntity`) follows LSP well
- Minor: `CombatantEntity.setHealth()` override adds death-triggering logic

**Interface Segregation (7/10):**
- `CombatAttackContext` (16 properties/methods) is well-segregated
- Weakness: `NetworkSystem` interface mixes client and server concerns

**Dependency Inversion (6/10):**
- `CombatAttackContext` interface successfully inverts handler dependencies
- Weakness: 13 `world.getSystem()` service locator calls in CombatSystem.init()
- Duplicate `getSystem("player")` at CombatSystem.ts:2109 despite cached reference

### Recommendations
1. **P1:** Replace `world.getSystem()` service locator with explicit dependency injection
2. **P1:** Extract CombatSystem tick processing into `CombatTickProcessor`
3. **P1:** Extract CombatSystem lifecycle into `CombatLifecycleManager`
4. **P2:** Implement `AttackHandler` registry to replace `switch` on `AttackType`

---

## 8. GRASP Principles

**Score: 7.5/10** | Priority: Medium

### Findings

**Strengths:**
- Pure Fabrication (9/10): Excellent service classes — `CombatStateService`, `CombatEntityResolver`, `CombatAnimationManager`, `DamageCalculator`, `ProjectileService`, `PidManager`
- Creator (8/10): Logical ownership — `EntityManager` creates entities, `MobNPCSpawnerSystem` creates mobs
- Controller (8/10): 19 handler files in ServerNetwork properly delegate to domain logic

**Issues:**
- Low Coupling (6/10): CombatSystem has 13 cached system dependencies; 245 `isServer` checks across 83 files couple shared code to runtime context
- Information Expert (7/10): `nextAttackTicks` Map and `playerEquipmentStats` Map in CombatSystem logically belong to `CombatStateService`
- Protected Variations (7/10): `isServer` boolean flag is "Primitive Obsession" — should use polymorphism

### Recommendations
1. Move `nextAttackTicks` into `CombatStateService` or dedicated `CooldownService`
2. Add `EquipmentSystem.getAttackType(playerId)` instead of CombatSystem parsing weapon data
3. Evaluate splitting combat into `ServerCombatSystem`/`ClientCombatSystem` instead of `isServer` guards

---

## 9. Code Organization

**Score: 6.5/10** | Priority: Critical

### Findings

**Strengths:**
- Domain-based folder structure (8/10): `combat/`, `character/`, `economy/`, `death/`, `movement/`, `interaction/`, `loot/`, `progression/`, `world/`
- Clean package boundaries: `shared` never imports from `server` or `client`
- Barrel files at every directory level

**Issues:**
- **Package Discipline (5/10 — Critical):** The `shared` package contains 24 client-only system files in `systems/client/` (`ClientNetwork.ts`, `ClientInput.ts`, `ClientGraphics.ts`, `ClientAudio.ts`, `HealthBars.ts`, `DamageSplatSystem.ts`, etc.) and 6 server-only files in `systems/server/` (`PersistenceSystem.ts`, `ServerBot.ts`, `ServerRuntime.ts`, etc.). These import browser/Node.js APIs and do not belong in shared.
- **File Hygiene (7/10):** Duplicate PID Manager implementations (`shared/PidManager.ts` 180 lines vs `server/PIDManager.ts` 341 lines); 1,671 lines of unintegrated speculative code (`CombatAuditLog.ts`, `CombatEventBus.ts`, `CombatReplayService.ts`, `CombatRequestValidator.ts`); `COMBAT-TODO.md` committed to source tree
- **File Size (5/10):** 12 files exceed 1,500 lines
- **Layered Architecture (7/10):** Entities import from systems (e.g., `MobEntity.ts` imports from `TileSystem`, `AggroSystem`)

### Recommendations
1. **P0:** Move `systems/client/` (24 files) to the `client` package
2. **P0:** Move `systems/server/` (6 files) to the `server` package
3. **P1:** Remove 1,671 lines of unintegrated combat services (or move to feature branch)
4. **P1:** Consolidate duplicate PID Manager into one implementation
5. **P1:** Break files >2,000 lines using handler extraction pattern
6. **P2:** Remove entity-to-system imports by extracting utility functions

---

## 10. Best Practices

**Score: 6.5/10** | Priority: High

### Findings

**DRY (7/10):**
- Combat calculations centralized in `DamageCalculator.ts`, `RangedDamageCalculator.ts`, `MagicDamageCalculator.ts`
- Range checking duplicated across `CombatSystem.validateAttackRange()`, `MeleeAttackHandler.isWithinCombatRange()`, and `checkRangeAndFollow()`
- Combat style resolution duplicated across 3 attack handlers

**KISS (6/10):**
- THREE different combat tick methods: `processCombatTick()`, `processNPCCombatTick()`, `processPlayerCombatTick()` with significant duplication
- `enterCombat()` is 144 lines with 10 parameters in `syncAndNotifyCombatStart()`
- World.ts has 776 lines of optional API declarations

**YAGNI (6/10):**
- 1,671 lines of unintegrated speculative combat services
- `EventStore` records every combat event with RNG state but `CombatReplayService` consumer is not wired
- `_isNetworkWithSocket` dead code in World.ts
- Legacy sprite properties kept "for backwards compatibility"

### Recommendations
1. **P1:** Remove unintegrated combat services from main branch
2. **P1:** Extract shared `CombatRangeChecker` service to DRY up range checking
3. **P2:** Unify three tick processing methods into `processCombatTickForEntity()`
4. **P2:** Group `enterCombat()` parameters into `CombatEntryRequest` object

---

## 11. Memory & Allocation Hygiene

**Score: 7/10** | Priority: High

### Findings

**Strengths:**
- Pre-allocated tiles (`_attackerTile`, `_targetTile`) in CombatSystem and PendingAttackManager
- Pre-allocated `_rangedParams` and `_magicParams` in attack handlers
- Pre-allocated damage event data in GameTickProcessor
- `worldToTileInto()` zero-allocation variant provided and used in hot paths
- `TilePool`, `QuaternionPool`, `BFSDataPool`, `EntityPool` implementations
- Zero-allocation array clearing via `length = 0` pattern

**Issues:**
- `{ ...state.currentTile }` spread operator in tick loop (`tile-movement.ts:478,485,524,704`) — allocates per player per tick
- `worldToTile()` (allocating) used in `AIStateMachine.ts:221-222,286-291,303,412-413,429,518-519` instead of `worldToTileInto()` — 100-400+ allocations per tick from AI alone with 50+ mobs
- BFS `queue.shift()` is O(n) (`BFSPathfinder.ts:198`) — degrades to quadratic for large searches
- BFS creates new `TileCoord` per neighbor (`BFSPathfinder.ts:207-210`) — `tileCoordPool` exists but marked "for future use" and never activated
- `tileKey()` creates template literal string per call (`TileSystem.ts:726`) — heavy in BFS
- `CollisionMatrix.getZoneKey()` allocates string per tile check (`CollisionMatrix.ts:86-89`)
- `tileToWorld()` allocates `{ x, y, z }` per call in tick loop instead of `tileToWorldInto()`
- `EventBus.emitEvent()` allocates `SystemEvent` object with string interpolation per emission
- `ProjectileService.processTick()` allocates fresh `hits` and `toRemove` arrays every tick

### Recommendations
1. **P0:** Replace `worldToTile()` with `worldToTileInto()` in AIStateMachine (eliminates 100-400+ allocs/tick)
2. **P0:** Replace spread operators with in-place copy for `previousTile` in tile-movement
3. **P1:** Activate existing `tileCoordPool` for BFS neighbor allocation
4. **P1:** Replace BFS `queue.shift()` with front-pointer index or ring buffer
5. **P1:** Use `tileToWorldInto()` in tile-movement hot paths
6. **P2:** Use numeric zone keys in CollisionMatrix (`(zoneX << 16) | (zoneZ & 0xFFFF)`)
7. **P2:** Pre-allocate `hits`/`toRemove` arrays in ProjectileService

---

## 12. Data-Oriented Design

**Score: 5/10** | Priority: Medium

### Findings

**Strengths:**
- `CollisionMatrix` uses `Int32Array` zones (8x8 tiles in contiguous memory) with bitwise O(1) checks — genuinely data-oriented
- Equipment stats cached per player in `playerEquipmentStats` Map

**Issues:**
- Array-of-Structs entity storage: `Map<string, Entity>` requires touching every entity for type filtering
- String-keyed Maps everywhere: `CollisionMatrix`, `EntityOccupancyMap` use template literal keys
- No hot/cold data separation: entities carry rendering, gameplay, and network data in single objects
- `localeCompare` used for deterministic sort in `GameTickProcessor.ts:399,428` — significantly slower than simple comparison
- `CombatStateService.getAllCombatStates()` iterates Map hash table with pointer chasing

### Recommendations
1. **P2:** Replace string-keyed zone Maps with numeric encoding
2. **P2:** Use numeric entity IDs for Map keys where possible
3. **P2:** Replace `localeCompare` with byte-by-byte comparison for deterministic sorting
4. **P3:** Separate hot entity data (position, health) from cold data (config, spawn point) at component level

---

## 13. Game Programming Patterns

**Score: 8/10** | Priority: Medium

### Findings

**Strengths:**
- **Object Pool** — TilePool, QuaternionPool, EntityPool, BFSDataPool, Vector3Pool all well-implemented with O(1) acquire/release
- **State Machine** — AIStateMachine with 5 pre-constructed singleton states, enter/exit hooks, zero-allocation transitions
- **Spatial Partition** — LooseOctree for raycasting, CollisionMatrix for tile walkability, EntityOccupancyMap for NPC collision
- **Event Queue** — EventBus, BroadcastManager, DamageQueue, ActionQueue all properly implemented
- **Service Locator** — `world.getSystem()` with hot-path caching of references
- **Flyweight** — Mob definitions share config from JSON manifests

**Issues:**
- No entity pooling for mobs/items — spawning creates new instances
- No spatial partition for game-logic queries ("find nearby players" iterates all players linearly)
- No explicit double-buffering for game state
- `tileCoordPool` exists but is not activated

### Recommendations
1. **P1:** Add spatial indexing for "find nearby player" queries in mob AI
2. **P2:** Activate `tileCoordPool` for BFS
3. **P2:** Add entity pooling for frequently spawned/despawned objects (ground items, projectiles)

---

## 14. Tick System & Timing

**Score: 9/10** | Priority: Low

### Findings

**Strengths:**
- Fixed 600ms server tick matching OSRS exactly (`CombatConstants.ts:38`)
- Deterministic 8-phase processing order in `GameTickProcessor.ts:334-373`: Reset -> Inputs -> NPCs -> Players -> Face Direction -> Damage -> Death/Loot -> Resources -> Broadcast
- OSRS damage asymmetry faithfully implemented: NPC->Player same tick, Player->NPC next tick
- PID-based combat priority via `PidManager`
- Cache invalidation for processing order via dirty flags
- Tick-aligned cooldowns using tick numbers (no floating-point drift)
- Pre-allocated tick buffers (`_mobsBuffer`, `_playersBuffer`, `_damageToApply`)
- Single-pass damage partitioning using write index (avoids `filter()` allocation)

**Issues:**
- `combatStates.sort()` per tick in legacy `processCombatTick` path
- `processAutoAttackOnTick` is async, creating promise allocations for common melee case
- `tickStartTiles.clear()` + repopulate every tick instead of in-place update

### Recommendations
1. **P2:** Make `processAutoAttackOnTick` synchronous for melee; isolate async to magic-only path
2. **P3:** Use in-place update for `tickStartTiles` instead of clear + repopulate

---

## 15. Persistence & Database

**Score: 4/10** | Priority: Critical

### Findings

**Strengths:**
- Bank operations use proper transactions (`BankRepository.savePlayerBankComplete()`)
- Inventory saves use transactions with upsert and deadlock retry
- Equipment saves use transactions
- Duel settlements use idempotency guard via PK on `duelId`
- Death lock uses `INSERT ... ON CONFLICT DO NOTHING` for atomic acquisition
- Death item flow is ATOMIC via `executeInTransaction()` — inventory clear + death lock in single transaction
- Item duplication audit: **zero critical duplication vectors found** across all 8 transfer paths (trade, store, bank, death, pickup, duel, equip/unequip)
- 35 migration files with proper Drizzle ORM migration runner
- Graceful shutdown handler saves all player data (inventory, equipment, coins) before exit
- Multi-login prevention enforced at `enterWorld` time

**Verified Persistence Gaps (Deep Verification Pass):**

| Finding | Status | Details |
|---------|--------|---------|
| Position saved on disconnect | **SAVED** | `PlayerSystem.onPlayerLeave()` calls `savePlayerToDatabase()` |
| HP/Health saved on disconnect | **SAVED** | Saved in same `savePlayerToDatabase()` call |
| Equipment saved on disconnect | **SAVED** | `EquipmentSystem` subscribes to `PLAYER_LEFT`, calls `saveEquipmentToDatabase()` |
| Inventory saved on disconnect | **WRITE-THROUGH** | No explicit disconnect save, but every mutation writes to DB immediately |
| Coins saved on disconnect | **WRITE-THROUGH** | `CoinPouchSystem.persistCoinsImmediate()` on every change |
| Bank saved on disconnect | **WRITE-THROUGH** | `BankRepository` writes immediately on each operation |
| Quest progress saved on disconnect | **WRITE-THROUGH** | Saved on quest start, stage advance, and completion |
| **Skill XP NOT saved on disconnect** | **CRITICAL GAP** | `savePlayerToDatabase()` (line 1675) saves only 5 combat skill LEVELS (attack, strength, defense, constitution, ranged) — **zero XP values** and **zero non-combat skills**. Separately, `saveSkillsToDatabase()` (line 2311) saves 9 of 17 skills (level+XP) but **completely omits 8 skills: magic, prayer, mining, smithing, agility, crafting, fletching, runecrafting** — despite the DB schema having columns for all 17. If server crashes between debounced saves, up to 500ms of XP is lost for the 9 covered skills, and ALL progress in the 8 missing skills is only saved via fire-and-forget `event-bridge.ts:336` with no retry |
| **Prayer points NOT saved on disconnect** | **GAP** | `PrayerSystem` listens for `PLAYER_CLEANUP` event, but **`PLAYER_CLEANUP` is never emitted** during disconnect flow. Prayer points only saved via 30s auto-save. Up to 30s of prayer drain can be lost |
| **Combat logout timer NOT enforced** | **GAP** | `canLogout()` exists at `PlayerCombatStateManager.ts:236-239` (16 ticks / 9.6s) but `socket-management.ts:117-162` NEVER calls it — players can instantly disconnect during combat |
| XP saves fire-and-forget | **CONFIRMED** | No retry, silently lost on failure |
| PersistenceService WAL dead code | **CONFIRMED** | Fully coded but never instantiated |
| `PLAYER_LEFT` fires twice on disconnect | **BUG** | `socket-management.ts:151` emits it, then `Entities.remove()` emits it again. Second emission is safely no-oped but is wasteful |
| In-memory stackable overflow | **GAP** | `InventorySystem.ts:456` — `existingItem.quantity += data.quantity` has no `MAX_QUANTITY` cap. DB transaction handlers check overflow, but direct `addItem()` callers (loot drops, quest rewards) do not |

**Additional Issues:**
- `savePlayerAsync` in `PlayerRepository.ts:67` is a simple UPDATE with no retry logic
- `pendingOperations` queue in `DatabaseSystem` has no backpressure mechanism
- No backup strategy documented
- Migration error handling at `client.ts:184` silently skips "already exists" errors
- Ground items are purely in-memory — lost on crash (acceptable for OSRS parity, but death items are recoverable via `DeathStateManager`)
- XP lamp usage (`handleXpLampUse`) removes lamp and grants XP as separate events — crash between them loses lamp without granting XP

### Recommendations
1. **P0:** Save ALL skill XP on disconnect — extend `savePlayerToDatabase()` to save all skill XP values, not just 6 combat levels
2. **P0:** Emit `PLAYER_CLEANUP` during disconnect flow OR have `PrayerSystem` listen to `PLAYER_LEFT` directly
3. **P0:** Enforce combat logout timer — call `canLogout()` in `handleDisconnect`, delay entity removal by 10s if in combat
4. **P0:** Add `MAX_QUANTITY` overflow check in `InventorySystem.addItem()` and `addItemDirect()`
5. **P0:** Add retry logic to XP persistence in `event-bridge.ts`
6. **P1:** Wire up `PersistenceService` WAL or remove dead code (1,000+ lines)
7. **P1:** Add backpressure to fire-and-forget saves (limit `pendingOperations` size)
8. **P1:** Fix `PLAYER_LEFT` double-emission in disconnect flow
9. **P2:** Reduce auto-save interval from 30s to 15s
10. **P2:** Document backup strategy

---

## 16. PostgreSQL Discipline

**Score: 6/10** | Priority: High

### Findings

**Connection Management (7/10):**
- Pool configured: max 20, min 2, 10s idle timeout, 30s connect timeout
- Singleton pattern prevents connection leaks; hot reload cleanup; connection testing before use
- No pool exhaustion monitoring or alerting

**Transaction Discipline (7/10):**
- `executeInTransaction()` supports configurable isolation levels
- Consistent lock ordering (characters first, then inventory/bank)
- Deadlock retry with exponential backoff in InventoryRepository
- `executeSecureTransaction()` provides 3 retries with linear backoff
- No read-only transaction marking anywhere
- Duel stakes handler uses raw `client.query("BEGIN")` bypassing Drizzle

**Query Performance (6/10):**
- Comprehensive indexing on most tables
- `PersistenceSystem.performPeriodicSave()` iterates sessions one-by-one (N+1 pattern)
- `PlayerRepository.getPlayerAsync()` uses `SELECT *` equivalent

**Data Integrity (5/10):**
- Foreign keys with CASCADE DELETE used extensively (33 references)
- Unique constraints on equipment, inventory, bank, kills, quests
- **Missing:** No CHECK constraints on any column — `coins`, `quantity`, `health` can go negative at DB level
- **Missing:** `characters.accountId` has no FK to `users.id`
- **Missing:** `inventory.itemId` and `equipment.itemId` have no referential integrity
- **Missing:** No index on `characters.name`

**Schema Design (6/10):**
- Appropriate column types (integer, real, bigint, text, JSONB)
- `needsReset`, `isAgent` use `integer` (0/1) instead of `boolean` (SQLite legacy)
- `roles` stored as comma-separated text instead of array/junction table
- `worldChunks` has no proper primary key

### Recommendations
1. **P0:** Add CHECK constraints: `coins >= 0`, `quantity > 0`, `health >= 0`
2. **P1:** Add FK from `characters.accountId` to `users.id`
3. **P1:** Replace raw SQL in duel stakes with Drizzle transactions
4. **P2:** Add pool utilization monitoring
5. **P2:** Convert integer booleans to proper `boolean` type
6. **P3:** Add unique index on `characters.name`

---

## 17. Economic Integrity

**Score: 7/10** | Priority: Medium

### Findings

**Strengths:**
- Store buy/sell fully transactional with `SELECT FOR UPDATE` on coins and inventory
- Trade swaps atomic: both players' changes in single transaction
- Duel settlement atomic with idempotency guard
- Bank coin deposits/withdrawals atomic
- Coin cap at `MAX_COINS = 2147483647` with overflow checks
- All prices looked up server-side from `StoreSystem`
- Item values for duel stakes computed server-side
- Activity log records pickups, drops, kills, trades
- Duel stakes have audit logging via `AuditLogger`
- Player IDs derived from socket auth, never from client packets

**Issues:**
- `CoinPouchSystem.persistCoinsImmediate()` is non-transactional — could overwrite concurrent DB-level coin change from store transaction
- No DB-level CHECK constraints on economic values
- RNG/loot not audited in this pass

### Recommendations
1. **P1:** Add DB-level CHECK constraint `coins >= 0` on characters table
2. **P2:** Consider always reading coin balance from DB for authoritative operations

---

## 18. Server Authority

**Score: 8/10** | Priority: Medium

### Findings

**Strengths:**
- Tick-based deterministic simulation with strict OSRS-accurate phase ordering
- Server-authoritative movement: client sends target tile, server computes BFS path, validates walkability
- Server-authoritative combat: all validation server-side (rate limiting, timestamp, target existence, PvP zone, duel state)
- Player ID always derived from `socket.player.id`, never client data
- Comprehensive input validation via centralized `InputValidation.ts`

**Issues:**
- `handleEntityModified` handler at `index.ts:1357` potentially allows clients to modify entity state
- No formal schema validation (inline type casting instead of Zod/TypeBox)
- Position validator only checks Y-axis drift, not X/Z position reconciliation

### Recommendations
1. **P1:** Audit `handleEntityModified` to ensure it cannot modify authoritative state
2. **P2:** Introduce schema validation at message boundary
3. **P2:** Add periodic X/Z position reconciliation

---

## 19. Client Responsiveness

**Score: 4/10** | Priority: High

### Findings

**Strengths:**
- Client-side rate limiters provide immediate "too fast" feedback for 25+ action types
- WebSocket message queuing during reconnection
- Movement packets include `moveSeq` for packet ordering

**Issues:**
- **No optimistic prediction for inventory**: `InventoryActionDispatcher.ts:35-146` sends every action to server and waits for response — full round-trip delay for eat, wield, drop
- **No optimistic prediction for combat**: no immediate visual feedback until server broadcasts `combatDamageDealt`
- **No shadow state or pending transactions**: searching for "rollback", "reconcil", "shadow state", "pending transaction" yielded zero hits
- **No batching of rapid inputs**: each click sends a packet immediately
- **No rejection/rollback handling**: no reconciliation path when server rejects an action

### Recommendations
1. **P1:** Implement optimistic inventory updates with server reconciliation
2. **P1:** Add immediate visual feedback for combat actions (animation start before server confirmation)
3. **P2:** Implement client-side shadow state for inventory
4. **P2:** Add smooth rejection handling with visual rollback

---

## 20. Network Resilience & Distributed Systems

**Score: 4.5/10** | Priority: Critical

### Findings

**Network Resilience (5/10):**
- WebSocket reconnection with exponential backoff (1s initial, 30s max, 10 retries)
- Heartbeat mechanism: pings every 30s, 10s timeout
- Server-side socket health monitoring with configurable miss tolerance
- **No session recovery**: reconnection requires full re-authentication and world reload; player entity removed on disconnect
- **No connection quality indicator** in client UI

**Distributed Systems (4/10):**
- `IdempotencyService` with hash-based deduplication (5s TTL) — but only used for duel settlements
- Server as single source of truth (strong consistency)
- **No interest management**: `BroadcastManager.sendToAll()` sends every message to every client — no spatial filtering, no relevancy culling
- **No delta compression or state diffing**: full world state sent on connection; ongoing updates as individual events
- **No bandwidth budgeting**: no message priority tiers or client bandwidth throttling
- Single-server architecture with no horizontal scaling path

### Recommendations
1. **P0:** Implement area-of-interest filtering (critical for scaling beyond ~50 concurrent players)
2. **P1:** Add session recovery with session tokens for seamless reconnection
3. **P1:** Surface connection quality in client UI
4. **P2:** Add delta compression for entity state broadcasts
5. **P2:** Implement bandwidth budgeting with message priority tiers
6. **P3:** Extend idempotency coverage to all state-mutating operations

---

## 21. ECS Discipline

**Score: 5/10** | Priority: High

### Findings

**Strengths:**
- Well-defined 11-phase system update cycle (`System.ts:28-35`)
- Topological sorting of systems based on declared dependencies (`World.ts:955`)
- `SystemBase` provides automatic resource cleanup (timers, intervals, events)

**Issues:**
- Components have lifecycle methods (`Component.ts:25-29`): `init()`, `update()`, `fixedUpdate()`, `lateUpdate()` — in strict ECS, components are inert data
- Entities are heavy classes with behavior: `CombatantEntity` has `attackTarget()`, `calculateDamage()`, `takeDamage()`, `die()`, `respawn()` (lines 209-259)
- `MobEntity` embeds 5 manager objects (`DeathStateManager`, `CombatStateManager`, `AIStateMachine`, `RespawnManager`, `AggroManager`)
- Component data is untyped `Record<string, unknown>` bags (`Component.ts:12`)
- Entity update calls `component.lateUpdate(delta)` on all components, distributing logic across components

### Recommendations
1. **P2:** Strip lifecycle methods from Component base class; push logic into systems
2. **P2:** Extract combat behavior from CombatantEntity into CombatSystem
3. **P2:** Introduce strongly-typed component data classes instead of `Record<string, unknown>`
4. **P3:** Move entity managers (AI, aggro, death) into system-level services

---

## 22. AI & NPC Behavior

**Score: 8/10** | Priority: Medium

### Findings

**Strengths:**
- 5-state AIStateMachine (IDLE, WANDER, CHASE, ATTACK, RETURN) with enter/exit/update hooks
- OSRS-accurate dual-range aggro: Hunt Range (current position) + Aggression Range (spawn point)
- Two-tier pathfinding: naive diagonal first, BFS fallback with object pools
- Server-authoritative NPC actions; AI ticks throttled to 600ms
- Leash range checks PLAYER distance from spawn (prevents ranged farming exploits)
- Spiral search for unoccupied spawn tiles; randomized respawn positions

**Issues:**
- AI logic lives in entity (`MobEntity`), not in a system — each mob has its own state machine instance
- No path caching/memoization for frequently traversed routes
- No spatial hashing for aggro checks — scans all players linearly

### Recommendations
1. **P1:** Add spatial indexing for nearby player queries
2. **P2:** Move per-entity AI managers into `MobAISystem`
3. **P3:** Add path caching for frequently traversed routes

---

## 23. Rendering & GPU Hygiene

**Score: 7/10** | Priority: Medium

### Findings

**Strengths:**
- `ThreeResourceManager` with double-disposal prevention (WeakSet), recursive traversal, memory monitoring
- GPU-instanced vegetation with chunked rendering and distance-based culling
- Health bars via single InstancedMesh with texture atlas (max 256 instances)
- General-purpose `InstancedMeshManager` with distance culling and pooling
- LOD system with batched per-frame checks (1000 nodes max)
- Animation LOD: full at <30m, half at 30-60m, quarter at 60-100m, paused beyond 150m
- ModelCache singleton with shared materials

**Issues:**
- No shader pre-compilation/warm-up (potential first-frame stutter)
- No GPU memory budget enforcement
- Legacy sprite materials not disposed (relies on GC, documented as intentional for WebGPU)
- Minimap creates its own renderer (potential render target reuse opportunity)

### Recommendations
1. **P2:** Implement shader warm-up during loading screen
2. **P2:** Add GPU memory budget enforcement with automatic quality downgrade
3. **P3:** Investigate render target reuse for minimap

---

## 24. UI Framework Integration

**Score: 7/10** | Priority: Low

### Findings

**Strengths:**
- Zustand for external state management with `persist` middleware (10 stores)
- UI layer separated from Three.js render canvas
- Game loop runs in System update cycle, independent of React reconciliation
- Proper cleanup on unmount (cancelAnimationFrame, renderer disposal)

**Issues:**
- No `React.memo()` or `useMemo()` optimization for frequently-updating HUD components
- 101 `useState` occurrences across 37 files — some may cause unnecessary re-renders during gameplay

### Recommendations
1. **P3:** Audit HUD components (health bars, XP orbs, action progress) for unnecessary re-renders
2. **P3:** Consider `useSyncExternalStore` for game state subscriptions

---

## 25. Manifest-Driven Data Architecture

**Score: 8/10** | Priority: Medium

### Findings

**Strengths:**
- 37 JSON manifest files covering items (8 categories), NPCs, areas, biomes, recipes (8 skills), prayers, stations, stores, and more
- Single source of truth: `ITEMS` and `ALL_NPCS` are empty Maps populated at runtime from manifests
- Code comments enforce: "DO NOT add NPC data here - keep it in JSON!"
- `DataManager.validateAllData()` with cross-reference validation (mob spawns reference valid NPCs, starting items reference valid items)
- `normalizeItem()` and `normalizeNPC()` apply comprehensive defaults
- Duplicate item ID detection during loading

**Issues:**
- No JSON Schema validation of manifest files — malformed JSON only caught at runtime
- CDN loading and filesystem loading contain nearly identical duplicated logic
- `EXTERNAL_TOOLS` stored on `globalThis` (global mutable state)
- No manifest versioning for stale client cache detection

### Recommendations
1. **P1:** Add JSON Schema validation for manifests in CI pipeline
2. **P2:** Extract manifest loading duplication into generic loader with data source strategy
3. **P3:** Replace `globalThis` storage with module-scoped Maps

---

## Implementation Plan to Reach 9.5/10

### Phase 1: Critical Fixes — "Zero Data Loss" (Score: 6.6 -> 7.8)

**Target: 2-3 weeks**

These are blocking issues that prevent production deployment. A RuneScape-level MMO MUST guarantee zero player data loss.

#### 1.1 Persistence Safety (Current: 4 -> Target: 8.5)

**Save-on-disconnect (RuneScape standard: every byte of player state survives any disconnect):**
- [ ] Save ALL 17 skills on disconnect — `savePlayerToDatabase()` (line 1675) must persist all skill levels AND XP. Currently saves only 5 combat levels with zero XP. Additionally, `saveSkillsToDatabase()` (line 2311) must add the 8 missing skills: magic, prayer, mining, smithing, agility, crafting, fletching, runecrafting (both level and XP). The DB schema already has all columns — the gap is purely in the save function's field mapping
- [ ] Fix prayer points not saved on disconnect — either emit `PLAYER_CLEANUP` in disconnect flow or have `PrayerSystem` subscribe to `PLAYER_LEFT` directly (currently `PLAYER_CLEANUP` is never emitted)
- [ ] Add retry logic to XP persistence in `event-bridge.ts` (3 retries with exponential backoff)
- [ ] Fix `PLAYER_LEFT` double-emission bug in `socket-management.ts` (emits before `Entities.remove()`, which emits again)

**Combat logout timer (RuneScape standard: 10-second combat timer before logout allowed):**
- [ ] Enforce `canLogout()` check in `handleDisconnect()` at `socket-management.ts` — if player is in combat, keep entity alive for 10s (16 ticks) before removal. This prevents combat-logging exploits where players disconnect to avoid death
- [ ] During the grace period, the player entity remains in-world and targetable (standard OSRS behavior)

**Overflow protection:**
- [ ] Add `MAX_QUANTITY` overflow check in `InventorySystem.addItem()` line 456 and `addItemDirect()` line 1763 — cap `existingItem.quantity` at `2,147,483,647` to prevent PostgreSQL integer column truncation on save

**Infrastructure:**
- [ ] Add backpressure to `pendingOperations` (reject when queue > 100)
- [ ] Reduce auto-save interval from 30s to 15s
- [ ] Wire up `PersistenceService` WAL or remove 1,000+ lines of dead code

#### 1.2 Security Hardening (Current: 7.5 -> Target: 9)
- [ ] Add JWT expiration (`expiresIn: '7d'`) at `utils.ts:90-96`
- [ ] Remove hardcoded JWT secret fallback at `utils.ts:68-69`; fail hard if `JWT_SECRET` not set in production
- [ ] Add server-side chat validation: sanitize message body, verify `from` matches authenticated player, enforce length limits (`handlers/chat.ts:16-28`)
- [ ] Add permission checks to `/name` command (`commands.ts:90-108`) and `/move` command (`commands.ts:112-162`)
- [ ] Use `crypto.timingSafeEqual()` for ADMIN_CODE comparison (`commands.ts:62`)
- [ ] Add safeguard against NODE_ENV misconfiguration for auto-admin (`authentication.ts:364-371`)

#### 1.3 PostgreSQL Safety (Current: 6 -> Target: 8)
- [ ] Add CHECK constraints via migration: `coins >= 0` on characters, `quantity > 0` on inventory and bank_storage, `health >= 0` on characters
- [ ] Add FK from `characters.accountId` to `users.id`
- [ ] Replace raw `client.query("BEGIN")` in duel stakes handler with Drizzle transactions

#### 1.4 TypeScript Rigor (Current: 5 -> Target: 7)
- [ ] Enable `noImplicitAny: true` in `packages/shared/tsconfig.json` and `packages/server/tsconfig.json`
- [ ] Define typed event payload interfaces in shared package (replace 15+ inline `as { ... }` casts in ServerNetwork)

### Phase 2: Architecture Cleanup (Score: 7.8 -> 8.5)

**Target: 3-4 weeks**

#### 2.1 Package Discipline (Current: 5 -> Target: 9)
- [ ] Move `systems/client/` (24 files) to client package — these import Three.js, DOM APIs, and browser-specific functionality
- [ ] Move `systems/server/` (6 files) to server package — these use Node.js APIs
- [ ] Move `CombatRequestValidator.ts` to server package (uses Node.js `crypto`)

#### 2.2 Dead Code Removal (Current: 6 -> Target: 9)
- [ ] Remove `CombatAuditLog.ts` (414 lines), `CombatEventBus.ts` (454 lines), `CombatReplayService.ts` (550 lines), `CombatRequestValidator.ts` (253 lines) — 1,671 lines of unintegrated speculative code
- [ ] Remove `_isNetworkWithSocket` dead code in `World.ts:90-102`
- [ ] Remove `COMBAT-TODO.md` from source tree (use issue tracker)
- [ ] Remove legacy sprite properties from `Entity.ts:165`
- [ ] Consolidate duplicate PID Manager (`shared/PidManager.ts` 180 lines + `server/PIDManager.ts` 341 lines) into one

#### 2.3 God File Decomposition (Current: 5 -> Target: 8)
- [ ] Split `ClientNetwork.ts` (4,564 lines) into ConnectionManager, EntitySyncManager, PacketHandler
- [ ] Split `ServerNetwork/index.ts` (4,023 lines) — extract handler registry, extract "cancel all pending actions" into shared method
- [ ] Split `MobEntity.ts` (3,146 lines) — extract AI, combat, rendering concerns into system-level services
- [ ] Split `PlayerLocal.ts` (2,771 lines) — extract input, camera, rendering concerns

#### 2.4 Typed System Registry (Current: 6 -> Target: 8)
- [ ] Create `SystemRegistry` with typed `getSystem<T>()` replacing string-based lookups
- [ ] Eliminate `as unknown as` chains for system access (30+ instances)
- [ ] Remove `world.getSystem()` string lookups in CombatSystem (13 calls)
- [ ] Fix duplicate `getSystem("player")` call at `CombatSystem.ts:2109` (should use cached `this.playerSystem`)

### Phase 3: Performance & Scalability (Score: 8.5 -> 9.0)

**Target: 3-4 weeks**

#### 3.1 Hot-Path Allocation Elimination (Current: 7 -> Target: 9)
- [ ] Replace `worldToTile()` with `worldToTileInto()` in `AIStateMachine.ts:221-222,286-291,303,412-413,429,518-519` (eliminates 100-400+ object allocations per tick from AI alone)
- [ ] Replace `{ ...state.currentTile }` spread operators with in-place copy in `tile-movement.ts:478,485,524,704`
- [ ] Activate existing `tileCoordPool` for BFS neighbor allocation (`BFSPathfinder.ts:207-210`)
- [ ] Replace BFS `queue.shift()` O(n) with front-pointer index (`BFSPathfinder.ts:198`)
- [ ] Use `tileToWorldInto()` in `tile-movement.ts:563,588` (currently allocates `{ x, y, z }` per call)
- [ ] Pre-allocate `hits`/`toRemove` arrays in `ProjectileService.processTick()`
- [ ] Use numeric zone keys in CollisionMatrix (`(zoneX << 16) | (zoneZ & 0xFFFF)`) instead of template literal strings

#### 3.2 Interest Management (Current: 4 -> Target: 8)
- [ ] Implement area-of-interest filtering — clients only receive entity updates within view distance. Critical for scaling beyond ~50 concurrent players (currently `BroadcastManager.sendToAll()` sends everything to everyone)
- [ ] Add spatial indexing (grid or quadtree) for "find nearby player" queries in mob AI (currently linear scan of all players)
- [ ] Add bandwidth budgeting with message priority tiers (combat > movement > cosmetic)

#### 3.3 Network Resilience (Current: 5 -> Target: 8)
- [ ] Implement session tokens for seamless reconnection (currently full re-auth + world reload on any disconnection)
- [ ] Add reconnection grace period — preserve player entity in-world for 30s on disconnect to allow seamless rejoin
- [ ] Surface connection quality indicator in client UI (latency is tracked via `getLatency()` but not displayed)

### Phase 4: Polish & Best Practices (Score: 9.0 -> 9.5)

**Target: 4-6 weeks**

#### 4.1 Client Responsiveness (Current: 4 -> Target: 8)
- [ ] Implement optimistic inventory updates with server reconciliation — when player clicks "eat", immediately show food disappearing, reconcile on server confirm/reject
- [ ] Add immediate visual feedback for combat actions (animation start before server confirmation)
- [ ] Implement client-side shadow state for inventory with pending transaction tracking
- [ ] Add smooth rejection handling with visual rollback (not jarring state snaps)
- [ ] Add client-side input buffer that holds recent inputs during cooldowns and replays when cooldown expires

#### 4.2 ECS Purification (Current: 5 -> Target: 7)
- [ ] Strip lifecycle methods (`init`, `update`, `lateUpdate`) from `Component` base class — push logic into systems
- [ ] Extract combat behavior from `CombatantEntity` (`attackTarget()`, `calculateDamage()`, `takeDamage()`, `die()`) into CombatSystem
- [ ] Introduce strongly-typed component data classes instead of `Record<string, unknown>`
- [ ] Move entity managers (AIStateMachine, AggroManager, DeathStateManager) into system-level services

#### 4.3 Combat System Polish (Current: 7 -> Target: 9)
- [ ] Extract `CombatTickProcessor` from CombatSystem (tick processing logic)
- [ ] Extract `CombatLifecycleManager` from CombatSystem (enterCombat, endCombat, handleEntityDied, handlePlayerRespawned)
- [ ] Implement `AttackHandler` registry to replace `switch` on `AttackType` in `handleAttack()`
- [ ] DRY up range checking into shared `CombatRangeChecker` (duplicated across CombatSystem, MeleeAttackHandler, checkRangeAndFollow)
- [ ] Add `getCombatStyle()` to `CombatAttackContext` to eliminate style resolution duplication across 3 handlers

#### 4.4 Data & Schema (Current: 6 -> Target: 8)
- [ ] Add JSON Schema validation for all 37 manifest files in CI pipeline
- [ ] Add pool utilization monitoring and alerting
- [ ] Convert `integer` boolean columns to proper `boolean` type (SQLite legacy cleanup)
- [ ] Add delta compression for entity state broadcasts (send only changed fields)
- [ ] Add shader pre-compilation/warm-up during loading screen

#### 4.5 Testing & Observability
- [ ] Add structured logging for silent early-return paths in handlers
- [ ] Persist anti-cheat violation history to database for cross-session analysis
- [ ] Add pool exhaustion alerting
- [ ] Document backup strategy (at minimum, document Neon's automatic backup capabilities)
- [ ] Wire movement anti-cheat to auto-kick/ban system (currently monitoring-only)

---

## Verification Results

The following items were verified by targeted deep-dive audits:

### Item Duplication: ZERO CRITICAL VECTORS

All 8 item transfer paths were audited for atomicity:

| Transfer Path | DB Transaction | FOR UPDATE | Inventory Lock | Idempotency | Crash Safe |
|---|---|---|---|---|---|
| Trade swap | Yes | Yes | Yes (both players) | No | Yes |
| Store buy/sell | Yes | Yes | Yes | No | Yes |
| Bank deposit/withdraw | Yes | Yes | Yes | No | Yes |
| Death/loot | Yes | N/A | N/A | No | Yes (death locks) |
| Ground pickup | No (in-memory) | No | Pickup lock (in-memory) | Yes (5s) | N/A |
| Duel settlement | Yes (raw SQL) | Yes | Yes (both) | Yes (DB + memory) | Yes |
| Equip item | No (in-memory) | No | Transaction lock | Yes (5s) | N/A |
| Unequip item | No (in-memory) | No | Transaction lock | Yes (5s) | N/A |

### Server-Side Validation: COMPREHENSIVE

| Check | Status | Details |
|---|---|---|
| Inventory 28-slot limit | PASS | `MAX_INVENTORY_SLOTS: 28` enforced in `findEmptySlot()`, `isFull()`, `hasSpace()` |
| Negative quantity exploits | PASS | `isValidQuantity()` requires `value > 0` on all server entry points |
| Equipment requirements | PASS | `meetsLevelRequirements()` checks manifest requirements server-side |
| Skill level caps | PASS | `MAX_LEVEL = 99`, `MAX_XP = 200,000,000` enforced in `SkillsSystem` |
| Cooldown manipulation | PASS | `EatDelayManager` uses server-side tick counting, `EAT_DELAY_TICKS: 3` |
| Map boundary exploits | PASS | `WORLD_BOUNDS` (-10000 to 10000), `CollisionMatrix` wall collision, BFS path validation |
| Graceful shutdown | PASS | SIGTERM/SIGINT handlers save all player data before exit |
| Combat error recovery | PASS | try/catch around `applyDamage()` with structured logging |
| Multi-login prevention | PASS | `enterWorldRejected` sent when same character already logged in |

### Exhaustive Persistence Coverage (All 17 Skills)

Verified every skill against both save paths (`savePlayerToDatabase` on disconnect/auto-save and `saveSkillsToDatabase` on debounced skill change):

| Skill | DB Column Exists | `savePlayerToDatabase` (disconnect) | `saveSkillsToDatabase` (debounced) | Net Status |
|-------|:---:|:---:|:---:|---|
| Attack | Yes | Level only, no XP | Level + XP | **Partial** |
| Strength | Yes | Level only, no XP | Level + XP | **Partial** |
| Defense | Yes | Level only, no XP | Level + XP | **Partial** |
| Constitution | Yes | Level only, no XP | Level + XP | **Partial** |
| Ranged | Yes | Level only, no XP | Level + XP | **Partial** |
| Woodcutting | Yes | NOT saved | Level + XP | **Partial** |
| Fishing | Yes | NOT saved | Level + XP | **Partial** |
| Firemaking | Yes | NOT saved | Level + XP | **Partial** |
| Cooking | Yes | NOT saved | Level + XP | **Partial** |
| **Magic** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Prayer** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Mining** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Smithing** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Agility** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Crafting** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Fletching** | Yes | NOT saved | **NOT saved** | **MISSING** |
| **Runecrafting** | Yes | NOT saved | **NOT saved** | **MISSING** |

**8 of 17 skills are COMPLETELY MISSING from both save paths.** The DB schema has all columns — the gap is in `PlayerSystem.ts` code only.

**Other persistence (fully verified):**

| Data | Save Mechanism | Status |
|------|---------------|--------|
| Position (x, y, z) | `savePlayerToDatabase()` on disconnect + auto-save | **SAVED** |
| HP (current + max) | `savePlayerToDatabase()` on disconnect + auto-save | **SAVED** |
| Inventory (items) | Write-through on every mutation | **SAVED** |
| Equipment (worn items) | `EquipmentSystem` subscribes to `PLAYER_LEFT` | **SAVED** |
| Coins | Write-through via `CoinPouchSystem` | **SAVED** |
| Bank (all tabs) | Write-through via `BankRepository` | **SAVED** |
| Quest progress | Write-through on quest start/advance/complete | **SAVED** |
| Friends list | Write-through on add/remove | **SAVED** |
| Ignore list | Write-through on add/remove | **SAVED** |
| Action bar layout | Write-through on change | **SAVED** |
| UI layout presets | Write-through on save | **SAVED** |
| Attack style | `savePlayerToDatabase()` on disconnect | **SAVED** |
| Prayer points | 30s auto-save only (disconnect gap) | **PARTIAL** |
| Stamina | Transient (correct — regenerates) | N/A |
| Combat state | Transient (correct — resets on login) | N/A |
| Movement path | Transient (correct — resets on login) | N/A |
| Cooldowns | Transient (correct — resets on login) | N/A |

### Remaining Gap: In-Memory Stackable Overflow

`InventorySystem.ts:456` — `existingItem.quantity += data.quantity` has no `MAX_QUANTITY` cap. While DB-level handlers validate, direct callers (loot drops, quest rewards) could exceed `2,147,483,647` causing PostgreSQL integer truncation on save.

---

## Appendix: File Size Report (>1,500 lines)

| File | Lines | Domain |
|------|-------|--------|
| `ClientNetwork.ts` | 4,564 | Network |
| `ServerNetwork/index.ts` | 4,023 | Network |
| `TerrainSystem.ts` | 3,731 | World |
| `agent-routes.ts` | 3,480 | Server |
| `MobEntity.ts` | 3,146 | AI/NPC |
| `ResourceSystem.ts` | 2,959 | World |
| `PlayerLocal.ts` | 2,771 | Player |
| `CombatSystem.ts` | 2,592 | Combat |
| `InventorySystem.ts` | 2,363 | Economy |
| `PlayerSystem.ts` | 2,346 | Player |
| `ProcessingDataProvider.ts` | 2,229 | Server |
| `VegetationSystem.ts` | 2,166 | World |

---

*Generated by Claude Code audit — all findings verified against source code with file:line references.*
