import bs58 from "bs58";
import fs from "fs";

const deployerKey = process.env.SOLANA_DEPLOYER_PRIVATE_KEY;
if (!deployerKey) throw new Error("Missing SOLANA_DEPLOYER_PRIVATE_KEY");

const keypairBytes = bs58.decode(deployerKey);
fs.writeFileSync(
  "deployer-keypair.json",
  JSON.stringify(Array.from(keypairBytes)),
);
console.log("Wrote deployer-keypair.json");
