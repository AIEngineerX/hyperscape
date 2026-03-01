// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

contract AgentPerpEngineTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(1);
    address alice = address(2);
    address bob = address(3);
    address whale = address(4);

    bytes32 agentId = keccak256("MODEL_A");

    function setUp() public {
        vm.startPrank(admin);
        
        uint256 P0 = 100 * 1e18; // Base index price is $100
        oracle = new SkillOracle(P0);

        marginToken = new MockERC20("USDC", "USDC");
        
        uint256 skewScale = 1_000_000 * 1e18; // 1M tokens skew scale
        engine = new AgentPerpEngine(oracle, IERC20(address(marginToken)), skewScale);

        // Mint margin tokens to traders
        marginToken.mint(alice, 100_000 * 1e18);
        marginToken.mint(bob, 100_000 * 1e18);
        marginToken.mint(whale, 10_000_000 * 1e18);

        vm.stopPrank();

        vm.prank(alice);
        marginToken.approve(address(engine), type(uint256).max);
        vm.prank(bob);
        marginToken.approve(address(engine), type(uint256).max);
        vm.prank(whale);
        marginToken.approve(address(engine), type(uint256).max);

        // Initialize Oracle for MODEL_A
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1500, 200); // mu: 1500, sigma: 200 => cons: 1500 - 3*200 = 900
    }

    function testOracleConvergenceAndPrice() public {
        uint256 initialPrice = oracle.getIndexPrice(agentId);
        
        // Simulating the agent winning 10 matches -> lower sigma, higher mu
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1600, 50); // cons: 1600 - 150 = 1450 (higher than 900)

        uint256 newPrice = oracle.getIndexPrice(agentId);
        assertTrue(newPrice > initialPrice, "Price should increase as skill uncertainty drops and mu grows");
    }

    function testAdversarialSkew() public {
        // Initial price check
        uint256 baseExecPrice = engine.getExecutionPrice(agentId, 0);

        // Whale attempts to take a massive long position predicting a scale up
        int256 sizeDelta = 500_000 * 1e18; 
        int256 margin = 500_000 * 1e18;

        vm.startPrank(whale);
        
        // This execution price has slippage pre-applied to it
        uint256 whaleExecPrice = engine.getExecutionPrice(agentId, sizeDelta);
        assertTrue(whaleExecPrice > baseExecPrice, "Massive size should incur high slippage");

        // Open position
        engine.modifyPosition(agentId, margin, sizeDelta);
        vm.stopPrank();

        // Now Alice tries to go long as well, she sees an even worse price due to skew
        uint256 aliceExecPrice = engine.getExecutionPrice(agentId, 1e18);
        assertTrue(aliceExecPrice > whaleExecPrice, "Subsequent longs face severe skew premium");

        // Bob decides to go short (fade the crowd), he gets a massive discount!
        uint256 bobExecPrice = engine.getExecutionPrice(agentId, -1e18);
        assertTrue(bobExecPrice > baseExecPrice, "Shorts sell at a premium in a heavily long-skewed market");
    }
}
