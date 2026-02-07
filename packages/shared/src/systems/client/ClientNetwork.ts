/**
 * ClientNetwork.ts - Client-Side Networking System
 *
 * Manages WebSocket connection to game server and handles network communication.
 * Provides entity synchronization, latency compensation, and packet handling.
 *
 * Key Features:
 * - **WebSocket Client**: Persistent connection to game server
 * - **Entity Sync**: Replicates server entities to client
 * - **Interpolation**: Smooth movement between server updates
 * - **Packet System**: Efficient binary protocol using msgpackr
 * - **Reconnection**: Automatic reconnect with exponential backoff
 * - **Ping/Latency**: Round-trip time measurement
 * - **Buffering**: Handles network jitter and packet loss
 * - **Compression**: Optional packet compression for low bandwidth
 *
 * Network Architecture:
 * - Server is authoritative for all game state
 * - Client receives snapshots at 8Hz (every 125ms)
 * - Client interpolates between snapshots for smooth 60 FPS
 * - Client sends input at 30Hz for responsive controls
 * - Server validates all client actions
 *
 * Packet Types:
 * - **init**: Initial connection setup
 * - **snapshot**: World state update from server
 * - **entityAdded**: New entity spawned
 * - **entityModified**: Entity state changed
 * - **entityRemoved**: Entity destroyed
 * - **chatMessage**: Text chat from players
 * - **input**: Player input commands
 * - **ping**: Latency measurement
 *
 * Entity Interpolation:
 * - Maintains buffer of last 3 server snapshots
 * - Interpolates position/rotation between snapshots
 * - Compensates for network jitter
 * - Predicts movement for local player
 * - Server correction when prediction wrong
 *
 * Latency Compensation:
 * - Measures round-trip time (RTT)
 * - Adjusts interpolation delay based on RTT
 * - Client-side prediction for local player
 * - Server rewind for hit detection
 *
 * Connection States:
 * - Connecting: Initial WebSocket handshake
 * - Connected: Active connection, receiving packets
 * - Disconnected: Connection lost, attempting reconnect
 * - Error: Fatal error, manual reconnect required
 *
 * Error Handling:
 * - Graceful disconnect on server shutdown
 * - Auto-reconnect on network interruption
 * - Packet validation and error recovery
 * - Session restoration on reconnect
 *
 * Usage:
 * ```typescript
 * // Connect to server
 * await world.network.connect('wss://server.com/ws');
 *
 * // Send chat message
 * world.network.sendChat('Hello world!');
 *
 * // Get current latency
 * const ping = world.network.getPing();
 *
 * // Handle disconnection
 * world.network.on('disconnected', () => {
 *   console.log('Lost connection to server');
 * });
 * ```
 *
 * Related Systems:
 * - ServerNetwork: Server-side counterpart
 * - Entities: Manages replicated entities
 * - PlayerLocal: Sends input to server
 * - ClientInput: Captures player actions
 *
 * Dependencies:
 * - WebSocket API (browser native)
 * - msgpackr: Binary serialization
 * - EventBus: System events
 *
 * @see packets.ts for packet format
 * @see ServerNetwork.ts for server implementation
 */

// moment removed; use native Date
import * as THREE from "../../extras/three/three";
import { readPacket, writePacket } from "../../platform/shared/packets";
import type { World, WorldOptions } from "../../types";
import { EventType } from "../../types/events";
import { SystemBase } from "../shared/infrastructure/SystemBase";
import { TileInterpolator } from "./TileInterpolator";
import { InterpolationEngine } from "./network/InterpolationEngine";
import {
  ConnectionManager,
  type ConnectionCallbacks,
} from "./network/ConnectionManager";
import {
  PacketHandlers,
  type PacketHandlerContext,
} from "./network/PacketHandlers";

/**
 * Client Network System
 *
 * Manages connection to game server and entity synchronization.
 * Runs only on client (browser).
 *
 * - runs on the client
 * - provides abstract network methods matching ServerNetwork
 *
 */
