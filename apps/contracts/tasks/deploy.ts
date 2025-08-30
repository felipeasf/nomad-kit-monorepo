import { task, types } from "hardhat/config"

task("deploy", "Deploy an InheritanceVault contract")
    .addOptionalParam("semaphore", "Semaphore contract address", undefined, types.string)
    .addOptionalParam("heartbeatinterval", "Heartbeat interval in seconds", 86400, types.int) // 24 hours default
    .addOptionalParam("challengewindow", "Challenge window in seconds", 604800, types.int) // 7 days default
    .addOptionalParam("logs", "Print the logs", true, types.boolean)
    .setAction(async ({ logs, semaphore: semaphoreAddress, heartbeatinterval: heartbeatInterval, challengewindow: challengeWindow }, { ethers, run }) => {
        if (!semaphoreAddress) {
            const { semaphore } = await run("deploy:semaphore", {
                logs
            })

            semaphoreAddress = await semaphore.getAddress()
        }

        // Deploy InheritanceVault contract
        const InheritanceVaultFactory = await ethers.getContractFactory("InheritanceVault")

        const vaultContract = await InheritanceVaultFactory.deploy(
            semaphoreAddress,
            heartbeatInterval,
            challengeWindow
        )

        await vaultContract.waitForDeployment()

        const groupId = await vaultContract.groupId()
        const owner = await vaultContract.owner()
        const nextDeadline = await vaultContract.nextDeadline()

        if (logs) {
            console.info(
                `InheritanceVault contract has been deployed to: ${await vaultContract.getAddress()}`
            )
            console.info(`  - Group ID: ${groupId}`)
            console.info(`  - Owner: ${owner}`)
            console.info(`  - Heartbeat Interval: ${heartbeatInterval} seconds (${heartbeatInterval / 86400} days)`)
            console.info(`  - Challenge Window: ${challengeWindow} seconds (${challengeWindow / 86400} days)`)
            console.info(`  - Next Deadline: ${new Date(Number(nextDeadline) * 1000).toISOString()}`)
        }

        // Commented out Feedback contract deployment
        // const FeedbackFactory = await ethers.getContractFactory("Feedback")
        // const feedbackContract = await FeedbackFactory.deploy(semaphoreAddress)
        // await feedbackContract.waitForDeployment()
        // const groupId = await feedbackContract.groupId()
        // if (logs) {
        //     console.info(
        //         `Feedback contract has been deployed to: ${await feedbackContract.getAddress()} (groupId: ${groupId})`
        //     )
        // }
        // return feedbackContract

        return vaultContract
    })
