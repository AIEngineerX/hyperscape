import fs from "node:fs";
import path from "node:path";
import {
  baselineConvergenceScenario,
  disruptiveEntrantsScenario,
  feeDrivenMmUnmitigatedScenario,
  feeDrivenMmScenario,
  hypeRunawaySuccessScenario,
  hypeSlowFalloffScenario,
  hypeThenCrashScenario,
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  mevBotAttackScenario,
  runScenario,
  slowGrowthScenario,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
  thinLiquidityStressScenario,
} from "./scenarios";
import type { SimulationSummary } from "./model";

type ScenarioBuilder = (seed: number) => {
  name: string;
  summary: SimulationSummary;
};

type ScenarioAggregate = {
  scenario: string;
  runs: number;
  mmPnlP10: number;
  mmPnlP50: number;
  mmPnlP90: number;
  mmPnlExFeesP50: number;
  mmDrawdownP50: number;
  mmBlowoutRate: number;
  uncoveredBadDebtRate: number;
  avgLiquidations: number;
  avgBankruptcies: number;
  worstUncoveredBadDebt: number;
  avgVolume: number;
  avgBlockedOi: number;
  avgBlockedLeverage: number;
  avgBlockedRateLimit: number;
  avgBlockedImbalance: number;
  avgBlockedInitialMargin: number;
  avgTraderRespawns: number;
  medianFirstNegativeMinute: number | null;
  avgRiskTransitions: number;
  avgRiskToxicMinutes: number;
  avgRiskStressMinutes: number;
  topHotspots: Array<{ marketId: string; score: number }>;
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
};

const avg = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return quantile(values, 0.5);
};

const buildScenarioSet = (): ScenarioBuilder[] => [
  (seed) => ({
    name: "baseline",
    summary: runScenario(baselineConvergenceScenario(seed)),
  }),
  (seed) => ({
    name: "slow-growth",
    summary: runScenario(slowGrowthScenario(seed)),
  }),
  (seed) => ({
    name: "disruptive-entrants",
    summary: runScenario(disruptiveEntrantsScenario(seed)),
  }),
  (seed) => ({
    name: "thin-liquidity",
    summary: runScenario(thinLiquidityStressScenario(12, seed)),
  }),
  (seed) => ({
    name: "hype-then-crash",
    summary: runScenario(hypeThenCrashScenario(seed)),
  }),
  (seed) => ({
    name: "hype-slow-falloff",
    summary: runScenario(hypeSlowFalloffScenario(seed)),
  }),
  (seed) => ({
    name: "hype-runaway-success",
    summary: runScenario(hypeRunawaySuccessScenario(seed)),
  }),
  (seed) => ({
    name: "mev-bot-attack",
    summary: runScenario(mevBotAttackScenario(seed)),
  }),
  (seed) => ({
    name: "mev-bot-attack-guarded",
    summary: runScenario(mevBotAttackGuardedScenario(seed)),
  }),
  (seed) => ({
    name: "mev-bot-attack-hardened",
    summary: runScenario(mevBotAttackHardenedScenario(seed)),
  }),
  (seed) => ({
    name: "mev-oracle-lag-attack",
    summary: runScenario(mevOracleLagAttackScenario(seed)),
  }),
  (seed) => ({
    name: "sybil-swarm-attack",
    summary: runScenario(sybilSwarmAttackScenario(seed)),
  }),
  (seed) => ({
    name: "mev-oracle-lag-hardened",
    summary: runScenario(mevOracleLagHardenedScenario(seed)),
  }),
  (seed) => ({
    name: "sybil-swarm-hardened",
    summary: runScenario(sybilSwarmHardenedScenario(seed)),
  }),
  (seed) => ({
    name: "fee-driven-mm-guarded-26bps",
    summary: runScenario(feeDrivenMmScenario(26, seed)),
  }),
  (seed) => ({
    name: "fee-driven-mm-unmitigated-26bps",
    summary: runScenario(feeDrivenMmUnmitigatedScenario(26, seed)),
  }),
];

