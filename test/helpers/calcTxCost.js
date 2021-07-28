import BN from "bn.js"

export default async txRes => {
    const receipt = await txRes.wait()
    const tx = await web3.eth.getTransaction(txRes.hash)
    const gasPrice = new BN(tx.gasPrice)
    const gasUsed = new BN(receipt.cumulativeGasUsed.toString())
    return gasPrice.mul(gasUsed)
}
