import { describe, expect, it } from "vitest";
import { applyChainExecutionProfile } from "./chain-profiles";
import {
  disruptiveEntrantsScenario,
  feeDrivenMmScenario,
  hypeThenCrashScenario,
  mevBotAttackHardenedScenario,
  runScenario,
  slowGrowthScenario,
  thinLiquidityStressScenario,
} from "./scenarios";

const CHAINS = ["bsc", "base", "solana"] as const;

type ScenarioCase = {
  totalMinutes: number;
  build: (seed: number) => ReturnType<typeof slowGrowthScenario>;
  expectSolvent: boolean;
};

const SCENARIOS: ScenarioCase[] = [
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => slowGrowthScenario(seed),
    expectSolvent: true,
  },
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => disruptiveEntrantsScenario(seed),
    expectSolvent: true,
  },
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => hypeThenCrashScenario(seed),
    expectSolvent: true,
  },
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => thinLiquidityStressScenario(16, seed),
    expectSolvent: true,
  },
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => feeDrivenMmScenario(26, seed),
    expectSolvent: true,
  },
  {
    totalMinutes: 4 * 24 * 60,
    build: (seed) => mevBotAttackHardenedScenario(seed),
    expectSolvent: true,
  },
];

describe("cross-chain wide range stability", () => {
  it("remains stable across organic, hype, and attack profiles on bsc/base/solana", () => {
    let seed = 13_000;
    for (const scenario of SCENARIOS) {
      for (const chain of CHAINS) {
        const config = scenario.build(seed++);
        config.totalMinutes = scenario.totalMinutes;
        applyChainExecutionProfile(config, chain);
        const summary = runScenario(config);

        expect(summary.maxSimplexError).toBeLessThan(1e-6);
        expect(summary.maxObservedLogitStep).toBeLessThanOrEqual(
          config.index.maxLogitStepPerMinute + 1e-5,
        );
        expect(Number.isFinite(summary.clearinghouse.mmPnlTotal)).toBe(true);
        expect(summary.clearinghouse.uncoveredBadDebt).toBeGreaterThanOrEqual(
          0,
        );
        if (scenario.expectSolvent) {
          expect(summary.clearinghouse.mmBlewOut).toBe(false);
        }
      }
    }
  }, 45_000);
});
