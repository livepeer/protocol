# Livepeer Delta upgrade deployment steps

## Step 1: Deploy contracts

Run the deployment script to deploy the new contracts:

```
npx hardhat deploy --tags DELTA_UPGRADE --network arbitrumMainnet
```

You must configure the private key for an account that has enough ETH to run the transactions.

## Step 2: Prepare governance update

1.  Grab the full git hash from the current repository where you ran the deployment script, or get it from the output of
    the pending governance actions.
2.  Also obtain the addresses of the contracts deployed above. You can find them in the corresponding `deployments` directory or
    in the output of the deployment script.
3.  Now on the `governance-scripts` repository, update:
    a) the `0xPENDING_ADDRESS` address entries on the `updates/addresses.js` file with the deployed contracts.
    b) the `0xPENDING_GIT_HASH` references in `updates/l2-lip-delta-91-92.js` with the git hash from the protocol
    repository.

## Step 3: Run governance update

In the `governance-scripts` repository, run the governance update script:

```
node index.js create ./updates/l2-lip-delta-91-92.js 0
```

This will print out the transaction that should be run by the governor owner to stage the update
on the governance contract.

This should now be provided to the wallet interface to stage and then execute the governance update.

## Step 4: Validate the update

You can run the task at
[https://github.com/livepeer/protocol/blob/vg/fork-test-2/tasks/verify-delta-deployment.ts](verify-delta-deployment.ts)
to verify the deployment and governance update.

To do so, copy that task to your local task folder and then run:

```
npx hardhat verify-delta-deployment --network arbitrumMainnet
```

## Step 5: Renounce deployer admin role

Once the governance update has been executed and the update validated (e.g. wait for next round and some treasury
contributions to take place as expected), the deployer admin role should be renounced.

To do so, run the following command with the same account with which you ran the deploy:

```
npx hardhat treasury-renounce-admin-role --network arbitrumMainnet
```
