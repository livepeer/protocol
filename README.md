[![CircleCI](https://img.shields.io/circleci/project/github/RedSparr0w/node-csgo-parser.svg)](https://circleci.com/gh/livepeer/protocol/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/livepeer/protocol/badge.svg)](https://coveralls.io/github/livepeer/protocol)

# Livepeer Protocol

Ethereum smart contracts used for the Livepeer protocol. These contracts govern the logic for:

-   Livepeer Token (LPT) ownership
-   Bonding and delegating LPT to elect active workers
-   Distributing inflationary rewards and fees to active participants
-   Time progression in the protocol
-   ETH escrow and ticket validation for a probabilistic micropayment protocol used to pay for transcoding work

## Documentation

For a general overview of the protocol refer to the [wiki](https://github.com/livepeer/wiki) resources.

## Development

All contributions and bug fixes are welcome as pull requests back into the repo.

A note on branches as of [LIP-73: Confluence - Arbitrum One Migration](https://github.com/livepeer/LIPs/blob/master/LIPs/LIP-73.md):

- The `confluence` branch contains the latest contract code deployed on the Arbitrum One rollup. Since the core protocol is operating on Arbitrum One rollup going forward all contract code changes pertaining to the core protocol should be on this branch.
- The `streamflow` branch contains the latest contract code deployed on Ethereum. Since the only operational contracts (not paused) on Ethereum, excluding the Controller, are the [LivepeerToken](https://github.com/livepeer/protocol/blob/streamflow/contracts/token/LivepeerToken.sol) and [BridgeMinter](https://github.com/livepeer/protocol/blob/streamflow/contracts/token/BridgeMinter.sol) the only contract code changes on this branch would be for those contracts.

The Arbitrum bridge contracts can be found in the [arbitrum-lpt-bridge](https://github.com/livepeer/arbitrum-lpt-bridge) repository.

### ERC20 Note

The Livepeer token is implemented as an ERC20 token in `token/LivepeerToken.sol` which inherits from the OpenZeppelin ERC20 token contract and all implemented ERC20 functions will revert if the operation is not successful. However, the [ERC20 spec](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md) does not require functions to revert and instead requires functions to return true if the operation succeed and false if the operation fails. The contracts `bonding/BondingManager.sol` and `token/Minter.sol` do not check the return value of ERC20 functions and instead assume that they will revert if the operation fails. The Livepeer token contract is already [deployed on mainnet](https://github.com/livepeer/wiki/blob/master/Deployed-Contract-Addresses.md) and its implementation should not change so this is not a problem. However, if for some reason the implementation ever does change, developers should keep in mind that `bonding/BondingManager.sol` and `token/Minter.sol` do not check the return value of ERC20 functions.

### Install

Make sure Node.js (>=v12.0) is installed.

```
git clone https://github.com/livepeer/protocol.git
cd protocol
yarn
```

### Build

Compile the contracts and build artifacts used for testing and deployment.

```
yarn compile
```

### Clean

Remove existing build artifacts.

```
yarn clean
```

### Lint

The project uses [ESLint](https://github.com/eslint/eslint) for Javascript linting and [Solium](https://github.com/duaraghav8/Ethlint) for Solidity linting.

```
yarn lint
```

### Run Tests

All tests will be executed via [hardhat](https://hardhat.org/guides/waffle-testing.html).

Make sure to add relevant API keys inside `.env` file (by copying provided `.env.sample`) to assist tests and deployments.

To run all tests:

```
yarn test
```

To run unit tests only:

```
yarn test:unit
```

To run integration tests only:

```
yarn test:integration
```

To run gas reporting tests (via [hardhat-gas-reporter](https://hardhat.org/plugins/hardhat-gas-reporter.html)) only:

```
yarn test:gas
```

To run tests with coverage (via [solidity-coverage](https://github.com/sc-forks/solidity-coverage)) reporting:

```
yarn test:coverage
```

## Deployment

Make sure that an ETH node is accessible and that the network being deployed to is supported by the `hardhat.config.ts` configuration.

```
export LPT_DEPLOYMENT_EXPORT_PATH=~/Development/lpt_contracts.json
yarn deploy
```
