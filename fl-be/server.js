// server.js
import 'dotenv/config'; // Use ESM way to load dotenv
import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';
import { create } from 'kubo-rpc-client';
import axios from 'axios';
import fs from 'fs-extra';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // Import multer for file uploads

// --- ESM doesn't have a global __dirname, so we create it ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Load the ABI from the provided file ---
// Note the 'assert' keyword, which is the standard way to import JSON in ESM
import contractArtifact from './abi.json' with { type: 'json' };
const contractABI = contractArtifact.abi;

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const {
    RPC_URL,
    ADMIN_PRIVATE_KEY,
    CONTRACT_ADDRESS,
    IPFS_API_URL,
    ML_SERVICE_URL,
    API_CALLBACK_URL
} = process.env;

if (!RPC_URL || !ADMIN_PRIVATE_KEY || !CONTRACT_ADDRESS || !IPFS_API_URL || !ML_SERVICE_URL || !API_CALLBACK_URL) {
    throw new Error("Missing required environment variables! Check all required vars in .env file.");
}

// --- Service Clients Setup ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const flContract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, adminWallet);

const ipfs = create({ url: IPFS_API_URL });

// --- Multer Setup for file uploads ---
const upload = multer({ storage: multer.memoryStorage() });


console.log(`✅ Connected to contract at ${CONTRACT_ADDRESS}`);
console.log(`✅ Connected to IPFS node at ${IPFS_API_URL}`);
console.log(`✅ ML Service URL set to ${ML_SERVICE_URL}`);


// --- EVETNS ---


// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Helper Functions ---
const mapRoundState = (state) => {
    const states = ['INACTIVE', 'SUBMISSION', 'VALIDATION', 'AGGREGATION'];
    return states[Number(state)] || 'Unknown';
};

// --- Main FL Orchestration Endpoints ---
// --- Automated Aggregation Logic ---

/**
 * Handles the core aggregation logic when triggered by a blockchain event.
 * @param {string} round The round number to process.
 */
async function handleAggregationState(round) {
    const roundId = `round_${round.toString()}`;
    console.log(`Aggregation state detected for ${roundId}. Starting process.`);
    try {
        // 1. Create a temporary directory for this round's models
        const modelsDir = path.join(__dirname, 'temp_models', roundId);
        await fs.ensureDir(modelsDir);
        console.log(`Created temporary directory: ${modelsDir}`);

        // 2. Get the list of valid model CIDs from the smart contract
        const modelCIDs = await flContract.getValidModelsForCurrentRound();
        if (modelCIDs.length === 0) {
            console.warn(`AUTOMATION: No valid models to aggregate for ${roundId}.`);
            return;
        }
        console.log(`AUTOMATION: Found ${modelCIDs.length} valid models to download.`);

        // 3. Download each model from IPFS
        for (const [index, cid] of modelCIDs.entries()) {
            const filePath = path.join(modelsDir, `local_model_${index}.h5`);
            const fileStream = fs.createWriteStream(filePath);
            const ipfsStream = ipfs.cat(cid);
            for await (const chunk of ipfsStream) {
                fileStream.write(chunk);
            }
            fileStream.end();
            console.log(`AUTOMATION: Downloaded model ${cid}`);
        }

        // 4. Trigger the Python ML service
        const mlPayload = {
            roundId: roundId,
            models_directory: modelsDir,
            callback_url: API_CALLBACK_URL
        };
        console.log("AUTOMATION: Sending request to ML service:", mlPayload);
        await axios.post(`${ML_SERVICE_URL}/aggregate`, mlPayload);
    } catch (error) {
        console.error(`AUTOMATION: Error during aggregation for ${roundId}:`, error.message);
    }
}

function initializeEventListeners() {
    console.log("🎧 Initializing blockchain event listeners...");

    flContract.on("RoundStateChanged", (roundId, newStateEnum) => {
        const newState = mapRoundState(newStateEnum);
        console.log(`🔔 Event Received: Round ${roundId} changed state to -> ${newState}`);

        // If the new state is 'Aggregation', automatically trigger the ML workflow
        if (newState === 'AGGREGATION') {
            handleAggregationState(roundId);
        }
    });

    console.log("✅ Event listeners initialized.");
}

