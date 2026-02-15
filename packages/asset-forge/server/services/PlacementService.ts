/**
 * PlacementService - Manages manual object placements in the world
 */

import fs from "fs";
import path from "path";

interface Position {
  x: number;
  y: number;
  z: number;
}

interface Rotation {
  x: number;
  y: number;
  z: number;
}

interface BasePlacement {
  id: string;
  type: PlacementType;
  position: Position;
  rotation?: Rotation;
  scale?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
}

interface NPCPlacement extends BasePlacement {
  type: "npc";
  npcId: string;
  spawnRadius?: number;
  maxCount?: number;
  respawnTicks?: number;
  patrolPath?: Position[];
}

interface ResourcePlacement extends BasePlacement {
  type: "resource";
  resourceId: string;
  respawnTime?: number;
}

interface StationPlacement extends BasePlacement {
  type: "station";
  stationId: string;
  stationType: "bank" | "furnace" | "anvil" | "altar" | "range";
}

interface PropPlacement extends BasePlacement {
  type: "prop";
  modelPath: string;
}

interface TutorialPlacement extends BasePlacement {
  type: "tutorial";
  tutorialId: string;
  triggerType: "proximity" | "interaction" | "auto";
  triggerRadius?: number;
  message?: string;
  action?: string;
}

type PlacementType = "npc" | "resource" | "station" | "prop" | "tutorial";
type Placement =
  | NPCPlacement
  | ResourcePlacement
  | StationPlacement
  | PropPlacement
  | TutorialPlacement;

interface PlacementGroup {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  placements: Placement[];
  bounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

interface PlacementsManifest {
  version: number;
  lastModified: string;
  groups: PlacementGroup[];
}

export class PlacementService {
  private projectRoot: string;
  private placementsPath: string;
  private backupsDir: string;
  private cachedManifest: PlacementsManifest | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.placementsPath = path.join(
      projectRoot,
      "assets",
      "manifests",
      "placements.json",
    );
    this.backupsDir = path.join(projectRoot, "assets", "manifests", ".backups");
  }

  async initialize(): Promise<void> {
    const file = Bun.file(this.placementsPath);
    if (!(await file.exists())) {
      const defaultManifest: PlacementsManifest = {
        version: 1,
        lastModified: new Date().toISOString(),
        groups: [
          {
            id: "tutorial",
            name: "Tutorial Placements",
            description: "Objects and triggers for the new player tutorial",
            enabled: true,
            placements: [],
          },
          {
            id: "testing",
            name: "Testing Placements",
            description: "Temporary placements for development testing",
            enabled: false,
            placements: [],
          },
        ],
      };
      await this.saveManifest(defaultManifest);
    }
  }

  async loadManifest(): Promise<PlacementsManifest> {
    if (this.cachedManifest) {
      return this.cachedManifest;
    }

    const file = Bun.file(this.placementsPath);
    if (!(await file.exists())) {
      await this.initialize();
    }

    this.cachedManifest = (await Bun.file(
      this.placementsPath,
    ).json()) as PlacementsManifest;
    return this.cachedManifest;
  }

  /**
   * Save the placements manifest
   */
  private async saveManifest(manifest: PlacementsManifest): Promise<void> {
    // Create backup
    await this.createBackup();

    // Update timestamp
    manifest.lastModified = new Date().toISOString();

    // Save
    await Bun.write(this.placementsPath, JSON.stringify(manifest, null, 2));

    // Clear cache
    this.cachedManifest = null;
  }

  /**
   * Create a backup before saving
   */
  private async createBackup(): Promise<void> {
    const file = Bun.file(this.placementsPath);
    if (!(await file.exists())) return;

    await fs.promises.mkdir(this.backupsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      this.backupsDir,
      `placements.json.${timestamp}.backup`,
    );

    const content = await file.text();
    await Bun.write(backupPath, content);
  }

  /**
   * List all placement groups
   */
  async listGroups(): Promise<Omit<PlacementGroup, "placements">[]> {
    const manifest = await this.loadManifest();
    return manifest.groups.map(({ placements, ...group }) => ({
      ...group,
      placementCount: placements.length,
    }));
  }

