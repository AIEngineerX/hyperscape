/**
 * Wagmi configuration for EVM wallet support.
 * Chains are configured based on env variables.
 */

import { createConfig, http } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { getWagmiChains, getEnabledEvmChains } from "./chainConfig";
import { BSC_RPC_URL, BASE_RPC_URL } from "./config";

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

export const wagmiConfig = getDefaultConfig({
  appName: "GoldArena",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo",
  chains,
  transports,
});
