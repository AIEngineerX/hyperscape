import { describe, expect, it, vi } from "vitest";
import { EventType, getDuelArenaConfig } from "@hyperscape/shared";
import { EmbeddedHyperscapeService } from "../EmbeddedHyperscapeService";

type SavedPlayerData = {
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  constitutionLevel?: number;
  constitutionXp?: number;
};

type TestEntity = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  isAgent?: boolean;
  position?: {
    x: number;
    y: number;
    z: number;
    set: (x: number, y: number, z: number) => void;
  };
};

function createMockWorld(options?: {
  characterId?: string;
  accountId?: string;
  characterName?: string;
  terrainHeight?: number;
  savedData?: SavedPlayerData | null;
  withTerrain?: boolean;
  networkSystem?: {
    requestServerMove?: (
      playerId: string,
      target: [number, number, number],
      options?: { runMode?: boolean },
    ) => boolean;
    cancelServerMove?: (playerId: string) => boolean;
  } | null;
}) {
  const characterId = options?.characterId ?? "character-1";
  const accountId = options?.accountId ?? "acct-1";
  const characterName = options?.characterName ?? "Agent One";
  const terrainHeight = options?.terrainHeight ?? 9.5;
  const withTerrain = options?.withTerrain ?? true;
  const savedData = options?.savedData ?? null;
  const networkSystem = options?.networkSystem ?? null;

  const entities = new Map<string, TestEntity>();
  const emit = vi.fn();

  const world = {
    entities: {
      items: entities,
      get: (id: string) => entities.get(id),
      add: (entityData: Record<string, unknown>) => {
        const id = String(entityData.id);
        const rawPosition = Array.isArray(entityData.position)
          ? (entityData.position as [number, number, number])
          : [0, 0, 0];
        const position = {
          x: rawPosition[0],
          y: rawPosition[1],
          z: rawPosition[2],
          set(x: number, y: number, z: number) {
            position.x = x;
            position.y = y;
            position.z = z;
          },
        };
        const entity: TestEntity = {
          id,
          type: String(entityData.type ?? "object"),
          isAgent: Boolean(entityData.isAgent),
          data: { ...entityData, position: [...rawPosition] },
          position,
        };
        entities.set(id, entity);
        return entity;
      },
      remove: (id: string) => {
        entities.delete(id);
      },
      getAllEntities: () => entities,
    },
    on: vi.fn(),
    off: vi.fn(),
    emit,
    getSystem: vi.fn((name: string) => {
      if (name === "database") {
        return {
          getCharactersAsync: async (requestedAccountId: string) =>
            requestedAccountId === accountId
              ? [
                  {
                    id: characterId,
                    name: characterName,
                    avatar: null,
                    wallet: null,
                  },
                ]
              : [],
          getPlayerAsync: async (requestedCharacterId: string) =>
            requestedCharacterId === characterId ? savedData : null,
        };
      }

      if (name === "terrain" && withTerrain) {
        return {
          getHeightAt: () => terrainHeight,
        };
      }

      if (name === "network") {
        return networkSystem;
      }

      return null;
    }),
    settings: {
      avatar: { url: "asset://avatars/test.vrm" },
    },
  };

  return { world, entities, emit, characterId, accountId, characterName };
}

describe("EmbeddedHyperscapeService", () => {
  it("grounds spawn to terrain height when there is no saved position", async () => {
    const ctx = createMockWorld({
      terrainHeight: 12,
      savedData: null,
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();

    const agent = ctx.entities.get(ctx.characterId);
    expect(agent).toBeDefined();
    expect(agent!.data.position).toEqual([0, 12.1, 0]);
    expect(agent!.data.health).toBe(10);
    expect(service.isSpawned()).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      EventType.PLAYER_JOINED,
      expect.objectContaining({
        playerId: ctx.characterId,
        isEmbeddedAgent: true,
      }),
    );
  });

  it("clamps saved positions onto terrain to avoid below-ground spawns", async () => {
    const ctx = createMockWorld({
      terrainHeight: 14,
      savedData: {
        positionX: 21,
        positionY: 2,
        positionZ: -4,
        constitutionLevel: 18,
      },
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();

    const agent = ctx.entities.get(ctx.characterId);
    expect(agent).toBeDefined();
    expect(agent!.data.position).toEqual([21, 14.1, -4]);
    expect(agent!.data.health).toBe(18);
  });

  it("clamps saved positions that are above terrain to the grounded spawn height", async () => {
    const ctx = createMockWorld({
      terrainHeight: 7.25,
      savedData: {
        positionX: -12,
        positionY: 120,
        positionZ: 3,
      },
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();

    const agent = ctx.entities.get(ctx.characterId);
    expect(agent).toBeDefined();
    expect(agent!.data.position).toEqual([-12, 7.35, 3]);
  });

  it("uses streaming spawn ring for agent ids and grounds to terrain", async () => {
    const agentId = "agent-1";
    const terrainHeight = 13;
    const ctx = createMockWorld({
      characterId: agentId,
      terrainHeight,
      savedData: {
        positionX: -999,
        positionY: -999,
        positionZ: -999,
      },
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();

    const agent = ctx.entities.get(ctx.characterId);
    expect(agent).toBeDefined();
    const spawnPosition = agent!.data.position as [number, number, number];

    const lobby = getDuelArenaConfig().lobbySpawnPoint;
    let hash = 0;
    for (let i = 0; i < agentId.length; i++) {
      hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
    }

    const angle = ((hash % 360) * Math.PI) / 180;
    const radius = 6 + (hash % 4);
    const expectedX = lobby.x + Math.cos(angle) * radius;
    const expectedZ = lobby.z + Math.sin(angle) * radius;

    expect(spawnPosition[0]).toBeCloseTo(expectedX, 5);
    expect(spawnPosition[1]).toBeCloseTo(terrainHeight + 0.1, 5);
    expect(spawnPosition[2]).toBeCloseTo(expectedZ, 5);
  });

  it("routes movement through the network tile movement API when available", async () => {
    const requestServerMove = vi.fn(() => true);
    const ctx = createMockWorld({
      networkSystem: {
        requestServerMove,
      },
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();
    await service.executeMove([8, 4, -3], true);

    expect(requestServerMove).toHaveBeenCalledWith(
      ctx.characterId,
      [8, 4, -3],
      { runMode: true },
    );
  });

  it("fallback movement updates both transform and serialized position", async () => {
    const ctx = createMockWorld({
      withTerrain: false,
      networkSystem: null,
    });
    const service = new EmbeddedHyperscapeService(
      ctx.world as never,
      ctx.characterId,
      ctx.accountId,
      ctx.characterName,
    );

    await service.initialize();
    await service.executeMove([15, 2, -9], false);

    const agent = ctx.entities.get(ctx.characterId);
    expect(agent).toBeDefined();
    expect(agent!.position).toMatchObject({ x: 15, y: 2, z: -9 });
    expect(agent!.data.position).toEqual([15, 2, -9]);
    expect(ctx.emit).toHaveBeenCalledWith(EventType.ENTITY_MODIFIED, {
      id: ctx.characterId,
      changes: { position: [15, 2, -9] },
    });
  });
});
