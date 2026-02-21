import fs from "node:fs";

const file = "/root/hyperscape/scripts/duel-stack.mjs";
let text = fs.readFileSync(file, "utf8");
const re = /  if \(!options\["skip-bots"\]\) \{[\s\S]*?  \}\n\n  if \(!skipBettingApp\) \{/;
if (!re.test(text)) {
  console.error("target block not found");
  process.exit(1);
}
const replacement = [
  '  const duelBotsUsePglite = !/^(0|false|no|off)$/i.test(',
  '    process.env.DUEL_BOTS_USE_PGLITE || "true",',
  '  );',
  '  const duelBotsEnv = duelBotsUsePglite',
  '    ? {',
  '      ...gameEnv,',
  '      DATABASE_URL: "",',
  '      POSTGRES_URL: "",',
  '    }',
  '    : gameEnv;',
  '',
  '  if (!options["skip-bots"]) {',
  '    log("starting duel matchmaker bots...");',
  '    if (duelBotsUsePglite) {',
  '      log("duel bots SQL storage: local PGLite (DUEL_BOTS_USE_PGLITE=true)");',
  '    }',
  '    spawnManaged(',
  '      "duel-bots",',
  '      "bun",',
  '      [',
  '        "run",',
  '        "dev:duel:skip-dev",',
  '        `--bots=${bots}`,',
  '        `--url=${serverWsUrl}`,',
  '        `--client-url=${clientUrl}`,',
  '      ],',
  '      {',
  '        env: duelBotsEnv,',
  '        critical: false,',
  '        restart: true,',
  '        restartDelayMs: 2500,',
  '      },',
  '    );',
  '  }',
  '',
  '  if (!skipBettingApp) {',
].join("\n");

text = text.replace(re, replacement);
fs.writeFileSync(file, text);
console.log("patched", file);
