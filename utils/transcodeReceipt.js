import ethAbi from "ethereumjs-abi"
import ethUtil from "ethereumjs-util"

export default class TranscodeReceipt {
    constructor(segment, transcodedDataHash) {
        this.segment = segment
        this.transcodedDataHash = ethUtil.toBuffer(transcodedDataHash)
    }

    hash() {
        return ethAbi.soliditySHA3(
            ["string", "uint256", "bytes", "bytes", "bytes"],
            [
                this.segment.streamId,
                this.segment.sequenceNumber,
                this.segment.dataHash,
                this.transcodedDataHash,
                this.segment.signedHash()
            ]
        )
    }
}
