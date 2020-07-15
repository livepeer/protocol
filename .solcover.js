module.exports = {
    client: require("ganache-cli"),
    providerOptions: {
        hardfork: "istanbul",
        gasLimit: "0xfffffffffff",
        total_accounts: 310
    },
    skipFiles: ["Migrations.sol", "test", "zeppelin", "rounds/AdjustableRoundsManager.sol", "pm/mixins/interfaces"]
}
