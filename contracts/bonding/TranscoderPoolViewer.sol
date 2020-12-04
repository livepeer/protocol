pragma solidity ^0.5.11; 
pragma experimental ABIEncoderV2;

import "./IBondingManager.sol";
import "../serviceRegistry/IServiceRegistry.sol";

contract TranscoderPoolViewer {
    struct Contracts {
        IBondingManager bondingManager;
        IServiceRegistry serviceRegistry;
    }

    struct Transcoder {
        address transcoder;
        uint256 lastRewardRound;
        uint256 rewardCut;
        uint256 feeShare;
        uint256 activationRound;
        uint256 deactivationRound;
        uint256 delegatedStake;
        string  serviceURI;
        string  status;
        bool    active;
    }

    address constant public NULL_ADDRESS = address(0);

    function getTranscoderPool(Contracts calldata _contracts) external view returns (Transcoder[] memory) {
        uint256 poolSize = _contracts.bondingManager.getTranscoderPoolSize();
        uint256 index = 0;
        
        Transcoder[] memory transcoders = new Transcoder[](poolSize);
        
        address current = _contracts.bondingManager.getFirstTranscoderInPool();
        while (current != NULL_ADDRESS) {
            transcoders[index] = this.getTranscoder(_contracts, current);
            index++;
            
            current = _contracts.bondingManager.getNextTranscoderInPool(current);
        }
        
        return transcoders;
    }
    
    function getTranscoder(Contracts calldata _contracts, address _transcoder) external view returns (Transcoder memory) {
        (uint256 lastRewardRound, uint256 rewardCut, uint256 feeShare,, uint256 activationRound, uint256 deactivationRound,,,,) = _contracts.bondingManager.getTranscoder(_transcoder);
        string memory serviceURI = _contracts.serviceRegistry.getServiceURI(_transcoder);
        bool isActive = _contracts.bondingManager.isActiveTranscoder(_transcoder);
        string memory status = parseTranscoderStatus(_contracts.bondingManager.transcoderStatus(_transcoder));
        uint256 delegatedStake = _contracts.bondingManager.transcoderTotalStake(_transcoder);
        
        return Transcoder({
                transcoder: _transcoder,
                lastRewardRound: lastRewardRound,
                rewardCut: rewardCut,
                feeShare: feeShare,
                activationRound: activationRound,
                deactivationRound: deactivationRound,
                delegatedStake: delegatedStake,
                serviceURI: serviceURI,
                status: status,
                active: isActive
            });
    }
    
    function getStakesForRound(Contracts calldata _contracts, address[] calldata _transcoders, uint256 _round) external view returns (uint256[] memory) {
        uint256[] memory stakes = new uint256[](_transcoders.length);
        for (uint256 i = 0; i < _transcoders.length; i++) {
            (,,uint256 activeStake,,,,,,,,) =  _contracts.bondingManager.getTranscoderEarningsPoolForRound(_transcoders[i], _round);
            stakes[i] = activeStake;
        }
        return stakes;
    }
    
    function parseTranscoderStatus(IBondingManager.TranscoderStatus _status) internal pure returns (string memory) {
        if (_status == IBondingManager.TranscoderStatus.Registered) return "Registered";
        if (_status == IBondingManager.TranscoderStatus.NotRegistered) return "Not Registered";
        return "";
    }
}