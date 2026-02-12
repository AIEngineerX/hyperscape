import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

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

function withUpdatedTestValidatorPorts(contents, rpcPort, faucetPort) {
  const sectionPattern = /^\[test\.validator\]\n(?:[^\[].*\n?)*/m;
  const sectionMatch = contents.match(sectionPattern);

  if (!sectionMatch) {
    return `${contents.trimEnd()}\n\n[test.validator]\nrpc_port = ${rpcPort}\nfaucet_port = ${faucetPort}\n`;
  }

  let section = sectionMatch[0];
  section = section.replace(/^rpc_port\s*=.*$/m, `rpc_port = ${rpcPort}`);
  section = section.replace(/^faucet_port\s*=.*$/m, `faucet_port = ${faucetPort}`);

  if (!/^rpc_port\s*=.*$/m.test(section)) {
    section = `${section.trimEnd()}\nrpc_port = ${rpcPort}\n`;
  }
  if (!/^faucet_port\s*=.*$/m.test(section)) {
    section = `${section.trimEnd()}\nfaucet_port = ${faucetPort}\n`;
  }

  return contents.replace(sectionPattern, section);
}

function runAnchorTest(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("anchor", ["test"], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  const packageDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(packageDir, "..");
  const anchorTomlPath = join(workspaceDir, "Anchor.toml");
  const original = readFileSync(anchorTomlPath, "utf8");

  const rpcPort = await getFreePort();
  let faucetPort = await getFreePort();
  while (faucetPort === rpcPort) {
    faucetPort = await getFreePort();
  }

  const patched = withUpdatedTestValidatorPorts(original, rpcPort, faucetPort);
  writeFileSync(anchorTomlPath, patched, "utf8");
  console.log(
    `[anchor-test] Using local validator ports rpc=${rpcPort}, faucet=${faucetPort}`,
  );

  try {
    const { code, signal } = await runAnchorTest(workspaceDir);
    if (signal) {
      console.error(`[anchor-test] anchor test terminated by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  } finally {
    writeFileSync(anchorTomlPath, original, "utf8");
  }
}

main().catch((error) => {
  console.error("[anchor-test] Failed to run tests:", error);
  process.exit(1);
});
