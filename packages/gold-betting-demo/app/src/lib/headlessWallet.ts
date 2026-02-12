import { ed25519 } from "@noble/curves/ed25519";
import {
  BaseSignInMessageSignerWalletAdapter,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  isVersionedTransaction,
} from "@solana/wallet-adapter-base";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { createSignInMessage } from "@solana/wallet-standard-util";
import type {
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";

const DEFAULT_HEADLESS_WALLET_NAME = "Headless Test Wallet";
const HEADLESS_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%230d58a6'/%3E%3Cpath d='M10 20h20M10 14h20M10 26h20' stroke='white' stroke-width='2'/%3E%3C/svg%3E";

function parseSecretKey(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error("Headless wallet secret key is empty");
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }

  if (trimmed.includes(",")) {
    return Uint8Array.from(
      trimmed
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
    );
  }

  throw new Error(
    "Unsupported VITE_HEADLESS_WALLET_SECRET_KEY format (expected JSON array or comma-separated bytes)",
  );
}

export class HeadlessKeypairWalletAdapter extends BaseSignInMessageSignerWalletAdapter {
  name: WalletName<string>;
  url = "https://solana.com";
  icon = HEADLESS_ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set([
    "legacy",
    0,
  ]);

  private readonly fixedKeypair: Keypair;
  private activeKeypair: Keypair | null = null;

  constructor(secretKey: Uint8Array, name = DEFAULT_HEADLESS_WALLET_NAME) {
    super();
    this.fixedKeypair = Keypair.fromSecretKey(secretKey);
    this.name = name as WalletName<string>;
  }

  get connecting(): boolean {
    return false;
  }

  get publicKey() {
    return this.activeKeypair?.publicKey ?? null;
  }

  get readyState() {
    return WalletReadyState.Loadable;
  }

  async connect(): Promise<void> {
    this.activeKeypair = Keypair.fromSecretKey(this.fixedKeypair.secretKey);
    this.emit("connect", this.activeKeypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.activeKeypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (!this.activeKeypair) throw new WalletNotConnectedError();

    if (isVersionedTransaction(transaction)) {
      transaction.sign([this.activeKeypair]);
    } else {
      transaction.partialSign(this.activeKeypair);
    }

    return transaction;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.activeKeypair) throw new WalletNotConnectedError();
    return ed25519.sign(message, this.activeKeypair.secretKey.slice(0, 32));
  }

  async signIn(input: SolanaSignInInput = {}): Promise<SolanaSignInOutput> {
    const keypair = (this.activeKeypair ||= Keypair.fromSecretKey(
      this.fixedKeypair.secretKey,
    ));

    const domain = input.domain || window.location.host;
    const address = input.address || keypair.publicKey.toBase58();
    const signedMessage = createSignInMessage({
      ...input,
      domain,
      address,
    });
    const signature = ed25519.sign(
      signedMessage,
      keypair.secretKey.slice(0, 32),
    );

    this.emit("connect", keypair.publicKey);

    return {
      account: {
        address,
        publicKey: keypair.publicKey.toBytes(),
        chains: [],
        features: [],
      },
      signedMessage,
      signature,
    };
  }
}

export function getHeadlessWalletName(): string {
  return (
    import.meta.env.VITE_HEADLESS_WALLET_NAME || DEFAULT_HEADLESS_WALLET_NAME
  );
}

export function isHeadlessWalletEnabled(): boolean {
  return Boolean(import.meta.env.VITE_HEADLESS_WALLET_SECRET_KEY);
}

export function shouldAutoConnectHeadlessWallet(): boolean {
  return import.meta.env.VITE_HEADLESS_WALLET_AUTO_CONNECT === "true";
}

export function createHeadlessWalletFromEnv(): HeadlessKeypairWalletAdapter | null {
  const value = import.meta.env.VITE_HEADLESS_WALLET_SECRET_KEY;
  if (!value) return null;
  const secret = parseSecretKey(value);
  return new HeadlessKeypairWalletAdapter(secret, getHeadlessWalletName());
}
