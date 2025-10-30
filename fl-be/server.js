// server.js
import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';
import { create } from 'kubo-rpc-client';
import axios from 'axios';
import fs from 'fs-extra';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
// --- NEW IMPORTS: Added http and ws for WebSocket server ---
import http from 'http';
import { WebSocketServer } from 'ws';


// --- ESM __dirname Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- ABI Import ---
import contractArtifact from './abi.json' with { type: 'json' };
const contractABI = contractArtifact.abi;

// Check if ABI is loaded correctly
if (!contractABI) {
    throw new Error("Contract ABI could not be loaded. Please check the abi.json file.");
} else {
    console.log("✅ Contract ABI loaded successfully.");
}

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
    throw new Error("Missing required environment variables!");
}

// --- Service Clients Setup ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const flContract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, adminWallet);
const ipfs = create({ url: IPFS_API_URL });
const upload = multer({ storage: multer.memoryStorage() });

console.log(`✅ Connected to contract at ${CONTRACT_ADDRESS}`);
console.log(`✅ Connected to blockchain via ${RPC_URL}`);
console.log(`✅ Connected to Admin Wallet ${adminWallet.address}`);
console.log(`✅ Connected to IPFS node at ${IPFS_API_URL}`);
console.log(`✅ ML Service URL set to ${ML_SERVICE_URL}`);

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- MODIFICATION: Create an HTTP server from the Express app ---
const server = http.createServer(app);

// --- NEW: WebSocket Server Setup ---
const wss = new WebSocketServer({ server });
const trainingNodes = new Map();    // Stores WebSocket connections and their public addresses for nodes
const dashboardClients = new Set(); // Stores WebSocket connections for UI clients

// --- NEW: Training Round Submission State Management ---
// Structure: { campaignId: { round: { nodeAddress: true } } }
const roundSubmissions = new Map();

console.log("✅ WebSocket server initialized.");


// --- Helper Functions ---
const mapRoundState = (state) => {
    const states = ['INACTIVE', 'SUBMISSION', 'VALIDATION', 'AGGREGATION'];
    return states[Number(state)] || 'Unknown';
};

/**
 * --- NEW HELPER ---
 * Fetches the current system state (status and history) from the blockchain.
 * This will be broadcast to all WebSocket clients.
 */
const getSystemState = async () => {
    try {
        const activeCampaignId = await flContract.activeCampaignId();
        const participants = Array.from(trainingNodes.values());

        // --- NEW: Fetch all CampaignStateChanged events for state history ---
        const stateChangeEvents = await flContract.queryFilter(flContract.filters.CampaignStateChanged(), 0, 'latest');
        const stateHistory = await Promise.all(stateChangeEvents.map(async (event) => {
            const block = await event.getBlock();
            return {
                campaignId: event.args.campaignId.toString(),
                newState: mapRoundState(event.args.newState),
                txHash: event.transactionHash,
                timestamp: block.timestamp,
            };
        }));

        // --- NEW: Fetch all RoundFinalized events for model history ---
        const finalizedEvents = await flContract.queryFilter(flContract.filters.GlobalModelChanged(), 0, 'latest');
        const finalizedHistory = await Promise.all(finalizedEvents.map(async (event) => {
            const block = await event.getBlock();
            return {
                campaignId: event.args.campaignId.toString(),
                round: event.args.round.toString(),
                cid: event.args.finalGlobalModelCID,
                state: event.args.state,
                txHash: event.transactionHash,
                timestamp: block.timestamp,
            };
        }));

        // Handle case where no campaign is active
        if (activeCampaignId === 0n) {
            return {
                status: { campaign: 'N/A', round: 'N/A', cid: '', state: 'INACTIVE' },
                stateHistory: stateHistory.reverse(),      // Show newest first
                modelHistory: finalizedHistory.reverse(), // Show newest first
                participants,
                submissions: {} // No submissions when no campaign is active
            };
        }

        const campaign = await flContract.campaigns(activeCampaignId);
        const campaignIdStr = activeCampaignId.toString();
        
        // --- NEW: Get submissions for current round ---
        let currentRoundSubmissions = {};
        if (roundSubmissions.has(campaignIdStr)) {
            const campaignSubs = roundSubmissions.get(campaignIdStr);
            const roundStr = campaign.currentRound.toString();
            if (campaignSubs.has(roundStr)) {
                currentRoundSubmissions = Object.fromEntries(campaignSubs.get(roundStr));
            }
        }

        return {
            status: {
                campaign: campaignIdStr,
                round: campaign.currentRound.toString(),
                cid: campaign.globalModelCID,
                state: mapRoundState(campaign.state),
            },
            stateHistory: stateHistory.reverse(),      // Show newest first
            modelHistory: finalizedHistory.reverse(), // Show newest first
            participants,
            submissions: currentRoundSubmissions // Map of nodeAddress: true for submitted nodes
        };
    } catch (error) {
        console.error("Error fetching system state:", error);
        return {
            status: { campaign: 'N/A', round: 'N/A', cid: '', state: 'Error' },
            stateHistory: [],
            finalizedHistory: [],
            participants: [],
            submissions: {}
        };
    }
};

