import {contractId} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")

contract("JobAssignment", accounts => {
    let controller
    let bondingManager
    let jobsManager
    let roundsManager
    let token

    let transcoder1
    let transcoder2
    let transcoder3
    let broadcaster

    let roundLength

    before(async () => {
        transcoder1 = accounts[0]
        transcoder2 = accounts[1]
        transcoder3 = accounts[2]
        broadcaster = accounts[3]

        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const jobsManagerAddr = await controller.getContract(contractId("JobsManager"))
        jobsManager = await JobsManager.at(jobsManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
        const faucet = await LivepeerTokenFaucet.at(faucetAddr)

        await faucet.request({from: transcoder1})
        await faucet.request({from: transcoder2})
        await faucet.request({from: transcoder3})

        roundLength = await roundsManager.roundLength.call()

        await roundsManager.setBlockNum(roundLength.toNumber())
        await roundsManager.initializeRound()

        // Register and bond transcoder 1 with 50% of the total active stake
        await token.approve(bondingManager.address, 50000, {from: transcoder1})
        await bondingManager.bond(50000, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(10, 5, 5, {from: transcoder1})

        // Register and bond transcoder 2 with 30% of the total active stake
        await token.approve(bondingManager.address, 30000, {from: transcoder2})
        await bondingManager.bond(30000, transcoder2, {from: transcoder2})
        await bondingManager.transcoder(10, 5, 1, {from: transcoder2})

        // Register and bond transcoder 3 with 20% of the total active stake
        await token.approve(bondingManager.address, 20000, {from: transcoder3})
        await bondingManager.bond(20000, transcoder3, {from: transcoder3})
        await bondingManager.transcoder(10, 5, 1, {from: transcoder3})

        // Initialize new round and initialize new active transcoder set
        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    })

    it("assign transcoders to jobs proportionally weighted by stake", async () => {
        let transcoder1JobCount = 0
        let transcoder2JobCount = 0
        let transcoder3JobCount = 0
        let nullAddressJobCount = 0

        const streamId = "foo"
        const transcodingOptions = "0x123"
        const maxPricePerSegment = 10
        const endBlock = (await roundsManager.blockNum()).add(1000)

        // Broadcaster makes a deposit for jobs
        await jobsManager.deposit({from: broadcaster, value: 100000})

        let jobID
        let job
        let jobCreationRound
        let challengeHash
        let electedTranscoder

        let jobsCreated = 0

        while (jobsCreated < 100) {
            // Set challenge hash
            challengeHash = web3.eth.getBlock(web3.eth.blockNumber).hash
            await roundsManager.setBlockHash(challengeHash)

            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock)
            jobID = (await jobsManager.numJobs.call()).sub(1)
            job = await jobsManager.getJob(jobID)
            jobCreationRound = job[5]

            electedTranscoder = await bondingManager.electActiveTranscoder(maxPricePerSegment, challengeHash, jobCreationRound)

            switch (electedTranscoder) {
              case transcoder1:
                  transcoder1JobCount++
                  break
              case transcoder2:
                  transcoder2JobCount++
                  break
              case transcoder3:
                  transcoder3JobCount++
                  break
              default:
                  nullAddressJobCount++
                  break
            }

            await roundsManager.mineBlocks(1)

            if (!(await roundsManager.currentRoundInitialized())) {
                await roundsManager.initializeRound()
            }

            jobsCreated++
        }

        const transcoder1JobShare = transcoder1JobCount / jobsCreated
        const transcoder2JobShare = transcoder2JobCount / jobsCreated
        const transcoder3JobShare = transcoder3JobCount / jobsCreated
        const acceptableDelta = .1

        assert.equal(nullAddressJobCount, 0, "should not be any unassigned jobs")
        assert.isAbove(transcoder1JobShare, transcoder2JobShare, "transcoder 1 job share should be > transcoder 2 job share")
        assert.isAbove(transcoder2JobShare, transcoder3JobShare, "transcoder 2 job share should be > transcoder 3 job share")
        assert.isAtMost(Math.abs(transcoder1JobShare - .5), acceptableDelta, "transcoder 1 job share not within acceptable delta")
        assert.isAtMost(Math.abs(transcoder2JobShare - .3), acceptableDelta, "transcoder 2 job share not within acceptable delta")
        assert.isAtMost(Math.abs(transcoder3JobShare - .2), acceptableDelta, "transcoder 3 job share not within acceptable delta")
    })

    it("excludes transcoders if the broadcast price is too low", async () => {
        // Transcoder 1 increases its price
        await bondingManager.transcoder(10, 5, 100, {from: transcoder1})
        // Initialize new round and update pricing for active transcoder set
        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        let transcoder1JobCount = 0
        let transcoder2JobCount = 0
        let transcoder3JobCount = 0
        let nullAddressJobCount = 0

        const streamId = "foo"
        const transcodingOptions = "0x123"
        const maxPricePerSegment = 1
        const endBlock = (await roundsManager.blockNum()).add(1000)

        let jobID
        let job
        let jobCreationRound
        let challengeHash
        let electedTranscoder

        let jobsCreated = 0

        while (jobsCreated < 5) {
            // Set challenge hash
            challengeHash = web3.eth.getBlock(web3.eth.blockNumber).hash
            await roundsManager.setBlockHash(challengeHash)

            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock)
            jobID = (await jobsManager.numJobs.call()).sub(1)
            job = await jobsManager.getJob(jobID)
            jobCreationRound = job[5]

            electedTranscoder = await bondingManager.electActiveTranscoder(maxPricePerSegment, challengeHash, jobCreationRound)

            switch (electedTranscoder) {
              case transcoder1:
                  transcoder1JobCount++
                  break
              case transcoder2:
                  transcoder2JobCount++
                  break
              case transcoder3:
                  transcoder3JobCount++
                  break
              default:
                  nullAddressJobCount++
                  break
            }

            await roundsManager.mineBlocks(1)

            if (!(await roundsManager.currentRoundInitialized())) {
                await roundsManager.initializeRound()
            }

            jobsCreated++
        }

        assert.equal(nullAddressJobCount, 0, "should not be any unassigned jobs")
        assert.equal(transcoder1JobCount, 0, "transcoder 1 should not be assigned jobs if its price is too high")
        assert.notEqual(transcoder2JobCount + transcoder3JobCount, 0, "transcoder 2 and 3 should have been assigned jobs")
    })
})
