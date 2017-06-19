import leftPad from "left-pad";
import { sha3 } from "ethereumjs-util";

const HEX_CHAR_SIZE = 4;

const DEFAULT_SIZE = 256;

const encodeWithPadding = size => value => {
    return typeof value === "string"
        ? web3.toHex(value).slice(2)
        : encodeNum(size)(value);
};

const encodeNum = size => value => {
    return leftPad(web3.toHex(value < 0 ? value >>> 0 : value).slice(2), size / HEX_CHAR_SIZE, value < 0 ? 'F' : '0');
};

export function soliditySha3(...args) {
    const paddedArgs = args.map(encodeWithPadding(DEFAULT_SIZE)).join("");
    return sha3(paddedArgs);
}
