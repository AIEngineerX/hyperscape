import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => {
  const plugins: any[] = [react()];

  try {
    const { nodePolyfills } = await import("vite-plugin-node-polyfills");
    const polyfills = nodePolyfills({
      include: ["buffer", "process"],
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

  return {
    plugins,
    server: {
      host: true,
      port: 4179,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
