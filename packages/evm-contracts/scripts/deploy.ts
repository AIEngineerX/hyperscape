import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Default mock addresses for treasury and market maker if not set in env
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const marketMaker = process.env.MARKET_MAKER_ADDRESS || deployer.address;
  let goldToken = process.env.GOLD_TOKEN_ADDRESS;

  // If no gold token provided, deploy a mock one
  if (!goldToken) {
    console.log("No GOLD_TOKEN_ADDRESS provided. Deploying MockERC20...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Mock Gold", "GOLD");
    await mockToken.waitForDeployment();
    goldToken = await mockToken.getAddress();
    console.log("MockERC20 deployed to:", goldToken);
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
