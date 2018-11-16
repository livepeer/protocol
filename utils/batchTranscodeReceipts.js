import TranscodeReceipt from "./transcodeReceipt"

export default async (segments, transcodedDataHashes) => {
    if (segments.length !== transcodedDataHashes.length) {
        throw new Error("Segments array and transcoded data hashes array must be the same length")
    }

    const receiptHashes = []

    for (let i = 0; i < segments.length; i++) {
        const receipt = new TranscodeReceipt(segments[i], transcodedDataHashes[i])
        receiptHashes.push(await receipt.hash())
    }

    // return segments.map(async (segment, idx) => {
    //     const receipt = new TranscodeReceipt(segment, transcodedDataHashes[idx])
    //     return await receipt.hash()
    // })
    return receiptHashes
}
