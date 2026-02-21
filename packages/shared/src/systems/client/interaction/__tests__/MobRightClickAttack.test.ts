/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "../../../../types/events/event-types";
import { ContextMenuController } from "../ContextMenuController";
import { MobInteractionHandler } from "../handlers/MobInteractionHandler";
import type { ContextMenuAction, RaycastTarget } from "../types";

function createMobTarget(health: number = 12): RaycastTarget {
  return {
    entityId: "mob-goblin-1",
    entityType: "mob",
    entity: {
      getMobData: () => ({
        health,
        level: 2,
        type: "goblin",
      }),
      config: {
        mobType: "goblin",
      },
    } as unknown as RaycastTarget["entity"],
    name: "Goblin",
    position: { x: 10, y: 0, z: 10 },
    hitPoint: { x: 10, y: 0, z: 10 },
    distance: 5,
  };
}

describe("Mob right-click attack flow", () => {
  const send = vi.fn();
  const emit = vi.fn();
  const addChat = vi.fn();

  const world = {
    network: { send },
    emit,
    chat: { add: addChat },
    getPlayer: () => ({ id: "player-local-1", data: { id: "player-local-1" } }),
  } as unknown as ConstructorParameters<typeof MobInteractionHandler>[0];

  const actionQueue = {
    isDebounced: vi.fn().mockReturnValue(false),
  } as unknown as ConstructorParameters<typeof MobInteractionHandler>[1];

  beforeEach(() => {
    send.mockClear();
    emit.mockClear();
    addChat.mockClear();
    vi.mocked(actionQueue.isDebounced).mockReset();
    vi.mocked(actionQueue.isDebounced).mockReturnValue(false);
  });

  it("builds an Attack action for a living mob and sends attackMob when selected", () => {
    const handler = new MobInteractionHandler(world, actionQueue);
    const target = createMobTarget(12);

    const actions = handler.getContextMenuActions(target);
    const attackAction = actions.find((action) => action.id === "attack");

    expect(attackAction).toBeDefined();
    attackAction?.handler();

    expect(emit).toHaveBeenCalledWith(EventType.COMBAT_FACE_TARGET, {
      playerId: "player-local-1",
      targetId: "mob-goblin-1",
    });
    expect(send).toHaveBeenCalledWith("attackMob", {
      mobId: "mob-goblin-1",
      attackType: "melee",
    });
  });

  it("omits context actions for dead mobs", () => {
    const handler = new MobInteractionHandler(world, actionQueue);
    const target = createMobTarget(0);

    const actions = handler.getContextMenuActions(target);
    expect(actions).toEqual([]);
  });

  it("ContextMenuController executes selected action for matching target", () => {
    const controller = new ContextMenuController();
    const attackHandler = vi.fn();
    const observedDetails: unknown[] = [];

    const onContextMenu = (event: Event) => {
      const custom = event as CustomEvent;
      observedDetails.push(custom.detail);
    };

    window.addEventListener("contextmenu", onContextMenu);

    const target = createMobTarget(12);
    const actions: ContextMenuAction[] = [
      {
        id: "attack",
        label: "Attack Goblin (Level: 2)",
        enabled: true,
        priority: 1,
        handler: attackHandler,
      },
    ];

    controller.showMenu(target, actions, 240, 180);
    expect(observedDetails.length).toBe(1);

    window.dispatchEvent(
      new CustomEvent("contextmenu:select", {
        detail: {
          actionId: "attack",
          targetId: "mob-goblin-1",
        },
      }),
    );

    expect(attackHandler).toHaveBeenCalledTimes(1);

    controller.destroy();
    window.removeEventListener("contextmenu", onContextMenu);
  });
});
