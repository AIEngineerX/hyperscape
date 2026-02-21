import fs from "node:fs";
import path from "node:path";
import { SeededRandom, type SimulationConfig } from "./model";
import {
  baselineConvergenceScenario,
  disruptiveEntrantsScenario,
  feeDrivenMmScenario,
  hypeRunawaySuccessScenario,
  hypeSlowFalloffScenario,
  hypeThenCrashScenario,
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevBotAttackScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  runScenario,
  slowGrowthScenario,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
  thinLiquidityStressScenario,
} from "./scenarios";
import {
  applyChainExecutionProfile,
  type ExecutionChain,
} from "./chain-profiles";

const DAY = 24 * 60;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const parseIntFlag = (flag: string, fallback: number): number => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  const parsed = Number.parseInt(process.argv[index + 1] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base] ?? 0;
  return (
    (sorted[base] ?? 0) + rest * ((sorted[base + 1] ?? 0) - (sorted[base] ?? 0))
  );
};

const avg = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((acc, value) => acc + value, 0) / values.length;

type ScenarioBuilder = (seed: number) => {
  scenario: string;
  family: "organic" | "hype" | "attack";
  config: SimulationConfig;
};

const scenarioBuilders: readonly ScenarioBuilder[] = [
  (seed) => ({
    scenario: "baseline-convergence",
    family: "organic",
    config: baselineConvergenceScenario(seed),
  }),
  (seed) => ({
    scenario: "slow-growth",
    family: "organic",
    config: slowGrowthScenario(seed),
  }),
  (seed) => ({
    scenario: "disruptive-entrants",
    family: "organic",
    config: disruptiveEntrantsScenario(seed),
  }),
  (seed) => ({
    scenario: "hype-then-crash",
    family: "hype",
    config: hypeThenCrashScenario(seed),
  }),
  (seed) => ({
    scenario: "hype-slow-falloff",
    family: "hype",
    config: hypeSlowFalloffScenario(seed),
  }),
  (seed) => ({
    scenario: "hype-runaway-success",
    family: "hype",
    config: hypeRunawaySuccessScenario(seed),
  }),
  (seed) => ({
    scenario: "mev-bot-attack",
    family: "attack",
    config: mevBotAttackScenario(seed),
  }),
  (seed) => ({
    scenario: "mev-bot-attack-guarded",
    family: "attack",
    config: mevBotAttackGuardedScenario(seed),
  }),
  (seed) => ({
    scenario: "mev-bot-attack-hardened",
    family: "attack",
    config: mevBotAttackHardenedScenario(seed),
  }),
  (seed) => ({
    scenario: "fee-driven-mm-guarded-26bps",
    family: "attack",
    config: feeDrivenMmScenario(26, seed),
  }),
  (seed) => ({
    scenario: "mev-oracle-lag-attack",
    family: "attack",
    config: mevOracleLagAttackScenario(seed),
  }),
  (seed) => ({
    scenario: "mev-oracle-lag-hardened",
    family: "attack",
    config: mevOracleLagHardenedScenario(seed),
  }),
  (seed) => ({
    scenario: "sybil-swarm-attack",
    family: "attack",
    config: sybilSwarmAttackScenario(seed),
  }),
  (seed) => ({
    scenario: "sybil-swarm-hardened",
    family: "attack",
    config: sybilSwarmHardenedScenario(seed),
  }),
  (seed) => ({
    scenario: "thin-liquidity-16bps",
    family: "hype",
    config: thinLiquidityStressScenario(16, seed),
  }),
];

type RobustnessRun = {
  run: number;
  seed: number;
  chain: ExecutionChain;
  scenario: string;
  family: "organic" | "hype" | "attack";
  feeBps: number;
  globalOiCap: number;
  marketOrderLimitPerMinute: number;
  marketNotionalLimitPerMinute: number;
  marketNetImbalanceLimitPerMinute: number;
  traderOrderLimitPerMinute: number;
  traderNotionalLimitPerMinute: number;
  mmInventoryCarryPerMinute: number;
  mmHedgeRatePerMinute: number;
  oracleLagMinutes: number;
  mevAttackIntensity: number;
  attackSizeMultiplier: number;
  attackSybilShare: number;
  mmPnl: number;
  mmBlewOut: boolean;
  uncoveredBadDebt: number;
  mmDrawdown: number;
  riskTransitions: number;
  riskToxicMinutes: number;
  riskStressMinutes: number;
  blockedByImbalanceLimit: number;
};