  /**
   * Get a specific placement group
   */
  async getGroup(groupId: string): Promise<PlacementGroup | null> {
    const manifest = await this.loadManifest();
    return manifest.groups.find((g) => g.id === groupId) || null;
  }

  /**
   * Create a new placement group
   */
  async createGroup(
    group: Omit<PlacementGroup, "placements">,
  ): Promise<PlacementGroup> {
    const manifest = await this.loadManifest();

    // Check for duplicate ID
    if (manifest.groups.some((g) => g.id === group.id)) {
      throw new Error(`Group with ID "${group.id}" already exists`);
    }

    const newGroup: PlacementGroup = {
      ...group,
      placements: [],
    };

    manifest.groups.push(newGroup);
    await this.saveManifest(manifest);

    return newGroup;
  }

  /**
   * Update a placement group (metadata only, not placements)
   */
  async updateGroup(
    groupId: string,
    updates: Partial<Omit<PlacementGroup, "id" | "placements">>,
  ): Promise<PlacementGroup> {
    const manifest = await this.loadManifest();
    const group = manifest.groups.find((g) => g.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    Object.assign(group, updates);
    await this.saveManifest(manifest);

    return group;
  }

  /**
   * Delete a placement group
   */
  async deleteGroup(groupId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const index = manifest.groups.findIndex((g) => g.id === groupId);

    if (index === -1) {
      throw new Error(`Group not found: ${groupId}`);
    }

    manifest.groups.splice(index, 1);
    await this.saveManifest(manifest);
  }

  /**
   * Get all placements in a group
   */
  async getPlacements(groupId: string): Promise<Placement[]> {
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }
    return group.placements;
  }

  /**
   * Get a specific placement
   */
  async getPlacement(
    groupId: string,
    placementId: string,
  ): Promise<Placement | null> {
    const placements = await this.getPlacements(groupId);
    return placements.find((p) => p.id === placementId) || null;
  }

  private validatePlacement(placement: Placement): void {
    const errors: string[] = [];

    if (!placement.id?.trim()) errors.push("Missing id");

    const validTypes: PlacementType[] = [
      "npc",
      "resource",
      "station",
      "prop",
      "tutorial",
    ];
    if (!validTypes.includes(placement.type))
      errors.push(`Invalid type: ${placement.type}`);

    if (!placement.position) {
      errors.push("Missing position");
    } else {
      if (!Number.isFinite(placement.position.x))
        errors.push("Invalid position.x");
      if (!Number.isFinite(placement.position.y))
        errors.push("Invalid position.y");
      if (!Number.isFinite(placement.position.z))
        errors.push("Invalid position.z");
    }

    switch (placement.type) {
      case "npc":
        if (!(placement as NPCPlacement).npcId) errors.push("Missing npcId");
        break;
      case "resource":
        if (!(placement as ResourcePlacement).resourceId)
          errors.push("Missing resourceId");
        break;
      case "station": {
        const s = placement as StationPlacement;
        if (!s.stationId) errors.push("Missing stationId");
        if (
          !["bank", "furnace", "anvil", "altar", "range"].includes(
            s.stationType,
          )
        ) {
          errors.push(`Invalid stationType: ${s.stationType}`);
        }
        break;
      }
      case "prop":
        if (!(placement as PropPlacement).modelPath)
          errors.push("Missing modelPath");
        break;
      case "tutorial": {
        const t = placement as TutorialPlacement;
        if (!t.tutorialId) errors.push("Missing tutorialId");
        if (!["proximity", "interaction", "auto"].includes(t.triggerType)) {
          errors.push(`Invalid triggerType: ${t.triggerType}`);
        }
        break;
      }
    }

    if (errors.length)
      throw new Error(`Invalid placement: ${errors.join(", ")}`);
  }

