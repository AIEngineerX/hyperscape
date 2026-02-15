/**
 * Placement Routes - API for managing manual object placements in the world
 */

import { Elysia, t } from "elysia";
import type { PlacementService } from "../services/PlacementService";
import * as Models from "../models";

const PositionSchema = t.Object({
  x: t.Number(),
  y: t.Number(),
  z: t.Number(),
});

const RotationSchema = t.Object({
  x: t.Number(),
  y: t.Number(),
  z: t.Number(),
});

const BasePlacementSchema = t.Object({
  id: t.String({ minLength: 1 }),
  type: t.Union([
    t.Literal("npc"),
    t.Literal("resource"),
    t.Literal("station"),
    t.Literal("prop"),
    t.Literal("tutorial"),
  ]),
  position: PositionSchema,
  rotation: t.Optional(RotationSchema),
  scale: t.Optional(t.Number()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
  tags: t.Optional(t.Array(t.String())),
  enabled: t.Optional(t.Boolean()),
});

// Type-specific placement schemas
const NPCPlacementSchema = t.Composite([
  BasePlacementSchema,
  t.Object({
    type: t.Literal("npc"),
    npcId: t.String({ minLength: 1 }),
    spawnRadius: t.Optional(t.Number()),
    maxCount: t.Optional(t.Number()),
    respawnTicks: t.Optional(t.Number()),
    patrolPath: t.Optional(t.Array(PositionSchema)),
  }),
]);

const ResourcePlacementSchema = t.Composite([
  BasePlacementSchema,
  t.Object({
    type: t.Literal("resource"),
    resourceId: t.String({ minLength: 1 }),
    respawnTime: t.Optional(t.Number()),
  }),
]);

const StationPlacementSchema = t.Composite([
  BasePlacementSchema,
  t.Object({
    type: t.Literal("station"),
    stationId: t.String({ minLength: 1 }),
    stationType: t.Union([
      t.Literal("bank"),
      t.Literal("furnace"),
      t.Literal("anvil"),
      t.Literal("altar"),
      t.Literal("range"),
    ]),
  }),
]);

const PropPlacementSchema = t.Composite([
  BasePlacementSchema,
  t.Object({
    type: t.Literal("prop"),
    modelPath: t.String({ minLength: 1 }),
  }),
]);

const TutorialPlacementSchema = t.Composite([
  BasePlacementSchema,
  t.Object({
    type: t.Literal("tutorial"),
    tutorialId: t.String({ minLength: 1 }),
    triggerType: t.Union([
      t.Literal("proximity"),
      t.Literal("interaction"),
      t.Literal("auto"),
    ]),
    triggerRadius: t.Optional(t.Number()),
    message: t.Optional(t.String()),
    action: t.Optional(t.String()),
  }),
]);

// Union of all placement types
const PlacementSchema = t.Union([
  NPCPlacementSchema,
  ResourcePlacementSchema,
  StationPlacementSchema,
  PropPlacementSchema,
  TutorialPlacementSchema,
]);

// Placement group schema
const PlacementGroupSchema = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  enabled: t.Boolean(),
  placementCount: t.Optional(t.Number()),
  bounds: t.Optional(
    t.Object({
      minX: t.Number(),
      maxX: t.Number(),
      minZ: t.Number(),
      maxZ: t.Number(),
    }),
  ),
});

const PlacementGroupWithPlacementsSchema = t.Composite([
  PlacementGroupSchema,
  t.Object({
    placements: t.Array(PlacementSchema),
  }),
]);

// Create group request
const CreateGroupRequest = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  enabled: t.Optional(t.Boolean()),
});

// Update group request
const UpdateGroupRequest = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String()),
  enabled: t.Optional(t.Boolean()),
});

