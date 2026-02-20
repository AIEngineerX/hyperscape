const { ethers } = require("ethers");

async function checkAndTransfer() {
  const deployerAddress = "0xc1ADC5750D03bc511fDc506331FA593bB247C707";
  const mmAddress = "0x47902Dda79991b131110C3A20E7F0C74ca40d132";

  const mmPrivKey =
    "a6a556a023ab26e2f22530273e91b00178adb019754c15617e4d3f726db11b63";
  const deployerPrivKey =
    "ad7ccde0f7af2b274074c219738200e76e85a9ef24151fdd15263a27195ed707";

  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
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
      value: ethers.parseEther("0.05"), // send some for mm bot
    });
    await tx.wait();
    console.log("Transferred 0.05 ETH to MM!");
  }
}
checkAndTransfer().catch(console.error);
