import { expect } from "chai";
import { ethers } from "hardhat";

describe("GoldClob", function () {
  async function deployFixture() {
    const [owner, maker, taker, treasury] = await ethers.getSigners();

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

    await token.mint(maker.address, ethers.parseUnits("1000", 9));
    await token.mint(taker.address, ethers.parseUnits("1000", 9));

    await token
      .connect(maker)
      .approve(await clob.getAddress(), ethers.MaxUint256);
    await token
      .connect(taker)
      .approve(await clob.getAddress(), ethers.MaxUint256);

    return { clob, token, owner, maker, taker, treasury };
  }

  it("Should create a match", async function () {
    const { clob } = await deployFixture();
    await clob.createMatch();
    const meta = await clob.matches(1);
    expect(meta.status).to.equal(1n); // OPEN
  });

  it("Should match orders", async function () {
    const { clob, maker, taker } = await deployFixture();
    await clob.createMatch();

    // Maker: Buy YES 10 shares @ 600 ($0.60)
    await clob.connect(maker).placeOrder(1, true, 600, 10);

    // Taker: Sell YES 10 shares @ 600 ($0.40 NO)
    await clob.connect(taker).placeOrder(1, false, 600, 10);

    const posMaker = await clob.positions(1, maker.address);
    const posTaker = await clob.positions(1, taker.address);

    expect(posMaker.yesShares).to.equal(10n);
    expect(posTaker.noShares).to.equal(10n);
  });
});
