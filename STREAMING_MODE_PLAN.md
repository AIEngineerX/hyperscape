# Streaming Mode Implementation Plan

## Overview

A 15-minute duel cycle streaming mode where AI model agents compete against each other with professional broadcast-style presentation.

## Current State Analysis

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| DuelScheduler (agent pairing) | Exists | `packages/server/src/systems/DuelScheduler/` |
| DuelSystem (full state machine) | Exists | `packages/server/src/systems/DuelSystem/` |
| Arena pool (6 arenas) | Exists | `DuelSystem/ArenaPoolManager.ts` |
| Teleportation to arena | Exists | `DuelSystem/DuelCombatResolver.ts` |
| EmbeddedGameClient (spectator) | Exists | `packages/client/src/game/EmbeddedGameClient.tsx` |
| Camera following | Exists | `ClientCameraSystem.ts` + `spectatorMode.ts` |
| Combat stats table | Exists | `playerCombatStats` in schema |
| Model agent spawning | Exists | `packages/server/src/eliza/ModelAgentSpawner.ts` |

### What's Missing

| Component | Priority | Complexity |
|-----------|----------|------------|
| 15-minute cycle scheduler | HIGH | Medium |
| Announcement phase (5 min) | HIGH | Low |
| Food filling before duel | HIGH | Low |
| Health restoration | HIGH | Low |
| Return teleportation | MEDIUM | Low |
| Streaming mode entry point | HIGH | Medium |
| Camera auto-switching | HIGH | Medium |
| Streaming overlay UI | HIGH | High |
| Leaderboard API | MEDIUM | Low |
| Leaderboard UI | MEDIUM | Medium |
| Agent stats tracking | MEDIUM | Low |

---

## Duel Cycle Timeline (15 Minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        15-MINUTE DUEL CYCLE                         │
├───────────────────┬─────────────────────────────────────────────────┤
│   ANNOUNCEMENT    │                  DUEL PHASE                     │
│    (5 minutes)    │                 (10 minutes)                    │
├───────────────────┼─────────────────────────────────────────────────┤
│ 0:00 - 5:00       │ 5:00 - 15:00                                    │
│                   │                                                 │
│ • Select 2 agents │ 5:00 - 5:03: Countdown (3-2-1-FIGHT)           │
│ • Show matchup    │ 5:03 - 14:30: Active combat                    │
│ • Display stats   │ 14:30 - 14:45: End warning (30 sec)            │
│ • Build hype      │ 14:45 - 15:00: Determine winner by HP          │
│ • Camera follows  │                                                 │
│   both agents     │ Winner = kill OR higher HP at timeout          │
│   (random switch) │                                                 │
├───────────────────┴─────────────────────────────────────────────────┤
│ 15:00: RESOLUTION (few seconds)                                     │
│ • Announce winner                                                   │
│ • Update leaderboard                                                │
│ • Restore health                                                    │
│ • Remove duel food                                                  │
│ • Teleport back to original positions                               │
│ • Immediately start next ANNOUNCEMENT phase                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Streaming Mode Infrastructure

#### 1.1 Streaming Entry Point (Client)
**Files to create:**
- `packages/client/src/screens/StreamingMode.tsx` - Main streaming mode component
- `packages/client/src/components/streaming/` - Streaming overlay components

**Changes:**
- Add `/stream` route in router
- Auto-connect without login
- Hide standard UI
- Initialize streaming overlay

```typescript
// StreamingMode.tsx concept
export function StreamingMode() {
  return (
    <div className="streaming-container">
      <GameClient wsUrl={wsUrl} onSetup={setupStreamingMode} />
      <StreamingOverlay />
    </div>
  );
}
```

#### 1.2 Streaming WebSocket Connection
**Files to modify:**
- `packages/server/src/network/connection-handler.ts`

**Changes:**
- Add `mode=streaming` query param support
- Auto-authenticate streaming viewers as spectators
- No character selection required

---

### Phase 2: 15-Minute Duel Cycle System

#### 2.1 StreamingDuelScheduler (Server)
**Files to create:**
- `packages/server/src/systems/StreamingDuelScheduler/index.ts`
- `packages/server/src/systems/StreamingDuelScheduler/types.ts`

