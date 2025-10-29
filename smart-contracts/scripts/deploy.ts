import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();

  const [deployer] = await connection.ethers.getSigners();

  console.log(`Deploying contract with the account: ${deployer.address}`);

  const contractFactory = await connection.ethers.getContractFactory("FederatedLearning");
  const contract = await contractFactory.deploy(deployer.address);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`✅ FederatedLearning contract deployed to: ${contractAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
