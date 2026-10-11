import type OpenAI from "openai";
import type { Angle, Bullet, BulletVariant, CvLanguage, Experience, ProfileVariant, Skill } from "@shared/schema";
import { ANGLES } from "@shared/schema";
import {
  allocateCharBudget, applySemanticScores, deterministicScore, formatExperienceDate, inferDimension,
  normalizeSkillKey, parseJobDescription, renderCV, sanitizeStructuredCV, selectBullets,
  type EmbeddingStore, type ParsedJob, type ScoredBullet, type StructuredCV,
} from "./tailoring-engine";
import { dedupeKeywords, detectLanguage, extractAliasConceptsFromText, normalizeEvidenceText, textHasKeyword, uniqueItems } from "./engine/text";
import { pickVariantText } from "./engine/variants";
import { lintCv, type LintIssue } from "./cv-lint";

/**
 * Assemblage déterministe : le CV est composé uniquement de textes écrits ou
 * validés par l'utilisateur. Le seul appel IA possible est la lecture de l'offre
 * (mise en cache) ; sans clé IA, une lecture déterministe prend le relais.
 * Deux exécutions sur la même offre donnent le même CV.
 */

export interface AssemblyInput {
  jobText: string;
  experiences: Experience[];
  bullets: Bullet[];
  bulletVariants: BulletVariant[];
  profileVariants: ProfileVariant[];
  skills: Skill[];
  profile?: { name?: string | null; title?: string | null; summary?: string | null };
  formations?: { degree: string; school: string; year?: string | null }[];
  languages?: { name: string; level?: string | null }[];
  bodyMaxChars?: number;
  angle?: Angle;
  language?: CvLanguage;
  embeddingStore?: EmbeddingStore;
}

export interface AssembledBullet {
  experienceIndex: number;
  bulletIndex: number;
  factId: string;
  text: string;
  variant: Angle | "base";
  reasons: string[];
}

export interface AssemblyDetails {
  angle: Angle;
  angleSource: "offre" | "choix";
  language: CvLanguage;
  languageSource: "offre" | "bibliotheque" | "choix";
  jobReading: "llm" | "deterministe";
  coverage: { covered: string[]; missing: string[]; percent: number };
  bullets: AssembledBullet[];
  missingVariants: { factId: string; text: string; wanted: string }[];
  missingProfile: ("title" | "summary")[];
  droppedForLanguage: number;
  lint: LintIssue[];
}

export interface AssemblyResult {
  cv: StructuredCV;
  cvText: string;
  parsedJob: ParsedJob;
  details: AssemblyDetails;
  selectedExperienceIds: string[];
  selectedBulletIds: string[];
}

// ─── Lecture d'offre sans IA ────────────────────────────────────────────────
const POSITIONING_PATTERNS: [Angle, RegExp][] = [
  ["manager", /\b(manager d'?équipe|people manager|management d'?équipe|encadrement|engineering manager|design manager|head of)\b/i],
  ["lead", /\b(lead|principal|staff|référent|referent|leader)\b/i],
  ["consultant", /\b(consultant|conseil|accompagnement|cabinet|mission chez|client final)\b/i],
];

/** Lecture minimale de l'offre quand aucun modèle n'est disponible. */
export function parseJobDeterministic(jobText: string, vocabulary: string[]): ParsedJob {
  const text = jobText.slice(0, 8000);
  const firstLine = text.split("\n").map(l => l.trim()).find(l => l.length > 3) || "";
  const language = detectLanguage([text]);
  // Exigences = vocabulaire de l'utilisateur (tags, compétences) et concepts connus présents dans l'offre.
  const fromVocabulary = uniqueItems(vocabulary).filter(v => v.length >= 3 && textHasKeyword(text, v));
  const concepts = extractAliasConceptsFromText([text], language);
  const criticalKeywords = dedupeKeywords([...concepts, ...fromVocabulary]).slice(0, 10);
  const positioning = POSITIONING_PATTERNS.find(([, re]) => re.test(text))?.[0] || "ic";
  return {
    title: firstLine.slice(0, 120), company: "", seniority: /\b(senior|confirm)/i.test(text) ? "senior" : "mid", domain: "",
    requiredSkills: criticalKeywords, preferredSkills: [], responsibilities: [],
    keywords: criticalKeywords, criticalKeywords, language, intentions: [], positioning,
    roleFrame: { workObjects: [], deliverables: [], decisions: [], collaborators: [], environments: [], scopeSignals: [] },
    productMaturity: "unknown", complexityLevel: "unknown", ownershipLevel: "unknown",
  };
}

