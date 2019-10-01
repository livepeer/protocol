[![CircleCI](https://img.shields.io/circleci/project/github/RedSparr0w/node-csgo-parser.svg)](https://circleci.com/gh/livepeer/protocol/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/livepeer/protocol/badge.svg)](https://coveralls.io/github/livepeer/protocol)

# Livepeer Protocol

Ethereum smart contracts used for the Livepeer protocol. These contracts govern the logic for:

* Livepeer Token (LPT) ownership
* Bonding and delegating LPT to elect active workers
* Distributing inflationary rewards and fees to active participants
* Time progression in the protocol
* ETH escrow and ticket validation for a probabilistic micropayment protocol used to pay for transcoding work

## Documentation

For a general overview of the protocol see:

- The [whitepaper](http://github.com/livepeer/wiki/blob/master/WHITEPAPER.md) for the original proposal
- The [Streamflow proposal paper](https://github.com/livepeer/wiki/blob/master/STREAMFLOW.md) for the Streamflow scalability upgrade proposal

The contracts are based off of the [technical protocol specification](https://github.com/livepeer/wiki/tree/master/spec).

## Development

All contributions and bug fixes are welcome as pull requests back into the repo.

### Install 

```
git clone https://github.com/livepeer/protocol.git
cd protocol
npm install
```

### Build

Compile the contracts and build artifacts used for testing and deployment.

```
npm run compile
```

### Clean

Remove existing build artifacts.

```
npm run clean
```

### Lint

The project uses [ESLint](https://github.com/eslint/eslint) for Javascript linting and [Solium](https://github.com/duaraghav8/Ethlint) for Solidity linting.

```
npm run lint
```

### Run Tests

All tests will be executed against an instance of [ganache-cli](https://github.com/trufflesuite/ganache-cli).

To run all tests:

```
npm run test
```

To run unit tests only:

```
npm run test:unit
```

To run integration tests only:

```
npm run test:integration
```

To run gas reporting tests (via [eth-gas-reporter](https://github.com/cgewecke/eth-gas-reporter)) only:

```
npm run test:gas
```

To run tests with coverage (via [solidity-coverage](https://github.com/sc-forks/solidity-coverage)) reporting:

```
npm run test:coverage
```

## Deployment

Make sure that an ETH node is accessible and that the network being deployed to is supported by the `truffle.js` configuration.

```
npm run migrate
```
