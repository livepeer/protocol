import {constants} from "../../utils/constants"

const createTicket = ticketObj => {
    ticketObj = ticketObj ? ticketObj : {}

    return {
        recipient: isSet(ticketObj.recipient) ? ticketObj.recipient : constants.NULL_ADDRESS,
        sender: isSet(ticketObj.sender) ? ticketObj.sender : constants.NULL_ADDRESS,
        faceValue: isSet(ticketObj.faceValue) ? ticketObj.faceValue : 0,
        winProb: isSet(ticketObj.winProb) ? ticketObj.winProb : 0,
        senderNonce: isSet(ticketObj.senderNonce) ? ticketObj.senderNonce : 0,
        recipientRandHash: isSet(ticketObj.recipientRandHash) ? ticketObj.recipientRandHash : constants.NULL_BYTES,
        creationTimestamp: isSet(ticketObj.creationTimestamp) ? ticketObj.creationTimestamp : getValidTimestamp()
    }
}

const createWinningTicket = (recipient, sender, recipientRand, faceValue = 0) => {
    const recipientRandHash = web3.utils.soliditySha3(recipientRand)
    const ticketObj = {
        recipient,
        sender,
        faceValue,
        winProb: constants.MAX_UINT256.toString(),
        recipientRandHash
    }

    return createTicket(ticketObj)
}

const ticketHash = ticketObj => {
    return web3.utils.soliditySha3(
        ticketObj.recipient,
        ticketObj.sender,
        ticketObj.faceValue,
        ticketObj.winProb,
        ticketObj.senderNonce,
        ticketObj.recipientRandHash,
        ticketObj.creationTimestamp
    )
}

const getValidTimestamp = () => {
    const result = new Date()
    result.setDate(result.getDate() + 365)
    return parseInt(result.getTime() / 1000)
}

const isSet = v => {
    return typeof v != undefined && v != null
}

module.exports = {
    createTicket,
    createWinningTicket,
    ticketHash
}
