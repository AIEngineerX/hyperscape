import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();

function runStep(name, command, args, cwd) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n[deep-pass] ${name}`);
    console.log(`[deep-pass] cwd=${cwd}`);
    console.log(`[deep-pass] cmd=${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", rejectStep);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectStep(new Error(`${name} terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        rejectStep(new Error(`${name} failed with exit code ${code ?? 1}`));
        return;
      }
      resolveStep();
    });
  });
}

async function main() {
  const evmDir = resolve(ROOT, "packages/evm-contracts");
  const solanaDir = resolve(ROOT, "packages/gold-betting-demo/anchor");

  await runStep("EVM tests (includes fuzz)", "bun", ["run", "test"], evmDir);
  await runStep(
    "EVM 100-wallet simulation",
    "bun",
    ["run", "simulate:localnet"],
    evmDir,
  );

  await runStep(
    "Solana tests (includes randomized invariants)",
    "bun",
    ["run", "test"],
    solanaDir,
  );
  await runStep(
    "Solana 100-wallet simulation",
    "bun",
    ["run", "simulate:localnet"],
    solanaDir,
  );

  await runStep(
    "Simulation report verification",
    "node",
    ["scripts/verify-betting-simulations.mjs"],
    ROOT,
  );

  console.log("\n[deep-pass] SUCCESS: all checks passed");
}

main().catch((error) => {
  console.error(`\n[deep-pass] FAILED: ${error.message}`);
  process.exit(1);
});
