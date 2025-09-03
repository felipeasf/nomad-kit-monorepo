"use client"

import { CacheProvider } from "@chakra-ui/next-js"
import { ChakraProvider } from "@chakra-ui/react"
import theme from "../styles/index"
import { InheritanceVaultContextProvider } from "../context/InheritanceVaultContext"
import { LogContextProvider } from "../context/LogContext"

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <CacheProvider>
            <ChakraProvider theme={theme}>
                <LogContextProvider>
                    <InheritanceVaultContextProvider>
                        {children}
                    </InheritanceVaultContextProvider>
                </LogContextProvider>
            </ChakraProvider>
        </CacheProvider>
    )
}
