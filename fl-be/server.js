// server.js
require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');

// --- Load the ABI from the provided file ---
const contractArtifact = require('./abi.json'); // Assumes abi.json is in the same directory
const contractABI = contractArtifact.abi;

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const { RPC_URL, ADMIN_PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

if (!RPC_URL || !ADMIN_PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing required environment variables!");
}

// --- Ethers.js Setup ---
const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const flContract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, adminWallet);

console.log(`Connected to contract at ${CONTRACT_ADDRESS} as admin ${adminWallet.address}`);

// --- Express App Setup ---
const app = express();
app.use(cors()); // Allow requests from our React frontend
app.use(express.json());

// Helper to map the enum state to a readable string
const mapRoundState = (state) => {
    // These states are inferred from the contract logic. Adjust if your enum differs.
    const states = ['Idle', 'Submission', 'Validation', 'Aggregation', 'Finalized'];
    return states[Number(state)] || 'Unknown';
};


// --- API Endpoints ---

/**
 * @route   GET /api/status
 * @desc    Gets the current training round, global model CID, and round state.
 */
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
 * @route   GET /api/valid-models
 * @desc    Gets the list of validly submitted models for the current round.
 */
app.get('/api/valid-models', async (req, res) => {
    try {
        const models = await flContract.getValidModelsForCurrentRound();
        res.json(models);
    } catch (error) {
        console.error("Error fetching valid models:", error.message);
        res.status(500).json({ error: "Failed to fetch valid models." });
    }
});

/**
 * @route   POST /api/start-round
 * @desc    Triggers a new training round with an initial model CID.
 */
app.post('/api/start-round', async (req, res) => {
    const { initialModelCID } = req.body;
    if (!initialModelCID) {
        return res.status(400).json({ error: "initialModelCID is required." });
    }
    console.log(`Request to start new round with CID: ${initialModelCID}`);
    try {
        // Call the 'startNewRound' function with the required CID argument
        const tx = await flContract.startNewRound(initialModelCID);
        console.log(`Transaction sent! Hash: ${tx.hash}`);
        await tx.wait();
        console.log("Transaction confirmed!");
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error starting new round:", error.message);
        res.status(500).json({ error: "Failed to start a new training round." });
    }
});

/**
 * @route   POST /api/advance-state
 * @desc    Advances the round to its next state (e.g., Submission -> Validation).
 */
app.post('/api/advance-state', async (req, res) => {
    console.log("Request to advance round state...");
    try {
        const tx = await flContract.advanceRoundState();
        console.log(`Transaction sent! Hash: ${tx.hash}`);
        await tx.wait();
        console.log("Transaction confirmed!");
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error advancing round state:", error.message);
        res.status(500).json({ error: "Failed to advance round state." });
    }
});

/**
 * @route   POST /api/finalize-round
 * @desc    Finalizes the round with the new aggregated global model CID.
 */
app.post('/api/finalize-round', async (req, res) => {
    const { newGlobalModelCID } = req.body;
    if (!newGlobalModelCID) {
        return res.status(400).json({ error: "newGlobalModelCID is required." });
    }
    console.log(`Request to finalize round with new CID: ${newGlobalModelCID}`);
    try {
        const tx = await flContract.finalizeRound(newGlobalModelCID);
        console.log(`Transaction sent! Hash: ${tx.hash}`);
        await tx.wait();
        console.log("Transaction confirmed!");
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error finalizing round:", error.message);
        res.status(500).json({ error: "Failed to finalize round." });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`✅ Backend server running at http://localhost:${PORT}`);
});