import { ethers, network } from "hardhat";

const PRODUCTION_CHAIN_IDS = new Set([56, 8453]);

function isValidAddress(value: string): boolean {
  return ethers.isAddress(value);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const isProduction =
    PRODUCTION_CHAIN_IDS.has(chainId) ||
    network.name === "bsc" ||
    network.name === "base";

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);

  const treasury = process.env.TREASURY_ADDRESS?.trim() || deployer.address;
  const marketMaker =
    process.env.MARKET_MAKER_ADDRESS?.trim() || deployer.address;

  if (!isValidAddress(treasury)) {
    throw new Error(`Invalid TREASURY_ADDRESS: ${treasury}`);
  }
  if (!isValidAddress(marketMaker)) {
    throw new Error(`Invalid MARKET_MAKER_ADDRESS: ${marketMaker}`);
  }

  if (isProduction) {
    if (!process.env.TREASURY_ADDRESS || !process.env.MARKET_MAKER_ADDRESS) {
      throw new Error(
        "Mainnet deployment requires TREASURY_ADDRESS and MARKET_MAKER_ADDRESS to be explicitly set",
      );
    }
  }

  console.log("Deploying GoldClob...");
  const GoldClob = await ethers.getContractFactory("GoldClob");
  const clob = await GoldClob.deploy(treasury, marketMaker);
  await clob.waitForDeployment();

  console.log("GoldClob deployed to:", await clob.getAddress());
  console.log("Configuration:");
  console.log("- Treasury:", treasury);
  console.log("- Market Maker:", marketMaker);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
