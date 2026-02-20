import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

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

  // Proxy for Helius RPC (HTTP POST)
  fastify.post(
    "/api/proxy/helius/rpc",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = process.env.HELIUS_API_KEY;
      const url = apiKey
        ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
        : `https://api.mainnet-beta.solana.com`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
        });

        if (!response.ok) {
          return reply.status(response.status).send(await response.text());
        }

        const data = await response.json();
        return reply.send(data);
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Failed to proxy Helius RPC request" });
      }
    },
  );

  // Proxy for Helius WebSockets
  fastify.get(
    "/api/proxy/helius/ws",
    { websocket: true },
    (connection, req) => {
      const apiKey = process.env.HELIUS_API_KEY;
      const heliusWsUrl = apiKey
        ? `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`
        : `wss://api.mainnet-beta.solana.com`;

      import("ws")
        .then(({ default: WebSocket }) => {
          const heliusWs = new WebSocket(heliusWsUrl);
          const wsClient = (connection as any).socket || connection;

          wsClient.on("message", (message: any) => {
            if (heliusWs.readyState === WebSocket.OPEN) {
              heliusWs.send(message.toString());
            } else {
              heliusWs.once("open", () => heliusWs.send(message.toString()));
            }
          });

          heliusWs.on("message", (data: any) => {
            if (
              wsClient.readyState === 1 ||
              wsClient.readyState === WebSocket.OPEN
            ) {
              // 1 = OPEN
              wsClient.send(data);
            }
          });

          wsClient.on("close", () => {
            heliusWs.close();
          });

          heliusWs.on("close", () => {
            wsClient.close();
          });

          heliusWs.on("error", (err: any) => {
            fastify.log.error(`Helius WS error: ${err}`);
            wsClient.close();
          });
        })
        .catch((err) => {
          fastify.log.error(`Failed to dynamic import ws: ${err}`);
          const wsClient = (connection as any).socket || connection;
          wsClient.close();
        });
    },
  );
}
