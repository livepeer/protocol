import {ethers} from "ethers"

export default class RPC {
    constructor(public provider: ethers.providers.JsonRpcProvider) {}

    sendAsync(method: string, arg: any[]) {
        try {
            return this.provider.send(method, arg)
        } catch (error: any) {
            throw error
        }
    }

    // Change block time using TestRPC call evm_setTimestamp
    // https://github.com/numerai/contract/blob/master/test/numeraire.js
    increaseTime(time: number) {
        return this.sendAsync("evm_increaseTime", [time])
    }

    mine() {
        return this.sendAsync("evm_mine", [])
    }

    async snapshot() {
        const id = await this.sendAsync("evm_snapshot", [])
        return id
    }

    revert(snapshotId: number) {
        return this.sendAsync("evm_revert", [snapshotId])
    }

    async wait(blocks = 1, seconds = 20) {
        const currentBlock = await this.provider.getBlockNumber()
        const targetBlock = currentBlock + blocks
        await this.waitUntilBlock(targetBlock, seconds)
    }

    async getBlockNumberAsync() {
        return this.provider.getBlockNumber()
    }

    async waitUntilBlock(targetBlock: number, seconds = 20) {
        let currentBlock = await this.provider.getBlockNumber()

        while (currentBlock < targetBlock) {
            await this.increaseTime(seconds)
            await this.mine()
            currentBlock++
        }
    }

    async waitUntilNextBlockMultiple(
        blockMultiple: number,
        multiples = 1,
        seconds = 20
    ) {
        const currentBlock = await this.provider.getBlockNumber()
        const additionalBlocks = (multiples - 1) * blockMultiple
        await this.waitUntilBlock(
            this.nextBlockMultiple(currentBlock, blockMultiple) +
                additionalBlocks
        )
    }

    nextBlockMultiple(currentBlockNum: number, blockMultiple: number) {
        if (blockMultiple === 0) {
            return currentBlockNum
        }

        const remainder = currentBlockNum % blockMultiple

        if (remainder === 0) {
            return currentBlockNum
        }

        return currentBlockNum + blockMultiple - remainder
    }
}
