const {contractId} = require("../utils/helpers")
const config = require("../migrations/migrations.config.js")
const genesisConfig = require("../migrations/genesis.config.js")

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const Minter = artifacts.require("Minter")
const LivepeerVerifier = artifacts.require("LivepeerVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")
const GenesisManager = artifacts.require("GenesisManager")
const TokenDistributionMock = artifacts.require("TokenDistributionMock")
const TokenVesting = artifacts.require("TokenVesting")
const TokenTimelock = artifacts.require("TokenTimelock")

contract("Verify deployment and genesis", accounts => {
    let controller
    let bondingManager
    let jobsManager
    let roundsManager
    let minter
    let verifier
    let token
    let genesisManager

    let dummyTokenDistribution

    before(async () => {
        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const jobsManagerAddr = await controller.getContract(contractId("JobsManager"))
        jobsManager = await JobsManager.at(jobsManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await RoundsManager.at(roundsManagerAddr)

        const minterAddr = await controller.getContract(contractId("Minter"))
        minter = await Minter.at(minterAddr)

        const verifierAddr = await controller.getContract(contractId("Verifier"))
        verifier = await LivepeerVerifier.at(verifierAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        genesisManager = await GenesisManager.deployed()

        const dummyTokenDistributionAddr = await genesisManager.tokenDistribution.call()
        dummyTokenDistribution = await TokenDistributionMock.at(dummyTokenDistributionAddr)
    })

    it("checks contract system state post-deployment", async () => {
        assert.equal(await controller.owner.call(), accounts[0], "Controller's owner should be the configured sender account used by Truffle")
        assert.equal(await controller.paused.call(), true, "Controller should be paused")

        // Check BondingManager parameters
        assert.equal(await bondingManager.controller.call(), controller.address, "should be correct Controller for BondingManager")
        assert.equal(await bondingManager.unbondingPeriod.call(), config.bondingManager.unbondingPeriod, "should be correct unbondingPeriod")
        assert.equal(await bondingManager.getTranscoderPoolMaxSize(), config.bondingManager.numTranscoders, "should be correct max transcoder pool size")
        assert.equal(await bondingManager.numActiveTranscoders.call(), config.bondingManager.numActiveTranscoders, "should be correct numActiveTranscoders")
        assert.equal(await bondingManager.maxEarningsClaimsRounds.call(), config.bondingManager.maxEarningsClaimsRounds, "should be correct maxEarningsClaimsRounds")
        // Check BondingManager balances
        assert.equal(web3.eth.getBalance(bondingManager.address), 0, "BondingManager should have 0 ETH")
        assert.equal(await token.balanceOf(bondingManager.address), 0, "BondingManager should have 0 LPT")

        // Check JobsManager parameters
        assert.equal(await jobsManager.controller.call(), controller.address, "should be correct Controller for JobsManager")
        assert.equal(await jobsManager.verificationRate.call(), config.jobsManager.verificationRate, "should be correct verificationRate")
        assert.equal(await jobsManager.verificationPeriod.call(), config.jobsManager.verificationPeriod, "should be correct verificationPeriod")
        assert.equal(await jobsManager.verificationSlashingPeriod.call(), config.jobsManager.verificationSlashingPeriod, "should be correct verificationSlashingPeriod")
        assert.equal(await jobsManager.failedVerificationSlashAmount.call(), config.jobsManager.failedVerificationSlashAmount, "should be correct failedVerificationSlashAmount")
        assert.equal(await jobsManager.missedVerificationSlashAmount.call(), config.jobsManager.missedVerificationSlashAmount, "should be correct missedVerificationSlashAmount")
        assert.equal(await jobsManager.doubleClaimSegmentSlashAmount.call(), config.jobsManager.doubleClaimSegmentSlashAmount, "should be correct doubleClaimSegmentSlashAmount")
        assert.equal(await jobsManager.finderFee.call(), config.jobsManager.finderFee, "should be correct finderFee")
        // Check JobsManager balances
        assert.equal(web3.eth.getBalance(jobsManager.address), 0, "JobsManager should have 0 ETH")
        assert.equal(await token.balanceOf(jobsManager.address), 0, "JobsManager should have 0 LPT")

        // Check RoundsManager parameters
        assert.equal(await roundsManager.controller.call(), controller.address, "should be correct Controller for RoundsManager")
        assert.equal(await roundsManager.roundLength.call(), config.roundsManager.roundLength, "should be correct roundLength")
        assert.equal(await roundsManager.roundLockAmount.call(), config.roundsManager.roundLockAmount, "should be correct roundLockAmount")
        // Check RoundsManager balances
        assert.equal(web3.eth.getBalance(roundsManager.address), 0, "RoundsManager should have 0 ETH")
        assert.equal(await token.balanceOf(roundsManager.address), 0, "RoundManager should have 0 LPT")

        // Check Minter parameters
        assert.equal(await minter.controller.call(), controller.address, "should be correct Controller for Minter")
        assert.equal(await minter.inflation.call(), config.minter.inflation, "should be correct inflation")
        assert.equal(await minter.inflationChange.call(), config.minter.inflationChange, "should be correct inflationChange")
        assert.equal(await minter.targetBondingRate.call(), config.minter.targetBondingRate, "should be correct targetBondingRate")
        // Check Minter balances
        assert.equal(web3.eth.getBalance(minter.address), 0, "Minter should have 0 ETH")
        assert.equal(await token.balanceOf(minter.address), 0, "Minter should have 0 LPT")

        // Check LivepeerVerifier parameters
        assert.equal(await verifier.controller.call(), controller.address, "should be correct Controller for LivepeerVerifier")
        assert.equal(await verifier.verificationCodeHash.call(), config.verifier.verificationCodeHash, "should be correct verificationCodeHash")
        config.verifier.solvers.forEach(async solver => {
            assert.isOk(await verifier.isSolver(solver), "should have whitelisted solver")
        })
        // Check LivepeerVerifier balances
        assert.equal(web3.eth.getBalance(verifier.address), 0, "LivepeerVerifier should have 0 ETH")
        assert.equal(await token.balanceOf(verifier.address), 0, "LivepeerVerifier should have 0 LPT")
    })

    it("checks system state post-genesis", async () => {
        assert.equal(await token.totalSupply(), genesisConfig.initialSupply.toNumber(), "should be correct initial total supply")
        assert.equal(await token.balanceOf(genesisConfig.bankMultisig), genesisConfig.companySupply.toNumber(), "bank multisig should have correct company supply")
        assert.equal(genesisConfig.crowdSupply, 0, "genesis crowd supply should have been 0")
        assert.equal(await token.balanceOf(dummyTokenDistribution.address), genesisConfig.crowdSupply.toNumber(), "dummy token distribution should have 0 crowd supply")

        const dummyTokenDistributionEndTime = await dummyTokenDistribution.getEndTime()

        // Check vesting team grants
        genesisConfig.teamGrants.forEach(async grant => {
            const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
            const vestingHolder = await TokenVesting.at(vestingHolderAddr)
            assert.equal(await vestingHolder.beneficiary.call(), grant.receiver, "should be correct vesting grant receiver")
            assert.equal(await vestingHolder.start.call(), dummyTokenDistributionEndTime.toNumber(), "should be correct vesting start time")
            assert.equal(await vestingHolder.cliff.call(), dummyTokenDistributionEndTime.plus(grant.timeToCliff).toNumber(), "should be correct vesting cliff time")
            assert.equal(await vestingHolder.duration.call(), grant.vestingDuration.toNumber(), "should be correct vesting duration")
            assert.equal(await token.balanceOf(vestingHolderAddr), grant.amount.toNumber(), "should be correct vesting grant amount")
        })

        // Check vesting investor grants
        genesisConfig.investorGrants.forEach(async grant => {
            const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
            const vestingHolder = await TokenVesting.at(vestingHolderAddr)
            assert.equal(await vestingHolder.beneficiary.call(), grant.receiver, "should be correct vesting grant receiver")
            assert.equal(await vestingHolder.start.call(), dummyTokenDistributionEndTime.toNumber(), "should be correct vesting start time")
            assert.equal(await vestingHolder.cliff.call(), dummyTokenDistributionEndTime.plus(grant.timeToCliff).toNumber(), "should be correct vesting cliff time")
            assert.equal(await vestingHolder.duration.call(), grant.vestingDuration.toNumber(), "should be correct vesting duration")
            assert.equal(await token.balanceOf(vestingHolderAddr), grant.amount.toNumber(), "should be correct vesting grant amount")
        })

        // Check timelock community grants
        genesisConfig.communityGrants.forEach(async grant => {
            const timeLockedHolderAddr = await genesisManager.timeLockedHolders.call(grant.receiver)
            const timeLockedHolder = await TokenTimelock.at(timeLockedHolderAddr)
            assert.equal(await timeLockedHolder.beneficiary.call(), grant.receiver, "should be correct timelocked grant receiver")
            assert.equal(await timeLockedHolder.releaseTime.call(), dummyTokenDistributionEndTime.toNumber(), "should be correct lock release time")
            assert.equal(await token.balanceOf(timeLockedHolderAddr), grant.amount.toNumber(), "should be correct timelocked grant amount")
        })
    })
})
