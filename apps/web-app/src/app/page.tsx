"use client"

import { 
    Box, 
    Button, 
    Divider, 
    Heading, 
    HStack, 
    VStack,
    Link, 
    Text, 
    Card,
    CardBody,
    Badge
} from "@chakra-ui/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useLogContext } from "../context/LogContext"
import { useInheritanceVaultContext } from "../context/InheritanceVaultContext"

export default function HomePage() {
    const router = useRouter()
    const { setLog } = useLogContext()
    const { vaultInfo, isLoading } = useInheritanceVaultContext()

    useEffect(() => {
        setLog("Welcome to NomadKit! Navigate to Owner or Claim pages.")
    }, [setLog])

    return (
        <VStack spacing={6} align="stretch">
            <Heading as="h2" size="xl">
                NomadKit
            </Heading>

            <Text pt="2" fontSize="md" color="gray.600">
                A decentralized inheritance system using{" "}
                <Link href="https://docs.semaphore.pse.dev/" isExternal color="blue.500">
                    Semaphore Protocol
                </Link>{" "}
                for anonymous proof verification. Owners can add heirs and heirs can claim assets after expiry using zero-knowledge proofs.
            </Text>

            {vaultInfo && (
                <Card>
                    <CardBody>
                        <VStack align="start" spacing={3}>
                            <HStack justify="space-between" w="full">
                                <Heading size="md">Vault Status</Heading>
                                <Badge colorScheme={vaultInfo.isAlive ? "green" : "red"}>
                                    {vaultInfo.isAlive ? "ALIVE" : "EXPIRED"}
                                </Badge>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Contract:</Text>
                                <Text fontFamily="mono" fontSize="sm">{vaultInfo.address}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Group ID:</Text>
                                <Text>{vaultInfo.groupId}</Text>
                            </HStack>
                            <HStack>
                                <Text fontWeight="bold">Claims:</Text>
                                <Badge colorScheme={vaultInfo.claimOpen ? "orange" : "gray"}>
                                    {vaultInfo.claimOpen ? "OPEN" : "CLOSED"}
                                </Badge>
                            </HStack>
                        </VStack>
                    </CardBody>
                </Card>
            )}

            <Divider />

            <VStack spacing={4}>
                <Heading size="lg">What would you like to do?</Heading>
                
                <HStack spacing={4} w="full">
                    <Button 
                        size="lg" 
                        colorScheme="blue" 
                        flex={1}
                        onClick={() => router.push("/owner")}
                    >
                        Owner Dashboard
                    </Button>
                    
                    <Button 
                        size="lg" 
                        colorScheme="green" 
                        flex={1}
                        onClick={() => router.push("/claim")}
                    >
                        Claim Inheritance
                    </Button>
                </HStack>

                <VStack spacing={2} fontSize="sm" color="gray.500">
                    <Text>• <strong>Owner Dashboard:</strong> Add heirs, manage vault, generate claim kits</Text>
                    <Text>• <strong>Claim Inheritance:</strong> Submit inheritance claims using encrypted claim kits</Text>
                </VStack>
            </VStack>

            <Divider />

            <Box>
                <Heading size="md" mb={3}>How it Works</Heading>
                <VStack align="start" spacing={2} fontSize="sm">
                    <Text><strong>1. Setup:</strong> Owner deploys vault and adds heir identities</Text>
                    <Text><strong>2. Heartbeat:</strong> Owner sends periodic heartbeats to stay alive</Text>
                    <Text><strong>3. Expiry:</strong> If heartbeat is missed, expiry process begins</Text>
                    <Text><strong>4. Challenge:</strong> Owner has a window to revoke expiry</Text>
                    <Text><strong>5. Claim:</strong> After challenge window, heirs can claim with ZK proofs</Text>
                </VStack>
            </Box>
        </VStack>
    )
}
