import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";

import { getRpcUrl, getWsUrl } from "./lib/config";
import {
  createHeadlessWalletFromEnv,
  isHeadlessWalletEnabled,
  shouldAutoConnectHeadlessWallet,
} from "./lib/headlessWallet";
import { App } from "./App";

import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

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
    <ConnectionProvider endpoint={endpoint} config={{ wsEndpoint }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
