import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { nodePolyfills } from "vite-plugin-node-polyfills";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const plugins: any[] = [react()];
  const alias: Record<string, string> = {};
  const polyfillShimsPath = path.resolve(
    __dirname,
    "node_modules",
    "vite-plugin-node-polyfills",
    "shims",
  );

  // Some transitive deps (for example @metamask/sdk) import these shim paths
  // directly, and with workspace hoisting they may resolve outside this package.
  // Pin them to this app's installed shim files so Rollup resolution is stable.
  alias["vite-plugin-node-polyfills/shims/global"] = path.resolve(
    polyfillShimsPath,
    "global",
    "dist",
    "index.js",
  );
  alias["vite-plugin-node-polyfills/shims/process"] = path.resolve(
    polyfillShimsPath,
    "process",
    "dist",
    "index.js",
  );
  alias["vite-plugin-node-polyfills/shims/buffer"] = path.resolve(
    polyfillShimsPath,
    "buffer",
    "dist",
    "index.js",
  );

  const require = createRequire(import.meta.url);
  const curvesMainPath = require.resolve("@noble/curves");

  // Fix for @noble/curves import resolution inside the turbo monorepo
  // Try to use the ESM version first, but if it doesn't exist (e.g., due to CI environment issues),
  // fall back to the CommonJS version in the package root.
  let ed25519Path = curvesMainPath.replace(/index\.js$/, "esm/ed25519.js");
  if (!fs.existsSync(ed25519Path)) {
    ed25519Path = curvesMainPath.replace(/index\.js$/, "ed25519.js");
  }
  let secp256k1Path = curvesMainPath.replace(/index\.js$/, "esm/secp256k1.js");
  if (!fs.existsSync(secp256k1Path)) {
    secp256k1Path = curvesMainPath.replace(/index\.js$/, "secp256k1.js");
  }

  // Fix for @noble/curves import resolution inside the turbo monorepo
  alias["@noble/curves/ed25519"] = ed25519Path;
  alias["@noble/curves/secp256k1"] = secp256k1Path;

  const polyfills = nodePolyfills({
    include: ["buffer", "process"],
    globals: { global: true, process: true, Buffer: true },
    protocolImports: true,
  }) as any;
  if (Array.isArray(polyfills)) {
    plugins.push(...polyfills);
  } else {
    plugins.push(polyfills);
  }

  const config: UserConfig = {
    plugins,
    server: {
      host: true,
      port: 4179,
    },
    resolve: {
      alias,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    optimizeDeps: {
      include: ["fetch-retry"],
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };

  return config;
});