/**
 * --- NEW HELPER ---
 * Broadcasts the latest system state to all connected WebSocket clients.
 */
const broadcastUpdate = async () => {
    // Only broadcast if there are dashboard clients to update
    if (dashboardClients.size === 0) return;

    console.log(`Broadcasting update to ${dashboardClients.size} dashboard clients...`);
    const systemState = await getSystemState();
    const message = JSON.stringify(systemState, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );

    dashboardClients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
};

// --- NEW: WebSocket Connection Logic ---
wss.on('connection', (ws) => {
    console.log('🔌 New client connected. Awaiting registration...');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // --- NEW: Differentiate registration type ---
            if (data.type === 'register_node' && data.address) {
                console.log(`✅ Registered training node: ${data.address}`);
                // If already exist data.address, delete previous one
                for (const [key, value] of trainingNodes.entries()) {
                    if (value === data.address) {
                        trainingNodes.delete(key);
                        console.log(`♻️ Removed previous connection for address: ${data.address}`);
                        break;
                    }
                }
                trainingNodes.set(ws, data.address);
                broadcastUpdate(); // Notify dashboards of the new participant
            } else if (data.type === 'register_dashboard') {
                console.log('✅ Registered dashboard client.');
                dashboardClients.add(ws);
                // Immediately send the current state to the new dashboard
                getSystemState().then(state => ws.send(JSON.stringify(state, (_, value) =>
                    typeof value === 'bigint' ? value.toString() : value
                )));
            } else {
                console.log("Unknown type:", data.type)
            }
        } catch (e) {
            console.error('Failed to parse message or invalid message format.');
        }
    });

    ws.on('close', () => {
        // --- NEW: Check which type of client disconnected ---
        if (trainingNodes.has(ws)) {
            const address = trainingNodes.get(ws);
            trainingNodes.delete(ws);
            console.log(`🔌 Training node disconnected: ${address}`);
            broadcastUpdate(); // Notify dashboards that a participant has left
        } else if (dashboardClients.has(ws)) {
            dashboardClients.delete(ws);
            console.log('🔌 Dashboard client disconnected.');
        } else {
            console.log('🔌 Unregistered client disconnected.');
        }
    });

    ws.on('error', (error) => { console.error('WebSocket error:', error); });
});


// --- Automated Aggregation Logic ---
async function handleAggregationState(campaignId, round) {
    const roundId = `campaign_${campaignId}_round_${round.toString()}`;
    console.log(`Aggregation state detected for ${roundId}. Starting process.`);
    try {
        const modelsDir = path.join(__dirname, 'temp_models', roundId);
        await fs.ensureDir(modelsDir);
        const modelCIDs = await flContract.getValidModelsForCurrentRound();
        if (modelCIDs.length === 0) {
            console.warn(`AUTOMATION: No valid models to aggregate for ${roundId}.`);
            return;
        }
        console.log(`AUTOMATION: Found ${modelCIDs.length} valid models.`);

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

        const mlPayload = {
            roundId: roundId,
            models_directory: modelsDir,
            callback_url: API_CALLBACK_URL
        };
        await axios.post(`${ML_SERVICE_URL}/aggregate`, mlPayload);
    } catch (error) {
        console.error(`AUTOMATION: Error during aggregation for ${roundId}:`, error.message);
    }
}