function reasonsFor(sb: ScoredBullet, job: ParsedJob, variant: Angle | "base", exact: boolean): string[] {
  const reasons: string[] = [];
  const critical = sb.matchedKeywords.filter(k => job.criticalKeywords.some(c => normalizeEvidenceText(c) === normalizeEvidenceText(k)));
  if (critical.length) reasons.push(`couvre ${critical.slice(0, 3).join(", ")}`);
  else if (sb.matchedKeywords.length) reasons.push(`mots de l'offre : ${sb.matchedKeywords.slice(0, 3).join(", ")}`);
  if (sb.semanticScore >= 18) reasons.push("proche des missions de l'offre");
  if (/\d/.test(sb.bullet.text)) reasons.push("preuve chiffrée");
  if (variant !== "base" && exact) reasons.push(`formulation « ${variant} »`);
  if (!reasons.length) reasons.push("expérience pertinente pour la chronologie");
  return reasons;
}

export async function assembleCv(input: AssemblyInput, openai: OpenAI | null): Promise<AssemblyResult> {
  const vocabulary = uniqueItems([
    ...input.skills.map(s => s.name),
    ...input.bullets.flatMap(b => b.tags || []),
  ]);

  // 1. Lecture de l'offre
  let job: ParsedJob;
  let jobReading: AssemblyDetails["jobReading"] = "deterministe";
  if (openai) {
    try {
      job = await parseJobDescription(input.jobText, openai);
      jobReading = "llm";
    } catch {
      job = parseJobDeterministic(input.jobText, vocabulary);
    }
  } else {
    job = parseJobDeterministic(input.jobText, vocabulary);
  }
  const jobLanguage = job.language;

  // 2. Angle et langue
  const angle: Angle = input.angle || ((ANGLES as readonly string[]).includes(job.positioning) ? job.positioning as Angle : "ic");
  const libraryLanguage = detectLanguage(input.bullets.map(b => b.text));
  const variantsByFact = new Map<string, BulletVariant[]>();
  for (const v of input.bulletVariants) variantsByFact.set(v.bulletId, [...(variantsByFact.get(v.bulletId) || []), v]);
  const availableIn = (lang: CvLanguage) => input.bullets.filter(b =>
    libraryLanguage === lang || (variantsByFact.get(b.id) || []).some(v => v.language === lang)).length;
  let language: CvLanguage;
  let languageSource: AssemblyDetails["languageSource"];
  if (input.language) { language = input.language; languageSource = "choix"; }
  else if (input.bullets.length > 0 && availableIn(jobLanguage) / input.bullets.length >= 0.6) { language = jobLanguage; languageSource = "offre"; }
  else { language = libraryLanguage; languageSource = "bibliotheque"; }
  job.language = language;

  // 3. Texte de chaque fait pour cet angle et cette langue
  const expMap = new Map(input.experiences.map(e => [e.id, e]));
  const chosen = new Map<string, { text: string; variant: Angle | "base"; exact: boolean }>();
  let droppedForLanguage = 0;
  for (const b of input.bullets) {
    const pick = pickVariantText(b.text, libraryLanguage, variantsByFact.get(b.id) || [], angle, language);
    if (pick) chosen.set(b.id, { text: pick.text, variant: pick.angle, exact: pick.exact }); else droppedForLanguage++;
  }

  // 4. Score déterministe (+ sémantique si embeddings disponibles), sans LLM
  const allKw = [...job.keywords, ...job.requiredSkills, ...job.preferredSkills];
  const scored: ScoredBullet[] = [];
  for (const b of input.bullets) {
    const exp = expMap.get(b.experienceId);
    const pick = chosen.get(b.id);
    if (!exp || !pick) continue;
    // Le score lit le fait sous toutes ses formulations : un fait écrit en
    // français reste reconnu pour une offre en anglais s'il a une variante EN.
    const allTexts = uniqueItems([pick.text, b.text, ...(variantsByFact.get(b.id) || []).map(v => v.text)]).join(" ");
    const det = deterministicScore({ ...b, text: allTexts }, exp, allKw, job.criticalKeywords, job.intentions);
    scored.push({
      bullet: { ...b, text: pick.text }, experience: exp,
      deterministicScore: det.score, llmScore: 0, semanticScore: 0, totalScore: det.score,
      matchedTags: det.matchedTags, matchedKeywords: det.matchedKeywords,
      dimension: inferDimension((b.tags || []).filter(Boolean)),
    });
  }
  if (openai) await applySemanticScores(scored, job, openai, input.embeddingStore);
  scored.sort((a, b) => b.totalScore - a.totalScore || a.bullet.id.localeCompare(b.bullet.id));

  // 5. Budget et sélection (règles existantes, ordre chronologique inverse)
  const allocs = allocateCharBudget(input.experiences, scored, input.bodyMaxChars || 3500);
  const selected = selectBullets(scored, allocs, job, { strategy: "faithful" });

  // 6. Titre, résumé, compétences : uniquement des textes de l'utilisateur
  const profileVariant = (kind: "title" | "summary") =>
    input.profileVariants.find(v => v.kind === kind && v.angle === angle && v.language === language)
    || input.profileVariants.find(v => v.kind === kind && v.angle === "ic" && v.language === language);
  const profileLanguage = detectLanguage([input.profile?.summary || "", input.profile?.title || ""].filter(Boolean).length ? [input.profile?.summary || input.profile?.title || ""] : input.bullets.map(b => b.text));
  const missingProfile: ("title" | "summary")[] = [];
  const title = profileVariant("title")?.text
    || (input.profile?.title && profileLanguage === language ? input.profile.title : "")
    || selected.find(se => se.selectedBullets.length > 0)?.experience.title || "";
  if (!profileVariant("title")) missingProfile.push("title");
  const summary = profileVariant("summary")?.text
    || (input.profile?.summary && profileLanguage === language ? input.profile.summary : "");
  if (!profileVariant("summary")) missingProfile.push("summary");

  const keywordsLow = [...allKw, ...job.criticalKeywords].map(k => k.toLowerCase());
  const selectedTags = selected.flatMap(se => se.selectedBullets.flatMap(sb => sb.bullet.tags || [])).map(t => t.toLowerCase());
  const relevance = (s: Skill) => {
    const n = s.name.toLowerCase();
    return (keywordsLow.some(k => k.includes(n) || n.includes(k)) ? 2 : 0) + (selectedTags.some(t => t.includes(n) || n.includes(t)) ? 1 : 0);
  };
  const seenSkills = new Set<string>();
  const skills = [...input.skills]
    .sort((a, b) => relevance(b) - relevance(a) || (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name))
    .filter(s => { const k = normalizeSkillKey(s.name); if (seenSkills.has(k)) return false; seenSkills.add(k); return true; })
    .slice(0, 12)
    .map(s => s.name);

  const cv: StructuredCV = sanitizeStructuredCV({
    name: input.profile?.name || undefined,
    targetTitle: title,
    summary,
    summarySource: "profile",
    experiences: selected.map(se => ({
      title: se.experience.title,
      company: se.experience.company,
      contractType: se.experience.contractType || undefined,
      dates: `${formatExperienceDate(se.experience.startDate, language)} - ${formatExperienceDate(se.experience.endDate, language)}`,
      bullets: se.selectedBullets.map(sb => sb.bullet.text),
      description: se.experience.description || undefined,
    })),
    skills,
    formations: (input.formations || []).map(f => ({ degree: f.degree, school: f.school, year: f.year || undefined })),
    languages: (input.languages || []).map(l => ({ name: l.name, level: l.level || undefined })),
    rewrites: [],
  });

  // 7. Raisons, formulations manquantes, couverture, linter
  const bullets: AssembledBullet[] = [];
  const missingVariants: AssemblyDetails["missingVariants"] = [];
  selected.forEach((se, ei) => se.selectedBullets.forEach((sb, bi) => {
    const pick = chosen.get(sb.bullet.id)!;
    bullets.push({ experienceIndex: ei, bulletIndex: bi, factId: sb.bullet.id, text: sb.bullet.text, variant: pick.variant, reasons: reasonsFor(sb, job, pick.variant, pick.exact) });
    if (!pick.exact && angle !== "ic") missingVariants.push({ factId: sb.bullet.id, text: sb.bullet.text, wanted: `${angle}/${language}` });
  }));
  const finalText = [cv.targetTitle, cv.summary, ...cv.experiences.flatMap(e => e.bullets), cv.skills.join(" ")].join(" ");
  const covered = job.criticalKeywords.filter(k => textHasKeyword(finalText, k));
  const missing = job.criticalKeywords.filter(k => !covered.includes(k));
  const percent = job.criticalKeywords.length ? Math.round(covered.length / job.criticalKeywords.length * 100) : 0;

  return {
    cv,
    cvText: renderCV(cv, language),
    parsedJob: { ...job, language: jobLanguage },
    details: {
      angle, angleSource: input.angle ? "choix" : "offre",
      language, languageSource, jobReading,
      coverage: { covered, missing, percent },
      bullets, missingVariants: missingVariants.slice(0, 8), missingProfile, droppedForLanguage,
      lint: lintCv(cv, language),
    },
    selectedExperienceIds: selected.filter(se => se.selectedBullets.length > 0).map(se => se.experience.id),
    selectedBulletIds: selected.flatMap(se => se.selectedBullets.map(sb => sb.bullet.id)),
  };
}