export class ClientNetwork extends SystemBase {
  ids: number;
  isClient: boolean;
  isServer: boolean;
  queue: Array<[string, unknown]>;
  serverTimeOffset: number;
  /** Offset to sync world time with server for day/night cycle */
  worldTimeOffset: number;
  pendingModifications: Map<string, Array<Record<string, unknown>>> = new Map();
  pendingModificationTimestamps: Map<string, number> = new Map(); // Track when modifications were first queued
  pendingModificationLimitReached: Set<string> = new Set(); // Track entities that hit the limit (to avoid log spam)

  // Outgoing message queue (for messages sent while disconnected)
  private outgoingQueue: Array<{
    name: string;
    data: unknown;
    timestamp: number;
  }> = [];
  private maxOutgoingQueueSize: number = 100;
  private outgoingQueueSequence: number = 0;
  // Cache character list so UI can render even if it mounts after the packet arrives
  lastCharacterList: Array<{
    id: string;
    name: string;
    level?: number;
    lastLocation?: { x: number; y: number; z: number };
  }> | null = null;
  // Cache latest inventory per player so UI can hydrate even if it mounted late
  lastInventoryByPlayerId: Record<
    string,
    {
      playerId: string;
      items: Array<{ slot: number; itemId: string; quantity: number }>;
      coins: number;
      maxSlots: number;
    }
  > = {};
  // Cache latest skills per player so UI can hydrate even if it mounted late
  lastSkillsByPlayerId: Record<
    string,
    Record<string, { level: number; xp: number }>
  > = {};
  // Cache latest equipment per player so UI can hydrate even if it mounted late
  lastEquipmentByPlayerId: Record<string, Record<string, unknown>> = {};
  // Cache latest attack style per player so UI can hydrate even if it mounted late
  // (mirrors skills caching pattern - prevents race condition on page refresh)
  lastAttackStyleByPlayerId: Record<
    string,
    {
      currentStyle: { id: string };
      availableStyles: unknown;
      canChange: boolean;
    }
  > = {};
  // Cache latest prayer state per player so UI can hydrate even if it mounted late
  lastPrayerStateByPlayerId: Record<
    string,
    { points: number; maxPoints: number; active: string[] }
  > = {};
  // Cache action bar state so UI can hydrate even if it mounts late
  lastActionBarState: {
    barId: string;
    slotCount: number;
    slots: Array<{ slotIndex: number; itemId?: string; actionId?: string }>;
  } | null = null;

  // Spectator mode state
  private spectatorFollowEntity: string | undefined;
  private spectatorTargetPending = false;
  private spectatorRetryInterval:
    | ReturnType<typeof setInterval>
    | number
    | null = null;

  // Tile-based interpolation for RuneScape-style movement
  // Public to allow position sync on respawn/teleport
  public tileInterpolator: TileInterpolator = new TileInterpolator();

  // Entity interpolation engine (smooth remote entity movement)
  private interpolationEngine: InterpolationEngine;

  // Track dead players to prevent position updates from entityModified packets
  // CRITICAL: Prevents race condition where entityModified packets arrive after death
  // and overwrite the respawn position for other players
  private deadPlayers: Set<string> = new Set();

  // Embedded viewport configuration (read once at init)
  private embeddedCharacterId: string | null = null;

  // Connection lifecycle manager (WebSocket, auth, reconnection)
  private connectionManager: ConnectionManager;

  // Packet handler subsystem (all on* handlers live here)
  private packetHandlers: PacketHandlers;

  // --- Delegated getters for connection state (public API unchanged) ---

  /** The active WebSocket connection (delegated to ConnectionManager) */
  get ws(): WebSocket | null {
    return this.connectionManager.ws;
  }
  set ws(value: WebSocket | null) {
    this.connectionManager.ws = value;
  }

  /** API base URL received from server snapshot */
  get apiUrl(): string | null {
    return this.connectionManager.apiUrl;
  }
  set apiUrl(value: string | null) {
    this.connectionManager.apiUrl = value;
  }

  /** Our player/connection ID assigned by the server */
  get id(): string | null {
    return this.connectionManager.id;
  }
  set id(value: string | null) {
    this.connectionManager.id = value;
  }

  /** Whether we currently have an active connection */
  get connected(): boolean {
    return this.connectionManager.connected;
  }
  set connected(value: boolean) {
    this.connectionManager.connected = value;
  }

