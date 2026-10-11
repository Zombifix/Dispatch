import { pgTable, text, integer, timestamp, date, uuid, jsonb, unique, index, varchar, json, real, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Source de vérité unique du schéma. Toute modification passe par
// `npm run db:generate` (nouvelle migration versionnée dans migrations/).

// Table des sessions express (connect-pg-simple), versionnée avec le reste.
export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (t) => [index("IDX_session_expire").on(t.expire)]);

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = z.object({
  email: z.string().email(),
  passwordHash: z.string().min(1),
});
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull().default(""),
  title: text("title").notNull().default(""),
  summary: text("summary"),
  targetRole: text("target_role"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [unique("profile_user_id_unique").on(t.userId)]);

export const experiences = pgTable("experiences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  company: text("company").notNull(),
  contractType: text("contract_type"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("IDX_experiences_user_id").on(t.userId)]);

export const bullets = pgTable("bullets", {
  id: uuid("id").primaryKey().defaultRandom(),
  experienceId: uuid("experience_id").references(() => experiences.id, { onDelete: "cascade" }).notNull(),
  text: text("text").notNull(),
  priority: integer("priority").default(0),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  // Embedding mis en cache : recalculé seulement si le texte ou le modèle change
  // (embeddingKey = hash(modèle, texte embeddé)). Tableau simple : pas besoin de pgvector.
  embedding: real("embedding").array(),
  embeddingKey: text("embedding_key"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("IDX_bullets_experience_id").on(t.experienceId)]);

// ─── Formulations : un fait (bullet) peut être dit de plusieurs façons ──────
// selon l'angle de candidature et la langue. Toutes écrites ou validées par l'utilisateur.
export const ANGLES = ["ic", "lead", "consultant", "manager"] as const;
export type Angle = typeof ANGLES[number];
export const CV_LANGUAGES = ["FR", "EN"] as const;
export type CvLanguage = typeof CV_LANGUAGES[number];

export const bulletVariants = pgTable("bullet_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  bulletId: uuid("bullet_id").references(() => bullets.id, { onDelete: "cascade" }).notNull(),
  angle: text("angle").notNull(),
  language: text("language").notNull(),
  text: text("text").notNull(),
  // "user" : écrite par l'utilisateur ; "suggested" : proposée par l'IA puis acceptée
  source: text("source").notNull().default("user"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("bullet_variants_bullet_angle_lang_unique").on(t.bulletId, t.angle, t.language),
  index("IDX_bullet_variants_bullet_id").on(t.bulletId),
]);

// Titre et résumé du profil par angle et par langue.
export const profileVariants = pgTable("profile_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(), // "title" | "summary"
  angle: text("angle").notNull(),
  language: text("language").notNull(),
  text: text("text").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("profile_variants_user_kind_angle_lang_unique").on(t.userId, t.kind, t.angle, t.language)]);

export const variantInputSchema = z.object({
  angle: z.enum(ANGLES),
  language: z.enum(CV_LANGUAGES),
  text: z.string().trim().min(2).max(320),
});
export type BulletVariant = typeof bulletVariants.$inferSelect;
export type ProfileVariant = typeof profileVariants.$inferSelect;

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  category: text("category"),
  level: integer("level"),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("skills_user_id_name_unique").on(t.userId, t.name)]);

export const formations = pgTable("formations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  school: text("school").notNull(),
  degree: text("degree").notNull(),
  year: text("year"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const languages = pgTable("languages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  level: text("level"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobPosts = pgTable("job_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  url: text("url"),
  rawText: text("raw_text"),
  extractedJson: jsonb("extracted_json"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("IDX_job_posts_user_id").on(t.userId)]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  jobPostId: uuid("job_post_id").references(() => jobPosts.id, { onDelete: "cascade" }).notNull(),
  mode: text("mode").notNull(), // "original" | "polished" | "adaptive"
  selectedExperienceIds: uuid("selected_experience_ids").array(),
  selectedBulletIds: uuid("selected_bullet_ids").array(),
  outputCvText: text("output_cv_text"),
  outputReportJson: jsonb("output_report_json"),
  tracking: jsonb("tracking"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("IDX_runs_user_id_created").on(t.userId, t.createdAt.desc())]);

// Consommation d'appels LLM par utilisateur et par jour (quota LLM_DAILY_QUOTA).
export const llmUsage = pgTable("llm_usage", {
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  day: date("day").notNull(),
  calls: integer("calls").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

export const insertProfileSchema = createInsertSchema(profile).omit({ id: true, updatedAt: true, userId: true });
export const insertExperienceSchema = createInsertSchema(experiences).omit({ id: true, createdAt: true, userId: true });
export const insertBulletSchema = createInsertSchema(bullets).omit({ id: true, createdAt: true, embedding: true, embeddingKey: true });
export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true, userId: true });
export const insertFormationSchema = createInsertSchema(formations).omit({ id: true, createdAt: true, userId: true });
export const insertLanguageSchema = createInsertSchema(languages).omit({ id: true, createdAt: true, userId: true });
export const insertJobPostSchema = createInsertSchema(jobPosts).omit({ id: true, createdAt: true, userId: true });
export const insertRunSchema = createInsertSchema(runs).omit({ id: true, createdAt: true, userId: true });

export type Profile = typeof profile.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

export type Experience = typeof experiences.$inferSelect;
export type InsertExperience = z.infer<typeof insertExperienceSchema>;

export type BulletRow = typeof bullets.$inferSelect;
/** Bullet tel qu'exposé par l'API et utilisé par le moteur (sans le cache d'embedding). */
export type Bullet = Omit<BulletRow, "embedding" | "embeddingKey">;
export type InsertBullet = z.infer<typeof insertBulletSchema>;

export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;

export type Formation = typeof formations.$inferSelect;
export type InsertFormation = z.infer<typeof insertFormationSchema>;

export type Language = typeof languages.$inferSelect;
export type InsertLanguage = z.infer<typeof insertLanguageSchema>;

export type JobPost = typeof jobPosts.$inferSelect;
export type InsertJobPost = z.infer<typeof insertJobPostSchema>;

export type Run = typeof runs.$inferSelect;
export type InsertRun = z.infer<typeof insertRunSchema>;

export type RunResponse = Run & {
  jobPost: JobPost;
};
