// scripts/deploy.ts

import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "hardhatOp",
  chainType: "op",
});

async function main(): Promise<void> {
  console.log("Preparing to deploy FederatedLearningWithValidation contract...");

  // The address of the contract owner/aggregator will be the first account from Hardhat's accounts list.
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contract with the account:", deployer.address);
  // We need to set a validation threshold upon deployment.
  // Let's say we require 2 validator approvals for a model to be accepted.
  const validationThreshold: number = 2;
  console.log(`Setting validation threshold to: ${validationThreshold}`);

  const FederatedLearning = await ethers.getContractFactory("FederatedLearningWithValidation");
  const federatedLearning = await FederatedLearning.deploy(validationThreshold);

  await federatedLearning.waitForDeployment();

  console.log("\n----------------------------------------------------");
  console.log(`✅ Contract deployed successfully!`);
  console.log(`📜 Contract Address: ${await federatedLearning.getAddress()}`);
  console.log("----------------------------------------------------\n");
  console.log("You can now use this address in the simulation script (scripts/run-simulation.js)");
}

main().catch((error: Error) => {
  console.error(error);
  process.exitCode = 1;
});