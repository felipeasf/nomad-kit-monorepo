// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InheritanceVault
 * @notice A vault that enables heirs to claim assets after owner's inactivity using ZK proofs.
 * @dev Implements a heartbeat mechanism with expiry periods and challenge windows.
 *      Uses zero-knowledge proofs to verify heir membership without revealing identity.
 *      Supports ETH and ERC-20 deposits with equal-split payouts among heirs.
 *
 * State Machine:
 * 1. Alive: Owner can send heartbeats, deposit assets, update settings
 * 2. Expiry Started: After missed heartbeat, challenge window opens, deposits frozen
 * 3. Challenge Window: Owner can revoke expiry, or heirs wait for window to close
 * 4. Claimable: After challenge window, heirs can claim equal shares with valid ZK proofs
 *
 * Asset Management:
 * - Owner deposits ETH and ERC-20 tokens while vault is alive
 * - On expiry start: freeze deposits, snapshot balances, calculate equal shares
 * - Each valid heir claim receives: remaining_balance / heirs_remaining
 * - Last claimant gets all remaining dust from rounding
 */
contract InheritanceVault is Ownable, ReentrancyGuard {
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
    //                          ASSET MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Whether deposits are frozen (set on expiry start)
    bool public frozen;

    /// @notice Total number of heirs at snapshot time
    uint256 public heirsTotal;

    /// @notice Number of heirs remaining to claim
    uint256 public heirsRemaining;

    /// @notice List of deposited ERC-20 token addresses
    address[] public tokens;

    /// @notice Mapping to track which tokens have been deposited
    mapping(address => bool) public knownToken;

    /// @notice ETH balance at snapshot time
    uint256 public snapshotETH;

    /// @notice ERC-20 balances at snapshot time
    mapping(address => uint256) public snapshot;

    /// @notice Remaining ETH to be claimed
    uint256 public remainingETH;

    /// @notice Remaining ERC-20 balances to be claimed
    mapping(address => uint256) public remaining;

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

    /// @dev Deposits are frozen (expiry has started)
    error DepositsFrozen();

    /// @dev No heirs in the group to claim
    error NoHeirs();

    /// @dev All heirs have already claimed
    error AllHeirsClaimed();

    /// @dev Invalid token amount (zero)
    error InvalidAmount();

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

    /// @notice Emitted when owner deposits ETH
    event ETHDeposited(uint256 amount);

    /// @notice Emitted when owner deposits ERC-20 tokens
    event ERC20Deposited(address indexed token, uint256 amount);

    /// @notice Emitted when asset snapshot is taken at expiry
    event SnapshotTaken(uint256 heirsTotal, uint256 ethAmount, address[] tokens);

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

    /// @dev Ensures deposits are not frozen
    modifier notFrozen() {
        if (frozen) {
            revert DepositsFrozen();
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
    ) Ownable(msg.sender) {
        if (semaphoreAddress == address(0)) revert ZeroAddress();
        if (_heartbeatInterval == 0 || _challengeWindow == 0) revert InvalidParams();
        
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
     *      Resets the vault to alive state and unfreezes deposits
     */
    function revokeExpiry() external onlyOwner {
        if (challengeWindowEnd == 0) revert ExpiryNotStarted();
        if (block.timestamp > challengeWindowEnd) revert ChallengeWindowOver();

        // Reset expiry state
        challengeWindowEnd = 0;
        frozen = false;
        heirsTotal = 0;
        heirsRemaining = 0;
        snapshotETH = 0;
        remainingETH = 0;

        // Clear token snapshots
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            snapshot[token] = 0;
            remaining[token] = 0;
        }

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

    /**
     * @notice Owner deposits ETH into the vault
     * @dev Only allowed while vault is alive and not frozen
     */
    function depositETH() external payable onlyOwner onlyAlive notFrozen {
        if (msg.value == 0) revert InvalidAmount();
        emit ETHDeposited(msg.value);
    }

    /**
     * @notice Owner deposits ERC-20 tokens into the vault
     * @param token Address of the ERC-20 token contract
     * @param amount Amount of tokens to deposit
     * @dev Only allowed while vault is alive and not frozen
     *      Requires prior approval from owner to this contract
     */
    function depositERC20(address token, uint256 amount) external onlyOwner onlyAlive notFrozen {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        // Add to token registry if first deposit of this token
        if (!knownToken[token]) {
            knownToken[token] = true;
            tokens.push(token);
        }

        // Transfer tokens from owner to vault
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), amount);
        emit ERC20Deposited(token, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          PUBLIC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Anyone can start the expiry process after a missed heartbeat
     * @dev Can only be called after the deadline has passed and expiry hasn't started
     *      Freezes deposits and takes snapshot of all balances
     */
    function startExpiry() external {
        if (block.timestamp <= nextDeadline) revert StillAlive();
        if (challengeWindowEnd != 0) revert ExpiryAlreadyStarted();

        // Get current number of heirs from Semaphore group
        uint256 groupSize = ISemaphoreGroups(address(semaphore)).getMerkleTreeSize(groupId);
        if (groupSize == 0) revert NoHeirs();

        // Freeze deposits and set heir counts
        frozen = true;
        heirsTotal = groupSize;
        heirsRemaining = groupSize;

        // Snapshot ETH balance
        snapshotETH = address(this).balance;
        remainingETH = snapshotETH;

        // Snapshot ERC-20 balances
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 balance = IERC20(token).balanceOf(address(this));
            snapshot[token] = balance;
            remaining[token] = balance;
        }

        challengeWindowEnd = block.timestamp + challengeWindow;
        
        emit SnapshotTaken(heirsTotal, snapshotETH, tokens);
        emit ExpiryStarted(block.timestamp, challengeWindowEnd);
    }

    /**
     * @notice Heirs can claim assets after the challenge window ends using Semaphore proof
     * @dev Requires a valid Semaphore proof demonstrating heir membership
     *      Transfers equal share of remaining ETH and ERC-20 tokens
     * @param merkleTreeDepth Depth of the Merkle tree
     * @param merkleTreeRoot Root of the Merkle tree
     * @param nullifier Nullifier to prevent double claiming
     * @param signal Signal data (can encode payout parameters)
     * @param points Proof points from the zero-knowledge proof
     * @param to Address to receive the claimed assets
     * @param amount Amount to claim (for event logging, ignored in logic)
     */
    function claim(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 signal,
        uint256[8] calldata points,
        address to,
        uint256 amount
    ) external nonReentrant {
        // State checks
        if (challengeWindowEnd == 0) revert ExpiryNotStarted();
        if (block.timestamp <= challengeWindowEnd) revert ClaimNotOpen();
        if (to == address(0)) revert ZeroAddress();
        if (heirsRemaining == 0) revert AllHeirsClaimed();

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

        // Calculate and transfer equal share of remaining assets
        uint256 totalClaimed = 0;

        // Transfer ETH share
        if (remainingETH > 0) {
            uint256 ethShare = remainingETH / heirsRemaining;
            if (ethShare > 0) {
                remainingETH -= ethShare;
                totalClaimed += ethShare;
                (bool success, ) = to.call{value: ethShare}("");
                require(success, "ETH transfer failed");
            }
        }

        // Transfer ERC-20 token shares
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 tokenRemaining = remaining[token];
            
            if (tokenRemaining > 0) {
                uint256 tokenShare = tokenRemaining / heirsRemaining;
                if (tokenShare > 0) {
                    remaining[token] -= tokenShare;
                    SafeERC20.safeTransfer(IERC20(token), to, tokenShare);
                }
            }
        }

        // Decrement heirs remaining
        heirsRemaining--;

        // If this is the last heir, transfer all remaining dust
        if (heirsRemaining == 0) {
            // Transfer any remaining ETH dust
            if (remainingETH > 0) {
                totalClaimed += remainingETH;
                (bool success, ) = to.call{value: remainingETH}("");
                require(success, "ETH dust transfer failed");
                remainingETH = 0;
            }

            // Transfer any remaining token dust
            for (uint256 i = 0; i < tokens.length; i++) {
                address token = tokens[i];
                uint256 tokenDust = remaining[token];
                if (tokenDust > 0) {
                    SafeERC20.safeTransfer(IERC20(token), to, tokenDust);
                    remaining[token] = 0;
                }
            }
        }

        emit Claimed(bytes32(nullifier), to, totalClaimed, abi.encode(signal));
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

    /**
     * @notice Get the number of deposited tokens
     * @return Number of different ERC-20 tokens deposited
     */
    function getTokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /**
     * @notice Get deposited token address by index
     * @param index Index of the token in the tokens array
     * @return Address of the token contract
     */
    function getToken(uint256 index) external view returns (address) {
        require(index < tokens.length, "Index out of bounds");
        return tokens[index];
    }

    /**
     * @notice Get all deposited token addresses
     * @return Array of token contract addresses
     */
    function getAllTokens() external view returns (address[] memory) {
        return tokens;
    }

    /**
     * @notice Get remaining balance for a specific token
     * @param token Address of the token contract
     * @return Remaining balance available for claims
     */
    function getRemainingBalance(address token) external view returns (uint256) {
        return remaining[token];
    }

    /**
     * @notice Get snapshot balance for a specific token
     * @param token Address of the token contract
     * @return Balance at snapshot time
     */
    function getSnapshotBalance(address token) external view returns (uint256) {
        return snapshot[token];
    }
}