**Key Features:**
```typescript
interface StreamingDuelCycle {
  cycleId: string;
  phase: "ANNOUNCEMENT" | "COUNTDOWN" | "FIGHTING" | "RESOLUTION";

  // Timing
  cycleStartTime: number;
  phaseStartTime: number;

  // Contestants (null during resolution)
  agent1Id: string | null;
  agent2Id: string | null;
  agent1Name: string | null;
  agent2Name: string | null;

  // Pre-duel positions (for return teleport)
  agent1OriginalPosition: [number, number, number] | null;
  agent2OriginalPosition: [number, number, number] | null;

  // Combat tracking
  agent1DamageDealt: number;
  agent2DamageDealt: number;

  // Result
  winnerId: string | null;
  winReason: "kill" | "hp_advantage" | "draw" | null;
}
```

**Events to emit:**
```typescript
// New events for streaming mode
streaming:cycle:started      // New 15-min cycle begins
streaming:announcement:start // 5-min announcement phase
streaming:contestants:set    // Two agents selected
streaming:countdown:tick     // 3-2-1 countdown
streaming:fight:start        // Combat begins
streaming:fight:end_warning  // 30 seconds remaining
streaming:fight:timeout      // Time expired, determine winner
streaming:resolution:start   // Winner announced
streaming:resolution:end     // Ready for next cycle
```

#### 2.2 Pre-Duel Preparation
**Files to modify:**
- `packages/server/src/systems/DuelSystem/index.ts`

**New Features:**
- `fillInventoryWithFood(playerId)` - Fill empty slots with shark/food
- `restoreFullHealth(playerId)` - Max HP, stamina, prayer
- `saveOriginalPosition(playerId)` - Store for return teleport
- `returnToOriginalPosition(playerId)` - After duel ends
- `removeDuelFood(playerId)` - Clean up inventory post-duel

```typescript
// Food filling logic
async function fillInventoryWithFood(playerId: string) {
  const inventory = await getInventory(playerId);
  const emptySlots = inventory.filter(slot => slot.itemId === null);

  for (const slot of emptySlots) {
    await addItemToSlot(playerId, slot.index, "shark", 1);
  }
}
```

---

### Phase 3: Streaming Camera System

#### 3.1 StreamingCameraController (Client)
**Files to create:**
- `packages/client/src/systems/StreamingCameraController.ts`

**Behavior:**
```
DURING ANNOUNCEMENT (0:00 - 5:00):
  - Camera switches between both contestants every 30 seconds
  - Random slight camera movements for visual interest

DURING COUNTDOWN (5:00 - 5:03):
  - Wide shot showing both contestants in arena

DURING FIGHT (5:03 - 14:45):
  - Camera follows the action
  - Switches to damaged player on big hits
  - Switches to attacker on special attacks
  - Auto-switch every 15-30 seconds if no events

DURING RESOLUTION (14:45 - 15:00):
  - Focus on winner
  - Victory camera angle
```

**Implementation:**
```typescript
class StreamingCameraController {
  private currentTarget: string | null = null;
  private switchInterval: NodeJS.Timeout | null = null;
  private phase: "announcement" | "fight" | "resolution" = "announcement";

  setPhase(phase: string, contestants: [string, string]) {
    this.phase = phase;
    this.contestants = contestants;
    this.setupCameraForPhase();
  }

  private setupCameraForPhase() {
    if (this.switchInterval) clearInterval(this.switchInterval);

    switch (this.phase) {
      case "announcement":
        // Switch every 30 seconds
        this.switchInterval = setInterval(() => this.switchTarget(), 30000);
        break;
      case "fight":
        // Event-driven + every 20 seconds fallback
        this.switchInterval = setInterval(() => this.switchTarget(), 20000);
        break;
      case "resolution":
        // Focus on winner only
        clearInterval(this.switchInterval);
        break;
    }
  }

  onCombatEvent(event: { attackerId, targetId, damage }) {
    if (this.phase !== "fight") return;

    // Switch to player who just took big damage
    if (event.damage > 10) {
      this.setTarget(event.targetId);
    }
  }
}
```

---

### Phase 4: Streaming Overlay UI

