import { describe, it, expect, beforeEach, vi } from "vitest";
import { TileMovementManager } from "../tile-movement";
import { BuildingCollisionService } from "@hyperscape/shared";

// Mocks
const createMockWorld = () => ({
  entities: {
    get: vi.fn(),
  },
  getSystem: vi.fn(),
  emit: vi.fn(),
  faceDirectionManager: { markPlayerMoved: vi.fn() },
});

const createMockBuildingService = () => ({
  getBuildingAt: vi.fn(),
  getPlayerFloor: vi.fn(),
  getFloorHeight: vi.fn(),
  handleStairTransition: vi.fn(),
  isTileWalkableInBuilding: vi.fn(),
});

describe("TileMovementManager - Building Integration", () => {
  let manager: TileMovementManager;
  let mockWorld: any;
  let mockBuildingService: any;
  let mockSendFn: any;

  beforeEach(() => {
    mockWorld = createMockWorld();
    mockBuildingService = createMockBuildingService();
    mockSendFn = vi.fn();

    mockWorld.getSystem.mockImplementation((name: string) => {
      if (name === "buildingCollision") return mockBuildingService;
      return null;
    });

    manager = new TileMovementManager(mockWorld, mockSendFn);
  });

  it("should call handleStairTransition during movement", () => {
    const playerId = "player1";
    manager.syncPlayerPosition(playerId, { x: 10, y: 0, z: 10 });

    const state = (manager as any).playerStates.get(playerId);
    state.path = [{ x: 11, z: 10 }];
    state.pathIndex = 0;
    state.previousTile = { x: 10, z: 10 };

    mockWorld.entities.get.mockReturnValue({
      position: { set: vi.fn() },
      data: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      node: { quaternion: { copy: vi.fn() } },
    });

    // Capture mutable arguments
    const capturedFrom: any = {};
    const capturedTo: any = {};
    mockBuildingService.handleStairTransition.mockImplementation(
      (_id: string, from: any, to: any) => {
        Object.assign(capturedFrom, from);
        Object.assign(capturedTo, to);
      },
    );

    manager.processPlayerTick(playerId, 1);

    expect(capturedFrom).toEqual({ x: 10, z: 10 });
    expect(capturedTo).toEqual({ x: 11, z: 10 });
  });

  it("should use floor height from BuildingCollisionService when in building", () => {
    const playerId = "player1";
    manager.syncPlayerPosition(playerId, { x: 10, y: 0, z: 10 });
    const state = (manager as any).playerStates.get(playerId);
    state.path = [{ x: 11, z: 10 }];
    state.pathIndex = 0;
    state.previousTile = { x: 10, z: 10 };

    const mockSetPosition = vi.fn();
    mockWorld.entities.get.mockReturnValue({
      position: { set: mockSetPosition },
      data: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      node: { quaternion: { copy: vi.fn() } },
    });

    mockBuildingService.getPlayerFloor.mockReturnValue(1);
    mockBuildingService.getBuildingAt.mockReturnValue("building1");
    mockBuildingService.getFloorHeight.mockReturnValue(5.0);

    manager.processPlayerTick(playerId, 1);

    expect(mockSetPosition).toHaveBeenCalledWith(11.5, 5.1, 10.5);
  });

  it("should use terrain height when not in building", () => {
    const playerId = "player1";
    manager.syncPlayerPosition(playerId, { x: 10, y: 0, z: 10 });
    const state = (manager as any).playerStates.get(playerId);
    state.path = [{ x: 11, z: 10 }];
    state.pathIndex = 0;
    state.previousTile = { x: 10, z: 10 };

    const mockSetPosition = vi.fn();
    mockWorld.entities.get.mockReturnValue({
      position: { set: mockSetPosition },
      data: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      node: { quaternion: { copy: vi.fn() } },
    });

    mockBuildingService.getPlayerFloor.mockReturnValue(0);
    mockBuildingService.getBuildingAt.mockReturnValue(null);

    const mockTerrain = {
      getHeightAt: vi.fn().mockReturnValue(2.0),
    };
    mockWorld.getSystem.mockImplementation((name: string) => {
      if (name === "buildingCollision") return mockBuildingService;
      if (name === "terrain") return mockTerrain;
      return null;
    });

    manager.processPlayerTick(playerId, 1);

    expect(mockSetPosition).toHaveBeenCalledWith(11.5, 2.1, 10.5);
  });
});
