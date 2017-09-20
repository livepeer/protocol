import ethAbi from "ethereumjs-abi"

export default class Segment {
    constructor(streamId, sequenceNumber, dataHash) {
        this.streamId = streamId
        this.sequenceNumber = sequenceNumber
        this.dataHash = dataHash
    }

    hash() {
        return ethAbi.soliditySHA3(["string", "uint256", "string"], [this.streamId, this.sequenceNumber, this.dataHash])
    }
}