#### 4.1 Component Structure
```
StreamingOverlay/
├── StreamingOverlay.tsx          # Main container
├── DuelInfoPanel.tsx             # "Current Duel: X vs Y"
├── AgentStatsDisplay.tsx         # HP bars, levels, K/D
├── CountdownTimer.tsx            # Phase countdowns
├── LeaderboardPanel.tsx          # Left side rankings
├── AnnouncementBanner.tsx        # Big "NEXT DUEL IN 3:42"
├── FightHUD.tsx                  # During combat display
└── VictoryOverlay.tsx            # Winner announcement
```

#### 4.2 DuelInfoPanel
**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│                     CURRENT DUEL                            │
│                                                             │
│   [GPT-5 Avatar]              VS           [Claude Avatar]  │
│                                                             │
│      GPT-5                              Claude Sonnet 4     │
│   Combat Lv: 45                         Combat Lv: 42       │
│   Record: 12W - 3L                      Record: 10W - 5L    │
│                                                             │
│              ═══════════════════════════                    │
│                    FIGHT IN 2:34                            │
│              ═══════════════════════════                    │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3 AgentStatsDisplay (During Fight)
**Design:**
```
┌───────────────────────────┐     ┌───────────────────────────┐
│  GPT-5                    │     │  Claude Sonnet 4          │
│  ████████████░░░░ 78/99   │     │  ██████░░░░░░░░░ 45/99    │
│  Lv: 45  K: 12  D: 3      │     │  Lv: 42  K: 10  D: 5      │
└───────────────────────────┘     └───────────────────────────┘

              TIME REMAINING: 8:42
```

#### 4.4 LeaderboardPanel
**Design:**
```
┌─────────────────────────┐
│      LEADERBOARD       │
├─────────────────────────┤
│ 1. GPT-5          12-3  │
│ 2. Claude 4       10-5  │
│ 3. o3              9-4  │
│ 4. Grok 2          8-6  │
│ 5. Llama 70B       7-7  │
│ 6. GPT-4.1         6-8  │
│ 7. Claude 3.5      5-9  │
│ 8. Mixtral         4-10 │
│ 9. Grok Mini       3-11 │
│ 10. Claude Haiku   2-12 │
└─────────────────────────┘
```

---

### Phase 5: Leaderboard System

#### 5.1 Leaderboard API
**Files to create:**
- `packages/server/src/routes/leaderboard.ts`

**Endpoints:**
```typescript
// GET /api/leaderboard/agents
// Returns ranked list of model agents
{
  agents: [
    {
      rank: 1,
      characterId: "agent-openai-gpt-5",
      name: "GPT-5",
      provider: "openai",
      model: "gpt-5",
      wins: 12,
      losses: 3,
      winRate: 0.80,
      combatLevel: 45,
      killStreak: 5,
      currentStreak: 3,
      lastDuelAt: "2024-02-18T10:30:00Z"
    },
    // ...
  ]
}
```

#### 5.2 Stats Table Extension
**Files to modify:**
- `packages/server/src/database/schema.ts`

```sql
-- Add agent duel stats table
CREATE TABLE agentDuelStats (
  characterId TEXT PRIMARY KEY,
  agentName TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  totalDamageDealt INTEGER DEFAULT 0,
  totalDamageTaken INTEGER DEFAULT 0,
  killStreak INTEGER DEFAULT 0,
  currentStreak INTEGER DEFAULT 0,
  lastDuelAt TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_wins ON agentDuelStats(wins DESC);
CREATE INDEX idx_agent_winrate ON agentDuelStats((wins * 1.0 / NULLIF(wins + losses, 0)) DESC);
```

---

### Phase 6: Server-Client Sync

#### 6.1 Streaming State Broadcast
**WebSocket Events (Server → Client):**
```typescript
// Broadcast to all streaming viewers
broadcastStreamingState({
  type: "STREAMING_STATE_UPDATE",
  cycle: {
    phase: "ANNOUNCEMENT" | "COUNTDOWN" | "FIGHTING" | "RESOLUTION",
    cycleStartTime: number,
    phaseStartTime: number,
    phaseEndTime: number,

    agent1: {
      id: string,
      name: string,
      hp: number,
      maxHp: number,
      combatLevel: number,
      wins: number,
      losses: number,
      damageDealtThisFight: number
    } | null,

    agent2: { ... } | null,

    countdown: number | null,  // 3, 2, 1, 0 during countdown
    winner: string | null,     // Set during resolution
    winReason: string | null
  },
  leaderboard: AgentRanking[],
  cameraTarget: string  // Which agent camera should follow
});
```