  /**
   * Add a placement to a group
   */
  async addPlacement(
    groupId: string,
    placement: Placement,
  ): Promise<Placement> {
    // Validate placement data
    this.validatePlacement(placement);

    const manifest = await this.loadManifest();
    const group = manifest.groups.find((g) => g.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Check for duplicate ID within the group
    if (group.placements.some((p) => p.id === placement.id)) {
      throw new Error(
        `Placement with ID "${placement.id}" already exists in group "${groupId}"`,
      );
    }

    // Set defaults
    placement.enabled = placement.enabled ?? true;

    group.placements.push(placement);

    // Update group bounds
    this.updateGroupBounds(group);

    await this.saveManifest(manifest);
    return placement;
  }

  /**
   * Update a placement
   */
  async updatePlacement(
    groupId: string,
    placementId: string,
    updates: Partial<Placement>,
  ): Promise<Placement> {
    const manifest = await this.loadManifest();
    const group = manifest.groups.find((g) => g.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const placement = group.placements.find((p) => p.id === placementId);
    if (!placement) {
      throw new Error(
        `Placement not found: ${placementId} in group ${groupId}`,
      );
    }

    // Don't allow changing ID or type
    const {
      id: _,
      type: __,
      ...safeUpdates
    } = updates as Record<string, unknown>;
    Object.assign(placement, safeUpdates);

    // Update group bounds
    this.updateGroupBounds(group);

    await this.saveManifest(manifest);
    return placement;
  }

  /**
   * Delete a placement
   */
  async deletePlacement(groupId: string, placementId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const group = manifest.groups.find((g) => g.id === groupId);

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const index = group.placements.findIndex((p) => p.id === placementId);
    if (index === -1) {
      throw new Error(
        `Placement not found: ${placementId} in group ${groupId}`,
      );
    }

    group.placements.splice(index, 1);

    // Update group bounds
    this.updateGroupBounds(group);

    await this.saveManifest(manifest);
  }

  /**
   * Move a placement to a different group
   */
  async movePlacement(
    fromGroupId: string,
    toGroupId: string,
    placementId: string,
  ): Promise<Placement> {
    const manifest = await this.loadManifest();
    const fromGroup = manifest.groups.find((g) => g.id === fromGroupId);
    const toGroup = manifest.groups.find((g) => g.id === toGroupId);

    if (!fromGroup) {
      throw new Error(`Source group not found: ${fromGroupId}`);
    }
    if (!toGroup) {
      throw new Error(`Target group not found: ${toGroupId}`);
    }

    const placementIndex = fromGroup.placements.findIndex(
      (p) => p.id === placementId,
    );
    if (placementIndex === -1) {
      throw new Error(
        `Placement not found: ${placementId} in group ${fromGroupId}`,
      );
    }

    // Remove from source, add to target
    const [placement] = fromGroup.placements.splice(placementIndex, 1);
    toGroup.placements.push(placement);

    // Update bounds for both groups
    this.updateGroupBounds(fromGroup);
    this.updateGroupBounds(toGroup);

    await this.saveManifest(manifest);
    return placement;
  }

  /**
   * Get all enabled placements (for game runtime)
   */
  async getEnabledPlacements(): Promise<Placement[]> {
    const manifest = await this.loadManifest();
    const result: Placement[] = [];

    for (const group of manifest.groups) {
      if (!group.enabled) continue;

      for (const placement of group.placements) {
        if (placement.enabled !== false) {
          result.push(placement);
        }
      }
    }

    return result;
  }

  /**
   * Get placements within a bounding box
   */
  async getPlacementsInBounds(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ): Promise<Placement[]> {
    const all = await this.getEnabledPlacements();
    return all.filter(
      (p) =>
        p.position.x >= minX &&
        p.position.x <= maxX &&
        p.position.z >= minZ &&
        p.position.z <= maxZ,
    );
  }

  /**
   * Update the bounds of a placement group based on its placements
   */
  private updateGroupBounds(group: PlacementGroup): void {
    if (group.placements.length === 0) {
      delete group.bounds;
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;

    for (const placement of group.placements) {
      minX = Math.min(minX, placement.position.x);
      maxX = Math.max(maxX, placement.position.x);
      minZ = Math.min(minZ, placement.position.z);
      maxZ = Math.max(maxZ, placement.position.z);
    }

    group.bounds = { minX, maxX, minZ, maxZ };
  }

  /**
   * Clear the cache (call when external changes are made)
   */
  clearCache(): void {
    this.cachedManifest = null;
  }
}

// Export types for use in routes
export type {
  Placement,
  PlacementGroup,
  PlacementsManifest,
  NPCPlacement,
  ResourcePlacement,
  StationPlacement,
  PropPlacement,
  TutorialPlacement,
  PlacementType,
  Position,
  Rotation,
};