const EXECUTION_CHAINS: ExecutionChain[] = ["bsc", "base", "solana"];

const chooseChain = (run: number): ExecutionChain =>
  EXECUTION_CHAINS[(run - 1) % EXECUTION_CHAINS.length]!;

const mutateWideRange = (config: SimulationConfig, rng: SeededRandom): void => {
  config.totalMinutes = clamp(
    Math.round(config.totalMinutes * clamp(rng.normal(0.4, 0.08), 0.22, 0.7)),
    4 * DAY,
    16 * DAY,
  );
  config.clearinghouse.feeBps = clamp(
    Math.round(config.clearinghouse.feeBps + rng.normal(0, 5)),
    8,
    40,
  );
  config.clearinghouse.globalOiCap = Math.round(
    config.clearinghouse.globalOiCap * clamp(rng.normal(1, 0.22), 0.55, 1.35),
  );
  config.clearinghouse.maxOrderQuantity = Math.max(
    20,
    Math.round(
      config.clearinghouse.maxOrderQuantity *
        clamp(rng.normal(1, 0.24), 0.5, 1.4),
    ),
  );
  config.clearinghouse.marketOrderLimitPerMinute = Math.max(
    8,
    Math.round(
      config.clearinghouse.marketOrderLimitPerMinute *
        clamp(rng.normal(1, 0.24), 0.45, 1.45),
    ),
  );
  config.clearinghouse.marketNotionalLimitPerMinute = Math.max(
    80,
    Math.round(
      config.clearinghouse.marketNotionalLimitPerMinute *
        clamp(rng.normal(1, 0.24), 0.45, 1.45),
    ),
  );
  config.clearinghouse.marketNetImbalanceLimitPerMinute = Math.max(
    24,
    Math.round(
      config.clearinghouse.marketNetImbalanceLimitPerMinute *
        clamp(rng.normal(1, 0.28), 0.35, 1.45),
    ),
  );
  config.clearinghouse.traderOrderLimitPerMinute = Math.max(
    1,
    Math.round(
      config.clearinghouse.traderOrderLimitPerMinute *
        clamp(rng.normal(1, 0.35), 0.4, 1.5),
    ),
  );
  config.clearinghouse.traderNotionalLimitPerMinute = Math.max(
    18,
    Math.round(
      config.clearinghouse.traderNotionalLimitPerMinute *
        clamp(rng.normal(1, 0.35), 0.4, 1.5),
    ),
  );
  config.clearinghouse.mmInventoryCarryPerMinute = clamp(
    config.clearinghouse.mmInventoryCarryPerMinute *
      clamp(rng.normal(1, 0.45), 0.35, 1.8),
    0.00002,
    0.002,
  );
  config.clearinghouse.mmHedgeRatePerMinute = clamp(
    config.clearinghouse.mmHedgeRatePerMinute *
      clamp(rng.normal(1, 0.35), 0.45, 2.2),
    0.01,
    0.3,
  );

  const rg = config.clearinghouse.riskGovernor;
  if (rg.enabled) {
    rg.thresholds.toxicityEnter = clamp(
      rg.thresholds.toxicityEnter + rng.normal(0, 0.04),
      0.14,
      0.8,
    );
    rg.thresholds.toxicityExit = clamp(
      rg.thresholds.toxicityExit + rng.normal(0, 0.04),
      0.08,
      rg.thresholds.toxicityEnter,
    );
    rg.thresholds.informedFlowEnter = clamp(
      rg.thresholds.informedFlowEnter + rng.normal(0, 0.05),
      0.5,
      0.95,
    );
    rg.thresholds.informedFlowExit = clamp(
      rg.thresholds.informedFlowExit + rng.normal(0, 0.05),
      0.35,
      rg.thresholds.informedFlowEnter,
    );
    rg.thresholds.stressDrawdownEnter = clamp(
      rg.thresholds.stressDrawdownEnter + rng.normal(0, 0.02),
      0.02,
      0.35,
    );
    rg.thresholds.stressDrawdownExit = clamp(
      rg.thresholds.stressDrawdownExit + rng.normal(0, 0.02),
      0.01,
      rg.thresholds.stressDrawdownEnter,
    );
    rg.thresholds.stressCoverageEnter = clamp(
      rg.thresholds.stressCoverageEnter + rng.normal(0, 0.03),
      0.45,
      0.98,
    );
    rg.thresholds.stressCoverageExit = clamp(
      rg.thresholds.stressCoverageExit + rng.normal(0, 0.03),
      rg.thresholds.stressCoverageEnter,
      1.1,
    );
  }

  for (const regime of config.regimes ?? []) {
    regime.orderFlowMultiplier = clamp(
      (regime.orderFlowMultiplier ?? 1) * clamp(rng.normal(1, 0.2), 0.6, 1.7),
      0.6,
      2.8,
    );
    regime.informedFlowShareOverride =
      regime.informedFlowShareOverride === undefined
        ? undefined
        : clamp(
            regime.informedFlowShareOverride + rng.normal(0, 0.05),
            0.45,
            0.95,
          );
    regime.oracleLagMinutes = Math.max(
      0,
      Math.round((regime.oracleLagMinutes ?? 0) + rng.normal(1, 1.3)),
    );
    if (regime.mevAttackIntensity !== undefined) {
      regime.mevAttackIntensity = clamp(
        regime.mevAttackIntensity * clamp(rng.normal(1, 0.25), 0.5, 2.1),
        0.2,
        2.8,
      );
    }
    if (regime.attackSizeMultiplier !== undefined) {
      regime.attackSizeMultiplier = clamp(
        regime.attackSizeMultiplier * clamp(rng.normal(1, 0.3), 0.5, 2),
        0.7,
        4.6,
      );
    }
    if (regime.attackSybilShare !== undefined) {
      regime.attackSybilShare = clamp(
        regime.attackSybilShare * clamp(rng.normal(1, 0.22), 0.5, 1.4),
        0.15,
        1,
      );
    }
  }
};

