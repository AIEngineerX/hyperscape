import fs from "node:fs";
import path from "node:path";
import { SeededRandom, type SimulationConfig } from "./model";
import {
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  runScenario,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
} from "./scenarios";

const DAY = 24 * 60;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) {
    return sorted[base] ?? 0;
  }
  return (
    (sorted[base] ?? 0) + rest * ((sorted[base + 1] ?? 0) - (sorted[base] ?? 0))
  );
};

const avg = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((acc, value) => acc + value, 0) / values.length;

const parseIntFlag = (flag: string, fallback: number): number => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  const parsed = Number.parseInt(process.argv[index + 1] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

type FuzzRun = {
  run: number;
  seed: number;
  baseScenario: string;
  feeBps: number;
  globalOiCap: number;
  marketOrderLimitPerMinute: number;
  marketNotionalLimitPerMinute: number;
  marketNetImbalanceLimitPerMinute: number;
  traderOrderLimitPerMinute: number;
  traderNotionalLimitPerMinute: number;
  mevAttackIntensity: number;
  attackSizeMultiplier: number;
  attackSybilShare: number;
  oracleLagMinutes: number;
  mmPnl: number;
  mmDrawdown: number;
  mmBlewOut: boolean;
  mmFirstNegativeMinute: number | null;
  uncoveredBadDebt: number;
  blockedByRateLimit: number;
  blockedByImbalanceLimit: number;
  riskTransitions: number;
  riskStressMinutes: number;
};

const chooseBaseScenario = (
  rng: SeededRandom,
  seed: number,
): { name: string; config: SimulationConfig } => {
  const options = [
    {
      name: "mev-bot-attack-guarded",
      build: (s: number) => mevBotAttackGuardedScenario(s),
    },
    {
      name: "mev-bot-attack-hardened",
      build: (s: number) => mevBotAttackHardenedScenario(s),
    },
    {
      name: "mev-oracle-lag-attack",
      build: (s: number) => mevOracleLagAttackScenario(s),
    },
    {
      name: "mev-oracle-lag-hardened",
      build: (s: number) => mevOracleLagHardenedScenario(s),
    },
    {
      name: "sybil-swarm-attack",
      build: (s: number) => sybilSwarmAttackScenario(s),
    },
    {
      name: "sybil-swarm-hardened",
      build: (s: number) => sybilSwarmHardenedScenario(s),
    },
  ] as const;
  const selected = options[rng.int(0, options.length)];
  return { name: selected.name, config: selected.build(seed) };
};

const mutateAttackConfig = (
  config: SimulationConfig,
  rng: SeededRandom,
): {
  mevAttackIntensity: number;
  attackSizeMultiplier: number;
  attackSybilShare: number;
  oracleLagMinutes: number;
} => {
  config.totalMinutes = 8 * DAY;
  config.clearinghouse.feeBps = clamp(
    Math.round(config.clearinghouse.feeBps + rng.normal(0, 4)),
    8,
    36,
  );
  config.clearinghouse.globalOiCap = Math.round(
    config.clearinghouse.globalOiCap * clamp(rng.normal(1, 0.18), 0.58, 1.25),
  );
  config.clearinghouse.marketOrderLimitPerMinute = Math.round(
    config.clearinghouse.marketOrderLimitPerMinute *
      clamp(rng.normal(1, 0.25), 0.5, 1.35),
  );
  config.clearinghouse.marketNotionalLimitPerMinute = Math.round(
    config.clearinghouse.marketNotionalLimitPerMinute *
      clamp(rng.normal(1, 0.25), 0.5, 1.35),
  );
  config.clearinghouse.marketNetImbalanceLimitPerMinute = Math.round(
    config.clearinghouse.marketNetImbalanceLimitPerMinute *
      clamp(rng.normal(1, 0.28), 0.4, 1.35),
  );
  config.clearinghouse.traderOrderLimitPerMinute = Math.max(
    1,
    Math.round(
      config.clearinghouse.traderOrderLimitPerMinute *
        clamp(rng.normal(1, 0.35), 0.4, 1.45),
    ),
  );
  config.clearinghouse.traderNotionalLimitPerMinute = Math.max(
    20,
    Math.round(
      config.clearinghouse.traderNotionalLimitPerMinute *
        clamp(rng.normal(1, 0.35), 0.4, 1.45),
    ),
  );

  const regime = config.regimes?.[0];
  if (!regime) {
    return {
      mevAttackIntensity: 0,
      attackSizeMultiplier: 1,
      attackSybilShare: 1,
      oracleLagMinutes: 0,
    };
  }

  regime.mevAttackIntensity = clamp(
    (regime.mevAttackIntensity ?? 0.6) *
      clamp(rng.normal(1.1, 0.35), 0.55, 2.1),
    0.25,
    2.7,
  );
  regime.attackSizeMultiplier = clamp(
    (regime.attackSizeMultiplier ?? 1.8) * clamp(rng.normal(1, 0.3), 0.45, 2.2),
    0.8,
    4.4,
  );
  regime.attackSybilShare = clamp(
    (regime.attackSybilShare ?? 0.85) * clamp(rng.normal(1, 0.3), 0.35, 1.45),
    0.1,
    1,
  );
  regime.oracleLagMinutes = Math.max(
    0,
    Math.round((regime.oracleLagMinutes ?? 0) + rng.normal(1.4, 1.4)),
  );
  regime.orderFlowMultiplier = clamp(
    (regime.orderFlowMultiplier ?? 1.4) * clamp(rng.normal(1, 0.18), 0.7, 1.5),
    0.8,
    2.6,
  );
  regime.informedFlowShareOverride = clamp(
    (regime.informedFlowShareOverride ?? 0.75) + rng.normal(0, 0.06),
    0.55,
    0.93,
  );
  return {
    mevAttackIntensity: regime.mevAttackIntensity,
    attackSizeMultiplier: regime.attackSizeMultiplier,
    attackSybilShare: regime.attackSybilShare,
    oracleLagMinutes: regime.oracleLagMinutes,
  };
};

const runFuzz = (): void => {
  const runs = clamp(parseIntFlag("--runs", 80), 5, 500);
  const rootSeed = parseIntFlag("--seed", 31337);
  const rng = new SeededRandom(rootSeed);

  const results: FuzzRun[] = [];
  for (let run = 1; run <= runs; run++) {
    const seed = 10_000 + rootSeed + run * 17;
    const { name, config } = chooseBaseScenario(rng, seed);
    const attack = mutateAttackConfig(config, rng);
    const summary = runScenario(config);
    results.push({
      run,
      seed,
      baseScenario: name,
      feeBps: config.clearinghouse.feeBps,
      globalOiCap: config.clearinghouse.globalOiCap,
      marketOrderLimitPerMinute: config.clearinghouse.marketOrderLimitPerMinute,
      marketNotionalLimitPerMinute:
        config.clearinghouse.marketNotionalLimitPerMinute,
      marketNetImbalanceLimitPerMinute:
        config.clearinghouse.marketNetImbalanceLimitPerMinute,
      traderOrderLimitPerMinute: config.clearinghouse.traderOrderLimitPerMinute,
      traderNotionalLimitPerMinute:
        config.clearinghouse.traderNotionalLimitPerMinute,
      mevAttackIntensity: attack.mevAttackIntensity,
      attackSizeMultiplier: attack.attackSizeMultiplier,
      attackSybilShare: attack.attackSybilShare,
      oracleLagMinutes: attack.oracleLagMinutes,
      mmPnl: summary.clearinghouse.mmPnlTotal,
      mmDrawdown: summary.clearinghouse.mmPeakToTrough,
      mmBlewOut: summary.clearinghouse.mmBlewOut,
      mmFirstNegativeMinute: summary.clearinghouse.mmFirstNegativeMinute,
      uncoveredBadDebt: summary.clearinghouse.uncoveredBadDebt,
      blockedByRateLimit: summary.clearinghouse.blockedByRateLimit,
      blockedByImbalanceLimit: summary.clearinghouse.blockedByImbalanceLimit,
      riskTransitions: summary.riskGovernor.transitions,
      riskStressMinutes: summary.riskGovernor.minutesStress,
    });
  }

  const mmPnl = results.map((result) => result.mmPnl);
  const blowoutRate = avg(results.map((result) => (result.mmBlewOut ? 1 : 0)));
  const badDebtRate = avg(
    results.map((result) => (result.uncoveredBadDebt > 0 ? 1 : 0)),
  );
  const worst = [...results].sort((a, b) => a.mmPnl - b.mmPnl).slice(0, 12);
  const best = [...results].sort((a, b) => b.mmPnl - a.mmPnl).slice(0, 3);

  const summary = {
    runs,
    rootSeed,
    blowoutRate,
    badDebtRate,
    mmPnlP10: quantile(mmPnl, 0.1),
    mmPnlP50: quantile(mmPnl, 0.5),
    mmPnlP90: quantile(mmPnl, 0.9),
    worstMmPnl: quantile(mmPnl, 0),
    bestMmPnl: quantile(mmPnl, 1),
    avgBlockedByRateLimit: avg(
      results.map((result) => result.blockedByRateLimit),
    ),
    avgBlockedByImbalanceLimit: avg(
      results.map((result) => result.blockedByImbalanceLimit),
    ),
    avgRiskStressMinutes: avg(
      results.map((result) => result.riskStressMinutes),
    ),
  };

  console.log(
    "run_count | pnl_p10 | pnl_p50 | pnl_p90 | blowout_rate | bad_debt_rate | avg_blocked_imbalance",
  );
  console.log(
    `${summary.runs} | ${summary.mmPnlP10.toFixed(2)} | ${summary.mmPnlP50.toFixed(2)} | ${summary.mmPnlP90.toFixed(2)} | ${(summary.blowoutRate * 100).toFixed(1)}% | ${(summary.badDebtRate * 100).toFixed(1)}% | ${summary.avgBlockedByImbalanceLimit.toFixed(1)}`,
  );
  console.log("");
  console.log(
    "worst_runs (run | base | mm_pnl | blew_out | fee_bps | oi_cap | mkt_imbalance_cap | mev_intensity | attack_size | sybil_share | oracle_lag)",
  );
  for (const result of worst) {
    console.log(
      `${result.run} | ${result.baseScenario} | ${result.mmPnl.toFixed(2)} | ${result.mmBlewOut} | ${result.feeBps} | ${result.globalOiCap} | ${result.marketNetImbalanceLimitPerMinute} | ${result.mevAttackIntensity.toFixed(2)} | ${result.attackSizeMultiplier.toFixed(2)} | ${result.attackSybilShare.toFixed(2)} | ${result.oracleLagMinutes}`,
    );
  }
  console.log("");
  console.log("best_runs (run | base | mm_pnl)");
  for (const result of best) {
    console.log(
      `${result.run} | ${result.baseScenario} | ${result.mmPnl.toFixed(2)}`,
    );
  }

  const outDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  const reportPath = path.join(outDir, "attack-fuzz-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        worst,
        best,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nWrote ${reportPath}`);
};

runFuzz();
