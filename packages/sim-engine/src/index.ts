import {
  baselineConvergenceScenario,
  disruptiveEntrantsScenario,
  feeDrivenMmUnmitigatedScenario,
  feeDrivenMmScenario,
  hypeRunawaySuccessScenario,
  hypeSlowFalloffScenario,
  hypeThenCrashScenario,
  minimumSolventFeeBps,
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  mevBotAttackScenario,
  runFeeDrivenMmUnmitigatedSweep,
  runFeeDrivenMmSweep,
  runGuardedMevFeeSweep,
  runScenario,
  slowGrowthScenario,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
  runThinLiquidityFeeSweep,
  thinLiquidityStressScenario,
  type FeeSweepResult,
} from "./scenarios";
import type { SimulationSummary } from "./model";

const pct = (value: number, digits = 2): string =>
  `${(value * 100).toFixed(digits)}%`;
const num = (value: number, digits = 2): string => value.toFixed(digits);

const printTopAgents = (summary: SimulationSummary): void => {
  console.log("Top agents (share | mu±sigma | W-L)");
  for (const agent of summary.topAgents.slice(0, 8)) {
    console.log(
      `  ${agent.id.padEnd(8)} ${pct(agent.share, 2).padStart(7)} | ${num(agent.mu, 2)}±${num(agent.sigma, 2)} | ${agent.wins}-${agent.losses}`,
    );
  }
};

const printEntrants = (summary: SimulationSummary): void => {
  if (summary.entrants.length === 0) {
    console.log("Entrants: none");
    return;
  }
  console.log("Entrants (Day1 WR -> Day7 WR -> Final rank/share)");
  for (const entrant of summary.entrants) {
    const day1 =
      entrant.day1WinRate === null ? "n/a" : pct(entrant.day1WinRate, 1);
    const day7 =
      entrant.day7WinRate === null ? "n/a" : pct(entrant.day7WinRate, 1);
    console.log(
      `  ${entrant.id.padEnd(8)} ${day1.padStart(6)} -> ${day7.padStart(6)} -> #${String(entrant.finalRank).padEnd(2)} ${pct(entrant.finalShare, 2)}`,
    );
  }
};

const printSummary = (summary: SimulationSummary): void => {
  console.log(`\n=== ${summary.scenario} (seed ${summary.seed}) ===`);
  console.log(
    `Duels=${summary.totalDuels} Agents=${summary.activeAgents} AvgTopShare=${pct(summary.averageTopShare, 2)} MaxLogitStep=${num(summary.maxObservedLogitStep, 4)}`,
  );
  console.log(
    `MM equity end=${num(summary.clearinghouse.mmEquityEnd)} min=${num(summary.clearinghouse.mmEquityMin)} | MM PnL total=${num(summary.clearinghouse.mmPnlTotal)} exFees=${num(summary.clearinghouse.mmPnlExFeesAndFunding)} | Insurance end=${num(summary.clearinghouse.insuranceEnd)} | Uncovered bad debt=${num(summary.clearinghouse.uncoveredBadDebt, 4)}`,
  );
  console.log(
    `Liquidations=${summary.clearinghouse.liquidationCount} Bankruptcies=${summary.clearinghouse.bankruptcies} Respawns=${summary.clearinghouse.traderRespawns} OI blocked=${summary.clearinghouse.blockedByOiCap} Lev blocked=${summary.clearinghouse.blockedByLeverage} Rate blocked=${summary.clearinghouse.blockedByRateLimit} (imbalance=${summary.clearinghouse.blockedByImbalanceLimit}, im=${summary.clearinghouse.blockedByInitialMargin}) Drawdown=${num(summary.clearinghouse.mmPeakToTrough)} StressMax=${pct(summary.clearinghouse.mmStressRatioMax, 1)} FirstNeg=${summary.clearinghouse.mmFirstNegativeMinute ?? "n/a"} `,
  );
  console.log(
    `RiskState=${summary.riskGovernor.finalState} transitions=${summary.riskGovernor.transitions} (N:${summary.riskGovernor.minutesNormal} T:${summary.riskGovernor.minutesToxic} S:${summary.riskGovernor.minutesStress}) Flow(inf avg/max=${pct(summary.riskGovernor.avgObservedInformedFlowShare, 1)}/${pct(summary.riskGovernor.maxObservedInformedFlowShare, 1)} attack avg/max=${pct(summary.riskGovernor.avgObservedAttackOrderShare, 1)}/${pct(summary.riskGovernor.maxObservedAttackOrderShare, 1)})`,
  );
  if (summary.clearinghouse.liquidationHotspots.length > 0) {
    const top = summary.clearinghouse.liquidationHotspots
      .slice(0, 3)
      .map(
        (hotspot) =>
          `${hotspot.marketId}(L${hotspot.liquidations}/B${hotspot.bankruptcies})`,
      )
      .join(", ");
    console.log(`Liquidation hotspots: ${top}`);
  }
  printTopAgents(summary);
  printEntrants(summary);
};

const printFeeSweep = (title: string, results: FeeSweepResult[]): void => {
  console.log(`\n=== ${title} ===`);
  console.log(
    "fee_bps | solvent | mm_equity_end | insurance_end | uncovered_bad_debt",
  );
  for (const result of results) {
    const summary = result.summary;
    console.log(
      `${String(result.feeBps).padStart(7)} | ${String(result.solvent).padEnd(7)} | ${num(summary.clearinghouse.mmEquityEnd, 2).padStart(13)} | ${num(summary.clearinghouse.insuranceEnd, 2).padStart(13)} | ${num(summary.clearinghouse.uncoveredBadDebt, 4).padStart(18)}`,
    );
  }
  const minFee = minimumSolventFeeBps(results);
  if (minFee === null) {
    console.log("Minimum solvent fee: no passing fee in sweep.");
  } else {
    console.log(`Minimum solvent fee: ${minFee} bps`);
  }
};

