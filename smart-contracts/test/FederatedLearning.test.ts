// test/test-federated-learning.js
import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "hardhatOp",
  chainType: "op",
});

import { expect } from "chai";
import { FederatedLearning } from "../types/ethers-contracts/index.js";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("FederatedLearning Contract", function () {
    let flContract: FederatedLearning;
    let owner: HardhatEthersSigner;
    let trainer1: HardhatEthersSigner;
    let trainer2: HardhatEthersSigner;
    let validator1: HardhatEthersSigner;
    let validator2: HardhatEthersSigner;
    let validator3: HardhatEthersSigner;

    const INITIAL_GLOBAL_MODEL_CID = "QmInitialGlobalModel";
    const TRAINER1_MODEL_CID = "QmTrainer1LocalModel";
    const TRAINER2_MODEL_CID = "QmTrainer2LocalModel";
    const FINAL_GLOBAL_MODEL_CID = "QmFinalAggregatedModel";

    beforeEach(async function () {
        [owner, trainer1, trainer2, validator1, validator2, validator3] = await ethers.getSigners();

        const FederatedLearningFactory = await ethers.getContractFactory("FederatedLearning");
        flContract = await FederatedLearningFactory.deploy(owner.address);
        await flContract.waitForDeployment();
    });

    describe("Full Training Round Workflow", function () {
        it("should successfully complete a full federated learning round", async function () {
            // == Phase 1: Round Initialization ==
            console.log("      Phase 1: Initializing new round...");
            await expect(flContract.connect(owner).startNewRound(INITIAL_GLOBAL_MODEL_CID))
                .to.emit(flContract, "NewRoundStarted")
                .withArgs(1, INITIAL_GLOBAL_MODEL_CID)
                .and.to.emit(flContract, "RoundStateChanged")
                .withArgs(1, 1); // 1 = SUBMISSION state

            expect(await flContract.currentRound()).to.equal(1);
            expect(await flContract.globalModelCID()).to.equal(INITIAL_GLOBAL_MODEL_CID);
            expect(await flContract.currentRoundState()).to.equal(1); // Enum SUBMISSION

            // == Phase 2: Local Training & Submission ==
            console.log("      Phase 2: Submitting local models...");
            await expect(flContract.connect(trainer1).submitModel(TRAINER1_MODEL_CID))
                .to.emit(flContract, "ModelSubmitted")
                .withArgs(1, trainer1.address, TRAINER1_MODEL_CID);

            await expect(flContract.connect(trainer2).submitModel(TRAINER2_MODEL_CID))
                .to.emit(flContract, "ModelSubmitted")
                .withArgs(1, trainer2.address, TRAINER2_MODEL_CID);
            
            // Rejection test: Trainer 1 tries to submit again
            await expect(flContract.connect(trainer1).submitModel("someOtherCID"))
                .to.be.revertedWith("Already submitted for this round");

            // == Transition to Validation Phase ==
            await flContract.connect(owner).advanceRoundState();
            expect(await flContract.currentRoundState()).to.equal(2); // Enum VALIDATION

            // == Phase 3: Validation ==
            console.log("      Phase 3: Validating submitted models...");
            // Model 1 (TRAINER1_MODEL_CID) gets 2 valid votes -> should pass
            await expect(flContract.connect(validator1).validateModel(TRAINER1_MODEL_CID, true))
                .to.emit(flContract, "ModelValidated");
            await expect(flContract.connect(validator2).validateModel(TRAINER1_MODEL_CID, true))
                .to.emit(flContract, "ModelValidated");
            
            // Model 2 (TRAINER2_MODEL_CID) gets 1 valid, 1 invalid vote -> should fail
            await expect(flContract.connect(validator1).validateModel(TRAINER2_MODEL_CID, true))
                .to.emit(flContract, "ModelValidated");
            await expect(flContract.connect(validator2).validateModel(TRAINER2_MODEL_CID, false))
                .to.emit(flContract, "ModelValidated");

            // Rejection test: Validator 1 tries to vote again on the same model
            await expect(flContract.connect(validator1).validateModel(TRAINER1_MODEL_CID, true))
                .to.be.revertedWith("Already voted on this model");

            // == Transition to Aggregation Phase ==
            await flContract.connect(owner).advanceRoundState();
            expect(await flContract.currentRoundState()).to.equal(3); // Enum AGGREGATION

            // == Phase 4: Aggregation ==
            console.log("      Phase 4: Aggregating and finalizing round...");
            // Aggregator node fetches valid models
            const validModels = await flContract.getValidModelsForCurrentRound();
            expect(validModels).to.have.lengthOf(1);
            expect(validModels[0]).to.equal(TRAINER1_MODEL_CID);
            
            // Aggregator submits the final aggregated model
            await expect(flContract.connect(owner).finalizeRound(FINAL_GLOBAL_MODEL_CID))
                .to.emit(flContract, "RoundFinalized")
                .withArgs(1, FINAL_GLOBAL_MODEL_CID)
                .and.to.emit(flContract, "RoundStateChanged")
                .withArgs(1, 0); // 0 = INACTIVE state
            
            // Verify final state
            expect(await flContract.globalModelCID()).to.equal(FINAL_GLOBAL_MODEL_CID);
            expect(await flContract.currentRoundState()).to.equal(0); // Enum INACTIVE
            console.log("      ✅ Round successfully completed!");
        });
    });
});