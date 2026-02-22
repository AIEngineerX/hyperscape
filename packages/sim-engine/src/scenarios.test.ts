import { describe, expect, it } from "vitest";
import {
  baselineConvergenceScenario,
  disruptiveEntrantsScenario,
  hypeThenCrashScenario,
  runFeeDrivenMmUnmitigatedSweep,
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  mevBotAttackScenario,
  runFeeDrivenMmSweep,
  runGuardedMevFeeSweep,
  runScenario,
  runThinLiquidityFeeSweep,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
} from "./scenarios";

describe("scenario runner", () => {
  it("maintains simplex and logit cap invariants in baseline", () => {
    const config = baselineConvergenceScenario(101);
    config.totalMinutes = 4 * 24 * 60;
    const summary = runScenario(config);

    expect(summary.maxSimplexError).toBeLessThan(1e-6);
    expect(summary.maxObservedLogitStep).toBeLessThanOrEqual(
      config.index.maxLogitStepPerMinute + 1e-5,
    );
    expect(summary.totalDuels).toBeGreaterThan(0);
  });

  it("shows entrant adaptation from weak start to improved outcomes", () => {
    const config = disruptiveEntrantsScenario(202);
    config.totalMinutes = 16 * 24 * 60;
    const summary = runScenario(config);

    const measured = summary.entrants.filter(
      (entrant) => entrant.day1WinRate !== null && entrant.day7WinRate !== null,
    );
    expect(measured.length).toBeGreaterThan(0);
    expect(
      measured.some(
        (entrant) =>
          (entrant.day7WinRate as number) > (entrant.day1WinRate as number),
      ),
    ).toBe(true);
  }, 15_000);

  it("fee sweep executes and returns finite risk metrics", () => {
    const sweep = runThinLiquidityFeeSweep([8, 12, 16, 20], 303);
    expect(sweep.length).toBe(4);
    for (const point of sweep) {
      expect(Number.isFinite(point.summary.clearinghouse.mmEquityEnd)).toBe(
        true,
      );
      expect(
        point.summary.clearinghouse.uncoveredBadDebt,
      ).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it("hype then crash scenario creates liquidation hotspots", () => {
    const config = hypeThenCrashScenario(404);
    config.totalMinutes = 8 * 24 * 60;
    const summary = runScenario(config);
    expect(summary.clearinghouse.liquidationCount).toBeGreaterThan(0);
    expect(summary.clearinghouse.liquidationHotspots.length).toBeGreaterThan(0);
  }, 20_000);

  it("mev attack scenario drives severe flow constraints", () => {
    const config = mevBotAttackScenario(505);
    config.totalMinutes = 6 * 24 * 60;
    const summary = runScenario(config);
    expect(summary.clearinghouse.blockedByOiCap).toBeGreaterThan(1000);
    expect(summary.clearinghouse.blockedByRateLimit).toBeGreaterThan(0);
    expect(summary.clearinghouse.blockedByLeverage).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it("guarded mev controls reduce MM stress versus unmitigated attack", () => {
    const base = mevBotAttackScenario(606);
    const guarded = mevBotAttackGuardedScenario(606);
    base.totalMinutes = 6 * 24 * 60;
    guarded.totalMinutes = 6 * 24 * 60;

    const baseSummary = runScenario(base);
    const guardedSummary = runScenario(guarded);

    expect(guardedSummary.clearinghouse.mmStressRatioMax).toBeLessThan(
      baseSummary.clearinghouse.mmStressRatioMax,
    );
    expect(guardedSummary.clearinghouse.mmPnlTotal).toBeGreaterThan(
      baseSummary.clearinghouse.mmPnlTotal,
    );
    expect(guardedSummary.riskGovernor.transitions).toBeGreaterThan(0);
    expect(
      guardedSummary.riskGovernor.avgObservedInformedFlowShare,
    ).toBeGreaterThan(0.5);
  }, 25_000);

  it("hardened mev profile avoids MM blowout in short attack window", () => {
    const hardened = mevBotAttackHardenedScenario(707);
    hardened.totalMinutes = 6 * 24 * 60;
    const summary = runScenario(hardened);
    expect(summary.clearinghouse.mmBlewOut).toBe(false);
    expect(summary.clearinghouse.uncoveredBadDebt).toBeLessThanOrEqual(1);
  }, 25_000);

  it("guarded mev fee sweep includes solvent points at higher fees", () => {
    const sweep = runGuardedMevFeeSweep([12, 18, 24, 32], 808);
    expect(sweep.some((point) => point.solvent)).toBe(true);
  }, 60_000);

  it("guarded fee-driven sweep includes solvent configurations", () => {
    const sweep = runFeeDrivenMmSweep([8, 12, 18, 26, 32], 809);
    expect(sweep.some((point) => point.solvent)).toBe(true);
    expect(
      sweep.every((point) => point.summary.clearinghouse.uncoveredBadDebt <= 1),
    ).toBe(true);
  }, 120_000);

  it("unmitigated fee-driven sweep remains structurally insolvent", () => {
    const sweep = runFeeDrivenMmUnmitigatedSweep([12, 18, 26, 40, 50], 810);
    expect(sweep.every((point) => !point.solvent)).toBe(true);
    expect(sweep.every((point) => point.summary.clearinghouse.mmBlewOut)).toBe(
      true,
    );
  }, 120_000);

  it("oracle lag attack remains solvent under hardened guarded controls", () => {
    const config = mevOracleLagAttackScenario(909);
    config.totalMinutes = 5 * 24 * 60;
    const summary = runScenario(config);
    expect(summary.clearinghouse.mmBlewOut).toBe(false);
    expect(summary.riskGovernor.transitions).toBeGreaterThan(0);
    expect(summary.clearinghouse.blockedByImbalanceLimit).toBeGreaterThan(0);
  }, 25_000);

  it("sybil swarm attack triggers throttles without uncovered bad debt", () => {
    const config = sybilSwarmAttackScenario(1001);
    config.totalMinutes = 5 * 24 * 60;
    const summary = runScenario(config);
    expect(summary.clearinghouse.blockedByRateLimit).toBeGreaterThan(0);
    expect(summary.clearinghouse.blockedByImbalanceLimit).toBeGreaterThan(0);
    expect(summary.clearinghouse.uncoveredBadDebt).toBeLessThanOrEqual(1);
  }, 25_000);

  it("hardened oracle-lag profile prioritizes solvency and throttles toxic imbalance", () => {
    const base = mevOracleLagAttackScenario(1102);
    const hardened = mevOracleLagHardenedScenario(1102);
    base.totalMinutes = 5 * 24 * 60;
    hardened.totalMinutes = 5 * 24 * 60;
    const baseSummary = runScenario(base);
    const hardenedSummary = runScenario(hardened);
    expect(hardenedSummary.clearinghouse.mmBlewOut).toBe(false);
    expect(hardenedSummary.clearinghouse.uncoveredBadDebt).toBeLessThanOrEqual(
      1,
    );
    expect(
      hardenedSummary.clearinghouse.blockedByImbalanceLimit,
    ).toBeGreaterThan(baseSummary.clearinghouse.blockedByImbalanceLimit);
    expect(hardenedSummary.clearinghouse.mmStressRatioMax).toBeLessThanOrEqual(
      0.02,
    );
  }, 25_000);

  it("hardened sybil profile stays solvent with aggressive imbalance throttling", () => {
    const base = sybilSwarmAttackScenario(1203);
    const hardened = sybilSwarmHardenedScenario(1203);
    base.totalMinutes = 5 * 24 * 60;
    hardened.totalMinutes = 5 * 24 * 60;
    const baseSummary = runScenario(base);
    const hardenedSummary = runScenario(hardened);
    expect(hardenedSummary.clearinghouse.mmBlewOut).toBe(false);
    expect(hardenedSummary.clearinghouse.uncoveredBadDebt).toBeLessThanOrEqual(
      1,
    );
    expect(
      hardenedSummary.clearinghouse.blockedByImbalanceLimit,
    ).toBeGreaterThan(baseSummary.clearinghouse.blockedByImbalanceLimit);
    expect(hardenedSummary.clearinghouse.mmStressRatioMax).toBeLessThanOrEqual(
      0.02,
    );
    expect(hardenedSummary.clearinghouse.mmPnlTotal).toBeGreaterThan(-100);
  }, 25_000);
});
