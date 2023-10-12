# Livepeer Delta upgrade deployment steps

## Step 1: Setup deployer account

Configure the private key for an account that has enough ETH to run the deploy transactions.

```
export PRIVATE_KEY=... (no 0x prefix)
```

Alternatively you can set it in the `.env` file in your repo. All commands listed below expect the same account to be configured.

## Step 2: Deploy contracts

Run the deployment script to deploy the new contracts:

```
npx hardhat deploy --tags DELTA_UPGRADE --network arbitrumMainnet
```

## Step 3: Verify contracts source code

Verify the contracts source code on Arbiscan:

```
yarn etherscan-verify --network arbitrumMainnet BondingVotesTarget BondingVotes Treasury LivepeerGovernorTarget LivepeerGovernor BondingManagerTarget
```

Then check the contracts on Arbiscan to make sure the source code is verified and matches the expected code (compare
with `npx hardhat flatten`).

Also check the `Treasury` configuration, the only non-proxied contract, to make sure it wasn't manipulated by anyone
before the `initialize` function was called.

## Step 4: Prepare governance update

1.  Grab the full git hash from the current repository where you ran the deployment script, or get it from the output of
    the pending governance actions.
2.  Also obtain the addresses of the contracts deployed above. You can find them in the corresponding `deployments` directory or
    in the output of the deployment script.
3.  Now on the `governance-scripts` repository, update:
    a) the `0xPENDING_ADDRESS` address entries on the `updates/addresses.js` file with the deployed contracts.
    b) the `0xPENDING_GIT_HASH` references in `updates/l2-lip-delta-91-92.js` with the git hash from the protocol
    repository.
4.  Commit and push the changes to the [`governance-scripts` PR](https://github.com/livepeer/governor-scripts/pull/7) and later merge it before deploy.

## Step 5.1: Simulate governance update on a fork (optional)

Make a fork of mainnet after the contracts deploy and make sure the Governance script can run cleanly. Also run the
validation script from Step 8 below to make sure everything is configured correctly.

## Step 6: Renounce deployer admin role

Once the deployed contracts have been verified, the deployer admin role over the Treasury should be renounced.

To do so, run the following command with the same account with which you ran the deploy:

```
npx hardhat treasury-renounce-admin-role --network arbitrumMainnet
```

## Step 7: Run governance update

In the `governance-scripts` repository, run the governance update script:

```
node index.js create ./updates/l2-lip-delta-91-92.js 0
```

This will print out the transaction that should be run by the **protocol** governor owner to stage the update. Note that
this refers to the existing `Governor` contract that manages the protocol governance, not the new `LivepeerGovernor`
that will only manage the treasury for now.

This output should be provided to the governor owner wallet interface to stage and then execute the governance update.

## Step 8: Validate the update

You can run the [verify-delta-deployment](../tasks/verify-delta-deployment.ts) task to verify the deployment and
governance update.

To do so, run this with the same `deployer` account with which you ran the deploy:

```
npx hardhat verify-delta-deployment --network arbitrumMainnet
```

Keep in mind that it makes a voting power checkpoint of the top-stake orchestrator, in case they don't have one yet.

## Step 9: Monitor the behavior

Now wait until the next round so that the treasury reward cut rate gets updated. Check reward calls from orchestrators
and make sure they are being properly discounted by the expected 10% cut.

Also worth running the `verify-delta-deployment` script again and checking its output.

## Step 10: Deploy subgraph and explorer

Update the subgraph and explorer changes with any new contract addresses, merge them and deploy to production. This is
less risky as we can iterate quickly. Open PRs:

- https://github.com/livepeer/subgraph/pull/157
- https://github.com/livepeer/explorer/pull/224

## Step 11: Update public docs on contract addresses

Update the public docs with the new contract addresses. The list lives [here](https://github.com/livepeer/docs/blob/129b966d32883233f1c7a1c351714575306ff89b/pages/reference/deployed-contract-addresses.en-US.mdx#L17).
