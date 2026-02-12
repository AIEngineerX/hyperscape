/**
 * PacketHandlers.ts - Packet Handler Subsystem
 *
 * Handles all incoming server packet processing for the client.
 * Extracted from ClientNetwork to isolate packet handler concerns.
 *
 * Key Features:
 * - Processes all `on*` packet handlers (snapshot, entity, combat, UI, etc.)
 * - Routes packets to appropriate world systems via events
 * - Manages entity interpolation/tile state during entity lifecycle events
 * - Caches latest state for late-mounting UI components
 *
 * Architecture:
 * - Plain class (not a System subclass)
 * - Receives PacketHandlerContext for access to ClientNetwork state
 * - ClientNetwork delegates all packet handling calls here via flush()
 */

import * as THREE from "../../../extras/three/three";
import { Emotes } from "../../../data/playerEmotes";
import { emoteUrls } from "../../../data/playerEmotes";
import { storage } from "../../../platform/shared/storage";
import type {
  ChatMessage,
  EntityData,
  SnapshotData,
  World,
} from "../../../types";
import { EventType } from "../../../types/events";
import type { FletchingInterfaceOpenPayload } from "../../../types/events";
import { DeathState } from "../../../types/entities";
import type {
  FriendsListSyncData,
  FriendRequest,
  FriendStatusUpdateData,
} from "../../../types/game/social-types";
import { PlayerLocal } from "../../../entities/player/PlayerLocal";
import type { TileInterpolator } from "../TileInterpolator";
import type { InterpolationEngine } from "./InterpolationEngine";
import type { TileCoord } from "../../shared/movement/TileSystem";
import type { SystemLogger } from "../../../utils/Logger";

// Pre-allocated temporaries (shared with ClientNetwork - same module-level pattern)
const _v3_1 = new THREE.Vector3();
const _quat_1 = new THREE.Quaternion();

/**
 * Context interface for PacketHandlers to access ClientNetwork state.
 * Keeps the dependency direction clean: PacketHandlers -> context -> ClientNetwork.
 */
export interface PacketHandlerContext {
  /** World reference for entity lookups, system access, event emission */
  readonly world: World;

  /** Our connection/player ID assigned by the server */
  id: string | null;

  /** Whether we're connected to the server */
  connected: boolean;

  /** API base URL from server */
  apiUrl: string | null;

  /** Max upload size from server */
  maxUploadSize: number;

  /** Whether running as embedded spectator */
  readonly isEmbeddedSpectator: boolean;

  /** Server time offset for clock sync */
  serverTimeOffset: number;

  /** World time offset for day/night sync */
  worldTimeOffset: number;

  /** Embedded character ID (read at init) */
  embeddedCharacterId: string | null;

  /** Pending entity modifications (for entities not yet created) */
  readonly pendingModifications: Map<string, Array<Record<string, unknown>>>;
  readonly pendingModificationTimestamps: Map<string, number>;
  readonly pendingModificationLimitReached: Set<string>;

  /** Dead players tracking (prevents position updates during death) */
  readonly deadPlayers: Set<string>;

  /** Spectator mode state */
  spectatorFollowEntity: string | undefined;
  spectatorTargetPending: boolean;
  spectatorRetryInterval: ReturnType<typeof setInterval> | number | null;

  /** Tile-based interpolation for RuneScape-style movement */
  readonly tileInterpolator: TileInterpolator;

  /** Entity interpolation engine (smooth remote entity movement) */
  readonly interpolationEngine: InterpolationEngine;

  /** Cached state for late-mounting UI */
  lastCharacterList: Array<{
    id: string;
    name: string;
    level?: number;
    lastLocation?: { x: number; y: number; z: number };
  }> | null;
  lastInventoryByPlayerId: Record<
    string,
    {
      playerId: string;
      items: Array<{ slot: number; itemId: string; quantity: number }>;
      coins: number;
      maxSlots: number;
    }
  >;
  lastSkillsByPlayerId: Record<
    string,
    Record<string, { level: number; xp: number }>
  >;
  lastEquipmentByPlayerId: Record<string, Record<string, unknown>>;
  lastAttackStyleByPlayerId: Record<
    string,
    {
      currentStyle: { id: string };
      availableStyles: unknown;
      canChange: boolean;
    }
  >;
  lastPrayerStateByPlayerId: Record<
    string,
    { points: number; maxPoints: number; active: string[] }
  >;
  lastActionBarState: {
    barId: string;
    slotCount: number;
    slots: Array<{ slotIndex: number; itemId?: string; actionId?: string }>;
  } | null;

  /** Send a packet to the server */
  send<T = unknown>(name: string, data?: T): void;

  /** Emit a typed event on the system's EventBus */
  emitTypedEvent(type: string, data: Record<string, unknown>): void;

  /** Emit an event on the SystemBase EventEmitter (for Pattern A listeners) */
  emit(event: string, data: unknown): void;

  /** Logger */
  readonly logger: SystemLogger;
}

/**
 * Handles all incoming server packets for the client.
 *
 * Each method corresponds to a server packet type (e.g., onSnapshot, onEntityAdded).
 * The flush() method in ClientNetwork looks up handlers on this class by name.
 */
export class PacketHandlers {
  private readonly ctx: PacketHandlerContext;

  constructor(ctx: PacketHandlerContext) {
    this.ctx = ctx;
  }

  // ========================================================================
  // Core Connection / Auth Handlers
  // ========================================================================

  /**
   * No-op handler for authResult packets.
   * Auth is handled by the temporary handleAuthResult listener during connection.
   * This method exists to prevent "No handler" warnings from flush().
   */
  onAuthResult(_data: { success: boolean; error?: string }): void {
    this.ctx.logger.debug(
      "onAuthResult received (already handled during connect)",
    );
  }

  // ========================================================================
  // Snapshot (Initial World State)
  // ========================================================================

  async onSnapshot(data: SnapshotData): Promise<void> {
    const ctx = this.ctx;
    ctx.id = data.id;
    ctx.connected = true;

    // CRITICAL: Ensure world.network points to the ClientNetwork instance and has our ID
    if (
      !ctx.world.network ||
      (ctx.world.network as { id?: string }).id !== ctx.id
    ) {
      // The caller (ClientNetwork) is the actual network object on world
      // This is a safety check - normally world.network is already set
    }

    // Check if this is a spectator connection
    const isSpectatorMode =
      (data as { spectatorMode?: boolean }).spectatorMode === true;
    const followEntityId = (data as { followEntity?: string }).followEntity;

    if (isSpectatorMode) {
      ctx.logger.info(
        "Spectator mode detected - skipping character selection and enterWorld",
      );
      ctx.logger.info(
        `Spectator snapshot contains ${data.entities?.length || 0} entities`,
      );
      if (followEntityId) {
        ctx.logger.info(`Spectator will follow entity: ${followEntityId}`);
        ctx.spectatorFollowEntity = followEntityId;
      }
    } else {
      const isCharacterSelectMode =
        Array.isArray(data.entities) &&
        data.entities.length === 0 &&
        Array.isArray((data as { characters?: unknown[] }).characters);

      console.log("[PlayerLoading] Snapshot received", {
        entitiesCount: data.entities?.length ?? "undefined",
        hasCharacters: Array.isArray(
          (data as { characters?: unknown[] }).characters,
        ),
        isCharacterSelectMode,
      });

      if (isCharacterSelectMode) {
        const characterId =
          ctx.embeddedCharacterId ||
          (typeof sessionStorage !== "undefined"
            ? sessionStorage.getItem("selectedCharacterId")
            : null);

        console.log("[PlayerLoading] Character select mode detected", {
          characterId,
          isEmbedded: ctx.isEmbeddedSpectator,
        });

        if (characterId) {
          if (ctx.isEmbeddedSpectator) {
            ctx.send("characterSelected", { characterId });
          }
          console.log(
            `[PlayerLoading] Sending enterWorld with characterId: ${characterId}`,
          );
          ctx.send("enterWorld", { characterId });
        } else {
          console.warn(
            "[PlayerLoading] No characterId available, skipping auto-enter world",
          );
        }
      }
    }

    // Ensure Physics is fully initialized before processing entities
    if (!ctx.world.physics.physics) {
      let attempts = 0;
      while (!ctx.world.physics.physics && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }
      if (!ctx.world.physics.physics) {
        ctx.logger.error("Physics failed to initialize after waiting");
      }
    }

    ctx.serverTimeOffset = data.serverTime - performance.now();
    ctx.apiUrl = data.apiUrl || null;

    // Sync world time for day/night cycle
    const worldTime = (data as { worldTime?: number }).worldTime;
    if (worldTime !== undefined) {
      ctx.worldTimeOffset = worldTime - ctx.world.getTime();
    }
    ctx.maxUploadSize = data.maxUploadSize || 10 * 1024 * 1024;

    ctx.world.assetsUrl = data.assetsUrl || "/";

    const loader = ctx.world.loader!;
    if (loader) {
      if (
        data.settings &&
        typeof data.settings === "object" &&
        "model" in data.settings
      ) {
        const settings = data.settings as { model?: string };
        if (settings?.model) {
          loader.preload("model", settings.model);
        }
      } else if (ctx.world.environment?.base?.model) {
        loader.preload("model", ctx.world.environment.base.model);
      }
      if (
        data.settings &&
        typeof data.settings === "object" &&
        "avatar" in data.settings
      ) {
        const settings = data.settings as { avatar?: { url?: string } };
        if (settings?.avatar?.url) {
          loader.preload("avatar", settings.avatar.url);
        }
      }
      for (const url of emoteUrls) {
        loader.preload("emote", url as string);
      }
    }

    if (data.settings) {
      ctx.world.settings.deserialize(data.settings);
    }

    if (data.chat) {
      ctx.world.chat.deserialize(data.chat);
    }

    if (data.entities) {
      await ctx.world.entities.deserialize(data.entities);

      if (loader) {
        let playerAvatarPreloaded = false;
        for (const entity of ctx.world.entities.values()) {
          if (entity.data?.type === "player" && entity.data?.owner === ctx.id) {
            const url = entity.data.sessionAvatar || entity.data.avatar;
            if (url && typeof url === "string") {
              loader.preload("avatar", url);
              playerAvatarPreloaded = true;
              break;
            }
          }
        }
        if (!playerAvatarPreloaded) {
          for (const item of data.entities) {
            const entity = item as {
              type?: string;
              owner?: string;
              sessionAvatar?: string;
              avatar?: string;
            };
            if (entity.type === "player" && entity.owner === ctx.id) {
              const url = entity.sessionAvatar || entity.avatar;
              if (url) {
                loader.preload("avatar", url);
                playerAvatarPreloaded = true;
                break;
              }
            }
          }
        }
        loader.execPreload();
      }

      // Set initial serverPosition for local player immediately to avoid Y=0 flash
      for (const entityData of data.entities) {
        if (
          entityData &&
          entityData.type === "player" &&
          entityData.owner === ctx.id
        ) {
          const local = ctx.world.entities.get(entityData.id);
          if (local instanceof PlayerLocal) {
            const pos = entityData.position as [number, number, number];
            local.position.set(pos[0], pos[1], pos[2]);
            local.updateServerPosition(pos[0], pos[1], pos[2]);
          } else {
            ctx.logger.warn("Local player entity not found after deserialize!");
          }
        }
      }
      // Apply pending modifications to all newly added entities
      for (const entityData of data.entities) {
        if (entityData && entityData.id) {
          this.applyPendingModifications(entityData.id);
        }
      }
    }

    // Character-select mode: surface character list immediately
    if (
      Array.isArray(data.entities) &&
      data.entities.length === 0 &&
      (data as { account?: unknown }).account
    ) {
      const list = ctx.lastCharacterList || [];
      ctx.world.emit(EventType.CHARACTER_LIST, { characters: list });
    }

    // Spectator mode: Auto-follow the target entity after entities are loaded
    const spectatorFollowId = ctx.spectatorFollowEntity;
    if (isSpectatorMode && spectatorFollowId) {
      ctx.spectatorTargetPending = true;

      const MAX_RETRY_SECONDS = 15;
      let retryCount = 0;

      const setCameraTarget = (entity: unknown) => {
        const camera = ctx.world.getSystem("camera") as {
          setTarget?: (target: unknown) => void;
        };
        if (camera?.setTarget) {
          ctx.logger.info(
            `Setting camera target to entity ${spectatorFollowId}`,
          );
          camera.setTarget(entity);
        } else {
          ctx.logger.warn(
            "Camera system not found or missing setTarget method",
          );
        }
      };

      const attemptFollow = (): boolean => {
        const targetEntity =
          ctx.world.entities.items.get(spectatorFollowId) ||
          ctx.world.entities.players.get(spectatorFollowId);

        if (targetEntity) {
          ctx.spectatorTargetPending = false;
          if (ctx.spectatorRetryInterval) {
            clearInterval(
              ctx.spectatorRetryInterval as ReturnType<typeof setInterval>,
            );
            ctx.spectatorRetryInterval = null;
          }
          ctx.logger.info(`Spectator following entity ${spectatorFollowId}`);
          setCameraTarget(targetEntity);
          return true;
        }
        return false;
      };

      setTimeout(() => {
        if (!attemptFollow()) {
          ctx.logger.info(
            `Spectator target entity ${spectatorFollowId} not found - starting retry loop`,
          );

          ctx.spectatorRetryInterval = setInterval(() => {
            retryCount++;

            if (attemptFollow()) {
              ctx.logger.info(`Found spectator target after ${retryCount}s`);
              return;
            }

            if (retryCount >= MAX_RETRY_SECONDS) {
              if (ctx.spectatorRetryInterval !== null) {
                clearInterval(
                  ctx.spectatorRetryInterval as ReturnType<typeof setInterval>,
                );
              }
              ctx.spectatorRetryInterval = null;
              ctx.spectatorTargetPending = false;
              ctx.logger.error(
                `Agent entity ${spectatorFollowId} not found after ${MAX_RETRY_SECONDS}s`,
              );
            } else if (retryCount % 5 === 0) {
              ctx.logger.info(
                `Still waiting for agent entity (${retryCount}/${MAX_RETRY_SECONDS}s)...`,
              );
            }
          }, 1000);
        }
      }, 100);
    }

    if (data.livekit) {
      ctx.world.livekit?.deserialize(data.livekit);
    }

    storage?.set("authToken", data.authToken);
  }

