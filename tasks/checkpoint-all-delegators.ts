import {task} from "hardhat/config"
import {delegators} from "./delegators"
import {BondingVotes, Checkpointer} from "../typechain"
import {Address} from "hardhat-deploy/types"
import {readFileSync, writeFileSync} from "fs"

task(
    "checkpoint-all-delegators",
    "Verifies all contracts in the deployments folder"
)
    .addOptionalParam(
        "skipListFile",
        "Skip-list files of already processed delegators",
        "./tasks/delegators-skip.json"
    )
    .setAction(async (taskArgs, hre) => {
        const {skipListFile} = taskArgs
        const Checkpointer: Checkpointer = await hre.ethers.getContractAt(
            "Checkpointer",
            "0xFb260b0957DDe757b6AEc16b62Abf6842C1Ff8fB"
        )
        const BondingVotes: BondingVotes = await hre.ethers.getContractAt(
            "BondingVotes",
            "0x0B9C254837E72Ebe9Fe04960C43B69782E68169A"
        )

        const allDelegators = delegators.reduce<Address[]>((acc, q) => {
            return acc.concat(q.data.delegators.map(d => d.id))
        }, [])

        const skip: string[] = JSON.parse(readFileSync(skipListFile, "utf8"))
        const addToSkipList = (...delegators: Address[]) => {
            skip.push(...delegators)
            writeFileSync(skipListFile, JSON.stringify(skip, null, 2))
        }

        let batch = [] as Address[]
        const checkpointBatch = async () => {
            console.log(`Checkpointing ${batch.length} delegators`)

            await Checkpointer.checkpointMany(batch, {
                gasPrice: 100000000
            }).then(tx => {
                console.log(`tx: ${tx.hash}`)
                return tx.wait()
            })

            addToSkipList(...batch)
            batch = []
        }

        for (const delegator of allDelegators) {
            if (skip.includes(delegator)) {
                continue
            }

            const hasCheckpoint = await BondingVotes.hasCheckpoint(delegator)
            if (hasCheckpoint) {
                console.log(`Skipping checkpointed ${delegator}`)
                addToSkipList(delegator)
                continue
            }

            batch.push(delegator)
            if (batch.length % 10 === 0) {
                console.log(`Batch size: ${batch.length}`)
            }
            if (batch.length === 100) {
                await checkpointBatch()
            }
        }
        if (batch.length > 0) {
            await checkpointBatch()
        }
    })
