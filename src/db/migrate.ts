// Apply the SQL migrations in ./drizzle to DATABASE_URL_UNPOOLED (or DATABASE_URL).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url || url.startsWith("pglite:")) {
  console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) to a Postgres URL. PGlite migrates itself on first use.");
  process.exit(1);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("Migrations applied.");
