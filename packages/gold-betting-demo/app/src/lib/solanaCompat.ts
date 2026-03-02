import { ed25519 } from "@noble/curves/ed25519";

// solana/web3.js v1 expects randomPrivateKey(), while newer @noble/curves
// exposes randomSecretKey(). Patch once at app bootstrap time.
const ed25519Utils = ed25519.utils as {
  randomPrivateKey?: () => Uint8Array;
  randomSecretKey?: () => Uint8Array;
};

if (!ed25519Utils.randomPrivateKey && ed25519Utils.randomSecretKey) {
  ed25519Utils.randomPrivateKey = () => ed25519Utils.randomSecretKey!();
}