/** Rapport stocké avec le run, compatible avec l'historique et la page résultat. */
export function buildAssemblyReport(result: AssemblyResult) {
  const { parsedJob: job, details, cv } = result;
  const totalBullets = details.bullets.length;
  return {
    mode: "assembly" as const,
    assembly: details,
    structuredCV: cv,
    rewrites: [],
    cvLanguage: details.language,
    jobLanguage: job.language,
    jobTitle: job.title,
    jobCompany: job.company,
    jobSeniority: job.seniority,
    jobDomain: job.domain,
    positioning: details.angle,
    intentions: job.intentions,
    detectedLanguage: job.language,
    detectedKeywords: {
      requiredSkills: job.requiredSkills, preferredSkills: job.preferredSkills,
      responsibilities: job.responsibilities, keywords: job.keywords, criticalKeywords: job.criticalKeywords,
    },
    confidence: details.coverage.percent,
    confidenceReasoning: `${details.coverage.covered.length} exigence(s) sur ${job.criticalKeywords.length} couvertes par tes propres formulations.`,
    postRules: {
      keywordsCovered: details.coverage.covered, keywordsMissing: details.coverage.missing,
      evidenceKeywordsCovered: details.coverage.covered, evidenceKeywordsMissing: details.coverage.missing,
      injectedKeywords: [], longBullets: 0,
      bulletsWithNumbers: details.bullets.filter(b => /\d/.test(b.text)).length,
      totalBullets, rulesApplied: [],
    },
    matchedSkills: cv.skills.filter(s => job.criticalKeywords.some(k => textHasKeyword(s, k))),
    missingSkills: details.coverage.missing,
    selectedExperiences: cv.experiences.map(e => ({
      title: e.title, company: e.company, score: 0, reason: "", matchedAspects: [], bulletCount: e.bullets.length, charBudget: 0,
    })),
    selectedBullets: details.bullets.map(b => ({
      text: b.text, experienceTitle: cv.experiences[b.experienceIndex]?.title || "", score: 0, deterministicScore: 0, llmScore: 0,
      matchedKeywords: [], dimension: "",
    })),
    tips: [
      ...(details.languageSource === "bibliotheque" && job.language !== details.language
        ? [`L'offre est en ${job.language === "EN" ? "anglais" : "français"} : ajoute des formulations ${job.language} à tes faits pour candidater dans la langue de l'offre.`]
        : []),
      ...(details.missingProfile.includes("summary") ? [`Pas de résumé « ${details.angle} » en ${details.language} : écris-en un dans la bibliothèque.`] : []),
      ...(details.missingVariants.length ? [`${details.missingVariants.length} fait(s) retenu(s) n'ont pas encore de formulation « ${details.angle} ».`] : []),
    ],
    fallbackUsed: totalBullets === 0,
  };
}
