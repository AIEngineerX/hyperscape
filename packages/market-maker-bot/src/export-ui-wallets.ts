import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type WalletInstance = {
  name: string;
  solanaPrivateKey?: string;
};

type MultiWalletConfig = {
  wallets: WalletInstance[];
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (flag: string, fallback: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return fallback;
    return value;
  };

  return {
    configPath: getValue("--config", "wallets.generated.json"),
    outPath: getValue("--out", ""),
    autoConnectIndex: Math.max(
      0,
      Number.parseInt(getValue("--auto-connect-index", "0"), 10) || 0,
    ),
  };
};

async function main() {
  const { configPath, outPath, autoConnectIndex } = parseArgs();
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const raw = await readFile(resolvedConfigPath, "utf8");
  const parsed = JSON.parse(raw) as MultiWalletConfig;

  if (
    !parsed ||
    !Array.isArray(parsed.wallets) ||
    parsed.wallets.length === 0
  ) {
    throw new Error("Config must include a non-empty wallets array");
  }

  const uiWallets = parsed.wallets
    .filter((wallet) => Boolean(wallet.solanaPrivateKey?.trim()))
    .map((wallet, index) => ({
      name: wallet.name,
      secretKey: wallet.solanaPrivateKey as string,
      autoConnect: index === autoConnectIndex,
    }));

  if (uiWallets.length === 0) {
    throw new Error("No wallets with solanaPrivateKey found in config");
  }

  const line = `VITE_HEADLESS_WALLETS=${JSON.stringify(uiWallets)}`;
  if (outPath.trim()) {
    const resolvedOutPath = path.resolve(process.cwd(), outPath);
    let current = "";
    try {
      current = await readFile(resolvedOutPath, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const lines = current.length > 0 ? current.split(/\r?\n/) : [];
    const keyPrefix = "VITE_HEADLESS_WALLETS=";
    const index = lines.findIndex((existing) => existing.startsWith(keyPrefix));

    if (index >= 0) {
      lines[index] = line;
    } else if (lines.length === 0) {
      lines.push(line);
    } else {
      if (lines[lines.length - 1].trim().length > 0) {
        lines.push("");
      }
      lines.push(line);
    }

    await writeFile(resolvedOutPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
    console.log(
      `[wallet-ui] wrote ${uiWallets.length} wallets to ${resolvedOutPath}`,
    );
    return;
  }

  console.log(line);
}

main().catch((error) => {
  console.error("[wallet-ui] failed:", error);
  process.exit(1);
});
