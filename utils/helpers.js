import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

export function contractId(name) {
    return ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], [name]))
}

export function functionSig(name) {
    return ethUtil.bufferToHex(ethUtil.sha3(name).slice(0, 4))
}
