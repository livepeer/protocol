import TranscodeReceipt from "./transcodeReceipt"

export default (segments, transcodedDataHashes) => {
    if (segments.length !== transcodedDataHashes.length) {
        throw new Error("Segments array and transcoded data hashes array must be the same length")
    }

    return segments.map((segment, idx) => {
        const receipt = new TranscodeReceipt(segment, transcodedDataHashes[idx])
        return receipt.hash()
    })
}