app.get('/api/status', async (req, res) => {
    try {
        const currentRound = await flContract.currentRound();
        const globalModelCID = await flContract.globalModelCID();
        const roundState = await flContract.currentRoundState();

        res.json({
            round: currentRound.toString(),
            cid: globalModelCID,
            state: mapRoundState(roundState),
        });
    } catch (error) {
        console.error("Error fetching status:", error.message);
        res.status(500).json({ error: "Failed to fetch status from the blockchain." });
    }
});

/**
 * @route   POST /api/upload-initial-model
 * @desc    Uploads a model file to IPFS to get a CID for starting round 1.
 * @access  Public
 */
app.post('/api/upload', upload.single('modelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No model file was uploaded. Please use the 'modelFile' field." });
    }
    console.log(`Received initial model file: ${req.file.originalname}`);
    try {
        // 1. Upload to IPFS
        const { cid } = await ipfs.add(req.file.buffer);
        const newCID = cid.toString();
        console.log(`Initial model uploaded to IPFS. CID: ${newCID}`);

        // 2. Set the CID on the smart contract
        console.log(`Setting global model CID on the smart contract...`);
        const tx = await flContract.setGlobalModelCID(newCID);
        await tx.wait(); // Wait for transaction confirmation
        console.log(`✅ Global model CID set successfully. TxHash: ${tx.hash}`);

        res.status(201).json({
            success: true,
            message: "Initial model uploaded and set as global model on the blockchain.",
            initialModelCID: newCID,
            txHash: tx.hash
        });
    } catch (error) {
        console.error("Error setting initial model:", error.message);
        res.status(500).json({ error: "Failed to set the initial model." });
    }
});


/**
 * @route   POST /api/start-training-process
 * @desc    The single endpoint to initiate a new training round.
 * The server will then listen for the 'Aggregation' state to proceed automatically.
 */
app.post('/api/train', async (req, res) => {
    console.log(`Request to start a new training round...`);
    try {
        const tx = await flContract.startNewRound(); // No longer requires a CID
        await tx.wait();
        const round = await flContract.currentRound();
        res.status(201).json({
            success: true,
            txHash: tx.hash,
            message: `Training round ${round.toString()} started. The server will now monitor for the aggregation phase.`
        });
    } catch (error) {
        console.error("Error starting new round:", error.message);
        res.status(500).json({ error: "Failed to start a new training round." });
    }
});

/**
 * @route   POST /api/aggregation-complete
 * @desc    Callback endpoint for the ML service to report completion.
 */
app.post('/api/aggregated', async (req, res) => {
    const { roundId, status, aggregated_model_path, message } = req.body;
    console.log(`Received callback for ${roundId} with status: ${status}`);

    if (status === 'error') {
        console.error(`Aggregation failed for ${roundId}: ${message}`);
        return res.status(200).send();
    }

    try {
        const modelData = await fs.readFile(aggregated_model_path);
        const { cid: newGlobalModelCID } = await ipfs.add(modelData);
        console.log(`New global model for ${roundId} uploaded to IPFS. CID: ${newGlobalModelCID.toString()}`);

        console.log(`Finalizing ${roundId} on the blockchain with new CID...`);
        const tx = await flContract.finalizeRound(newGlobalModelCID.toString());
        await tx.wait();
        console.log(`✅ Transaction confirmed! Round ${roundId} finalized. TxHash: ${tx.hash}`);

        const modelsDir = path.join(__dirname, 'temp_models', roundId);
        await fs.remove(modelsDir);
        await fs.remove(aggregated_model_path);
        console.log(`Cleaned up temporary files for ${roundId}.`);

        res.status(200).json({ success: true, newGlobalModelCID: newGlobalModelCID.toString() });

    } catch (error) {
        console.error(`Error in aggregation-complete callback for ${roundId}:`, error.message);
        res.status(200).json({ error: "Internal server error during finalization." });
    }
});

app.get('/api/global-models-history', async (req, res) => {
    try {
        // Create a filter for the "RoundFinalized" event
        const filter = flContract.filters.RoundFinalized();

        // Query the blockchain from the first block to the latest for all matching events
        const events = await flContract.queryFilter(filter, 0, 'latest');

        // Map the event data to the desired {round, cid} format
        const history = events.map(event => ({
            round: event.args.roundId.toString(),
            cid: event.args.newGlobalModelCID,
            block_hash: event.blockHash,
            transaction_hash: event.transactionHash
        }));

        res.json(history);
    } catch (error) {
        console.error("Error fetching global model history:", error.message);
        res.status(500).json({ error: "Failed to fetch model history." });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    initializeEventListeners();
    console.log(`✅ Backend server running at http://localhost:${PORT}`);
});