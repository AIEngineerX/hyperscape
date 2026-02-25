import { AgentRuntime } from "@elizaos/core";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { createDatabaseAdapter } from "@elizaos/plugin-sql";

async function run() {
    try {
        const config = { dataDir: "memory://test-agent-db" };
        const adapter = createDatabaseAdapter(config, "test-agent");
        console.log("Initializing in-memory adapter...");
        await adapter.init();

        const runtime = new AgentRuntime({
            character: { name: "Test", id: "00000000-0000-0000-0000-000000000000" },
            databaseAdapter: adapter,
            plugins: [sqlPlugin],
        });

        console.log("Initializing AgentRuntime on memory DB...");
        await runtime.initialize();

        console.log("Memory Runtime initialized successfully!");
    } catch (err) {
        console.error("Caught error during Memory DB initialization:");
        console.error(err);
    }
}
run();