const parseArg = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1] ?? null;
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const run = (): void => {
  const scenarioArg = parseArg("--scenario");
  const feeSweepOnly = hasFlag("--fee-sweep");
  const jsonOutput = hasFlag("--json");

  if (feeSweepOnly) {
    const sweep = runThinLiquidityFeeSweep([4, 6, 8, 10, 12, 15, 18, 22, 26]);
    const feeDrivenGuarded = runFeeDrivenMmSweep([
      4, 6, 8, 10, 12, 15, 18, 22, 26, 32, 40, 50,
    ]);
    const feeDrivenUnmitigated = runFeeDrivenMmUnmitigatedSweep([
      4, 6, 8, 10, 12, 15, 18, 22, 26, 32, 40, 50,
    ]);
    const guardedMev = runGuardedMevFeeSweep([
      8, 10, 12, 15, 18, 22, 26, 32, 40,
    ]);
    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            thinLiquiditySweep: sweep,
            feeDrivenSweepGuarded: feeDrivenGuarded,
            feeDrivenSweepUnmitigated: feeDrivenUnmitigated,
            guardedMevSweep: guardedMev,
          },
          null,
          2,
        ),
      );
      return;
    }
    printFeeSweep("thin-liquidity fee sweep", sweep);
    printFeeSweep("fee-driven MM sweep (guarded)", feeDrivenGuarded);
    printFeeSweep(
      "fee-driven MM sweep (unmitigated reference)",
      feeDrivenUnmitigated,
    );
    printFeeSweep("guarded MEV fee sweep", guardedMev);
    return;
  }

  let summaries: SimulationSummary[] = [];
  if (scenarioArg === "baseline") {
    summaries = [runScenario(baselineConvergenceScenario())];
  } else if (scenarioArg === "entrants") {
    summaries = [runScenario(disruptiveEntrantsScenario())];
  } else if (scenarioArg === "thin") {
    summaries = [runScenario(thinLiquidityStressScenario(12))];
  } else if (scenarioArg === "fee-driven") {
    summaries = [runScenario(feeDrivenMmScenario(18))];
  } else if (scenarioArg === "fee-driven-unmitigated") {
    summaries = [runScenario(feeDrivenMmUnmitigatedScenario(18))];
  } else if (scenarioArg === "slow-growth") {
    summaries = [runScenario(slowGrowthScenario())];
  } else if (scenarioArg === "hype-crash") {
    summaries = [runScenario(hypeThenCrashScenario())];
  } else if (scenarioArg === "hype-falloff") {
    summaries = [runScenario(hypeSlowFalloffScenario())];
  } else if (scenarioArg === "hype-runaway") {
    summaries = [runScenario(hypeRunawaySuccessScenario())];
  } else if (scenarioArg === "mev") {
    summaries = [runScenario(mevBotAttackScenario())];
  } else if (scenarioArg === "mev-guarded") {
    summaries = [runScenario(mevBotAttackGuardedScenario())];
  } else if (scenarioArg === "mev-hardened") {
    summaries = [runScenario(mevBotAttackHardenedScenario())];
  } else if (scenarioArg === "mev-oracle-lag") {
    summaries = [runScenario(mevOracleLagAttackScenario())];
  } else if (scenarioArg === "sybil-swarm") {
    summaries = [runScenario(sybilSwarmAttackScenario())];
  } else if (scenarioArg === "mev-oracle-lag-hardened") {
    summaries = [runScenario(mevOracleLagHardenedScenario())];
  } else if (scenarioArg === "sybil-swarm-hardened") {
    summaries = [runScenario(sybilSwarmHardenedScenario())];
  } else {
    summaries = [
      runScenario(baselineConvergenceScenario()),
      runScenario(slowGrowthScenario()),
      runScenario(disruptiveEntrantsScenario()),
      runScenario(thinLiquidityStressScenario(12)),
      runScenario(hypeThenCrashScenario()),
      runScenario(hypeSlowFalloffScenario()),
      runScenario(hypeRunawaySuccessScenario()),
      runScenario(mevBotAttackScenario()),
      runScenario(mevBotAttackGuardedScenario()),
      runScenario(mevBotAttackHardenedScenario()),
      runScenario(mevOracleLagAttackScenario()),
      runScenario(sybilSwarmAttackScenario()),
      runScenario(mevOracleLagHardenedScenario()),
      runScenario(sybilSwarmHardenedScenario()),
    ];
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  for (const summary of summaries) {
    printSummary(summary);
  }
  printFeeSweep(
    "thin-liquidity fee sweep",
    runThinLiquidityFeeSweep([4, 6, 8, 10, 12, 15, 18, 22, 26]),
  );
  printFeeSweep(
    "fee-driven MM sweep (guarded)",
    runFeeDrivenMmSweep([4, 6, 8, 10, 12, 15, 18, 22, 26, 32, 40, 50]),
  );
  printFeeSweep(
    "fee-driven MM sweep (unmitigated reference)",
    runFeeDrivenMmUnmitigatedSweep([
      4, 6, 8, 10, 12, 15, 18, 22, 26, 32, 40, 50,
    ]),
  );
  printFeeSweep(
    "guarded MEV fee sweep",
    runGuardedMevFeeSweep([8, 10, 12, 15, 18, 22, 26, 32, 40]),
  );
};

run();
