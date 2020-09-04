const { keccak256, bufferToHex } = require('ethereumjs-util');
import ethAbi from "ethereumjs-abi"

export function contractId(name) {
    return bufferToHex(ethAbi.soliditySHA3(["string"], [name]))
}

export function functionSig(name) {
    return bufferToHex(keccak256(name).slice(0, 4))
}

export function eventSig(name) {
    return bufferToHex(keccak256(name))
}

export function functionEncodedABI(name, params, values) {
    return bufferToHex(Buffer.concat([keccak256(name).slice(0, 4), ethAbi.rawEncode(params, values)]))
}
