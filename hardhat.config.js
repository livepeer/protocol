require("@nomiclabs/hardhat-ethers")
require("@nomiclabs/hardhat-web3")
require("babel-register")
require("babel-polyfill")

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.5.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      blockGasLimit: 12000000
    }
  }
}