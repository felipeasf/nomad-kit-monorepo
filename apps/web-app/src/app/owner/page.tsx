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
    useClipboard
} from "@chakra-ui/react"
import { Identity } from "@semaphore-protocol/identity"
import { useEffect, useState } from "react"
import { useInheritanceVaultContext } from "../../context/InheritanceVaultContext"
import { useLogContext } from "../../context/LogContext"
import Stepper from "../../components/Stepper"

export default function OwnerPage() {
    const { vaultInfo, heirs, isLoading, error, refreshVaultInfo, addHeir, generateClaimKit } = useInheritanceVaultContext()
    const { setLog } = useLogContext()
    const toast = useToast()
    
    const [identityCommitment, setIdentityCommitment] = useState("")
    const [isAddingHeir, setIsAddingHeir] = useState(false)
    const [claimCode, setClaimCode] = useState("")
    const [generatedIdentity, setGeneratedIdentity] = useState<Identity | null>(null)
    const [encryptedClaimKit, setEncryptedClaimKit] = useState("")
    
    const { onCopy, setValue, hasCopied } = useClipboard(encryptedClaimKit)

    useEffect(() => {
        setLog("Owner dashboard loaded. Manage your NomadKit vault here.")
    }, [setLog])

    useEffect(() => {
        if (encryptedClaimKit) {
            setValue(encryptedClaimKit)
        }
    }, [encryptedClaimKit, setValue])

    const handleGenerateIdentity = () => {
        const newIdentity = new Identity()
        setGeneratedIdentity(newIdentity)
        setIdentityCommitment(newIdentity.commitment.toString())
        setLog("New Semaphore identity generated for heir")
    }

    const handleAddHeir = async () => {
        if (!identityCommitment) {
            toast({
                title: "Error",
                description: "Please enter or generate an identity commitment",
                status: "error",
                duration: 5000,
                isClosable: true
            })
            return
        }

        try {
            setIsAddingHeir(true)
            await addHeir(identityCommitment)
            
            toast({
                title: "Success",
                description: "Heir added successfully!",
                status: "success",
                duration: 5000,
                isClosable: true
            })
            
            setLog(`Heir with commitment ${identityCommitment.slice(0, 10)}... added to the vault`)
            
            // Clear only the commitment input, keep the generated identity for claim kit generation
            setIdentityCommitment("")
            // Note: We keep generatedIdentity so user can still generate claim kit
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to add heir",
                status: "error",
                duration: 5000,
                isClosable: true
            })
        } finally {
            setIsAddingHeir(false)
        }
    }

    const handleGenerateClaimKit = () => {
        if (!generatedIdentity || !claimCode) {
            toast({
                title: "Error",
                description: "Please generate an identity and enter a claim code",
                status: "error",
                duration: 5000,
                isClosable: true
            })
            return
        }

        try {
            const encrypted = generateClaimKit(
                generatedIdentity.export(),
                claimCode
            )
            setEncryptedClaimKit(encrypted)
            setLog("Claim Kit generated and encrypted with provided code")
        } catch (err) {
            toast({
                title: "Error",
                description: "Failed to generate claim kit",
                status: "error",
                duration: 5000,
                isClosable: true
            })
        }
    }

    const formatTime = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString()
    }

    const formatDuration = (seconds: number) => {
        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        return `${days}d ${hours}h`
    }

    if (isLoading) {
        return (
            <Box>
                <Heading as="h2" size="xl" mb={6}>
                    Owner Dashboard
                </Heading>
                <Text>Loading vault information...</Text>
            </Box>
        )
    }

    if (error) {
        return (
            <Box>
                <Heading as="h2" size="xl" mb={6}>
                    Owner Dashboard
                </Heading>
                <Alert status="error">
                    <AlertIcon />
                    {error}
                </Alert>
                <Button mt={4} onClick={refreshVaultInfo}>
                    Retry
                </Button>
            </Box>
        )
    }

    return (
        <VStack spacing={6} align="stretch">
            <Heading as="h2" size="xl">
                Owner Dashboard
            </Heading>

            {vaultInfo && (
                <Card>
                    <CardHeader>
                        <HStack justify="space-between">
                            <Heading size="md">Vault Information</Heading>
                            <Badge colorScheme={vaultInfo.isAlive ? "green" : "red"}>
                                {vaultInfo.isAlive ? "ALIVE" : "EXPIRED"}
                            </Badge>
                        </HStack>
                    </CardHeader>
                    <CardBody>
                        <VStack align="start" spacing={3}>
                            <HStack>
                                <Text fontWeight="bold">Address:</Text>
                                <Text fontFamily="mono" fontSize="sm">{vaultInfo.address}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Group ID:</Text>
                                <Text>{vaultInfo.groupId}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Owner:</Text>
                                <Text fontFamily="mono" fontSize="sm">{vaultInfo.owner}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Heartbeat Interval:</Text>
                                <Text>{formatDuration(vaultInfo.heartbeatInterval)}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Challenge Window:</Text>
                                <Text>{formatDuration(vaultInfo.challengeWindow)}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Next Deadline:</Text>
                                <Text>{formatTime(vaultInfo.nextDeadline)}</Text>
                            </HStack>
                            {vaultInfo.challengeWindowEnd > 0 && (
                                <HStack>
                                    <Text fontWeight="bold">Challenge Window Ends:</Text>
                                    <Text>{formatTime(vaultInfo.challengeWindowEnd)}</Text>
                                </HStack>
                            )}
                            <HStack>
                                <Text fontWeight="bold">Claim Status:</Text>
                                <Badge colorScheme={vaultInfo.claimOpen ? "orange" : "gray"}>
                                    {vaultInfo.claimOpen ? "CLAIMABLE" : "NOT CLAIMABLE"}
                                </Badge>
                            </HStack>
                        </VStack>
                    </CardBody>
                </Card>
            )}

            <Divider />

            <Card>
                <CardHeader>
                    <Heading size="md">Add New Heir</Heading>
                </CardHeader>
                <CardBody>
                    <VStack spacing={4} align="stretch">
                        <FormControl>
                            <FormLabel>Identity Commitment</FormLabel>
                            <HStack>
                                <Input
                                    value={identityCommitment}
                                    onChange={(e) => setIdentityCommitment(e.target.value)}
                                    placeholder="Enter identity commitment or generate one below"
                                />
                                <Button onClick={handleGenerateIdentity} size="sm">
                                    Generate
                                </Button>
                            </HStack>
                        </FormControl>

                        {generatedIdentity && (
                            <Box p={4} bg="gray.50" borderRadius="md">
                                <Text fontSize="sm" mb={2}>
                                    <strong>Generated Identity Details:</strong>
                                </Text>
                                <VStack align="start" spacing={1} fontSize="xs" fontFamily="mono">
                                    <Text><strong>Commitment:</strong> {generatedIdentity.commitment.toString()}</Text>
                                    <Text><strong>Private Key (first 20 chars):</strong> {generatedIdentity.export().slice(0, 20)}...</Text>
                                </VStack>
                            </Box>
                        )}

                        <Button 
                            onClick={handleAddHeir} 
                            isLoading={isAddingHeir}
                            colorScheme="blue"
                            isDisabled={!identityCommitment}
                        >
                            Add Heir
                        </Button>
                    </VStack>
                </CardBody>
            </Card>

            <Card>
                <CardHeader>
                    <Heading size="md">Generate Claim Kit</Heading>
                </CardHeader>
                <CardBody>
                    <VStack spacing={4} align="stretch">
                        <FormControl>
                            <FormLabel>Claim Code (for encryption)</FormLabel>
                            <Input
                                value={claimCode}
                                onChange={(e) => setClaimCode(e.target.value)}
                                placeholder="Enter a secure claim code"
                                type="password"
                            />
                        </FormControl>

                        <Button 
                            onClick={handleGenerateClaimKit} 
                            colorScheme="green"
                            isDisabled={!claimCode || !generatedIdentity}
                        >
                            Generate Encrypted Claim Kit
                        </Button>
                        
                        {!generatedIdentity && (
                            <Alert status="info" fontSize="sm">
                                <AlertIcon />
                                Please generate an identity above first to create a claim kit.
                            </Alert>
                        )}

                        {encryptedClaimKit && (
                            <Box>
                                <FormLabel>Encrypted Claim Kit</FormLabel>
                                <Textarea
                                    value={encryptedClaimKit}
                                    isReadOnly
                                    rows={6}
                                    fontSize="xs"
                                    fontFamily="mono"
                                />
                                <HStack mt={2}>
                                    <Button onClick={onCopy} size="sm">
                                        {hasCopied ? "Copied!" : "Copy to Clipboard"}
                                    </Button>
                                    <Button 
                                        as="a"
                                        href={`data:text/plain;charset=utf-8,${encodeURIComponent(encryptedClaimKit)}`}
                                        download="claim-kit.txt"
                                        size="sm"
                                        variant="outline"
                                    >
                                        Download
                                    </Button>
                                </HStack>
                                <Alert status="warning" mt={2} fontSize="sm">
                                    <AlertIcon />
                                    Share this encrypted claim kit and the claim code with your heir securely.
                                    They will need both to claim inheritance.
                                </Alert>
                            </Box>
                        )}
                    </VStack>
                </CardBody>
            </Card>

            <Divider />

            <Card>
                <CardHeader>
                    <Heading size="md">Current Heirs ({heirs.length})</Heading>
                </CardHeader>
                <CardBody>
                    {heirs.length === 0 ? (
                        <Text color="gray.500">No heirs added yet</Text>
                    ) : (
                        <VStack align="start" spacing={2}>
                            {heirs.map((heir, index) => (
                                <HStack key={index} w="full">
                                    <Text fontWeight="bold">#{index + 1}:</Text>
                                    <Text fontFamily="mono" fontSize="sm">{heir}</Text>
                                </HStack>
                            ))}
                        </VStack>
                    )}
                </CardBody>
            </Card>

            <Stepper step={1} onNextClick={() => window.location.href = '/claim'} />
        </VStack>
    )
}
