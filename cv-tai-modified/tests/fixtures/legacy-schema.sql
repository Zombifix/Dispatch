-- Reproduction fidèle de l'ancien ensureTables (branche sans pgvector) + migrate-add-userId
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS experiences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, company TEXT NOT NULL, start_date DATE, end_date DATE, description TEXT, priority INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS bullets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE, text TEXT NOT NULL, priority INTEGER DEFAULT 0, tags TEXT[] DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS skills (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT UNIQUE NOT NULL, level INTEGER, priority INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS job_posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), url TEXT, raw_text TEXT, extracted_json JSONB, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS runs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_post_id UUID NOT NULL REFERENCES job_posts(id), mode TEXT NOT NULL, selected_experience_ids UUID[], selected_bullet_ids UUID[], output_cv_text TEXT, output_report_json JSONB, created_at TIMESTAMP DEFAULT NOW());
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS contract_type TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS category TEXT;
CREATE TABLE IF NOT EXISTS profile (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', summary TEXT, target_role TEXT, updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS formations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school TEXT NOT NULL, degree TEXT NOT NULL, year TEXT, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS languages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, level TEXT, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS users (id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL);
CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, CONSTRAINT "session_pkey" PRIMARY KEY ("sid"));
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tracking JSONB;
-- données
INSERT INTO users (email, password_hash) VALUES ('a@x.fr','s:h');
INSERT INTO experiences (id,title,company) VALUES ('11111111-1111-1111-1111-111111111111','Product Designer','Acme');
INSERT INTO bullets (experience_id,text,tags) VALUES ('11111111-1111-1111-1111-111111111111','Refonte du CRM B2B pour 12 marques','{CRM,B2B}');
INSERT INTO skills (name) VALUES ('Figma');
INSERT INTO job_posts (id,raw_text) VALUES ('22222222-2222-2222-2222-222222222222','offre');
INSERT INTO runs (job_post_id,mode) VALUES ('22222222-2222-2222-2222-222222222222','original');
INSERT INTO "session" VALUES ('abc','{}',now());
-- effet de migrate-add-userId.ts
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profile','experiences','skills','formations','languages','job_posts','runs'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN user_id integer REFERENCES users(id)', t);
    EXECUTE format('UPDATE %I SET user_id = 1', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_user_id ON %I(user_id)', t, t);
  END LOOP;
END $$;
ALTER TABLE skills DROP CONSTRAINT skills_name_key;
ALTER TABLE skills ADD CONSTRAINT skills_user_id_name_unique UNIQUE (user_id, name);
ALTER TABLE profile ADD CONSTRAINT profile_user_id_unique UNIQUE (user_id);
-- index ajoutés ensuite par ensureTables
CREATE INDEX IF NOT EXISTS "IDX_experiences_user_id" ON experiences ("user_id");
CREATE INDEX IF NOT EXISTS "IDX_bullets_experience_id" ON bullets ("experience_id");
CREATE INDEX IF NOT EXISTS "IDX_runs_user_id_created" ON runs ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_job_posts_user_id" ON job_posts ("user_id");
