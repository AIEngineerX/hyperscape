import {
  createDatabaseAdapter,
  DatabaseMigrationService,
  plugin as sqlPlugin,
} from "@elizaos/plugin-sql";
import { hyperscapePlugin } from "@hyperscape/plugin-hyperscape";
import fs from "fs";

async function run() {
  const dataDir = "./pglite-full-test2";
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  try {
    const config = { dataDir };
    const adapter = createDatabaseAdapter(config, "test-agent");
    console.log("Initializing adapter...");
    await adapter.init();

    const migrationService = new DatabaseMigrationService();
    // Register both plugins just like ElizaDuelBot
    migrationService.discoverAndRegisterPluginSchemas([
      sqlPlugin,
      hyperscapePlugin,
    ]);

    console.log("Initialize migration service...");
    await migrationService.initializeWithDatabase(adapter.db);

    console.log("Running all plugin migrations...");
    await migrationService.runAllPluginMigrations();

    console.log("Migrations finished successfully!");
  } catch (err) {
    console.error("Caught error during migrations:", err);
  }
}
run();
