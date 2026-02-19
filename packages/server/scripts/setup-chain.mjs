import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Correctly resolve workspace root from packages/server/scripts/
const workspaceRoot = path.resolve(__dirname, "../../../");
const contractsDir = path.join(workspaceRoot, "packages/contracts");
const worldsJsonPath = path.join(contractsDir, "worlds.json");

const ANVIL_PORT = 8545;
const ANVIL_HOST = "127.0.0.1";

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    dim: "\x1b[2m",
};

function log(msg, color = colors.reset) {
    console.log(`${color}[ChainSetup] ${msg}${colors.reset}`);
}

async function isPortInUse(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.on("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });
        socket.on("error", () => {
            resolve(false);
        });
        socket.connect(port, ANVIL_HOST);
    });
}

async function startAnvil() {
    log("Anvil is not running. Starting Anvil...", colors.yellow);

    // Start anvil in background
    const anvil = spawn("anvil", ["--block-time", "1"], {
        detached: true,
        stdio: "ignore", // We don't want to clutter server logs with anvil logs
    });

    anvil.unref();

    log("Waiting for Anvil to be ready...", colors.yellow);

    // Wait for port to be active
    let retries = 0;
    while (retries < 20) {
        if (await isPortInUse(ANVIL_PORT)) {
            log("Anvil started successfully.", colors.green);
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
        retries++;
    }

    throw new Error("Failed to start Anvil.");
}

async function getWorldAddress() {
    if (!fs.existsSync(worldsJsonPath)) {
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(worldsJsonPath, "utf-8"));
        return data["31337"]?.address;
    } catch (e) {
        return null;
    }
}

async function deployContracts() {
    log("Deploying contracts...", colors.blue);
    try {
        // Run mud deploy
        execSync("pnpm run deploy:local", {
            cwd: contractsDir,
            stdio: "inherit",
        });
        log("Contracts deployed successfully.", colors.green);
    } catch (e) {
        log("Failed to deploy contracts.", colors.red);
        throw e;
    }
}

async function checkAndSetup() {
    try {
        // 1. Check Anvil
        if (!(await isPortInUse(ANVIL_PORT))) {
            await startAnvil();
        } else {
            log("Anvil is already running.", colors.green);
        }

        // 2. Check World Contract
        const worldAddress = await getWorldAddress();
        if (!worldAddress) {
            log("World address not found in worlds.json. Deploying...", colors.yellow);
            await deployContracts();
            return;
        }

        // 3. Verify Contract Code on Chain
        const client = createPublicClient({
            chain: foundry,
            transport: http(`http://${ANVIL_HOST}:${ANVIL_PORT}`),
        });

        const code = await client.getCode({ address: worldAddress });

        if (!code || code === "0x") {
            log(`No contract found at ${worldAddress}. Deploying...`, colors.yellow);
            await deployContracts();
        } else {
            log(`World contract found at ${worldAddress}. Ready!`, colors.green);
        }

    } catch (error) {
        console.error(`${colors.red}Setup failed:${colors.reset}`, error);
        process.exit(1);
    }
}

checkAndSetup();
