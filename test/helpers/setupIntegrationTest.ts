import {deployments} from "hardhat"
import {GenericMock__factory} from "../../typechain"
import {contractId} from "../../utils/helpers"

const setupIntegrationTest = deployments.createFixture(
    async (
        {deployments, getNamedAccounts, ethers},
        opts?: { tags: string[] }
    ) => {
        const tags = opts?.tags ?? ["Contracts"]
        const fixture = await deployments.fixture(tags)
        const {deployer} = await getNamedAccounts()
        const signer = await ethers.getSigner(deployer)

        const controller = await ethers.getContractAt(
            "Controller",
            fixture.Controller.address
        )

        const GenericMock: GenericMock__factory =
            await ethers.getContractFactory("GenericMock")
        const mock = await GenericMock.deploy()

        const info = await controller.getContractInfo(
            contractId("BondingManager")
        )
        const gitCommitHash = info[1]
        await controller
            .connect(signer)
            .setContractInfo(
                contractId("L2LPTDataCache"),
                mock.address,
                gitCommitHash
            )

        return fixture
    }
)

export default setupIntegrationTest
