import { db, pool } from "./db";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import {
  profile, experiences, bullets, skills, formations, languages, jobPosts, runs,
  bulletVariants, profileVariants, users,
  type BulletVariant, type ProfileVariant,
  type Profile, type InsertProfile,
  type Experience, type InsertExperience,
  type Bullet, type BulletRow, type InsertBullet,
  type Skill, type InsertSkill,
  type Formation, type InsertFormation,
  type Language, type InsertLanguage,
  type JobPost, type InsertJobPost,
  type Run, type InsertRun,
  type RunResponse
} from "@shared/schema";

// Colonnes exposées d'un bullet : jamais l'embedding (1 536 flottants) dans l'API.
const bulletColumns = {
  id: bullets.id,
  experienceId: bullets.experienceId,
  text: bullets.text,
  priority: bullets.priority,
  tags: bullets.tags,
  createdAt: bullets.createdAt,
};
export type PublicBullet = Bullet;
const withoutEmbedding = (b: BulletRow): PublicBullet => {
  const { embedding: _e, embeddingKey: _k, ...rest } = b;
  return rest;
};

export interface IStorage {
  // Profile
  getProfile(userId: number): Promise<Profile | undefined>;
  upsertProfile(userId: number, data: Partial<InsertProfile>): Promise<Profile>;

  // Experiences
  getExperiences(userId: number): Promise<Experience[]>;
  getExperience(userId: number, id: string): Promise<Experience | undefined>;
  createExperience(userId: number, exp: InsertExperience): Promise<Experience>;
  updateExperience(userId: number, id: string, updates: Partial<InsertExperience>): Promise<Experience>;
  deleteExperience(userId: number, id: string): Promise<void>;

  // Bullets (scoped via experience ownership)
  getBulletsByExperience(userId: number, expId: string): Promise<PublicBullet[]>;
  createBullet(userId: number, bullet: InsertBullet): Promise<PublicBullet>;
  updateBullet(userId: number, id: string, updates: Partial<InsertBullet>): Promise<PublicBullet>;
  deleteBullet(userId: number, id: string): Promise<void>;
  getAllBullets(userId: number): Promise<PublicBullet[]>;
  getBulletEmbeddings(userId: number): Promise<Map<string, { key: string; vector: number[] }>>;
  saveBulletEmbeddings(entries: { id: string; key: string; vector: number[] }[]): Promise<void>;

  // Formulations (variantes)
  getBulletVariants(userId: number): Promise<BulletVariant[]>;
  upsertBulletVariant(userId: number, bulletId: string, v: { angle: string; language: string; text: string; source?: string }): Promise<BulletVariant | undefined>;
  deleteBulletVariant(userId: number, id: string): Promise<void>;
  getProfileVariants(userId: number): Promise<ProfileVariant[]>;
  upsertProfileVariant(userId: number, v: { kind: string; angle: string; language: string; text: string }): Promise<ProfileVariant>;
  deleteProfileVariant(userId: number, id: string): Promise<void>;

  // Quota LLM
  consumeLlmQuota(userId: number, units: number, dailyLimit: number): Promise<{ allowed: boolean; used: number }>;
  getLlmUsageToday(userId: number): Promise<number>;
  deleteUser(userId: number): Promise<void>;

  // Skills
  getSkills(userId: number): Promise<Skill[]>;
  createSkill(userId: number, skill: InsertSkill): Promise<Skill>;
  updateSkill(userId: number, id: string, updates: Partial<InsertSkill>): Promise<Skill>;
  deleteSkill(userId: number, id: string): Promise<void>;

  // Formations
  getFormations(userId: number): Promise<Formation[]>;
  createFormation(userId: number, f: InsertFormation): Promise<Formation>;
  deleteFormation(userId: number, id: string): Promise<void>;

  // Languages
  getLanguages(userId: number): Promise<Language[]>;
  createLanguage(userId: number, l: InsertLanguage): Promise<Language>;
  updateLanguage(userId: number, id: string, updates: Partial<InsertLanguage>): Promise<Language>;
  deleteLanguage(userId: number, id: string): Promise<void>;

  // Job Posts
  createJobPost(userId: number, jobPost: InsertJobPost): Promise<JobPost>;

  // Runs
  createRun(userId: number, run: InsertRun): Promise<Run>;
  getRun(userId: number, id: string): Promise<RunResponse | undefined>;
  updateRunOutput(userId: number, id: string, outputCvText: string, outputReportJson?: unknown): Promise<Run | undefined>;
  getRuns(userId: number): Promise<RunResponse[]>;
}