// --- Event Listener Setup ---
function initializeEventListeners() {
    console.log("🎧 Initializing blockchain event listeners...");
    flContract.on("CampaignStateChanged", async (campaignId, newStateEnum) => {
        const newState = mapRoundState(newStateEnum);
        console.log(`🔔 Event Received: Campaign ${campaignId} changed state to -> ${newState}`);

        broadcastUpdate();

        if (newState === 'AGGREGATION') {
            // Fetch the current round from the campaign struct when aggregation starts
            const campaign = await flContract.campaigns(campaignId);
            handleAggregationState(campaignId, campaign.currentRound);
        }
    });

    // --- NEW: Listen for NewRoundStarted event to reset submissions ---
    flContract.on("NewRoundStarted", async (campaignId, round, initialModelCID) => {
        const campaignIdStr = campaignId.toString();
        const roundStr = round.toString();
        console.log(`🔄 Event Received: New round started for campaign ${campaignIdStr}, round ${roundStr}`);
        
        // Reset submissions for the new round
        if (roundSubmissions.has(campaignIdStr)) {
            const campaignSubs = roundSubmissions.get(campaignIdStr);
            campaignSubs.delete(roundStr);
        }
        
        broadcastUpdate();
    });

    // --- NEW: Listen for ModelSubmitted events from smart contract ---
    flContract.on("ModelSubmitted", async (campaignId, round, trainer, modelCID) => {
        const campaignIdStr = campaignId.toString();
        const roundStr = round.toString();
        const trainerAddress = trainer;
        
        console.log(`📤 Event Received: Training node ${trainerAddress} submitted model for campaign ${campaignIdStr} round ${roundStr}`);
        console.log(`   Model CID: ${modelCID}`);
        
        // Initialize campaign submissions if not exists
        if (!roundSubmissions.has(campaignIdStr)) {
            roundSubmissions.set(campaignIdStr, new Map());
        }
        
        const campaignSubs = roundSubmissions.get(campaignIdStr);
        
        // Initialize round submissions if not exists
        if (!campaignSubs.has(roundStr)) {
            campaignSubs.set(roundStr, new Map());
        }
        
        const roundSubs = campaignSubs.get(roundStr);
        roundSubs.set(trainerAddress, true);
        
        // Broadcast update to all dashboard clients
        broadcastUpdate();
    });

    console.log("✅ Event listeners initialized.");
}

app.post('/api/upload', upload.single('modelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No model file was uploaded." });
    }
    console.log(`Received initial model file: ${req.file.originalname}`);
    try {
        console.log(`Sending to IPFS...`);
        const { cid } = await ipfs.add(req.file.buffer);
        const newCID = cid.toString();
        console.log(`✅ Uploaded to IPFS. CID: ${newCID}`);

        res.status(201).json({ success: true, initialModelCID: newCID });
    } catch (error) {
        console.error("Error uploading initial model:", error);
        res.status(500).json({ error: "Failed to upload the initial model to IPFS." });
    }
});

app.post('/api/train', async (req, res) => {
    const {
        participants,       // array of addresses
        totalRounds,        // number
        initialModelCID,    // string
        submissionPeriod,   // number (in seconds)
        minSubmissions      // number
    } = req.body;

    console.log(`Request to create a new training campaign...`);

    // Basic validation
    if (!participants || !totalRounds || !initialModelCID || !submissionPeriod || !minSubmissions) {
        return res.status(400).json({ error: "Missing required parameters for creating a campaign." });
    }

    try {
        const tx = await flContract.createTrainingCampaign(
            participants,
            totalRounds,
            initialModelCID,
            submissionPeriod,
            minSubmissions
        );
        await tx.wait();
        console.log(`✅ New campaign created successfully. TxHash: ${tx.hash}`);

        broadcastUpdate();

        res.status(201).json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error creating new training campaign:", error.message);
        res.status(500).json({ error: "Failed to create a new training campaign." });
    }
});