const aggregateScenario = (
  scenario: string,
  runs: SimulationSummary[],
): ScenarioAggregate => {
  const ch = runs.map((run) => run.clearinghouse);
  const mmPnl = ch.map((summary) => summary.mmPnlTotal);
  const mmPnlExFees = ch.map((summary) => summary.mmPnlExFeesAndFunding);
  const drawdown = ch.map((summary) => summary.mmPeakToTrough);
  const firstNegative = ch
    .map((summary) => summary.mmFirstNegativeMinute)
    .filter((minute): minute is number => minute !== null);

  const hotspotScores = new Map<string, number>();
  for (const summary of ch) {
    for (const hotspot of summary.liquidationHotspots) {
      const score = hotspot.liquidations + hotspot.bankruptcies * 2;
      hotspotScores.set(
        hotspot.marketId,
        (hotspotScores.get(hotspot.marketId) ?? 0) + score,
      );
    }
  }
  const topHotspots = Array.from(hotspotScores.entries())
    .map(([marketId, score]) => ({ marketId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    scenario,
    runs: runs.length,
    mmPnlP10: quantile(mmPnl, 0.1),
    mmPnlP50: quantile(mmPnl, 0.5),
    mmPnlP90: quantile(mmPnl, 0.9),
    mmPnlExFeesP50: quantile(mmPnlExFees, 0.5),
    mmDrawdownP50: quantile(drawdown, 0.5),
    mmBlowoutRate: avg(ch.map((summary) => (summary.mmBlewOut ? 1 : 0))),
    uncoveredBadDebtRate: avg(
      ch.map((summary) => (summary.uncoveredBadDebt > 0 ? 1 : 0)),
    ),
    avgLiquidations: avg(ch.map((summary) => summary.liquidationCount)),
    avgBankruptcies: avg(ch.map((summary) => summary.bankruptcies)),
    worstUncoveredBadDebt: Math.max(
      ...ch.map((summary) => summary.uncoveredBadDebt),
    ),
    avgVolume: avg(ch.map((summary) => summary.totalVolume)),
    avgBlockedOi: avg(ch.map((summary) => summary.blockedByOiCap)),
    avgBlockedLeverage: avg(ch.map((summary) => summary.blockedByLeverage)),
    avgBlockedRateLimit: avg(ch.map((summary) => summary.blockedByRateLimit)),
    avgBlockedImbalance: avg(
      ch.map((summary) => summary.blockedByImbalanceLimit),
    ),
    avgBlockedInitialMargin: avg(
      ch.map((summary) => summary.blockedByInitialMargin),
    ),
    avgTraderRespawns: avg(ch.map((summary) => summary.traderRespawns)),
    medianFirstNegativeMinute: median(firstNegative),
    avgRiskTransitions: avg(runs.map((run) => run.riskGovernor.transitions)),
    avgRiskToxicMinutes: avg(runs.map((run) => run.riskGovernor.minutesToxic)),
    avgRiskStressMinutes: avg(
      runs.map((run) => run.riskGovernor.minutesStress),
    ),
    topHotspots,
  };
};

const toMarkdown = (rows: ScenarioAggregate[]): string => {
  const header =
    "| scenario | runs | mm_pnl_p50 | mm_pnl_p10 | mm_pnl_p90 | mm_ex_fees_p50 | blowout_rate | bad_debt_rate | drawdown_p50 | liq_avg | bk_avg | respawns_avg | first_neg_median | blocked_rate_avg | blocked_imbalance_avg | blocked_im_avg | risk_transitions_avg | risk_toxic_mins_avg | risk_stress_mins_avg |\n" +
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
  const lines = rows.map((row) => {
    const firstNeg =
      row.medianFirstNegativeMinute === null
        ? "n/a"
        : row.medianFirstNegativeMinute.toFixed(0);
    return `| ${row.scenario} | ${row.runs} | ${row.mmPnlP50.toFixed(2)} | ${row.mmPnlP10.toFixed(2)} | ${row.mmPnlP90.toFixed(2)} | ${row.mmPnlExFeesP50.toFixed(2)} | ${(row.mmBlowoutRate * 100).toFixed(1)}% | ${(row.uncoveredBadDebtRate * 100).toFixed(1)}% | ${row.mmDrawdownP50.toFixed(2)} | ${row.avgLiquidations.toFixed(1)} | ${row.avgBankruptcies.toFixed(1)} | ${row.avgTraderRespawns.toFixed(1)} | ${firstNeg} | ${row.avgBlockedRateLimit.toFixed(1)} | ${row.avgBlockedImbalance.toFixed(1)} | ${row.avgBlockedInitialMargin.toFixed(1)} | ${row.avgRiskTransitions.toFixed(1)} | ${row.avgRiskToxicMinutes.toFixed(1)} | ${row.avgRiskStressMinutes.toFixed(1)} |`;
  });
  return `${header}${lines.join("\n")}\n`;
};

const runBenchmarks = (): void => {
  const seeds = Array.from({ length: 12 }, (_, index) => 100 + index * 17);
  const scenarioBuilders = buildScenarioSet();
  const grouped = new Map<string, SimulationSummary[]>();

  for (const seed of seeds) {
    for (const buildScenario of scenarioBuilders) {
      const { name, summary } = buildScenario(seed);
      const bucket = grouped.get(name) ?? [];
      bucket.push(summary);
      grouped.set(name, bucket);
    }
  }

  const aggregates = Array.from(grouped.entries())
    .map(([scenario, runs]) => aggregateScenario(scenario, runs))
    .sort((a, b) => a.scenario.localeCompare(b.scenario));

  console.log(
    "scenario | mm_pnl_p50 | blowout_rate | bad_debt_rate | first_negative_minute | risk_stress_mins_avg",
  );
  for (const row of aggregates) {
    const firstNeg =
      row.medianFirstNegativeMinute === null
        ? "n/a"
        : row.medianFirstNegativeMinute.toFixed(0);
    console.log(
      `${row.scenario} | ${row.mmPnlP50.toFixed(2)} | ${(row.mmBlowoutRate * 100).toFixed(1)}% | ${(row.uncoveredBadDebtRate * 100).toFixed(1)}% | ${firstNeg} | ${row.avgRiskStressMinutes.toFixed(1)}`,
    );
  }

  const outDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  fs.writeFileSync(
    path.join(outDir, "benchmark-report.json"),
    JSON.stringify({ seeds, aggregates }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "benchmark-report.md"),
    toMarkdown(aggregates),
    "utf8",
  );
};

runBenchmarks();
