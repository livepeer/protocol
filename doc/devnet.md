# Deploying contracts in a single network devnet

## Prerequisites

- Copy [`.env.sample`](../.env.sample) to a `.env` file in the repo root
- Insert values for all the environment variables
  - The ETHERSCAN_API_KEY is optional, but if you want to verify the contracts on "Etherscan" you need to provide it. It
    should also be from the Etherscan-like service from the network you are deploying to (e.g. Arbiscan for Arbitrum).
- Pick a testnet to use and make sure its configured in:
  - [`hardhat.config.ts`](../hardhat.config.ts#L56)
  - [`deploy/migrations.config.ts`](../deploy/migrations.config.ts#L185)
  - `LIVE_NETWORKS` config in [`deploy/deploy_contracts.ts`](../deploy/deploy_contracts.ts#L26)
- The name of this testnet will be referred as `<network>` in the commands below

## Deployment

- `yarn deploy --network <network>` to deploy all the core protocol contracts
- `npx hardhat deploy --tags ARBITRUM_LPT_DUMMIES --network <network>` to deploy the L2 bridge no-ops

## Verification

To verify all contracts that have been deployed in the network on the corresponding etherscan-like service:

- `yarn etherscan-verify --network <network>`

## Housekeeping

Make sure you save or commit the `deployments` folder from your run if you want to guarantee a reference to them. If you
run the deployment commands again they will override most of the previous deployment metadata.
