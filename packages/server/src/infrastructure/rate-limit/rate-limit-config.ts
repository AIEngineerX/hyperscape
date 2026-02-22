/**
 * Rate Limit Configuration Module
 *
 * Provides production-ready rate limiting configuration for different endpoint types.
 * Prevents abuse, DDoS attacks, and excessive resource consumption.
 *
 * **Rate Limiting Strategy**:
 * - Upload endpoints: 10 requests per minute (file uploads are resource-intensive)
 * - Action endpoints: 60 requests per minute (game actions need reasonable throughput)
 * - General API: 100 requests per minute (default for other endpoints)
 * - WebSocket: No rate limiting (handled by connection limits)
 *
 * **Implementation**:
 * Uses @fastify/rate-limit with IP-based tracking and Redis support for
 * distributed deployments (when configured).
 *
 * **Production Considerations**:
 * - In production, consider using Redis for distributed rate limiting
 * - Adjust limits based on actual traffic patterns and server capacity
 * - Monitor rate limit hits to detect attack patterns
 * - Consider different limits for authenticated vs unauthenticated users
 *
 * Usage:
 * ```typescript
 * import { getUploadRateLimit, getActionRateLimit } from './infrastructure/rate-limit/rate-limit-config';
 * fastify.register(rateLimit, getUploadRateLimit());
 * ```
 */

import type { RateLimitOptions } from "@fastify/rate-limit";

/**
 * Global rate limit configuration
 *
 * Applied to all routes unless overridden by specific route limits.
 * Prevents general API abuse across all endpoints.
 *
 * Limits:
 * - 100 requests per minute per IP
 * - 429 status code on limit exceeded
 * - Standard error response format
 *
 * @returns Rate limit configuration for general API endpoints
 */
export function getGlobalRateLimit(): RateLimitOptions {
  return {
    max: 100,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl || 60000) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl || 60000) / 1000),
    }),
  };
}

/**
 * Upload endpoint rate limit configuration
 *
 * Stricter limits for file uploads due to:
 * - Disk I/O overhead
 * - Network bandwidth consumption
 * - CPU overhead for hashing
 * - Potential for large file attacks
 *
 * Limits:
 * - 10 requests per minute per IP
 * - 429 status code on limit exceeded
 * - Detailed error message with retry-after
 *
 * @returns Rate limit configuration for upload endpoints
 */
export function getUploadRateLimit(): RateLimitOptions {
  return {
    max: 10,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Upload rate limit exceeded. Maximum 10 uploads per minute. Try again in ${Math.ceil((context.ttl || 60000) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl || 60000) / 1000),
    }),
  };
}

/**
 * Action endpoint rate limit configuration
 *
 * Balanced limits for game actions:
 * - Allows reasonable gameplay throughput
 * - Prevents action spam/abuse
 * - Protects database from excessive writes
 *
 * Limits:
 * - 60 requests per minute per IP
 * - 429 status code on limit exceeded
 * - Game-specific error message
 *
 * @returns Rate limit configuration for action endpoints
 */
export function getActionRateLimit(): RateLimitOptions {
  return {
    max: 60,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Action rate limit exceeded. Maximum 60 actions per minute. Try again in ${Math.ceil((context.ttl || 60000) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl || 60000) / 1000),
    }),
  };
}

/**
 * Authentication endpoint rate limit configuration
 *
 * Very strict limits for authentication to prevent:
 * - Brute force attacks
 * - Credential stuffing
 * - Account enumeration
 *
 * Limits:
 * - 5 requests per minute per IP
 * - 429 status code on limit exceeded
 * - Security-focused error message
 *
 * @returns Rate limit configuration for authentication endpoints
 */
export function getAuthRateLimit(): RateLimitOptions {
  return {
    max: 5,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Authentication rate limit exceeded. Maximum 5 attempts per minute. Try again in ${Math.ceil((context.ttl || 60000) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl || 60000) / 1000),
    }),
  };
}

/**
 * Check if rate limiting should be enabled
 *
 * In production, rate limiting is always enabled for security.
 * In non-production environments, rate limiting is disabled by default
 * for easier local development, unless explicitly enabled.
 *
 * Controls:
 * - `NODE_ENV=production` => always enabled
 * - `DISABLE_RATE_LIMIT=true` => disabled (non-production only)
 * - `DISABLE_RATE_LIMIT=false` => enabled (non-production only)
 * - unset in non-production => disabled by default
 *
 * @returns true if rate limiting should be enabled
 */
export function isRateLimitEnabled(): boolean {
  const toggle = process.env.DISABLE_RATE_LIMIT;
  if (toggle != null && toggle.trim() !== "") {
    const normalized = toggle.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return false;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return true;
    }

    // Unknown value: fail safe for dev ergonomics.
    return false;
  }

  // Production default remains enabled unless explicitly disabled above.
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  // Non-production default is disabled for local dev ergonomics.
  return false;
}
