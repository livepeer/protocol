const GenesisManager = artifacts.require("GenesisManager")
const genesisConfig = require("../migrations/genesis.config.js")

module.exports = async () => {
    const genesisManager = await GenesisManager.deployed()

    genesisConfig.teamGrants.forEach(async grant => {
        const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Vesting contract: ${vestingHolderAddr}`)
    })

    genesisConfig.investorGrants.forEach(async grant => {
        const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Vesting contract: ${vestingHolderAddr}`)
    })

    genesisConfig.communityGrants.forEach(async grant => {
        const timeLockedHolderAddr = await genesisManager.timeLockedHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Timelock contract: ${timeLockedHolderAddr}`)
    })
}