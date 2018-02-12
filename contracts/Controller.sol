pragma solidity ^0.4.17;

import "./IController.sol";
import "./IManager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract Controller is Pausable, IController {
    // Track information about a registered contract
    struct ContractInfo {
        address contractAddress;                 // Address of contract
        bytes20 gitCommitHash;                   // SHA1 hash of head Git commit during registration of this contract
    }

    // Track contract ids and contract info
    mapping (bytes32 => ContractInfo) private registry;

    function Controller() public {
        // Start system as paused
        paused = true;
    }

    /*
     * @dev Register contract id and mapped address
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _contract Contract address
     */
    function setContractInfo(bytes32 _id, address _contractAddress, bytes20 _gitCommitHash) external onlyOwner {
        registry[_id].contractAddress = _contractAddress;
        registry[_id].gitCommitHash = _gitCommitHash;

        SetContractInfo(_id, _contractAddress, _gitCommitHash);
    }

    /*
     * @dev Update contract's controller
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _controller Controller address
     */
    function updateController(bytes32 _id, address _controller) external onlyOwner {
        return IManager(registry[_id].contractAddress).setController(_controller);
    }

    /*
     * @dev Return contract info for a given contract id
     * @param _id Contract id (keccak256 hash of contract name)
     */
    function getContractInfo(bytes32 _id) public view returns (address, bytes20) {
        return (registry[_id].contractAddress, registry[_id].gitCommitHash);
    }

    /*
     * @dev Get contract address for an id
     * @param _id Contract id
     */
    function getContract(bytes32 _id) public view returns (address) {
        return registry[_id].contractAddress;
    }
}