  /** Maximum file upload size (bytes) */
  get maxUploadSize(): number {
    return this.connectionManager.maxUploadSize;
  }
  set maxUploadSize(value: number) {
    this.connectionManager.maxUploadSize = value;
  }

  /** Whether this client is running as an embedded spectator viewport */
  get isEmbeddedSpectator(): boolean {
    return this.connectionManager.isEmbeddedSpectator;
  }

  /** Check if currently attempting to reconnect */
  get reconnecting(): boolean {
    return this.connectionManager.reconnecting;
  }

  constructor(world: World) {
    super(world, {
      name: "client-network",
      dependencies: { required: [], optional: [] },
      autoCleanup: true,
    });

    // Build callbacks for ConnectionManager -> ClientNetwork communication
    const callbacks: ConnectionCallbacks = {
      onPacket: this.onPacket,
      onConnected: () => {
        this.emitTypedEvent("NETWORK_RECONNECTED", {
          attempts: 0, // actual count managed inside ConnectionManager
        });
      },
      onDisconnected: (code: number, reason: string) => {
        this.emitTypedEvent("NETWORK_DISCONNECTED", {
          code,
          reason,
        });
      },
      onReconnecting: (
        attempt: number,
        maxAttempts: number,
        delayMs: number,
      ) => {
        this.emitTypedEvent("NETWORK_RECONNECTING", {
          attempt,
          maxAttempts,
          delayMs,
        });
      },
      onReconnectFailed: (attempts: number) => {
        this.emitTypedEvent("NETWORK_RECONNECT_FAILED", {
          attempts,
          reason: "max_attempts_exceeded",
        });
      },
      flushOutgoingQueue: () => {
        this.flushOutgoingQueue();
      },
    };

    this.connectionManager = new ConnectionManager(world, callbacks);

    this.ids = -1;
    this.isClient = true;
    this.isServer = false;
    this.queue = [];
    this.serverTimeOffset = 0;
    this.worldTimeOffset = 0;
    this.interpolationEngine = new InterpolationEngine(
      world,
      this.tileInterpolator,
    );

    // Build PacketHandlerContext that bridges PacketHandlers -> ClientNetwork
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const ctx: PacketHandlerContext = {
      world,
      get id() {
        return self.connectionManager.id;
      },
      set id(v) {
        self.connectionManager.id = v;
      },
      get connected() {
        return self.connectionManager.connected;
      },
      set connected(v) {
        self.connectionManager.connected = v;
      },
      get apiUrl() {
        return self.connectionManager.apiUrl;
      },
      set apiUrl(v) {
        self.connectionManager.apiUrl = v;
      },
      get maxUploadSize() {
        return self.connectionManager.maxUploadSize;
      },
      set maxUploadSize(v) {
        self.connectionManager.maxUploadSize = v;
      },
      get isEmbeddedSpectator() {
        return self.connectionManager.isEmbeddedSpectator;
      },
      get serverTimeOffset() {
        return self.serverTimeOffset;
      },
      set serverTimeOffset(v) {
        self.serverTimeOffset = v;
      },
      get worldTimeOffset() {
        return self.worldTimeOffset;
      },
      set worldTimeOffset(v) {
        self.worldTimeOffset = v;
      },
      get embeddedCharacterId() {
        return self.embeddedCharacterId;
      },
      set embeddedCharacterId(v) {
        self.embeddedCharacterId = v;
      },
      pendingModifications: this.pendingModifications,
      pendingModificationTimestamps: this.pendingModificationTimestamps,
      pendingModificationLimitReached: this.pendingModificationLimitReached,
      deadPlayers: this.deadPlayers,
      get spectatorFollowEntity() {
        return self.spectatorFollowEntity;
      },
      set spectatorFollowEntity(v) {
        self.spectatorFollowEntity = v;
      },
      get spectatorTargetPending() {
        return self.spectatorTargetPending;
      },
      set spectatorTargetPending(v) {
        self.spectatorTargetPending = v;
      },
      get spectatorRetryInterval() {
        return self.spectatorRetryInterval;
      },
      set spectatorRetryInterval(v) {
        self.spectatorRetryInterval = v;
      },
      tileInterpolator: this.tileInterpolator,
      interpolationEngine: this.interpolationEngine,
      get lastCharacterList() {
        return self.lastCharacterList;
      },
      set lastCharacterList(v) {
        self.lastCharacterList = v;
      },
      get lastInventoryByPlayerId() {
        return self.lastInventoryByPlayerId;
      },
      set lastInventoryByPlayerId(v) {
        self.lastInventoryByPlayerId = v;
      },
      get lastSkillsByPlayerId() {
        return self.lastSkillsByPlayerId;
      },
      set lastSkillsByPlayerId(v) {
        self.lastSkillsByPlayerId = v;
      },
      get lastEquipmentByPlayerId() {
        return self.lastEquipmentByPlayerId;
      },
      set lastEquipmentByPlayerId(v) {
        self.lastEquipmentByPlayerId = v;
      },
      get lastAttackStyleByPlayerId() {
        return self.lastAttackStyleByPlayerId;
      },
      set lastAttackStyleByPlayerId(v) {
        self.lastAttackStyleByPlayerId = v;
      },
      get lastPrayerStateByPlayerId() {
        return self.lastPrayerStateByPlayerId;
      },
      set lastPrayerStateByPlayerId(v) {
        self.lastPrayerStateByPlayerId = v;
      },
      get lastActionBarState() {
        return self.lastActionBarState;
      },
      set lastActionBarState(v) {
        self.lastActionBarState = v;
      },
      send: <T = unknown>(name: string, data?: T) => this.send(name, data),
      emitTypedEvent: (type: string, data: Record<string, unknown>) =>
        this.emitTypedEvent(type, data),
      emit: (event: string, data: unknown) => this.emit(event, data),
      logger: this.logger,
    };
    this.packetHandlers = new PacketHandlers(ctx);
  }

