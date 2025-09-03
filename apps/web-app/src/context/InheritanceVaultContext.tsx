"use client"

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react"
import { SemaphoreEthers } from "@semaphore-protocol/data"
import { ethers } from "ethers"
import { InheritanceVaultABI } from "../lib/InheritanceVaultABI"

export type VaultInfo = {
    address: string
    groupId: string
    owner: string
    heartbeatInterval: number
    challengeWindow: number
    nextDeadline: number
    challengeWindowEnd: number
    isAlive: boolean
    claimOpen: boolean
}

export type ClaimKit = {
    identityPrivateKey: string
    groupId: string
    vaultAddress: string
    merkleTreeDepth: number
}

export type InheritanceVaultContextType = {
    vaultInfo: VaultInfo | null
    heirs: string[]
    isLoading: boolean
    error: string | null
    refreshVaultInfo: () => Promise<void>
    refreshHeirs: () => Promise<void>
    addHeir: (identityCommitment: string) => Promise<void>
    generateClaimKit: (identityPrivateKey: string, claimCode: string) => string
    decryptClaimKit: (encryptedKit: string, claimCode: string) => ClaimKit | null
}

const InheritanceVaultContext = createContext<InheritanceVaultContextType | null>(null)

interface ProviderProps {
    children: ReactNode
}

const ethereumNetwork =
    process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "localhost"
        ? "http://127.0.0.1:8545"
        : process.env.NEXT_PUBLIC_DEFAULT_NETWORK

console.log("🌐 Using network:", ethereumNetwork)
console.log("🌐 Environment NEXT_PUBLIC_DEFAULT_NETWORK:", process.env.NEXT_PUBLIC_DEFAULT_NETWORK)

