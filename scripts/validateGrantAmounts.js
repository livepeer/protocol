const genesisConfig = require("../migrations/genesis.config.js")
const assert = require("chai").assert
const BigNumber = require("bignumber.js")

const main = async () => {
    const totalTeamAmount = genesisConfig.teamGrants.reduce((acc, val) => {
        return acc.plus(val.amount)
    }, new BigNumber(0))

    const totalInvestorAmount = genesisConfig.investorGrants.reduce((acc, val) => {
        return acc.plus(val.amount)
    }, new BigNumber(0))

    const totalCommunityAmount = genesisConfig.communityGrants.reduce((acc, val) => {
        return acc.plus(val.amount)
    }, new BigNumber(0))

    console.log(`Total Team Grants Amount: ${totalTeamAmount}`)
    console.log(`Total Investor Grants Amount: ${totalInvestorAmount}`)
    console.log(`Total Community Grants Amount: ${totalCommunityAmount}`)

    assert.equal(totalTeamAmount.toString(), genesisConfig.teamSupply.toString(), "total team grants amount should equal team supply")
    assert.equal(totalInvestorAmount.toString(), genesisConfig.investorsSupply.toString(), "total investor grants amount should equal investors supply")
    assert.equal(totalCommunityAmount.toString(), genesisConfig.communitySupply.toString(), "total community grants amount should equal community supply")

    const total = totalTeamAmount.plus(totalInvestorAmount).plus(totalCommunityAmount).plus(genesisConfig.crowdSupply).plus(genesisConfig.companySupply)

    console.log(`Total: ${total}`)

    assert.equal(total.toString(), genesisConfig.initialSupply.toString(), "total amount should equal initial supply")

    console.log("--- All checks for grant amounts passed! ---")
}

main()
