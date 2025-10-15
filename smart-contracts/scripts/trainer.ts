import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "localhost",
  chainType: "l1",
});

import * as dotenv from "dotenv";
import { create } from "kubo-rpc-client";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { NewRoundStartedEvent } from "../types/ethers-contracts/FederatedLearning.js";
import { ContractEventPayload } from "ethers";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// --- Configuration ---
const { CONTRACT_ADDRESS, TRAINER_PRIVATE_KEY, IPFS_API_URL } = process.env;
const MODELS_DIR = path.resolve(__dirname, "../models");

// --- Main Service Function ---
async function main() {
  if (!CONTRACT_ADDRESS || !TRAINER_PRIVATE_KEY || !IPFS_API_URL) {
    throw new Error("Please set CONTRACT_ADDRESS, TRAINER_PRIVATE_KEY, and IPFS_API_URL in .env");
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

  // Ensure models directory exists
  await fs.mkdir(MODELS_DIR, { recursive: true });

  // Connect to services
  const provider = ethers.provider;
  const trainerSigner = new ethers.Wallet(TRAINER_PRIVATE_KEY, provider);
  const contract = await ethers.getContractAt("FederatedLearning", CONTRACT_ADDRESS);
  const ipfs = create({ url: IPFS_API_URL });

  console.log("✅ Trainer Service Initialized");
  console.log(`   - Trainer Address: ${trainerSigner.address}`);
  console.log(`   - Listening on contract: ${await contract.getAddress()}`);
  console.log("👂 Waiting for 'NewRoundStarted' events...");
  // Use the type-safe filter from the contract object
  const roundStartedFilter = contract.filters.NewRoundStarted();

  // --- FIX: Correctly handle Ethers v6 typed event listener signature ---
  const listener = async (...args: any[]) => {
    // Ethers v6 can pass either a single ContractEventPayload or spread-out arguments.
    // This listener handles both cases.
    const event = args[args.length - 1] as NewRoundStartedEvent.Log;
    let roundId: bigint;
    let initialModelCID: string;

    // Check if the first argument looks like a ContractEventPayload object
    if (args.length === 1 && typeof args[0] === 'object' && args[0].args) {
        const payload = args[0] as ContractEventPayload;
        roundId = payload.args[0];
        initialModelCID = payload.args[1];
    } else {
        // Handle the case where arguments are passed directly
        [roundId, initialModelCID] = args;
    }
    
    console.log("\n----------------------------------------------------");
    console.log(`🔔 NewRoundStarted event detected!`);
    console.log(`   - Round ID: ${roundId.toString()}`);
    console.log(`   - Initial Global Model CID: ${initialModelCID}`);
    console.log(`   - Block Number: ${event.blockNumber}`);
    console.log("----------------------------------------------------");

    try {
      // 1. Fetch Model (Off-chain)
      console.log(`[1/4] Fetching model from IPFS with CID: ${initialModelCID}...`);
      // In a real scenario, you'd download and load the model file here.

      // 2. Train Model (Off-chain) - SIMULATED
      console.log("[2/4] Training model locally (simulated)...");
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate training time
      const updatedModelContent = `Updated model data by ${trainerSigner.address} for round ${roundId}`;

      // 3. Upload Updated Model to IPFS (Off-chain)
      console.log("[3/4] Uploading updated model to IPFS...");
      const { cid: newModelCID } = await ipfs.add(updatedModelContent);
      console.log(`   - Successfully uploaded. New CID: ${newModelCID.toString()}`);

      // 4. Submit Model to Contract (On-chain)
      console.log(`[4/4] Submitting model CID to the smart contract...`);
      const tx = await contract.submitModel(newModelCID.toString());
      console.log(`   - Transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Successfully submitted model for round ${roundId}!`);

    } catch (error) {
      console.error(`❌ Error during training round ${roundId}:`, error);
    }
  };

  contract.on(roundStartedFilter, listener);

  // Keep the script alive to listen for events
  await new Promise(() => { });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
