const Migrations = artifacts.require("./Migrations.sol")

module.exports = function(deployer, network) {
    if (network === "unitTest") {
        return
    }

    deployer.deploy(Migrations)
}