export class DatabaseStorage implements IStorage {
  // Profile
  async getProfile(userId: number) {
    const [p] = await db.select().from(profile).where(eq(profile.userId, userId));
    return p;
  }
  async upsertProfile(userId: number, data: Partial<InsertProfile>) {
    const existing = await this.getProfile(userId);
    if (existing) {
      const [updated] = await db.update(profile)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(profile.id, existing.id), eq(profile.userId, userId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(profile)
      .values({ name: data.name || "", title: data.title || "", ...data, userId })
      .returning();
    return created;
  }

  // Experiences
  async getExperiences(userId: number) {
    return await db.select().from(experiences)
      .where(eq(experiences.userId, userId))
      .orderBy(experiences.priority);
  }
  async getExperience(userId: number, id: string) {
    const [exp] = await db.select().from(experiences)
      .where(and(eq(experiences.id, id), eq(experiences.userId, userId)));
    return exp;
  }
  async createExperience(userId: number, exp: InsertExperience) {
    const [created] = await db.insert(experiences).values({ ...exp, userId }).returning();
    return created;
  }
  async updateExperience(userId: number, id: string, updates: Partial<InsertExperience>) {
    const [updated] = await db.update(experiences)
      .set(updates)
      .where(and(eq(experiences.id, id), eq(experiences.userId, userId)))
      .returning();
    return updated;
  }
  async deleteExperience(userId: number, id: string) {
    // Verify ownership before deleting
    const exp = await this.getExperience(userId, id);
    if (!exp) return;
    await db.delete(bullets).where(eq(bullets.experienceId, id));
    await db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.userId, userId)));
  }

  // Bullets (ownership checked via parent experience)
  async getBulletsByExperience(userId: number, expId: string) {
    // Verify the experience belongs to the user
    const exp = await this.getExperience(userId, expId);
    if (!exp) return [];
    return await db.select(bulletColumns).from(bullets)
      .where(eq(bullets.experienceId, expId))
      .orderBy(bullets.priority);
  }
  async createBullet(userId: number, bullet: InsertBullet) {
    // Verify the parent experience belongs to the user
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) throw new Error("Experience not found or access denied");
    const [created] = await db.insert(bullets).values(bullet).returning();
    return withoutEmbedding(created);
  }
  async updateBullet(userId: number, id: string, updates: Partial<InsertBullet>) {
    // Join through experience to verify ownership
    const [bullet] = await db.select(bulletColumns).from(bullets).where(eq(bullets.id, id));
    if (!bullet) throw new Error("Bullet not found");
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) throw new Error("Access denied");
    const [updated] = await db.update(bullets).set(updates).where(eq(bullets.id, id)).returning();
    return withoutEmbedding(updated);
  }
  async deleteBullet(userId: number, id: string) {
    const [bullet] = await db.select(bulletColumns).from(bullets).where(eq(bullets.id, id));
    if (!bullet) return;
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) return;
    await db.delete(bullets).where(eq(bullets.id, id));
  }
  async getAllBullets(userId: number) {
    return await db.select(bulletColumns).from(bullets)
      .innerJoin(experiences, eq(bullets.experienceId, experiences.id))
      .where(eq(experiences.userId, userId))
      .orderBy(bullets.priority);
  }
  async getBulletEmbeddings(userId: number) {
    const rows = await db.select({ id: bullets.id, key: bullets.embeddingKey, vector: bullets.embedding })
      .from(bullets)
      .innerJoin(experiences, eq(bullets.experienceId, experiences.id))
      .where(and(eq(experiences.userId, userId), isNotNull(bullets.embeddingKey)));
    return new Map(rows.filter(r => r.key && r.vector).map(r => [r.id, { key: r.key!, vector: r.vector! }]));
  }
  async saveBulletEmbeddings(entries: { id: string; key: string; vector: number[] }[]) {
    for (const e of entries) {
      await db.update(bullets).set({ embedding: e.vector, embeddingKey: e.key }).where(eq(bullets.id, e.id));
    }
  }

  // Formulations (variantes)
  async getBulletVariants(userId: number) {
    const rows = await db.select({ v: bulletVariants }).from(bulletVariants)
      .innerJoin(bullets, eq(bulletVariants.bulletId, bullets.id))
      .innerJoin(experiences, eq(bullets.experienceId, experiences.id))
      .where(eq(experiences.userId, userId));
    return rows.map(r => r.v);
  }
  async upsertBulletVariant(userId: number, bulletId: string, v: { angle: string; language: string; text: string; source?: string }) {
    const [owned] = await db.select({ id: bullets.id }).from(bullets)
      .innerJoin(experiences, eq(bullets.experienceId, experiences.id))
      .where(and(eq(bullets.id, bulletId), eq(experiences.userId, userId)));
    if (!owned) return undefined;
    const [row] = await db.insert(bulletVariants)
      .values({ bulletId, angle: v.angle, language: v.language, text: v.text, source: v.source || "user" })
      .onConflictDoUpdate({
        target: [bulletVariants.bulletId, bulletVariants.angle, bulletVariants.language],
        set: { text: v.text, source: v.source || "user", updatedAt: new Date() },
      })
      .returning();
    return row;
  }
  async deleteBulletVariant(userId: number, id: string) {
    const owned = (await this.getBulletVariants(userId)).some(v => v.id === id);
    if (owned) await db.delete(bulletVariants).where(eq(bulletVariants.id, id));
  }
  async getProfileVariants(userId: number) {
    return await db.select().from(profileVariants).where(eq(profileVariants.userId, userId));
  }
  async upsertProfileVariant(userId: number, v: { kind: string; angle: string; language: string; text: string }) {
    const [row] = await db.insert(profileVariants)
      .values({ userId, ...v })
      .onConflictDoUpdate({
        target: [profileVariants.userId, profileVariants.kind, profileVariants.angle, profileVariants.language],
        set: { text: v.text, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
  async deleteProfileVariant(userId: number, id: string) {
    await db.delete(profileVariants).where(and(eq(profileVariants.id, id), eq(profileVariants.userId, userId)));
  }

  // Quota LLM : incrément atomique, refusé si la limite du jour serait dépassée.
  async consumeLlmQuota(userId: number, units: number, dailyLimit: number) {
    if (dailyLimit <= 0) return { allowed: true, used: 0 };
    const { rows } = await pool.query(
      `INSERT INTO llm_usage (user_id, day, calls) VALUES ($1, current_date, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET calls = llm_usage.calls + EXCLUDED.calls
       WHERE llm_usage.calls + EXCLUDED.calls <= $3
       RETURNING calls`,
      [userId, units, dailyLimit],
    );
    if (rows.length === 0 || rows[0].calls > dailyLimit) {
      const cur = await pool.query("SELECT calls FROM llm_usage WHERE user_id = $1 AND day = current_date", [userId]);
      return { allowed: false, used: cur.rows[0]?.calls ?? dailyLimit };
    }
    return { allowed: true, used: rows[0].calls };
  }

  async getLlmUsageToday(userId: number) {
    const { rows } = await pool.query("SELECT calls FROM llm_usage WHERE user_id = $1 AND day = current_date", [userId]);
    return rows[0]?.calls ?? 0;
  }

  // Suppression de compte : toutes les tables suivent par cascade.
  async deleteUser(userId: number) {
    await db.delete(users).where(eq(users.id, userId));
  }

  // Skills
  async getSkills(userId: number) {
    return await db.select().from(skills)
      .where(eq(skills.userId, userId))
      .orderBy(skills.priority);
  }
  async createSkill(userId: number, skill: InsertSkill) {
    const [created] = await db.insert(skills).values({ ...skill, userId }).returning();
    return created;
  }
  async updateSkill(userId: number, id: string, updates: Partial<InsertSkill>) {
    const [updated] = await db.update(skills)
      .set(updates)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)))
      .returning();
    return updated;
  }
  async deleteSkill(userId: number, id: string) {
    await db.delete(skills).where(and(eq(skills.id, id), eq(skills.userId, userId)));
  }

  // Formations
  async getFormations(userId: number) {
    return await db.select().from(formations).where(eq(formations.userId, userId));
  }
  async createFormation(userId: number, f: InsertFormation) {
    const [created] = await db.insert(formations).values({ ...f, userId }).returning();
    return created;
  }
  async deleteFormation(userId: number, id: string) {
    await db.delete(formations).where(and(eq(formations.id, id), eq(formations.userId, userId)));
  }

  // Languages
  async getLanguages(userId: number) {
    return await db.select().from(languages).where(eq(languages.userId, userId));
  }
  async createLanguage(userId: number, l: InsertLanguage) {
    const [created] = await db.insert(languages).values({ ...l, userId }).returning();
    return created;
  }
  async updateLanguage(userId: number, id: string, updates: Partial<InsertLanguage>) {
    const [updated] = await db.update(languages)
      .set(updates)
      .where(and(eq(languages.id, id), eq(languages.userId, userId)))
      .returning();
    return updated;
  }
  async deleteLanguage(userId: number, id: string) {
    await db.delete(languages).where(and(eq(languages.id, id), eq(languages.userId, userId)));
  }

  // Job Posts
  async createJobPost(userId: number, jobPost: InsertJobPost) {
    const [created] = await db.insert(jobPosts).values({ ...jobPost, userId }).returning();
    return created;
  }

  // Runs
  async createRun(userId: number, run: InsertRun) {
    const [created] = await db.insert(runs).values({ ...run, userId }).returning();
    return created;
  }
  async getRun(userId: number, id: string) {
    const [run] = await db.select().from(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, userId)));
    if (!run) return undefined;
    const [jobPost] = await db.select().from(jobPosts).where(eq(jobPosts.id, run.jobPostId));
    return { ...run, jobPost };
  }
  async updateRunOutput(userId: number, id: string, outputCvText: string, outputReportJson?: unknown) {
    const set: Partial<Run> = { outputCvText };
    if (outputReportJson !== undefined) set.outputReportJson = outputReportJson as Run["outputReportJson"];
    const [updated] = await db.update(runs).set(set)
      .where(and(eq(runs.id, id), eq(runs.userId, userId)))
      .returning();
    return updated;
  }
  async getRuns(userId: number): Promise<RunResponse[]> {
    const rows = await db
      .select()
      .from(runs)
      .innerJoin(jobPosts, eq(runs.jobPostId, jobPosts.id))
      .where(eq(runs.userId, userId))
      .orderBy(desc(runs.createdAt))
      .limit(50);
    return rows.map(row => ({ ...row.runs, jobPost: row.job_posts }));
  }
}

export const storage = new DatabaseStorage();
