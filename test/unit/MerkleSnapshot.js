const truffleAssert = require("truffle-assertions")
const {keccak256, bufferToHex} = require("ethereumjs-util")

const {MerkleTree} = require("../../utils/merkleTree")
import {assert} from "chai"
import Fixture from "./helpers/Fixture"

const MerkleSnapshot = artifacts.require("MerkleSnapshot")

contract("MerkleSnapshot", accounts => {
    let fixture
    let merkleSnapshot

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        merkleSnapshot = await MerkleSnapshot.new(fixture.controller.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setSnapshot", () => {
        it("reverts when caller is not controller owner", async () => {
            await truffleAssert.reverts(
                merkleSnapshot.setSnapshot(web3.utils.asciiToHex("1"), web3.utils.asciiToHex("helloworld"), {from: accounts[1]}),
                "caller must be Controller owner"
            )
        })

        it("sets a snapshot root for an snapshot ID", async () => {
            let id = web3.utils.asciiToHex("1")
            let root = web3.utils.padRight(web3.utils.asciiToHex("helloworld"), 64)
            await merkleSnapshot.setSnapshot(id, root)
            assert.equal(
                await merkleSnapshot.snapshot(id),
                root
            )
        })
    })

    describe("verify", () => {
        let leaves
        let tree
        let id = bufferToHex(keccak256("LIP-52"))
        before( async () => {
            leaves = ["a", "b", "c", "d"]
            tree = new MerkleTree(leaves)

            await merkleSnapshot.setSnapshot(id, tree.getHexRoot())
        })

        it("returns false when a proof is invalid", async () => {
            const badLeaves = ["d", "e", "f"]
            const badTree = new MerkleTree(badLeaves)
            const badProof = badTree.getHexProof(badLeaves[0])

            const leaf = bufferToHex(keccak256(leaves[0]))

            assert.isFalse(await merkleSnapshot.verify(id, badProof, leaf))
        })

        it("returns false when leaf is not in the tree", async () => {
            const proof = tree.getHexProof(leaves[0])
            const leaf = bufferToHex(keccak256("x"))

            assert.isFalse(await merkleSnapshot.verify(id, proof, leaf))
        })

        it("returns false when a proof is of invalid length", async () => {
            let proof = tree.getHexProof(leaves[0])
            proof = proof.slice(0, proof.length - 1)
            const leaf = bufferToHex(keccak256(leaves[0]))

            assert.isFalse(await merkleSnapshot.verify(id, proof, leaf))
        })

        it("returns true when a proof is valid", async () => {
            const proof = tree.getHexProof(leaves[0])
            const leaf = bufferToHex(keccak256(leaves[0]))
            assert.isTrue(await merkleSnapshot.verify(id, proof, leaf))
        })
    })
})
