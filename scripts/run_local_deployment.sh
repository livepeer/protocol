docker run --detach --publish 8545:8545 trufflesuite/ganache-cli:latest --mnemonic "test test test test test test test test test test test junk"
npx hardhat deploy --tags Contracts,Poll --network localhost --reset
