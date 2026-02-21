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
                DUEL_BETTING_ENABLED: "true",
                AUTO_START_AGENTS: "true",
            },
        },
    ],
};
