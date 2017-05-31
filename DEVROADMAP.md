# Livepeer Protocol Dev Roadmap

The goal is to implement the full Livepeer protocol as specified in the [Whitepaper](http://github.com/livepeer/wiki/blob/master/WHITEPAPER.md) and associated wiki pages. The majority of the implementation will be done in Solidity as Ethereum Smart Contracts. It's vital that these be

- correct
- thoroughly tested
- deployable

While difficult to modularize the protocol itself, since the parts are pretty interdependent, it does seem reasonable to break out the development into milestones that can be reached and verified indepdently.

## Milestones

### MintableToken

- Livepeer Token
- Protocol Smart Contract with protocol parameters and initializer
- Bonding/Unbonding
- Transcoder election rounds
- Reward function and associated transcoder state tracking

At this point nodes in the network could presumably go through the full process of delegation, transcoder election, and reward function invocation. Essentially this would be the MVP for stake based token distribution without slashing.

### Jobs

- Transcode availability function
- Job function and assignment
- EndJob and transcoding claims
- Truebit verification interface as a black box

At this point nodes could participate in sending jobs to the chain and having them assigned to transcoders who perform and claim them. This data could be used in the Reward function.

### Verification

- Slashing conditions
- Actual truebit integration
- Reward function finalization

Now the protocol should work.

### Extensability

- Governance

[Governance](https://github.com/livepeer/wiki/wiki/Governance) implementation is TBD, but this will allow the protocol to update the values of its parameters on the fly.

## References

[Simple Casper](https://github.com/ethereum/casper/blob/master/casper/contracts/simple_casper.v.py) - this implementation does the bonding/unbonding and validator (transcoder) tracking in a really compact way. Pay attention to how each line aims to be simple and well commented. Important in getting every line right.

[Zeppelin](https://openzeppelin.org) - Use their peer reviewed smart contracts where possible for tokens, math, ownership, timelocks, etc. Their blog has a wealth of info on audits as well.

[King of the Ether Throne Contract Safety Checklist](https://www.kingoftheether.com/contract-safety-checklist.html)

[Consensys smart contract best practices](https://github.com/ConsenSys/smart-contract-best-practices)

[Zeppelin security audits](https://medium.com/zeppelin-blog) - Audits of several popular smart contracts performed by Zeppelin.
