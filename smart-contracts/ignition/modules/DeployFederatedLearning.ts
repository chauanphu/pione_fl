import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * This module deploys the FederatedLearning smart contract.
 *
 * The contract's constructor requires an `initialOwner` address. This module
 * is configured to automatically use the first signer (account 0) from the
 * connected wallet as the owner.
 */
const FederatedLearningModule = buildModule("FederatedLearningModule", (m) => {
  // Get the first account from the connected wallet to be set as the contract owner.
  // `m.getAccount(0)` retrieves the address of the default deployer account.
  const initialOwner = m.getAccount(0);

  // Deploy the 'FederatedLearning' contract.
  // The second argument is an array of constructor parameters, which in this
  // case is just the `initialOwner`'s address.
  const federatedLearning = m.contract("FederatedLearning", [initialOwner]);

  // The module returns an object where keys are identifiers and values are the
  // deployed contract instances. This allows you to easily reference the
  // deployed contract later.
  return { federatedLearning };
});

export default FederatedLearningModule;