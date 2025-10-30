import { expect } from "chai";
import { FederatedLearning } from "../types/ethers-contracts/index.js";
import { network } from "hardhat";

const { ethers } = await network.connect({
    network: "hardhatOp",
    chainType: "op",
});

describe("FederatedLearning Contract", function () {
    let flContract: FederatedLearning;
    let owner: any;
    let trainer1: any;
    let trainer2: any;
    let aggregator: any;

    const INITIAL_GLOBAL_MODEL_CID = "QmInitialGlobalModel";
    const TRAINER1_MODEL_CID = "QmTrainer1LocalModel";
    const TRAINER2_MODEL_CID = "QmTrainer2LocalModel";
    const FINAL_GLOBAL_MODEL_CID = "QmFinalAggregatedModel";

    const SUBMISSION_PERIOD = 3600; // 1 hour
    const MIN_SUBMISSIONS = 2;

    beforeEach(async function () {
        [owner, trainer1, trainer2, aggregator] = await ethers.getSigners();

        const FederatedLearningFactory = await ethers.getContractFactory("FederatedLearning");
        flContract = (await FederatedLearningFactory.deploy(owner.address)) as any as FederatedLearning;
        await flContract.waitForDeployment();
    });

    describe("Campaign Creation & Validation", function () {
        it("should create a new training campaign", async function () {
            const participants = [trainer1.address, trainer2.address];

            await expect(
                flContract
                    .connect(owner)
                    .createTrainingCampaign(
                        participants,
                        2, // 2 total rounds
                        INITIAL_GLOBAL_MODEL_CID,
                        SUBMISSION_PERIOD,
                        MIN_SUBMISSIONS
                    )
            )
                .to.emit(flContract, "CampaignCreated")
                .withArgs(1, 2, INITIAL_GLOBAL_MODEL_CID)
                .and.to.emit(flContract, "NewRoundStarted")
                .withArgs(1, 1, INITIAL_GLOBAL_MODEL_CID)
                .and.to.emit(flContract, "CampaignStateChanged");
        });

        it("should reject campaign creation if one is already active", async function () {
            const participants = [trainer1.address, trainer2.address];

            // Create first campaign
            await flContract
                .connect(owner)
                .createTrainingCampaign(
                    participants,
                    2,
                    INITIAL_GLOBAL_MODEL_CID,
                    SUBMISSION_PERIOD,
                    MIN_SUBMISSIONS
                );

            // Try to create second campaign - should fail
            await expect(
                flContract
                    .connect(owner)
                    .createTrainingCampaign(
                        participants,
                        2,
                        INITIAL_GLOBAL_MODEL_CID,
                        SUBMISSION_PERIOD,
                        MIN_SUBMISSIONS
                    )
            ).to.be.revertedWith("An existing campaign is active");
        });
    });

    describe("Full Training Workflow", function () {
        beforeEach(async function () {
            const participants = [trainer1.address, trainer2.address];
            await flContract
                .connect(owner)
                .createTrainingCampaign(
                    participants,
                    1, // 1 total round for simpler test
                    INITIAL_GLOBAL_MODEL_CID,
                    SUBMISSION_PERIOD,
                    MIN_SUBMISSIONS
                );
        });

        it("should allow trainers to submit models and complete a full round", async function () {
            // == Phase 1: Model Submission ==
            console.log("      Phase 1: Submitting local models...");
            await expect(flContract.connect(trainer1).submitModel(TRAINER1_MODEL_CID))
                .to.emit(flContract, "ModelSubmitted")
                .withArgs(1, 1, trainer1.address, TRAINER1_MODEL_CID);

            await expect(flContract.connect(trainer2).submitModel(TRAINER2_MODEL_CID))
                .to.emit(flContract, "ModelSubmitted")
                .withArgs(1, 1, trainer2.address, TRAINER2_MODEL_CID);

            // Rejection test: Trainer 1 tries to submit again
            await expect(flContract.connect(trainer1).submitModel("someOtherCID"))
                .to.be.revertedWith("Already submitted for this round");

            // == Phase 2: Attempt Aggregation ==
            console.log("      Phase 2: Triggering aggregation...");
            await expect(flContract.connect(aggregator).attemptAggregation())
                .to.emit(flContract, "CampaignStateChanged");

            // == Phase 3: Finalize Round ==
            console.log("      Phase 3: Finalizing round with aggregated model...");
            
            // Fetch valid models
            const validModels = await flContract.getValidModelsForCurrentRound();
            expect(validModels.length).to.be.greaterThan(0);

            // Finalize round
            await expect(flContract.connect(owner).finalizeRound(FINAL_GLOBAL_MODEL_CID))
                .to.emit(flContract, "RoundFinalized")
                .withArgs(1, 1, FINAL_GLOBAL_MODEL_CID)
                .and.to.emit(flContract, "CampaignCompleted");

            console.log("      ✅ Round successfully completed!");
        });

        it("should reject model submissions from unauthorized participants", async function () {
            const [, , , unauthorized] = await ethers.getSigners();
            
            await expect(
                flContract.connect(unauthorized).submitModel(TRAINER1_MODEL_CID)
            ).to.be.revertedWith("Not an authorized trainer for this campaign");
        });

        it("should reject submissions after deadline", async function () {
            // Fast forward time beyond the submission deadline
            await ethers.provider!.send("evm_increaseTime", [SUBMISSION_PERIOD + 1]);
            await ethers.provider!.send("evm_mine", []);

            await expect(
                flContract.connect(trainer1).submitModel(TRAINER1_MODEL_CID)
            ).to.be.revertedWith("Submission period has ended");
        });
    });

    describe("Multi-Round Campaign", function () {
        beforeEach(async function () {
            const participants = [trainer1.address, trainer2.address];
            await flContract
                .connect(owner)
                .createTrainingCampaign(
                    participants,
                    2, // 2 total rounds
                    INITIAL_GLOBAL_MODEL_CID,
                    SUBMISSION_PERIOD,
                    MIN_SUBMISSIONS
                );
        });

        it("should automatically progress to next round after finalization", async function () {
            // Submit models for round 1
            await flContract.connect(trainer1).submitModel(TRAINER1_MODEL_CID);
            await flContract.connect(trainer2).submitModel(TRAINER2_MODEL_CID);

            // Trigger aggregation
            await flContract.connect(aggregator).attemptAggregation();

            // Finalize round 1
            await expect(flContract.connect(owner).finalizeRound(FINAL_GLOBAL_MODEL_CID))
                .to.emit(flContract, "NewRoundStarted")
                .withArgs(1, 2, FINAL_GLOBAL_MODEL_CID);

            // Submit models for round 2
            await expect(flContract.connect(trainer1).submitModel("QmRound2TrainerModel"))
                .to.emit(flContract, "ModelSubmitted")
                .withArgs(1, 2, trainer1.address, "QmRound2TrainerModel");
        });
    });

    describe("Campaign Management", function () {
        beforeEach(async function () {
            const participants = [trainer1.address, trainer2.address];
            await flContract
                .connect(owner)
                .createTrainingCampaign(
                    participants,
                    1,
                    INITIAL_GLOBAL_MODEL_CID,
                    SUBMISSION_PERIOD,
                    MIN_SUBMISSIONS
                );
        });

        it("should allow owner to cancel campaign", async function () {
            await expect(flContract.connect(owner).cancelCampaign())
                .to.emit(flContract, "CampaignCancelled")
                .withArgs(1)
                .and.to.emit(flContract, "CampaignStateChanged");

            // After cancellation, new campaign should be creatable
            const participants = [trainer1.address, trainer2.address];
            await expect(
                flContract
                    .connect(owner)
                    .createTrainingCampaign(
                        participants,
                        1,
                        INITIAL_GLOBAL_MODEL_CID,
                        SUBMISSION_PERIOD,
                        MIN_SUBMISSIONS
                    )
            // @ts-ignore hardhat-ethers v3: use .revert(ethers)
            ).to.not.be.revert(ethers);
        });

        it("should reject campaign cancellation from non-owner", async function () {
            await expect(
                flContract.connect(trainer1).cancelCampaign()
            ).to.be.revertedWithCustomError(flContract, "OwnableUnauthorizedAccount");
        });
    });
});