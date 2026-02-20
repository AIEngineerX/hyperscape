// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GoldClob is ReentrancyGuard {
    IERC20 public immutable goldToken;
    address public immutable treasury;
    address public immutable marketMaker;
    address public immutable admin;
    uint256 public constant feeBps = 200; // 2% total (1% Treasury, 1% Market Maker)

    uint256 public nextMatchId = 1;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    enum MatchStatus { NULL, OPEN, RESOLVED }
    enum Side { NONE, YES, NO }

    struct MatchMeta {
        MatchStatus status;
        Side winner;
        uint256 yesPool;
        uint256 noPool;
    }

    struct Order {
        uint64 id;
        uint16 price; // 1 to 999. price of YES.
        bool isBuy; // buy = YES, sell = NO
        address maker;
        uint128 amount; // amount of shares
        uint128 filled;
        uint256 matchId; // which match this order belongs to
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
    }
    
    struct Queue {
        uint64 head;
        uint64 tail;
        mapping(uint64 => uint64) elements;
    }

    mapping(uint256 => MatchMeta) public matches;
    uint64 public nextOrderId = 1;
    mapping(uint64 => Order) public orders;
    
    // matchId => true if open
    mapping(uint256 => mapping(address => Position)) public positions;

    // matchId => price => queue of order IDs
    mapping(uint256 => mapping(uint16 => Queue)) public orderQueues;
    
    // matchId => best price boundary
    mapping(uint256 => uint16) public bestBids;
    mapping(uint256 => uint16) public bestAsks;

    event OrderPlaced(uint256 indexed matchId, uint64 indexed orderId, address indexed maker, bool isBuy, uint16 price, uint256 amount);
    event OrderMatched(uint256 indexed matchId, uint64 makerOrderId, uint64 takerOrderId, uint256 matchedAmount, uint16 price);
    event OrderCancelled(uint256 indexed matchId, uint64 indexed orderId);
    event MatchCreated(uint256 indexed matchId);
    event MatchResolved(uint256 indexed matchId, Side winner);

    constructor(address _goldToken, address _treasury, address _marketMaker) {
        require(_treasury != address(0), "Invalid treasury zero address");
        require(_marketMaker != address(0), "Invalid market maker zero address");
        goldToken = IERC20(_goldToken);
        treasury = _treasury;
        marketMaker = _marketMaker;
        admin = msg.sender;
    }

    function createMatch() external onlyAdmin returns (uint256) {
        uint256 matchId = nextMatchId++;
        matches[matchId] = MatchMeta({
            status: MatchStatus.OPEN,
            winner: Side.NONE,
            yesPool: 0,
            noPool: 0
        });
        bestBids[matchId] = 0; // Highest bid
        bestAsks[matchId] = 1000; // Lowest ask
        emit MatchCreated(matchId);
        return matchId;
    }

    function placeOrder(uint256 matchId, bool isBuy, uint16 price, uint256 amount) external nonReentrant {
        require(matches[matchId].status == MatchStatus.OPEN, "Match not open");
        require(price > 0 && price < 1000, "Invalid price");
        require(amount > 0, "Invalid amount");
        require(amount <= type(uint128).max, "Amount overflow");

        uint256 cost = (amount * (isBuy ? price : (1000 - price))) / 1000;
        require(cost > 0, "Cost too low");
        require(goldToken.transferFrom(msg.sender, address(this), cost), "Transfer failed");

        uint256 remainingAmount = amount;
        uint256 matchesCount = 0;
        uint256 MAX_MATCHES_PER_TX = 100;

        // Matching engine logic
        if (isBuy) {
            uint16 currentAsk = bestAsks[matchId];
            while (remainingAmount > 0 && currentAsk <= price && currentAsk < 1000 && matchesCount < MAX_MATCHES_PER_TX) {
                Queue storage queue = orderQueues[matchId][currentAsk];
                if (queue.head == queue.tail) {
                    currentAsk++;
                    continue;
                }

                uint64 orderId = queue.elements[queue.head];
                Order storage makerOrder = orders[orderId];
                if (makerOrder.filled >= makerOrder.amount) {
                    _popQueue(matchId, currentAsk);
                    matchesCount++; // OOG DoS Fix: Count cancelled orders against the loop limit
                    continue;
                }

                uint256 fillAmount = remainingAmount;
                uint256 makerRemaining = makerOrder.amount - makerOrder.filled;
                if (fillAmount > makerRemaining) {
                    fillAmount = makerRemaining;
                }

                makerOrder.filled += uint128(fillAmount);
                remainingAmount -= fillAmount;
                
                positions[matchId][makerOrder.maker].noShares += fillAmount;
                positions[matchId][msg.sender].yesShares += fillAmount;

                // Locked Funds Fix: Taker pays `price` (worse), maker asked `currentAsk` (better).
                // Refund the difference in cost per share.
                if (price > currentAsk) {
                    uint256 improvement = (fillAmount * (price - currentAsk)) / 1000;
                    if (improvement > 0) {
                        require(goldToken.transfer(msg.sender, improvement), "Refund failed");
                    }
                }

                emit OrderMatched(matchId, orderId, nextOrderId, fillAmount, currentAsk);

                if (makerOrder.filled == makerOrder.amount) {
                    _popQueue(matchId, currentAsk);
                }
                
                matchesCount++;
            }
            bestAsks[matchId] = currentAsk;
        } else {
            uint16 currentBid = bestBids[matchId];
            while (remainingAmount > 0 && currentBid >= price && currentBid > 0 && matchesCount < MAX_MATCHES_PER_TX) {
                Queue storage queue = orderQueues[matchId][currentBid];
                if (queue.head == queue.tail) {
                    currentBid--;
                    continue;
                }

                uint64 orderId = queue.elements[queue.head];
                Order storage makerOrder = orders[orderId];
                if (makerOrder.filled >= makerOrder.amount) {
                    _popQueue(matchId, currentBid);
                    matchesCount++; // OOG DoS Fix: Count cancelled orders against the loop limit
                    continue;
                }

                uint256 fillAmount = remainingAmount;
                uint256 makerRemaining = makerOrder.amount - makerOrder.filled;
                if (fillAmount > makerRemaining) {
                    fillAmount = makerRemaining;
                }

                makerOrder.filled += uint128(fillAmount);
                remainingAmount -= fillAmount;

                positions[matchId][makerOrder.maker].yesShares += fillAmount;
                positions[matchId][msg.sender].noShares += fillAmount;

                // Locked Funds Fix: Taker (seller) asked `price` (worse/lower), maker bid `currentBid` (better/higher).
                // Refund the difference in cost per share. Seller receives (1000-price), maker pays (bestBid).
                if (currentBid > price) {
                    uint256 improvement = (fillAmount * (currentBid - price)) / 1000;
                    if (improvement > 0) {
                        require(goldToken.transfer(msg.sender, improvement), "Refund failed");
                    }
                }

                emit OrderMatched(matchId, orderId, nextOrderId, fillAmount, currentBid);

                if (makerOrder.filled == makerOrder.amount) {
                    _popQueue(matchId, currentBid);
                }
                
                matchesCount++;
            }
            bestBids[matchId] = currentBid;
        }

        if (remainingAmount > 0) {
            uint64 newOrderId = nextOrderId++;
            orders[newOrderId] = Order({
                id: newOrderId,
                price: price,
                isBuy: isBuy,
                maker: msg.sender,
                amount: uint128(amount),
                filled: uint128(amount - remainingAmount),
                matchId: matchId
            });
            
            Queue storage queue = orderQueues[matchId][price];
            queue.elements[queue.tail] = newOrderId;
            queue.tail++;
            
            if (isBuy && price > bestBids[matchId]) {
                bestBids[matchId] = price;
            } else if (!isBuy && price < bestAsks[matchId]) {
                bestAsks[matchId] = price;
            }
            
            emit OrderPlaced(matchId, newOrderId, msg.sender, isBuy, price, remainingAmount);
        }
    }

    function _popQueue(uint256 matchId, uint16 price) internal {
        Queue storage queue = orderQueues[matchId][price];
        delete queue.elements[queue.head];
        queue.head++;
    }

    function cancelOrder(uint256 matchId, uint64 orderId, uint16 price) external nonReentrant {
        Order storage orderInfo = orders[orderId];
        require(orderInfo.maker == msg.sender, "Not maker");
        require(orderInfo.matchId == matchId, "Wrong match");
        require(orderInfo.filled < orderInfo.amount, "Already filled");
        
        uint256 remaining = orderInfo.amount - orderInfo.filled;
        orderInfo.filled = orderInfo.amount; // Mark as effectively cancelled/filled
        
        uint256 cost = (remaining * (orderInfo.isBuy ? orderInfo.price : (1000 - orderInfo.price))) / 1000;
        require(goldToken.transfer(msg.sender, cost), "Refund failed");

        emit OrderCancelled(matchId, orderId);
    }

    function resolveMatch(uint256 matchId, Side winner) external onlyAdmin {
        require(matches[matchId].status == MatchStatus.OPEN, "Not open");
        matches[matchId].status = MatchStatus.RESOLVED;
        matches[matchId].winner = winner;
        emit MatchResolved(matchId, winner);
    }

    function claim(uint256 matchId) external nonReentrant {
        require(matches[matchId].status == MatchStatus.RESOLVED, "Not resolved");
        Position storage pos = positions[matchId][msg.sender];
        Side winner = matches[matchId].winner;
        
        uint256 winningShares = 0;
        if (winner == Side.YES) {
            winningShares = pos.yesShares;
            pos.yesShares = 0;
        } else if (winner == Side.NO) {
            winningShares = pos.noShares;
            pos.noShares = 0;
        }

        require(winningShares > 0, "Nothing to claim");

        uint256 fee = (winningShares * feeBps) / 10000;
        uint256 payout = winningShares - fee;

        uint256 halfFee = fee / 2;
        
        // Zero-Value Transfer Revert Fix
        if (halfFee > 0) {
            require(goldToken.transfer(treasury, halfFee), "Treasury fee failed");
        }
        if (fee - halfFee > 0) {
            require(goldToken.transfer(marketMaker, fee - halfFee), "MM fee failed");
        }
        require(goldToken.transfer(msg.sender, payout), "Payout failed");
    }

    // OOG DoS Fix: Allow sweeping of dead/cancelled orders from the queue manually
    function clearGarbage(uint256 matchId, uint16 price, uint256 maxOrders) external nonReentrant {
        require(matches[matchId].status == MatchStatus.OPEN, "Match not open");
        Queue storage queue = orderQueues[matchId][price];
        uint256 cleared = 0;

        while (queue.head < queue.tail && cleared < maxOrders) {
            uint64 orderId = queue.elements[queue.head];
            Order storage makerOrder = orders[orderId];
            if (makerOrder.filled >= makerOrder.amount) {
                _popQueue(matchId, price);
                cleared++;
            } else {
                break; // Stop at the first valid, uncancelled order
            }
        }
    }
}
