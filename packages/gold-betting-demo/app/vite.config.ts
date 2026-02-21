import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
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

  // HLS live streaming middleware — serves .m3u8 and .ts segments
  // from public/live/ (where the duel-stack RTMP bridge writes HLS output).
  // This middleware is required because Vite's dev server intercepts .ts files
  // as TypeScript modules instead of serving them as raw video/mp2t data.
  const hlsDir = path.resolve(__dirname, "public", "live");
  const hlsRoot = path.resolve(hlsDir);
  const serverHlsRoot = path.resolve(
    __dirname,
    "..",
    "..",
    "server",
    "public",
    "live",
  );
  const hlsRoots = [serverHlsRoot, hlsRoot];
  const hlsPlugin = {
    name: "hls-live-serve",
    configureServer(server: any) {
      server.middlewares.use("/live", (req: any, res: any, next: any) => {
        let requestPath = "/";
        try {
          const parsed = new URL(req.url || "/", "http://localhost");
          requestPath = decodeURIComponent(parsed.pathname || "/");
        } catch {
          requestPath = "/";
        }

        const relativePath =
          requestPath === "/" ? "stream.m3u8" : requestPath.replace(/^\/+/, "");
        const resolveFromRoots = () => {
          for (const root of hlsRoots) {
            const candidate = path.resolve(root, relativePath);
            if (!candidate.startsWith(`${root}${path.sep}`)) {
              continue;
            }
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
          return null;
        };

        const filePath = resolveFromRoots();
        if (!filePath) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        const contentType =
          ext === ".m3u8"
            ? "application/vnd.apple.mpegurl"
            : ext === ".ts"
              ? "video/mp2t"
              : ext === ".m4s"
                ? "video/iso.segment"
                : ext === ".mp4"
                  ? "video/mp4"
                  : "application/octet-stream";

        const stat = fs.statSync(filePath);
        const rangeHeader = req.headers?.range as string | undefined;

        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Accept-Ranges", "bytes");

        // Manifest should be revalidated; segments are immutable and CDN-cacheable.
        if (ext === ".m3u8") {
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.setHeader("Surrogate-Control", "no-store");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }

        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2]
              ? Number.parseInt(match[2], 10)
              : stat.size - 1;

            if (
              Number.isFinite(start) &&
              Number.isFinite(end) &&
              start >= 0 &&
              end >= start &&
              end < stat.size
            ) {
              res.statusCode = 206;
              res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${stat.size}`,
              );
              res.setHeader("Content-Length", String(end - start + 1));
              fs.createReadStream(filePath, { start, end }).pipe(res);
              return;
            }
          }

          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${stat.size}`);
          res.end();
          return;
        }

        res.setHeader("Content-Length", String(stat.size));
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
  plugins.push(hlsPlugin);

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
