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
const clients = new Set(); // Keep track of all connected clients

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
        const [currentRound, globalModelCID, roundState, events] = await Promise.all([
            flContract.currentRound(),
            flContract.globalModelCID(),
            flContract.currentRoundState(),
            flContract.queryFilter(flContract.filters.RoundFinalized(), 0, 'latest')
        ]);

        const history = events.map(event => ({
            round: event.args.roundId.toString(),
            cid: event.args.newGlobalModelCID,
        }));

        return {
            status: {
                round: currentRound.toString(),
                cid: globalModelCID,
                state: mapRoundState(roundState),
            },
            history,
        };
    } catch (error) {
        console.error("Error fetching system state:", error);
        // Return a default error state if blockchain query fails
        return {
            status: { round: 'N/A', cid: '', state: 'Error' },
            history: []
        };
    }
};

/**
 * --- NEW HELPER ---
 * Broadcasts the latest system state to all connected WebSocket clients.
 */
const broadcastUpdate = async () => {
    console.log(`Broadcasting update to ${clients.size} clients...`);
    const systemState = await getSystemState();
    const message = JSON.stringify(systemState);
    clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
};

// --- NEW: WebSocket Connection Logic ---
wss.on('connection', (ws) => {
    console.log('🔌 New client connected.');
    clients.add(ws);

    // Immediately send the current state to the newly connected client
    broadcastUpdate();

    ws.on('close', () => {
        console.log('🔌 Client disconnected.');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});


// --- Automated Aggregation Logic ---
async function handleAggregationState(round) {
    const roundId = `round_${round.toString()}`;
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
    flContract.on("RoundStateChanged", (roundId, newStateEnum) => {
        const newState = mapRoundState(newStateEnum);
        console.log(`🔔 Event Received: Round ${roundId} changed state to -> ${newState}`);

        // --- MODIFICATION: Broadcast updates on state change ---
        broadcastUpdate();

        if (newState === 'AGGREGATION') {
            handleAggregationState(roundId);
        }
    });
    console.log("✅ Event listeners initialized.");
}


// --- API Endpoints ---
// NOTE: We no longer need the /status or /global-models-history endpoints for the frontend,
// as this data is now pushed via WebSockets. They can be kept for other purposes or removed.

app.post('/api/upload', upload.single('modelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No model file was uploaded." });
    }
    console.log(`Received initial model file: ${req.file.originalname}`);
    try {
        const { cid } = await ipfs.add(req.file.buffer);
        const newCID = cid.toString();
        const tx = await flContract.setGlobalModelCID(newCID);
        await tx.wait();
        console.log(`✅ Global model CID set successfully. TxHash: ${tx.hash}`);

        // --- MODIFICATION: Broadcast update after action ---
        broadcastUpdate();

        res.status(201).json({
            success: true,
            initialModelCID: newCID,
            txHash: tx.hash
        });
    } catch (error) {
        console.error("Error setting initial model:", error.message);
        res.status(500).json({ error: "Failed to set the initial model." });
    }
});

app.post('/api/train', async (req, res) => {
    console.log(`Request to start a new training round...`);
    try {
        const tx = await flContract.startNewRound();
        await tx.wait();

        // --- MODIFICATION: Broadcast update after action ---
        broadcastUpdate();

        res.status(201).json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error starting new round:", error.message);
        res.status(500).json({ error: "Failed to start a new training round." });
    }
});

app.post('/api/cancel', async (req, res) => {
    console.log(`Request to cancel the current training round...`);
    try {
        const tx = await flContract.cancelRound();
        await tx.wait();
        console.log(`✅ Round cancelled successfully. TxHash: ${tx.hash}`);

        // --- MODIFICATION: Broadcast update after action ---
        broadcastUpdate();

        res.status(200).json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error cancelling round:", error.message);
        res.status(500).json({ error: "Failed to cancel the training round." });
    }
});

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
        const tx = await flContract.finalizeRound(newGlobalModelCID.toString());
        await tx.wait();
        console.log(`✅ Round ${roundId} finalized. TxHash: ${tx.hash}`);

        // --- MODIFICATION: Broadcast update after action ---
        broadcastUpdate();

        // Cleanup
        const modelsDir = path.join(__dirname, 'temp_models', roundId);
        await fs.remove(modelsDir);
        await fs.remove(aggregated_model_path);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error(`Error in aggregation-complete callback for ${roundId}:`, error.message);
        res.status(200).json({ error: "Internal server error during finalization." });
    }
});


// --- Start Server ---
// --- MODIFICATION: Use the http 'server' to listen, not the express 'app' ---
server.listen(PORT, () => {
    initializeEventListeners();
    console.log(`✅ Backend server and WebSocket running at http://localhost:${PORT}`);
});