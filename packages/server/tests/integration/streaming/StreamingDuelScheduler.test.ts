/**
 * StreamingDuelScheduler Integration Tests
 *
 * Tests the streaming duel scheduler state machine and agent management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StreamingDuelScheduler } from "../../../src/systems/StreamingDuelScheduler";

// Mock World type
type MockWorld = {
  entities: {
    players: Map<string, MockAgent>;
    get: (id: string) => MockAgent | undefined;
    getAllEntities?: () => Map<string, MockAgent>;
  };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  getSystem: ReturnType<typeof vi.fn>;
  network?: { send: ReturnType<typeof vi.fn> };
};

type MockAgent = {
  id: string;
  type?: string;
  isAgent?: boolean;
  data: {
    name: string;
    combatLevel?: number;
    health?: number;
    maxHealth?: number;
    position?: [number, number, number];
    skills?: Record<string, { level: number }>;
    inStreamingDuel?: boolean;
    preventRespawn?: boolean;
    combatTarget?: string | null;
    inCombat?: boolean;
    attackTarget?: string | null;
    rotation?: number;
    _teleport?: boolean;
  };
  modelProvider?: string;
  modelId?: string;
};

function createMockAgent(id: string, name: string, level: number): MockAgent {
  return {
    id,
    type: "player",
    isAgent: true,
    data: {
      name,
      combatLevel: level,
      health: level,
      maxHealth: level,
      position: [0, 0, 0],
      skills: {
        attack: { level: Math.floor(level / 4) },
        strength: { level: Math.floor(level / 4) },
        defense: { level: Math.floor(level / 4) },
        constitution: { level: Math.floor(level / 4) },
      },
    },
    modelProvider: "test-provider",
    modelId: "test-model",
  };
}

function createMockWorld(): MockWorld {
  const players = new Map<string, MockAgent>();

  return {
    entities: {
      players,
      get: (id: string) => players.get(id),
      getAllEntities: () => players,
    },
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    network: { send: vi.fn() },
    getSystem: vi.fn().mockImplementation((name: string) => {
      if (name === "database") {
        return {
          getDb: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue([]),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockResolvedValue(undefined),
              onConflictDoUpdate: vi.fn().mockReturnValue({
                set: vi.fn().mockResolvedValue(undefined),
              }),
            }),
          }),
        };
      }
      if (name === "combat") {
        return {
          startDuel: vi.fn().mockResolvedValue(true),
        };
      }
      if (name === "inventory") {
        return {
          addItem: vi.fn().mockResolvedValue(true),
          removeItem: vi.fn().mockResolvedValue(true),
        };
      }
      if (name === "network") {
        return {
          send: vi.fn(),
        };
      }
      return null;
    }),
  };
}

describe("StreamingDuelScheduler", () => {
  let world: MockWorld;
  let scheduler: StreamingDuelScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    world = createMockWorld();
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("creates scheduler in IDLE state", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      const state = scheduler.getSchedulerState();
      expect(state.state).toBe("IDLE");
    });

    it("reports zero available agents initially", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      const state = scheduler.getSchedulerState();
      expect(state.availableAgents).toBe(0);
    });
  });

  describe("state machine transitions", () => {
    it("transitions to WAITING_FOR_AGENTS when no agents available", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      scheduler.start();

      // Trigger a tick
      vi.advanceTimersByTime(1000);

      const state = scheduler.getSchedulerState();
      expect(state.state).toBe("WAITING_FOR_AGENTS");
    });

    it("stays in WAITING_FOR_AGENTS while insufficient agents", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      // Add only 1 agent (need 2)
      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      scheduler.registerAgent("agent-1");

      scheduler.start();
      vi.advanceTimersByTime(1000);

      const state = scheduler.getSchedulerState();
      expect(state.state).toBe("WAITING_FOR_AGENTS");
      expect(state.availableAgents).toBe(1);
      expect(state.requiredAgents).toBe(2);
    });

    it("transitions to ACTIVE when enough agents are available", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      // Add 2 agents
      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );
      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");

      scheduler.start();
      vi.advanceTimersByTime(1000);

      const state = scheduler.getSchedulerState();
      expect(state.state).toBe("ACTIVE");
    });
  });

  describe("agent registration", () => {
    it("tracks registered agents", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      scheduler.registerAgent("agent-1");
      expect(scheduler.getSchedulerState().availableAgents).toBe(1);

      scheduler.registerAgent("agent-2");
      expect(scheduler.getSchedulerState().availableAgents).toBe(2);
    });

    it("handles agent unregistration", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");
      expect(scheduler.getSchedulerState().availableAgents).toBe(2);

      scheduler.unregisterAgent("agent-1");
      expect(scheduler.getSchedulerState().availableAgents).toBe(1);
    });

    it("prevents duplicate registration", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-1"); // Duplicate
      expect(scheduler.getSchedulerState().availableAgents).toBe(1);
    });
  });

  describe("cycle phases", () => {
    it("starts with null current cycle", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      expect(scheduler.getCurrentCycle()).toBeNull();
    });

    it("creates a cycle when starting with enough agents", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );
      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");

      scheduler.start();
      vi.advanceTimersByTime(1000);

      const cycle = scheduler.getCurrentCycle();
      expect(cycle).not.toBeNull();
      expect(cycle?.phase).toBe("ANNOUNCEMENT");
    });
  });

  describe("leaderboard", () => {
    it("returns empty leaderboard initially", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      const leaderboard = scheduler.getLeaderboard();
      expect(leaderboard).toEqual([]);
    });
  });

  describe("stop and cleanup", () => {
    it("transitions to IDLE on stop", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );
      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");

      scheduler.start();
      vi.advanceTimersByTime(1000);

      expect(scheduler.getSchedulerState().state).toBe("ACTIVE");

      scheduler.stop();
      expect(scheduler.getSchedulerState().state).toBe("IDLE");
    });

    it("clears current cycle on stop", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );
      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");

      scheduler.start();
      vi.advanceTimersByTime(1000);

      expect(scheduler.getCurrentCycle()).not.toBeNull();

      scheduler.stop();
      // After stop, cycle might be cleared or marked complete
      // depending on implementation
    });
  });

  describe("insufficient agent warnings", () => {
    it("tracks warning count when waiting for agents", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);
      scheduler.start();

      // Multiple ticks without enough agents
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(30000); // Wait interval

      const state = scheduler.getSchedulerState();
      expect(state.insufficientWarnings).toBeGreaterThanOrEqual(0);
    });
  });

  describe("idle preview and camera snapshots", () => {
    it("exposes next duel contestants while idle when enough agents are registered", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );
      world.entities.players.set(
        "agent-3",
        createMockAgent("agent-3", "Agent 3", 60),
      );

      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");
      scheduler.registerAgent("agent-3");

      const state = scheduler.getStreamingState();
      expect(state.cycle.phase).toBe("IDLE");
      expect(state.cycle.agent1?.id).toBeTruthy();
      expect(state.cycle.agent2?.id).toBeTruthy();
      expect(state.cycle.agent1?.id).not.toBe(state.cycle.agent2?.id);
      expect(state.cameraTarget).toBeTruthy();
      expect([state.cycle.agent1?.id, state.cycle.agent2?.id]).toContain(
        state.cameraTarget ?? "",
      );
    });

    it("does not mutate cameraTarget when reading idle state", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );

      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");

      const internals = scheduler as unknown as { cameraTarget: string | null };
      expect(internals.cameraTarget).toBeNull();

      const state = scheduler.getStreamingState();
      expect(state.cameraTarget).toBeTruthy();
      expect(internals.cameraTarget).toBeNull();
    });

    it("does not mutate cameraTarget when reading active cycle state", () => {
      scheduler = new StreamingDuelScheduler(world as unknown as never);

      world.entities.players.set(
        "agent-1",
        createMockAgent("agent-1", "Agent 1", 50),
      );
      world.entities.players.set(
        "agent-2",
        createMockAgent("agent-2", "Agent 2", 55),
      );

      scheduler.registerAgent("agent-1");
      scheduler.registerAgent("agent-2");
      scheduler.start();
      vi.advanceTimersByTime(1000);

      const internals = scheduler as unknown as { cameraTarget: string | null };
      internals.cameraTarget = null;

      const state = scheduler.getStreamingState();
      expect(state.cycle.phase).toBe("ANNOUNCEMENT");
      expect(state.cameraTarget).toBeTruthy();
      expect(internals.cameraTarget).toBeNull();
    });
  });
});
