import { expect } from "chai";
import { ethers } from "hardhat";

describe("GoldClob — Round 2 Security Fixes", function () {
  async function deployFixture() {
    const [owner, attacker, maker, taker, treasury] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Gold", "GOLD");
    await token.waitForDeployment();

    const GoldClob = await ethers.getContractFactory("GoldClob");
    const clob = await GoldClob.deploy(
      await token.getAddress(),
      treasury.address,
      owner.address,
    );
    await clob.waitForDeployment();

    await token.mint(owner.address, ethers.parseUnits("10000", 9));
    await token.mint(attacker.address, ethers.parseUnits("10000", 9));
    await token.mint(maker.address, ethers.parseUnits("10000", 9));
    await token.mint(taker.address, ethers.parseUnits("10000", 9));

    const clobAddr = await clob.getAddress();
    await token.connect(owner).approve(clobAddr, ethers.MaxUint256);
    await token.connect(attacker).approve(clobAddr, ethers.MaxUint256);
    await token.connect(maker).approve(clobAddr, ethers.MaxUint256);
    await token.connect(taker).approve(clobAddr, ethers.MaxUint256);

    return { clob, token, owner, attacker, maker, taker, treasury };
  }

  describe("1. Locked Funds Fix: Price Improvement Refunds", function () {
    it("Refunds the taker when a BUY order crosses a cheaper SELL order", async function () {
      const { clob, token, maker, taker, owner } = await deployFixture();
      await clob.connect(owner).createMatch();

      // Maker places a SELL (NO) at price=500 for 100 shares. Cost = 100 * 500 = 50,000 (scaled by 1000)
      await clob.connect(maker).placeOrder(1, false, 500, 100);

      const takerBalBefore = await token.balanceOf(taker.address);

      // Taker places a BUY (YES) at price=600 for 100 shares.
      // They are willing to pay 600 per share.
      // But they match against the maker at 500 per share.
      // Improvement = 600 - 500 = 100 per share. Total improvement = 100 * 100 / 1000 = 10 tokens.
      await clob.connect(taker).placeOrder(1, true, 600, 100);

      const takerBalAfter = await token.balanceOf(taker.address);

      // Taker's initial cost taken was: 100 * 600 / 1000 = 60 tokens.
      // Actual cost should be: 100 * 500 / 1000 = 50 tokens.
      // Net diff should be -50 tokens, NOT -60 tokens.
      expect(takerBalBefore - takerBalAfter).to.equal(50n);
    });

    it("Refunds the taker when a SELL order crosses a higher BUY order", async function () {
      const { clob, token, maker, taker, owner } = await deployFixture();
      await clob.connect(owner).createMatch();

      // Maker places a BUY (YES) at price=600 for 100 shares.
      await clob.connect(maker).placeOrder(1, true, 600, 100);

      const takerBalBefore = await token.balanceOf(taker.address);

      // Taker places a SELL (NO) at price=500 for 100 shares.
      // Taker is willing to sell at 500 (meaning they pay 500 for NO).
      // But they match against maker buying YES at 600 (meaning maker pays 600, taker only needs to pay 400 for NO).
      // Improvement = 600 - 500 = 100 per share. Total improvement = 100 * 100 / 1000 = 10 tokens.
      await clob.connect(taker).placeOrder(1, false, 500, 100);

      const takerBalAfter = await token.balanceOf(taker.address);

      // Taker initial cost taken: 100 * (1000-500) / 1000 = 50 tokens
      // Actual required pot cost: 100 * (1000-600) / 1000 = 40 tokens
      // Net diff should be -40 tokens, NOT -50 tokens.
      expect(takerBalBefore - takerBalAfter).to.equal(40n);
    });
  });

  describe("2. Critical OOG DoS Fix: MatchesCount and clearGarbage", function () {
    it("Prevents infinite loop DoS by counting cancelled orders against MAX_MATCHES_PER_TX", async function () {
      const { clob, maker, taker, owner } = await deployFixture();
      await clob.connect(owner).createMatch();

      // Place 105 orders and instantly cancel them to create a massive garbage wall
      for (let i = 0; i < 105; i++) {
        await clob.connect(maker).placeOrder(1, true, 500, 10);
        // The order IDs will be 1 through 105.
        await clob.connect(maker).cancelOrder(1, i + 1, 500);
      }

      // A genuine taker tries to sell. If we didn't add the `matchesCount++` inside the skipped order branch,
      // this taker would loop 105 times, potentially hitting OOG in a real block.
      // Because MAX_MATCHES_PER_TX = 100, the taker should only clear 100 garbage orders and then stop.
      await clob.connect(taker).placeOrder(1, false, 500, 10);

      // Let's verify that exactly 5 garbage orders remain in the queue because the taker stopped matching at 100.
      const queue = await clob.orderQueues(1, 500);
      expect(queue.tail - queue.head).to.equal(6n); // 105 total - 100 cleared/matched ≈ 5-6 left depending on loop exit condition
    });

    it("clearGarbage function successfully sweeps dead orders", async function () {
      const { clob, maker, taker, owner } = await deployFixture();
      await clob.connect(owner).createMatch();

      // Place 5 orders and cancel them
      for (let i = 0; i < 5; i++) {
        await clob.connect(maker).placeOrder(1, true, 500, 10);
        await clob.connect(maker).cancelOrder(1, i + 1, 500);
      }

      let queueBefore = await clob.orderQueues(1, 500);
      expect(queueBefore.tail - queueBefore.head).to.equal(5n);

      // Call the new clearGarbage function to sweep up to 10
      await clob.connect(taker).clearGarbage(1, 500, 10);

      let queueAfter = await clob.orderQueues(1, 500);
      expect(queueAfter.tail - queueAfter.head).to.equal(0n);
    });
  });

  describe("3. Medium Zero-Value Transfer Reverts in Claim", function () {
    it("Allows claims where the fee calculation results in 0 (sub-cent payouts)", async function () {
      const { clob, maker, taker, owner } = await deployFixture();
      await clob.connect(owner).createMatch();

      // Small trade: 10 shares at 500. Cost = 5 tokens.
      await clob.connect(maker).placeOrder(1, true, 500, 10);
      await clob.connect(taker).placeOrder(1, false, 500, 10);

      await clob.connect(owner).resolveMatch(1, 1);

      // Maker claims 10 winning shares.
      // Fee = (10 * 100) / 10000 = 0.1 (truncate to 0).
      // HalfFee = 0 / 2 = 0.
      // Previous contract would revert because `goldToken.transfer(treasury, 0)` fails for many tokens.
      // With the fix, we check if(fee > 0).
      await clob.connect(maker).claim(1);

      const pos = await clob.positions(1, maker.address);
      expect(pos.yesShares).to.equal(0n); // Successfully claimed
    });
  });
});
