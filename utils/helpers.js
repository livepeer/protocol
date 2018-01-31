import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

export function contractId(name) {
    return ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], [name]))
}

export function functionSig(name) {
    return ethUtil.bufferToHex(ethUtil.sha3(name).slice(0, 4))
}

export function functionEncodedABI(name, params, values) {
    return ethUtil.bufferToHex(Buffer.concat([ethUtil.sha3(name).slice(0, 4), ethAbi.rawEncode(params, values)]))
}
