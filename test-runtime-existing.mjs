import { AgentRuntime } from "@elizaos/core";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { createDatabaseAdapter } from "@elizaos/plugin-sql";

process.env.ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS = "true";

async function run() {
    const dataDir = "./pglite-old-schema";
    try {
        const config = { dataDir };
        const adapter = createDatabaseAdapter(config, "test-agent");
        console.log("Initializing adapter...");
        await adapter.init();

        const runtime = new AgentRuntime({
            character: { name: "Test", id: "00000000-0000-0000-0000-000000000000" },
            databaseAdapter: adapter,
            plugins: [sqlPlugin],
        });

        console.log("Initializing AgentRuntime on existing DB with destructive migrations...");
        await runtime.initialize();

        console.log("Runtime initialized!");
    } catch (err) {
        console.error("Caught error during migrations:");
        console.error(err);
    }
}
run();
