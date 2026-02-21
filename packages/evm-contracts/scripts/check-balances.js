const { ethers } = require("ethers");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

async function checkAndTransfer() {
  const deployerAddress = requireEnv("DEPLOYER_ADDRESS");
  const mmAddress = requireEnv("MARKET_MAKER_ADDRESS");
  const mmPrivKey = requireEnv("MARKET_MAKER_PRIVATE_KEY");
  const deployerPrivKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  const rpcUrl = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployerBal = await provider.getBalance(deployerAddress);
  const mmBal = await provider.getBalance(mmAddress);

  console.log(
    "Base Sepolia - Deployer:",
    ethers.formatEther(deployerBal),
    "ETH",
  );
  console.log("Base Sepolia - MM:", ethers.formatEther(mmBal), "ETH");

  if (deployerBal === 0n && mmBal > ethers.parseEther("0.01")) {
    console.log("Transferring from MM to Deployer...");
    const wallet = new ethers.Wallet(mmPrivKey, provider);
    const txAmount = mmBal - ethers.parseEther("0.005");
    const feeData = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(mmAddress, "pending");
    const tx = await wallet.sendTransaction({
      to: deployerAddress,
      value: txAmount,
      nonce: nonce,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n,
      maxFeePerGas: feeData.maxFeePerGas * 2n,
    });
    await tx.wait();
    console.log(
      "Transferred",
      ethers.formatEther(txAmount),
      "ETH to deployer!",
    );
  } else if (mmBal === 0n && deployerBal > ethers.parseEther("0.01")) {
    console.log("Transferring from Deployer to MM...");
    const wallet = new ethers.Wallet(deployerPrivKey, provider);
    const tx = await wallet.sendTransaction({
      to: mmAddress,
      value: ethers.parseEther("0.05"),
    });
    await tx.wait();
    console.log("Transferred 0.05 ETH to MM!");
  }
}
checkAndTransfer().catch(console.error);
