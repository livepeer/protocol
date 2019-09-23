const abiDecoder = require("abi-decoder")
const util = require("ethereumjs-util")

// TODO: format this function's arguments equal to truffleAssert.eventEmitted
// and make this a wrapper around truffleAssert.eventEmitted
// we can simply overwrite the transaction receipt with the decoded logs

export default function(abi, transaction, name, filter, message) {
    let logs = []

    abiDecoder.addABI(abi)
    let decodedLog = abiDecoder.decodeLogs(transaction.receipt.rawLogs)

    // reconstruct the logs-array identical to how they should appear
    // on the transaction receipt
    for (let i = 0; i < decodedLog.length; i++) {
        let tempArgs = {}
        logs[i] = {"event": decodedLog[i].name}
        for (let j = 0; j < decodedLog[i].events.length; j++ ) {
            let key = decodedLog[i].events[j].name
            let val = decodedLog[i].events[j].value
            tempArgs[`${key}`] = val
        }
        logs[i].args = tempArgs
    }

    const event = logs.find(l => l.event == name)

    if (!event) assert.fail(message)

    for (let key in filter) {
        // abi-decoder doesn't return a checksum address
        // so comparison fails
        if (util.isValidAddress(event.args[key])) {
            assert.equal(util.toChecksumAddress(event.args[key]), util.toChecksumAddress(filter[key]), message)
        } else {
            assert.equal(event.args[key], filter[key], message)
        }
    }
}