#### 6.2 State Update Frequency
- **During Announcement**: Every 1 second (countdown timer)
- **During Fight**: Every 100ms (HP updates, damage)
- **During Resolution**: Every 500ms

---

## File Changes Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `packages/client/src/screens/StreamingMode.tsx` | Streaming mode entry |
| `packages/client/src/components/streaming/StreamingOverlay.tsx` | Main overlay |
| `packages/client/src/components/streaming/DuelInfoPanel.tsx` | Matchup display |
| `packages/client/src/components/streaming/AgentStatsDisplay.tsx` | HP/stats |
| `packages/client/src/components/streaming/LeaderboardPanel.tsx` | Rankings |
| `packages/client/src/components/streaming/CountdownTimer.tsx` | Timers |
| `packages/client/src/components/streaming/VictoryOverlay.tsx` | Winner display |
| `packages/client/src/systems/StreamingCameraController.ts` | Camera logic |
| `packages/server/src/systems/StreamingDuelScheduler/index.ts` | 15-min cycle |
| `packages/server/src/systems/StreamingDuelScheduler/types.ts` | Types |
| `packages/server/src/routes/leaderboard.ts` | Leaderboard API |

### Files to Modify

| File | Changes |
|------|---------|
| `packages/client/src/App.tsx` | Add /stream route |
| `packages/server/src/network/connection-handler.ts` | Streaming auth |
| `packages/server/src/systems/DuelSystem/index.ts` | Food filling, health restore |
| `packages/server/src/database/schema.ts` | Agent stats table |
| `packages/server/src/eliza/index.ts` | Init streaming scheduler |

---

## Implementation Order

### Week 1: Core Infrastructure
1. Create StreamingDuelScheduler with 15-min cycle
2. Implement food filling and health restoration
3. Add return teleportation logic
4. Create agentDuelStats table

### Week 2: Client Streaming Mode
5. Create StreamingMode.tsx entry point
6. Implement streaming WebSocket connection
7. Build StreamingCameraController
8. Add /stream route

### Week 3: UI Overlay
9. Build StreamingOverlay container
10. Create DuelInfoPanel
11. Create AgentStatsDisplay
12. Create CountdownTimer
13. Create LeaderboardPanel

### Week 4: Polish & Integration
14. Add VictoryOverlay
15. Implement camera switching logic
16. Add leaderboard API
17. Polish animations and transitions
18. Testing and bug fixes

---

## Key Technical Decisions

### 1. Separate Scheduler vs Modify Existing
**Decision**: Create new `StreamingDuelScheduler` rather than modify `DuelScheduler`
**Reason**: The 15-minute cycle with phases is fundamentally different from the current random interval scheduling. Keep them separate for clarity.

### 2. Food Item for Duels
**Decision**: Use "shark" (highest tier food)
**Reason**: Gives agents healing capability, extends fights, more exciting to watch

### 3. Winner Determination at Timeout
**Decision**: Higher HP percentage wins; if tied, compare damage dealt
**Reason**: Fair tie-breaking that rewards aggressive play

### 4. Camera Switching Algorithm
**Decision**: Event-driven (damage events) + time-based fallback
**Reason**: Shows the action while preventing static camera during lulls

### 5. Leaderboard Ranking
**Decision**: Win rate with minimum games tiebreaker
**Reason**: Rewards consistency while preventing new agents from topping with 1-0 record

---

## Testing Checklist

- [ ] 15-minute cycle runs correctly
- [ ] Agents selected and announced at cycle start
- [ ] Countdown works (3-2-1-FIGHT)
- [ ] Food properly fills inventory
- [ ] Health restored before fight
- [ ] Combat works normally during duel
- [ ] Winner determined correctly (kill or HP)
- [ ] Health restored after duel
- [ ] Duel food removed from inventory
- [ ] Agents teleported back to original positions
- [ ] Leaderboard updates correctly
- [ ] Camera follows agents appropriately
- [ ] All UI overlays display correctly
- [ ] Streaming mode accessible without login
- [ ] Multiple viewers can watch simultaneously
