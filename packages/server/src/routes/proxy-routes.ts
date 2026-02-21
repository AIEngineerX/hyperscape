import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

type JsonRpcRequestPayload = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
};

type ProxiedRpcResponse = {
  status: number;
  body: string;
  contentType: string;
};

type CachedRpcResponse = ProxiedRpcResponse & {
  expiresAt: number;
};

const RPC_CACHEABLE_METHODS = new Set<string>([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getEpochSchedule",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getIdentity",
  "getLatestBlockhash",
  "getLeaderSchedule",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPerformanceSamples",
  "getSignaturesForAddress",
  "getSignatureStatuses",
  "getSlot",
  "getSupply",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
]);

const RPC_CACHE_TTL_MS_BY_METHOD: Record<string, number> = {
  getLatestBlockhash: 400,
  getBlockHeight: 400,
  getSlot: 400,
  getSignatureStatuses: 700,
  getAccountInfo: 1_000,
  getMultipleAccounts: 1_000,
  getProgramAccounts: 1_000,
  getBalance: 1_000,
  getTokenAccountBalance: 1_000,
  getTokenAccountsByOwner: 1_000,
  getSignaturesForAddress: 1_000,
};

const DEFAULT_RPC_CACHE_TTL_MS = 800;
const MAX_RPC_CACHE_ENTRIES = 2_048;
const rpcResponseCache = new Map<string, CachedRpcResponse>();
const rpcInflightRequests = new Map<string, Promise<ProxiedRpcResponse>>();

function normalizeCluster(
  value: unknown,
  fallback: SolanaCluster,
): SolanaCluster {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "mainnet-beta") {
    return "mainnet-beta";
  }
  if (
    normalized === "devnet" ||
    normalized === "testnet" ||
    normalized === "localnet"
  ) {
    return normalized;
  }
  return fallback;
}

