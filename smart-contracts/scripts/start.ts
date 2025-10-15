import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "localhost",
  chainType: "l1",
});

import * as dotenv from "dotenv";
dotenv.config();

const { CONTRACT_ADDRESS } = process.env;
const INITIAL_MODEL_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"; // Example CID from IPFS docs

async function main() {
  if (!CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS is not set in the .env file");
  }

  // --- NEW: Pre-flight check to verify contract deployment ---
  console.log(`Checking for contract code at address: ${CONTRACT_ADDRESS}`);
  const code = await ethers.provider.getCode(CONTRACT_ADDRESS);
  if (code === "0x") {
    console.error("----------------------------------------------------");
    console.error(`❌ Error: No contract found at ${CONTRACT_ADDRESS}`);
    console.error("This is likely because you restarted your Hardhat node.");
    console.error("Please re-deploy your contract by running:");
    console.error("npx hardhat run scripts/deploy.ts --network localhost");
    console.error("----------------------------------------------------");
    process.exit(1); // Exit the script with an error code
  }
  console.log("✅ Contract code found. Proceeding with the script...");
  // --- END of Pre-flight check ---


  const [owner] = await ethers.getSigners();
  const flContract = await ethers.getContractAt("FederatedLearning", CONTRACT_ADDRESS);

  console.log(`Starting a new round from owner account: ${owner.address}...`);

  const tx = await flContract.connect(owner).startNewRound(INITIAL_MODEL_CID);
  console.log(`Transaction sent: ${tx.hash}`);
  
  await tx.wait();
  
  const currentRound = await flContract.currentRound();
  console.log(`✅ New round started successfully! Current round is now: ${currentRound.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
