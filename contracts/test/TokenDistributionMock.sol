pragma solidity ^0.4.17;

import "../token/ITokenDistribution.sol";


contract TokenDistributionMock is ITokenDistribution {
    // End time of the distribution
    uint256 endTime;
    // Is the distribution over
    bool over;

    function TokenDistributionMock(uint256 _endTime) public {
        endTime = _endTime;
        over = false;
    }

    function finalize() external {
        require(!isOver());

        over = true;
    }

    function isOver() public view returns (bool) {
        return over;
    }

    function getEndTime() public view returns (uint256) {
        return endTime;
    }
}
