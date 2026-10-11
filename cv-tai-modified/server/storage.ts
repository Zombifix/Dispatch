import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
import {
  profile, experiences, bullets, skills, formations, languages, jobPosts, runs,
  type Profile, type InsertProfile,
  type Experience, type InsertExperience,
  type Bullet, type InsertBullet,
  type Skill, type InsertSkill,
  type Formation, type InsertFormation,
  type Language, type InsertLanguage,
  type JobPost, type InsertJobPost,
  type Run, type InsertRun,
  type RunResponse
} from "@shared/schema";

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
  getBulletsByExperience(userId: number, expId: string): Promise<Bullet[]>;
  createBullet(userId: number, bullet: InsertBullet): Promise<Bullet>;
  updateBullet(userId: number, id: string, updates: Partial<InsertBullet>): Promise<Bullet>;
  deleteBullet(userId: number, id: string): Promise<void>;
  updateBulletEmbedding(id: string, embedding: number[]): Promise<void>;
  getAllBullets(userId: number): Promise<Bullet[]>;

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
  mergeJobPostExtracted(userId: number, jobPostId: string, patch: Record<string, unknown>): Promise<void>;

  // Runs
  createRun(userId: number, run: InsertRun): Promise<Run>;
  getRun(userId: number, id: string): Promise<RunResponse | undefined>;
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
    return await db.select().from(bullets)
      .where(eq(bullets.experienceId, expId))
      .orderBy(bullets.priority);
  }
  async createBullet(userId: number, bullet: InsertBullet) {
    // Verify the parent experience belongs to the user
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) throw new Error("Experience not found or access denied");
    const [created] = await db.insert(bullets).values(bullet).returning();
    return created;
  }
  async updateBullet(userId: number, id: string, updates: Partial<InsertBullet>) {
    // Join through experience to verify ownership
    const [bullet] = await db.select().from(bullets).where(eq(bullets.id, id));
    if (!bullet) throw new Error("Bullet not found");
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) throw new Error("Access denied");
    const [updated] = await db.update(bullets).set(updates).where(eq(bullets.id, id)).returning();
    return updated;
  }
  async deleteBullet(userId: number, id: string) {
    const [bullet] = await db.select().from(bullets).where(eq(bullets.id, id));
    if (!bullet) return;
    const exp = await this.getExperience(userId, bullet.experienceId);
    if (!exp) return;
    await db.delete(bullets).where(eq(bullets.id, id));
  }
  async updateBulletEmbedding(id: string, embedding: number[]) {
    // pgvector not available — embedding disabled
    return;
  }
  async getAllBullets(userId: number) {
    // Get all bullets for this user's experiences via join
    const userExps = await this.getExperiences(userId);
    if (userExps.length === 0) return [];
    const expIds = userExps.map(e => e.id);
    const allBullets = await db.select().from(bullets);
    return allBullets.filter(b => expIds.includes(b.experienceId));
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
  async mergeJobPostExtracted(userId: number, jobPostId: string, patch: Record<string, unknown>) {
    const [current] = await db.select().from(jobPosts).where(and(eq(jobPosts.id, jobPostId), eq(jobPosts.userId, userId)));
    if (!current) return;
    const extracted = (current.extractedJson && typeof current.extractedJson === "object" ? current.extractedJson : {}) as Record<string, unknown>;
    await db.update(jobPosts).set({ extractedJson: { ...extracted, ...patch } }).where(eq(jobPosts.id, jobPostId));
  }
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
