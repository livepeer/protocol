import {task} from "hardhat/config"
import {ethers} from "ethers"

const BLOCK_PERIOD = 12 // seconds

task(
    "evm-increase-blocks",
    "Helper task to increase the block number in the current EVM"
)
    .addOptionalPositionalParam(
        "blocks",
        "How many blocks to increase by (defaults to 1)"
    )
    .setAction(async (taskArgs, hre) => {
        const {network} = hre

        const provider = network.provider
        const blocks = parseInt(taskArgs.blocks ?? "1")

        const currBlock = ethers.BigNumber.from(
            await provider.send("eth_blockNumber")
        )
        console.log(`Previous block pre-update: ${currBlock}`)

        await provider.send("evm_increaseBlocks", [
            ethers.utils.hexValue(blocks) // hex encoded number of blocks to increase
        ])
        // helpfully increase the time by 12s per block as well
        await provider.send("evm_increaseTime", [
            ethers.utils.hexValue(BLOCK_PERIOD * blocks) // hex encoded number of seconds
        ])

        const newBlock = ethers.BigNumber.from(
            await provider.send("eth_blockNumber")
        )
        console.log(`New block post-update: ${newBlock}`)
    })
