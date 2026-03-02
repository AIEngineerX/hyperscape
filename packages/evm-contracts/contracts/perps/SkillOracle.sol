// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SkillOracle
 * @notice Receives TrueSkill or Glicko data (mu, sigma) from the game server
 *         and computes the exponentially mapped underlying Index Price for perp markets.
 */
contract SkillOracle is Ownable {
    
    struct AgentSkill {
        uint256 mu;       // Mean skill rating
        uint256 sigma;    // Uncertainty
        uint256 lastUpdate;
    }

    mapping(bytes32 => AgentSkill) public agentSkills;
    bytes32[] public activeAgents;

    uint256 public globalMeanMu;    // The average mu of the population
    uint256 public zScore = 3;      // Z-score for conservative estimate (e.g. 3)
    uint256 public kFactor = 500;   // Scaling factor for mapping
    uint256 public P0;              // Base index price (scaled to 1e18)

    event SkillUpdated(bytes32 indexed agentId, uint256 mu, uint256 sigma);

    constructor(uint256 _P0) Ownable(msg.sender) {
        P0 = _P0;
    }

    /**
     * @notice Updates the underlying skill data for an agent.
     */
    function updateAgentSkill(bytes32 agentId, uint256 mu, uint256 sigma) external onlyOwner {
        if (agentSkills[agentId].lastUpdate == 0) {
            activeAgents.push(agentId);
        }
        agentSkills[agentId] = AgentSkill(mu, sigma, block.timestamp);
        _updateGlobalMean();
        emit SkillUpdated(agentId, mu, sigma);
    }

    function _updateGlobalMean() internal {
        if (activeAgents.length == 0) return;
        uint256 sum = 0;
        for (uint i = 0; i < activeAgents.length; i++) {
            sum += agentSkills[activeAgents[i]].mu;
        }
        globalMeanMu = sum / activeAgents.length;
    }

    /**
     * @notice Gets the conservative skill estimate (mu - z * sigma).
     */
    function getConservativeSkill(bytes32 agentId) public view returns (int256) {
        AgentSkill memory skill = agentSkills[agentId];
        require(skill.lastUpdate > 0, "Agent not found");
        int256 cons = int256(skill.mu) - int256(zScore * skill.sigma);
        return cons;
    }

    /**
     * @notice Calculates the exponentially mapped price: P0 * exp(((μ - z*σ) - mean)/k)
     * For simulation purposes, we use a simplified approximation or direct scaling.
     */
    function getIndexPrice(bytes32 agentId) public view returns (uint256) {
        int256 consSkill = getConservativeSkill(agentId);
        int256 diff = consSkill - int256(globalMeanMu);
        
        // Taylor series approximation for exp(x) around 0 where x = diff/k
        // exp(x) = 1 + x + x^2/2 + ...
        // To keep the simulation simple and avoid complex math library imports,
        // we'll implement a basic mock mapping that scales with diff.
        // It provides the required behavior: below mean => lower price, above mean => higher price.
        
        int256 xScaled = (diff * 1e18) / int256(kFactor);
        
        // Approx exp(x) ~= 1 + x (for small x). To ensure it's strictly positive,
        // we use a clamped linear mapping for the simulation, or a simple multiplier.
        // If x > 0: multiplier = 1e18 + xScaled
        // If x < 0: multiplier = 1e18 / (1 - xScaled) or max(0, 1e18 + xScaled)
        
        uint256 multiplier = 1e18;
        if (xScaled >= 0) {
            multiplier = 1e18 + uint256(xScaled);
        } else {
            uint256 absX = uint256(-xScaled);
            if (absX >= 1e18) {
                multiplier = 1e16; // floor to 1% of base price
            } else {
                multiplier = 1e18 - absX;
            }
        }
        
        return (P0 * multiplier) / 1e18;
    }
}
