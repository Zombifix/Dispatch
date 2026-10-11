// Applique les migrations sans démarrer le serveur : npm run db:migrate
import { pool } from "../server/db";
import { runMigrations } from "../server/migrate";

runMigrations(pool)
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("[MIGRATE] Échec :", e);
    await pool.end();
    process.exit(1);
  });