  async init(options: WorldOptions): Promise<void> {
    await this.connectionManager.connect(options, (characterId) => {
      this.embeddedCharacterId = characterId;
    });
    this.initialized = true;
  }

  preFixedUpdate() {
    this.flush();

    // Periodically clean up stale pending modifications (every ~5 seconds at 60fps = ~300 frames)
    // Only check occasionally to avoid performance impact
    if (Math.random() < 0.003) {
      this.cleanupStalePendingModifications();
    }
  }

  /**
   * Clean up pending modifications that are too old (entity never arrived)
   */
  private cleanupStalePendingModifications(): void {
    const now = performance.now();
    const staleTimeout = 10000; // 10 seconds

    for (const [
      entityId,
      timestamp,
    ] of this.pendingModificationTimestamps.entries()) {
      const age = now - timestamp;
      if (age > staleTimeout) {
        // Silent cleanup to avoid log spam
        this.pendingModifications.delete(entityId);
        this.pendingModificationTimestamps.delete(entityId);
        this.pendingModificationLimitReached.delete(entityId);
      }
    }
  }

  send<T = unknown>(name: string, data?: T) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // console.debug(`[ClientNetwork] Sending packet: ${name}`, data)
      const packet = writePacket(name, data);
      this.ws.send(packet);
    } else if (this.connectionManager.reconnecting) {
      // Queue message for later delivery when reconnected
      this.queueOutgoingMessage(name, data);
    } else {
      console.warn(
        `[ClientNetwork] Cannot send ${name} - WebSocket not open. State:`,
        {
          hasWs: !!this.ws,
          readyState: this.ws?.readyState,
          connected: this.connected,
          id: this.id,
          isReconnecting: this.connectionManager.reconnecting,
        },
      );
    }
  }

  /**
   * Queue an outgoing message for delivery when reconnected
   */
  private queueOutgoingMessage<T>(name: string, data?: T): void {
    // Don't queue certain messages that don't make sense after reconnection
    const skipQueuePatterns = ["ping", "pong", "heartbeat"];
    if (skipQueuePatterns.some((pattern) => name.includes(pattern))) {
      return;
    }

    // Enforce queue size limit (LRU - remove oldest)
    if (this.outgoingQueue.length >= this.maxOutgoingQueueSize) {
      const dropped = this.outgoingQueue.shift();
      this.logger.debug(
        `Outgoing queue full, dropped oldest message: ${dropped?.name}`,
      );
    }

    this.outgoingQueue.push({
      name,
      data,
      timestamp: Date.now(),
    });
    this.outgoingQueueSequence++;

    this.logger.debug(
      `Queued message for reconnection: ${name} (queue size: ${this.outgoingQueue.length})`,
    );
  }

  /**
   * Flush queued outgoing messages after reconnection
   */
  private flushOutgoingQueue(): void {
    if (this.outgoingQueue.length === 0) {
      return;
    }

    this.logger.debug(`Flushing ${this.outgoingQueue.length} queued messages`);

    // Filter out stale messages (older than 30 seconds)
    const staleThreshold = 30000;
    const now = Date.now();
    const validMessages = this.outgoingQueue.filter(
      (msg) => now - msg.timestamp < staleThreshold,
    );

    const staleCount = this.outgoingQueue.length - validMessages.length;
    if (staleCount > 0) {
      this.logger.debug(
        `Dropped ${staleCount} stale messages from outgoing queue`,
      );
    }

    // Send valid messages
    for (const msg of validMessages) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const packet = writePacket(msg.name, msg.data);
        this.ws.send(packet);
        this.logger.debug(`Sent queued message: ${msg.name}`);
      }
    }

    // Clear the queue
    this.outgoingQueue = [];
    this.outgoingQueueSequence = 0;
  }

  enqueue(method: string, data: unknown) {
    this.queue.push([method, data]);
  }

  async flush() {
    // Don't process queue if WebSocket is not connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const handlers = this.packetHandlers as unknown as Record<string, unknown>;

    while (this.queue.length) {
      const [method, data] = this.queue.shift()!;
      // Support both direct method names (snapshot) and onX handlers (onSnapshot)
      // Look up in PacketHandlers first, then fall back to ClientNetwork (for non-handler methods)
      const onName = `on${method.charAt(0).toUpperCase()}${method.slice(1)}`;
      let handler: unknown = handlers[method] || handlers[onName];
      let bindTarget: unknown = this.packetHandlers;
      if (!handler) {
        handler =
          (this as Record<string, unknown>)[method] ||
          (this as Record<string, unknown>)[onName];
        bindTarget = this;
      }
      if (!handler) {
        console.error(`[ClientNetwork] No handler for packet '${method}'`);
        continue; // Skip unknown packets instead of throwing to avoid breaking queue
      }
      try {
        // Strong type assumption - handler is a function
        const result = (handler as Function).call(bindTarget, data);
        if (result instanceof Promise) {
          await result;
        }
      } catch (err) {
        console.error(
          `[ClientNetwork] Error handling packet '${method}':`,
          err,
        );
        // Continue processing remaining packets even if one fails
      }
    }
  }

  getTime() {
    return (performance.now() + this.serverTimeOffset) / 1000; // seconds
  }

  onPacket = (e: MessageEvent) => {
    const result = readPacket(e.data);
    if (result && result[0]) {
      const [method, data] = result;
      this.enqueue(method, data);
    }
  };

  /**
   * Get the synced world time (adjusted for server offset)
   * Use this for day/night cycle instead of world.getTime()
   */
  getSyncedWorldTime(): number {
    return this.world.getTime() + this.worldTimeOffset;
  }

  // ========================================================================
  // Convenience Methods (outgoing packets)
  // ========================================================================

  // Friend convenience methods
  sendFriendRequest(targetName: string) {
    this.send("friendRequest", { targetName });
  }

  acceptFriendRequest(requestId: string) {
    this.send("friendAccept", { requestId });
  }

  declineFriendRequest(requestId: string) {
    this.send("friendDecline", { requestId });
  }

  removeFriend(friendId: string) {
    this.send("friendRemove", { friendId });
  }

  addToIgnoreList(targetName: string) {
    this.send("ignoreAdd", { targetName });
  }

  removeFromIgnoreList(ignoredId: string) {
    this.send("ignoreRemove", { ignoredId });
  }

  sendPrivateMessage(targetName: string, content: string) {
    this.send("privateMessage", { targetName, content });
  }

  // Trade convenience methods
  requestTrade(targetPlayerId: string) {
    this.send("tradeRequest", { targetPlayerId });
  }

  respondToTradeRequest(tradeId: string, accept: boolean) {
    this.send("tradeRequestRespond", { tradeId, accept });
  }

  addItemToTrade(tradeId: string, inventorySlot: number, quantity?: number) {
    this.send("tradeAddItem", { tradeId, inventorySlot, quantity });
  }

  removeItemFromTrade(tradeId: string, tradeSlot: number) {
    this.send("tradeRemoveItem", { tradeId, tradeSlot });
  }

  acceptTrade(tradeId: string) {
    this.send("tradeAccept", { tradeId });
  }

  cancelTradeAccept(tradeId: string) {
    this.send("tradeCancelAccept", { tradeId });
  }

  cancelTrade(tradeId: string) {
    this.send("tradeCancel", { tradeId });
  }

  // Character convenience methods
  requestCharacterCreate(name: string) {
    this.send("characterCreate", { name });
  }
  requestCharacterSelect(characterId: string) {
    this.send("characterSelected", { characterId });
  }
  requestEnterWorld() {
    this.send("enterWorld", {});
  }

  // Inventory actions
  dropItem(itemId: string, slot?: number, quantity?: number) {
    this.send("dropItem", { itemId, slot, quantity });
  }

  // Prayer actions
  togglePrayer(prayerId: string) {
    this.send("prayerToggle", { prayerId, timestamp: Date.now() });
  }

  deactivateAllPrayers() {
    this.send("prayerDeactivateAll", { timestamp: Date.now() });
  }

  prayAtAltar(altarId: string) {
    this.send("altarPray", { altarId, timestamp: Date.now() });
  }

  // Magic autocast actions
  setAutocast(spellId: string | null) {
    this.send("setAutocast", { spellId, timestamp: Date.now() });
  }

  // ========================================================================
  // Interpolation / Late Update
  // ========================================================================

  /**
   * Update interpolation in lateUpdate (after entity updates)
   */
  lateUpdate(delta: number): void {
    this.interpolationEngine.update(delta);

    // Get terrain system for height lookups
    const terrain = this.world.getSystem("terrain") as {
      getHeightAt?: (x: number, z: number) => number | null;
    } | null;

    // Update tile-based interpolation (RuneScape-style)
    this.tileInterpolator.update(
      delta,
      (id: string) => {
        const entity = this.world.entities.get(id);
        if (!entity) return undefined;
        // Cast to access base (players have VRM on base, rotation should be set there)
        const entityWithBase = entity as typeof entity & {
          base?: THREE.Object3D;
        };
        return {
          position: entity.position as THREE.Vector3,
          node: entity.node as THREE.Object3D | undefined,
          base: entityWithBase.base,
          data: entity.data as Record<string, unknown>,
          // modify() triggers PlayerLocal's emote handling (avatar animation updates)
          modify: (data: Record<string, unknown>) => entity.modify(data),
        };
      },
      // Pass terrain height function for smooth Y updates
      terrain?.getHeightAt
        ? (x: number, z: number) => terrain.getHeightAt!(x, z)
        : undefined,
      // Callback when entity finishes moving - emit ENTITY_MODIFIED for InteractionSystem
      // This enables event-based pending interactions (NPC trade, bank open, etc.)
      (entityId: string, position: { x: number; y: number; z: number }) => {
        this.world.emit(EventType.ENTITY_MODIFIED, {
          id: entityId,
          changes: {
            e: "idle",
            p: [position.x, position.y, position.z],
          },
        });
      },
    );
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  destroy = () => {
    // Delegate WebSocket cleanup to ConnectionManager
    this.connectionManager.destroyConnection();
    // Clear any pending queue items
    this.queue.length = 0;
    // Clear outgoing queue
    this.outgoingQueue = [];
    this.outgoingQueueSequence = 0;
    // Clear interpolation states
    this.interpolationEngine.clear();
    // Clear tile interpolation states
    this.tileInterpolator.clear();
    // Clear pending modifications tracking
    this.pendingModifications.clear();
    this.pendingModificationTimestamps.clear();
    this.pendingModificationLimitReached.clear();
    // Clear dead players tracking
    this.deadPlayers.clear();
  };

  // Plugin-specific upload method (delegated to ConnectionManager)
  async upload(file: File): Promise<string> {
    return this.connectionManager.upload(file);
  }

  // Plugin-specific disconnect method (delegated to ConnectionManager)
  async disconnect(): Promise<void> {
    return this.connectionManager.disconnect();
  }
}
