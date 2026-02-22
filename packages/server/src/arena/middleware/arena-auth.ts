/**
 * Arena Authentication Middleware
 *
 * Provides Fastify preHandler hooks for authenticating arena API requests.
 *
 * Authentication strategies:
 * - **Write Key**: Shared secret for server-to-server calls (external bets,
 *   wallet links, invite redemption, whitelist management, payout jobs).
 *   Uses timing-safe comparison to prevent timing attacks.
 * - **Privy Token**: JWT-based user authentication for player-facing
 *   endpoints (bet recording, claim building, deposit ingestion).
 *
 * All write-key protected endpoints fail closed in production when the
 * write key is not configured.
 */

import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  verifyPrivyToken,
  isPrivyEnabled,
} from "../../infrastructure/auth/privy-auth.js";

/**
 * Timing-safe string comparison.
 *
 * Pads both values to the same length before comparing to prevent
 * the length itself from leaking information.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(maxLen, 0);
  const bBuf = Buffer.alloc(maxLen, 0);
  aBuf.write(a);
  bBuf.write(b);
  return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

/**
 * Extract write key from request headers.
 *
 * Supports both single-value and array-value header formats.
 */
function extractWriteKey(request: FastifyRequest): string | undefined {
  const header = request.headers["x-arena-write-key"];
  if (typeof header === "string") return header;
  if (Array.isArray(header)) return header[0];
  return undefined;
}

/**
 * Fastify preHandler that verifies the `x-arena-write-key` header.
 *
 * Behaviour:
 * - In production, if `ARENA_EXTERNAL_BET_WRITE_KEY` is not set, all
 *   requests are rejected (fail closed).
 * - In non-production, if the env var is not set the check is skipped
 *   so local development works without extra config.
 * - When the env var IS set, the provided header must match using a
 *   timing-safe comparison.
 */
export async function requireWriteKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const configuredWriteKey =
    process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ?? "";
  const isProduction = process.env.NODE_ENV === "production";

  // Fail closed in production when write key is not configured
  if (!configuredWriteKey) {
    if (isProduction) {
      reply
        .code(503)
        .send({
          error: "Write-key protected endpoint is disabled (no key configured)",
        });
      return;
    }
    // Non-production: allow through for dev ergonomics
    return;
  }

  const providedWriteKey = extractWriteKey(request);
  if (
    !providedWriteKey ||
    !timingSafeEqual(providedWriteKey, configuredWriteKey)
  ) {
    reply
      .code(401)
      .send({ error: "Unauthorized: invalid or missing write key" });
    return;
  }
}

/**
 * Fastify preHandler that verifies the caller has a valid Privy auth token.
 *
 * Extracts the token from the `Authorization: Bearer <token>` header,
 * verifies it with Privy, and decorates `request.arenaWallet` with
 * the authenticated wallet address.
 *
 * Behaviour when Privy is not configured:
 * - In production, rejects the request (fail closed).
 * - In non-production, skips verification for dev ergonomics. If a
 *   `x-arena-wallet` header is present, it is used as the wallet address
 *   (dev-only convenience).
 */
export async function requirePrivyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";

  if (!isPrivyEnabled()) {
    if (isProduction) {
      reply.code(503).send({ error: "Authentication is not configured" });
      return;
    }
    // Dev mode: use header-provided wallet for testing
    const devWallet =
      typeof request.headers["x-arena-wallet"] === "string"
        ? request.headers["x-arena-wallet"]
        : undefined;
    (request as FastifyRequest & { arenaWallet?: string }).arenaWallet =
      devWallet ?? undefined;
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply
      .code(401)
      .send({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const userInfo = await verifyPrivyToken(token);
    if (!userInfo) {
      reply.code(401).send({ error: "Invalid or expired auth token" });
      return;
    }
    (
      request as FastifyRequest & { arenaWallet?: string; arenaUserId?: string }
    ).arenaWallet = userInfo.walletAddress ?? undefined;
    (
      request as FastifyRequest & { arenaWallet?: string; arenaUserId?: string }
    ).arenaUserId = userInfo.privyUserId;
  } catch {
    reply.code(401).send({ error: "Auth token verification failed" });
  }
}
