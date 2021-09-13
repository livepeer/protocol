import RPC from "../../../utils/rpc"
import {contractId} from "../../../utils/helpers"
import {
    StakingManagerMock,
    StakingManagerMock__factory,
    BondingManagerMock,
    BondingManagerMock__factory,
    Controller,
    Controller__factory,
    GenericMock,
    GenericMock__factory,
    MinterMock,
    MinterMock__factory
} from "../../../typechain"
import Web3 from "web3"
import {BaseContract, ContractFactory} from "@ethersproject/contracts"
import {ethers} from "hardhat"

export default class Fixture {
    private rpc: RPC
    private commitHash: string
    private currentSnapshotId?: string

    // contracts
    public controller?: Controller
    public token?: GenericMock
    public minter?: MinterMock
    public stakingManager?: StakingManagerMock
    public bondingManager?: BondingManagerMock
    public roundsManager?: GenericMock
    public jobsManager?: GenericMock
    public ticketBroker?: GenericMock
    public merkleSnapshot?: GenericMock

    constructor(web3: Web3) {
        this.rpc = new RPC(web3)
        this.commitHash = "0x3031323334353637383930313233343536373839"
    }

    async deploy() {
        const signers = await ethers.getSigners()
        const controllerFactory = new Controller__factory(signers[0])
        this.controller = await controllerFactory.deploy()

        await this.deployMocks()
        await this.controller.unpause()
    }

    async deployMocks() {
        const signers = await ethers.getSigners()
        const GenericMockFactory = new GenericMock__factory(signers[0])
        const MinterMockFactory = new MinterMock__factory(signers[0])
        const StakingManagerMockFactory = new StakingManagerMock__factory(signers[0])
        const BondingManagerMockFactory = new BondingManagerMock__factory(signers[0])

        this.token = await this.deployAndRegister<GenericMock>(GenericMockFactory, "LivepeerToken")
        this.minter = await this.deployAndRegister<MinterMock>(MinterMockFactory, "Minter")
        this.stakingManager = await this.deployAndRegister<StakingManagerMock>(
            StakingManagerMockFactory,
            "StakingManager"
        )
        this.bondingManager = await this.deployAndRegister<BondingManagerMock>(
            BondingManagerMockFactory,
            "BondingManager"
        )
        this.roundsManager = await this.deployAndRegister<GenericMock>(GenericMockFactory, "RoundsManager")
        this.jobsManager = await this.deployAndRegister<GenericMock>(GenericMockFactory, "JobsManager")
        this.ticketBroker = await this.deployAndRegister<GenericMock>(GenericMockFactory, "TicketBroker")
        this.merkleSnapshot = await this.deployAndRegister<GenericMock>(GenericMockFactory, "MerkleSnapshot")
        // Register TicketBroker with JobsManager contract ID because in a production system the Minter likely will not be upgraded to be
        // aware of the TicketBroker contract ID and it will only be aware of the JobsManager contract ID
        await this.register("JobsManager", this.ticketBroker.address)
    }

    async register(name: string, addr: string) {
        // Use dummy Git commit hash
        await this.controller?.setContractInfo(contractId(name), addr, this.commitHash)
    }

    async deployAndRegister<T extends BaseContract>(contractFactory: ContractFactory, name: string, ...args: any) {
        const contract = await contractFactory.deploy(...args)
        await contract.deployed()
        await this.register(name, contract.address)
        return contract as T
    }

    async setUp() {
        this.currentSnapshotId = await this.rpc.snapshot()
    }

    async tearDown() {
        await this.rpc.revert(this.currentSnapshotId)
    }
}
