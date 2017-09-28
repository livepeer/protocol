import ethAbi from "ethereumjs-abi"
import ethUtil from "ethereumjs-util"

export default class Segment {
    constructor(streamId, sequenceNumber, dataHash, broadcaster) {
        this.streamId = streamId
        this.sequenceNumber = sequenceNumber
        this.dataHash = ethUtil.toBuffer(dataHash)
        this.broadcaster = broadcaster
    }

    hash() {
        return ethAbi.soliditySHA3(["string", "uint256", "bytes"], [this.streamId, this.sequenceNumber, this.dataHash])
    }

    signedHash() {
        return ethUtil.toBuffer(web3.eth.sign(this.broadcaster, ethUtil.bufferToHex(this.hash())))
    }
}
