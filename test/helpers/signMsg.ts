import {Signer} from "ethers"
import {ethers} from "hardhat"

export const getLongSigV = (signature: string) => {
    return parseInt(signature.slice(signature.length - 2, signature.length), 16)
}

export const getEIP2098V = (signature: string) => {
    //     uint8 v = uint8((uint256(vs) >> 255) + 27);
    const sigToBytes = ethers.utils.arrayify(signature)
    const v = (sigToBytes[32] >> 7) + 27
    return v
}

export const fixSig = (signature: string) => {
    // The recover() in ECDSA.sol from openzeppelin-solidity requires signatures to have a v-value that is 27/28
    // ETH clients that implement eth_sign will return a signature with a v-value that is 27/28 or 0/1 (geth returns 27/28 and ganache returns 0/1)
    // In order to support all ETH clients that implement eth_sign, we can fix the signature by ensuring that the v-value is 27/28
    let v = getLongSigV(signature)
    if (v < 27) {
        v += 27
    }

    return signature.slice(0, signature.length - 2) + v.toString(16)
}

export const sign = async (msg: string, account: string | Signer) => {
    if (typeof account === "string") {
        const acc = ethers.provider.getSigner(account)
        return acc.signMessage(ethers.utils.arrayify(msg))
    } else {
        return account.signMessage(ethers.utils.arrayify(msg))
    }
}

export default async (msg: string, account: string) => {
    return fixSig(await sign(msg, account))
}

export const flipV = (signature: string) => {
    let v = parseInt(
        signature.slice(signature.length - 2, signature.length),
        16
    )
    if (v === 27) {
        v = 28
    } else if (v === 28) {
        v = 27
    } else {
        throw new Error(`unrecognized V value ${v}`)
    }
    const result = signature
        .slice(0, signature.length - 2)
        .concat(v.toString(16))
    return result
}

// from openzeppelin [https://github.com/OpenZeppelin/openzeppelin-contracts/blob/5b28259dacf47fc208e03611eb3ba8eeaed63cc0/test/utils/cryptography/ECDSA.test.js#L12-L33]
export function to2098Format(signature: string) {
    const long = ethers.utils.arrayify(signature)

    if (long.length !== 65) {
        throw new Error("invalid signature length (expected long format)")
    }
    if (long[32] >> 7 === 1) {
        throw new Error("invalid signature 's' value")
    }
    const short = long.slice(0, 64)
    short[32] |= long[64] % 27 << 7 // set the first bit of the 32nd byte to the v parity bit
    return ethers.utils.hexlify(short)
}

// from openzeppelin [https://github.com/OpenZeppelin/openzeppelin-contracts/blob/5b28259dacf47fc208e03611eb3ba8eeaed63cc0/test/utils/cryptography/ECDSA.test.js#L12-L33]
export function from2098Format(signature: string) {
    const short = ethers.utils.arrayify(signature)
    if (short.length !== 64) {
        throw new Error("invalid signature length (expected short format)")
    }
    const long = new Uint8Array(65)
    long.set(short, 0)
    long[64] = (short[32] >> 7) + 27

    long[32] &= (1 << 7) - 1 // zero out the first bit of 1 the 32nd byte
    return ethers.utils.hexlify(long)
}
