import Fixture from "./helpers/Fixture"

const ServiceRegistry = artifacts.require("ServiceRegistry")

contract("ServiceRegistry", accounts => {
    describe("constructor", () => {
        it("invokes base Manager contract constructor", async () => {
            // Use dummy Controller
            const controller = accounts[0]
            const registry = await ServiceRegistry.new(controller)

            assert.equal(await registry.controller.call(), controller, "wrong Controller address")
        })
    })

    let fixture
    let registry

    before(async () => {
        fixture = new Fixture(web3)

        // Use dummy Controller in these unit tests
        // We are testing the logic of ServiceRegistry directly so we do not
        // interact with the contract via a proxy
        // Thus, we do not need an actual Controller for the tests
        const controller = accounts[0]

        registry = await ServiceRegistry.new(controller)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setServiceURI", () => {
        it("stores service URI endpoint for caller", async () => {
            await registry.setServiceURI("foo", {from: accounts[0]})
            await registry.setServiceURI("bar", {from: accounts[1]})

            assert.equal(await registry.getServiceURI(accounts[0]), "foo", "wrong service URI stored for caller 1")
            assert.equal(await registry.getServiceURI(accounts[1]), "bar", "wrong service URI stored for caller 2")
        })

        it("fires ServiceURIUpdate event", async () => {
            let e = registry.ServiceURIUpdate({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.addr, accounts[0], "wrong address in ServiceURIUpdate event")
                assert.equal(result.args.serviceURI, "foo", "wrong service URI in ServiceURIUpdate event")
            })

            await registry.setServiceURI("foo", {from: accounts[0]})
        })
    })

    describe("getServiceURI", () => {
        it("returns service URI endpoint for provided address", async () => {
            await registry.setServiceURI("foo", {from: accounts[0]})
            await registry.setServiceURI("bar", {from: accounts[1]})

            assert.equal(await registry.getServiceURI(accounts[0]), "foo", "wrong service URI stored for caller 1")
            assert.equal(await registry.getServiceURI(accounts[1]), "bar", "wrong service URI stored for caller 2")
        })

        it("returns empty string for address without stored service URI endpoint", async () => {
            assert.equal(await registry.getServiceURI(accounts[5]), "", "should return empty string for address without service URI")
        })
    })
})
