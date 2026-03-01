import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !(result.error && result.error.code === "ENOENT");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function runCommand(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForRpcReady(rpcUrl, timeoutMs = 120_000) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getHealth",
    params: [],
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) return;
    } catch {
      // Validator still warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for local validator at ${rpcUrl}`);
}

function assertSuccess(step, result) {
  if (result.signal) {
    throw new Error(`${step} terminated with signal ${result.signal}`);
  }
  if ((result.code ?? 1) !== 0) {
    throw new Error(`${step} failed with exit code ${result.code ?? 1}`);
  }
}

function parseLocalnetPrograms(anchorTomlPath, deployDir) {
  const anchorToml = readFileSync(anchorTomlPath, "utf8");
  const localnetBlockMatch = anchorToml.match(
    /\[programs\.localnet\]([\s\S]*?)(?:\n\[|$)/,
  );
  if (!localnetBlockMatch) {
    throw new Error("Unable to find [programs.localnet] block in Anchor.toml");
  }

  const programs = [];
  for (const line of localnetBlockMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*"([^"]+)"$/);
    if (!match) continue;
    const [, name, programId] = match;
    const soPath = join(deployDir, `${name}.so`);
    programs.push({ name, programId, soPath });
  }

  if (programs.length === 0) {
    throw new Error("No programs found in [programs.localnet] block");
  }

  return programs;
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const anchorTomlPath = join(workspaceDir, "Anchor.toml");
  const targetDeployDir = join(workspaceDir, "target", "deploy");

  const simulationMode = (
    process.env.BETTING_SOLANA_SIM_MODE ?? "native"
  ).toLowerCase();
  const simulationScript =
    simulationMode === "spl"
      ? "./scripts/simulate-hyperscape-localnet.ts"
      : "./scripts/simulate-gold-clob-localnet.ts";
  if (simulationMode !== "native" && simulationMode !== "spl") {
    throw new Error(
      `Invalid BETTING_SOLANA_SIM_MODE='${simulationMode}'. Use 'native' or 'spl'.`,
    );
  }
  if (!existsSync(join(workspaceDir, simulationScript))) {
    throw new Error(`Simulation script not found: ${simulationScript}`);
  }
  console.log(
    `[simulate] mode=${simulationMode} script=${simulationScript} rpc=dynamic`,
  );

  const required = ["anchor", "solana-test-validator", "bun"].filter(
    (cmd) => !commandExists(cmd),
  );
  if (required.length > 0) {
    throw new Error(`Missing required command(s): ${required.join(", ")}`);
  }

  const rpcPort = await getFreePort();
  let faucetPort = await getFreePort();
  while (faucetPort === rpcPort || faucetPort === rpcPort + 1) {
    faucetPort = await getFreePort();
  }

  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const wsUrl = `ws://127.0.0.1:${rpcPort + 1}`;
  const ledgerDir = mkdtempSync(join(tmpdir(), "hyperscape-sim-validator-"));
  let validator = null;

  const stopValidator = async () => {
    if (!validator || validator.killed || validator.exitCode !== null) return;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          validator.kill("SIGKILL");
        } catch {
          // Ignore cleanup errors.
        }
      }, 5_000);
      validator.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      validator.kill("SIGTERM");
    });
  };

  let exitCode = 0;
  try {
    const build = await runCommand("anchor", ["build"], workspaceDir);
    assertSuccess("anchor build", build);

    const localnetPrograms = parseLocalnetPrograms(
      anchorTomlPath,
      targetDeployDir,
    );
    const missingSos = localnetPrograms
      .filter((program) => !existsSync(program.soPath))
      .map((program) => program.soPath);
    if (missingSos.length > 0) {
      throw new Error(
        `Missing deploy artifacts: ${missingSos.join(", ")}. Run anchor build.`,
      );
    }

    const validatorArgs = [
      "--reset",
      "--bind-address",
      "0.0.0.0",
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(faucetPort),
      "--ledger",
      ledgerDir,
    ];
    for (const program of localnetPrograms) {
      validatorArgs.push("--bpf-program", program.programId, program.soPath);
    }

    validator = spawn("solana-test-validator", validatorArgs, {
      cwd: workspaceDir,
      stdio: "inherit",
      env: process.env,
    });

    await waitForRpcReady(rpcUrl);

    const simulate = await runCommand(
      "bun",
      [simulationScript],
      workspaceDir,
      {
        ...process.env,
        ANCHOR_PROVIDER_URL: rpcUrl,
        ANCHOR_WS_URL: wsUrl,
        SOLANA_URL: rpcUrl,
        ANCHOR_WALLET:
          process.env.ANCHOR_WALLET ??
          `${process.env.HOME}/.config/solana/id.json`,
      },
    );
    assertSuccess("solana simulation", simulate);
  } catch (error) {
    exitCode = 1;
    console.error("[simulate] Failed:", error);
  } finally {
    await stopValidator();
    rmSync(ledgerDir, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[simulate] Fatal error:", error);
  process.exit(1);
});
