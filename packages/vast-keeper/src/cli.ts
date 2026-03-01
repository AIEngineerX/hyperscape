#!/usr/bin/env bun
/**
 * Vast.ai GPU Instance Manager CLI
 *
 * Commands:
 *   provision  - Find and rent a GPU instance with WebGPU (display driver) support
 *   status     - Show current instance status
 *   search     - Search for available GPU instances
 *   destroy    - Destroy the current instance
 *   ssh        - Show SSH connection command
 *
 * Environment Variables:
 *   VAST_API_KEY - Required. Your Vast.ai API key
 *
 * Example:
 *   VAST_API_KEY=xxx bun run provision
 *   VAST_API_KEY=xxx bun run status
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// Colors for terminal output
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m"; // No Color

const log = {
  info: (msg: string) => console.log(`${BLUE}[INFO]${NC} ${msg}`),
  success: (msg: string) => console.log(`${GREEN}[SUCCESS]${NC} ${msg}`),
  warn: (msg: string) => console.log(`${YELLOW}[WARN]${NC} ${msg}`),
  error: (msg: string) => console.log(`${RED}[ERROR]${NC} ${msg}`),
  header: (msg: string) =>
    console.log(
      `\n${CYAN}${BOLD}${"═".repeat(60)}${NC}\n${CYAN}${BOLD}${msg}${NC}\n${CYAN}${BOLD}${"═".repeat(60)}${NC}`,
    ),
};

// Configuration - CRITICAL: gpu_display_active=true is required for WebGPU
const CONFIG = {
  // WebGPU requires display driver support, not just compute
  searchQuery:
    process.env.VAST_SEARCH_QUERY ||
    "gpu_display_active=true reliability > 0.95 gpu_ram >= 20 num_gpus=1 rented=False dph < 2.0",
  image: process.env.VAST_IMAGE || "nvidia/cuda:12.4.0-runtime-ubuntu22.04",
  diskSize: Number.parseInt(process.env.VAST_DISK_GB || "120", 10),
  maxWaitTime: 300000, // 5 minutes
};

interface VastInstance {
  id: number;
  actual_status: string;
  ssh_host: string;
  ssh_port: number;
  gpu_name: string;
  gpu_ram: number;
  dph_total: number;
  reliability: number;
  gpu_display_active: boolean;
  public_ipaddr?: string;
}

interface VastOffer {
  id: number;
  dph_total: number;
  gpu_name: string;
  gpu_ram: number;
  reliability: number;
  gpu_display_active: boolean;
  disk_space: number;
}

// Check for API key
const API_KEY = process.env.VAST_API_KEY;

async function ensureApiKeyFile(): Promise<void> {
  if (!API_KEY) {
    log.error("VAST_API_KEY environment variable is required.");
    log.info("Get your API key from: https://vast.ai/console/account");
    log.info("Then run: VAST_API_KEY=your_key bun run provision");
    process.exit(1);
  }

  const vastDir = path.join(process.env.HOME || "", ".config/vastai");
  const keyFile = path.join(vastDir, "vast_api_key");
  try {
    await fs.mkdir(vastDir, { recursive: true });
    await fs.writeFile(keyFile, API_KEY.trim(), { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

function runVastCmd(args: string[]): unknown {
  const cmdArgs = [...args, "--raw"];
  const proc = spawnSync("vastai", cmdArgs, { encoding: "utf-8" });

  if (proc.error) {
    throw new Error(`Failed to execute vastai: ${proc.error.message}`);
  }

  if (proc.status !== 0) {
    throw new Error(`vastai command failed: ${proc.stderr || proc.stdout}`);
  }

  try {
    const out = proc.stdout.trim();
    const jsonStart = out.search(/[{[]/);
    if (jsonStart === -1) {
      // Some commands return plain text
      return out;
    }
    return JSON.parse(out.substring(jsonStart));
  } catch {
    return proc.stdout.trim();
  }
}

async function searchOffers(): Promise<VastOffer[]> {
  log.header("Searching for GPU instances with WebGPU support");
  log.info(`Search query: ${CONFIG.searchQuery}`);
  log.info("(gpu_display_active=true is REQUIRED for WebGPU streaming)");

  const offers = runVastCmd([
    "search",
    "offers",
    CONFIG.searchQuery,
  ]) as VastOffer[];

  if (!Array.isArray(offers) || offers.length === 0) {
    log.warn("No offers found with gpu_display_active=true");
    log.info("");
    log.info("Searching without display requirement for comparison...");

    const broadOffers = runVastCmd([
      "search",
      "offers",
      "reliability > 0.95 gpu_ram >= 20 dph < 2.0",
    ]) as VastOffer[];

    if (Array.isArray(broadOffers) && broadOffers.length > 0) {
      log.info(
        `Found ${broadOffers.length} instances WITHOUT display support.`,
      );
      log.warn("These will NOT work for WebGPU streaming.");
    }

    return [];
  }

  // Sort by price
  offers.sort((a, b) => a.dph_total - b.dph_total);
  return offers;
}

async function getActiveInstances(): Promise<VastInstance[]> {
  const instances = runVastCmd(["show", "instances"]) as VastInstance[];
  if (!Array.isArray(instances)) return [];
  return instances.filter(
    (i) => i.actual_status === "running" || i.actual_status === "loading",
  );
}

async function waitForInstance(
  instanceId: number,
): Promise<VastInstance | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < CONFIG.maxWaitTime) {
    const instances = runVastCmd(["show", "instances"]) as VastInstance[];
    const instance = instances.find((i) => i.id === instanceId);

    if (
      instance?.actual_status === "running" &&
      instance.ssh_host &&
      instance.ssh_port
    ) {
      return instance;
    }

    const status = instance?.actual_status || "unknown";
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    log.info(`Instance status: ${status} (${elapsed}s elapsed)`);
    await new Promise((r) => setTimeout(r, 15000));
  }

  return null;
}

async function waitForSsh(host: string, port: number): Promise<boolean> {
  log.info(`Waiting for SSH on ${host}:${port}...`);
  const startTime = Date.now();

  while (Date.now() - startTime < 120000) {
    const check = spawnSync(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-p",
        String(port),
        `root@${host}`,
        "echo ready",
      ],
      { encoding: "utf-8" },
    );

    if (check.status === 0 && check.stdout.includes("ready")) {
      return true;
    }

    await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

// Commands

async function cmdSearch(): Promise<void> {
  await ensureApiKeyFile();

  const offers = await searchOffers();

  if (offers.length === 0) {
    log.error("No GPU instances with display driver support available.");
    log.info("");
    log.info("Options:");
    log.info("  1. Try again later - availability changes frequently");
    log.info("  2. Increase MAX_PRICE_PER_HOUR in search query");
    log.info("  3. Try different GPU types");
    process.exit(1);
  }

  log.success(`Found ${offers.length} instances with WebGPU support!`);
  console.log("");
  console.log(`${BOLD}Top 10 available instances:${NC}`);
  console.log("─".repeat(100));
  console.log(
    `${"ID".padEnd(10)} ${"GPU".padEnd(20)} ${"RAM".padEnd(8)} ${"$/hr".padEnd(10)} ${"Reliability".padEnd(12)} Display`,
  );
  console.log("─".repeat(100));

  for (const offer of offers.slice(0, 10)) {
    const id = String(offer.id).padEnd(10);
    const gpu = offer.gpu_name.padEnd(20);
    const ram = `${offer.gpu_ram}GB`.padEnd(8);
    const price = `$${offer.dph_total.toFixed(3)}`.padEnd(10);
    const reliability = offer.reliability.toFixed(3).padEnd(12);
    const display = offer.gpu_display_active
      ? `${GREEN}YES${NC}`
      : `${RED}NO${NC}`;
    console.log(`${id} ${gpu} ${ram} ${price} ${reliability} ${display}`);
  }
  console.log("─".repeat(100));
}

async function cmdStatus(): Promise<void> {
  await ensureApiKeyFile();

  log.header("Vast.ai Instance Status");

  const instances = await getActiveInstances();

  if (instances.length === 0) {
    log.warn("No running instances found.");
    log.info("");
    log.info("Run 'bun run provision' to provision a new instance.");
    return;
  }

  for (const instance of instances) {
    console.log("");
    console.log(`${BOLD}Instance ${instance.id}${NC}`);
    console.log("─".repeat(50));
    console.log(`  Status:     ${instance.actual_status}`);
    console.log(`  GPU:        ${instance.gpu_name} (${instance.gpu_ram}GB)`);
    console.log(
      `  Display:    ${instance.gpu_display_active ? `${GREEN}Enabled${NC}` : `${RED}Disabled${NC}`}`,
    );
    console.log(`  Price:      $${instance.dph_total?.toFixed(3) || "?"}/hr`);
    console.log(`  SSH Host:   ${instance.ssh_host}`);
    console.log(`  SSH Port:   ${instance.ssh_port}`);
    console.log("");
    console.log(`  ${CYAN}SSH Command:${NC}`);
    console.log(`    ssh -p ${instance.ssh_port} root@${instance.ssh_host}`);
    console.log("");
    console.log(`  ${CYAN}GitHub Secrets:${NC}`);
    console.log(`    VAST_HOST=${instance.ssh_host}`);
    console.log(`    VAST_PORT=${instance.ssh_port}`);
    console.log("─".repeat(50));
  }
}

async function cmdProvision(): Promise<void> {
  await ensureApiKeyFile();

  log.header("Provisioning GPU Instance with WebGPU Support");

  // Check if we already have a running instance
  const existing = await getActiveInstances();
  if (existing.length > 0) {
    log.warn("You already have running instances:");
    for (const inst of existing) {
      console.log(
        `  - Instance ${inst.id}: ${inst.gpu_name} at ${inst.ssh_host}:${inst.ssh_port}`,
      );
    }
    log.info("");
    log.info("To provision a new instance, first destroy the existing one:");
    log.info("  bun run destroy");
    process.exit(1);
  }

  // Search for offers
  const offers = await searchOffers();

  if (offers.length === 0) {
    log.error("No GPU instances with display driver support available.");
    process.exit(1);
  }

  const bestOffer = offers[0];
  log.success(`Selected best offer:`);
  console.log(`  Offer ID:    ${bestOffer.id}`);
  console.log(`  GPU:         ${bestOffer.gpu_name} (${bestOffer.gpu_ram}GB)`);
  console.log(`  Price:       $${bestOffer.dph_total.toFixed(3)}/hr`);
  console.log(`  Reliability: ${bestOffer.reliability.toFixed(3)}`);
  console.log(
    `  Display:     ${bestOffer.gpu_display_active ? "Enabled" : "Disabled"}`,
  );
  console.log("");

  // Create instance
  log.info(`Creating instance from offer ${bestOffer.id}...`);

  const result = runVastCmd([
    "create",
    "instance",
    String(bestOffer.id),
    "--image",
    CONFIG.image,
    "--disk",
    String(CONFIG.diskSize),
    "--ssh",
  ]) as { success?: boolean; new_contract?: string };

  if (!result?.success || !result?.new_contract) {
    log.error(`Failed to create instance: ${JSON.stringify(result)}`);
    process.exit(1);
  }

  const instanceId = Number.parseInt(result.new_contract, 10);
  log.success(`Instance created! ID: ${instanceId}`);

  // Wait for instance to be running
  log.info("Waiting for instance to start...");
  const instance = await waitForInstance(instanceId);

  if (!instance) {
    log.error("Timeout waiting for instance to start.");
    log.info(`Check manually: vastai show instance ${instanceId}`);
    process.exit(1);
  }

  log.success("Instance is running!");

  // Wait for SSH
  const sshReady = await waitForSsh(instance.ssh_host, instance.ssh_port);

  if (!sshReady) {
    log.warn("SSH not ready yet. The instance may still be initializing.");
  } else {
    log.success("SSH is ready!");
  }

  // Output summary
  log.header("Instance Provisioned Successfully!");
  console.log("");
  console.log(`  ${BOLD}Instance ID:${NC}  ${instanceId}`);
  console.log(
    `  ${BOLD}GPU:${NC}          ${instance.gpu_name} (${instance.gpu_ram}GB)`,
  );
  console.log(
    `  ${BOLD}Display:${NC}      ${GREEN}Enabled (WebGPU supported)${NC}`,
  );
  console.log(`  ${BOLD}SSH Host:${NC}     ${instance.ssh_host}`);
  console.log(`  ${BOLD}SSH Port:${NC}     ${instance.ssh_port}`);
  console.log("");
  console.log(`  ${CYAN}SSH Connection:${NC}`);
  console.log(`    ssh -p ${instance.ssh_port} root@${instance.ssh_host}`);
  console.log("");
  console.log(`  ${CYAN}Update GitHub Secrets:${NC}`);
  console.log(`    gh secret set VAST_HOST --body '${instance.ssh_host}'`);
  console.log(`    gh secret set VAST_PORT --body '${instance.ssh_port}'`);
  console.log("");
  console.log(`  ${CYAN}Trigger Deployment:${NC}`);
  console.log(`    gh workflow run deploy-vast.yml`);
  console.log("");

  // Save config to file
  const configFile = "/tmp/vast-instance-config.env";
  const config = `# Vast.ai Instance Configuration
# Generated: ${new Date().toISOString()}
VAST_INSTANCE_ID=${instanceId}
VAST_HOST=${instance.ssh_host}
VAST_PORT=${instance.ssh_port}
VAST_GPU=${instance.gpu_name}
VAST_GPU_RAM=${instance.gpu_ram}
VAST_DISPLAY_ACTIVE=true
`;
  await fs.writeFile(configFile, config);
  log.info(`Configuration saved to: ${configFile}`);
}

async function cmdDestroy(): Promise<void> {
  await ensureApiKeyFile();

  log.header("Destroying Vast.ai Instances");

  const instances = await getActiveInstances();

  if (instances.length === 0) {
    log.warn("No running instances found.");
    return;
  }

  for (const instance of instances) {
    log.info(`Destroying instance ${instance.id} (${instance.gpu_name})...`);

    try {
      runVastCmd(["destroy", "instance", String(instance.id)]);
      log.success(`Instance ${instance.id} destroyed.`);
    } catch (err) {
      log.error(`Failed to destroy instance ${instance.id}: ${err}`);
    }
  }
}

async function cmdSsh(): Promise<void> {
  await ensureApiKeyFile();

  const instances = await getActiveInstances();

  if (instances.length === 0) {
    log.warn("No running instances found.");
    return;
  }

  const instance = instances[0];
  console.log(`ssh -p ${instance.ssh_port} root@${instance.ssh_host}`);
}

// Main CLI handler
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  // Check for vastai CLI
  const check = spawnSync("vastai", ["--version"], { encoding: "utf-8" });
  if (check.status !== 0) {
    log.error("vastai CLI not found.");
    log.info("Install it with: pip install vastai");
    process.exit(1);
  }

  switch (command) {
    case "provision":
      await cmdProvision();
      break;
    case "status":
      await cmdStatus();
      break;
    case "search":
      await cmdSearch();
      break;
    case "destroy":
      await cmdDestroy();
      break;
    case "ssh":
      await cmdSsh();
      break;
    case "help":
    default:
      console.log(`
${BOLD}Vast.ai GPU Instance Manager${NC}

${CYAN}IMPORTANT:${NC} All instances are provisioned with gpu_display_active=true
           which is ${BOLD}REQUIRED${NC} for WebGPU streaming.

${BOLD}Commands:${NC}
  provision  - Find and rent a GPU instance with WebGPU support
  status     - Show current instance status and SSH info
  search     - Search for available GPU instances
  destroy    - Destroy all running instances
  ssh        - Print SSH connection command

${BOLD}Environment:${NC}
  VAST_API_KEY     - Required. Your Vast.ai API key
  VAST_SEARCH_QUERY - Optional. Custom search query (must include gpu_display_active=true)

${BOLD}Examples:${NC}
  VAST_API_KEY=xxx bun run provision
  VAST_API_KEY=xxx bun run status
  VAST_API_KEY=xxx bun run search

${BOLD}Workflow:${NC}
  1. Run 'bun run provision' to create a new instance
  2. Update GitHub secrets with VAST_HOST and VAST_PORT
  3. Run 'gh workflow run deploy-vast.yml' to deploy
`);
      break;
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message || err}`);
  process.exit(1);
});
