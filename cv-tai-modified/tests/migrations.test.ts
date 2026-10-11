import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import pg from "pg";
import { runMigrations } from "../server/migrate";

// Test d'intégration : nécessite une base Postgres jetable (TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("migrations", () => {
  it("créent le schéma sur une base vide et sont idempotentes", async () => {
    const pool = new pg.Pool({ connectionString: url });
    try {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
      await runMigrations(pool);
      await runMigrations(pool);
      const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1");
      expect(rows.map(r => r.tablename)).toEqual(expect.arrayContaining(["users", "experiences", "bullets", "runs", "session"]));
    } finally {
      await pool.end();
    }
  });

  it("alignent une base créée par l'ancien code sans perdre de données", async () => {
    const pool = new pg.Pool({ connectionString: url });
    try {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
      await pool.query(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "legacy-schema.sql"), "utf8"));
      await runMigrations(pool);
      const counts = await pool.query("SELECT (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM bullets)::int b, (SELECT count(*) FROM runs)::int r");
      expect(counts.rows[0]).toEqual({ u: 1, b: 1, r: 1 });
      const fk = await pool.query("SELECT count(*)::int n FROM pg_constraint WHERE conname = 'experiences_user_id_users_id_fk'");
      expect(fk.rows[0].n).toBe(1);
      const legacyUnique = await pool.query("SELECT count(*)::int n FROM pg_constraint WHERE conname = 'skills_name_key'");
      expect(legacyUnique.rows[0].n).toBe(0);
      await pool.query("DELETE FROM users");
      const after = await pool.query("SELECT (SELECT count(*) FROM bullets)::int b, (SELECT count(*) FROM runs)::int r");
      expect(after.rows[0]).toEqual({ b: 0, r: 0 });
    } finally {
      await pool.end();
    }
  });
});
