import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { SolanaArenaConfig } from "./config.js";

interface RoundAddressBundle {
  roundSeedHex: string;
  roundSeed: Buffer;
  mint: PublicKey;
  tokenProgram: PublicKey;
  configPda: PublicKey;
  marketPda: PublicKey;
  oraclePda: PublicKey;
  vaultAta: PublicKey;
  feeVaultAta: PublicKey;
}

interface InitRoundResult {
  addresses: RoundAddressBundle;
  closeSlot: number;
  initOracleSignature: string | null;
  initMarketSignature: string | null;
}

interface ReportResolveResult {
  reportSignature: string | null;
  resolveSignature: string | null;
}

const SIDE_TO_U8: Record<"A" | "B", number> = {
  A: 1,
  B: 2,
};

const SLOT_MS_ESTIMATE = 400;
const U64_MAX = 18_446_744_073_709_551_615n;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function ixDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU16LE(value: number): Buffer {
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function encodeU64LE(value: bigint): Buffer {
  const out = Buffer.allocUnsafe(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function encodeString(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32LE(data.length, 0);
  return Buffer.concat([len, data]);
}

function encodePubkey(pubkey: PublicKey): Buffer {
  return Buffer.from(pubkey.toBytes());
}

function parseSignerSecret(raw: string | null): Keypair | null {
  if (!raw) return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    // Resolve file paths
    if (
      trimmed.endsWith(".json") ||
      trimmed.startsWith("~/") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../")
    ) {
      let filePath = trimmed;
      if (filePath.startsWith("~/")) {
        filePath = resolve(homedir(), filePath.slice(2));
      } else {
        filePath = resolve(filePath);
      }

      if (existsSync(filePath)) {
        trimmed = readFileSync(filePath, "utf8").trim();
      }
    }

    // JSON array format: [1,2,3,...,64]
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const parsed = JSON.parse(trimmed) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }

    // Comma-separated bytes: 1,2,3,...,64
    if (trimmed.includes(",")) {
      const bytes = trimmed.split(",").map((part) => Number(part.trim()));
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    }

    // Base58 format (most common from solana-keygen / Phantom export)
    try {
      const decoded = bs58.decode(trimmed);
      if (decoded.length === 64) {
        return Keypair.fromSecretKey(Uint8Array.from(decoded));
      }
    } catch {
      // Not valid base58, fall through to base64
    }

    // Base64 format
    const b64 = Buffer.from(trimmed, "base64");
    if (b64.length === 64) {
      return Keypair.fromSecretKey(Uint8Array.from(b64));
    }

    console.warn(
      "[SolanaArenaOperator] Unsupported signer secret format or bad key size. Use JSON array, comma-separated bytes, base58, or base64.",
    );
    return null;
  } catch (error) {
    console.warn("[SolanaArenaOperator] Failed to parse signer secret:", error);
    return null;
  }
}

function deriveAtaAddress(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
  ataProgram: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ataProgram,
  );
  return ata;
}

function formatBaseUnitsToDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const text = abs.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  const rendered = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${rendered}` : rendered;
}

export class SolanaArenaOperator {
  private readonly config: SolanaArenaConfig;
  private readonly programId: PublicKey;
  private readonly mint: PublicKey;
  private readonly tokenProgramId: PublicKey;
  private readonly ataProgramId: PublicKey;
  private readonly authority: Keypair | null;
  private readonly reporter: Keypair | null;
  private readonly keeper: Keypair | null;
  private readonly connection: Connection;

  public constructor(config: SolanaArenaConfig) {
    this.config = config;
    this.programId = new PublicKey(config.marketProgramId);
    this.mint = new PublicKey(config.goldMint);
    this.tokenProgramId = new PublicKey(config.goldTokenProgramId);
    this.ataProgramId = new PublicKey(config.associatedTokenProgramId);
    this.authority = parseSignerSecret(config.authoritySecret);
    this.reporter = parseSignerSecret(config.reporterSecret) ?? this.authority;
    this.keeper = parseSignerSecret(config.keeperSecret) ?? this.authority;
    this.connection = new Connection(config.rpcUrl, {
      wsEndpoint: config.wsUrl,
      commitment: "confirmed",
    });
  }

  public isEnabled(): boolean {
    return this.authority !== null;
  }

  public getCustodyWallet(): string | null {
    const payer = this.keeper ?? this.authority;
    return payer?.publicKey.toBase58() ?? null;
  }

  public getProgramId(): string {
    return this.programId.toBase58();
  }

  public deriveRoundAddresses(roundSeedHex: string): RoundAddressBundle {
    const roundSeed = Buffer.from(roundSeedHex, "hex");
    if (roundSeed.length !== 32) {
      throw new Error("roundSeedHex must decode to 32 bytes");
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      this.programId,
    );
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle", "utf8"), roundSeed],
      this.programId,
    );
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market", "utf8"), roundSeed],
      this.programId,
    );

    const vaultAta = deriveAtaAddress(
      this.mint,
      marketPda,
      this.tokenProgramId,
      this.ataProgramId,
    );
    const feeVaultAta = deriveAtaAddress(
      this.mint,
      configPda,
      this.tokenProgramId,
      this.ataProgramId,
    );

    return {
      roundSeedHex,
      roundSeed,
      mint: this.mint,
      tokenProgram: this.tokenProgramId,
      configPda,
      marketPda,
      oraclePda,
      vaultAta,
      feeVaultAta,
    };
  }

  public derivePositionPda(roundSeedHex: string, bettorWallet: string): string {
    const addresses = this.deriveRoundAddresses(roundSeedHex);
    const bettor = new PublicKey(bettorWallet);
    const [position] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position", "utf8"),
        addresses.marketPda.toBuffer(),
        bettor.toBuffer(),
      ],
      this.programId,
    );
    return position.toBase58();
  }

  public getCustodyAta(): string | null {
    const payer = this.keeper ?? this.authority;
    if (!payer) return null;
    const ata = deriveAtaAddress(
      this.mint,
      payer.publicKey,
      this.tokenProgramId,
      this.ataProgramId,
    );
    return ata.toBase58();
  }

  public async initRound(
    roundSeedHex: string,
    bettingClosesAtMs: number,
  ): Promise<InitRoundResult | null> {
    if (!this.authority) return null;

    const addresses = this.deriveRoundAddresses(roundSeedHex);
    await this.ensureConfig();

    let initOracleSignature: string | null = null;
    let initMarketSignature: string | null = null;

    const oracleInfo = await this.connection.getAccountInfo(
      addresses.oraclePda,
    );
    if (!oracleInfo) {
      const data = Buffer.concat([
        ixDiscriminator("init_oracle_round"),
        addresses.roundSeed,
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId,
        keys: [
          {
            pubkey: this.authority.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: addresses.configPda, isSigner: false, isWritable: false },
          { pubkey: addresses.oraclePda, isSigner: false, isWritable: true },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      });
      initOracleSignature = await this.sendWithSigner(ix, this.authority);
    }

    const currentSlot = await this.connection.getSlot("confirmed");
    const msUntilClose = Math.max(0, bettingClosesAtMs - Date.now());
    const slotDelta = Math.max(
      this.config.closeSlotLead,
      Math.ceil(msUntilClose / SLOT_MS_ESTIMATE),
    );
    const closeSlot = currentSlot + slotDelta;

    const marketInfo = await this.connection.getAccountInfo(
      addresses.marketPda,
    );
    if (!marketInfo) {
      const data = Buffer.concat([
        ixDiscriminator("init_market"),
        addresses.roundSeed,
        encodeU64LE(BigInt(closeSlot)),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId,
        keys: [
          {
            pubkey: this.authority.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: addresses.configPda, isSigner: false, isWritable: false },
          { pubkey: addresses.oraclePda, isSigner: false, isWritable: false },
          { pubkey: addresses.mint, isSigner: false, isWritable: false },
          { pubkey: addresses.marketPda, isSigner: false, isWritable: true },
          { pubkey: addresses.vaultAta, isSigner: false, isWritable: true },
          { pubkey: addresses.feeVaultAta, isSigner: false, isWritable: true },
          {
            pubkey: addresses.tokenProgram,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: this.ataProgramId, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      });
      initMarketSignature = await this.sendWithSigner(ix, this.authority);
    }

    return {
      addresses,
      closeSlot,
      initOracleSignature,
      initMarketSignature,
    };
  }

  public async lockMarket(roundSeedHex: string): Promise<string | null> {
    const resolver = this.keeper ?? this.authority;
    if (!resolver) return null;

    const addresses = this.deriveRoundAddresses(roundSeedHex);
    const marketInfo = await this.connection.getAccountInfo(
      addresses.marketPda,
    );
    if (!marketInfo) return null;

    const data = ixDiscriminator("lock_market");
    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: resolver.publicKey, isSigner: true, isWritable: true },
        { pubkey: addresses.configPda, isSigner: false, isWritable: false },
        { pubkey: addresses.marketPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    try {
      return await this.sendWithSigner(ix, resolver);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Close slot has not been reached") ||
        message.includes("custom program error")
      ) {
        return null;
      }
      throw error;
    }
  }

  public async reportAndResolve(params: {
    roundSeedHex: string;
    winnerSide: "A" | "B";
    resultHashHex: string;
    metadataUri: string;
  }): Promise<ReportResolveResult | null> {
    if (!this.authority || !this.reporter) return null;
    const resolver = this.keeper ?? this.authority;
    if (!resolver) return null;

    const addresses = this.deriveRoundAddresses(params.roundSeedHex);
    const winnerSide = SIDE_TO_U8[params.winnerSide];
    const resultHash = this.toFixedBytes32(params.resultHashHex);

    let reportSignature: string | null = null;
    let resolveSignature: string | null = null;

    const reportData = Buffer.concat([
      ixDiscriminator("report_outcome"),
      addresses.roundSeed,
      Buffer.from([winnerSide]),
      resultHash,
      encodeString(params.metadataUri),
    ]);

    const reportIx = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.reporter.publicKey, isSigner: true, isWritable: true },
        { pubkey: addresses.configPda, isSigner: false, isWritable: false },
        { pubkey: addresses.oraclePda, isSigner: false, isWritable: true },
      ],
      data: reportData,
    });

    try {
      reportSignature = await this.sendWithSigner(reportIx, this.reporter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Oracle round is already finalized")) {
        throw error;
      }
    }

    const resolveIx = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: resolver.publicKey, isSigner: true, isWritable: true },
        { pubkey: addresses.configPda, isSigner: false, isWritable: false },
        { pubkey: addresses.mint, isSigner: false, isWritable: false },
        { pubkey: addresses.marketPda, isSigner: false, isWritable: true },
        { pubkey: addresses.oraclePda, isSigner: false, isWritable: false },
        { pubkey: addresses.vaultAta, isSigner: false, isWritable: true },
        { pubkey: addresses.feeVaultAta, isSigner: false, isWritable: true },
        { pubkey: addresses.tokenProgram, isSigner: false, isWritable: false },
      ],
      data: ixDiscriminator("resolve_market_from_oracle"),
    });

    resolveSignature = await this.sendWithSigner(resolveIx, resolver);

    return { reportSignature, resolveSignature };
  }

  public async placeBetFor(params: {
    roundSeedHex: string;
    bettorWallet: string;
    side: "A" | "B";
    amountGoldBaseUnits: bigint;
  }): Promise<string | null> {
    const payer = this.keeper ?? this.authority;
    if (!payer) return null;
    if (params.amountGoldBaseUnits <= 0n) {
      throw new Error("amountGoldBaseUnits must be greater than zero");
    }

    const addresses = this.deriveRoundAddresses(params.roundSeedHex);
    const bettor = new PublicKey(params.bettorWallet);
    const [position] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position", "utf8"),
        addresses.marketPda.toBuffer(),
        bettor.toBuffer(),
      ],
      this.programId,
    );
    const sourceAta = deriveAtaAddress(
      addresses.mint,
      payer.publicKey,
      addresses.tokenProgram,
      this.ataProgramId,
    );

    const data = Buffer.concat([
      ixDiscriminator("place_bet_for"),
      encodePubkey(bettor),
      Buffer.from([SIDE_TO_U8[params.side]]),
      encodeU64LE(params.amountGoldBaseUnits),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: addresses.configPda, isSigner: false, isWritable: false },
        { pubkey: addresses.mint, isSigner: false, isWritable: false },
        { pubkey: addresses.marketPda, isSigner: false, isWritable: true },
        { pubkey: addresses.vaultAta, isSigner: false, isWritable: true },
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: bettor, isSigner: false, isWritable: false },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: addresses.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    return this.sendWithSigner(ix, payer);
  }

  public async inspectMarketBetTransaction(
    signature: string,
    roundSeedHex: string,
  ): Promise<{
    signature: string;
    bettorWallet: string | null;
    vaultAta: string;
    amountBaseUnits: bigint;
    amountGold: string;
  } | null> {
    const addresses = this.deriveRoundAddresses(roundSeedHex);
    const inspected = await this.inspectAnyMarketBetTransaction(
      signature,
      addresses.marketPda.toBase58(),
    );
    if (!inspected) {
      return null;
    }
    if (inspected.vaultAta !== addresses.vaultAta.toBase58()) {
      return null;
    }
    return inspected;
  }

  public async inspectAnyMarketBetTransaction(
    signature: string,
    expectedMarketPda: string | null = null,
  ): Promise<{
    signature: string;
    bettorWallet: string | null;
    vaultAta: string;
    amountBaseUnits: bigint;
    amountGold: string;
  } | null> {
    const parsed = await this.connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!parsed?.meta) {
      return null;
    }

    const arenaProgramId = this.programId.toBase58();
    const hasArenaInstruction = parsed.transaction.message.instructions.some(
      (instruction) => {
        const typed = instruction as {
          programId?: string | { toBase58(): string };
        };
        const programId =
          typeof typed.programId === "string"
            ? typed.programId
            : typed.programId?.toBase58();
        return programId === arenaProgramId;
      },
    );
    if (!hasArenaInstruction) {
      return null;
    }

    const accountKeys = parsed.transaction.message.accountKeys.map((entry) => {
      const withPubkey = entry as { pubkey?: string | { toBase58(): string } };
      if (typeof withPubkey.pubkey === "string") return withPubkey.pubkey;
      if (withPubkey.pubkey) return withPubkey.pubkey.toBase58();
      const asPubkey = entry as { toBase58?: () => string };
      if (typeof asPubkey.toBase58 === "function") return asPubkey.toBase58();
      return String(entry);
    });

    if (expectedMarketPda && !accountKeys.includes(expectedMarketPda)) {
      return null;
    }

    const preToken = parsed.meta.preTokenBalances ?? [];
    const postToken = parsed.meta.postTokenBalances ?? [];
    const mint = this.mint.toBase58();
    const preByIndex = new Map<number, bigint>();
    for (const item of preToken) {
      if (item.mint !== mint) continue;
      preByIndex.set(item.accountIndex, BigInt(item.uiTokenAmount.amount));
    }
    const postByIndex = new Map<number, bigint>();
    for (const item of postToken) {
      if (item.mint !== mint) continue;
      postByIndex.set(item.accountIndex, BigInt(item.uiTokenAmount.amount));
    }

    let vaultIndex = -1;
    let largestInflow = 0n;
    const allIndexes = new Set<number>([
      ...Array.from(preByIndex.keys()),
      ...Array.from(postByIndex.keys()),
    ]);
    for (const index of allIndexes) {
      const before = preByIndex.get(index) ?? 0n;
      const after = postByIndex.get(index) ?? 0n;
      const change = after - before;
      if (change > largestInflow) {
        largestInflow = change;
        vaultIndex = index;
      }
    }
    if (vaultIndex < 0 || largestInflow <= 0n) {
      return null;
    }

    let bettorWallet: string | null = null;
    let largestOutflow = 0n;
    for (const index of allIndexes) {
      if (index === vaultIndex) continue;
      const before = preByIndex.get(index) ?? 0n;
      const after = postByIndex.get(index) ?? 0n;
      const change = after - before;
      if (change < 0n && -change > largestOutflow) {
        largestOutflow = -change;
        const owner =
          postToken.find((item) => item.accountIndex === index && item.owner)
            ?.owner ??
          preToken.find((item) => item.accountIndex === index && item.owner)
            ?.owner ??
          null;
        bettorWallet = owner;
      }
    }

    const vaultAta = accountKeys[vaultIndex];
    if (!vaultAta) {
      return null;
    }

    return {
      signature,
      bettorWallet,
      vaultAta,
      amountBaseUnits: largestInflow,
      amountGold: formatBaseUnitsToDecimal(largestInflow, 6),
    };
  }

  public async inspectInboundGoldTransfer(signature: string): Promise<{
    signature: string;
    fromWallet: string | null;
    toWallet: string;
    destinationAta: string;
    amountBaseUnits: bigint;
    amountGold: string;
    memo: string | null;
  } | null> {
    const toWallet = this.getCustodyWallet();
    if (!toWallet) return null;

    const parsed = await this.connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!parsed?.meta) {
      return null;
    }

    const destinationAta = this.getCustodyAta();
    if (!destinationAta) return null;

    const accountKeys = parsed.transaction.message.accountKeys.map((entry) => {
      const withPubkey = entry as { pubkey?: string | { toBase58(): string } };
      if (typeof withPubkey.pubkey === "string") return withPubkey.pubkey;
      if (withPubkey.pubkey) return withPubkey.pubkey.toBase58();
      const asPubkey = entry as { toBase58?: () => string };
      if (typeof asPubkey.toBase58 === "function") return asPubkey.toBase58();
      return String(entry);
    });
    const destinationIndex = accountKeys.findIndex(
      (key) => key === destinationAta,
    );
    if (destinationIndex < 0) return null;

    const preToken = parsed.meta.preTokenBalances ?? [];
    const postToken = parsed.meta.postTokenBalances ?? [];
    const mint = this.mint.toBase58();
    const destinationPre = preToken.find(
      (item) => item.accountIndex === destinationIndex && item.mint === mint,
    );
    const destinationPost = postToken.find(
      (item) => item.accountIndex === destinationIndex && item.mint === mint,
    );

    const preAmount = BigInt(destinationPre?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(destinationPost?.uiTokenAmount.amount ?? "0");
    const delta = postAmount - preAmount;
    if (delta <= 0n) {
      return null;
    }

    const preByIndex = new Map<number, bigint>();
    for (const item of preToken) {
      if (item.mint !== mint) continue;
      preByIndex.set(item.accountIndex, BigInt(item.uiTokenAmount.amount));
    }
    const postByIndex = new Map<number, bigint>();
    for (const item of postToken) {
      if (item.mint !== mint) continue;
      postByIndex.set(item.accountIndex, BigInt(item.uiTokenAmount.amount));
    }

    let fromWallet: string | null = null;
    let largestOutflow = 0n;
    const allIndexes = new Set<number>([
      ...Array.from(preByIndex.keys()),
      ...Array.from(postByIndex.keys()),
    ]);
    for (const index of allIndexes) {
      if (index === destinationIndex) continue;
      const before = preByIndex.get(index) ?? 0n;
      const after = postByIndex.get(index) ?? 0n;
      const change = after - before;
      if (change < 0n && -change > largestOutflow) {
        largestOutflow = -change;
        const owner =
          postToken.find((item) => item.accountIndex === index && item.owner)
            ?.owner ??
          preToken.find((item) => item.accountIndex === index && item.owner)
            ?.owner ??
          null;
        fromWallet = owner;
      }
    }

    let memo: string | null = null;
    for (const instruction of parsed.transaction.message.instructions) {
      const typed = instruction as {
        program?: string;
        programId?: string | { toBase58(): string };
        parsed?: unknown;
      };
      const programId =
        typeof typed.programId === "string"
          ? typed.programId
          : typed.programId?.toBase58();
      if (typed.program === "spl-memo" || programId === MEMO_PROGRAM_ID) {
        if (typeof typed.parsed === "string") {
          memo = typed.parsed;
          break;
        }
        if (
          typed.parsed &&
          typeof typed.parsed === "object" &&
          "memo" in typed.parsed
        ) {
          const candidate = (typed.parsed as { memo?: unknown }).memo;
          if (typeof candidate === "string") {
            memo = candidate;
            break;
          }
        }
      }
    }

    return {
      signature,
      fromWallet,
      toWallet,
      destinationAta,
      amountBaseUnits: delta,
      amountGold: formatBaseUnitsToDecimal(delta, 6),
      memo,
    };
  }

  public async claimFor(
    roundSeedHex: string,
    bettorWallet: string,
  ): Promise<string | null> {
    const resolver = this.keeper ?? this.authority;
    if (!resolver) return null;

    const addresses = this.deriveRoundAddresses(roundSeedHex);
    const marketInfo = await this.connection.getAccountInfo(
      addresses.marketPda,
    );
    if (!marketInfo) return null;

    const bettor = new PublicKey(bettorWallet);
    const [position] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position", "utf8"),
        addresses.marketPda.toBuffer(),
        bettor.toBuffer(),
      ],
      this.programId,
    );
    const destinationAta = deriveAtaAddress(
      addresses.mint,
      bettor,
      addresses.tokenProgram,
      this.ataProgramId,
    );

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: resolver.publicKey, isSigner: true, isWritable: true },
        { pubkey: addresses.configPda, isSigner: false, isWritable: false },
        { pubkey: addresses.mint, isSigner: false, isWritable: false },
        { pubkey: addresses.marketPda, isSigner: false, isWritable: true },
        { pubkey: addresses.vaultAta, isSigner: false, isWritable: true },
        { pubkey: bettor, isSigner: false, isWritable: false },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: destinationAta, isSigner: false, isWritable: true },
        { pubkey: addresses.tokenProgram, isSigner: false, isWritable: false },
      ],
      data: ixDiscriminator("claim_for"),
    });

    return this.sendWithSigner(ix, resolver);
  }

  private async ensureConfig(): Promise<void> {
    if (!this.authority) return;
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config", "utf8")],
      this.programId,
    );
    const existing = await this.connection.getAccountInfo(configPda);
    if (existing) return;

    const reporter = this.reporter?.publicKey ?? this.authority.publicKey;
    const keeper = this.keeper?.publicKey ?? this.authority.publicKey;

    const data = Buffer.concat([
      ixDiscriminator("initialize_config"),
      encodeU16LE(this.config.feeBps),
      reporter.toBuffer(),
      keeper.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    });

    await this.sendWithSigner(ix, this.authority);
  }

  private async sendWithSigner(
    instruction: TransactionInstruction,
    signer: Keypair,
  ): Promise<string> {
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: latest.blockhash,
    }).add(instruction);
    tx.sign(signer);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );
    return signature;
  }

  private toFixedBytes32(hashHex: string): Buffer {
    const clean = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
    if (!/^[a-fA-F0-9]+$/.test(clean)) {
      throw new Error("resultHashHex must be hex");
    }
    const source = Buffer.from(clean, "hex");
    if (source.length === 32) return source;
    if (source.length > 32) return source.subarray(0, 32);
    const out = Buffer.alloc(32);
    source.copy(out, 0, 0, source.length);
    return out;
  }
}

export function computeMarketCloseSlot(
  nowSlot: number,
  bettingClosesAtMs: number,
  closeSlotLead: number,
): number {
  const msUntilClose = Math.max(0, bettingClosesAtMs - Date.now());
  const delta = Math.max(
    closeSlotLead,
    Math.ceil(msUntilClose / SLOT_MS_ESTIMATE),
  );
  const closeSlot = BigInt(nowSlot) + BigInt(delta);
  if (closeSlot > U64_MAX) {
    return Number(U64_MAX);
  }
  return Number(closeSlot);
}
