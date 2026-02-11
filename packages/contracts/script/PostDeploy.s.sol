// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { Script } from "forge-std/Script.sol";

/**
 * @title PostDeploy
 * @notice MUD post-deployment hook. Intentionally minimal.
 *
 * Item definitions and shop inventories are seeded via TypeScript scripts
 * (seed-items.ts, seed-shops.ts) that read the game's JSON manifests.
 * Solidity cannot read JSON, so seeding must happen off-chain.
 *
 * This file exists because MUD CLI expects script/PostDeploy.s.sol.
 */
contract PostDeploy is Script {
    function run(address) external {}
}
