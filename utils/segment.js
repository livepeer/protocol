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

    async signedHash() {
        return ethUtil.toBuffer(await web3.eth.sign(ethUtil.bufferToHex(this.hash()), this.broadcaster))
    }
}
