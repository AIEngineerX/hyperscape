/**
 * Wagmi configuration for EVM wallet support.
 * Chains are configured based on env variables.
 */

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { getWagmiChains, getEnabledEvmChains } from "./chainConfig";
import { CONFIG, BSC_RPC_URL, BASE_RPC_URL } from "./config";

const chains = getWagmiChains();
const enabledEvmChains = getEnabledEvmChains();

// Build transport map from enabled chains
const transports: Record<number, ReturnType<typeof http>> = {};
for (const evmChain of enabledEvmChains) {
  transports[evmChain.evmChainId] = http(evmChain.rpcUrl);
}
// Fallback for any chain that didn't get explicitly mapped
for (const chain of chains) {
  if (!transports[chain.id]) {
    // Use BSC or Base RPC as fallback
    transports[chain.id] = http(BSC_RPC_URL || BASE_RPC_URL || undefined);
  }
}

const walletConnectProjectId = CONFIG.walletConnectProjectId.trim();
const hasWalletConnectProjectId =
  walletConnectProjectId.length > 0 &&
  walletConnectProjectId.toLowerCase() !== "demo";

export const wagmiConfig = hasWalletConnectProjectId
  ? getDefaultConfig({
      appName: "GoldArena",
      projectId: walletConnectProjectId,
      chains,
      transports,
    })
  : createConfig({
      chains,
      transports,
      connectors: [injected()],
    });
