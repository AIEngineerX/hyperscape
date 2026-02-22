/**
 * PM2 Ecosystem Config – Hyperscape Duel Stack
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs          # start
 *   pm2 restart ecosystem.config.cjs        # restart all
 *   pm2 stop ecosystem.config.cjs           # stop all
 *   pm2 delete ecosystem.config.cjs         # remove from pm2
 *   pm2 logs hyperscape-duel                # tail logs
 *
 * The duel-stack.mjs orchestrator already manages sub-processes internally
 * (game server, client, bots, RTMP bridge, betting app, keeper bot).
 * If ANY critical sub-process dies, the orchestrator tears everything down
 * and exits with code 1. PM2 then restarts it from scratch, giving us an
 * infinite self-healing loop.
 */
module.exports = {
    apps: [
        {
            name: "hyperscape-duel",
            script: "scripts/duel-stack.mjs",
            interpreter: "bun",
            args: "--skip-betting --skip-bots",
            cwd: __dirname,
            // Restart policy
            autorestart: true,
            max_restarts: 999999,
            min_uptime: "10s",        // consider healthy after 10s
            restart_delay: 5000,      // 5s cooldown between restarts
            // Crash-loop protection: after 15 rapid restarts, wait 60s
            exp_backoff_restart_delay: 1000,
            // Resource limits – restart if memory exceeds 4GB
            max_memory_restart: "4G",
            // Logging
            error_file: "logs/duel-error.log",
            out_file: "logs/duel-out.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            // Environment
            env: {
                NODE_ENV: "production",
                STREAMING_DUEL_ENABLED: "true",
                DUEL_MARKET_MAKER_ENABLED: "true",
                DUEL_BETTING_ENABLED: "false",
                ARENA_SERVICE_ENABLED: "false",
                DUEL_SKIP_CHAIN_SETUP: "true",
                USE_LOCAL_POSTGRES: "false",
                SOLANA_RPC_URL: "https://api.devnet.solana.com",
                SOLANA_WS_URL: "wss://api.devnet.solana.com/",
                BOT_KEYPAIR:
                    process.env.BOT_KEYPAIR ||
                    "~/.config/solana/oracle-authority.json",
                ORACLE_AUTHORITY_KEYPAIR:
                    process.env.ORACLE_AUTHORITY_KEYPAIR ||
                    "~/.config/solana/oracle-authority.json",
                MARKET_MAKER_KEYPAIR:
                    process.env.MARKET_MAKER_KEYPAIR ||
                    "~/.config/solana/oracle-authority.json",
                DISABLE_RATE_LIMIT: "true",
                ALLOW_DESTRUCTIVE_CHANGES: "false",
                AUTO_START_AGENTS: "true",
                AUTO_START_AGENTS_MAX: "10",
                MALLOC_TRIM_THRESHOLD_: "-1",
                MIMALLOC_ALLOW_DECOMMIT: "0",
                MIMALLOC_ALLOW_RESET: "0",
                MIMALLOC_PAGE_RESET: "0",
                MIMALLOC_PURGE_DELAY: "1000000",
                STREAM_CAPTURE_MODE: "cdp",
                STREAM_CAPTURE_HEADLESS: "true",
                STREAM_CAPTURE_CHANNEL: "chrome-dev",
                STREAM_CAPTURE_ANGLE: "swiftshader",
                STREAM_CAPTURE_WIDTH: "1280",
                STREAM_CAPTURE_HEIGHT: "720",
                STREAM_CAPTURE_DISABLE_WEBGPU: "true",
                DUEL_DISABLE_BRIDGE_CAPTURE: "false",
                YOUTUBE_STREAM_URL:
                    process.env.YOUTUBE_STREAM_URL ||
                    "rtmp://a.rtmp.youtube.com/live2",
                DUEL_FORCE_WEBGL_FALLBACK: "false",
                GAME_URL: "http://localhost:3333/?page=stream",
                GAME_FALLBACK_URLS:
                    "http://localhost:3333/?page=stream,http://localhost:3333/?embedded=true&mode=spectator,http://localhost:3333/",
                DUEL_CAPTURE_USE_XVFB: "true",
                // Stabilize long-running streams by avoiding per-agent DuelCombatAI state polling churn.
                STREAMING_DUEL_COMBAT_AI_ENABLED: "false",
                SERVER_RUNTIME_MAX_TICKS_PER_FRAME: "1",
                SERVER_RUNTIME_MIN_DELAY_MS: "10",
                GAME_STATE_POLL_TIMEOUT_MS: "5000",
                GAME_STATE_POLL_INTERVAL_MS: "3000",
                DUEL_RUNTIME_HEALTH_INTERVAL_MS: "15000",
                DUEL_RUNTIME_HEALTH_MAX_FAILURES: "30",
            },
        },
    ],
};
