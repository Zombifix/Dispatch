import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Test d'intégration de la couche stockage (TEST_DATABASE_URL requis).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("storage", () => {
  let storage: typeof import("../server/storage").storage;
  let pool: typeof import("../server/db").pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ pool } = await import("../server/db"));
    ({ storage } = await import("../server/storage"));
    const { runMigrations } = await import("../server/migrate");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
    await runMigrations(pool);
    await pool.query("INSERT INTO users (email, password_hash) VALUES ('a@x.fr','s:h'), ('b@x.fr','s:h')");
  });
  afterAll(async () => { await pool?.end(); });

  it("isole les formulations par utilisateur et n'expose pas les embeddings", async () => {
    const exp = await storage.createExperience(1, { title: "PD", company: "Acme" });
    const b = await storage.createBullet(1, { experienceId: exp.id, text: "Conçoit le design system Figma de 4 équipes", tags: [] });
    expect(Object.keys(b)).not.toContain("embedding");

    const v = await storage.upsertBulletVariant(1, b.id, { angle: "lead", language: "FR", text: "Structure le design system Figma de 4 équipes" });
    expect(v?.text).toContain("Structure");
    const again = await storage.upsertBulletVariant(1, b.id, { angle: "lead", language: "FR", text: "Version corrigée du design system Figma de 4 équipes" });
    expect(again?.id).toBe(v?.id); // mise à jour, pas de doublon

    expect(await storage.upsertBulletVariant(2, b.id, { angle: "ic", language: "FR", text: "Intrusion" })).toBeUndefined();
    expect((await storage.getBulletVariants(2)).length).toBe(0);
    await storage.deleteBulletVariant(2, v!.id);
    expect((await storage.getBulletVariants(1)).length).toBe(1);

    await storage.saveBulletEmbeddings([{ id: b.id, key: "k1", vector: [0.1, 0.2] }]);
    const emb = await storage.getBulletEmbeddings(1);
    expect(emb.get(b.id)?.key).toBe("k1");
    expect((await storage.getBulletEmbeddings(2)).size).toBe(0);

    await storage.deleteExperience(1, exp.id);
    expect((await storage.getBulletVariants(1)).length).toBe(0); // cascade
  });

  it("gère les titres et résumés par angle", async () => {
    await storage.upsertProfileVariant(1, { kind: "title", angle: "lead", language: "FR", text: "Lead Product Designer" });
    await storage.upsertProfileVariant(1, { kind: "title", angle: "lead", language: "FR", text: "Lead Designer" });
    const rows = await storage.getProfileVariants(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Lead Designer");
    await storage.deleteProfileVariant(2, rows[0].id);
    expect(await storage.getProfileVariants(1)).toHaveLength(1);
  });
});