function resolveRpcUpstream(cluster: SolanaCluster): string {
  if (cluster === "localnet") {
    return process.env.SOLANA_LOCALNET_RPC_URL || "http://127.0.0.1:8899";
  }

  if (cluster === "devnet") {
    return process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com";
  }

  if (cluster === "testnet") {
    return (
      process.env.SOLANA_TESTNET_RPC_URL || "https://api.testnet.solana.com"
    );
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return (
    process.env.SOLANA_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com"
  );
}

function resolveWsUpstream(cluster: SolanaCluster): string {
  if (cluster === "localnet") {
    return process.env.SOLANA_LOCALNET_WS_URL || "ws://127.0.0.1:8900";
  }

  if (cluster === "devnet") {
    return process.env.SOLANA_DEVNET_WS_URL || "wss://api.devnet.solana.com/";
  }

  if (cluster === "testnet") {
    return process.env.SOLANA_TESTNET_WS_URL || "wss://api.testnet.solana.com/";
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (apiKey) {
    return `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return (
    process.env.SOLANA_MAINNET_WS_URL || "wss://api.mainnet-beta.solana.com"
  );
}

function parseRpcPayload(body: unknown): JsonRpcRequestPayload[] | null {
  if (!body) return null;
  if (Array.isArray(body)) {
    const entries = body.filter((value) => value && typeof value === "object");
    return entries.length > 0 ? (entries as JsonRpcRequestPayload[]) : null;
  }
  if (typeof body === "object") {
    return [body as JsonRpcRequestPayload];
  }
  return null;
}

function normalizeRpcIdsForCache(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map((entry, index) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...(entry as Record<string, unknown>),
        id: index,
      };
    });
  }

  if (!body || typeof body !== "object") return body;
  return {
    ...(body as Record<string, unknown>),
    id: 0,
  };
}

function buildRpcCacheKey(
  cluster: SolanaCluster,
  body: unknown,
): string | null {
  try {
    const normalizedBody = normalizeRpcIdsForCache(body);
    return `${cluster}:${JSON.stringify(normalizedBody)}`;
  } catch {
    return null;
  }
}

function rewriteRpcResponseIds(
  responseBody: string,
  requestBody: unknown,
): string {
  try {
    const parsedResponse = JSON.parse(responseBody);

    if (Array.isArray(requestBody)) {
      const requestIds = requestBody.map((entry) =>
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>).id
          : undefined,
      );

      if (Array.isArray(parsedResponse)) {
        for (let index = 0; index < parsedResponse.length; index += 1) {
          const entry = parsedResponse[index];
          if (!entry || typeof entry !== "object") continue;
          (entry as Record<string, unknown>).id = requestIds[index];
        }
        return JSON.stringify(parsedResponse);
      }

      if (
        parsedResponse &&
        typeof parsedResponse === "object" &&
        requestIds.length > 0
      ) {
        (parsedResponse as Record<string, unknown>).id = requestIds[0];
        return JSON.stringify(parsedResponse);
      }

      return responseBody;
    }

    if (
      parsedResponse &&
      typeof parsedResponse === "object" &&
      requestBody &&
      typeof requestBody === "object"
    ) {
      (parsedResponse as Record<string, unknown>).id = (
        requestBody as Record<string, unknown>
      ).id;
      return JSON.stringify(parsedResponse);
    }

    return responseBody;
  } catch {
    return responseBody;
  }
}

function canCacheRpcPayload(payloads: JsonRpcRequestPayload[] | null): boolean {
  if (!payloads || payloads.length === 0) return false;
  return payloads.every((payload) => {
    const method = payload.method;
    return typeof method === "string" && RPC_CACHEABLE_METHODS.has(method);
  });
}

function getRpcCacheTtlMs(payloads: JsonRpcRequestPayload[]): number {
  let minTtl = Number.POSITIVE_INFINITY;
  for (const payload of payloads) {
    const method = payload.method;
    if (typeof method !== "string") continue;
    const ttl = RPC_CACHE_TTL_MS_BY_METHOD[method] ?? DEFAULT_RPC_CACHE_TTL_MS;
    if (ttl < minTtl) minTtl = ttl;
  }
  if (!Number.isFinite(minTtl)) return DEFAULT_RPC_CACHE_TTL_MS;
  return Math.max(100, minTtl);
}

function getCachedRpcResponse(cacheKey: string): CachedRpcResponse | null {
  const cached = rpcResponseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    rpcResponseCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function pruneRpcCache(): void {
  if (rpcResponseCache.size <= MAX_RPC_CACHE_ENTRIES) return;
  const overflow = rpcResponseCache.size - MAX_RPC_CACHE_ENTRIES;
  const keys = rpcResponseCache.keys();
  for (let i = 0; i < overflow; i += 1) {
    const key = keys.next().value;
    if (typeof key !== "string") break;
    rpcResponseCache.delete(key);
  }
}

async function proxySolanaRpcRequest(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Querystring: { cluster?: string } }>,
  reply: FastifyReply,
  defaultCluster: SolanaCluster,
): Promise<void> {
  const cluster = normalizeCluster(request.query?.cluster, defaultCluster);
  const upstreamUrl = resolveRpcUpstream(cluster);

  let requestBody = request.body;
  if (typeof requestBody === "string") {
    try {
      requestBody = JSON.parse(requestBody);
    } catch {
      requestBody = null;
    }
  }

  if (!requestBody || typeof requestBody !== "object") {
    reply.status(400).send({ error: "Invalid JSON-RPC payload" });
    return;
  }

  let requestBodyText = "";
  try {
    requestBodyText = JSON.stringify(requestBody);
  } catch {
    reply.status(400).send({ error: "Invalid JSON-RPC payload" });
    return;
  }

  const payloads = parseRpcPayload(requestBody);
  const shouldCache = canCacheRpcPayload(payloads);
  const cacheTtlMs = shouldCache ? getRpcCacheTtlMs(payloads || []) : 0;
  const cacheKey = shouldCache ? buildRpcCacheKey(cluster, requestBody) : null;

  if (cacheKey) {
    const cached = getCachedRpcResponse(cacheKey);
    if (cached) {
      const adjustedBody = rewriteRpcResponseIds(cached.body, requestBody);
      reply.header("Content-Type", cached.contentType);
      reply.header("x-rpc-cache", "hit");
      reply.status(cached.status).send(adjustedBody);
      return;
    }
  }

  if (cacheKey) {
    const inflight = rpcInflightRequests.get(cacheKey);
    if (inflight) {
      const shared = await inflight;
      const adjustedBody = rewriteRpcResponseIds(shared.body, requestBody);
      reply.header("Content-Type", shared.contentType);
      reply.header("x-rpc-cache", "coalesced");
      reply.status(shared.status).send(adjustedBody);
      return;
    }
  }

  const executeProxy = async (): Promise<ProxiedRpcResponse> => {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBodyText,
    });

    const body = await response.text();
    const contentType =
      response.headers.get("content-type") || "application/json";

    const result: ProxiedRpcResponse = {
      status: response.status,
      body,
      contentType,
    };

    if (cacheKey && response.ok && cacheTtlMs > 0) {
      rpcResponseCache.set(cacheKey, {
        ...result,
        expiresAt: Date.now() + cacheTtlMs,
      });
      pruneRpcCache();
    }

    return result;
  };

  const proxyPromise = executeProxy();
  if (cacheKey) {
    rpcInflightRequests.set(cacheKey, proxyPromise);
  }

  try {
    const proxied = await proxyPromise;
    reply.header("Content-Type", proxied.contentType);
    if (cacheKey) {
      reply.header("x-rpc-cache", "miss");
    }
    reply.status(proxied.status).send(proxied.body);
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(500).send({ error: "Failed to proxy Solana RPC request" });
  } finally {
    if (cacheKey) {
      rpcInflightRequests.delete(cacheKey);
    }
  }
}

function registerSolanaWsProxyRoute(
  fastify: FastifyInstance,
  routePath: string,
  defaultCluster: SolanaCluster,
): void {
  fastify.get<{ Querystring: { cluster?: string } }>(
    routePath,
    { websocket: true, config: { rateLimit: false } },
    (connection, req) => {
      const cluster = normalizeCluster(req.query?.cluster, defaultCluster);
      const upstreamWsUrl = resolveWsUpstream(cluster);

      import("ws")
        .then(({ default: WebSocket }) => {
          const upstreamSocket = new WebSocket(upstreamWsUrl);
          const wsClient = (connection as any).socket || connection;

          wsClient.on("message", (message: any) => {
            if (upstreamSocket.readyState === WebSocket.OPEN) {
              upstreamSocket.send(message.toString());
            } else {
              upstreamSocket.once("open", () =>
                upstreamSocket.send(message.toString()),
              );
            }
          });

          upstreamSocket.on("message", (data: any) => {
            if (
              wsClient.readyState === 1 ||
              wsClient.readyState === WebSocket.OPEN
            ) {
              wsClient.send(data);
            }
          });

          wsClient.on("close", () => {
            upstreamSocket.close();
          });

          upstreamSocket.on("close", () => {
            wsClient.close();
          });

          upstreamSocket.on("error", (err: any) => {
            fastify.log.error(`Solana WS proxy error: ${err}`);
            wsClient.close();
          });
        })
        .catch((err) => {
          fastify.log.error(`Failed to load ws dependency: ${err}`);
          const wsClient = (connection as any).socket || connection;
          wsClient.close();
        });
    },
  );
}

export function registerProxyRoutes(fastify: FastifyInstance): void {
  // Proxy for Birdeye API
  fastify.get(
    "/api/proxy/birdeye/price",
    async (
      request: FastifyRequest<{ Querystring: { address: string } }>,
      reply: FastifyReply,
    ) => {
      const apiKey = process.env.BIRDEYE_API_KEY;
      if (!apiKey) {
        return reply
          .status(500)
          .send({ error: "Missing BIRDEYE_API_KEY in server environment" });
      }

      const { address } = request.query;
      if (!address) {
        return reply.status(400).send({ error: "Missing address parameter" });
      }

      try {
        const response = await fetch(
          `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(address)}`,
          {
            headers: {
              "X-API-KEY": apiKey,
              "x-chain": "solana",
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Birdeye API error: ${response.statusText}`);
        }

        const data = await response.json();
        return reply.send(data);
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Failed to fetch from Birdeye" });
      }
    },
  );

  // Cluster-aware Solana RPC proxy.
  fastify.post<{ Querystring: { cluster?: string } }>(
    "/api/proxy/solana/rpc",
    { config: { rateLimit: false } },
    async (request, reply) =>
      proxySolanaRpcRequest(fastify, request, reply, "mainnet-beta"),
  );

  // Backwards-compatible alias used by existing frontends.
  fastify.post<{ Querystring: { cluster?: string } }>(
    "/api/proxy/helius/rpc",
    { config: { rateLimit: false } },
    async (request, reply) =>
      proxySolanaRpcRequest(fastify, request, reply, "mainnet-beta"),
  );

  // Cluster-aware Solana WS proxy and Helius-compatible alias.
  registerSolanaWsProxyRoute(fastify, "/api/proxy/solana/ws", "mainnet-beta");
  registerSolanaWsProxyRoute(fastify, "/api/proxy/helius/ws", "mainnet-beta");
}