export const InheritanceVaultContextProvider: React.FC<ProviderProps> = ({ children }) => {
    const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null)
    const [heirs, setHeirs] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const vaultAddress = process.env.NEXT_PUBLIC_VAULT_ADDRESS as string
    const semaphoreAddress = process.env.NEXT_PUBLIC_SEMAPHORE_CONTRACT_ADDRESS as string
    const groupId = process.env.NEXT_PUBLIC_GROUP_ID as string

    const getVaultContract = useCallback(() => {
        if (typeof window !== "undefined" && (window as any).ethereum) {
            const provider = new ethers.BrowserProvider((window as any).ethereum)
            return new ethers.Contract(vaultAddress, InheritanceVaultABI, provider)
        }
        return null
    }, [vaultAddress])

    const getVaultContractWithSigner = useCallback(async () => {
        if (typeof window !== "undefined" && (window as any).ethereum) {
            const provider = new ethers.BrowserProvider((window as any).ethereum)
            const signer = await provider.getSigner()
            return new ethers.Contract(vaultAddress, InheritanceVaultABI, signer)
        }
        return null
    }, [vaultAddress])

    const refreshVaultInfo = useCallback(async (): Promise<void> => {
        try {
            setIsLoading(true)
            setError(null)
            
            const contract = getVaultContract()
            if (!contract) {
                throw new Error("Could not connect to contract")
            }

            // Hardcode owner for now to debug other functions
            const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" // Default Hardhat account
            
            console.log("Testing contract functions one by one...")
            console.log("Contract address:", vaultAddress)
            console.log("Contract:", contract)
            
            // Test functions one by one to isolate the issue
            let heartbeatInterval, challengeWindow, nextDeadline, challengeWindowEnd, isAlive, claimOpen
            
            try {
                console.log("Testing heartbeatInterval()...")
                heartbeatInterval = await contract.heartbeatInterval()
                console.log("✅ heartbeatInterval:", heartbeatInterval.toString())
            } catch (err) {
                console.error("❌ heartbeatInterval failed:", err)
                heartbeatInterval = 86400 // fallback
            }
            
            try {
                console.log("Testing challengeWindow()...")
                challengeWindow = await contract.challengeWindow()
                console.log("✅ challengeWindow:", challengeWindow.toString())
            } catch (err) {
                console.error("❌ challengeWindow failed:", err)
                challengeWindow = 604800 // fallback
            }
            
            try {
                console.log("Testing nextDeadline()...")
                nextDeadline = await contract.nextDeadline()
                console.log("✅ nextDeadline:", nextDeadline.toString())
            } catch (err) {
                console.error("❌ nextDeadline failed:", err)
                nextDeadline = 0 // fallback
            }
            
            try {
                console.log("Testing challengeWindowEnd()...")
                challengeWindowEnd = await contract.challengeWindowEnd()
                console.log("✅ challengeWindowEnd:", challengeWindowEnd.toString())
            } catch (err) {
                console.error("❌ challengeWindowEnd failed:", err)
                challengeWindowEnd = 0 // fallback
            }
            
            try {
                console.log("Testing isAlive()...")
                isAlive = await contract.isAlive()
                console.log("✅ isAlive:", isAlive)
            } catch (err) {
                console.error("❌ isAlive failed:", err)
                isAlive = true // fallback
            }
            
            try {
                console.log("Testing claimOpen()...")
                claimOpen = await contract.claimOpen()
                console.log("✅ claimOpen:", claimOpen)
            } catch (err) {
                console.error("❌ claimOpen failed:", err)
                claimOpen = false // fallback
            }

            setVaultInfo({
                address: vaultAddress,
                groupId,
                owner,
                heartbeatInterval: Number(heartbeatInterval),
                challengeWindow: Number(challengeWindow),
                nextDeadline: Number(nextDeadline),
                challengeWindowEnd: Number(challengeWindowEnd),
                isAlive,
                claimOpen
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch vault info')
        } finally {
            setIsLoading(false)
        }
    }, [vaultAddress, groupId, getVaultContract])

    const refreshHeirs = useCallback(async (): Promise<void> => {
        try {
            console.log("🌐 Fetching heirs using network:", ethereumNetwork)
            console.log("🌐 Semaphore address:", semaphoreAddress)
            console.log("🌐 Group ID:", groupId)
            
            const semaphore = new SemaphoreEthers(ethereumNetwork, {
                address: semaphoreAddress,
                projectId: process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "localhost" 
                    ? undefined 
                    : process.env.NEXT_PUBLIC_INFURA_API_KEY
            })

            const members = await semaphore.getGroupMembers(groupId)
            console.log("✅ Retrieved group members:", members)
            setHeirs(members.map((member) => member.toString()))
        } catch (err) {
            console.error("❌ Failed to fetch heirs:", err)
        }
    }, [groupId, semaphoreAddress])

    const addHeir = useCallback(async (identityCommitment: string): Promise<void> => {
        try {
            setError(null)
            const contract = await getVaultContractWithSigner()
            if (!contract) {
                throw new Error("Could not connect to contract with signer")
            }

            console.log("📝 Adding heir with commitment:", identityCommitment)
            
            // Convert string to BigInt since contract expects uint256
            const commitmentBigInt = BigInt(identityCommitment)
            console.log("📝 Converted to BigInt:", commitmentBigInt.toString())
            
            const tx = await contract.addHeir(commitmentBigInt)
            console.log("✅ Transaction submitted:", tx.hash)
            
            await tx.wait()
            console.log("✅ Transaction confirmed")
            
            // Refresh heirs list
            await refreshHeirs()
        } catch (err) {
            console.error("❌ AddHeir failed:", err)
            const errorMessage = err instanceof Error ? err.message : 'Failed to add heir'
            setError(errorMessage)
            throw new Error(errorMessage)
        }
    }, [getVaultContractWithSigner, refreshHeirs])

    const generateClaimKit = useCallback((
        identityPrivateKey: string,
        claimCode: string
    ): string => {
        const CryptoJS = require('crypto-js')
        
        const claimKit: ClaimKit = {
            identityPrivateKey,
            groupId,
            vaultAddress,
            merkleTreeDepth: 20 // Standard Semaphore depth
        }

        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(claimKit), claimCode).toString()
        return encrypted
    }, [groupId, vaultAddress])

    const decryptClaimKit = useCallback((encryptedKit: string, claimCode: string): ClaimKit | null => {
        try {
            const CryptoJS = require('crypto-js')
            const bytes = CryptoJS.AES.decrypt(encryptedKit, claimCode)
            const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
            return JSON.parse(decryptedData) as ClaimKit
        } catch {
            return null
        }
    }, [])

    useEffect(() => {
        if (vaultAddress && semaphoreAddress && groupId) {
            refreshVaultInfo()
            refreshHeirs()
        }
    }, [vaultAddress, semaphoreAddress, groupId, refreshVaultInfo, refreshHeirs])

    return (
        <InheritanceVaultContext.Provider
            value={{
                vaultInfo,
                heirs,
                isLoading,
                error,
                refreshVaultInfo,
                refreshHeirs,
                addHeir,
                generateClaimKit,
                decryptClaimKit
            }}
        >
            {children}
        </InheritanceVaultContext.Provider>
    )
}

export const useInheritanceVaultContext = () => {
    const context = useContext(InheritanceVaultContext)
    if (context === null) {
        throw new Error("useInheritanceVaultContext must be used within an InheritanceVaultContextProvider")
    }
    return context
}