type Aggregate = {
  bucket: string;
  runs: number;
  blowoutRate: number;
  badDebtRate: number;
  negativePnlRate: number;
  mmPnlP10: number;
  mmPnlP50: number;
  mmPnlP90: number;
  worstMmPnl: number;
  avgDrawdown: number;
  avgRiskStressMinutes: number;
  avgBlockedImbalance: number;
};

const aggregateRuns = (bucket: string, runs: RobustnessRun[]): Aggregate => {
  const mmPnl = runs.map((run) => run.mmPnl);
  return {
    bucket,
    runs: runs.length,
    blowoutRate: avg(runs.map((run) => (run.mmBlewOut ? 1 : 0))),
    badDebtRate: avg(runs.map((run) => (run.uncoveredBadDebt > 0 ? 1 : 0))),
    negativePnlRate: avg(runs.map((run) => (run.mmPnl < 0 ? 1 : 0))),
    mmPnlP10: quantile(mmPnl, 0.1),
    mmPnlP50: quantile(mmPnl, 0.5),
    mmPnlP90: quantile(mmPnl, 0.9),
    worstMmPnl: quantile(mmPnl, 0),
    avgDrawdown: avg(runs.map((run) => run.mmDrawdown)),
    avgRiskStressMinutes: avg(runs.map((run) => run.riskStressMinutes)),
    avgBlockedImbalance: avg(runs.map((run) => run.blockedByImbalanceLimit)),
  };
};

