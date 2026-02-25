import { PGlite } from "@electric-sql/pglite";

async function run() {
    const dataDir = "./pglite-old-schema";
    const db = new PGlite(dataDir);
    // Replicate the old schema roughly
    await db.exec(`
    CREATE TABLE IF NOT EXISTS "public"."entities" (
      "id" text PRIMARY KEY NOT NULL,
      "data" text,
      "updatedAt" timestamp
    );
  `);
    await db.close();
    console.log("Old schema db created.");
}
run();
