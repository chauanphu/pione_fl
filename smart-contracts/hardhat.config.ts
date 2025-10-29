import type { HardhatUserConfig } from "hardhat/config";
import { Wallet } from "ethers";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable } from "hardhat/config";
import "@nomicfoundation/hardhat-ignition-ethers"; // Add this line
import * as dotenv from "dotenv"; // Use import instead of require
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("Please set your PRIVATE_KEY in a .env file");
}
const deployerWallet = new Wallet(PRIVATE_KEY);
console.log(`✅ Deployer Address: ${deployerWallet.address}`);

// console.log("Loaded Private Key:", PRIVATE_KEY)
const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // This setting now applies to all compilations
      evmVersion: "paris",
    },
  },
  networks: {
    pioneZero: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.zeroscan.org",
      chainId: 5080,
      accounts: [PRIVATE_KEY],
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
};

export default config;
