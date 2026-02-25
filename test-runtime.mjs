import { AgentRuntime } from "@elizaos/core";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { createDatabaseAdapter } from "@elizaos/plugin-sql";
import fs from "fs";

async function run() {
    const dataDir = "./pglite-full-test3";
    if (fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
    try {
        const config = { dataDir };
        const adapter = createDatabaseAdapter(config, "test-agent");
        console.log("Initializing adapter...");
        await adapter.init();

        // Create AgentRuntime which will automatically register its internal plugins
        // plus the sqlPlugin 
        const runtime = new AgentRuntime({
            character: { name: "Test", id: "00000000-0000-0000-0000-000000000000" },
            databaseAdapter: adapter,
            plugins: [sqlPlugin],
        });

        console.log("Initializing AgentRuntime...");
        await runtime.initialize();

        console.log("Runtime initialized!");
    } catch (err) {
        console.error("Caught error during migrations:", err);
    }
}
run();
