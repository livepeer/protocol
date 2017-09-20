import ethAbi from "ethereumjs-abi"

export default class TranscodeReceipt {
    constructor(segment, transcodedDataHash, signedSegmentHash) {
        this.segment = segment
        this.transcodedDataHash = transcodedDataHash
        this.signedSegmentHash = signedSegmentHash
    }

    hash() {
        return ethAbi.soliditySHA3(
            ["string", "uint256", "string", "string", "bytes"],
            [
                this.segment.streamId,
                this.segment.sequenceNumber,
                this.segment.dataHash,
                this.transcodedDataHash,
                this.signedSegmentHash
            ]
        )
    }
}
