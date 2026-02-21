# Duel Stack (`bun run duel`)

`bun run duel` now boots the end-to-end agent duel arena stack:

1. Game server + client (streaming duel scheduler enabled)
2. Duel matchmaker bots (`dev:duel:skip-dev`)
3. RTMP bridge fanout + local HLS output for betting UI
4. Betting app (testnet mode)
5. Keeper bot (testnet automation)

## Run

```bash
bun run duel
```

Optional flags:

```bash
bun run duel --bots=6 --betting-port=4179 --rtmp-port=8765
bun run duel --skip-keeper
bun run duel --skip-stream
bun run duel --verify
```

## Streaming Outputs

Configure the following env vars (root `.env` or `packages/server/.env`):

- `RTMP_MULTIPLEXER_URL` (+ optional `RTMP_MULTIPLEXER_STREAM_KEY`, `RTMP_MULTIPLEXER_NAME`)
- `TWITCH_STREAM_KEY` (or `TWITCH_RTMP_STREAM_KEY`)
- `YOUTUBE_STREAM_KEY` (or `YOUTUBE_RTMP_STREAM_KEY`)
- `KICK_STREAM_KEY` (+ optional `KICK_RTMP_URL`)
- `PUMPFUN_RTMP_URL` (+ optional `PUMPFUN_STREAM_KEY`)
- `X_RTMP_URL` (+ optional `X_STREAM_KEY`)
- `RTMP_DESTINATIONS_JSON` for additional/custom fanout destinations
- `STREAMING_PUBLIC_DELAY_MS` to delay public duel state APIs (anti-cheat; e.g. `10000`)
- `STREAMING_VIEWER_ACCESS_TOKEN` optional gate for live WebSocket stream/spectator viewers (recommended when `STREAMING_PUBLIC_DELAY_MS > 0`)

Local HLS output for the betting app:

- `HLS_OUTPUT_PATH`
- `HLS_SEGMENT_PATTERN`
- `HLS_TIME_SECONDS`
- `HLS_LIST_SIZE`

Optional client-side extra delay (usually keep `0` if server delay is enabled):

- `VITE_UI_SYNC_DELAY_MS`

Website embed input (if using Twitch/YouTube iframe instead of local HLS):

- `NEXT_PUBLIC_ARENA_STREAM_EMBED_URL` (in `packages/website/.env.local`)

When `STREAMING_PUBLIC_DELAY_MS > 0`, live `mode=streaming` WebSocket viewers are restricted to:
- loopback/local capture clients, or
- clients presenting `streamToken=<STREAMING_VIEWER_ACCESS_TOKEN>`

`stream-to-rtmp` automatically appends `streamToken` to capture URLs when `STREAMING_VIEWER_ACCESS_TOKEN` is set.

## Spectator + Betting URLs

- Game stream view: `http://localhost:3333/?page=stream`
- Embedded spectator: `http://localhost:3333/?embedded=true&mode=spectator`
- Betting app: `http://localhost:4179`
- Betting video source (default): `http://localhost:4179/live/stream.m3u8`

## Open APIs (duel telemetry + monologues)

- `GET /api/streaming/state`
- `GET /api/streaming/duel-context`
- `GET /api/streaming/agent/:characterId/inventory`
- `GET /api/streaming/agent/:characterId/monologues?limit=20`

These endpoints power the betting app live duel telemetry section (inventory, wins/losses, level, HP, and internal monologues).

## Verification

Run the full startup verifier against a running stack:

```bash
bun run duel:verify
```

This validates server/client/betting uptime, active duel combat, HP loss, live HLS playlist advancement + segments, and telemetry endpoints (with RTMP bridge status checked on a best-effort basis).
