import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const plugins: any[] = [react()];
  const alias: Record<string, string> = {};

  try {
    const { nodePolyfills } = await import("vite-plugin-node-polyfills");
    const shimsDir = path.resolve(
      __dirname,
      "node_modules/vite-plugin-node-polyfills/shims",
    );
    // Map shim imports so deps from root node_modules can resolve them
    alias["vite-plugin-node-polyfills/shims/buffer"] = path.join(
      shimsDir,
      "buffer/dist/index.js",
    );
    alias["vite-plugin-node-polyfills/shims/global"] = path.join(
      shimsDir,
      "global/dist/index.js",
    );
    alias["vite-plugin-node-polyfills/shims/process"] = path.join(
      shimsDir,
      "process/dist/index.js",
    );

    const polyfills = nodePolyfills({
      include: ["buffer", "process"],
      globals: { global: true },
      protocolImports: true,
    }) as any;
    if (Array.isArray(polyfills)) {
      plugins.push(...polyfills);
    } else {
      plugins.push(polyfills);
    }
  } catch {
    console.warn(
      "[gold-betting-demo] vite-plugin-node-polyfills not found, building without explicit node polyfills",
    );
  }

  // HLS live streaming middleware — serves .m3u8 and .ts segments
  // from public/live/ (where the duel-stack RTMP bridge writes HLS output).
  // This middleware is required because Vite's dev server intercepts .ts files
  // as TypeScript modules instead of serving them as raw video/mp2t data.
  const hlsDir = path.resolve(__dirname, "public", "live");
  const hlsRoot = path.resolve(hlsDir);
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
        const filePath = path.resolve(hlsRoot, relativePath);

        if (!filePath.startsWith(`${hlsRoot}${path.sep}`)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (!fs.existsSync(filePath)) {
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
    resolve: { alias },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };

  return config;
});
