import {task} from "hardhat/config"
import {
    BondingManager,
    BondingVotes,
    Controller,
    LivepeerGovernor,
    RoundsManager,
    Treasury
} from "../typechain"
import {contractId} from "../utils/helpers"
import {constants} from "../utils/constants"
import {ethers} from "ethers"

const expected = {
    bondingManager: {
        nextRoundTreasuryRewardCutRate: constants.PERC_DIVISOR_PRECISE.div(10),
        treasuryBalanceCeiling: ethers.utils.parseEther("750000")
    },
    livepeerGovernor: {
        name: "LivepeerGovernor",
        votingDelay: 1,
        votingPeriod: 10,
        proposalThreshold: ethers.utils.parseEther("100"),
        quorumNumerator: 333300, // 33.33%
        quorumDenominator: 1000000,
        quota: 500000 // 50%
    },
    treasury: {
        minDelay: 0
    }
}

task(
    "verify-delta-deployment",
    "Verifies deployment of Delta upgrade contracts (LIP-91 and LIP-92)"
)
    .addOptionalPositionalParam("substep", "Substep to verify (unimplemented)")
    .setAction(async (taskArgs, hre) => {
        const {ethers, deployments} = hre

        const controller = await deployments.get("Controller")
        const Controller: Controller = await hre.ethers.getContractAt(
            "Controller",
            controller.address
        )

        const getContract = async <T extends ethers.Contract>(
            name: string
        ): Promise<T> => {
            const address = await Controller.getContract(contractId(name))
            return await ethers.getContractAt(name, address)
        }

        const checkParam = async (
            name: string,
            actual: { toString: () => string },
            expected: { toString: () => string }
        ) => {
            console.log(`${name} is ${actual}`)

            if (actual.toString() !== expected.toString()) {
                throw new Error(`${name} is ${actual} but expected ${expected}`)
            }
        }

        const BondingManager: BondingManager = await getContract(
            "BondingManager"
        )

        const params = {
            treasuryRewardCutRate: await BondingManager.treasuryRewardCutRate(),
            nextRoundTreasuryRewardCutRate:
                await BondingManager.nextRoundTreasuryRewardCutRate(),
            treasuryBalanceCeiling:
                await BondingManager.treasuryBalanceCeiling()
        }

        await checkParam(
            "BondingManager.nextRoundTreasuryRewardCutRate",
            params.nextRoundTreasuryRewardCutRate,
            expected.bondingManager.nextRoundTreasuryRewardCutRate
        )

        await checkParam(
            "BondingManager.treasuryBalanceCeiling",
            params.treasuryBalanceCeiling,
            expected.bondingManager.treasuryBalanceCeiling
        )

        if (
            params.treasuryRewardCutRate.eq(
                params.nextRoundTreasuryRewardCutRate
            )
        ) {
            console.log(
                "Treasury reward cut rate of 10% already propagated to current round"
            )
        } else {
            console.log("Treasury reward cut rate hasn't propagated yet")

            const RoundsManager: RoundsManager = await getContract(
                "RoundsManager"
            )
            const initialized = await RoundsManager.currentRoundInitialized()
            if (!initialized) {
                console.log(
                    "Missing only current round initialization. Call RoundsManager.initializeRound()"
                )
            } else {
                const currentRound = await RoundsManager.currentRound()
                const nextRound = currentRound.add(1)
                const currRoundStartBlock =
                    await RoundsManager.currentRoundStartBlock()
                const nextRoundStartBlock = currRoundStartBlock.add(
                    await RoundsManager.roundLength()
                )
                const currBlock = await RoundsManager.blockNum()

                console.log(
                    `Cut rate will be initialized on round ${nextRound} starting at block ${nextRoundStartBlock} (${nextRoundStartBlock.sub(
                        currBlock
                    )} blocks left)`
                )
            }
        }

        const LivepeerGovernor: LivepeerGovernor = await getContract(
            "LivepeerGovernor"
        )
        const actual = {
            name: await LivepeerGovernor.name(),
            votingDelay: await LivepeerGovernor.votingDelay(),
            votingPeriod: await LivepeerGovernor.votingPeriod(),
            proposalThreshold: await LivepeerGovernor.proposalThreshold(),
            quorumNumerator: await LivepeerGovernor["quorumNumerator()"](),
            quorumDenominator: await LivepeerGovernor.quorumDenominator(),
            quota: await LivepeerGovernor.quota()
        }

        const allParams = Object.keys(
            expected.livepeerGovernor
        ) as (keyof typeof expected.livepeerGovernor)[] // ts sorcery
        for (const param of allParams) {
            await checkParam(
                `LivepeerGovernor.${param}`,
                actual[param],
                expected.livepeerGovernor[param]
            )
        }

        const Treasury: Treasury = await getContract("Treasury")
        await checkParam(
            "LivepeerGovernor.timelock",
            await LivepeerGovernor.timelock(),
            Treasury.address
        )
        await checkParam(
            "Treasury.minDelay",
            await Treasury.getMinDelay(),
            expected.treasury.minDelay
        )

        const roles = {
            proposer: await Treasury.PROPOSER_ROLE(),
            canceller: await Treasury.CANCELLER_ROLE(),
            executor: await Treasury.EXECUTOR_ROLE(),
            admin: await Treasury.TIMELOCK_ADMIN_ROLE()
        }
        const checkRole = async (role: keyof typeof roles) => {
            const hasRole = await Treasury.hasRole(
                roles[role],
                LivepeerGovernor.address
            )
            if (!hasRole) {
                throw new Error(
                    `Treasury does not provide ${role} role for governor`
                )
            }
            console.log(`Treasury provides ${role} role for governor`)
        }

        await checkRole("proposer")
        await checkRole("canceller")
        await checkRole("executor")

        const {deployer} = await hre.getNamedAccounts() // Fetch named accounts from hardhat.config.ts
        const deployerHasAdmin = await Treasury.hasRole(roles.admin, deployer)
        if (deployerHasAdmin) {
            console.error(
                `WARNING: Treasury still provides ADMIN role to deployer ${deployer}`
            )
        } else {
            console.log(
                `Treasury does not provide admin role for deployer ${deployer}`
            )
        }

        const BondingVotes: BondingVotes = await getContract("BondingVotes")

        const topTranscoder = await BondingManager.getFirstTranscoderInPool()
        if (!(await BondingVotes.hasCheckpoint(topTranscoder))) {
            console.log(`Checkpointing top transcoder ${topTranscoder}`)
            await BondingManager.checkpointBondingState(topTranscoder).then(
                tx => tx.wait()
            )
        }

        await checkParam(
            "BondingVotes.hasCheckpoint(topTranscoder)",
            await BondingVotes.hasCheckpoint(topTranscoder),
            true
        )

        await checkParam(
            "BondingVotes.getVotes(topTranscoder)",
            await BondingVotes.getVotes(topTranscoder),
            await BondingManager.transcoderTotalStake(topTranscoder)
        )

        console.log("All good!")
    })
