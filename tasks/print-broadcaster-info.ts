import {task} from "hardhat/config"

task(
    "print-broadcaster-info",
    "Prints a broadcaster's reserve and deposit info"
)
    .addParam("address", "Broadcaster address")
    .setAction(async (taskArgs, hre) => {
        const {deployments, ethers} = hre
        const ticketBrokerDeployment = await deployments.get("TicketBroker")
        const ticketBroker = await ethers.getContractAt(
            "TicketBroker",
            ticketBrokerDeployment.address
        )

        const info = await ticketBroker.getSenderInfo(taskArgs.address)

        const parsedInfo = {
            deposit: info.sender.deposit.toString(),
            withdrawRound: info.sender.withdrawRound.toString(),
            fundsRemaining: info.reserve.fundsRemaining.toString(),
            claimedInCurrentRound: info.reserve.claimedInCurrentRound.toString()
        }

        console.log(parsedInfo)
    })
