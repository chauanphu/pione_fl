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

  // --- Automatically update .env file ---
  // const envPath = path.resolve(__dirname, "../.env");
  // if (fs.existsSync(envPath)) {
  //   let envContent = fs.readFileSync(envPath, "utf-8");
  //   if (envContent.includes("CONTRACT_ADDRESS")) {
  //     envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS="${contractAddress}"`);
  //   } else {
  //     envContent += `\nCONTRACT_ADDRESS="${contractAddress}"`;
  //   }
  //   fs.writeFileSync(envPath, envContent);
  //   console.log(`✅ Updated CONTRACT_ADDRESS in .env file`);
  // } else {
  //   console.log("📝 .env file not found, please add CONTRACT_ADDRESS manually.");
  // }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
