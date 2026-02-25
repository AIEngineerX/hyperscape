import { createDatabaseAdapter } from "@elizaos/plugin-sql";
import { sql } from "drizzle-orm";
import fs from "fs";

process.env.ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS = "true";

async function run() {
    try {
        const config = { dataDir: "./pglite-fail-test" };
        if (fs.existsSync("./pglite-fail-test")) {
            fs.rmSync("./pglite-fail-test", { force: true, recursive: true });
        }

        const adapter = createDatabaseAdapter(config, "test-agent");
        await adapter.init();

        console.log("Executing Extension...");
        await adapter.db.execute(sql`CREATE EXTENSION IF NOT EXISTS "vector"`);

        console.log("Executing Table...");
        const q = `CREATE TABLE IF NOT EXISTS "public"."embeddings" (
      "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
      "memory_id" uuid,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "dim_384" vector(384),
      "dim_512" vector(512),
      "dim_768" vector(768),
      "dim_1024" vector(1024),
      "dim_1536" vector(1536),
      "dim_3072" vector(3072),
      CONSTRAINT "embedding_source_check" CHECK ("memory_id" IS NOT NULL)
    );`;

        try {
            await adapter.db.execute(sql.raw(q));
            console.log("Table created.");
        } catch (e) {
            console.log("Raw Error:", e);
            console.log("Error details:", Object.keys(e));
            if (e.cause) console.log("Cause:", e.cause);
            if (e.message) console.log("Message:", e.message);
        }
    } catch (err) {
        console.error("Caught error:");
        console.error(err);
    }
}
run();
