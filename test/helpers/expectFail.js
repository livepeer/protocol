module.exports.expectRevertWithReason = async (promise, reason) => {
    try {
        await promise
    } catch (error) {
        assert.equal(error.reason, reason, "Reverted, but with a different reason")
        return
    }

    assert.fail("Expected revert did not occur")
}
