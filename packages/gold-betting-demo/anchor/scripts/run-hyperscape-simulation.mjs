import { mkdtempSync, rmSync } from "node:fs";
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

async function waitForRpcReady(rpcUrl, timeoutMs = 30_000) {
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

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");

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

  const validator = spawn(
    "solana-test-validator",
    [
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
    ],
    {
      cwd: workspaceDir,
      stdio: "inherit",
      env: process.env,
    },
  );

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
    await waitForRpcReady(rpcUrl);

    const build = await runCommand("anchor", ["build"], workspaceDir);
    assertSuccess("anchor build", build);

    const deploy = await runCommand(
      "anchor",
      ["deploy", "--provider.cluster", rpcUrl, "--", "--use-rpc"],
      workspaceDir,
    );
    assertSuccess("anchor deploy", deploy);

    const simulate = await runCommand(
      "bun",
      ["scripts/simulate-hyperscape-localnet.ts"],
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

