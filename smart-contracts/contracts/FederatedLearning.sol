// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FederatedLearning
 * @dev A smart contract to coordinate a multi-round federated learning "campaign".
 * It orchestrates a predefined number of rounds with a fixed set of participants.
 * Models are referenced via IPFS CIDs stored off-chain.
 */
contract FederatedLearning is Ownable {
    // --- Enums and Structs ---

    enum CampaignState {
        INACTIVE, // No campaign is running
        SUBMISSION, // Accepting model submissions from trainers
        VALIDATION, // Accepting validation judgments from validators
        AGGREGATION // Waiting for the aggregator to finalize the round
    }

    struct ModelSubmission {
        string cid;
        address trainer;
        uint256 positiveVotes;
    }

    // --- NEW: Training Campaign Struct ---
    // This struct holds all the data for a single, complete training process.
    struct Campaign {
        uint256 id;
        CampaignState state;
        string globalModelCID;
        uint8 currentRound;
        uint8 totalRounds; // Max 255 rounds per campaign, saves gas
        mapping(address => bool) participants; // Authorized training nodes
        uint256 submissionDeadline; // Timestamp for when submission period ends
        uint8 minSubmissions; // The required number of submissions (quorum)
        uint8 submissionCounter; // How many nodes have submitted for the current round
    }

    // --- State Variables ---

    uint256 public campaignCounter;
    uint256 public activeCampaignId;

    // Mapping from a campaign ID to its Campaign struct
    mapping(uint256 => Campaign) public campaigns;

    // --- MODIFIED: Storage is now nested by Campaign ID and Round Number ---
    // Campaign ID -> Round Number -> Trainer Address -> Model CID
    mapping(uint256 => mapping(uint8 => mapping(address => string)))
        private roundSubmissions;
    // Campaign ID -> Round Number -> All submitted models
    mapping(uint256 => mapping(uint8 => ModelSubmission[]))
        private modelsInRound;
    // Campaign ID -> Round Number -> Model CID -> Validator Address -> Voted
    mapping(uint256 => mapping(uint8 => mapping(string => mapping(address => bool))))
        private modelValidators;

    uint256 public constant REQUIRED_VALIDATIONS = 0;

    // --- Events ---

    // --- MODIFIED: Events now reference a campaignId ---
    event CampaignCreated(
        uint256 indexed campaignId,
        uint8 totalRounds,
        string initialModelCID
    );
    event NewRoundStarted(
        uint256 indexed campaignId,
        uint8 indexed round,
        string initialModelCID
    );
    event ModelSubmitted(
        uint256 indexed campaignId,
        uint8 indexed round,
        address indexed trainer,
        string modelCID
    );
    event ModelValidated(
        uint256 indexed campaignId,
        uint8 indexed round,
        address indexed validator,
        string modelCID,
        bool isValid
    );
    event RoundFinalized(
        uint256 indexed campaignId,
        uint8 indexed round,
        string newGlobalModelCID
    );
    event CampaignCompleted(
        uint256 indexed campaignId,
        uint8 indexed round,
        string finalGlobalModelCID
    );
    event GlobalModelChanged(
        uint256 indexed campaignId,
        uint8 indexed round,
        CampaignState state,
        string finalGlobalModelCID
    );
    event CampaignCancelled(uint256 indexed campaignId);
    event CampaignStateChanged(
        uint256 indexed campaignId,
        CampaignState newState
    );

    // --- Constructor ---
    constructor(address initialOwner) Ownable(initialOwner) {}

    // --- Functions ---

    /**
     * @dev Creates and starts a new training campaign. Defines all parameters upfront.
     * Can only be called by the contract owner.
     * @param _participants An array of addresses for the authorized training nodes.
     * @param _totalRounds The total number of training rounds for this campaign.
     * @param _initialModelCID The IPFS CID of the model to be used for the first round.
     * @notice The number of epochs is a client-side parameter for local training
     * and is not stored or enforced on-chain.
     */
    // --- NEW: Replaces startNewRound() and setGlobalModelCID() ---
    function createTrainingCampaign(
        address[] memory _participants,
        uint8 _totalRounds,
        string memory _initialModelCID,
        // --- NEW PARAMETERS ---
        uint256 _submissionPeriod, // e.g., 3600 seconds for a 1-hour deadline
        uint8 _minSubmissions // The minimum number of submissions required
    ) external onlyOwner {
        require(
            campaigns[activeCampaignId].state == CampaignState.INACTIVE,
            "An existing campaign is active"
        );
        require(
            _participants.length > 0,
            "Must provide at least one participant"
        );
        require(
            _minSubmissions > 0 && _minSubmissions <= _participants.length,
            "Invalid min submissions"
        );
        require(_submissionPeriod > 0, "Submission period must be positive");

        campaignCounter++;
        activeCampaignId = campaignCounter;

        Campaign storage newCampaign = campaigns[activeCampaignId];
        newCampaign.id = activeCampaignId;
        newCampaign.totalRounds = _totalRounds;
        newCampaign.currentRound = 1;
        newCampaign.state = CampaignState.SUBMISSION;
        newCampaign.globalModelCID = _initialModelCID;
        // --- SET NEW VARIABLES ---
        newCampaign.minSubmissions = _minSubmissions;
        newCampaign.submissionDeadline = block.timestamp + _submissionPeriod;
        newCampaign.submissionCounter = 0; // Reset for the first round

        for (uint i = 0; i < _participants.length; i++) {
            newCampaign.participants[_participants[i]] = true;
        }

        emit CampaignCreated(activeCampaignId, _totalRounds, _initialModelCID);
        emit NewRoundStarted(
            newCampaign.id,
            newCampaign.currentRound,
            _initialModelCID
        );
        emit CampaignStateChanged(activeCampaignId, CampaignState.SUBMISSION);
        emit GlobalModelChanged(newCampaign.id, newCampaign.currentRound, newCampaign.state, _initialModelCID);
    }

    /**
     * @dev Submits a locally trained model's CID for the current round of the active campaign.
     * Can only be called by an authorized participant for the active campaign.
     * @param _modelCID The IPFS CID of the new local model.
     */
    function submitModel(string memory _modelCID) external {
        Campaign storage campaign = campaigns[activeCampaignId];
        uint8 round = campaign.currentRound;

        require(
            campaign.state == CampaignState.SUBMISSION,
            "Not in submission phase"
        );
        require(
            block.timestamp <= campaign.submissionDeadline,
            "Submission period has ended"
        );
        require(
            campaign.participants[msg.sender],
            "Not an authorized trainer for this campaign"
        );
        require(
            bytes(roundSubmissions[activeCampaignId][round][msg.sender])
                .length == 0,
            "Already submitted for this round"
        );

        roundSubmissions[activeCampaignId][round][msg.sender] = _modelCID;
        modelsInRound[activeCampaignId][round].push(
            ModelSubmission({
                cid: _modelCID,
                trainer: msg.sender,
                positiveVotes: 0 // Note: Validation is removed per instructions
            })
        );

        // --- NEW: Increment the submission counter ---
        campaign.submissionCounter++;

        emit ModelSubmitted(activeCampaignId, round, msg.sender, _modelCID);
    }

    /**
     * @dev NEW FUNCTION: Triggers the move to the AGGREGATION state.
     * Anyone can call this function. It will only succeed if the conditions are met.
     * This prevents a single user from being burdened with high gas costs on submission.
     */
    function attemptAggregation() external {
        Campaign storage campaign = campaigns[activeCampaignId];
        require(
            campaign.state == CampaignState.SUBMISSION,
            "Not in submission phase"
        );

        // --- NEW: Check for either condition to be true ---
        bool deadlineReached = block.timestamp > campaign.submissionDeadline;
        bool thresholdMet = campaign.submissionCounter >= campaign.minSubmissions;

        require(
            deadlineReached || thresholdMet,
            "Aggregation conditions not met"
        );

        campaign.state = CampaignState.AGGREGATION;
        emit CampaignStateChanged(activeCampaignId, CampaignState.AGGREGATION);
    }

    // /**
    //  * @dev Submits a validation for a model in the current round of the active campaign.
    //  * @param _modelCID The CID of the model being validated.
    //  * @param _isValid The validator's judgment (true for valid, false for invalid).
    //  */
    // function validateModel(string memory _modelCID, bool _isValid) external {
    //     Campaign storage campaign = campaigns[activeCampaignId];
    //     uint8 round = campaign.currentRound;

    //     require(campaign.state == CampaignState.VALIDATION, "Not in validation phase");
    //     require(!modelValidators[activeCampaignId][round][_modelCID][msg.sender], "Already voted on this model");

    //     modelValidators[activeCampaignId][round][_modelCID][msg.sender] = true;

    //     if (_isValid) {
    //         for (uint i = 0; i < modelsInRound[activeCampaignId][round].length; i++) {
    //             if (keccak256(abi.encodePacked(modelsInRound[activeCampaignId][round][i].cid)) == keccak256(abi.encodePacked(_modelCID))) {
    //                 modelsInRound[activeCampaignId][round][i].positiveVotes++;
    //                 break;
    //             }
    //         }
    //     }
    //     emit ModelValidated(activeCampaignId, round, msg.sender, _modelCID, _isValid);
    // }

    /**
     * @dev Finalizes the current round and, if applicable, automatically starts the next one.
     * Called by the aggregator node.
     * If this was the final round, the campaign is completed.
     * @param _newGlobalModelCID The IPFS CID of the new aggregated global model.
     */
    // --- MODIFIED: Now contains automatic round progression logic ---
    function finalizeRound(
        string memory _newGlobalModelCID
    ) external onlyOwner {
        Campaign storage campaign = campaigns[activeCampaignId];
        uint8 round = campaign.currentRound;

        require(
            campaign.state == CampaignState.AGGREGATION,
            "Not in aggregation phase"
        );
        require(
            bytes(_newGlobalModelCID).length > 0,
            "New global model CID cannot be empty"
        );

        campaign.globalModelCID = _newGlobalModelCID;
        campaign.submissionCounter = 0;

        emit GlobalModelChanged(campaign.id, round, campaign.state, _newGlobalModelCID);
        emit RoundFinalized(activeCampaignId, round, _newGlobalModelCID);
        
        // Check if the campaign is complete
        if (round == campaign.totalRounds) {
            campaign.state = CampaignState.INACTIVE;
            emit CampaignCompleted(activeCampaignId, campaign.currentRound,_newGlobalModelCID);
            emit CampaignStateChanged(activeCampaignId, CampaignState.INACTIVE);
        } else {
            // Automatically start the next round
            campaign.currentRound++;
            campaign.state = CampaignState.SUBMISSION;
            emit NewRoundStarted(
                activeCampaignId,
                campaign.currentRound,
                _newGlobalModelCID
            );
            emit CampaignStateChanged(
                activeCampaignId,
                CampaignState.SUBMISSION
            );
        }
    }

    /**
     * @dev Cancels the currently active campaign.
     */
    function cancelCampaign() external onlyOwner {
        Campaign storage campaign = campaigns[activeCampaignId];
        require(
            campaign.state != CampaignState.INACTIVE,
            "No active campaign to cancel"
        );

        // Mark the campaign as inactive to release the lock
        campaign.state = CampaignState.INACTIVE;

        emit CampaignCancelled(activeCampaignId);
        emit CampaignStateChanged(activeCampaignId, CampaignState.INACTIVE);
    }

    // --- View Functions ---

    /**
     * @dev Returns CIDs of models that have met the validation threshold for the current round.
     */
    function getValidModelsForCurrentRound() external view returns (string[] memory) {
        require(activeCampaignId > 0, "No campaign is active");
        Campaign storage campaign = campaigns[activeCampaignId];
        uint8 round = campaign.currentRound;

        uint256 validCount = 0;
        for (uint i = 0; i < modelsInRound[activeCampaignId][round].length; i++) {
            if (modelsInRound[activeCampaignId][round][i].positiveVotes >= REQUIRED_VALIDATIONS) {
                validCount++;
            }
        }

        string[] memory validModels = new string[](validCount);
        uint256 index = 0;
        for (uint i = 0; i < modelsInRound[activeCampaignId][round].length; i++) {
            if (modelsInRound[activeCampaignId][round][i].positiveVotes >= REQUIRED_VALIDATIONS) {
                validModels[index] = modelsInRound[activeCampaignId][round][i].cid;
                index++;
            }
        }
        return validModels;
    }
}