  // ========================================================================
  // Settings / Chat
  // ========================================================================

  onSettingsModified = (data: { key: string; value: unknown }): void => {
    const value = data.value;
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      this.ctx.world.settings.set(data.key, value);
      return;
    }

    if (
      typeof value === "object" &&
      value !== null &&
      "url" in value &&
      typeof (value as { url?: unknown }).url === "string"
    ) {
      this.ctx.world.settings.set(data.key, value as { url: string });
      return;
    }

    // Fallback to a stable string form for unsupported payload types.
    this.ctx.world.settings.set(data.key, String(value));
  };

  onChatAdded = (msg: ChatMessage): void => {
    this.ctx.world.chat.add(msg, false);
  };

  onChatCleared = (): void => {
    this.ctx.world.chat.clear();
  };

  onSystemMessage = (data: { message: string; type: string }): void => {
    console.log("[ClientNetwork] systemMessage received:", data);
    const chatMessage: ChatMessage = {
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: "",
      body: data.message,
      text: data.message,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
    this.ctx.world.chat.add(chatMessage, false);
    console.log("[ClientNetwork] Added message to chat:", chatMessage.body);
  };

  // ========================================================================
  // Entity Lifecycle
  // ========================================================================

  onEntityAdded = (data: EntityData): void => {
    const ctx = this.ctx;
    const newEntity = ctx.world.entities.add(data);
    if (newEntity) {
      this.applyPendingModifications(newEntity.id);
      const isLocalPlayer =
        (data as { type?: string; owner?: string }).type === "player" &&
        (data as { owner?: string }).owner === ctx.id;
      if (
        isLocalPlayer &&
        Array.isArray((data as { position?: number[] }).position)
      ) {
        let pos = (data as { position?: number[] }).position as [
          number,
          number,
          number,
        ];
        if (pos[1] < 5) {
          console.warn(
            `[ClientNetwork] Clamping invalid spawn Y=${pos[1]} to safe height 50`,
          );
          pos = [pos[0], 50, pos[2]];
        }
        if (newEntity instanceof PlayerLocal) {
          newEntity.position.set(pos[0], pos[1], pos[2]);
          newEntity.updateServerPosition(pos[0], pos[1], pos[2]);
        }
      }

      // Check if this is the spectator target entity we're waiting for
      const spectatorFollowId = ctx.spectatorFollowEntity;
      const isWaitingForTarget = ctx.spectatorTargetPending;

      if (isWaitingForTarget && data.id === spectatorFollowId) {
        ctx.logger.info(
          `Spectator target entity ${spectatorFollowId} just spawned!`,
        );

        if (ctx.spectatorRetryInterval) {
          clearInterval(
            ctx.spectatorRetryInterval as ReturnType<typeof setInterval>,
          );
          ctx.spectatorRetryInterval = null;
        }
        ctx.spectatorTargetPending = false;

        const camera = ctx.world.getSystem("camera") as {
          setTarget?: (target: unknown) => void;
        };
        if (camera?.setTarget) {
          ctx.logger.info(
            `Setting camera target to newly spawned entity ${spectatorFollowId}`,
          );
          camera.setTarget(newEntity);
        }
      }
    }
  };

  onEntityModified = (
    data: { id: string; changes?: Record<string, unknown> } & Record<
      string,
      unknown
    >,
  ): void => {
    const ctx = this.ctx;
    const { id } = data;
    const entity = ctx.world.entities.get(id);
    if (!entity) {
      // Limit queued modifications per entity to avoid unbounded growth
      const list = ctx.pendingModifications.get(id) || [];
      const now = performance.now();

      if (list.length > 0) {
        const firstTimestamp = ctx.pendingModificationTimestamps.get(id) || now;
        const age = now - firstTimestamp;
        if (age > 10000) {
          ctx.pendingModifications.delete(id);
          ctx.pendingModificationTimestamps.delete(id);
          ctx.pendingModificationLimitReached.delete(id);
          return;
        }
      }

      if (list.length < 50) {
        list.push(data);
        ctx.pendingModifications.set(id, list);

        if (list.length === 1) {
          ctx.pendingModificationTimestamps.set(id, now);
        }
      } else if (!ctx.pendingModificationLimitReached.has(id)) {
        ctx.pendingModificationLimitReached.add(id);
      }
      return;
    }

    // Accept both normalized { changes: {...} } and flat payloads { id, ...changes }
    const changes =
      data.changes ??
      Object.fromEntries(
        Object.entries(data).filter(([k]) => k !== "id" && k !== "changes"),
      );

    // Check if this is the local player
    const isLocal = (() => {
      const localEntityId = ctx.world.entities.player?.id;
      if (localEntityId && id === localEntityId) return true;
      const ownerId = (entity as { data?: { owner?: string } }).data?.owner;
      return !!(ctx.id && ownerId && ownerId === ctx.id);
    })();

    const hasP = Object.prototype.hasOwnProperty.call(changes, "p");
    const hasV = Object.prototype.hasOwnProperty.call(changes, "v");
    const hasQ = Object.prototype.hasOwnProperty.call(changes, "q");

    if (isLocal && (hasP || hasV || hasQ)) {
      if (ctx.tileInterpolator.hasState(id)) {
        const { p, q, ...restChanges } = changes as Record<string, unknown>;
        entity.modify(restChanges);
      } else {
        entity.modify(changes);
      }
    } else {
      const entityData = entity.serialize();

      const newState = changes.aiState || entityData.aiState;

      const currentAiState =
        (entity.data as { aiState?: string })?.aiState ?? entityData.aiState;
      const isMobRespawning =
        currentAiState === "dead" &&
        typeof changes.aiState === "string" &&
        changes.aiState !== "dead";

      if (isMobRespawning) {
        ctx.interpolationEngine.removeEntity(id);
        if (ctx.tileInterpolator.hasState(id)) {
          ctx.tileInterpolator.removeEntity(id);
        }

        (entity.data as Record<string, unknown>).e = undefined;
        (entity.data as Record<string, unknown>).emote = undefined;

        entity.modify(changes);

        const changesObj = changes as Record<string, unknown>;
        if (hasP && hasQ) {
          const pArr = changesObj.p as number[];
          ctx.tileInterpolator.setCombatRotation(id, changesObj.q as number[], {
            x: pArr[0],
            y: pArr[1],
            z: pArr[2],
          });
        }

        if (typeof changes.e === "string") {
          entity.data.emote = changes.e;
        }
        return;
      }

      const newEmote =
        (changes as { e?: string }).e || (entityData as { e?: string }).e;

      const isDeadMob = newState === "dead" || newEmote === "death";
      const entityDeathState = (entity.data as { deathState?: DeathState })
        ?.deathState;
      const isDeadByEntityState =
        entityDeathState === DeathState.DYING ||
        entityDeathState === DeathState.DEAD;
      const isDeadPlayer = ctx.deadPlayers.has(id) || isDeadByEntityState;
      const isDead = isDeadMob || isDeadPlayer;

      if (isDead && ctx.interpolationEngine.hasState(id)) {
        ctx.interpolationEngine.removeEntity(id);
      }

      if (isDead && ctx.tileInterpolator.hasState(id)) {
        ctx.tileInterpolator.removeEntity(id);
      }

      const hasTileState = ctx.tileInterpolator.hasState(id);
      if (hasP && !isDead && !hasTileState) {
        ctx.interpolationEngine.addSnapshot(
          id,
          changes as {
            p?: [number, number, number];
            q?: [number, number, number, number];
            v?: [number, number, number];
          },
        );
      }

      if (isDeadPlayer && hasP) {
        const { p, q, ...restChanges } = changes as Record<string, unknown>;
        entity.modify(restChanges);
      } else if (hasTileState && !isDead) {
        const changesTyped = changes as Record<string, unknown>;
        const { p, q, ...restChanges } = changesTyped;

        if (q && Array.isArray(q) && q.length === 4) {
          const applied = ctx.tileInterpolator.setCombatRotation(
            id,
            q as number[],
            entity.position,
          );
          if (!applied) {
            // Entity is moving - combat rotation ignored (OSRS-accurate)
          }
        }

        entity.modify(restChanges);
      } else {
        const changesObj = changes as Record<string, unknown>;
        if (
          changesObj.q &&
          Array.isArray(changesObj.q) &&
          (changesObj.q as number[]).length === 4
        ) {
          const pArr = changesObj.p as number[] | undefined;
          const posForState =
            pArr && pArr.length === 3
              ? { x: pArr[0], y: pArr[1], z: pArr[2] }
              : {
                  x: entity.position.x,
                  y: entity.position.y,
                  z: entity.position.z,
                };
          ctx.tileInterpolator.setCombatRotation(
            id,
            changesObj.q as number[],
            posForState,
          );
          const { q, ...restChanges } = changesObj;
          entity.modify(restChanges);
        } else {
          entity.modify(changes);
        }
      }

      if (typeof changes.e === "string") {
        entity.data.emote = changes.e;
      }
    }

    // Re-emit normalized change event so other systems can react
    ctx.world.emit(EventType.ENTITY_MODIFIED, { id, changes });
  };

  onEntityEvent = (event: {
    id: string;
    version: number;
    name: string;
    data?: unknown;
  }): void => {
    const { id, version, name, data } = event;
    if (id === "world") {
      this.ctx.world.emit(name, data);
      return;
    }
    const entity = this.ctx.world.entities.get(id);
    if (!entity) return;
    entity.onEvent(version, name, data, this.ctx.id || "");
  };

  onEntityRemoved = (id: string): void => {
    const ctx = this.ctx;
    ctx.interpolationEngine.removeEntity(id);
    ctx.tileInterpolator.removeEntity(id);
    ctx.pendingModifications.delete(id);
    ctx.pendingModificationTimestamps.delete(id);
    ctx.pendingModificationLimitReached.delete(id);
    ctx.deadPlayers.delete(id);
    ctx.world.entities.remove(id);
  };

  // ========================================================================
  // Resource Handlers
  // ========================================================================

  onResourceSnapshot = (data: {
    resources: Array<{
      id: string;
      type: string;
      position: { x: number; y: number; z: number };
      isAvailable: boolean;
      respawnAt?: number;
    }>;
  }): void => {
    for (const r of data.resources) {
      this.ctx.world.emit(EventType.RESOURCE_SPAWNED, {
        id: r.id,
        type: r.type,
        position: r.position,
      });
      if (!r.isAvailable)
        this.ctx.world.emit(EventType.RESOURCE_DEPLETED, {
          resourceId: r.id,
          position: r.position,
        });
    }
  };

  onResourceSpawnPoints = (data: {
    spawnPoints: Array<{
      id: string;
      type: string;
      position: { x: number; y: number; z: number };
    }>;
  }): void => {
    this.ctx.world.emit(EventType.RESOURCE_SPAWN_POINTS_REGISTERED, data);
  };

  onResourceSpawned = (data: {
    id: string;
    type: string;
    position: { x: number; y: number; z: number };
  }): void => {
    this.ctx.world.emit(EventType.RESOURCE_SPAWNED, data);
  };

  onResourceDepleted = (data: {
    resourceId: string;
    position?: { x: number; y: number; z: number };
    depleted?: boolean;
  }): void => {
    interface EntityWithNetworkUpdate {
      updateFromNetwork?: (data: Record<string, unknown>) => void;
    }
    const entity = this.ctx.world.entities.get(
      data.resourceId,
    ) as EntityWithNetworkUpdate | null;
    if (entity && typeof entity.updateFromNetwork === "function") {
      entity.updateFromNetwork({ depleted: true });
    }
    this.ctx.world.emit(EventType.RESOURCE_DEPLETED, data);
  };

  onResourceRespawned = (data: {
    resourceId: string;
    position?: { x: number; y: number; z: number };
    depleted?: boolean;
  }): void => {
    const entity = this.ctx.world.entities.get(data.resourceId);
    interface EntityWithNetworkUpdate {
      updateFromNetwork?: (data: Record<string, unknown>) => void;
    }
    const entityWithUpdate = entity as EntityWithNetworkUpdate | null;
    if (
      entityWithUpdate &&
      typeof entityWithUpdate.updateFromNetwork === "function"
    ) {
      entityWithUpdate.updateFromNetwork({ depleted: false });
    }
    this.ctx.world.emit(EventType.RESOURCE_RESPAWNED, data);
  };

  // ========================================================================
  // Fire Handlers
  // ========================================================================

  onFireCreated = (data: {
    fireId: string;
    playerId: string;
    position: { x: number; y: number; z: number };
  }): void => {
    console.log("[ClientNetwork] Fire created packet received:", data);
    this.ctx.world.emit(EventType.FIRE_CREATED, data);
  };

  onFireExtinguished = (data: { fireId: string }): void => {
    console.log("[ClientNetwork] Fire extinguished packet received:", data);
    this.ctx.world.emit(EventType.FIRE_EXTINGUISHED, data);
  };

  onFireLightingStarted = (data: {
    playerId: string;
    position: { x: number; y: number; z: number };
  }): void => {
    this.ctx.world.emit(EventType.FIRE_LIGHTING_STARTED, data);
  };

  onFireLightingCancelled = (data: { playerId: string }): void => {
    this.ctx.world.emit(EventType.FIRE_LIGHTING_CANCELLED, data);
  };

  // ========================================================================
  // Fishing
  // ========================================================================

  onFishingSpotMoved = (data: {
    resourceId: string;
    oldPosition: { x: number; y: number; z: number };
    newPosition: { x: number; y: number; z: number };
  }): void => {
    const entity = this.ctx.world.entities.get(data.resourceId);
    if (entity) {
      if (entity.position) {
        entity.position.x = data.newPosition.x;
        entity.position.y = data.newPosition.y;
        entity.position.z = data.newPosition.z;
      }
      if (entity.node?.position) {
        entity.node.position.set(
          data.newPosition.x,
          data.newPosition.y,
          data.newPosition.z,
        );
      }
    }
    this.ctx.world.emit(EventType.RESOURCE_SPAWNED, {
      id: data.resourceId,
      type: "fishing_spot",
      position: data.newPosition,
    });
  };

  // ========================================================================
  // Inventory / Equipment / Skills / Coins / Weight
  // ========================================================================

  onInventoryUpdated = (data: {
    playerId: string;
    items: Array<{ slot: number; itemId: string; quantity: number }>;
    coins: number;
    maxSlots: number;
  }): void => {
    console.log("[ClientNetwork] Received inventoryUpdated packet:", {
      playerId: data.playerId,
      itemCount: data.items?.length || 0,
      coins: data.coins,
      localPlayerId: this.ctx.world?.entities?.player?.id,
      networkId: this.ctx.id,
    });
    this.ctx.lastInventoryByPlayerId[data.playerId] = data;
    this.ctx.world.emit(EventType.INVENTORY_UPDATED, data);
  };

  onCoinsUpdated = (data: { playerId: string; coins: number }): void => {
    if (this.ctx.lastInventoryByPlayerId[data.playerId]) {
      this.ctx.lastInventoryByPlayerId[data.playerId].coins = data.coins;
    }
    this.ctx.world.emit(EventType.INVENTORY_UPDATE_COINS, {
      playerId: data.playerId,
      coins: data.coins,
    });
  };

  onPlayerWeightUpdated = (data: {
    playerId: string;
    weight: number;
  }): void => {
    const localPlayer = this.ctx.world.getPlayer?.();
    if (
      localPlayer &&
      data.playerId === localPlayer.id &&
      localPlayer instanceof PlayerLocal
    ) {
      localPlayer.totalWeight = data.weight;
      this.ctx.world.emit(EventType.PLAYER_WEIGHT_CHANGED, {
        playerId: data.playerId,
        weight: data.weight,
      });
    }
  };

  onEquipmentUpdated = (data: {
    playerId: string;
    equipment: {
      weapon?: { item?: unknown; itemId?: string } | null;
      shield?: { item?: unknown; itemId?: string } | null;
      helmet?: { item?: unknown; itemId?: string } | null;
      body?: { item?: unknown; itemId?: string } | null;
      legs?: { item?: unknown; itemId?: string } | null;
      arrows?: { item?: unknown; itemId?: string } | null;
      [key: string]: { item?: unknown; itemId?: string } | null | undefined;
    };
  }): void => {
    this.ctx.lastEquipmentByPlayerId = this.ctx.lastEquipmentByPlayerId || {};
    this.ctx.lastEquipmentByPlayerId[data.playerId] = data.equipment;

    const localPlayer = this.ctx.world.getPlayer?.();
    interface PlayerWithEquipment {
      equipment: {
        weapon: unknown;
        shield: unknown;
        helmet: unknown;
        body: unknown;
        legs: unknown;
        arrows: unknown;
      };
    }
    if (localPlayer && data.playerId === localPlayer.id) {
      const rawEq = data.equipment;
      if (rawEq && "equipment" in localPlayer) {
        const playerWithEquipment = localPlayer as PlayerWithEquipment;
        playerWithEquipment.equipment = {
          weapon: rawEq.weapon?.item || null,
          shield: rawEq.shield?.item || null,
          helmet: rawEq.helmet?.item || null,
          body: rawEq.body?.item || null,
          legs: rawEq.legs?.item || null,
          arrows: rawEq.arrows?.item || null,
        };
      }
    }

    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "equipment",
      data: {
        equipment: data.equipment,
      },
    });

    if (data.equipment) {
      const equipment = data.equipment;
      const slots = ["weapon", "shield", "helmet", "body", "legs", "arrows"];

      for (const slot of slots) {
        const slotData = equipment[slot];
        interface SlotDataWithItem {
          itemId?: string;
          item?: { id?: string };
        }
        const slotDataWithItem = slotData as SlotDataWithItem | undefined;
        const itemId =
          slotDataWithItem?.itemId || slotDataWithItem?.item?.id || null;
        this.ctx.world.emit(EventType.PLAYER_EQUIPMENT_CHANGED, {
          playerId: data.playerId,
          slot: slot,
          itemId: itemId,
        });
      }
    }
  };

  onSkillsUpdated = (data: {
    playerId: string;
    skills: Record<string, { level: number; xp: number }>;
  }): void => {
    this.ctx.lastSkillsByPlayerId = this.ctx.lastSkillsByPlayerId || {};
    this.ctx.lastSkillsByPlayerId[data.playerId] = data.skills;
    this.ctx.world.emit(EventType.SKILLS_UPDATED, data);
  };

  // ========================================================================
  // Prayer State Handlers
  // ========================================================================

  onPrayerStateSync = (data: {
    playerId: string;
    points: number;
    maxPoints: number;
    active: string[];
  }): void => {
    this.ctx.lastPrayerStateByPlayerId[data.playerId] = {
      points: data.points,
      maxPoints: data.maxPoints,
      active: data.active,
    };
    this.ctx.world.emit(EventType.PRAYER_STATE_SYNC, data);
  };

  onPrayerToggled = (data: {
    playerId: string;
    prayerId: string;
    active: boolean;
    points: number;
  }): void => {
    const cached = this.ctx.lastPrayerStateByPlayerId[data.playerId];
    if (cached) {
      cached.points = data.points;
      if (data.active) {
        if (!cached.active.includes(data.prayerId)) {
          cached.active.push(data.prayerId);
        }
      } else {
        cached.active = cached.active.filter((id) => id !== data.prayerId);
      }
    }
    this.ctx.world.emit(EventType.PRAYER_TOGGLED, data);
  };

  onPrayerPointsChanged = (data: {
    playerId: string;
    points: number;
    maxPoints: number;
    reason?: string;
  }): void => {
    const cached = this.ctx.lastPrayerStateByPlayerId[data.playerId];
    if (cached) {
      cached.points = data.points;
      cached.maxPoints = data.maxPoints;
    }
    this.ctx.world.emit(EventType.PRAYER_POINTS_CHANGED, data);
  };

  // ========================================================================
  // World Time Sync
  // ========================================================================

  onWorldTimeSync = (data: { worldTime: number }): void => {
    this.ctx.worldTimeOffset = data.worldTime - this.ctx.world.getTime();
  };

  // ========================================================================
  // Bank Handlers
  // ========================================================================

  onBankState = (data: {
    playerId: string;
    bankId?: string;
    items: Array<{
      itemId: string;
      quantity: number;
      slot: number;
      tabIndex?: number;
    }>;
    tabs?: Array<{ tabIndex: number; iconItemId: string | null }>;
    alwaysSetPlaceholder?: boolean;
    maxSlots: number;
    isOpen?: boolean;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      playerId: data.playerId,
      component: "bank",
      data: {
        bankId: data.bankId,
        items: data.items,
        tabs: data.tabs,
        alwaysSetPlaceholder: data.alwaysSetPlaceholder,
        maxSlots: data.maxSlots,
        isOpen: data.isOpen ?? true,
      },
    });
  };

  onBankClose = (data: { reason: string; sessionType: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "bank",
      data: {
        isOpen: false,
        reason: data.reason,
      },
    });
  };

  // ========================================================================
  // Store Handlers
  // ========================================================================

  onStoreState = (data: {
    storeId: string;
    storeName: string;
    buybackRate: number;
    items: Array<{
      id: string;
      itemId: string;
      name: string;
      price: number;
      stockQuantity: number;
      description?: string;
      category?: string;
    }>;
    isOpen: boolean;
    npcEntityId?: string;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "store",
      data: {
        storeId: data.storeId,
        storeName: data.storeName,
        buybackRate: data.buybackRate,
        items: data.items,
        isOpen: data.isOpen,
        npcEntityId: data.npcEntityId,
      },
    });
  };

  onStoreClose = (data: { reason: string; sessionType: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "store",
      data: {
        isOpen: false,
        reason: data.reason,
      },
    });
  };

  // ========================================================================
  // Smelting / Smithing / Crafting / Fletching / Tanning Interface Handlers
  // ========================================================================

  onSmeltingInterfaceOpen = (data: {
    furnaceId: string;
    availableBars: Array<{
      barItemId: string;
      levelRequired: number;
      primaryOre: string;
      secondaryOre: string | null;
      coalRequired: number;
    }>;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "smelting",
      data: {
        isOpen: true,
        furnaceId: data.furnaceId,
        availableBars: data.availableBars,
      },
    });
  };

  onSmithingInterfaceOpen = (data: {
    anvilId: string;
    availableRecipes: Array<{
      itemId: string;
      name: string;
      barType: string;
      barsRequired: number;
      levelRequired: number;
      xp: number;
      category: string;
    }>;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "smithing",
      data: {
        isOpen: true,
        anvilId: data.anvilId,
        availableRecipes: data.availableRecipes,
      },
    });
  };

  onCraftingInterfaceOpen = (data: {
    availableRecipes: Array<{
      output: string;
      name: string;
      category: string;
      inputs: Array<{ item: string; amount: number }>;
      tools: string[];
      level: number;
      xp: number;
      meetsLevel: boolean;
      hasInputs: boolean;
    }>;
    station: string;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "crafting",
      data: {
        isOpen: true,
        availableRecipes: data.availableRecipes,
        station: data.station,
      },
    });
  };

  onCraftingClose = (_data: { reason?: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "craftingClose",
      data: _data,
    });
  };

  onFletchingInterfaceOpen = (
    data: Omit<FletchingInterfaceOpenPayload, "playerId">,
  ): void => {
    this.ctx.world.emit(EventType.FLETCHING_INTERFACE_OPEN, {
      playerId: this.ctx.world?.entities?.player?.id || "",
      availableRecipes: data.availableRecipes,
    });
  };

  onFletchingClose = (_data: { reason?: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "fletchingClose",
      data: _data,
    });
  };

  onTanningInterfaceOpen = (data: {
    availableRecipes: Array<{
      input: string;
      output: string;
      cost: number;
      name: string;
      hasHide: boolean;
      hideCount: number;
    }>;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tanning",
      data: {
        isOpen: true,
        availableRecipes: data.availableRecipes,
      },
    });
  };

  onTanningClose = (_data: { reason?: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tanningClose",
      data: _data,
    });
  };

  onSmeltingClose = (data: { reason?: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "smeltingClose",
      data,
    });
  };

  onSmithingClose = (data: { reason?: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "smithingClose",
      data,
    });
  };

  // ========================================================================
  // Dialogue Handlers
  // ========================================================================

  onDialogueStart = (data: {
    npcId: string;
    npcName: string;
    nodeId: string;
    text: string;
    responses: Array<{ text: string; nextNodeId: string; effect?: string }>;
    npcEntityId?: string;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "dialogue",
      data: {
        npcId: data.npcId,
        npcName: data.npcName,
        text: data.text,
        responses: data.responses,
        npcEntityId: data.npcEntityId,
      },
    });
  };

  onDialogueNodeChange = (data: {
    npcId: string;
    nodeId: string;
    text: string;
    responses: Array<{ text: string; nextNodeId: string; effect?: string }>;
  }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "dialogue",
      data: {
        npcId: data.npcId,
        npcName: "",
        text: data.text,
        responses: data.responses,
      },
    });
  };

  onDialogueEnd = (data: { npcId: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "dialogueEnd",
      data: { npcId: data.npcId },
    });
  };

  onDialogueClose = (data: { reason: string; sessionType: string }): void => {
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "dialogueEnd",
      data: {
        reason: data.reason,
        serverClose: true,
      },
    });
  };

  // ========================================================================
  // Character Selection
  // ========================================================================

  onCharacterList = (data: {
    characters: Array<{
      id: string;
      name: string;
      level?: number;
      lastLocation?: { x: number; y: number; z: number };
    }>;
  }): void => {
    this.ctx.lastCharacterList = data.characters || [];
    this.ctx.world.emit(EventType.CHARACTER_LIST, data);
    const storedId =
      typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("selectedCharacterId")
        : null;
    if (
      storedId &&
      Array.isArray(data.characters) &&
      data.characters.some((c) => c.id === storedId)
    ) {
      this.ctx.send("characterSelected", { characterId: storedId });
    }
  };

  onCharacterCreated = (data: { id: string; name: string }): void => {
    this.ctx.world.emit(EventType.CHARACTER_CREATED, data);
  };

  onCharacterSelected = (data: { characterId: string | null }): void => {
    this.ctx.world.emit(EventType.CHARACTER_SELECTED, data);
  };

  // ========================================================================
  // Quest System Handlers
  // ========================================================================

  onQuestList = (data: {
    quests: Array<{
      id: string;
      name: string;
      status: string;
      difficulty: string;
      questPoints: number;
    }>;
    questPoints: number;
  }): void => {
    this.ctx.emit("questList", data);
  };

  onQuestDetail = (data: {
    id: string;
    name: string;
    description: string;
    status: string;
    difficulty: string;
    questPoints: number;
    currentStage: string;
    stageProgress: Record<string, number>;
    stages: Array<{
      id: string;
      description: string;
      type: string;
      target?: string;
      count?: number;
    }>;
  }): void => {
    this.ctx.emit("questDetail", data);
  };

  onQuestStartConfirm = (data: {
    questId: string;
    questName: string;
    description: string;
    difficulty: string;
    requirements: {
      quests: string[];
      skills: Record<string, number>;
      items: string[];
    };
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  }): void => {
    const playerId = this.ctx.world?.entities?.player?.id || "";
    this.ctx.world.emit(EventType.QUEST_START_CONFIRM, { ...data, playerId });
  };

  onQuestProgressed = (data: {
    questId: string;
    stage: string;
    progress: Record<string, number>;
    description: string;
  }): void => {
    const playerId = this.ctx.world?.entities?.player?.id || "";
    this.ctx.world.emit(EventType.QUEST_PROGRESSED, { ...data, playerId });
  };

  onQuestCompleted = (data: {
    questId: string;
    questName: string;
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  }): void => {
    const playerId = this.ctx.world?.entities?.player?.id || "";
    this.ctx.world.emit(EventType.QUEST_COMPLETED, { ...data, playerId });
  };

  // ========================================================================
  // Trade Handlers
  // ========================================================================

  onTradeIncoming = (data: {
    tradeId: string;
    fromPlayerId: string;
    fromPlayerName: string;
    fromPlayerLevel: number;
  }): void => {
    this.ctx.world.emit(EventType.TRADE_REQUEST_RECEIVED, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tradeRequest",
      data: {
        visible: true,
        tradeId: data.tradeId,
        fromPlayer: {
          id: data.fromPlayerId,
          name: data.fromPlayerName,
          level: data.fromPlayerLevel,
        },
      },
    });
  };

  onTradeStarted = (data: {
    tradeId: string;
    partnerId: string;
    partnerName: string;
    partnerLevel: number;
  }): void => {
    this.ctx.world.emit(EventType.TRADE_STARTED, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "trade",
      data: {
        isOpen: true,
        tradeId: data.tradeId,
        partner: {
          id: data.partnerId,
          name: data.partnerName,
          level: data.partnerLevel,
        },
        myOffer: [],
        myAccepted: false,
        theirOffer: [],
        theirAccepted: false,
      },
    });
  };

  onTradeUpdated = (data: {
    tradeId: string;
    myOffer: {
      items: Array<{
        inventorySlot: number;
        itemId: string;
        quantity: number;
        tradeSlot: number;
      }>;
      accepted: boolean;
    };
    theirOffer: {
      items: Array<{
        inventorySlot: number;
        itemId: string;
        quantity: number;
        tradeSlot: number;
      }>;
      accepted: boolean;
    };
  }): void => {
    this.ctx.world.emit(EventType.TRADE_UPDATED, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tradeUpdate",
      data: {
        tradeId: data.tradeId,
        myOffer: data.myOffer.items,
        myAccepted: data.myOffer.accepted,
        theirOffer: data.theirOffer.items,
        theirAccepted: data.theirOffer.accepted,
      },
    });
  };

  onTradeCompleted = (data: {
    tradeId: string;
    receivedItems: Array<{ itemId: string; quantity: number }>;
  }): void => {
    this.ctx.world.emit(EventType.TRADE_COMPLETED, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tradeClose",
      data: { tradeId: data.tradeId, reason: "completed" },
    });
  };

  onTradeCancelled = (data: {
    tradeId: string;
    reason: string;
    message: string;
  }): void => {
    this.ctx.world.emit(EventType.TRADE_CANCELLED, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tradeClose",
      data: {
        tradeId: data.tradeId,
        reason: data.reason,
        message: data.message,
      },
    });
  };

  onTradeError = (data: { message: string; code: string }): void => {
    this.ctx.world.emit(EventType.TRADE_ERROR, data);
    this.ctx.world.emit(EventType.UI_TOAST, {
      message: data.message,
      type: "error",
    });
  };

  onTradeConfirmScreen = (data: {
    tradeId: string;
    myOffer: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      tradeSlot: number;
    }>;
    theirOffer: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      tradeSlot: number;
    }>;
    myOfferValue: number;
    theirOfferValue: number;
  }): void => {
    this.ctx.world.emit(EventType.TRADE_CONFIRM_SCREEN, data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "tradeConfirm",
      data: {
        tradeId: data.tradeId,
        screen: "confirm",
        myOffer: data.myOffer,
        theirOffer: data.theirOffer,
        myOfferValue: data.myOfferValue,
        theirOfferValue: data.theirOfferValue,
        myAccepted: false,
        theirAccepted: false,
      },
    });
  };

  // ========================================================================
  // Duel Arena Handlers
  // ========================================================================

  onDuelChallengeSent = (data: {
    challengeId: string;
    targetPlayerId: string;
    targetPlayerName: string;
  }): void => {
    console.log("[ClientNetwork] Duel challenge sent:", data);
    this.ctx.world.emit(EventType.UI_TOAST, {
      message: `Challenge sent to ${data.targetPlayerName}`,
      type: "info",
    });
  };

  onDuelChallengeIncoming = (data: {
    challengeId: string;
    fromPlayerId: string;
    fromPlayerName: string;
    fromPlayerLevel: number;
  }): void => {
    console.log("[ClientNetwork] Duel challenge incoming:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelChallenge",
      data: {
        visible: true,
        challengeId: data.challengeId,
        fromPlayer: {
          id: data.fromPlayerId,
          name: data.fromPlayerName,
          level: data.fromPlayerLevel,
        },
      },
    });
  };

  onDuelSessionStarted = (data: {
    duelId: string;
    opponentId: string;
    opponentName: string;
    isChallenger: boolean;
  }): void => {
    console.log("[ClientNetwork] Duel session started:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duel",
      data: {
        isOpen: true,
        duelId: data.duelId,
        opponent: {
          id: data.opponentId,
          name: data.opponentName,
        },
        isChallenger: data.isChallenger,
      },
    });
  };

  onDuelChallengeDeclined = (data: {
    challengeId: string;
    declinedBy?: string;
  }): void => {
    console.log("[ClientNetwork] Duel challenge declined:", data);
    if (data.declinedBy) {
      this.ctx.world.emit(EventType.UI_TOAST, {
        message: `${data.declinedBy} declined your duel challenge.`,
        type: "info",
      });
    }
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelChallenge",
      data: { visible: false },
    });
  };

  onDuelError = (data: { message: string; code: string }): void => {
    console.log("[ClientNetwork] Duel error:", data);
    this.ctx.world.emit(EventType.UI_TOAST, {
      message: data.message,
      type: "error",
    });
  };

  onDuelRulesUpdated = (data: {
    duelId: string;
    rules: Record<string, boolean>;
    challengerAccepted: boolean;
    targetAccepted: boolean;
    modifiedBy: string;
  }): void => {
    console.log("[ClientNetwork] Duel rules updated:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelRulesUpdate",
      data,
    });
  };

  onDuelEquipmentUpdated = (data: {
    duelId: string;
    equipmentRestrictions: Record<string, boolean>;
    challengerAccepted: boolean;
    targetAccepted: boolean;
    modifiedBy: string;
  }): void => {
    console.log("[ClientNetwork] Duel equipment updated:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelEquipmentUpdate",
      data,
    });
  };

  onDuelAcceptanceUpdated = (data: {
    duelId: string;
    challengerAccepted: boolean;
    targetAccepted: boolean;
    state: string;
    movedToStakes: boolean;
  }): void => {
    console.log("[ClientNetwork] Duel acceptance updated:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelAcceptanceUpdate",
      data,
    });
  };

  onDuelStakesUpdated = (data: {
    duelId: string;
    challengerStakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>;
    targetStakes: Array<{
      inventorySlot: number;
      itemId: string;
      quantity: number;
      value: number;
    }>;
    challengerAccepted: boolean;
    targetAccepted: boolean;
    modifiedBy: string;
  }): void => {
    console.log("[ClientNetwork] Duel stakes updated:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelStakesUpdate",
      data,
    });
  };

  onDuelStateChanged = (data: {
    duelId: string;
    state: string;
    rules?: Record<string, boolean>;
    equipmentRestrictions?: Record<string, boolean>;
  }): void => {
    console.log("[ClientNetwork] Duel state changed:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelStateChange",
      data,
    });
  };

  onDuelCancelled = (data: {
    duelId: string;
    reason: string;
    cancelledBy?: string;
  }): void => {
    console.log("[ClientNetwork] Duel cancelled:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelClose",
      data,
    });
    if (data.cancelledBy) {
      this.ctx.world.emit(EventType.UI_TOAST, {
        message: "Duel has been cancelled.",
        type: "info",
      });
    }
  };

  onDuelCountdownStart = (data: {
    duelId: string;
    countdownSeconds: number;
    challengerPosition: { x: number; y: number; z: number };
    targetPosition: { x: number; y: number; z: number };
  }): void => {
    console.log("[ClientNetwork] Duel countdown start:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelClose",
      data: { duelId: data.duelId },
    });
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelCountdown",
      data,
    });
  };

  onDuelCountdownTick = (data: {
    duelId: string;
    count: number;
    challengerId: string;
    targetId: string;
  }): void => {
    console.log("[ClientNetwork] Duel countdown tick:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelCountdownTick",
      data,
    });
    this.ctx.world.emit(EventType.DUEL_COUNTDOWN_TICK, data);
  };

  onDuelFightBegin = (data: {
    duelId: string;
    challengerId: string;
    targetId: string;
  }): void => {
    console.log("[ClientNetwork] Duel fight begin:", data);
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelFightBegin",
      data,
    });
  };

  onDuelFightStart = (data: {
    duelId: string;
    arenaId: number;
    opponentId?: string;
    bounds?: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
  }): void => {
    console.log("[ClientNetwork] Duel fight start:", data);

    (
      this.ctx.world as {
        activeDuel?: {
          duelId: string;
          arenaId: number;
          opponentId?: string;
          bounds?: {
            min: { x: number; y: number; z: number };
            max: { x: number; y: number; z: number };
          };
        };
      }
    ).activeDuel = {
      duelId: data.duelId,
      arenaId: data.arenaId,
      opponentId: data.opponentId,
      bounds: data.bounds,
    };

    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelFightStart",
      data,
    });
  };

  onDuelEnded = (data: {
    duelId: string;
    winnerId: string;
    loserId: string;
    reason: string;
    rewards?: Array<{ itemId: string; quantity: number }>;
  }): void => {
    console.log("[ClientNetwork] Duel ended:", data);

    (
      this.ctx.world as {
        activeDuel?: { duelId: string; arenaId: number; opponentId?: string };
      }
    ).activeDuel = undefined;

    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelEnded",
      data,
    });
  };

  onDuelCompleted = (data: {
    duelId: string;
    winner: boolean;
    opponentName: string;
    itemsReceived: Array<{ itemId: string; quantity: number }>;
    itemsLost: Array<{ itemId: string; quantity: number }>;
  }): void => {
    console.log("[ClientNetwork] Duel completed:", data);

    (
      this.ctx.world as {
        activeDuel?: { duelId: string; arenaId: number; opponentId?: string };
      }
    ).activeDuel = undefined;

    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "duelCompleted",
      data,
    });
  };

  // ========================================================================
  // Social / Friend System Handlers
  // ========================================================================

  onFriendsListSync = (data: FriendsListSyncData): void => {
    const socialSystem = this.ctx.world.getSystem("social") as {
      handleSync?: (syncData: FriendsListSyncData) => void;
    } | null;
    if (socialSystem?.handleSync) {
      socialSystem.handleSync(data);
    }
  };

  onFriendStatusUpdate = (data: FriendStatusUpdateData): void => {
    const socialSystem = this.ctx.world.getSystem("social") as {
      handleStatusUpdate?: (updateData: FriendStatusUpdateData) => void;
    } | null;
    if (socialSystem?.handleStatusUpdate) {
      socialSystem.handleStatusUpdate(data);
    }
  };

  onFriendRequestIncoming = (data: FriendRequest): void => {
    const socialSystem = this.ctx.world.getSystem("social") as {
      addIncomingRequest?: (requestData: FriendRequest) => void;
    } | null;

    if (socialSystem?.addIncomingRequest) {
      socialSystem.addIncomingRequest(data);
    }

    this.ctx.world.emit(EventType.UI_TOAST, {
      message: `${data.fromName} wants to be your friend!`,
      type: "info",
    });
  };

  onPrivateMessageReceived = (data: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    content: string;
    timestamp: number;
  }): void => {
    this.ctx.world.emit(EventType.CHAT_MESSAGE, {
      id: `pm-${data.timestamp}`,
      from: data.fromName,
      fromId: data.fromId,
      body: data.content,
      text: data.content,
      timestamp: data.timestamp,
      createdAt: new Date(data.timestamp).toISOString(),
      type: "private",
      isPrivate: true,
    });
  };

  onPrivateMessageFailed = (data: {
    reason:
      | "offline"
      | "ignored"
      | "not_friends"
      | "player_not_found"
      | "rate_limited";
    targetName: string;
  }): void => {
    const reasonMessages: Record<typeof data.reason, string> = {
      offline: `${data.targetName} is offline.`,
      ignored: `${data.targetName} is not accepting messages from you.`,
      not_friends: `You must be friends with ${data.targetName} to message them.`,
      player_not_found: `Player "${data.targetName}" not found.`,
      rate_limited: "You are sending messages too quickly.",
    };
    this.ctx.world.emit(EventType.UI_TOAST, {
      message: reasonMessages[data.reason],
      type: "error",
    });
  };

  onSocialError = (data: { code: string; message: string }): void => {
    this.ctx.world.emit(EventType.UI_TOAST, {
      message: data.message,
      type: "error",
    });
  };

  // ========================================================================
  // Test / Debug Handlers
  // ========================================================================

  onTestLevelUp = (data: {
    skill: string;
    oldLevel: number;
    newLevel: number;
  }): void => {
    this.ctx.world.emit(EventType.SKILLS_LEVEL_UP, {
      skill: data.skill,
      oldLevel: data.oldLevel,
      newLevel: data.newLevel,
      timestamp: Date.now(),
    });
  };

  onTestXpDrop = (data: { skill: string; amount: number }): void => {
    this.ctx.world.emit(EventType.XP_DROP_RECEIVED, {
      skill: data.skill,
      xpGained: data.amount,
      newXp: data.amount,
      newLevel: 50,
      position: { x: 0, y: 0, z: 0 },
    });
  };

  onTestDeathScreen = (data: { cause?: string }): void => {
    const playerId = this.ctx.world?.entities?.player?.id || "";
    this.ctx.world.emit(EventType.UI_DEATH_SCREEN, {
      playerId,
      deathLocation: { x: 0, y: 0, z: 0 },
      cause: data.cause || "Test death screen",
    });
  };

  // ========================================================================
  // Gathering Handlers
  // ========================================================================

  onGatheringComplete = (data: {
    playerId: string;
    resourceId: string;
    successful: boolean;
  }): void => {
    this.ctx.world.emit(EventType.RESOURCE_GATHERING_COMPLETED, {
      playerId: data.playerId,
      resourceId: data.resourceId,
      successful: data.successful,
      skill: "woodcutting",
    });
  };

  onGatheringToolShow = (data: {
    playerId: string;
    itemId: string;
    slot: string;
  }): void => {
    this.ctx.world.emit(EventType.GATHERING_TOOL_SHOW, {
      playerId: data.playerId,
      itemId: data.itemId,
      slot: data.slot,
    });
  };

  onGatheringToolHide = (data: { playerId: string; slot: string }): void => {
    this.ctx.world.emit(EventType.GATHERING_TOOL_HIDE, {
      playerId: data.playerId,
      slot: data.slot,
    });
  };

  // ========================================================================
  // Player State / Health / Death / Respawn
  // ========================================================================

  onPlayerState = (data: unknown): void => {
    const playerData = data as {
      playerId?: string;
      skills?: Record<string, { level: number; xp: number }>;
    };

    if (playerData.playerId && playerData.skills) {
      this.ctx.lastSkillsByPlayerId = this.ctx.lastSkillsByPlayerId || {};
      this.ctx.lastSkillsByPlayerId[playerData.playerId] = playerData.skills;
    }

    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "player",
      data: data,
    });
  };

  onShowToast = (data: {
    playerId?: string;
    message: string;
    type: string;
  }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    const shouldShow =
      !data.playerId || (localPlayer && localPlayer.id === data.playerId);

    if (shouldShow) {
      this.ctx.world.emit(EventType.UI_TOAST, {
        message: data.message,
        type: data.type,
      });
    }
  };

  onDeathScreen = (data: {
    playerId: string;
    message: string;
    killedBy: string;
    respawnTime: number;
  }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    if (localPlayer && localPlayer.id === data.playerId) {
      this.ctx.world.emit(EventType.PLAYER_SET_DEAD, {
        playerId: data.playerId,
        isDead: true,
      });

      this.ctx.world.emit(EventType.UI_DEATH_SCREEN, {
        message: data.message,
        killedBy: data.killedBy,
        respawnTime: data.respawnTime,
      });
    }
  };

  onDeathScreenClose = (data: { playerId: string }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    if (localPlayer && localPlayer.id === data.playerId) {
      this.ctx.world.emit(EventType.UI_DEATH_SCREEN_CLOSE, {
        playerId: data.playerId,
      });
    }
  };

  onPlayerSetDead = (data: {
    playerId: string;
    isDead: boolean;
    deathPosition?: number[];
  }): void => {
    const ctx = this.ctx;
    const localPlayer = ctx.world.getPlayer();
    const isLocalPlayer = localPlayer && localPlayer.id === data.playerId;

    if (isLocalPlayer) {
      ctx.world.emit(EventType.PLAYER_SET_DEAD, {
        playerId: data.playerId,
        isDead: data.isDead,
        deathPosition: data.deathPosition,
      });
    } else {
      if (data.isDead) {
        ctx.deadPlayers.add(data.playerId);
      }

      const entity =
        ctx.world.entities.get(data.playerId) ||
        ctx.world.entities.players?.get(data.playerId);

      console.log(
        `[ClientNetwork] onPlayerSetDead for remote player @ ${Date.now()}:`,
        {
          playerId: data.playerId,
          isDead: data.isDead,
          entityFound: !!entity,
          entityType: entity?.constructor?.name,
          hasDeathPosition: !!data.deathPosition,
        },
      );

      if (entity?.data) {
        entity.data.tileInterpolatorControlled = false;
      }

      if (data.isDead) {
        if (ctx.tileInterpolator.hasState(data.playerId)) {
          ctx.tileInterpolator.removeEntity(data.playerId);
        }
        if (ctx.interpolationEngine.hasState(data.playerId)) {
          ctx.interpolationEngine.removeEntity(data.playerId);
        }

        if (entity?.data) {
          entity.data.deathState = DeathState.DYING;
          entity.data.emote = "death";
          entity.data.e = "death";

          const entityWithAvatar = entity as {
            avatar?: { setEmote?: (emote: string) => void };
            lastEmote?: string;
          };
          if (entityWithAvatar.avatar?.setEmote) {
            console.log(
              `[ClientNetwork] Directly triggering death animation for ${data.playerId}`,
            );
            entityWithAvatar.avatar.setEmote(Emotes.DEATH);
            entityWithAvatar.lastEmote = Emotes.DEATH;
          }

          if (data.deathPosition) {
            if (Array.isArray(data.deathPosition)) {
              entity.data.deathPosition = data.deathPosition as [
                number,
                number,
                number,
              ];
            } else {
              const pos = data.deathPosition as unknown as {
                x: number;
                y: number;
                z: number;
              };
              entity.data.deathPosition = [pos.x, pos.y, pos.z];
            }
          }
        }

        if (entity && data.deathPosition) {
          let x: number, y: number, z: number;
          let posArray: [number, number, number];
          if (Array.isArray(data.deathPosition)) {
            [x, y, z] = data.deathPosition;
            posArray = data.deathPosition as [number, number, number];
          } else {
            const pos = data.deathPosition as unknown as {
              x: number;
              y: number;
              z: number;
            };
            x = pos.x;
            y = pos.y;
            z = pos.z;
            posArray = [x, y, z];
          }

          if (ctx.tileInterpolator) {
            ctx.tileInterpolator.stopMovement(data.playerId, { x, y, z });
          }

          entity.modify({
            p: posArray,
            e: "death",
            visible: true,
          });

          if (entity.position) {
            entity.position.x = x;
            entity.position.y = y;
            entity.position.z = z;
          }
          if (entity.node?.position) {
            entity.node.position.set(x, y, z);
          }

          const entityWithBase = entity as {
            base?: {
              position: { set: (x: number, y: number, z: number) => void };
            };
          };
          if (entityWithBase.base?.position) {
            entityWithBase.base.position.set(x, y, z);
          }

          const playerRemote = entity as {
            lerpPosition?: {
              pushArray: (arr: number[], teleport: number | null) => void;
            };
            teleport?: number;
          };
          if (playerRemote.lerpPosition) {
            playerRemote.teleport = (playerRemote.teleport || 0) + 1;
            playerRemote.lerpPosition.pushArray(
              posArray,
              playerRemote.teleport,
            );
          }
        } else if (entity) {
          console.log(
            `[ClientNetwork] Calling entity.modify({ e: "death" }) for ${data.playerId}`,
          );
          entity.modify({ e: "death", visible: true });
        } else {
          console.warn(
            `[ClientNetwork] No entity found for death animation: ${data.playerId}`,
          );
        }
      } else {
        if (ctx.tileInterpolator.hasState(data.playerId)) {
          ctx.tileInterpolator.removeEntity(data.playerId);
        }
        if (ctx.interpolationEngine.hasState(data.playerId)) {
          ctx.interpolationEngine.removeEntity(data.playerId);
        }
      }
    }
  };

  onPlayerRespawned = (data: {
    playerId: string;
    spawnPosition: number[] | { x: number; y: number; z: number };
    townName?: string;
    deathLocation?: number[];
  }): void => {
    const ctx = this.ctx;
    const localPlayer = ctx.world.getPlayer();
    const isLocalPlayer = localPlayer && localPlayer.id === data.playerId;

    if (isLocalPlayer) {
      ctx.world.emit(EventType.PLAYER_RESPAWNED, {
        playerId: data.playerId,
        spawnPosition: data.spawnPosition,
        townName: data.townName,
        deathLocation: data.deathLocation,
      });
    } else {
      console.log(
        `[ClientNetwork] onPlayerRespawned for remote player @ ${Date.now()}:`,
        {
          playerId: data.playerId,
        },
      );

      ctx.deadPlayers.delete(data.playerId);

      if (ctx.tileInterpolator.hasState(data.playerId)) {
        ctx.tileInterpolator.removeEntity(data.playerId);
      }
      if (ctx.interpolationEngine.hasState(data.playerId)) {
        ctx.interpolationEngine.removeEntity(data.playerId);
      }

      let posArray: [number, number, number];
      if (Array.isArray(data.spawnPosition)) {
        posArray = data.spawnPosition as [number, number, number];
      } else {
        const sp = data.spawnPosition as { x: number; y: number; z: number };
        posArray = [sp.x, sp.y, sp.z];
      }

      const entity =
        ctx.world.entities.get(data.playerId) ||
        ctx.world.entities.players?.get(data.playerId);

      if (entity) {
        if (entity.data) {
          entity.data.tileInterpolatorControlled = false;
          entity.data.deathState = DeathState.ALIVE;
          entity.data.deathPosition = undefined;
        }

        const playerRemote = entity as {
          lerpPosition?: {
            pushArray: (arr: number[], teleport: number | null) => void;
          };
          teleport?: number;
        };
        if (playerRemote.lerpPosition) {
          playerRemote.teleport = (playerRemote.teleport || 0) + 1;
          playerRemote.lerpPosition.pushArray(posArray, playerRemote.teleport);
        }

        entity.modify({
          p: posArray,
          e: "idle",
          visible: true,
        });

        if (entity.position) {
          entity.position.x = posArray[0];
          entity.position.y = posArray[1];
          entity.position.z = posArray[2];
        }
        if (entity.node?.position) {
          entity.node.position.set(posArray[0], posArray[1], posArray[2]);
        }

        const entityWithBase = entity as {
          base?: {
            position: { set: (x: number, y: number, z: number) => void };
            updateTransform?: () => void;
          };
        };
        if (entityWithBase.base?.position) {
          entityWithBase.base.position.set(
            posArray[0],
            posArray[1],
            posArray[2],
          );
          if (entityWithBase.base.updateTransform) {
            entityWithBase.base.updateTransform();
          }
        }
      }
    }
  };

  onPlayerUpdated = (data: {
    health: number;
    maxHealth: number;
    alive: boolean;
  }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    if (!localPlayer) {
      console.warn("[ClientNetwork] onPlayerUpdated: No local player found");
      return;
    }

    localPlayer.modify({
      health: data.health,
      maxHealth: data.maxHealth,
    });

    if ("alive" in localPlayer) {
      (localPlayer as { alive: boolean }).alive = data.alive;
    }

    this.ctx.world.emit(EventType.PLAYER_HEALTH_UPDATED, {
      playerId: localPlayer.id,
      health: data.health,
      maxHealth: data.maxHealth,
    });
  };

  // ========================================================================
  // Combat Handlers
  // ========================================================================

  onAttackStyleChanged = (data: {
    playerId: string;
    currentStyle: unknown;
    availableStyles: unknown;
    canChange: boolean;
    cooldownRemaining?: number;
  }): void => {
    this.ctx.lastAttackStyleByPlayerId[data.playerId] = {
      currentStyle: data.currentStyle as { id: string },
      availableStyles: data.availableStyles,
      canChange: data.canChange,
    };
    this.ctx.world.emit(EventType.UI_ATTACK_STYLE_CHANGED, data);
  };

  onAttackStyleUpdate = (data: {
    playerId: string;
    currentStyle: unknown;
    availableStyles: unknown;
    canChange: boolean;
  }): void => {
    this.ctx.lastAttackStyleByPlayerId[data.playerId] = {
      currentStyle: data.currentStyle as { id: string },
      availableStyles: data.availableStyles,
      canChange: data.canChange,
    };
    this.ctx.world.emit(EventType.UI_ATTACK_STYLE_UPDATE, data);
  };

  onAutoRetaliateChanged = (data: { enabled: boolean }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    if (localPlayer) {
      this.ctx.world.emit(EventType.UI_AUTO_RETALIATE_CHANGED, {
        playerId: localPlayer.id,
        enabled: data.enabled,
      });
    }
  };

  onCombatDamageDealt = (data: {
    attackerId: string;
    targetId: string;
    damage: number;
    targetType: "player" | "mob";
    position: { x: number; y: number; z: number };
  }): void => {
    this.ctx.world.emit(EventType.COMBAT_DAMAGE_DEALT, data);
  };

  onProjectileLaunched = (data: {
    attackerId: string;
    targetId: string;
    projectileType: string;
    sourcePosition: { x: number; y: number; z: number };
    targetPosition: { x: number; y: number; z: number };
    spellId?: string;
    delayMs?: number;
  }): void => {
    this.ctx.world.emit(EventType.COMBAT_PROJECTILE_LAUNCHED, data);
  };

  onCombatFaceTarget = (data: { playerId: string; targetId: string }): void => {
    this.ctx.world.emit(EventType.COMBAT_FACE_TARGET, data);
  };

  onCombatClearFaceTarget = (data: { playerId: string }): void => {
    this.ctx.world.emit(EventType.COMBAT_CLEAR_FACE_TARGET, data);
  };

  // ========================================================================
  // XP / Loot / Corpse
  // ========================================================================

  onXpDrop = (data: {
    skill: string;
    xpGained: number;
    newXp: number;
    newLevel: number;
    position: { x: number; y: number; z: number };
  }): void => {
    this.ctx.world.emit(EventType.XP_DROP_RECEIVED, data);
  };

  onCorpseLoot = (data: unknown): void => {
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as Record<string, unknown>).corpseId !== "string" ||
      typeof (data as Record<string, unknown>).playerId !== "string" ||
      !Array.isArray((data as Record<string, unknown>).lootItems)
    ) {
      console.warn(`[ClientNetwork] Rejected malformed corpseLoot packet`);
      return;
    }
    const validated = data as {
      corpseId: string;
      playerId: string;
      lootItems: Array<{ itemId: string; quantity: number }>;
      position: { x: number; y: number; z: number };
    };
    console.log(
      `[ClientNetwork] Received corpseLoot packet for ${validated.corpseId} with ${validated.lootItems?.length || 0} items`,
    );
    this.ctx.world.emit(EventType.CORPSE_CLICK, validated);
  };

  onLootResult = (data: {
    transactionId: string;
    success: boolean;
    itemId?: string;
    quantity?: number;
    reason?: string;
    timestamp: number;
  }): void => {
    this.ctx.emit("lootResult", data);
  };

  // ========================================================================
  // Teleport / Movement
  // ========================================================================

  onPlayerTeleport = (data: {
    playerId: string;
    position: [number, number, number];
    rotation?: number;
  }): void => {
    const ctx = this.ctx;
    const pos = _v3_1.set(data.position[0], data.position[1], data.position[2]);

    const localPlayer = ctx.world.entities.player;
    const isLocalPlayer =
      localPlayer instanceof PlayerLocal && localPlayer.id === data.playerId;

    let rotationQuat: [number, number, number, number] | undefined;
    if (data.rotation !== undefined) {
      const angle = data.rotation + Math.PI;
      const halfAngle = angle / 2;
      rotationQuat = [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
    }

    if (isLocalPlayer) {
      ctx.tileInterpolator.syncPosition(data.playerId, {
        x: pos.x,
        y: pos.y,
        z: pos.z,
      });

      localPlayer.data.tileInterpolatorControlled = false;
      localPlayer.data.tileMovementActive = false;

      const interactionRouter = ctx.world.getSystem("interaction-router") as {
        cancelCurrentAction?: () => void;
      } | null;
      if (interactionRouter?.cancelCurrentAction) {
        interactionRouter.cancelCurrentAction();
      }

      localPlayer.teleport(pos);

      if (rotationQuat && localPlayer.base) {
        localPlayer.base.quaternion.set(
          rotationQuat[0],
          rotationQuat[1],
          rotationQuat[2],
          rotationQuat[3],
        );
      }

      ctx.world.emit(EventType.PLAYER_TELEPORTED, {
        playerId: data.playerId,
        position: { x: pos.x, y: pos.y, z: pos.z },
      });
    } else {
      const remotePlayer = ctx.world.entities.players?.get(data.playerId);
      if (remotePlayer) {
        ctx.tileInterpolator.syncPosition(data.playerId, {
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });

        const remoteWithLerp = remotePlayer as {
          lerpPosition?: {
            pushArray: (arr: number[], teleport: number | null) => void;
          };
          teleport?: number;
        };
        if (remoteWithLerp.lerpPosition) {
          remoteWithLerp.teleport = (remoteWithLerp.teleport || 0) + 1;
          remoteWithLerp.lerpPosition.pushArray(
            [pos.x, pos.y, pos.z],
            remoteWithLerp.teleport,
          );
        }

        if (remotePlayer.position) {
          remotePlayer.position.x = pos.x;
          remotePlayer.position.y = pos.y;
          remotePlayer.position.z = pos.z;
        }

        if (remotePlayer.node) {
          remotePlayer.node.position.set(pos.x, pos.y, pos.z);
        }

        const remoteWithBase = remotePlayer as {
          base?: {
            position: { set: (x: number, y: number, z: number) => void };
            updateTransform?: () => void;
          };
        };
        if (remoteWithBase.base?.position) {
          remoteWithBase.base.position.set(pos.x, pos.y, pos.z);
          if (remoteWithBase.base.updateTransform) {
            remoteWithBase.base.updateTransform();
          }
        }

        if (rotationQuat) {
          ctx.tileInterpolator.setCombatRotation(data.playerId, rotationQuat);

          if (remotePlayer.base) {
            (
              remotePlayer.base as {
                quaternion?: {
                  set: (x: number, y: number, z: number, w: number) => void;
                };
              }
            ).quaternion?.set(
              rotationQuat[0],
              rotationQuat[1],
              rotationQuat[2],
              rotationQuat[3],
            );
          }
        }
      }
    }
  };

  onPlayerPush = (data: { force: [number, number, number] }): void => {
    const player = this.ctx.world.entities.player;
    if (player instanceof PlayerLocal) {
      const force = _v3_1.set(data.force[0], data.force[1], data.force[2]);
      player.push(force);
    }
  };

  onPlayerSessionAvatar = (data: {
    playerId: string;
    avatar: string;
  }): void => {
    const player = this.ctx.world.entities.player as {
      setSessionAvatar?: (url: string) => void;
    };
    if (player?.setSessionAvatar) {
      player.setSessionAvatar(data.avatar);
    }
  };

  // ========================================================================
  // Misc / Compression / Ping / Kick
  // ========================================================================

  onCompressedUpdate = (_packet: unknown): void => {
    // Compression disabled - this handler is a no-op
  };

  onPong = (time: number): void => {
    if (this.ctx.world.stats) {
      this.ctx.world.stats.onPong(time);
    }
  };

  onRtt = (data: { rtt: number }): void => {
    if (this.ctx.world.stats) {
      this.ctx.world.stats.onServerRTT(data.rtt);
    }
  };

  onKick = (code: string): void => {
    this.ctx.emitTypedEvent("UI_KICK", {
      playerId: this.ctx.id || "unknown",
      reason: code || "unknown",
    });
  };

  onEnterWorldApproved = (_data: { characterId: string }): void => {
    // Handled by CharacterSelectScreen - no-op to prevent warning logs
  };

  onEnterWorldRejected = (data: { reason: string; message: string }): void => {
    console.warn(
      "[ClientNetwork] Enter world rejected:",
      data.reason,
      data.message,
    );
    this.ctx.emitTypedEvent("UI_KICK", {
      playerId: this.ctx.id || "unknown",
      reason: "duplicate_user",
    });
  };

  // ========================================================================
  // Home Teleport Handlers
  // ========================================================================

  onHomeTeleportStart = (data: { castTimeMs: number }): void => {
    this.ctx.world.emit(EventType.HOME_TELEPORT_CAST_START, {
      castTimeMs: data.castTimeMs,
    });
  };

  onHomeTeleportFailed = (data: { reason: string }): void => {
    this.ctx.world.emit(EventType.HOME_TELEPORT_FAILED, {
      reason: data.reason,
    });
  };

  // ========================================================================
  // Tile Movement Handlers (RuneScape-style)
  // ========================================================================

  onEntityTileUpdate = (data: {
    id: string;
    tile: TileCoord;
    worldPos: [number, number, number];
    quaternion?: [number, number, number, number];
    emote: string;
    tickNumber: number;
    moveSeq?: number;
  }): void => {
    const ctx = this.ctx;
    _v3_1.set(data.worldPos[0], data.worldPos[1], data.worldPos[2]);

    const entity = ctx.world.entities.get(data.id);
    const entityCurrentPos = entity?.position
      ? (entity.position as THREE.Vector3).clone()
      : undefined;

    ctx.tileInterpolator.onTileUpdate(
      data.id,
      data.tile,
      _v3_1,
      data.emote,
      data.quaternion,
      entityCurrentPos,
      data.tickNumber,
      data.moveSeq,
    );

    if (entity?.data) {
      entity.data.tileInterpolatorControlled = true;
    }

    if (entity) {
      entity.data.emote = data.emote;
    }
  };

  onTileMovementStart = (data: {
    id: string;
    startTile?: TileCoord;
    path: TileCoord[];
    running: boolean;
    destinationTile?: TileCoord;
    moveSeq?: number;
    emote?: string;
    tilesPerTick?: number;
  }): void => {
    const ctx = this.ctx;
    const entity = ctx.world.entities.get(data.id);
    const currentPosition = entity?.position
      ? (entity.position as THREE.Vector3).clone()
      : undefined;

    ctx.tileInterpolator.onMovementStart(
      data.id,
      data.path,
      data.running,
      currentPosition,
      data.startTile,
      data.destinationTile,
      data.moveSeq,
      data.emote,
      data.tilesPerTick,
    );

    if (entity?.data) {
      entity.data.tileInterpolatorControlled = true;
      if (data.emote) {
        entity.modify({ e: data.emote });
      }
    }
  };

  onTileMovementEnd = (data: {
    id: string;
    tile: TileCoord;
    worldPos: [number, number, number];
    moveSeq?: number;
    emote?: string;
    quaternion?: [number, number, number, number];
  }): void => {
    const ctx = this.ctx;
    _v3_1.set(data.worldPos[0], data.worldPos[1], data.worldPos[2]);
    ctx.tileInterpolator.onMovementEnd(
      data.id,
      data.tile,
      _v3_1,
      data.moveSeq,
      data.emote,
    );

    const entity = ctx.world.entities.get(data.id);

    if (entity?.data) {
      entity.data.tileInterpolatorControlled = true;
    }

    if (data.quaternion && entity) {
      _quat_1.set(
        data.quaternion[0],
        data.quaternion[1],
        data.quaternion[2],
        data.quaternion[3],
      );
      entity.data.quaternion = data.quaternion;
      if (entity.node) {
        entity.node.quaternion.copy(_quat_1);
      }
    }

    if (data.emote && entity) {
      entity.data.emote = data.emote;
      entity.modify({ e: data.emote });
    } else if (!ctx.tileInterpolator.isInterpolating(data.id)) {
      if (entity) {
        entity.data.emote = "idle";
      }
    }
  };

  // ========================================================================
  // Action Bar / Player Name / Player Name Changed
  // ========================================================================

  onActionBarState = (data: {
    barId: string;
    slotCount: number;
    slots: Array<{ slotIndex: number; itemId?: string; actionId?: string }>;
  }): void => {
    this.ctx.lastActionBarState = data;
    this.ctx.world.emit(EventType.UI_UPDATE, {
      component: "actionBar",
      data,
    });
  };

  onPlayerNameChanged = (data: { name: string }): void => {
    const localPlayer = this.ctx.world.getPlayer();
    if (localPlayer) {
      if (localPlayer.data) {
        localPlayer.data.name = data.name;
      }
      this.ctx.world.emit(EventType.UI_UPDATE, {
        component: "playerName",
        data: { name: data.name },
      });
    }
  };

  // ========================================================================
  // Helper Methods
  // ========================================================================

  applyPendingModifications = (entityId: string): void => {
    const pending = this.ctx.pendingModifications.get(entityId);
    if (pending && pending.length > 0) {
      this.ctx.logger.info(
        `Applying ${pending.length} pending modifications for entity ${entityId}`,
      );
      pending.forEach((mod) => this.onEntityModified({ ...mod, id: entityId }));

      this.ctx.pendingModifications.delete(entityId);
      this.ctx.pendingModificationTimestamps.delete(entityId);
      this.ctx.pendingModificationLimitReached.delete(entityId);
    }
  };
}
