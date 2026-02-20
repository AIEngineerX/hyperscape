import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to resolve free port"));
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

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !(result.error && result.error.code === "ENOENT");
}

function hasProgramCargoToml(workspaceDir) {
  const programsDir = join(workspaceDir, "programs");
  if (!existsSync(programsDir)) {
    return false;
  }

  for (const entry of readdirSync(programsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const cargoTomlPath = join(programsDir, entry.name, "Cargo.toml");
    if (existsSync(cargoTomlPath)) {
      return true;
    }
  }

  return false;
}

function directoryContainsTsFile(directory) {
  if (!existsSync(directory)) {
    return false;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directoryContainsTsFile(entryPath)) {
        return true;
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      return true;
    }
  }

  return false;
}

function shouldSkip(workspaceDir) {
  if (!hasProgramCargoToml(workspaceDir)) {
    console.log(
      "[anchor-test] Skipping: no programs/*/Cargo.toml found for local Anchor tests",
    );
    return true;
  }

  if (!directoryContainsTsFile(join(workspaceDir, "tests"))) {
    console.log(
      "[anchor-test] Skipping: no tests/**/*.ts found for local Anchor tests",
    );
    return true;
  }

  const missingCommands = ["anchor", "solana-test-validator"].filter(
    (command) => !commandExists(command),
  );
  if (missingCommands.length > 0) {
    console.log(
      `[anchor-test] Skipping: missing required command(s): ${missingCommands.join(", ")}`,
    );
    return true;
  }

  return false;
}

async function waitForRpcReady(rpcUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getHealth",
    params: [],
  };

  while (Date.now() < deadline) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const json = await response.json();
        if (json?.result === "ok" || !json?.error) {
          return;
        }
      }
    } catch {
      // Validator still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for validator RPC: ${rpcUrl}`);
}

function startLocalValidator(cwd, rpcPort, faucetPort, ledgerDir) {
  const args = [
    "--reset",
    "--quiet",
    "--bind-address",
    "0.0.0.0",
    "--rpc-port",
    String(rpcPort),
    "--faucet-port",
    String(faucetPort),
    "--ledger",
    ledgerDir,
  ];

  return spawn("solana-test-validator", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function stopProcess(child, signal = "SIGTERM", timeoutMs = 5_000) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore cleanup errors.
      }
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      child.kill(signal);
    } catch {
      clearTimeout(timeout);
      resolve();
    }
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

function assertSuccess(name, result) {
  if (result.signal) {
    throw new Error(`${name} terminated by signal ${result.signal}`);
  }
  if ((result.code ?? 1) !== 0) {
    throw new Error(`${name} failed with exit code ${result.code ?? 1}`);
  }
}

async function runPipeline(cwd, rpcUrl) {
  const rpcPort = Number(new URL(rpcUrl).port);
  const wsUrl = `ws://127.0.0.1:${rpcPort + 1}`;

  const build = await runCommand("anchor", ["build"], cwd);
  assertSuccess("anchor build", build);

  const deploy = await runCommand(
    "anchor",
    ["deploy", "--provider.cluster", rpcUrl, "--", "--use-rpc"],
    cwd,
  );
  assertSuccess("anchor deploy", deploy);

  const tests = await runCommand(
    "bun",
    [
      "run",
      "ts-mocha",
      "-p",
      "./tsconfig.json",
      "-t",
      "1000000",
      "tests/**/*.ts",
    ],
    cwd,
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
  assertSuccess("ts-mocha", tests);
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");

  if (shouldSkip(workspaceDir)) {
    process.exit(0);
  }

  const rpcPort = await getFreePort();
  let faucetPort = await getFreePort();
  while (faucetPort === rpcPort || faucetPort === rpcPort + 1) {
    faucetPort = await getFreePort();
  }

  const providerUrl = `http://127.0.0.1:${rpcPort}`;
  const ledgerDir = mkdtempSync(join(tmpdir(), "hyperscape-pm-validator-"));
  const validator = startLocalValidator(
    workspaceDir,
    rpcPort,
    faucetPort,
    ledgerDir,
  );

  let exitCode = 0;
  console.log(
    `[anchor-test] Validator rpc=${rpcPort} faucet=${faucetPort} provider=${providerUrl}`,
  );

  try {
    await waitForRpcReady(providerUrl);
    await runPipeline(workspaceDir, providerUrl);
  } catch (error) {
    exitCode = 1;
    console.error("[anchor-test] Test pipeline failed:", error);
  } finally {
    await stopProcess(validator);
    rmSync(ledgerDir, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[anchor-test] Failed to run tests:", error);
  process.exit(1);
});