const runRobustness = (): void => {
  const runs = clamp(parseIntFlag("--runs", 240), 30, 1200);
  const rootSeed = parseIntFlag("--seed", 2602);
  const rng = new SeededRandom(rootSeed);

  const results: RobustnessRun[] = [];
  for (let run = 1; run <= runs; run++) {
    const seed = 50_000 + rootSeed + run * 37;
    const chain = chooseChain(run);
    const scenarioBuilder =
      scenarioBuilders[rng.int(0, scenarioBuilders.length)];
    const { scenario: scenarioName, family, config } = scenarioBuilder(seed);

    mutateWideRange(config, rng);
    applyChainExecutionProfile(config, chain);

    const summary = runScenario(config);
    const firstRegime = config.regimes?.[0];
    results.push({
      run,
      seed,
      chain,
      scenario: scenarioName,
      family,
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
      mmInventoryCarryPerMinute: config.clearinghouse.mmInventoryCarryPerMinute,
      mmHedgeRatePerMinute: config.clearinghouse.mmHedgeRatePerMinute,
      oracleLagMinutes: firstRegime?.oracleLagMinutes ?? 0,
      mevAttackIntensity: firstRegime?.mevAttackIntensity ?? 0,
      attackSizeMultiplier: firstRegime?.attackSizeMultiplier ?? 1,
      attackSybilShare: firstRegime?.attackSybilShare ?? 1,
      mmPnl: summary.clearinghouse.mmPnlTotal,
      mmBlewOut: summary.clearinghouse.mmBlewOut,
      uncoveredBadDebt: summary.clearinghouse.uncoveredBadDebt,
      mmDrawdown: summary.clearinghouse.mmPeakToTrough,
      riskTransitions: summary.riskGovernor.transitions,
      riskToxicMinutes: summary.riskGovernor.minutesToxic,
      riskStressMinutes: summary.riskGovernor.minutesStress,
      blockedByImbalanceLimit: summary.clearinghouse.blockedByImbalanceLimit,
    });
  }

  const chainAggregates: Aggregate[] = [aggregateRuns("all", results)];
  for (const chain of EXECUTION_CHAINS) {
    chainAggregates.push(
      aggregateRuns(
        chain,
        results.filter((result) => result.chain === chain),
      ),
    );
  }
  const familyAggregates: Aggregate[] = [
    aggregateRuns(
      "organic",
      results.filter((result) => result.family === "organic"),
    ),
    aggregateRuns(
      "hype",
      results.filter((result) => result.family === "hype"),
    ),
    aggregateRuns(
      "attack",
      results.filter((result) => result.family === "attack"),
    ),
  ];

  const failures = [...results]
    .filter((result) => result.mmBlewOut || result.uncoveredBadDebt > 0)
    .sort((a, b) => a.mmPnl - b.mmPnl)
    .slice(0, 20);
  const worst = [...results].sort((a, b) => a.mmPnl - b.mmPnl).slice(0, 20);

  console.log(
    "bucket | runs | pnl_p10 | pnl_p50 | pnl_p90 | worst_pnl | blowout_rate | bad_debt_rate | neg_pnl_rate | avg_drawdown",
  );
  for (const agg of chainAggregates) {
    console.log(
      `${agg.bucket} | ${agg.runs} | ${agg.mmPnlP10.toFixed(2)} | ${agg.mmPnlP50.toFixed(2)} | ${agg.mmPnlP90.toFixed(2)} | ${agg.worstMmPnl.toFixed(2)} | ${(agg.blowoutRate * 100).toFixed(2)}% | ${(agg.badDebtRate * 100).toFixed(2)}% | ${(agg.negativePnlRate * 100).toFixed(2)}% | ${agg.avgDrawdown.toFixed(2)}`,
    );
  }
  console.log("");
  console.log(
    "family | runs | pnl_p10 | pnl_p50 | pnl_p90 | worst_pnl | blowout_rate | bad_debt_rate | neg_pnl_rate | avg_drawdown",
  );
  for (const agg of familyAggregates) {
    console.log(
      `${agg.bucket} | ${agg.runs} | ${agg.mmPnlP10.toFixed(2)} | ${agg.mmPnlP50.toFixed(2)} | ${agg.mmPnlP90.toFixed(2)} | ${agg.worstMmPnl.toFixed(2)} | ${(agg.blowoutRate * 100).toFixed(2)}% | ${(agg.badDebtRate * 100).toFixed(2)}% | ${(agg.negativePnlRate * 100).toFixed(2)}% | ${agg.avgDrawdown.toFixed(2)}`,
    );
  }
  console.log("");
  console.log(
    "worst_runs (run | chain | family | scenario | pnl | blew_out | bad_debt | fee_bps | oi_cap | oracle_lag | mev_intensity | attack_size)",
  );
  for (const run of worst) {
    console.log(
      `${run.run} | ${run.chain} | ${run.family} | ${run.scenario} | ${run.mmPnl.toFixed(2)} | ${run.mmBlewOut} | ${run.uncoveredBadDebt.toFixed(4)} | ${run.feeBps} | ${run.globalOiCap} | ${run.oracleLagMinutes} | ${run.mevAttackIntensity.toFixed(2)} | ${run.attackSizeMultiplier.toFixed(2)}`,
    );
  }

  const outDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  const reportPath = path.join(outDir, "robustness-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runs,
        rootSeed,
        chainAggregates,
        familyAggregates,
        failureCount: failures.length,
        failures,
        worst,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nWrote ${reportPath}`);
};

runRobustness();
