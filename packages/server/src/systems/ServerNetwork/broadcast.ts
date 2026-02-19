/**
 * Broadcast Module - Network message broadcasting
 *
 * Handles sending messages to clients via WebSocket connections.
 * Provides methods for broadcasting to all clients, specific clients,
 * or clients by player ID.
 *
 * Responsibilities:
 * - Broadcast to all connected clients (with optional exclusion)
 * - Send to specific socket by socket ID
 * - Send to specific player by player ID
 * - Packet serialization and delivery
 *
 * Usage:
 * ```typescript
 * const broadcast = new BroadcastManager(sockets);
 * broadcast.sendToAll('chat', { message: 'Hello' }, excludeSocketId);
 * broadcast.sendToSocket(socketId, 'update', data);
 * broadcast.sendToPlayer(playerId, 'inventory', items);
 * ```
 */

import type { ServerSocket } from "../../shared/types";
import { writePacket } from "@hyperscape/shared";
import type { SpatialIndex } from "./SpatialIndex";
import { BandwidthBudget, PacketPriority } from "./BandwidthBudget";

/**
 * BroadcastManager - Manages network message broadcasting
 *
 * Provides centralized broadcasting logic that can be shared across
 * ServerNetwork components.
 */
export class BroadcastManager {
  private spatialIndex: SpatialIndex | null = null;
  readonly bandwidthBudget = new BandwidthBudget();

  /**
   * Create a BroadcastManager
   *
   * @param sockets - Map of active socket connections (passed by reference)
   */
  constructor(private sockets: Map<string, ServerSocket>) {}

  /** Attach a spatial index for interest-managed broadcasts. */
  setSpatialIndex(index: SpatialIndex): void {
    this.spatialIndex = index;
  }

  /**
   * Broadcast message to all connected clients
   *
   * Sends a message to all active sockets except the one specified
   * by ignoreSocketId (useful for echoing player actions to others).
   *
   * @param name - Message type/name
   * @param data - Message payload
   * @param ignoreSocketId - Optional socket ID to exclude from broadcast
   * @returns Number of clients that received the message
   */
  sendToAll<T = unknown>(
    name: string,
    data: T,
    ignoreSocketId?: string,
    priority: PacketPriority = PacketPriority.NORMAL,
  ): number {
    const packet = writePacket(name, data);
    const packetBytes = packet.byteLength;
    let sentCount = 0;

    this.sockets.forEach((socket) => {
      if (socket.id === ignoreSocketId) {
        return;
      }
      socket.sendPacket(packet);
      sentCount++;
    });

    return sentCount;
  }

  /**
   * Broadcast to players near a world position (interest management).
   *
   * Uses the spatial index to find players within a 3×3 region grid
   * (~63×63 tiles). Falls back to sendToAll if no spatial index is set.
   *
   * @param name - Message type/name
   * @param data - Message payload
   * @param worldX - World X coordinate of the event
   * @param worldZ - World Z coordinate of the event
   * @param ignoreSocketId - Optional socket ID to exclude
   * @returns Number of clients that received the message
   */
  sendToNearby<T = unknown>(
    name: string,
    data: T,
    worldX: number,
    worldZ: number,
    ignoreSocketId?: string,
    priority: PacketPriority = PacketPriority.HIGH,
  ): number {
    if (!this.spatialIndex) {
      return this.sendToAll(name, data, ignoreSocketId, priority);
    }

    const nearbyPlayerIds = this.spatialIndex.getPlayersNear(worldX, worldZ);
    if (nearbyPlayerIds.length === 0) return 0;

    const packet = writePacket(name, data);
    const packetBytes = packet.byteLength;
    let sentCount = 0;

    for (const playerId of nearbyPlayerIds) {
      const socket = this.getPlayerSocket(playerId);
      if (socket && socket.id !== ignoreSocketId) {
        socket.sendPacket(packet);
        sentCount++;
      }
    }

    // Spectator/stream sockets have no player entry in SpatialIndex.
    // Always forward nearby packets so camera-followed entities stay in sync.
    for (const socket of this.sockets.values()) {
      if (socket.id === ignoreSocketId) continue;
      if (!socket.isSpectator) continue;
      socket.sendPacket(packet);
      sentCount++;
    }

    return sentCount;
  }

  /**
   * Send message to specific socket by socket ID
   *
   * Looks up the socket by ID and sends the message if found.
   * Fails silently if socket doesn't exist.
   *
   * @param socketId - Target socket ID
   * @param name - Message type/name
   * @param data - Message payload
   * @returns True if socket was found and message sent
   */
  sendToSocket<T = unknown>(socketId: string, name: string, data: T): boolean {
    const socket = this.sockets.get(socketId);
    if (socket) {
      socket.send(name, data);
      return true;
    }
    return false;
  }

  /**
   * Send message to specific player by player ID
   *
   * Iterates through all sockets to find the one associated with
   * the given player ID, then sends the message.
   *
   * This is less efficient than sendToSocket() but useful when you
   * only have a player ID instead of socket ID.
   *
   * @param playerId - Target player ID
   * @param name - Message type/name
   * @param data - Message payload
   * @returns True if player was found and message sent
   */
  sendToPlayer<T = unknown>(playerId: string, name: string, data: T): boolean {
    for (const socket of this.sockets.values()) {
      if (socket.player && socket.player.id === playerId) {
        socket.send(name, data);
        return true;
      }
    }
    return false;
  }

  /**
   * Get the socket for a specific player
   *
   * Looks up the socket by player ID. Useful for accessing player
   * entity data or sending targeted messages.
   *
   * @param playerId - Target player ID
   * @returns The socket if found, undefined otherwise
   */
  getPlayerSocket(playerId: string): ServerSocket | undefined {
    for (const socket of this.sockets.values()) {
      if (socket.player && socket.player.id === playerId) {
        return socket;
      }
    }
    return undefined;
  }

  /**
   * Send message to a player AND any spectators watching that player
   *
   * This ensures spectators see real-time feedback like XP drops, damage numbers,
   * and other player-specific events that would normally only go to the player.
   *
   * @param playerId - Target player ID (also the character ID spectators follow)
   * @param name - Message type/name
   * @param data - Message payload
   * @returns Number of sockets that received the message (1 for player + N spectators)
   */
  sendToPlayerAndSpectators<T = unknown>(
    playerId: string,
    name: string,
    data: T,
  ): number {
    let sentCount = 0;

    for (const socket of this.sockets.values()) {
      // Send to the player themselves
      if (socket.player && socket.player.id === playerId) {
        socket.send(name, data);
        sentCount++;
        continue;
      }

      // Send to any spectators watching this player
      // spectatingCharacterId is set when a spectator connects to follow a character
      const socketWithSpectator = socket as ServerSocket & {
        isSpectator?: boolean;
        spectatingCharacterId?: string;
      };
      if (
        socketWithSpectator.isSpectator &&
        socketWithSpectator.spectatingCharacterId === playerId
      ) {
        socket.send(name, data);
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Clean up bandwidth tracking for a disconnected socket.
   */
  onSocketDisconnected(socketId: string): void {
    this.bandwidthBudget.removeConnection(socketId);
  }
}
