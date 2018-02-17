[![CircleCI](https://img.shields.io/circleci/project/github/RedSparr0w/node-csgo-parser.svg)](https://circleci.com/gh/livepeer/protocol/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/livepeer/protocol/badge.svg)](https://coveralls.io/github/livepeer/protocol)
[![Gitter](https://img.shields.io/gitter/room/nwjs/nw.js.svg)](https://gitter.im/livepeer/Lobby)

# Livepeer Protocol

The Livepeer Protocol consists of the on-chain smart contracts that govern the logic of:

* Livepeer Token ownership
* Transcoding requests and job assignment
* Proof and verification of transcoding work
* Bonding and delegating for transcoder election
* Slashing (penalties) for faulty participation

The protocol is outlined in the
[Livepeer Whitepaper](http://github.com/livepeer/wiki/blob/master/WHITEPAPER.md)
and is more formally specified in the [Protocol Specification](http://github.com/livepeer/wiki/blob/master/SPEC.md).

The current status is that this is a near complete implementation of the
initial pass at the Livepeer protocol which accounts for the alpha
release milestone - Snowmelt - as defined in the [Livepeer Network Phases](https://medium.com/livepeer-blog/livepeer-network-phases-b196ab42264b).

## Development

The Livepeer Protocol uses Truffle v4.0.1 and TestRPC v6.0.1.

```
git clone https://github.com/livepeer/protocol.git
cd protocol
npm install
```

You can build and test the Livepeer Protocol locally:

```
npm run test:unit
npm run test:integration
```

All contributions and bug fixes are welcome as pull requests back into the repo.

Built using [OpenZeppelin](https://github.com/OpenZeppelin/zeppelin-solidity) and [Truffle](http://truffle.readthedocs.io).

## Bugs

Please report protocol bugs big and small by [opening an issue](https://github.com/livepeer/protocol/issues/new). No possible bug report is too small.
