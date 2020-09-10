const BN = require("bn.js")
const {constants} = require("../../utils/constants")

// Returns a / b scaled by PERC_DIVISOR
// See percPoints() in contracts/libraries/MathUtils.sol
const percPoints = (a, b) => {
    return a.mul(new BN(constants.PERC_DIVISOR)).div(b)
}

// Returns a * (b / c) scaled by PERC_DIVISOR
// See percOf() in contracts/libraries/MathUtils.sol
const percOf = (a, b, c) => {
    return a.mul(percPoints(b, c)).div(new BN(constants.PERC_DIVISOR))
}

module.exports = {
    percPoints,
    percOf
}
