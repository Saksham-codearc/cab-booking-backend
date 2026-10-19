/**
 * One-off SQL runner for the Supabase dev project.
 *
 * The service-role REST key cannot execute DDL, so schema changes need a real
 * Postgres connection. Add a connection string to backend/.env:
 *
 *   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *
 * (the session pooler on port 5432, or the direct db.<ref>.supabase.co:5432 URL)
 *
 * Usage:  node scripts/apply-sql.mjs supabase/dev_reset_ride_domain.sql
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

function readEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  const text = readFileSync(envPath, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, "")];
      })
  );
}

const env = readEnv();
const connectionString = env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set in backend/.env");
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error("Usage: node scripts/apply-sql.mjs <path-to.sql>");
  process.exit(1);
}

const sql = readFileSync(path.resolve(process.cwd(), sqlFile), "utf8");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${sqlFile}`);
} catch (error) {
  console.error(`Failed applying ${sqlFile}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
