import { describe, expect, it } from "vitest";
import {
  applyChainExecutionProfile,
  executionChainProfiles,
} from "./chain-profiles";
import { mevBotAttackScenario, runScenario } from "./scenarios";

describe("chain execution profiles", () => {
  it("applyChainExecutionProfile keeps risk limits sane", () => {
    const base = mevBotAttackScenario(9101);
    const bsc = applyChainExecutionProfile(base, "bsc");
    expect(bsc.clearinghouse.maxLeverageMature).toBeGreaterThanOrEqual(
      bsc.clearinghouse.maxLeverageListing,
    );
    expect(bsc.clearinghouse.marketOrderLimitPerMinute).toBeGreaterThan(0);
    expect(bsc.clearinghouse.marketNotionalLimitPerMinute).toBeGreaterThan(0);
    expect(bsc.clearinghouse.marketNetImbalanceLimitPerMinute).toBeGreaterThan(
      0,
    );
  });

  it("managed MEV profile remains solvent across bsc/base/solana execution assumptions", () => {
    const chains = ["bsc", "base", "solana"] as const;
    for (const chain of chains) {
      const config = mevBotAttackScenario(9200 + chains.indexOf(chain));
      config.totalMinutes = 4 * 24 * 60;
      applyChainExecutionProfile(config, chain);
      const summary = runScenario(config);
      expect(summary.clearinghouse.mmBlewOut).toBe(false);
      expect(summary.clearinghouse.uncoveredBadDebt).toBeLessThanOrEqual(1);
      expect(summary.clearinghouse.blockedByRateLimit).toBeGreaterThanOrEqual(
        0,
      );
    }
  }, 25_000);

  it("profiles are defined for all supported chains", () => {
    expect(executionChainProfiles.bsc.chain).toBe("bsc");
    expect(executionChainProfiles.base.chain).toBe("base");
    expect(executionChainProfiles.solana.chain).toBe("solana");
  });
});
