export const getLongSigV = signature => {
    return parseInt(signature.slice(signature.length - 2, signature.length), 16)
}

export const getEIP2098V = signature => {
    //     uint8 v = uint8((uint256(vs) >> 255) + 27);
    const sigToBytes = web3.utils.hexToBytes(signature)
    const v = (sigToBytes[32] >> 7) + 27
    return v
}

export const fixSig = sig => {
    // The recover() in ECDSA.sol from openzeppelin-solidity requires signatures to have a v-value that is 27/28
    // ETH clients that implement eth_sign will return a signature with a v-value that is 27/28 or 0/1 (geth returns 27/28 and ganache returns 0/1)
    // In order to support all ETH clients that implement eth_sign, we can fix the signature by ensuring that the v-value is 27/28
    let v = getLongSigV(sig)
    if (v < 27) {
        v += 27
    }

    return sig.slice(0, sig.length - 2) + v.toString(16)
}

export const web3Sign = async (msg, account) => {
    return web3.eth.sign(msg, account)
}

export default async (msg, account) => {
    return fixSig(await web3Sign(msg, account))
}

export const flipV = sig => {
    let v = parseInt(sig.slice(sig.length - 2, sig.length), 16)
    if (v === 27) {
        v = 28
    } else if (v === 28) {
        v = 27
    } else {
        throw new Error(`unrecognized V value ${v}`)
    }
    const result = sig.slice(0, sig.length - 2).concat(v.toString(16))
    return result
}

// from openzeppelin [https://github.com/OpenZeppelin/openzeppelin-contracts/blob/5b28259dacf47fc208e03611eb3ba8eeaed63cc0/test/utils/cryptography/ECDSA.test.js#L12-L33]
export function to2098Format(signature) {
    const long = web3.utils.hexToBytes(signature)

    if (long.length !== 65) {
        throw new Error("invalid signature length (expected long format)")
    }
    if (long[32] >> 7 === 1) {
        throw new Error("invalid signature 's' value")
    }
    const short = long.slice(0, 64)
    short[32] |= long[64] % 27 << 7 // set the first bit of the 32nd byte to the v parity bit
    return web3.utils.bytesToHex(short)
}

// from openzeppelin [https://github.com/OpenZeppelin/openzeppelin-contracts/blob/5b28259dacf47fc208e03611eb3ba8eeaed63cc0/test/utils/cryptography/ECDSA.test.js#L12-L33]
export function from2098Format(signature) {
    const short = web3.utils.hexToBytes(signature)
    if (short.length !== 64) {
        throw new Error("invalid signature length (expected short format)")
    }
    short.push((short[32] >> 7) + 27)
    short[32] &= (1 << 7) - 1 // zero out the first bit of 1 the 32nd byte
    return web3.utils.bytesToHex(short)
}
