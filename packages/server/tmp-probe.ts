import { loadConfig } from "./src/startup/config.js";
import path from "path";
import fs from "fs-extra";

async function main() {
  const config = await loadConfig();
  console.log("worldDir:", config.worldDir);
  console.log("assetsDir:", config.assetsDir);
  const worldAssetsDir = path.join(config.worldDir, "assets");
  const hasWorldAssetsDir = await fs.pathExists(worldAssetsDir);
  const hasCachedAssetsDir = await fs.pathExists(config.assetsDir);
  const gameAssetsRoot = hasWorldAssetsDir
    ? worldAssetsDir
    : hasCachedAssetsDir
      ? config.assetsDir
      : null;
  console.log("hasWorldAssetsDir:", hasWorldAssetsDir);
  console.log("gameAssetsRoot:", gameAssetsRoot);
}
main();
