// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SkillOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AgentPerpEngine
 * @notice A perpetual futures engine driven by Agent TrueSkill instead of public spot markets.
 *         Implements oracle-execution with skew-based price impact and funding.
 */
contract AgentPerpEngine is Ownable {
    using SafeERC20 for IERC20;

    SkillOracle public oracle;
    IERC20 public marginToken; // e.g. USDC or Gold

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate; // rate per second (scaled by 1e18)
        uint256 lastUpdateTimestamp;
    }

    struct Position {
        int256 size;    // + for Long, - for Short
        uint256 margin;
        uint256 entryPrice;
        int256 lastFundingRate;
    }

    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    // Parameters mapped to Skew limits
    uint256 public skewScale;        // Controls how fast price impact grows (e.g. 1e6)
    uint256 public fundingVelocity;  // How fast the funding rate changes based on skew

    uint256 public constant ONE = 1e18;
    uint256 public maxLeverage = 5 * ONE; // 5x leverage max for safety

    event PositionOpened(bytes32 indexed agentId, address indexed trader, int256 sizeDelta, uint256 executionPrice, int256 newSize, uint256 margin);
    event PositionLiquidated(bytes32 indexed agentId, address indexed trader, int256 size, uint256 liquidationPrice);
    
    constructor(SkillOracle _oracle, IERC20 _marginToken, uint256 _skewScale) Ownable(msg.sender) {
        oracle = _oracle;
        marginToken = _marginToken;
        skewScale = _skewScale;
        fundingVelocity = 1e12; // Modest drift
    }

    function _updateFunding(bytes32 agentId) internal {
        MarketState storage market = markets[agentId];
        uint256 timeDelta = block.timestamp - market.lastUpdateTimestamp;
        if (timeDelta == 0) return;

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        // Funding velocity pushes the premium based on prolonged skew
        market.currentFundingRate += (skew * int256(fundingVelocity) * int256(timeDelta)) / int256(skewScale);
        market.lastUpdateTimestamp = block.timestamp;
    }

    function getExecutionPrice(bytes32 agentId, int256 sizeDelta) public view returns (uint256) {
        uint256 indexPrice = oracle.getIndexPrice(agentId);
        MarketState memory market = markets[agentId];
        
        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        
        // Simulating price impact: execution price = indexPrice * (1 + (skew + sizeDelta/2) / skewScale)
        // Note: sizeDelta is added to simulate the impact of the caller's trade pushing the skew.
        int256 premium = ((skew + sizeDelta/2) * int256(ONE)) / int256(skewScale);
        uint256 execPrice;
        
        if (premium >= 0) {
            execPrice = indexPrice + (indexPrice * uint256(premium)) / ONE;
        } else {
            uint256 absPremium = uint256(-premium);
            if (absPremium >= ONE) {
                execPrice = indexPrice / 10; // Floor execution price drop
            } else {
                execPrice = indexPrice - (indexPrice * absPremium) / ONE;
            }
        }
        return execPrice;
    }

    /**
     * @notice Open or modify a position
     * @param agentId The underlying asset (Agent ID)
     * @param marginDelta >0 deposits margin, <0 withdraws
     * @param sizeDelta + for Long, - for Short
     */
    function modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta) external {
        _updateFunding(agentId);

        if (marginDelta > 0) {
            marginToken.safeTransferFrom(msg.sender, address(this), uint256(marginDelta));
        }

        uint256 execPrice = getExecutionPrice(agentId, sizeDelta);
        Position storage pos = positions[agentId][msg.sender];
        MarketState storage market = markets[agentId];

        // Realize funding (skipped complex per-position accumulator for simulation simplicity)
        
        if (sizeDelta != 0) {
            if (pos.size > 0) {
                market.totalLongOI -= uint256(pos.size);
            } else if (pos.size < 0) {
                market.totalShortOI -= uint256(-pos.size);
            }

            // Realize un-realized PnL if closing
            if (pos.size != 0) {
                int256 pnl = 0;
                if (pos.size > 0) {
                    pnl = (int256(execPrice) - int256(pos.entryPrice)) * pos.size / int256(ONE);
                } else {
                    pnl = (int256(pos.entryPrice) - int256(execPrice)) * (-pos.size) / int256(ONE);
                }
                // Add PNL to margin
                if (pnl > 0) {
                    pos.margin += uint256(pnl);
                } else {
                    uint256 loss = uint256(-pnl);
                    require(pos.margin >= loss, "Liquidatable due to PNL");
                    pos.margin -= loss;
                }
            }

            pos.size += sizeDelta;
            pos.entryPrice = execPrice;

            if (pos.size > 0) {
                market.totalLongOI += uint256(pos.size);
            } else if (pos.size < 0) {
                market.totalShortOI += uint256(-pos.size);
            }
        }

        if (marginDelta < 0) {
            uint256 withdrawAmount = uint256(-marginDelta);
            require(pos.margin >= withdrawAmount, "Insufficient margin");
            pos.margin -= withdrawAmount;
            marginToken.safeTransfer(msg.sender, withdrawAmount);
        } else if (marginDelta > 0) {
            pos.margin += uint256(marginDelta);
        }
        
        // Leverage check
        if (pos.size != 0) {
            uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
            uint256 notionalValue = (absSize * execPrice) / ONE;
            require((notionalValue * ONE) / pos.margin <= maxLeverage, "Max leverage exceeded");
        }

        emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
    }
}