export const createPlacementRoutes = (placementService: PlacementService) => {
  return new Elysia({ prefix: "/api/placements", name: "placements" }).guard(
    {
      beforeHandle: ({ request }) => {
        console.log(
          `[Placements] ${request.method} ${new URL(request.url).pathname}`,
        );
      },
    },
    (app) =>
      app

        .get(
          "/groups",
          async () => {
            const groups = await placementService.listGroups();
            return groups;
          },
          {
            response: t.Array(PlacementGroupSchema),
            detail: {
              tags: ["Placements"],
              summary: "List placement groups",
              description:
                "Returns all placement groups with metadata (without placements).",
            },
          },
        )
        .get(
          "/groups/:groupId",
          async ({ params: { groupId }, set }) => {
            const group = await placementService.getGroup(groupId);
            if (!group) {
              set.status = 404;
              return { error: `Group not found: ${groupId}` };
            }
            return group;
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
            }),
            response: {
              200: PlacementGroupWithPlacementsSchema,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Get placement group",
              description:
                "Returns a specific placement group with all its placements.",
            },
          },
        )
        .post(
          "/groups",
          async ({ body }) => {
            const group = await placementService.createGroup({
              id: body.id,
              name: body.name,
              description: body.description,
              enabled: body.enabled ?? true,
            });
            return group;
          },
          {
            body: CreateGroupRequest,
            response: PlacementGroupWithPlacementsSchema,
            detail: {
              tags: ["Placements"],
              summary: "Create placement group",
              description: "Creates a new placement group.",
            },
          },
        )
        .put(
          "/groups/:groupId",
          async ({ params: { groupId }, body, set }) => {
            const group = await placementService.updateGroup(groupId, body);
            return group;
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
            }),
            body: UpdateGroupRequest,
            response: {
              200: PlacementGroupWithPlacementsSchema,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Update placement group",
              description:
                "Updates group metadata (name, description, enabled).",
            },
          },
        )
        .delete(
          "/groups/:groupId",
          async ({ params: { groupId }, set }) => {
            await placementService.deleteGroup(groupId);
            return { success: true, message: `Group ${groupId} deleted` };
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.SuccessResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Delete placement group",
              description: "Deletes a placement group and all its placements.",
            },
          },
        )
        .get(
          "/groups/:groupId/placements",
          async ({ params: { groupId }, set }) => {
            const placements = await placementService.getPlacements(groupId);
            return placements;
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
            }),
            response: {
              200: t.Array(PlacementSchema),
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "List placements in group",
              description: "Returns all placements in a specific group.",
            },
          },
        )
        .post(
          "/groups/:groupId/placements",
          async ({ params: { groupId }, body }) => {
            const placement = await placementService.addPlacement(
              groupId,
              body,
            );
            return placement;
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
            }),
            body: PlacementSchema,
            response: {
              200: PlacementSchema,
              400: Models.ErrorResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Add placement",
              description: "Adds a new placement to a group.",
            },
          },
        )
        .put(
          "/groups/:groupId/placements/:placementId",
          async ({ params: { groupId, placementId }, body }) => {
            const placement = await placementService.updatePlacement(
              groupId,
              placementId,
              body,
            );
            return placement;
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
              placementId: t.String({ minLength: 1 }),
            }),
            body: t.Partial(PlacementSchema),
            response: {
              200: PlacementSchema,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Update placement",
              description: "Updates an existing placement.",
            },
          },
        )
        .delete(
          "/groups/:groupId/placements/:placementId",
          async ({ params: { groupId, placementId } }) => {
            await placementService.deletePlacement(groupId, placementId);
            return {
              success: true,
              message: `Placement ${placementId} deleted from group ${groupId}`,
            };
          },
          {
            params: t.Object({
              groupId: t.String({ minLength: 1 }),
              placementId: t.String({ minLength: 1 }),
            }),
            response: {
              200: Models.SuccessResponse,
              404: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Delete placement",
              description: "Deletes a placement from a group.",
            },
          },
        )
        .get(
          "/enabled",
          async () => {
            const placements = await placementService.getEnabledPlacements();
            return placements;
          },
          {
            response: t.Array(PlacementSchema),
            detail: {
              tags: ["Placements"],
              summary: "Get enabled placements",
              description:
                "Returns all enabled placements from all enabled groups. Used by game runtime.",
            },
          },
        )

        .get(
          "/bounds",
          async ({ query, set }) => {
            const parse = (v: string | undefined, def: number) => {
              if (!v) return def;
              const n = parseFloat(v);
              return Number.isFinite(n) ? n : def;
            };

            const minX = parse(query.minX, -1000);
            const maxX = parse(query.maxX, 1000);
            const minZ = parse(query.minZ, -1000);
            const maxZ = parse(query.maxZ, 1000);

            if (minX > maxX || minZ > maxZ) {
              set.status = 400;
              return { error: "Invalid bounds: min must be <= max" };
            }

            return placementService.getPlacementsInBounds(
              minX,
              maxX,
              minZ,
              maxZ,
            );
          },
          {
            query: t.Object({
              minX: t.Optional(t.String()),
              maxX: t.Optional(t.String()),
              minZ: t.Optional(t.String()),
              maxZ: t.Optional(t.String()),
            }),
            response: {
              200: t.Array(PlacementSchema),
              400: Models.ErrorResponse,
            },
            detail: {
              tags: ["Placements"],
              summary: "Get placements in bounds",
              description:
                "Returns enabled placements within bounds. Defaults: ±1000.",
            },
          },
        ),
  );
};
