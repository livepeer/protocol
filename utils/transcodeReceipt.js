import ethAbi from "ethereumjs-abi"

export default class TranscodeReceipt {
    constructor(segment, transcodedDataHash) {
        this.segment = segment
        this.transcodedDataHash = transcodedDataHash
    }

    hash() {
        return ethAbi.soliditySHA3(
            ["string", "uint256", "string", "string", "bytes"],
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
