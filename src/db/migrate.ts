// Apply the SQL migrations in ./drizzle over the direct (unpooled) Neon connection:
// migrations must not run through PgBouncer. DATABASE_DRIVER=neon-ws uses Neon's
// WebSocket driver instead of TCP port 5432 (see src/db/client.ts).
import { neonWebSocket } from "./client";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url || url.startsWith("pglite:")) {
  console.error(
    "No database configured. Set DATABASE_URL and DATABASE_URL_UNPOOLED (on Vercel: Project → Storage → connect a Neon database).",
  );
  process.exit(1);
}

if (process.env.DATABASE_DRIVER === "neon-ws") {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
  neonConfig.webSocketConstructor = await neonWebSocket();
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
} else {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
console.log("Migrations applied.");
process.exit(0);
