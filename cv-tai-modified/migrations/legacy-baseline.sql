-- Aligne une base créée par l'ancien code (ensureTables + migrate-add-userId)
-- sur l'état de la migration 0000_init, sans perte de données.
-- Exécuté automatiquement une seule fois par server/migrate.ts quand la base
-- contient déjà des tables mais aucun historique de migration Drizzle.

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS contract_type text;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tracking jsonb;
-- La colonne pgvector n'a jamais été utilisée par le code.
ALTER TABLE bullets DROP COLUMN IF EXISTS embedding;

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar PRIMARY KEY NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp (6) NOT NULL
);

DO $$
DECLARE
  t text;
  c record;
BEGIN
  -- user_id obligatoire partout (ajouté par l'ancien migrate-add-userId.ts)
  FOREACH t IN ARRAY ARRAY['profile','experiences','skills','formations','languages','job_posts','runs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'user_id') THEN
      RAISE EXCEPTION 'Table % sans colonne user_id : lancer d''abord l''ancien script migrate-add-userId (git history).', t;
    END IF;
  END LOOP;

  -- Remplace toutes les clés étrangères héritées par les noms et règles de Drizzle
  FOR c IN
    SELECT con.conname, rel.relname
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'f'
      AND rel.relname IN ('profile','experiences','bullets','skills','formations','languages','job_posts','runs')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', c.relname, c.conname);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['profile','experiences','skills','formations','languages','job_posts','runs'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade', t, t || '_user_id_users_id_fk');
  END LOOP;
  ALTER TABLE bullets ADD CONSTRAINT bullets_experience_id_experiences_id_fk FOREIGN KEY (experience_id) REFERENCES public.experiences(id) ON DELETE cascade;
  ALTER TABLE runs ADD CONSTRAINT runs_job_post_id_job_posts_id_fk FOREIGN KEY (job_post_id) REFERENCES public.job_posts(id) ON DELETE cascade;

  -- Unicité : l'ancien DDL imposait skills.name unique pour TOUTE la base
  FOR c IN
    SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'skills' AND con.contype = 'u' AND con.conname <> 'skills_user_id_name_unique'
  LOOP
    EXECUTE format('ALTER TABLE skills DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skills_user_id_name_unique') THEN
    ALTER TABLE skills ADD CONSTRAINT skills_user_id_name_unique UNIQUE (user_id, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_user_id_unique') THEN
    ALTER TABLE profile ADD CONSTRAINT profile_user_id_unique UNIQUE (user_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
    ALTER TABLE users RENAME CONSTRAINT users_email_key TO users_email_unique;
  END IF;
END $$;

-- Index : noms Drizzle, suppression des doublons créés par l'ancien script
DROP INDEX IF EXISTS idx_profile_user_id;
DROP INDEX IF EXISTS idx_experiences_user_id;
DROP INDEX IF EXISTS idx_skills_user_id;
DROP INDEX IF EXISTS idx_formations_user_id;
DROP INDEX IF EXISTS idx_languages_user_id;
DROP INDEX IF EXISTS idx_job_posts_user_id;
DROP INDEX IF EXISTS idx_runs_user_id;
CREATE INDEX IF NOT EXISTS "IDX_bullets_experience_id" ON bullets USING btree (experience_id);
CREATE INDEX IF NOT EXISTS "IDX_experiences_user_id" ON experiences USING btree (user_id);
CREATE INDEX IF NOT EXISTS "IDX_job_posts_user_id" ON job_posts USING btree (user_id);
DROP INDEX IF EXISTS "IDX_runs_user_id_created";
CREATE INDEX "IDX_runs_user_id_created" ON runs USING btree (user_id, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" USING btree (expire);
