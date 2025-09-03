# Generate Claim Kit and Identity Commitments Guide

A comprehensive guide to understanding the cryptographic foundations of the Semaphore-based inheritance vault system.

## Table of Contents

1. [Overview](#overview)
2. [Generate Claim Kit](#generate-claim-kit)
3. [Identity Commitments](#identity-commitments)
4. [Zero-Knowledge Proof Flow](#zero-knowledge-proof-flow)
5. [Security Considerations](#security-considerations)
6. [Technical Implementation](#technical-implementation)
7. [Examples](#examples)

## Overview

The inheritance vault system uses **Semaphore Protocol** to enable anonymous inheritance claims using zero-knowledge proofs. Two key concepts make this possible:

- **Generate Claim Kit**: Creates encrypted packages containing everything heirs need to claim inheritance
- **Identity Commitments**: Cryptographic commitments that prove group membership without revealing identity

## Generate Claim Kit

### What is a Claim Kit?

The **Generate Claim Kit** is a security feature that creates an encrypted digital package containing everything an heir needs to claim their inheritance. Think of it as a "digital inheritance key" that's securely packaged for distribution.

### Claim Kit Structure

```typescript
type ClaimKit = {
    identityPrivateKey: string,    // The heir's Semaphore identity private key
    groupId: string,               // The Semaphore group ID for the vault
    vaultAddress: string,          // The inheritance vault contract address
    merkleTreeDepth: number        // The depth of the Merkle tree (usually 20)
}
```

### How Generate Claim Kit Works

#### Step 1: Identity Creation
The owner generates a new Semaphore identity for an heir:

```typescript
const newIdentity = new Identity()
const identityCommitment = newIdentity.commitment.toString()
```

#### Step 2: Add Heir to Vault
The owner adds the heir's identity commitment to the vault:

```solidity
function addHeir(uint256 identityCommitment) external onlyOwner onlyAlive {
    semaphore.addMember(groupId, identityCommitment);
}
```

#### Step 3: Generate Encrypted Claim Kit
The owner creates an encrypted claim kit with a secure claim code:

```typescript
const claimKit: ClaimKit = {
    identityPrivateKey: identity.export(),
    groupId,
    vaultAddress,
    merkleTreeDepth: 20 // Standard Semaphore depth
}

const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify(claimKit), 
    claimCode
).toString()
```

#### Step 4: Secure Distribution
The owner distributes two pieces of information separately:
- **Encrypted Claim Kit**: Can be stored/transmitted through insecure channels
- **Claim Code**: Must be shared through a separate, secure channel

### Why This Process Matters

| Benefit | Description |
|---------|-------------|
| **Security** | The heir's private key is encrypted and can only be decrypted with the claim code |
| **Anonymity** | The heir's identity remains private until they choose to claim |
| **Portability** | The entire inheritance claim can be reduced to two pieces of information |
| **Future-proof** | Contains all necessary information for claiming, even years later |

## Identity Commitments

### What is an Identity Commitment?

The **Identity Commitment** is a fundamental concept in the Semaphore Protocol - it's a cryptographic commitment that represents an identity in a zero-knowledge proof system without revealing the actual identity.

### Mathematical Foundation

When you create a Semaphore identity:

```typescript
const identity = new Identity()
```

This generates:
- **Private Key** (secret): Used to generate proofs
- **Public Commitment** (shareable): Derived using `commitment = poseidon(privateKey)`

Where `poseidon` is a cryptographic hash function optimized for zero-knowledge proofs.

### Key Properties

#### 1. Hiding Property
- You cannot reverse-engineer the private key from the commitment
- The commitment reveals nothing about the underlying identity

#### 2. Binding Property  
- Each private key produces a unique commitment
- Different private keys will always produce different commitments

#### 3. Zero-Knowledge Friendly
- Designed to work efficiently in zero-knowledge circuits
- Enables proof generation without revealing secrets

### How Identity Commitments Enable Anonymous Groups

```typescript
// Multiple identities in a group
const heir1 = new Identity()
const heir2 = new Identity()
const heir3 = new Identity()

// Only their commitments are public
const commitments = [
    heir1.commitment.toString(),
    heir2.commitment.toString(), 
    heir3.commitment.toString()
]

// Anyone can verify group membership without knowing which heir is which
```

### Usage in the Inheritance System

#### Group Membership
When an owner adds an heir:

```solidity
function addHeir(uint256 identityCommitment) external onlyOwner onlyAlive {
    semaphore.addMember(groupId, identityCommitment);
}
```

The commitment is added to a Merkle tree of all heir commitments.

#### Anonymous Claims
When claiming, heirs prove they know the private key behind one of the commitments without revealing which one.

## Zero-Knowledge Proof Flow

### The Anonymous Claim Process

When an heir makes a claim, they generate a zero-knowledge proof that essentially says:

> "I know the private key behind one of the identity commitments in this Semaphore group, but I won't tell you which one"

### Proof Components

| Component | Purpose |
|-----------|---------|
| **Merkle Tree Root** | Proves the group membership without revealing which member |
| **Nullifier** | Prevents double-spending (derived from private key + external nullifier) |
| **Signal** | The actual claim data (payout address, amount, etc.) |
| **Points** | The zero-knowledge proof points that verify the claim |

### Technical Flow

```typescript
// 1. Heir decrypts their claim kit
const claimKit = decryptClaimKit(encryptedKit, claimCode)
const identity = Identity.import(claimKit.identityPrivateKey)

// 2. Build Merkle tree of all heirs
const members = await semaphore.getGroupMembers(groupId)
const group = new Group()
group.addMembers(members)

// 3. Calculate external nullifier (prevents reuse)
const externalNullifier = ethers.keccak256(
    ethers.solidityPacked(
        ["address", "uint256"],
        [vaultAddress, 1] // round = 1
    )
)

// 4. Calculate signal (claim parameters)
const signal = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [payoutAddress, amount, 0] // nonce = 0
    )
)

// 5. Generate zero-knowledge proof
const proof = await generateProof(identity, group, externalNullifier, signal)

// 6. Submit claim to blockchain
await vault.claim(
    proof.merkleTreeDepth,
    proof.merkleTreeRoot,
    proof.nullifier,
    signal,
    proof.points,
    payoutAddress,
    amount
)
```

### Contract Verification

The smart contract verifies the proof without learning the heir's identity:

```solidity
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

    // Verify proof via Semaphore (prevents nullifier reuse)
    semaphore.validateProof(groupId, proof);

    // TODO: Asset transfer logic
    emit Claimed(bytes32(nullifier), to, amount, abi.encode(signal));
}
```

## Security Considerations

### Claim Kit Security

| Threat | Mitigation |
|--------|------------|
| **Claim kit interception** | Kit is encrypted; useless without claim code |
| **Claim code compromise** | Code should be transmitted through separate secure channel |
| **Private key exposure** | Private key is never transmitted unencrypted |
| **Replay attacks** | Nullifiers prevent double-claims |

### Identity Commitment Security

| Property | Guarantee |
|----------|-----------|
| **Privacy** | Commitments reveal nothing about underlying identities |
| **Integrity** | Cannot forge membership without private key |
| **Non-repudiation** | Nullifiers cryptographically prevent double-claims |
| **Forward secrecy** | Old proofs cannot be reused for new claims |

### Best Practices

#### For Owners
1. **Generate strong claim codes** - Use cryptographically random passwords
2. **Separate distribution channels** - Never send claim kit and code together
3. **Secure storage** - Store backup copies of claim kits securely
4. **Regular updates** - Consider rotating heirs if security is compromised

#### For Heirs
1. **Secure claim code storage** - Use password managers or secure notes
2. **Verify claim kit integrity** - Ensure successful decryption before relying on it
3. **Timely claiming** - Don't delay unnecessarily once claims are open
4. **Private claiming** - Use private RPCs or Tor for additional anonymity

## Technical Implementation

### Frontend Integration (React/TypeScript)

```typescript
// Generate claim kit (Owner)
const generateClaimKit = (identityPrivateKey: string, claimCode: string): string => {
    const CryptoJS = require('crypto-js')
    
    const claimKit: ClaimKit = {
        identityPrivateKey,
        groupId,
        vaultAddress,
        merkleTreeDepth: 20
    }

    return CryptoJS.AES.encrypt(JSON.stringify(claimKit), claimCode).toString()
}

// Decrypt claim kit (Heir)
const decryptClaimKit = (encryptedKit: string, claimCode: string): ClaimKit | null => {
    try {
        const CryptoJS = require('crypto-js')
        const bytes = CryptoJS.AES.decrypt(encryptedKit, claimCode)
        const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
        return JSON.parse(decryptedData) as ClaimKit
    } catch {
        return null
    }
}
```

### Smart Contract Integration (Solidity)

```solidity
contract InheritanceVault is Ownable {
    ISemaphore public semaphore;
    uint256 public groupId;
    
    // Add heir to Semaphore group
    function addHeir(uint256 identityCommitment) external onlyOwner onlyAlive {
        semaphore.addMember(groupId, identityCommitment);
    }
    
    // Verify and process anonymous claim
    function claim(
        uint256 merkleTreeDepth,
        uint256 merkleTreeRoot,
        uint256 nullifier,
        uint256 signal,
        uint256[8] calldata points,
        address to,
        uint256 amount
    ) external {
        // Verification logic here
        semaphore.validateProof(groupId, proof);
        
        // Asset transfer logic (TODO)
        emit Claimed(bytes32(nullifier), to, amount, abi.encode(signal));
    }
}
```

## Examples

### Complete Inheritance Flow Example

#### Phase 1: Setup (Owner)

```typescript
// 1. Deploy inheritance vault with Semaphore integration
const vault = await deployInheritanceVault(
    semaphoreAddress,
    86400,  // 24 hour heartbeat interval
    604800  // 7 day challenge window
)

// 2. Generate identity for heir
const heirIdentity = new Identity()
console.log("Heir commitment:", heirIdentity.commitment.toString())

// 3. Add heir to vault
await vault.addHeir(heirIdentity.commitment.toString())

// 4. Generate encrypted claim kit
const claimCode = "secure-passphrase-123"
const encryptedKit = generateClaimKit(heirIdentity.export(), claimCode)

// 5. Distribute securely
console.log("Encrypted claim kit:", encryptedKit)
console.log("Share claim code separately:", claimCode)
```

#### Phase 2: Inheritance Event

```typescript
// 1. Owner stops sending heartbeats
// 2. Anyone can start expiry process after deadline
await vault.startExpiry()

// 3. Challenge window begins (owner can still revoke)
// 4. After challenge window ends, claims become available
```

#### Phase 3: Claiming (Heir)

```typescript
// 1. Heir decrypts claim kit
const claimKit = decryptClaimKit(encryptedKit, claimCode)
const identity = Identity.import(claimKit.identityPrivateKey)

// 2. Build proof of group membership
const members = await semaphore.getGroupMembers(claimKit.groupId)
const group = new Group()
group.addMembers(members)

// 3. Generate anonymous claim proof
const externalNullifier = ethers.keccak256(
    ethers.solidityPacked(["address", "uint256"], [claimKit.vaultAddress, 1])
)

const signal = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [payoutAddress, amount, 0]
    )
)

const proof = await generateProof(identity, group, externalNullifier, signal)

// 4. Submit anonymous claim
await vault.claim(
    proof.merkleTreeDepth,
    proof.merkleTreeRoot,
    proof.nullifier,
    signal,
    proof.points,
    payoutAddress,
    amount
)

console.log("Inheritance claimed anonymously!")
```

### Error Handling Examples

```typescript
// Claim kit decryption error handling
try {
    const kit = decryptClaimKit(encryptedKit, claimCode)
    if (!kit) {
        throw new Error("Invalid claim code or corrupted claim kit")
    }
    console.log("Claim kit decrypted successfully")
} catch (error) {
    console.error("Decryption failed:", error.message)
    // Guide user to verify claim code or request new claim kit
}

// Proof generation error handling
try {
    const proof = await generateProof(identity, group, externalNullifier, signal)
    console.log("Proof generated successfully")
} catch (error) {
    console.error("Proof generation failed:", error.message)
    // Common issues: identity not in group, invalid parameters
}

// Claim submission error handling
try {
    const tx = await vault.claim(/* parameters */)
    const receipt = await tx.wait()
    if (receipt.status === 1) {
        console.log("Claim successful!")
    }
} catch (error) {
    console.error("Claim failed:", error.message)
    // Common issues: claims not open, invalid proof, already claimed
}
```

## Conclusion

The combination of **Generate Claim Kit** and **Identity Commitments** creates a powerful inheritance system that preserves privacy while ensuring security. Key benefits include:

1. **Privacy-Preserving**: Heirs can claim inheritance without revealing their identity
2. **Secure**: Cryptographic guarantees prevent fraud and double-claims  
3. **Portable**: Entire inheritance claim reduces to two pieces of information
4. **Future-Proof**: System works independently of external trusted parties
5. **Efficient**: Scales to large numbers of heirs without performance degradation

This system elegantly solves the digital inheritance problem while maintaining the privacy and security guarantees that make zero-knowledge proofs so powerful.

---

*For technical support or questions about implementation, refer to the [Semaphore Protocol documentation](https://docs.semaphore.pse.dev/) or the project's smart contracts.*
