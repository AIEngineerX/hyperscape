# Betting Production Deploy (Cloudflare + Railway)

This is the recommended production topology for the betting stack in this repo:

- Frontend (`/packages/gold-betting-demo/app`): Cloudflare Pages
- Backend (`/packages/server`): Railway (Dockerfile-based)
- DDoS/WAF/edge cache: Cloudflare proxy in front of Railway
- Contracts/state: Solana + EVM (configured by env vars below)

## 1) Deploy backend to Railway

From repo root, deploy the existing server service:

```bash
railway up
```

Use `Dockerfile.server` / `railway.server.json` (already in repo).

Set these Railway variables at minimum:

- `NODE_ENV=production`
- `PORT=5555`
- `DATABASE_URL=...` (managed Postgres recommended)
- `JWT_SECRET=...` (32+ random bytes)
- `ADMIN_CODE=...`
- `PUBLIC_API_URL=https://api.yourdomain.com`
- `PUBLIC_WS_URL=wss://api.yourdomain.com/ws`
- `CLIENT_URL=https://bet.yourdomain.com`
- `PUBLIC_APP_URL=https://bet.yourdomain.com`
- `DUEL_BETTING_ENABLED=true`
- `STREAMING_VIEWER_ACCESS_TOKEN=...` (long random value)
- `ARENA_EXTERNAL_BET_WRITE_KEY=...` (long random value, server-to-server only)

Contracts / chain wiring (set to your target networks):

- `SOLANA_RPC_URL`
- `SOLANA_WS_URL`
- `SOLANA_ARENA_MARKET_PROGRAM_ID`
- `SOLANA_GOLD_MINT`
- `SOLANA_ARENA_AUTHORITY_SECRET` (if on-chain writes/resolve are enabled)
- `BIRDEYE_API_KEY` (optional)
- `HELIUS_API_KEY` (recommended for mainnet Solana RPC)

Optional origin lock (recommended):

- `CLOUDFLARE_ORIGIN_SECRET=<random>`

If set, every non-health request must include header:

- `x-hyperscape-origin-secret: <same value>`

Use a Cloudflare Transform Rule to inject this header on traffic forwarded to Railway.

## 2) Put Railway behind Cloudflare

1. Create `api.yourdomain.com` in Cloudflare DNS and point it to Railway target.
2. Enable Cloudflare proxy (orange cloud) for `api.yourdomain.com`.
3. Add WAF rate-limit rules:
- `POST /api/arena/bet/record-external`
- `POST /api/arena/deposit/ingest`
- `/api/arena/payout/jobs*`
- `/api/proxy/solana/rpc`
4. Enable Bot Fight Mode / Super Bot Fight Mode.
5. Keep direct Railway URL private (do not publish it).

## 3) Deploy betting frontend to Cloudflare Pages

Project root:

- `packages/gold-betting-demo/app`

Build/output:

- Build command: `bun install && bun run build`
- Output directory: `dist`

Frontend env vars (Cloudflare Pages):

- `VITE_GAME_API_URL=https://api.yourdomain.com`
- `VITE_GAME_WS_URL=wss://api.yourdomain.com/ws`
- `VITE_SOLANA_CLUSTER=mainnet-beta` (or testnet/devnet)
- `VITE_SOLANA_RPC_URL` (optional override)
- `VITE_BSC_RPC_URL` / `VITE_BASE_RPC_URL`
- `VITE_BSC_GOLD_CLOB_ADDRESS` / `VITE_BASE_GOLD_CLOB_ADDRESS`
- `VITE_BSC_GOLD_TOKEN_ADDRESS` / `VITE_BASE_GOLD_TOKEN_ADDRESS`
- `VITE_STREAM_URL=https://api.yourdomain.com/live/stream.m3u8`

Optional stream embed mode (YouTube/Twitch iframe instead of HLS):

- `VITE_STREAM_EMBED_URL=https://...`

Cloudflare Pages headers/SPA rules are already added in:

- `packages/gold-betting-demo/app/public/_headers`
- `packages/gold-betting-demo/app/public/_redirects`

## 4) Verify production

Health:

- `https://api.yourdomain.com/status`
- `https://bet.yourdomain.com`
- `https://api.yourdomain.com/api/streaming/state`

End-to-end checks from repo root:

```bash
bun run duel:verify --server-url=https://api.yourdomain.com --betting-url=https://bet.yourdomain.com --hls-url=https://api.yourdomain.com/live/stream.m3u8
```

## 5) Security notes

- Do not expose `ARENA_EXTERNAL_BET_WRITE_KEY` in public frontend env vars.
- Rotate all secrets before production if they were ever committed/shared.
- Keep `TRUST_PROXY=true` (default behavior in production after this patch).
- Keep `DISABLE_RATE_LIMIT` unset in production.
