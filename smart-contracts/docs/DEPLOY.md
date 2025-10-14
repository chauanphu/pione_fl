# Scripts for Deployment and Simulation

This directory contains the necessary scripts to deploy the FederatedLearningWithValidation smart contract and simulate a full training round.
Files
- deploy.js: This script deploys the smart contract to the specified blockchain network. It requires a validationThreshold to be set, which determines how many validator approvals are needed for a model submission. Upon successful deployment, it will print the contract's address to the console.
- run-simulation.js: This is a comprehensive script that simulates the end-to-end workflow of one federated learning round. It demonstrates how different roles (owner, client, validator) interact with the deployed smart contract.

## How to Run the Simulation

Follow these steps in your terminal from the project's root directory.
### Step 1: Start a Local Blockchain

Hardhat provides a local Ethereum network that is perfect for development and testing.
```bash
npx hardhat node
```
This command will start the node and list several accounts with their private keys and balances. Keep this terminal window open.

### Step 2: Deploy the Smart Contract

Open a new terminal window and run the deployment script. We need to specify that we are deploying to our local network.
```bash
npx hardhat run scripts/deploy.js --network localhost
```
The script will output the address of the newly deployed contract. Copy this address.

### Step 3: Configure the Simulation Script

Open the scripts/run-simulation.js file in your code editor. Find the following line and paste the contract address you copied from the previous step:
```bash
// Before
const contractAddress = "YOUR_DEPLOYED_CONTRACT_ADDRESS";

// After
const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Example address
```
### Step 4: Run the Simulation

Now, execute the simulation script in the same terminal you used for deployment.
```bash
npx hardhat run scripts/run-simulation.js --network localhost
```
The script will run through all the phases: authorizing participants, starting a round, client submissions, validator voting, and final aggregation. It will print detailed logs to the console, allowing you to see the on-chain state changes at every step.