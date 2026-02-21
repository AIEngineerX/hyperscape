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
  let goldToken = process.env.GOLD_TOKEN_ADDRESS;
  const allowMockDeployment =
    process.env.ALLOW_MOCK_TOKEN_DEPLOYMENT === "true";

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
    if (!goldToken) {
      throw new Error(
        "Mainnet deployment requires GOLD_TOKEN_ADDRESS. Refusing to deploy a mock token.",
      );
    }
  }

  if (!goldToken) {
    if (!allowMockDeployment) {
      throw new Error(
        "GOLD_TOKEN_ADDRESS not set. To deploy a mock token (non-production only), set ALLOW_MOCK_TOKEN_DEPLOYMENT=true",
      );
    }
    console.log("No GOLD_TOKEN_ADDRESS provided. Deploying MockERC20...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Mock Gold", "GOLD");
    await mockToken.waitForDeployment();
    goldToken = await mockToken.getAddress();
    console.log("MockERC20 deployed to:", goldToken);
  } else if (!isValidAddress(goldToken)) {
    throw new Error(`Invalid GOLD_TOKEN_ADDRESS: ${goldToken}`);
  }

  console.log("Deploying GoldClob...");
  const GoldClob = await ethers.getContractFactory("GoldClob");
  const clob = await GoldClob.deploy(goldToken, treasury, marketMaker);
  await clob.waitForDeployment();

  console.log("GoldClob deployed to:", await clob.getAddress());
  console.log("Configuration:");
  console.log("- Gold Token:", goldToken);
  console.log("- Treasury:", treasury);
  console.log("- Market Maker:", marketMaker);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
