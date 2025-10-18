import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "localhost",
  chainType: "l1",
});

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contract with the account: ${deployer.address}`);

  const contractFactory = await ethers.getContractFactory("FederatedLearning");
  const contract = await contractFactory.deploy(deployer.address);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`✅ FederatedLearning contract deployed to: ${contractAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
