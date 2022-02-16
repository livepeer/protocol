import {ethers} from "hardhat"
import hre from "hardhat"
import {BondingManager} from "../typechain"

const transcoders = [
    "0x02b6AAc33a397aaadee5227C70c69bB97F2CC529",
    "0x08f10D03A0CF7a9eADdc7EacD4cf135a07A0feff",
    "0x0fC80AFB7876f579F1fb1c4d1C37Cf1339038658",
    "0x104a7CA059A35Fd4dEF5Ecb16600B2CaA1Fe1361",
    "0x10742714F33f3d804E3FA489618b5c3Ca12a6dF7",
    "0x10b21af759129F32C6064ADfb85d3eA2a8C0209c",
    "0x10e0A91E652b05e9C7449ff457Cf2E96C3037fB7",
    "0x11b04d9A305abE978aEADdc67d9d09aAa4996090",
    "0x1a196B031ea1A74a53eCBE6148772648E02f9d51",
    "0x1d5919EBdC911EA2f3b9F6CDc6F8df8010b36541",
    "0x21d1130DC36958dB75fbB0e5a9E3e5F5680238FF",
    "0x22Ae24C2D1f489906266609d14c4C0387909A38a",
    "0x25Fa0e2B1CD178e9bA706721313CC7caB315F520",
    "0x2e3a21ae7cDEb48F57fcaD1cE16b258d5502aC05",
    "0x3b28a7D785356Dc67C7970666747e042305bfB79",
    "0x3bBE84023C11c4874F493d70B370D26390e3c580",
    "0x3E2B450c0c499D8301146367680E067CD009DB93",
    "0x41239FB65360981316fcB4a8548320D305F9496D",
    "0x432e26fC08f236c78fD237882018a95B4c0a3D2A",
    "0x4a43B1D7e6227C8b0512e413F406555647ff7bdB",
    "0x4bcC9256418B29C482596443FA5C99ae114b3351",
    "0x4f4758F7167B18e1F5B3c1a7575E3eb584894dbc",
    "0x525419FF5707190389bfb5C87c375D710F5fCb0E",
    "0x597aD7F7A1C9F8d0121a9e949Cca7530F2B25ef6",
    "0x5bE44e23041E93CDF9bCd5A0968524e104e38ae1",
    "0x5d11abD838073Df76E32c495F97Fd3239EabB9Fb",
    "0x6C06d3246FbB77C4Ad75480E03d2a0A8eaF68121",
    "0x6CB1Ce2516FB7d211038420a8Cf9a843c7bD3B08",
    "0x74BA897F65f04008d8efF364efcc54B0A20E17eb",
    "0x77543034d85CA10942685289E374a67e21A0F531",
    "0x78A5a644801F7f62B91F26032BC1b7976a4F6790",
    "0x847791cBF03be716A7fe9Dc8c9Affe17Bd49Ae5e",
    "0x942f0C28fb85ea0B50BfB76A3ecfA99861fA9b4B",
    "0x980998E39D29Dc5A92e7403fC9cD47e68b63Ad5f",
    "0x9c5874Aa481b9c652d5420D65cE8beCAAD9FF3A7",
    "0x9D5611bf0DAdddb4441A709141d9229d7F6b3e47",
    "0x9D61ae5875E89036FBf6059f3116d01a22ACe3C8",
    "0x9E48D670D2BD7300796caa6c05e3D2cc41B8CB9C",
    "0xa20416801aC2eACf2372e825B4a90ef52490c2Bb",
    "0xb5164D6B780786338C52F4787ABba0e4a371Af4d",
    "0xB9EF631F4acfF1E24aEcec4B895bc190F1c26cf1",
    "0xBAc7744ADA4AB1957CBaAFEF698B3c068bEB4fe0",
    "0xbdcBE92BEfbf36D63eC547BBa5842997d77DC841",
    "0xBe8770603dAf200b1Fa136aD354BA854928e602B",
    "0xd00354656922168815Fcd1e51CBddB9e359e3C7F",
    "0xd0AA1b9d0cd06caFA6AF5C1aF272be88c38AA831",
    "0xd18a02647d99dC9F79AfbE0f58f8353178e6141F",
    "0xd21ee13175e0cf56876e76B0FA4003Cd19e9AD2E",
    "0xd84781e1a9b74D71EA76cDa8bb9F30893BFd00D1",
    "0xda43d85B8d419a9C51BBF0089C9bd5169c23F2f9",
    "0xDAC817294c0c87ca4fA1895eF4b972EAde99f2fd",
    "0xE3a5793d7c1D2a04A903FA1695b3E3555d6084CA",
    "0xe3Dd93281188d27762dc4D91Fc90391c5210cD1D",
    "0xE9E284277648fcdb09B8EfC1832c73c09b5Ecf59",
    "0xf4e8Ef0763BCB2B1aF693F5970a00050a6aC7E1B",
    "0xf7dA517712844b47FEBE9973FB7712691fDf6E28",
    "0xf8fb0Aef25b850dC8d8aeeAd92Eb64a3010795a0"
]

const getBondingManagerAddr = (): string => {
    if (hre.network.name === "mainnet") {
        return "0x511bc4556d823ae99630ae8de28b9b80df90ea2e"
    } else {
        return "0x35Bcf3c30594191d53231E4FF333E8A770453e40"
    }
}

const getPendingStake = async (orchAddr: string, blockNum: number) => {
    const signer = await ethers.getSigners()

    const bondingManager: BondingManager = await ethers.getContractAt(
        "BondingManager",
        getBondingManagerAddr(),
        signer[0]
    )

    const pendingStake = await bondingManager.pendingStake(
        orchAddr,
        ethers.constants.MaxInt256,
        {
            blockTag: blockNum + 1
        }
    )

    return {
        address: orchAddr,
        stake: ethers.utils.formatEther(pendingStake),
        block: blockNum + 1
    }
}

const getMigratedOrchestrators = async () => {
    const l2MigratorAddr = "0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085"
    const l2MigratorDeployBlock = 5864923

    const signer = await ethers.getSigners()

    const L2MigratorAbi = [
        "event MigrateDelegatorFinalized((address,address,uint256,uint256,uint256,address))"
    ]

    const l2Migrator = await ethers.getContractAt(
        L2MigratorAbi,
        l2MigratorAddr,
        signer[0]
    )

    const events = await l2Migrator.queryFilter(
        l2Migrator.filters.MigrateDelegatorFinalized(),
        l2MigratorDeployBlock, // deployment block
        6160553
    )

    return events.map((event: any) => {
        return {address: event.args[0][0], block: event.blockNumber}
    })
}

async function main(): Promise<void> {
    const migratedDelegators = await getMigratedOrchestrators()

    let pendingStake

    if (hre.network.name === "mainnet") {
        pendingStake = await Promise.all(
            transcoders.map(orch => getPendingStake(orch, 14204799)) // block of last reward call
        )
    } else {
        pendingStake = await Promise.all(
            migratedDelegators.map(orch =>
                getPendingStake(orch.address, orch.block)
            )
        )
    }

    const sorted = pendingStake.sort((a, b) => {
        if (
            ethers.BigNumber.from(a.address).gt(
                ethers.BigNumber.from(b.address)
            )
        ) {
            return 1
        }
        if (
            ethers.BigNumber.from(b.address).gt(
                ethers.BigNumber.from(a.address)
            )
        ) {
            return -1
        }
        return 0
    })

    sorted.map(s => console.log(s.address, s.block, s.stake))
}

main()
    .then(() => process.exit(0))
    .catch((error: Error) => {
        console.error(error)
        process.exit(1)
    })
