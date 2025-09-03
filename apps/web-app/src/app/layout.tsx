import PageContainer from "@/components/PageContainer"
import type { Metadata } from "next"
import Providers from "./providers"

export const metadata: Metadata = {
    title: "NomadKit",
    description: "A decentralized inheritance system using Semaphore Protocol for anonymous proof verification.",
    icons: { icon: "/icon.svg", apple: "/apple-icon.png" }
}

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning>
                <Providers>
                    <PageContainer>{children}</PageContainer>
                </Providers>
            </body>
        </html>
    )
}
