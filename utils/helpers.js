import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const POLLING_INTERVAL_MILLISECONDS = 1200

export async function awaitTransactionToBeMined(txHash) {
    let tx = await web3.eth.getTransaction(txHash)
    while (tx.blockNumber == null) {
        await sleep(POLLING_INTERVAL_MILLISECONDS)
    }
}

function sleep(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds)
    })
}

export function contractId(name) {
    return ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], [name]))
}
