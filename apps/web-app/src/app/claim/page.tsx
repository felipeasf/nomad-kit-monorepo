"use client"

import {
    Box,
    Button,
    Divider,
    Heading,
    HStack,
    VStack,
    Text,
    Input,
    FormControl,
    FormLabel,
    Alert,
    AlertIcon,
    Card,
    CardBody,
    CardHeader,
    Badge,
    useToast,
    Textarea,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    NumberIncrementStepper,
    NumberDecrementStepper
} from "@chakra-ui/react"
import { Identity } from "@semaphore-protocol/identity"
import { Group } from "@semaphore-protocol/group"
import { generateProof } from "@semaphore-protocol/proof"
import { SemaphoreEthers } from "@semaphore-protocol/data"
import { ethers } from "ethers"
import { useEffect, useState } from "react"
import { useInheritanceVaultContext, ClaimKit } from "../../context/InheritanceVaultContext"
import { useLogContext } from "../../context/LogContext"
import Stepper from "../../components/Stepper"
import { InheritanceVaultABI } from "../../lib/InheritanceVaultABI"

export default function ClaimPage() {
    const { vaultInfo, decryptClaimKit } = useInheritanceVaultContext()
    const { setLog } = useLogContext()
    const toast = useToast()
    
    const [claimKitText, setClaimKitText] = useState("")
    const [claimCode, setClaimCode] = useState("")
    const [payoutAddress, setPayoutAddress] = useState("")
    const [amount, setAmount] = useState("1000000000000000000") // 1 ETH in wei
    const [decryptedKit, setDecryptedKit] = useState<ClaimKit | null>(null)
    const [identity, setIdentity] = useState<Identity | null>(null)
    const [isGeneratingProof, setIsGeneratingProof] = useState(false)
    const [isSubmittingClaim, setIsSubmittingClaim] = useState(false)
    const [transactionHash, setTransactionHash] = useState("")

    useEffect(() => {
        setLog("Claim page loaded. Heirs can submit NomadKit inheritance claims here.")
    }, [setLog])

    const handleDecryptClaimKit = () => {
        if (!claimKitText || !claimCode) {
            toast({
                title: "Error",
                description: "Please enter both the claim kit and claim code",
                status: "error",
                duration: 5000,
                isClosable: true
            })
            return
        }

        try {
            const kit = decryptClaimKit(claimKitText, claimCode)
            if (!kit) {
                throw new Error("Failed to decrypt claim kit. Check your claim code.")
            }
            
            setDecryptedKit(kit)
            
            // Reconstruct identity from decrypted kit using the exported private key
            const reconstructedIdentity = Identity.import(kit.identityPrivateKey)
            setIdentity(reconstructedIdentity)
            
            setLog("Claim kit decrypted successfully. Identity reconstructed.")
            toast({
                title: "Success",
                description: "Claim kit decrypted and identity reconstructed!",
                status: "success",
                duration: 5000,
                isClosable: true
            })
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to decrypt claim kit",
                status: "error",
                duration: 5000,
                isClosable: true
            })
        }
    }

    const handleConnectWallet = async () => {
        if (typeof window !== "undefined" && (window as any).ethereum) {
            try {
                const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' })
                if (accounts.length > 0) {
                    setPayoutAddress(accounts[0])
                    setLog(`Wallet connected: ${accounts[0]}`)
                }
            } catch (err) {
                toast({
                    title: "Error",
                    description: "Failed to connect wallet",
                    status: "error",
                    duration: 5000,
                    isClosable: true
                })
            }
        }
    }

    const handleSubmitClaim = async () => {
        if (!decryptedKit || !identity || !payoutAddress || !vaultInfo) {
            toast({
                title: "Error",
                description: "Please decrypt claim kit, connect wallet, and ensure vault is loaded",
                status: "error",
                duration: 5000,
                isClosable: true
            })
            return
        }

        if (!vaultInfo.claimOpen) {
            toast({
                title: "Error", 
                description: "Claims are not open yet. Wait for the challenge window to end.",
                status: "error",
                duration: 5000,
                isClosable: true
            })
            return
        }

        try {
            setIsGeneratingProof(true)
            setLog("Generating zero-knowledge proof...")

            // Get current group members to build the Merkle tree
            const ethereumNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "localhost"
                ? "http://127.0.0.1:8545"
                : process.env.NEXT_PUBLIC_DEFAULT_NETWORK
            
            console.log("🌐 Claim page using network:", ethereumNetwork)
            
            const semaphore = new SemaphoreEthers(ethereumNetwork, {
                address: process.env.NEXT_PUBLIC_SEMAPHORE_CONTRACT_ADDRESS,
                projectId: process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "localhost" 
                    ? undefined 
                    : process.env.NEXT_PUBLIC_INFURA_API_KEY
            })

            const members = await semaphore.getGroupMembers(decryptedKit.groupId)
            const group = new Group()
            group.addMembers(members)

            // Calculate external nullifier (consistent with contract)
            const externalNullifier = ethers.keccak256(
                ethers.solidityPacked(
                    ["address", "uint256"],
                    [decryptedKit.vaultAddress, 1] // round = 1
                )
            )

            // Calculate signal (payout parameters hash)
            const signal = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256", "uint256"],
                    [payoutAddress, amount, 0] // nonce = 0 for now
                )
            )

            setLog("Building Merkle tree and generating proof...")

            // Generate the proof
            const proof = await generateProof(identity, group, externalNullifier, signal)
            
            setIsGeneratingProof(false)
            setIsSubmittingClaim(true)
            setLog("Proof generated. Submitting claim to blockchain...")

            // Connect to contract and submit claim
            const provider = new ethers.BrowserProvider((window as any).ethereum)
            const signer = await provider.getSigner()
            const contract = new ethers.Contract(
                decryptedKit.vaultAddress,
                InheritanceVaultABI,
                signer
            )

            const tx = await contract.claim(
                proof.merkleTreeDepth,
                proof.merkleTreeRoot,
                proof.nullifier,
                signal,
                proof.points,
                payoutAddress,
                amount
            )

            setLog(`Transaction submitted: ${tx.hash}`)
            setTransactionHash(tx.hash)

            const receipt = await tx.wait()
            
            if (receipt.status === 1) {
                toast({
                    title: "Success!",
                    description: `Claim submitted successfully! Transaction: ${tx.hash}`,
                    status: "success",
                    duration: 10000,
                    isClosable: true
                })
                setLog(`Claim successful! Assets claimed to ${payoutAddress}`)
            } else {
                throw new Error("Transaction failed")
            }

        } catch (err) {
            console.error("Claim error:", err)
            const errorMessage = err instanceof Error ? err.message : "Failed to submit claim"
            toast({
                title: "Error",
                description: errorMessage,
                status: "error",
                duration: 5000,
                isClosable: true
            })
            setLog(`Claim failed: ${errorMessage}`)
        } finally {
            setIsGeneratingProof(false)
            setIsSubmittingClaim(false)
        }
    }

    return (
        <VStack spacing={6} align="stretch">
            <Heading as="h2" size="xl">
                NomadKit Inheritance Claim
            </Heading>

            <Text color="gray.600">
                Use your encrypted claim kit and claim code to submit an inheritance claim.
            </Text>

            {vaultInfo && (
                <Alert status={vaultInfo.claimOpen ? "success" : "warning"}>
                    <AlertIcon />
                    <VStack align="start" spacing={1}>
                        <Text fontWeight="bold">
                            Vault Status: {vaultInfo.isAlive ? "ALIVE" : "EXPIRED"}
                        </Text>
                        <Text fontSize="sm">
                            Claims are {vaultInfo.claimOpen ? "OPEN" : "NOT OPEN"}
                            {!vaultInfo.claimOpen && vaultInfo.challengeWindowEnd > 0 && 
                                ` - Challenge window ends ${new Date(vaultInfo.challengeWindowEnd * 1000).toLocaleString()}`
                            }
                        </Text>
                    </VStack>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <Heading size="md">Step 1: Decrypt Claim Kit</Heading>
                </CardHeader>
                <CardBody>
                    <VStack spacing={4} align="stretch">
                        <FormControl>
                            <FormLabel>Encrypted Claim Kit</FormLabel>
                            <Textarea
                                value={claimKitText}
                                onChange={(e) => setClaimKitText(e.target.value)}
                                placeholder="Paste your encrypted claim kit here"
                                rows={6}
                                fontSize="sm"
                                fontFamily="mono"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel>Claim Code</FormLabel>
                            <Input
                                value={claimCode}
                                onChange={(e) => setClaimCode(e.target.value)}
                                placeholder="Enter your claim code"
                                type="password"
                            />
                        </FormControl>

                        <Button 
                            onClick={handleDecryptClaimKit}
                            colorScheme="blue"
                            isDisabled={!claimKitText || !claimCode}
                        >
                            Decrypt Claim Kit
                        </Button>
                    </VStack>
                </CardBody>
            </Card>

            {decryptedKit && identity && (
                <Card>
                    <CardHeader>
                        <HStack justify="space-between">
                            <Heading size="md">Decrypted Claim Information</Heading>
                            <Badge colorScheme="green">VERIFIED</Badge>
                        </HStack>
                    </CardHeader>
                    <CardBody>
                        <VStack align="start" spacing={3}>
                            <HStack>
                                <Text fontWeight="bold">Vault Address:</Text>
                                <Text fontFamily="mono" fontSize="sm">{decryptedKit.vaultAddress}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Group ID:</Text>
                                <Text>{decryptedKit.groupId}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Identity Commitment:</Text>
                                <Text fontFamily="mono" fontSize="sm">{identity.commitment.toString()}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Merkle Tree Depth:</Text>
                                <Text>{decryptedKit.merkleTreeDepth}</Text>
                            </HStack>
                        </VStack>
                    </CardBody>
                </Card>
            )}

            {decryptedKit && (
                <Card>
                    <CardHeader>
                        <Heading size="md">Step 2: Configure Claim</Heading>
                    </CardHeader>
                    <CardBody>
                        <VStack spacing={4} align="stretch">
                            <FormControl>
                                <FormLabel>Payout Address</FormLabel>
                                <HStack>
                                    <Input
                                        value={payoutAddress}
                                        onChange={(e) => setPayoutAddress(e.target.value)}
                                        placeholder="Enter payout address or connect wallet"
                                        fontFamily="mono"
                                        fontSize="sm"
                                    />
                                    <Button onClick={handleConnectWallet} size="sm">
                                        Connect Wallet
                                    </Button>
                                </HStack>
                            </FormControl>

                            <FormControl>
                                <FormLabel>Amount (wei)</FormLabel>
                                <NumberInput value={amount} onChange={setAmount}>
                                    <NumberInputField />
                                    <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                    </NumberInputStepper>
                                </NumberInput>
                                <Text fontSize="xs" color="gray.500" mt={1}>
                                    {amount && !isNaN(Number(amount)) 
                                        ? `≈ ${ethers.formatEther(amount)} ETH` 
                                        : "Invalid amount"
                                    }
                                </Text>
                            </FormControl>
                        </VStack>
                    </CardBody>
                </Card>
            )}

            {decryptedKit && payoutAddress && (
                <Card>
                    <CardHeader>
                        <Heading size="md">Step 3: Submit Claim</Heading>
                    </CardHeader>
                    <CardBody>
                        <VStack spacing={4} align="stretch">
                            <Alert status="info">
                                <AlertIcon />
                                <VStack align="start" spacing={1}>
                                    <Text fontWeight="bold">Ready to submit claim</Text>
                                    <Text fontSize="sm">
                                        This will generate a zero-knowledge proof and submit your claim to the blockchain.
                                    </Text>
                                </VStack>
                            </Alert>

                            <Button 
                                onClick={handleSubmitClaim}
                                colorScheme="green"
                                size="lg"
                                isLoading={isGeneratingProof || isSubmittingClaim}
                                loadingText={isGeneratingProof ? "Generating Proof..." : "Submitting..."}
                                isDisabled={!vaultInfo?.claimOpen}
                            >
                                Submit Inheritance Claim
                            </Button>

                            {transactionHash && (
                                <Alert status="success">
                                    <AlertIcon />
                                    <VStack align="start" spacing={1}>
                                        <Text fontWeight="bold">Claim Submitted Successfully!</Text>
                                        <Text fontSize="sm" fontFamily="mono">
                                            Transaction Hash: {transactionHash}
                                        </Text>
                                        <Text fontSize="sm">
                                            Assets will be transferred to: {payoutAddress}
                                        </Text>
                                    </VStack>
                                </Alert>
                            )}
                        </VStack>
                    </CardBody>
                </Card>
            )}

            <Stepper step={2} onNextClick={() => window.location.href = '/'} />
        </VStack>
    )
}