app.post('/api/cancel', async (req, res) => {
    console.log(`Request to cancel the active campaign...`);
    try {
        const tx = await flContract.cancelCampaign();
        await tx.wait();
        console.log(`✅ Campaign cancelled successfully. TxHash: ${tx.hash}`);

        broadcastUpdate();

        res.status(200).json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error cancelling campaign:", error.message);
        res.status(500).json({ error: "Failed to cancel the campaign." });
    }
});

app.post('/api/aggregated', async (req, res) => {
    // The incoming roundId from the ML service should be in the format:
    // `campaign_${campaignId}_round_${round}`
    const { roundId, status, aggregated_model_path, message } = req.body;
    console.log(`Received callback for ${roundId} with status: ${status}`);

    if (status === 'error') {
        console.error(`Aggregation failed for ${roundId}: ${message}`);
        // We just acknowledge the request. Error handling could be more robust,
        // e.g., retrying or notifying an admin.
        return res.status(200).send();
    }
    try {
        const modelData = await fs.readFile(aggregated_model_path);
        const { cid: newGlobalModelCID } = await ipfs.add(modelData);

        // This function call remains the same, as the contract's internal state
        // knows which campaign and round is active and in the AGGREGATION phase.
        const tx = await flContract.finalizeRound(newGlobalModelCID.toString());
        await tx.wait();
        console.log(`✅ Round finalized for ${roundId}. TxHash: ${tx.hash}`);

        broadcastUpdate();

        // Cleanup
        const modelsDir = path.join(__dirname, 'temp_models', roundId);
        await fs.remove(modelsDir);
        await fs.remove(aggregated_model_path);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error(`Error in aggregation-complete callback for ${roundId}:`, error.message);
        // Acknowledge the request even on failure to prevent the ML service from retrying.
        res.status(200).json({ error: "Internal server error during finalization." });
    }
});

// --- NEW: Manual aggregation trigger endpoint ---
app.post('/api/aggregate', async (req, res) => {
    try {
        const activeCampaignId = await flContract.activeCampaignId();
        if (activeCampaignId === 0n) {
            return res.status(400).json({ error: 'No active campaign to aggregate.' });
        }

        // Fetch current campaign state/round
        let campaign = await flContract.campaigns(activeCampaignId);
        const state = campaign.state; // enum: 0 INACTIVE, 1 SUBMISSION, 2 VALIDATION, 3 AGGREGATION
        let txHash = undefined;

        if (state === 0n) {
            return res.status(400).json({ error: 'Campaign is inactive.' });
        }

        // If still in SUBMISSION, try to move to AGGREGATION first
        if (state === 1n) {
            try {
                const tx = await flContract.attemptAggregation();
                await tx.wait();
                txHash = tx.hash;
                console.log(`✅ attemptAggregation mined. TxHash: ${tx.hash}`);
                await broadcastUpdate();
            } catch (err) {
                // Surface revert reason if present
                console.error('attemptAggregation failed:', err?.message || err);
                return res.status(400).json({ error: 'Aggregation conditions not met or on-chain call failed.' });
            }
            // Refresh campaign after state change
            campaign = await flContract.campaigns(activeCampaignId);
        }

        // If now in AGGREGATION, kick off ML service aggregation proactively
        if (campaign.state === 3n) {
            await handleAggregationState(activeCampaignId, campaign.currentRound);
            return res.status(200).json({ success: true, txHash, message: 'Aggregation started. Finalization will occur after ML callback.' });
        }

        // Any other state (e.g., VALIDATION) is not supported by this simplified flow
        return res.status(409).json({ error: 'Campaign is not ready for aggregation.' });
    } catch (error) {
        console.error('Error handling /api/aggregate:', error?.message || error);
        return res.status(500).json({ error: 'Internal server error while triggering aggregation.' });
    }
});


// --- Start Server ---
// --- MODIFICATION: Use the http 'server' to listen, not the express 'app' ---
server.listen(PORT, () => {
    initializeEventListeners();
    console.log(`✅ Backend server and WebSocket running at http://localhost:${PORT}`);
});