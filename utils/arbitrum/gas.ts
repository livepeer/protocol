import {BigNumber, ethers} from "ethers"
import {getArbitrumCoreContracts} from "./contracts"

export async function getGasPriceBid(l2: ethers.providers.BaseProvider): Promise<BigNumber> {
    return await l2.getGasPrice()
}

export async function getMaxSubmissionPrice(
    l2: ethers.providers.BaseProvider,
    calldataOrCalldataLength: string | number
) {
    const calldataLength =
    typeof calldataOrCalldataLength === "string" ? calldataOrCalldataLength.length : calldataOrCalldataLength
    const [submissionPrice] = await getArbitrumCoreContracts(l2).arbRetryableTx.getSubmissionPrice(calldataLength)
    const maxSubmissionPrice = submissionPrice.mul(4)
    return maxSubmissionPrice
}

export async function getMaxGas(
    l2: ethers.providers.BaseProvider,
    sender: string,
    destination: string,
    refundDestination: string,
    maxSubmissionPrice: BigNumber,
    gasPriceBid: BigNumber,
    calldata: string
): Promise<BigNumber> {
    const [estimatedGas] = await getArbitrumCoreContracts(l2).nodeInterface.estimateRetryableTicket(
        sender,
        ethers.utils.parseEther("0.05"),
        destination,
        0,
        maxSubmissionPrice,
        refundDestination,
        refundDestination,
        0,
        gasPriceBid,
        calldata
    )
    const maxGas = estimatedGas.mul(4)

    return maxGas
}
