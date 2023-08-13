import {assert} from "chai"
import {ethers} from "ethers"
import Fixture from "./Fixture"

type Checkpoint = {
    account: string
    startRound: number
    bondedAmount: number
    delegateAddress: string
    delegatedAmount: number
    lastClaimRound: number
    lastRewardRound: number
}

export default async function expectCheckpoints(
    fixture: Fixture,
    tx: ethers.providers.TransactionReceipt,
    ...checkpoints: Checkpoint[]
) {
    const filter = fixture.bondingVotes.filters.CheckpointBondingState()
    const events = await fixture.bondingVotes.queryFilter(
        filter,
        tx.blockNumber,
        tx.blockNumber
    )

    assert.equal(events.length, checkpoints.length, "Checkpoint count")

    for (let i = 0; i < checkpoints.length; i++) {
        const expected = checkpoints[i]
        const {args} = events[i]
        const actual: Checkpoint = {
            account: args[0].toString(),
            startRound: args[1].toNumber(),
            bondedAmount: args[2].toNumber(),
            delegateAddress: args[3].toString(),
            delegatedAmount: args[4].toNumber(),
            lastClaimRound: args[5].toNumber(),
            lastRewardRound: args[6].toNumber()
        }

        for (const keyStr of Object.keys(expected)) {
            const key = keyStr as keyof Checkpoint // ts workaround
            assert.equal(
                actual[key],
                expected[key],
                `Checkpoint #${i + 1} ${key}`
            )
        }
    }
}
