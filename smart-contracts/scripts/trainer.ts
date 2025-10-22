// trainer.ts

import { network } from "hardhat";

// --- NEW: Added WebSocket import ---
import WebSocket from 'ws';

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

// --- MODIFIED: Added BACKEND_WS_URL ---
const { CONTRACT_ADDRESS, TRAINER_PRIVATE_KEY, IPFS_API_URL, BACKEND_WS_URL } = process.env;
const MODELS_DIR = path.resolve(__dirname, "../models");


// --- NEW: WebSocket Connection and Registration Logic ---
function connectToBackend(trainerAddress: string) {
    if (!BACKEND_WS_URL) {
        console.warn("⚠️ BACKEND_WS_URL not set. Trainer will run without connecting to the dashboard.");
        return;
    }

    console.log(`Attempting to connect to backend at ${BACKEND_WS_URL}...`);
    const ws = new WebSocket(BACKEND_WS_URL);

    ws.on('open', () => {
        console.log('✅ Connected to backend WebSocket.');
        const registrationMessage = JSON.stringify({
            type: 'register_node',
            address: trainerAddress
        });
        ws.send(registrationMessage);
        console.log(`   - Sent registration as: ${trainerAddress}`);
    });

    ws.on('close', () => {
        console.log('🔌 Disconnected from backend. Attempting to reconnect in 5 seconds...');
        setTimeout(() => connectToBackend(trainerAddress), 5000);
    });

    ws.on('error', (err) => {
        console.error('❌ WebSocket connection error:', err.message);
        // The 'close' event will fire next, triggering the reconnection logic.
    });

    ws.on('message', (data) => {
        // This trainer script does not act on messages from the backend,
        // but we can log them for debugging purposes.
        console.log('📨 Message from backend:', data.toString());
    });
}


// --- Main Service Function ---
async function main() {
  if (!CONTRACT_ADDRESS || !TRAINER_PRIVATE_KEY || !IPFS_API_URL) {
    throw new Error("Please set CONTRACT_ADDRESS, TRAINER_PRIVATE_KEY, and IPFS_API_URL in .env");
  }

  // Pre-flight check for contract deployment...
  console.log(`Checking for contract code at address: ${CONTRACT_ADDRESS}`);
  const code = await ethers.provider.getCode(CONTRACT_ADDRESS);
  if (code === "0x") {
    console.error("----------------------------------------------------");
    console.error(`❌ Error: No contract found at ${CONTRACT_ADDRESS}`);
    console.error("This is likely because you restarted your Hardhat node.");
    console.error("Please re-deploy your contract by running:");
    console.error("npx hardhat run scripts/deploy.ts --network localhost");
    console.error("----------------------------------------------------");
    process.exit(1);
  }
  console.log("✅ Contract code found. Proceeding with the script...");

  await fs.mkdir(MODELS_DIR, { recursive: true });

  const provider = ethers.provider;
  const trainerSigner = new ethers.Wallet(TRAINER_PRIVATE_KEY, provider);
  const contract = await ethers.getContractAt("FederatedLearning", CONTRACT_ADDRESS);
  const ipfs = create({ url: IPFS_API_URL });

  console.log("✅ Trainer Service Initialized");
  console.log(`   - Trainer Address: ${trainerSigner.address}`);
  console.log(`   - Listening on contract: ${await contract.getAddress()}`);

  // --- NEW: Connect to the backend for real-time status updates ---
  connectToBackend(trainerSigner.address);


  console.log("👂 Waiting for 'NewRoundStarted' events from the blockchain...");
  const roundStartedFilter = contract.filters.NewRoundStarted();

  const listener = async (...args: any[]) => {
    const event = args[args.length - 1] as NewRoundStartedEvent.Log;
    let campaignId: bigint;
    let roundId: bigint;
    let initialModelCID: string;

    // --- MODIFIED: The NewRoundStarted event now has 3 arguments ---
    // See FederatedLearning.sol event NewRoundStarted 
    if (args.length === 1 && typeof args[0] === 'object' && args[0].args) {
        const payload = args[0] as ContractEventPayload;
        [campaignId, roundId, initialModelCID] = payload.args;
    } else {
        [campaignId, roundId, initialModelCID] = args;
    }
    
    console.log("\n----------------------------------------------------");
    console.log(`🔔 NewRoundStarted event detected!`);
    console.log(`   - Campaign ID: ${campaignId.toString()}`);
    console.log(`   - Round Number: ${roundId.toString()}`);
    console.log(`   - Initial Global Model CID: ${initialModelCID}`);
    console.log(`   - Block Number: ${event.blockNumber}`);
    console.log("----------------------------------------------------");

    try {
      console.log(`[1/4] Fetching model from IPFS with CID: ${initialModelCID}...`);
      // Simulation: no actual download

      console.log("[2/4] Training model locally (simulated)...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      const updatedModelContent = `Updated model data by ${trainerSigner.address} for campaign ${campaignId} round ${roundId}`;

      console.log("[3/4] Uploading updated model to IPFS...");
      const { cid: newModelCID } = await ipfs.add(updatedModelContent);
      console.log(`   - Successfully uploaded. New CID: ${newModelCID.toString()}`);

      // --- MODIFIED: Calling the submitModel function which is external ---
      // from the FederatedLearning.sol contract [cite: 41]
      console.log(`[4/4] Submitting model CID to the smart contract...`);
      const tx = await contract.connect(trainerSigner).submitModel(newModelCID.toString());
      console.log(`   - Transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Successfully submitted model for round ${roundId}!`);

    } catch (error) {
      console.error(`❌ Error during training round ${roundId}:`, error);
    }
  };

  contract.on(roundStartedFilter, listener);

  await new Promise(() => { });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});