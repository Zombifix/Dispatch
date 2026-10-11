import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applique les migrations versionnées (dossier migrations/).
 * Si la base a été créée par l'ancien code (tables présentes, aucun historique
 * Drizzle), elle est d'abord alignée par legacy-baseline.sql puis marquée
 * comme étant à jour de 0000_init.
 */
export async function runMigrations(pool: Pool, migrationsFolder = resolveMigrationsFolder()): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: [{ has_users }] } = await client.query(
      "SELECT to_regclass('public.users') IS NOT NULL AS has_users",
    );
    const { rows: [{ has_journal }] } = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_journal",
    );
    let applied = 0;
    if (has_journal) {
      const r = await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
      applied = r.rows[0].n;
    }

    if (has_users && applied === 0) {
      console.log("[MIGRATE] Base héritée détectée : alignement sur 0000_init");
      const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
      const first = journal.entries[0];
      const initSql = fs.readFileSync(path.join(migrationsFolder, `${first.tag}.sql`), "utf8");
      const hash = crypto.createHash("sha256").update(initSql).digest("hex");
      const baseline = fs.readFileSync(path.join(migrationsFolder, "legacy-baseline.sql"), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(baseline);
        await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
        await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
        await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, first.when]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    client.release();
  }

  await migrate(drizzle(pool), { migrationsFolder });
  console.log("[MIGRATE] Schéma à jour");
}

function resolveMigrationsFolder(): string {
  const candidates = [path.resolve(process.cwd(), "migrations")];
  // __dirname n'existe que dans le bundle CJS de production
  if (typeof __dirname !== "undefined") candidates.push(path.resolve(__dirname, "..", "migrations"));
  const found = candidates.find(p => fs.existsSync(path.join(p, "meta", "_journal.json")));
  if (!found) throw new Error(`Dossier migrations/ introuvable (cherché : ${candidates.join(", ")})`);
  return found;
}
