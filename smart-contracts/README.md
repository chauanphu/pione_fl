# Sample Hardhat 3 Beta Project (`mocha` and `ethers`)

This project showcases a Hardhat 3 Beta project using `mocha` for tests and the `ethers` library for Ethereum interactions.

To learn more about the Hardhat 3 Beta, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3 Beta](https://hardhat.org/hardhat3-beta-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using `mocha` and ethers.js
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `mocha` tests:

```shell
npx hardhat test solidity
npx hardhat test mocha
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```

# FederatedLearning Smart Contract
Overview

This Solidity smart contract (FederatedLearning.sol) serves as the on-chain backbone for a decentralized federated learning system. It coordinates the actions of clients and an aggregator without ever handling the raw data or large model files directly.

The core principle is to use the Ethereum blockchain as a trust and coordination layer, while leveraging the InterPlanetary File System (IPFS) for efficient, decentralized storage of machine learning models.
Key Components
Roles

    Owner: The address that deploys the contract. The owner has administrative privileges, such as authorizing and revoking clients.

    Aggregator: The entity responsible for orchestrating the training rounds. It initiates new rounds and finalizes them by submitting the aggregated global model. By default, the owner is also the aggregator, but this could be extended to be a separate role.

    Clients: Authorized addresses that can participate in training. These represent the edge devices (e.g., Android phones) that train models on local data.

State Variables

    currentRound: A counter for the current training round.

    globalModelCID: The IPFS Content Identifier (CID) for the current global model. This is the "single source of truth" that clients pull from at the start of each round.

    submissions: An array that stores the ModelUpdate structs submitted by clients in the current round. Each struct contains the client's address and the IPFS CID of their local model update.

    authorizedClients: A mapping to keep track of which addresses are permitted to submit model updates.

Core Functions

    authorizeClient(address): Allows the owner to whitelist a new client.

    startNewRound(string memory _initialModelCID): Called by the aggregator to begin a new training cycle. It increments the round counter and sets the global model CID for clients to download.

    submitModelUpdate(string memory _localModelCID): Called by an authorized client to submit the IPFS CID of their trained local model.

    completeAggregation(string memory _newGlobalModelCID): Called by the aggregator after it has downloaded all the local models from IPFS, computed the new global model off-chain, and uploaded it back to IPFS. This function updates the globalModelCID on the contract, completing the round.

    getSubmissions(): A view function that allows the aggregator to easily retrieve all the submitted CIDs for the current round.

Workflow

    Setup: The owner deploys the contract and authorizes a set of clients.

    Round Initiation: The aggregator starts a new round by calling startNewRound with the CID of the initial global model.

    Client Training:

        Clients read the globalModelCID from the contract.

        They download the model from IPFS using the CID.

        They train the model on their local data.

        They upload their updated model to IPFS, receiving a new CID.

    Submission: Each client calls submitModelUpdate with their new CID.

    Aggregation:

        The aggregator calls getSubmissions to get all the local model CIDs.

        It downloads all the local models from IPFS.

        It performs the aggregation computation (e.g., averaging weights) off-chain.

        It uploads the resulting new global model to IPFS.

    Round Completion: The aggregator calls completeAggregation with the new global model's CID, finalizing the round and making the new model available for the next one.