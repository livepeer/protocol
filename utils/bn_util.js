import BigNumber from "bignumber.js";

export function toSmallestUnits(value, decimals = 18) {
    const bigVal = new BigNumber(value);
    const units = new BigNumber(10).pow(decimals);

    return bigVal.times(units);
}
