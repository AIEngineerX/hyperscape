/**
 * Chat Handler
 *
 * Handles chat message broadcasting to all connected clients.
 * Validates message content, enforces length limits, and verifies sender identity.
 */

import type { ServerSocket, ChatMessage } from "../../../shared/types";
import type { World } from "@hyperscape/shared";

/** Maximum chat message length */
const MAX_MESSAGE_LENGTH = 255;

/** Regex to strip control characters (except newline) */
const CONTROL_CHAR_REGEX = /[\x00-\x09\x0B-\x1F\x7F]/g;

export function handleChatAdded(
  socket: ServerSocket,
  data: unknown,
  world: World,
  sendFn: (name: string, data: unknown, ignoreSocketId?: string) => void,
): void {
  // Validate request structure
  if (!data || typeof data !== "object") {
    return;
  }

  const msg = data as ChatMessage;

  // Validate message exists and is a string
  if (typeof msg.message !== "string" || msg.message.length === 0) {
    return;
  }

  // Enforce length limit
  if (msg.message.length > MAX_MESSAGE_LENGTH) {
    msg.message = msg.message.slice(0, MAX_MESSAGE_LENGTH);
  }

  // Strip control characters
  msg.message = msg.message.replace(CONTROL_CHAR_REGEX, "");

  // Server-authoritative sender — override client-provided identity
  if (socket.player) {
    msg.userName = socket.player.data?.name || socket.player.id;
    msg.userId = socket.player.id;
  }

  // Ensure message has a type (default to "chat" for player messages)
  if (!msg.type) {
    msg.type = "chat";
  }

  // Add message to chat if method exists
  if (world.chat.add) {
    world.chat.add(msg, false);
  }
  sendFn("chatAdded", msg, socket.id);
}
