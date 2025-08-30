// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";

/**
 * @title InheritanceVault
 * @notice A vault that enables heirs to claim assets after owner's inactivity using ZK proofs.
 * @dev Implements a heartbeat mechanism with expiry periods and challenge windows.
 *      Uses zero-knowledge proofs to verify heir membership without revealing identity.
 *
 * State Machine:
 * 1. Alive: Owner can send heartbeats, update settings
 * 2. Expiry Started: After missed heartbeat, challenge window opens
 * 3. Challenge Window: Owner can revoke expiry, or heirs wait for window to close
 * 4. Claimable: After challenge window, heirs can claim with valid ZK proofs
 *
 * TODO: Asset registry & payout router (ERC20/721/1155)
 * TODO: Optional bonds/slashing for startExpiry() / claim()
 * TODO: Integrate Paymaster / 4337 hooks (gasless)
 * TODO: Consider reentrancy guard once transfers are added
 * TODO: Support multiple rounds/epochs for rotating heir sets
 */
contract InheritanceVault is Ownable {
    // ═══════════════════════════════════════════════════════════════════
    //                             STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice The Semaphore contract used to validate heir proofs
    ISemaphore public semaphore;

    /// @notice The Semaphore group ID for authorized heirs
    uint256 public groupId;

    /// @notice How often the owner must send heartbeats (in seconds)
    uint256 public heartbeatInterval;

    /// @notice Timestamp when the next heartbeat is due
    uint256 public nextDeadline;

    /// @notice Duration of the challenge window after expiry starts (in seconds)
    uint256 public challengeWindow;

    /// @notice End timestamp of the current challenge window (0 when not in expiry)
    uint256 public challengeWindowEnd;

    // ═══════════════════════════════════════════════════════════════════
    //                             ERRORS
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Action requires vault to be alive (not in expiry)
    error NotAlive();

    /// @dev Cannot start expiry while still alive
    error StillAlive();

    /// @dev Action requires being in challenge window
    error NotInChallengeWindow();

    /// @dev Challenge window has already ended
    error ChallengeWindowOver();

    /// @dev Expiry has not been started yet
    error ExpiryNotStarted();

    /// @dev Expiry has already been started yet
    error ExpiryAlreadyStarted();

    /// @dev Action requires vault to still be alive
    error Expired();

    /// @dev ZK proof verification failed
    error InvalidProof();

    /// @dev Claiming is not open yet (challenge window still active)
    error ClaimNotOpen();

    /// @dev Address cannot be zero
    error ZeroAddress();

    /// @dev Invalid constructor parameters
    error InvalidParams();

    // ═══════════════════════════════════════════════════════════════════
    //                             EVENTS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Emitted when expiry period starts
    event ExpiryStarted(uint256 at, uint256 challengeWindowEnd);

    /// @notice Emitted when owner revokes an active expiry
    event ExpiryRevoked(uint256 at);

    /// @notice Emitted when an heir successfully claims assets
    event Claimed(bytes32 nullifierHash, address to, uint256 amount, bytes signal);

    /// @notice Emitted when owner sends a heartbeat
    event Heartbeat(uint256 nextDeadline);

    /// @notice Emitted when Semaphore contract is updated
    event SemaphoreUpdated(address indexed oldSemaphore, address indexed newSemaphore);

    /// @notice Emitted when group ID is updated
    event GroupIdUpdated(uint256 indexed oldGroupId, uint256 indexed newGroupId);

    // ═══════════════════════════════════════════════════════════════════
    //                            MODIFIERS
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Ensures vault is currently alive (not in expiry state)
    modifier onlyAlive() {
        if (challengeWindowEnd != 0 || block.timestamp > nextDeadline) {
            revert NotAlive();
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Initializes a new inheritance vault
     * @param semaphoreAddress Address of the Semaphore contract
     * @param _heartbeatInterval How often owner must send heartbeats (seconds)
     * @param _challengeWindow Duration of challenge window after expiry (seconds)
     */
    constructor(
        address semaphoreAddress,
        uint256 _heartbeatInterval,
        uint256 _challengeWindow
    ) {
        if (semaphoreAddress == address(0)) revert ZeroAddress();
        if (_heartbeatInterval == 0 || _challengeWindow == 0) revert InvalidParams();

        // Initialize Solady ownership
        _initializeOwner(msg.sender);
        
        semaphore = ISemaphore(semaphoreAddress);
        heartbeatInterval = _heartbeatInterval;
        challengeWindow = _challengeWindow;
        nextDeadline = block.timestamp + _heartbeatInterval;

        // Create a new Semaphore group for heirs
        groupId = semaphore.createGroup(address(this));

        emit GroupIdUpdated(0, groupId);
        emit Heartbeat(nextDeadline);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          OWNER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Owner sends a heartbeat to prove they are still alive
     * @dev Resets the deadline and keeps the vault in alive state
     */
    function keepAlive() external onlyOwner onlyAlive {
        nextDeadline = block.timestamp + heartbeatInterval;
        emit Heartbeat(nextDeadline);
    }

    /**
     * @notice Owner revokes an active expiry during the challenge window
     * @dev Can only be called during an active challenge window
     */
    function revokeExpiry() external onlyOwner {
        if (challengeWindowEnd == 0) revert ExpiryNotStarted();
        if (block.timestamp > challengeWindowEnd) revert ChallengeWindowOver();

        challengeWindowEnd = 0;
        // Refresh heartbeat on revoke
        nextDeadline = block.timestamp + heartbeatInterval;

        emit ExpiryRevoked(block.timestamp);
        emit Heartbeat(nextDeadline);
    }

    /**
     * @notice Update the Semaphore contract address
     * @param newSemaphore Address of the new Semaphore contract
     */
    function setSemaphore(address newSemaphore) external onlyOwner {
        if (newSemaphore == address(0)) revert ZeroAddress();
        address oldSemaphore = address(semaphore);
        semaphore = ISemaphore(newSemaphore);
        emit SemaphoreUpdated(oldSemaphore, newSemaphore);
    }

    /**
     * @notice Update the group ID
     * @param newGroupId New group ID for heirs
     */
    function setGroupId(uint256 newGroupId) external onlyOwner onlyAlive {
        uint256 oldGroupId = groupId;
        groupId = newGroupId;
        emit GroupIdUpdated(oldGroupId, newGroupId);
    }

    /**
     * @notice Add a new heir to the Semaphore group
     * @param identityCommitment The identity commitment of the heir
     */
    function addHeir(uint256 identityCommitment) external onlyOwner onlyAlive {
        semaphore.addMember(groupId, identityCommitment);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Anyone can start the expiry process after a missed heartbeat
     * @dev Can only be called after the deadline has passed and expiry hasn't started
     */
    function startExpiry() external {
        if (block.timestamp <= nextDeadline) revert StillAlive();
        if (challengeWindowEnd != 0) revert ExpiryAlreadyStarted();

        challengeWindowEnd = block.timestamp + challengeWindow;
        emit ExpiryStarted(block.timestamp, challengeWindowEnd);
    }

    /**
     * @notice Heirs can claim assets after the challenge window ends using Semaphore proof
     * @dev Requires a valid Semaphore proof demonstrating heir membership
     * @param merkleTreeDepth Depth of the Merkle tree
     * @param merkleTreeRoot Root of the Merkle tree
     * @param nullifier Nullifier to prevent double claiming
     * @param signal Signal data (can encode payout parameters)
     * @param points Proof points from the zero-knowledge proof
     * @param to Address to receive the claimed assets
     * @param amount Amount to claim (for event logging, actual logic TBD)
     */
    function claim(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 signal,
        uint256[8] calldata points,
        address to,
        uint256 amount
    ) external {
        // State checks
        if (challengeWindowEnd == 0) revert ExpiryNotStarted();
        if (block.timestamp <= challengeWindowEnd) revert ClaimNotOpen();
        if (to == address(0)) revert ZeroAddress();

        // Build Semaphore proof struct
        ISemaphore.SemaphoreProof memory proof = ISemaphore.SemaphoreProof(
            merkleTreeDepth,
            merkleTreeRoot,
            nullifier,
            signal,
            groupId,
            points
        );

        // Verify proof via Semaphore (this also prevents nullifier reuse)
        semaphore.validateProof(groupId, proof);

        // TODO: Interactions - transfer ERC20/721/1155 based on signal or internal policy
        // This is where asset transfer logic will be implemented

        emit Claimed(bytes32(nullifier), to, amount, abi.encode(signal));
    }

    // ═══════════════════════════════════════════════════════════════════
    //                           VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Check if the vault is currently alive
     * @return True if vault is alive (not in expiry and deadline not passed)
     */
    function isAlive() public view returns (bool) {
        return challengeWindowEnd == 0 && block.timestamp <= nextDeadline;
    }

    /**
     * @notice Check if claiming is currently open for heirs
     * @return True if challenge window has ended and claiming is open
     */
    function claimOpen() public view returns (bool) {
        return challengeWindowEnd != 0 && block.timestamp > challengeWindowEnd;
    }

    /**
     * @notice Check if expiry has been started
     * @return True if expiry process has begun
     */
    function inExpiry() public view returns (bool) {
        return challengeWindowEnd != 0;
    }

    /**
     * @notice Check if currently in challenge window
     * @return True if in challenge window (owner can still revoke)
     */
    function inChallengeWindow() public view returns (bool) {
        return challengeWindowEnd != 0 && block.timestamp <= challengeWindowEnd;
    }
}