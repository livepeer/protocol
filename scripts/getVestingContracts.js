const GenesisManager = artifacts.require("GenesisManager")
const genesisConfig = require("../migrations/genesis.config.js")

module.exports = async () => {
    const genesisManager = await GenesisManager.deployed()

    console.log("Team Grants")
    console.log("-----------------")

    for (let grant of genesisConfig.teamGrants) {
        const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Vesting contract: ${vestingHolderAddr}`)
    }

    console.log("Investors Grants")
    console.log("-----------------")

    for (let grant of genesisConfig.investorGrants) {
        const vestingHolderAddr = await genesisManager.vestingHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Vesting contract: ${vestingHolderAddr}`)
    }

    console.log("Community Grants")
    console.log("-----------------")

    for (let grant of genesisConfig.communityGrants) {
        const timeLockedHolderAddr = await genesisManager.timeLockedHolders.call(grant.receiver)
        console.log(`Recipient: ${grant.receiver} Timelock contract: ${timeLockedHolderAddr}`)
    }
}
