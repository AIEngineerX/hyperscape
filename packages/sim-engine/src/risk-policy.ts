import fs from "node:fs";
import path from "node:path";
import {
  baselineConvergenceScenario,
  mevBotAttackGuardedScenario,
  mevBotAttackHardenedScenario,
  mevOracleLagAttackScenario,
  mevOracleLagHardenedScenario,
  mevBotAttackScenario,
  sybilSwarmAttackScenario,
  sybilSwarmHardenedScenario,
  thinLiquidityStressScenario,
} from "./scenarios";
import {
  buildRiskGovernorPolicy,
  riskGovernorPolicyMarkdown,
  type RiskGovernorPolicyDocument,
} from "./risk-governor";

type PolicyScenario = {
  name: string;
  policy: RiskGovernorPolicyDocument;
};

const buildPolicies = (): PolicyScenario[] => {
  const scenarios = [
    { name: "baseline-convergence", config: baselineConvergenceScenario(7) },
    {
      name: "thin-liquidity-12bps",
      config: thinLiquidityStressScenario(12, 23),
    },
    { name: "mev-bot-attack", config: mevBotAttackScenario(97) },
    {
      name: "mev-bot-attack-guarded",
      config: mevBotAttackGuardedScenario(101),
    },
    {
      name: "mev-bot-attack-hardened",
      config: mevBotAttackHardenedScenario(103),
    },
    { name: "mev-oracle-lag-attack", config: mevOracleLagAttackScenario(107) },
    {
      name: "mev-oracle-lag-hardened",
      config: mevOracleLagHardenedScenario(113),
    },
    { name: "sybil-swarm-attack", config: sybilSwarmAttackScenario(109) },
    { name: "sybil-swarm-hardened", config: sybilSwarmHardenedScenario(127) },
  ];
  return scenarios.map((entry) => ({
    name: entry.name,
    policy: buildRiskGovernorPolicy(
      entry.name,
      entry.config.clearinghouse.riskGovernor,
    ),
  }));
};

const run = (): void => {
  const policies = buildPolicies();
  const outDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
  );
  const jsonPath = path.join(outDir, "risk-governor-policy.json");
  const mdPath = path.join(outDir, "risk-governor-policy.md");

  const payload = {
    generatedAt: new Date().toISOString(),
    version: "1.0.0",
    policies: policies.map((entry) => entry.policy),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const markdown = policies
    .map((entry) => riskGovernorPolicyMarkdown(entry.policy))
    .join("\n");
  fs.writeFileSync(mdPath, markdown, "utf8");

  console.log("Generated risk governor policies:");
  for (const entry of policies) {
    console.log(
      `${entry.name} | enabled=${entry.policy.enabled} | min_state_duration=${entry.policy.minStateDurationMinutes}m`,
    );
  }
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
};

run();
