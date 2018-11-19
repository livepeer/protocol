import BN from "bn.js"

export default async txRes => {
    const tx = await web3.eth.getTransaction(txRes.tx)
    const gasPrice = new BN(tx.gasPrice)
    const gasUsed = new BN(txRes.receipt.gasUsed)
    return gasPrice.mul(gasUsed)
}
