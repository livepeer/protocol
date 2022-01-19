import {ethers} from "ethers"

export const arbitrumBridgeContracts: any = {
    mainnet: {
        l1GatewayRouter: "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef",
        l2GatewayRouter: "0x5288c571Fd7aD117beA99bF60FE0846C4E84F933",
        inbox: "0x4c6f947Ae67F572afa4ae0730947DE7C874F95Ef",
        outbox: "0x760723CD2e632826c38Fef8CD438A4CC7E7E1A40"
    },
    rinkeby: {
        l1GatewayRouter: "0x70C143928eCfFaf9F5b406f7f4fC28Dc43d68380",
        l2GatewayRouter: "0x9413AD42910c1eA60c737dB5f58d1C504498a3cD",
        inbox: "0x578BAde599406A8fE3d24Fd7f7211c0911F5B29e",
        outbox: "0x2360A33905dc1c72b12d975d975F42BaBdcef9F3"
    }
}

export const arbitrumL2CoreContracts = {
    arbRetryableTx: "0x000000000000000000000000000000000000006E",
    nodeInterface: "0x00000000000000000000000000000000000000C8"
}

export function getArbitrumCoreContracts(l2: ethers.providers.BaseProvider) {
    return {
        arbRetryableTx: new ethers.Contract(
            arbitrumL2CoreContracts.arbRetryableTx,
            require("./abis/ArbRetryableTx.json").abi,
            l2
        ),
        nodeInterface: new ethers.Contract(
            arbitrumL2CoreContracts.nodeInterface,
            require("./abis/NodeInterface.json").abi,
            l2
        )
    }
}
