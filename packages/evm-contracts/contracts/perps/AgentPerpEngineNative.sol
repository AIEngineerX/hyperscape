// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SkillOracle.sol";

/**
 * @title AgentPerpEngineNative
 * @notice Perpetual futures engine using NATIVE chain currency (ETH on Base, BNB on BSC)
 *         as the margin/collateral token instead of an ERC-20.
 *
 *         Margin is held as ETH/BNB in this contract. All P&L and settlements are sent
 *         as native value via `call{value: ...}`. This makes it chain-agnostic for any
 *         EVM network that uses its native coin as the primary medium of exchange.
 *
 * @dev Decimal convention: all sizes/margins use 18 decimals (1 ETH = 1e18 wei / 1 BNB = 1e18 wei).
 *      Index prices from the oracle are also expected to be 18-decimal fixed-point.
 */
contract AgentPerpEngineNative is Ownable {
    SkillOracle public oracle;

    struct MarketState {
        uint256 totalLongOI;    // sum of all long position sizes (18 dec)
        uint256 totalShortOI;   // sum of all short position sizes
        int256 currentFundingRate; // rate per second (scaled by 1e18)
        uint256 lastUpdateTimestamp;
    }

    struct Position {
        int256 size;        // positive = Long, negative = Short (18 dec)
        uint256 margin;     // native wei held for this position
        uint256 entryPrice; // skew-adjusted entry price (18 dec)
        int256 lastFundingRate;
    }

    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    uint256 public skewScale;        // e.g. 1e6 * 1e18 = 1e24
    uint256 public fundingVelocity;  // per-second drift scale

    uint256 public constant ONE = 1e18;
    uint256 public maxLeverage = 5 * ONE; // 5x

    // Insurance fund (native) – seized from liquidated positions
    uint256 public insuranceFund;

    event PositionOpened(bytes32 indexed agentId, address indexed trader, int256 sizeDelta, uint256 execPrice, int256 newSize, uint256 margin);
    event PositionClosed(bytes32 indexed agentId, address indexed trader, int256 size, uint256 execPrice, int256 pnl);
    event PositionLiquidated(bytes32 indexed agentId, address indexed trader, int256 size, uint256 liquidationPrice);

    constructor(SkillOracle _oracle, uint256 _skewScale) Ownable(msg.sender) {
        oracle = _oracle;
        skewScale = _skewScale;
        fundingVelocity = 1e12; // Modest drift per second
    }

    receive() external payable {}

    // ─────────────────────────────────────────── Internal helpers ──

    function _updateFunding(bytes32 agentId) internal {
        MarketState storage market = markets[agentId];
        uint256 timeDelta = block.timestamp - market.lastUpdateTimestamp;
        if (timeDelta == 0) return;

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        market.currentFundingRate +=
            (skew * int256(fundingVelocity) * int256(timeDelta)) / int256(skewScale);
        market.lastUpdateTimestamp = block.timestamp;
    }

    function _getExecutionPrice(bytes32 agentId, int256 sizeDelta)
        internal
        view
        returns (uint256)
    {
        uint256 indexPrice = oracle.getIndexPrice(agentId);
        MarketState memory market = markets[agentId];

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        // premium = (skew + sizeDelta/2) / skewScale, scaled by ONE
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(skewScale);

        uint256 execPrice;
        if (premium >= 0) {
            execPrice = indexPrice + (indexPrice * uint256(premium)) / ONE;
        } else {
            uint256 absPremium = uint256(-premium);
            if (absPremium >= ONE) {
                execPrice = indexPrice / 10; // Floor at 10%
            } else {
                execPrice = indexPrice - (indexPrice * absPremium) / ONE;
            }
        }
        return execPrice;
    }

    // ─────────────────────────────────────────── Public interface ──

    /**
     * @notice Open or modify a position using native ETH/BNB as margin.
     * @param agentId  keccak256 agent identifier (matches SkillOracle key)
     * @param sizeDelta Positive = more long, Negative = more short (18-dec)
     *
     * Callers MUST send ETH/BNB with this call if they want to deposit margin.
     * If sizeDelta reduces/closes a position, the released margin is refunded.
     */
    function modifyPosition(bytes32 agentId, int256 sizeDelta) external payable {
        _updateFunding(agentId);

        uint256 marginDeposited = msg.value; // native coin deposited this call

        uint256 execPrice = _getExecutionPrice(agentId, sizeDelta);
        Position storage pos = positions[agentId][msg.sender];
        MarketState storage market = markets[agentId];

        // ─── Reduce OI for existing position ───
        if (pos.size > 0) {
            market.totalLongOI -= uint256(pos.size);
        } else if (pos.size < 0) {
            market.totalShortOI -= uint256(-pos.size);
        }

        // ─── Realize PnL if modifying or closing ───
        if (pos.size != 0 && sizeDelta != 0) {
            int256 pnl;
            if (pos.size > 0) {
                pnl = (int256(execPrice) - int256(pos.entryPrice)) * pos.size / int256(ONE);
            } else {
                pnl = (int256(pos.entryPrice) - int256(execPrice)) * (-pos.size) / int256(ONE);
            }
            if (pnl > 0) {
                pos.margin += uint256(pnl);
            } else {
                uint256 loss = uint256(-pnl);
                require(pos.margin >= loss, "Underwater: margin < loss");
                pos.margin -= loss;
            }
        }

        // ─── Apply size change ───
        pos.size += sizeDelta;
        pos.entryPrice = execPrice;
        pos.margin += marginDeposited;

        // ─── Update OI ───
        if (pos.size > 0) {
            market.totalLongOI += uint256(pos.size);
        } else if (pos.size < 0) {
            market.totalShortOI += uint256(-pos.size);
        }

        // ─── Leverage check ───
        if (pos.size != 0) {
            uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
            uint256 notional = (absSize * execPrice) / ONE;
            require((notional * ONE) / pos.margin <= maxLeverage, "Max leverage exceeded");
        }

        // ─── Full close: refund remaining margin ───
        if (pos.size == 0 && pos.margin > 0) {
            uint256 payout = pos.margin;
            pos.margin = 0;
            (bool ok, ) = payable(msg.sender).call{value: payout}("");
            require(ok, "Refund transfer failed");
            emit PositionClosed(agentId, msg.sender, 0, execPrice, int256(payout));
        } else {
            emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
        }
    }

    /**
     * @notice Withdraw margin from an open position (partial deleverage / margin withdrawal).
     */
    function withdrawMargin(bytes32 agentId, uint256 amount) external {
        Position storage pos = positions[agentId][msg.sender];
        require(pos.margin >= amount, "Insufficient margin");
        pos.margin -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdrawal failed");
    }

    /**
     * @notice Liquidate an undercollateralized position.
     *         Liquidators receive a 1% incentive from the seized margin.
     */
    function liquidate(bytes32 agentId, address trader) external {
        _updateFunding(agentId);

        Position storage pos = positions[agentId][trader];
        require(pos.size != 0, "No position");

        MarketState storage market = markets[agentId];

        uint256 execPrice = _getExecutionPrice(agentId, pos.size > 0 ? -pos.size : pos.size);

        int256 pnl;
        if (pos.size > 0) {
            pnl = (int256(execPrice) - int256(pos.entryPrice)) * pos.size / int256(ONE);
        } else {
            pnl = (int256(pos.entryPrice) - int256(execPrice)) * (-pos.size) / int256(ONE);
        }

        int256 equity = int256(pos.margin) + pnl;
        int256 maintenanceMargin = int256(pos.margin) / 10; // 10% of initial margin

        require(equity < maintenanceMargin, "Not liquidatable");

        // Remove OI
        if (pos.size > 0) {
            market.totalLongOI -= uint256(pos.size);
        } else {
            market.totalShortOI -= uint256(-pos.size);
        }

        uint256 seizedMargin = pos.margin;
        pos.size = 0;
        pos.margin = 0;

        // 1% to liquidator, rest to insurance fund
        uint256 liquidatorBonus = seizedMargin / 100;
        insuranceFund += seizedMargin - liquidatorBonus;

        (bool ok, ) = payable(msg.sender).call{value: liquidatorBonus}("");
        require(ok, "Liquidator pay failed");

        emit PositionLiquidated(agentId, trader, 0, execPrice);
    }

    /**
     * @notice Admin: withdraw from insurance fund to treasury.
     */
    function withdrawInsuranceFund(address payable to, uint256 amount) external onlyOwner {
        require(insuranceFund >= amount, "Insufficient insurance fund");
        insuranceFund -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "IF withdrawal failed");
    }

    function setSkewScale(uint256 _skewScale) external onlyOwner {
        skewScale = _skewScale;
    }

    function setFundingVelocity(uint256 _fundingVelocity) external onlyOwner {
        fundingVelocity = _fundingVelocity;
    }

    function setMaxLeverage(uint256 _maxLeverage) external onlyOwner {
        maxLeverage = _maxLeverage;
    }
}
