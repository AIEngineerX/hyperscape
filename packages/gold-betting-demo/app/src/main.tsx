import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";

import { getRpcUrl, getWsUrl } from "./lib/config";
import {
  createHeadlessWalletFromEnv,
  isHeadlessWalletEnabled,
  shouldAutoConnectHeadlessWallet,
} from "./lib/headlessWallet";
import { ChainProvider } from "./lib/ChainContext";
import { wagmiConfig } from "./lib/wagmiConfig";
import { App } from "./App";

import "@solana/wallet-adapter-react-ui/styles.css";
import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

const queryClient = new QueryClient();

function Root() {
  const endpoint = getRpcUrl();
  const wsEndpoint = getWsUrl();
  const wallets = useMemo(() => {
    const walletList = [];
    const headless = createHeadlessWalletFromEnv();
    if (headless) {
      walletList.push(headless);
    }
    walletList.push(new PhantomWalletAdapter());
    return walletList;
  }, []);

  if (
    isHeadlessWalletEnabled() &&
    shouldAutoConnectHeadlessWallet() &&
    wallets.length > 0
  ) {
    localStorage.setItem("walletName", JSON.stringify(wallets[0]!.name));
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#eab308", borderRadius: "large" })}
        >
          <ChainProvider>
            <ConnectionProvider
              endpoint={endpoint}
              config={{
                wsEndpoint,
                commitment: "confirmed",
                disableRetryOnRateLimit: true,
              }}
            >
              <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                  <App />
                </WalletModalProvider>
              </WalletProvider>
            </ConnectionProvider>
          </ChainProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
