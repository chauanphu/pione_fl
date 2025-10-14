// scripts/run-simulation.js
// This script simulates the entire lifecycle of one training round.

import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "hardhatOp",
  chainType: "op",
});

async function main() {
  // --- !! IMPORTANT !! ---
  // --- PASTE THE DEPLOYED CONTRACT ADDRESS HERE ---
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  // ---

  // if (contractAddress === "YOUR_DEPLOYED_CONTRACT_ADDRESS") {
  //   console.error("❌ Error: Please paste the deployed contract address in scripts/run-simulation.js");
  //   return;
  // }

  console.log(`\n▶️  Running simulation on contract at: ${contractAddress}\n`);

  // Get signers to represent different roles
  const [owner, client1, client2, validator1, validator2, validator3] = await ethers.getSigners();
  console.log("Network participants:");
  console.log(`  - Owner/Aggregator: ${owner.address}`);
  console.log(`  - Client 1:         ${client1.address}`);
  console.log(`  - Client 2:         ${client2.address}`);
  console.log(`  - Validator 1:      ${validator1.address}`);
  console.log(`  - Validator 2:      ${validator2.address}`);
  console.log(`  - Validator 3:      ${validator3.address}\n`);

  // Get the contract instance
  const FederatedLearning = await ethers.getContractFactory("FederatedLearningWithValidation");
  const contract = FederatedLearning.attach(contractAddress);


  // --- 1. SETUP PHASE: Authorize participants ---
  console.log("--- PHASE 1: Authorizing Participants ---");
  await contract.connect(owner).authorizeClient(client1.address);
  console.log(`  - Client 1 authorized.`);
  await contract.connect(owner).authorizeClient(client2.address);
  console.log(`  - Client 2 authorized.`);
  await contract.connect(owner).authorizeValidator(validator1.address);
  console.log(`  - Validator 1 authorized.`);
  await contract.connect(owner).authorizeValidator(validator2.address);
  console.log(`  - Validator 2 authorized.`);
  await contract.connect(owner).authorizeValidator(validator3.address);
  console.log(`  - Validator 3 authorized.\n`);


  // --- 2. ROUND INITIALIZATION ---
  console.log("--- PHASE 2: Starting a New Round ---");
  const initialModelCID = "Qm_InitialGlobalModel_v1";
  await contract.connect(owner).startNewRound(initialModelCID);
  console.log(`  - Aggregator started Round 1 with Global Model CID: ${initialModelCID}\n`);


  // --- 3. CLIENT SUBMISSION PHASE ---
  console.log("--- PHASE 3: Clients Submit Local Models ---");
  const client1_CID = "Qm_Client1_LocalModel_Update";
  const client2_CID = "Qm_Client2_LocalModel_Update";

  await contract.connect(client1).submitModel(client1_CID);
  console.log(`  - Client 1 submitted its model update with CID: ${client1_CID}`);

  await contract.connect(client2).submitModel(client2_CID);
  console.log(`  - Client 2 submitted its model update with CID: ${client2_CID}\n`);


  // --- 4. VALIDATION PHASE ---
  console.log("--- PHASE 4: Validators Vote on Submissions ---");

  // Scenario 1: Client 1's model gets approved
  console.log(`  - Voting on Client 1's model (${client1_CID})...`);
  await contract.connect(validator1).validateModel(client1_CID, true);
  console.log("    - Validator 1 voted: APPROVE");
  await contract.connect(validator2).validateModel(client1_CID, true);
  console.log("    - Validator 2 voted: APPROVE");
  let details = await contract.getSubmissionDetails(client1_CID);
  console.log(`  - ✅ Result: Client 1's model is now APPROVED (Votes: ${details[3]}).\n`);

  // Scenario 2: Client 2's model gets rejected
  console.log(`  - Voting on Client 2's model (${client2_CID})...`);
  await contract.connect(validator1).validateModel(client2_CID, true);
  console.log("    - Validator 1 voted: APPROVE");
  await contract.connect(validator3).validateModel(client2_CID, false);
  console.log("    - Validator 3 voted: REJECT");
  details = await contract.getSubmissionDetails(client2_CID);
  console.log(`  - ❌ Result: Client 2's model is now REJECTED.\n`);


  // --- 5. AGGREGATION PHASE ---
  console.log("--- PHASE 5: Aggregator Finalizes the Round ---");
  const approvedSubmissions = await contract.connect(owner).getApprovedSubmissions();
  console.log("  - Aggregator fetches the list of approved model CIDs:");
  console.log("    - ", approvedSubmissions);

  console.log("\n  - Aggregator now proceeds with off-chain aggregation...");
  const newGlobalModelCID = "Qm_NewAggregatedGlobalModel_v2";
  console.log(`  - Aggregator uploads new model and finalizes the round with CID: ${newGlobalModelCID}`);
  await contract.connect(owner).finalizeRound(newGlobalModelCID);

  const finalGlobalModel = await contract.globalModelCID();
  console.log(`\n🏁 ROUND COMPLETE! New global model is: ${finalGlobalModel}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
