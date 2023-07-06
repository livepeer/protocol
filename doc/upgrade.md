# Upgrade ManagerProxy Contract

A `ManagerProxy` proxy contract uses the `delegatecall` opcode to forward all function calls to a target implementation contract that is registered with the `Controller` with state managed by the proxy contract. Thus, the proxy contract can be upgraded by registering a new target implementation contract with the `Controller` by following the steps below.

Note: The addresses of all deployed contracts can be found [here](https://docs.livepeer.org/reference/deployed-contract-addresses).

## Deploy Target Implementation Contract

Set the Infura API key environment variable.

```
export INFURA_KEY=<INFURA_KEY>
```

Deploy the target implementation contract by using the `--tags` flag to specify the tag associated with the relevant deploy script.

```
PRIVATE_KEY=$(cat <PATH_TO_PRIVATE_KEY_FILE>) npx hardhat deploy --tags <TAGS> --network arbitrumMainnet
```

For example, `deploy/deploy_bonding_manager.ts` is the deploy script for the `BondingManager` target implementation contract and the following command would just run that specific deploy script.

```
PRIVATE_KEY=$(cat ~/path-to-private-key-file) npx hardhat deploy --tags BONDING_MANAGER --network arbitrumMainnet
```

After deployment, a file in the `deployments` directory containing the latest addresses of deployed contracts will be updated. The JSON file for the proxy will use the name of the contract i.e. `BondingManager` proxy -> `deployments/<NETWORK>/BondingManager.json` and the target implementation will use the name of the contract with the `Target` suffix i.e. `BondingManager` target implementation -> `deployments/<NETWORK>/BondingManagerTarget.json`. By default, the proxy file i.e. `deployments/<NETWORK>/BondingManager.json` will be updated as well even if we only want to update the target implementation file i.e. `deployments/<NETWORK>/BondingManagerTarget.json` to be updated. We can omit this change from the Git history just by running `git checkout -- deployments/<NETWORK>/BondingManager.json`.

## Verify Contract Code

Verify the contract code on arbiscan.io.

```
npx hardhat etherscan-verify --network arbitrumMainnet --license MIT --sleep
```

The `etherscan-verify` task might return an error for certain contracts. If this happens, an alternative approach is to generate a single "flattened" (contains code from all files that the contract depends on) `.sol` file that can be manually submitted on arbiscan.io.

```
npx hardhat flatten contracts/bonding/BondingManager.sol > flattened.sol
```

You can use https://arbiscan.io/verifyContract to manually submit contract code for public verification.

- The compiler config (i.e. version, optimizer runs, etc.) can be found in `hardhat.config.ts`  under `solidity.compilers`.
- For Compiler Type, select "Solidity (Single File)".
- For Open Source License Type, select "MIT"

When prompted for the code, you can copy and paste the contents of `flattened.sol`.

You can also use Tenderly to manually submit contract code for [private verification](https://docs.tenderly.co/monitoring/smart-contract-verification/verifying-a-smart-contract).

If you see an error related to multiple SPDX license identifiers, remove all SPDX license identifiers from `flattened.sol` except for a single one.

## View Contract Diff

Use the contract diff checker at https://arbiscan.io/contractdiffchecker to view the code diff between the current and new target implementation contracts in order to check that the verified code at address of the new target implementation contract contains the expected changes.

If the contract code is only privately verified in Tenderly, you can view the contract diff by copying the current target implementation contract code from arbiscan.io and the new target implementation contract code from Tenderly to local files and then running `diff current.sol new.sol`.

## Create Protocol Governor Update

Use [governor-scripts](https://github.com/livepeer/governor-scripts) to generate the update to be staged and executed by the protocol `Governor` that will register the target implementation contract with the `Controller`.

## Run Upgrade Simulation

Use [Tenderly](https://tenderly.co/) and/or Hardhat/Foundry to simulate the upgrade by creating a fork, staging/executing the protocol `Governor` update and verifying that the registration of the new target implementation contract is executed as expected.

## Stage and Execute Protocol Governor Update

The owner of the protocol `Governor` needs to submit a `stage()` transaction with the update and then after the update's delay is over (if the delay is 0 then the update is immediately executable) any address can submit an `execute()` transaction to execute the update to complete the registration of the new target implementation contract.
