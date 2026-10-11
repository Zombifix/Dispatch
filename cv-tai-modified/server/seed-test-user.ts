/**
 * Seed script: creates a test user (Chef de projet éditorial / Print profile)
 * Far from UX/Product design — useful for cross-sector rejection testing.
 * Usage: DATABASE_URL=... SEED_PASSWORD=... npx tsx server/seed-test-user.ts
 */

import { pool } from "./db";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`; // matches auth.ts format
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- 1. Create / reset test user ---
    const email = process.env.SEED_EMAIL || "marie.leclerc.test@example.com";
    const password = process.env.SEED_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error("SEED_PASSWORD (12+ caractères) requis : aucun mot de passe n'est stocké dans le dépôt.");
    }
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    let userId: number;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      console.log(`ℹ️  User already exists (id=${userId}), resetting data...`);
      await client.query("DELETE FROM runs WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM job_posts WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM bullets WHERE experience_id IN (SELECT id FROM experiences WHERE user_id = $1)", [userId]);
      await client.query("DELETE FROM experiences WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM skills WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM formations WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM languages WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM profile WHERE user_id = $1", [userId]);
    } else {
      const hash = await hashPassword(password);
      const res = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [email, hash]
      );
      userId = res.rows[0].id;
      console.log(`✅ Test user created: ${email} (id=${userId})`);
    }

    // --- 2. Profile ---
    await client.query(
      `INSERT INTO profile (id, user_id, name, title, summary, target_role)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        userId,
        "Marie Leclerc",
        "Cheffe de projet éditorial – Print & Publication",
        "6 ans d'expérience en gestion de projets éditoriaux dans l'édition et le secteur associatif. Je coordonne la production de catalogues, livres et publications print de A à Z : de la rédaction au BAT, en passant par la relation avec les imprimeurs et les auteurs. Je travaille avec InDesign et maîtrise le cycle complet de fabrication d'un ouvrage.",
        "Cheffe de projet éditoriale",
      ]
    );
    console.log("✅ Profile created");

    // --- 3. Experiences + bullets ---

    // EXP 1 — Hachette Livre (édition, senior)
    const exp1 = await client.query(
      `INSERT INTO experiences (id, user_id, title, company, contract_type, start_date, end_date, description, priority)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        userId,
        "Cheffe de projet éditorial",
        "Hachette Livre",
        "CDI",
        "2021-03-01",
        null,
        "Pilotage de la production éditoriale de la collection Guides de voyage Hachette (environ 30 titres/an). Je coordonne les auteurs, les iconographes, les graphistes PAO et les imprimeurs pour respecter les plannings de parution et les budgets de fabrication.",
        30,
      ]
    );
    const expId1 = exp1.rows[0].id;

    const bullets1 = [
      { text: "Piloté la production de 28 guides de voyage sur l'exercice 2023, avec un taux de parution dans les délais de 93%.", tags: ["Gestion de projet", "Édition", "Planning", "Print"] },
      { text: "Négocié les contrats de fabrication avec 4 imprimeurs partenaires, obtenant une réduction de 11% sur les coûts de tirage pour les réimpressions.", tags: ["Négociation", "Fabrication", "Budget", "Imprimeurs"] },
      { text: "Coordonné les échanges entre 15 auteurs freelance et les équipes internes (iconographie, cartographie, PAO) pour tenir les plannings éditoriaux.", tags: ["Coordination", "Freelance", "Auteurs", "PAO"] },
      { text: "Mis en place un tableau de bord de suivi de production partagé avec les équipes, réduisant les relances hebdomadaires de 40%.", tags: ["Outils", "Process", "Suivi", "Organisation"] },
      { text: "Relu et validé les épreuves de correction sur 12 titres, assurant la conformité éditoriale avant le BAT final.", tags: ["Correction", "BAT", "Qualité", "Relecture"] },
    ];

    for (let i = 0; i < bullets1.length; i++) {
      await client.query(
        `INSERT INTO bullets (id, experience_id, text, priority, tags)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [expId1, bullets1[i].text, (i + 1) * 10, bullets1[i].tags]
      );
    }
    console.log("✅ Exp 1 (Hachette Livre) + bullets created");

    // EXP 2 — Croix-Rouge (com print, secteur asso)
    const exp2 = await client.query(
      `INSERT INTO experiences (id, user_id, title, company, contract_type, start_date, end_date, description, priority)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        userId,
        "Chargée de communication & publications",
        "Croix-Rouge française",
        "CDI",
        "2018-09-01",
        "2021-02-28",
        "Responsable de la production des supports de communication print de la délégation régionale Île-de-France : rapport annuel, plaquettes de présentation, flyers de collecte, affiches de sensibilisation. Rédaction des textes et coordination avec les graphistes prestataires.",
        20,
      ]
    );
    const expId2 = exp2.rows[0].id;

    const bullets2 = [
      { text: "Produit le rapport annuel de la délégation (48 pages, tirage 3 000 ex.) en coordination avec les bénévoles et les équipes nationales.", tags: ["Rapport annuel", "Print", "Coordination", "Publication"] },
      { text: "Rédigé l'intégralité des textes des supports de communication print (plaquettes, affiches, flyers) pour 6 campagnes de collecte annuelles.", tags: ["Rédaction", "Copywriting", "Communication", "Campagne"] },
      { text: "Piloté la refonte de la charte graphique des supports locaux pour les aligner avec la charte nationale, avec un prestataire graphiste.", tags: ["Charte graphique", "Identité visuelle", "Coordination", "Prestataire"] },
      { text: "Organisé la logistique de distribution des 12 000 flyers pour les opérations de collecte dans les gares Île-de-France.", tags: ["Logistique", "Distribution", "Terrain", "Organisation"] },
    ];

    for (let i = 0; i < bullets2.length; i++) {
      await client.query(
        `INSERT INTO bullets (id, experience_id, text, priority, tags)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [expId2, bullets2[i].text, (i + 1) * 10, bullets2[i].tags]
      );
    }
    console.log("✅ Exp 2 (Croix-Rouge) + bullets created");

    // EXP 3 — Bayard Presse (assistante éditoriale, stage/CDD)
    const exp3 = await client.query(
      `INSERT INTO experiences (id, user_id, title, company, contract_type, start_date, end_date, description, priority)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        userId,
        "Assistante de rédaction",
        "Bayard Presse",
        "Stage",
        "2017-09-01",
        "2018-08-31",
        "Stage de fin d'études puis CDD au sein de la rédaction du magazine Pèlerin. Assistance à la rédactrice en chef sur la gestion du planning éditorial, la relecture des articles et la coordination avec les photographes et illustrateurs.",
        10,
      ]
    );
    const expId3 = exp3.rows[0].id;

    const bullets3 = [
      { text: "Assisté la rédactrice en chef sur la planification des 12 numéros annuels du magazine, en gérant le calendrier des remises de textes.", tags: ["Planning", "Rédaction", "Presse", "Coordination"] },
      { text: "Relu et annoté les articles avant mise en page, en appliquant les règles typographiques et les corrections orthographiques.", tags: ["Relecture", "Correction", "Typographie", "Qualité"] },
      { text: "Coordiné les échanges avec 8 photographes pour la livraison des visuels dans les délais des bouclages.", tags: ["Coordination", "Photographes", "Bouclage", "Délais"] },
    ];

    for (let i = 0; i < bullets3.length; i++) {
      await client.query(
        `INSERT INTO bullets (id, experience_id, text, priority, tags)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [expId3, bullets3[i].text, (i + 1) * 10, bullets3[i].tags]
      );
    }
    console.log("✅ Exp 3 (Bayard Presse) + bullets created");

    // --- 4. Skills ---
    const skills = [
      { name: "InDesign", category: "Outils", level: 5, priority: 30 },
      { name: "Photoshop", category: "Outils", level: 3, priority: 20 },
      { name: "Illustrator", category: "Outils", level: 2, priority: 10 },
      { name: "Microsoft Excel", category: "Outils", level: 4, priority: 22 },
      { name: "Suite Office", category: "Outils", level: 4, priority: 20 },
      { name: "Gestion de projet éditorial", category: "Methodologies", level: 5, priority: 30 },
      { name: "PAO", category: "Techniques", level: 4, priority: 25 },
      { name: "Correction d'épreuves", category: "Techniques", level: 5, priority: 28 },
      { name: "Fabrication print", category: "Techniques", level: 4, priority: 25 },
      { name: "Rédaction", category: "Techniques", level: 5, priority: 28 },
      { name: "Coordination prestataires", category: "Methodologies", level: 4, priority: 22 },
      { name: "Communication éditoriale", category: "Domaines", level: 5, priority: 28 },
      { name: "Presse magazine", category: "Domaines", level: 3, priority: 18 },
      { name: "Édition livre", category: "Domaines", level: 5, priority: 30 },
      { name: "Secteur associatif", category: "Domaines", level: 3, priority: 15 },
    ];

    for (const s of skills) {
      await client.query(
        `INSERT INTO skills (id, user_id, name, category, level, priority)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [userId, s.name, s.category, s.level, s.priority]
      );
    }
    console.log("✅ Skills created");

    // --- 5. Formations ---
    const formations = [
      { school: "Université Paris III – Sorbonne Nouvelle", degree: "Master Édition – Librairie & Commerce du livre", year: "2017" },
      { school: "Université Paris IV – Sorbonne", degree: "Licence Lettres Modernes", year: "2015" },
    ];

    for (const f of formations) {
      await client.query(
        `INSERT INTO formations (id, user_id, school, degree, year)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [userId, f.school, f.degree, f.year]
      );
    }
    console.log("✅ Formations created");

    // --- 6. Languages ---
    const languages = [
      { name: "Français", level: "Natif" },
      { name: "Anglais", level: "Professionnel (B2)" },
      { name: "Italien", level: "Notions (A2)" },
    ];

    for (const l of languages) {
      await client.query(
        `INSERT INTO languages (id, user_id, name, level)
         VALUES (gen_random_uuid(), $1, $2, $3)`,
        [userId, l.name, l.level]
      );
    }
    console.log("✅ Languages created");

    await client.query("COMMIT");

    const totalBullets = bullets1.length + bullets2.length + bullets3.length;
    console.log("\n🎉 Test user ready!");
    console.log(`   Email    : ${email}`);
    console.log(`   Profile  : Marie Leclerc — Cheffe de projet éditorial / Print`);
    console.log(`   Data     : 3 expériences, ${totalBullets} bullets, ${skills.length} skills`);
    console.log(`   Use case : Cross-sector (print/édition ≠ UX/Product) — doit scorer bas sur offres design`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
