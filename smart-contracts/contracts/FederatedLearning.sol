// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FederatedLearning
 * @dev A smart contract to coordinate rounds of a decentralized federated learning process.
 * It uses IPFS CIDs to reference models stored off-chain.
 * The process follows four main phases: Submission, Validation, Aggregation, and Completion.
 */
contract FederatedLearning is Ownable {
    // --- Enums and Structs ---

    enum RoundState {
        INACTIVE,   // Round has not started or is complete
        SUBMISSION, // Accepting model submissions from trainers
        VALIDATION, // Accepting validation judgments from validators
        AGGREGATION // Waiting for the aggregator to finalize the round
    }

    struct ModelSubmission {
        string cid;
        address trainer;
        uint256 positiveVotes;
    }

    // --- State Variables ---

    uint256 public currentRound;
    RoundState public currentRoundState;
    string public globalModelCID;

    uint256 public constant REQUIRED_VALIDATIONS = 1; // Min positive votes for a model

    // Round -> Trainer Address -> Model CID
    mapping(uint256 => mapping(address => string)) private roundSubmissions;
    // Round -> Model CID -> Validator Address -> Voted (true)
    mapping(uint256 => mapping(string => mapping(address => bool))) private modelValidators;
    // Round -> All submitted model CIDs for that round
    mapping(uint256 => ModelSubmission[]) private modelsInRound;
    
    // --- Events ---

    event NewRoundStarted(uint256 indexed roundId, string initialModelCID);
    event ModelSubmitted(uint256 indexed roundId, address indexed trainer, string modelCID);
    event ModelValidated(uint256 indexed roundId, address indexed validator, string modelCID, bool isValid);
    event RoundFinalized(uint256 indexed roundId, string newGlobalModelCID);
    event RoundStateChanged(uint256 indexed roundId, RoundState newState);
    event GlobalModelUpdated(string newGlobalModelCID);
    event RoundCancelled(uint256 indexed roundId);
    // --- Constructor ---

    constructor(address initialOwner) Ownable(initialOwner) {}

    // --- Functions ---

    /**
     * @dev Starts a new training round.
     * Can only be called by the owner.
     * Uses the global model CID already stored in the contract.
     */
    // --- MODIFIED FUNCTION ---
    function startNewRound() external onlyOwner {
        require(currentRoundState == RoundState.INACTIVE, "An existing round is active");
        require(bytes(globalModelCID).length > 0, "Global model CID must be set first");

        currentRound++;
        currentRoundState = RoundState.SUBMISSION;
        emit NewRoundStarted(currentRound, globalModelCID); // Now uses the state variable
        emit RoundStateChanged(currentRound, RoundState.SUBMISSION);
    }

    /**
     * @dev Submits a locally trained model's CID for the current round.
     * Called by training nodes.
     * @param _modelCID The IPFS CID of the new local model.
     */
    function submitModel(string memory _modelCID) external {
        require(currentRoundState == RoundState.SUBMISSION, "Not in submission phase");
        require(bytes(roundSubmissions[currentRound][msg.sender]).length == 0, "Already submitted for this round");

        roundSubmissions[currentRound][msg.sender] = _modelCID;
        modelsInRound[currentRound].push(ModelSubmission({
            cid: _modelCID,
            trainer: msg.sender,
            positiveVotes: 0
        }));
        emit ModelSubmitted(currentRound, msg.sender, _modelCID);
    }

    /**
     * @dev Submits a validation judgment for a specific model in the current round.
     * Called by validator nodes.
     * @param _modelCID The CID of the model being validated.
     * @param _isValid The validator's judgment (true for valid, false for invalid).
     */
    function validateModel(string memory _modelCID, bool _isValid) external {
        require(currentRoundState == RoundState.VALIDATION, "Not in validation phase");
        require(!modelValidators[currentRound][_modelCID][msg.sender], "Already voted on this model");

        modelValidators[currentRound][_modelCID][msg.sender] = true;

        if (_isValid) {
            for (uint i = 0; i < modelsInRound[currentRound].length; i++) {
                if (keccak256(abi.encodePacked(modelsInRound[currentRound][i].cid)) == keccak256(abi.encodePacked(_modelCID))) {
                    modelsInRound[currentRound][i].positiveVotes++;
                    break;
                }
            }
        }

        emit ModelValidated(currentRound, msg.sender, _modelCID, _isValid);
    }

    /**
     * @dev Finalizes the round with the new aggregated global model CID.
     * Called by the aggregator node.
     * @param _newGlobalModelCID The IPFS CID of the new global model.
     */
    function finalizeRound(string memory _newGlobalModelCID) external onlyOwner {
        require(currentRoundState == RoundState.AGGREGATION, "Not in aggregation phase");
        
        globalModelCID = _newGlobalModelCID;
        currentRoundState = RoundState.INACTIVE;

        emit RoundFinalized(currentRound, _newGlobalModelCID);
        emit RoundStateChanged(currentRound, RoundState.INACTIVE);
    }

    // --- View Functions ---

    /**
     * @dev Returns a list of model CIDs that have met the required validation threshold.
     * Called by the aggregator to know which models to fetch from IPFS.
     */
    function getValidModelsForCurrentRound() external view returns (string[] memory) {
        uint256 validCount = 0;
        for (uint i = 0; i < modelsInRound[currentRound].length; i++) {
            if (modelsInRound[currentRound][i].positiveVotes >= REQUIRED_VALIDATIONS) {
                validCount++;
            }
        }

        string[] memory validModels = new string[](validCount);
        uint256 index = 0;
        for (uint i = 0; i < modelsInRound[currentRound].length; i++) {
            if (modelsInRound[currentRound][i].positiveVotes >= REQUIRED_VALIDATIONS) {
                validModels[index] = modelsInRound[currentRound][i].cid;
                index++;
            }
        }
        return validModels;
    }
    
    // --- State Management (Owner only) ---
    
    /**
     * @dev Sets or overwrites the global model CID. Can only be called by the owner.
     * @param _newGlobalModelCID The IPFS CID for the global model.
     */
    // --- NEW FUNCTION ---
    function setGlobalModelCID(string memory _newGlobalModelCID) external onlyOwner {
        require(bytes(_newGlobalModelCID).length > 0, "CID cannot be empty");
        require(currentRoundState == RoundState.INACTIVE, "Cannot set model during an active round");
        globalModelCID = _newGlobalModelCID;
        emit GlobalModelUpdated(_newGlobalModelCID);
    }

    /**
     * @dev Manually moves the round to the next state.
     * In a production system, this would be automated by timers.
     */
    function advanceRoundState() external onlyOwner {
        require(currentRoundState != RoundState.INACTIVE, "No active round");

        if (currentRoundState == RoundState.SUBMISSION) {
            currentRoundState = RoundState.VALIDATION;
            emit RoundStateChanged(currentRound, RoundState.VALIDATION);
        } else if (currentRoundState == RoundState.VALIDATION) {
            currentRoundState = RoundState.AGGREGATION;
            emit RoundStateChanged(currentRound, RoundState.AGGREGATION);
        }
    }

    function cancelRound() external onlyOwner {
        require(currentRoundState != RoundState.INACTIVE, "No active round to cancel");
        uint256 roundToCancel = currentRound;

        currentRoundState = RoundState.INACTIVE;
        currentRound--; // Revert the round increment from startNewRound

        // Clean up data for the cancelled round to prevent side-effects
        delete modelsInRound[roundToCancel];

        emit RoundCancelled(roundToCancel);
        emit RoundStateChanged(roundToCancel, RoundState.INACTIVE);
    }
}