import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import type { StructuredCV } from "./tailoring-engine";

/**
 * Sorties d'un CV structuré.
 * - toFigmaPayload : format plat lu par le plugin Figma (figma-plugin/).
 * - toJsonResume : interopérabilité (schéma JSON Resume, https://jsonresume.org/schema).
 * - toDocx : version une colonne, polices standard, texte réel : lisible par les ATS,
 *   contrairement à un PDF exporté depuis Figma (texte vectorisé).
 */

export interface FigmaPayload {
  version: 1;
  language: "FR" | "EN";
  name: string;
  title: string;
  summary: string;
  experiences: { title: string; company: string; contractType: string; dates: string; bullets: string[] }[];
  skills: string[];
  formations: { degree: string; school: string; year: string }[];
  languages: { name: string; level: string }[];
  labels: { summary: string; experience: string; skills: string; education: string; languages: string };
}

const LABELS = {
  FR: { summary: "Résumé professionnel", experience: "Expérience professionnelle", skills: "Compétences", education: "Formation", languages: "Langues" },
  EN: { summary: "Professional summary", experience: "Experience", skills: "Skills", education: "Education", languages: "Languages" },
};

export function toFigmaPayload(cv: StructuredCV, language: "FR" | "EN"): FigmaPayload {
  return {
    version: 1,
    language,
    name: cv.name || "",
    title: cv.targetTitle || "",
    summary: cv.summary || "",
    experiences: cv.experiences
      .filter(e => e.bullets.length > 0)
      .map(e => ({ title: e.title, company: e.company, contractType: e.contractType || "", dates: e.dates, bullets: [...e.bullets] })),
    skills: [...cv.skills],
    formations: cv.formations.map(f => ({ degree: f.degree, school: f.school, year: f.year || "" })),
    languages: cv.languages.map(l => ({ name: l.name, level: l.level || "" })),
    labels: LABELS[language],
  };
}

export function toJsonResume(cv: StructuredCV, language: "FR" | "EN") {
  return {
    $schema: "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
    basics: { name: cv.name || "", label: cv.targetTitle || "", summary: cv.summary || "" },
    work: cv.experiences.map(e => ({
      name: e.company,
      position: e.title,
      summary: e.description || undefined,
      highlights: e.bullets,
      // Les dates sont déjà formatées pour l'affichage ; conservées telles quelles.
      dates: e.dates,
    })),
    education: cv.formations.map(f => ({ institution: f.school, studyType: f.degree, endDate: f.year || undefined })),
    skills: cv.skills.map(name => ({ name })),
    languages: cv.languages.map(l => ({ language: l.name, fluency: l.level || undefined })),
    meta: { language, generator: "Dispatch" },
  };
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })],
  });
}

export async function toDocx(cv: StructuredCV, language: "FR" | "EN"): Promise<Buffer> {
  const labels = LABELS[language];
  const children: Paragraph[] = [];
  if (cv.name) children.push(new Paragraph({ children: [new TextRun({ text: cv.name, bold: true, size: 36 })] }));
  if (cv.targetTitle) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: cv.targetTitle, size: 26 })] }));
  if (cv.summary) {
    children.push(heading(labels.summary));
    children.push(new Paragraph({ children: [new TextRun({ text: cv.summary, size: 21 })] }));
  }
  children.push(heading(labels.experience));
  for (const e of cv.experiences) {
    if (e.bullets.length === 0) continue;
    children.push(new Paragraph({
      spacing: { before: 160 },
      children: [
        new TextRun({ text: e.title, bold: true, size: 22 }),
        new TextRun({ text: ` · ${e.company}${e.contractType ? ` (${e.contractType})` : ""}`, size: 22 }),
      ],
    }));
    children.push(new Paragraph({ children: [new TextRun({ text: e.dates, italics: true, size: 20, color: "555555" })] }));
    for (const b of e.bullets) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 21 })] }));
    }
  }
  if (cv.skills.length) {
    children.push(heading(labels.skills));
    children.push(new Paragraph({ children: [new TextRun({ text: cv.skills.join(" · "), size: 21 })] }));
  }
  if (cv.formations.length) {
    children.push(heading(labels.education));
    for (const f of cv.formations) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${f.degree} — ${f.school}${f.year ? ` (${f.year})` : ""}`, size: 21 })] }));
    }
  }
  if (cv.languages.length) {
    children.push(heading(labels.languages));
    children.push(new Paragraph({ children: [new TextRun({ text: cv.languages.map(l => `${l.name}${l.level ? ` (${l.level})` : ""}`).join(" · "), size: 21 })] }));
  }
  const doc = new Document({
    creator: "Dispatch",
    title: [cv.name, cv.targetTitle].filter(Boolean).join(" — ") || "CV",
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: children.length ? children : [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun("")] })],
    }],
  });
  return Packer.toBuffer(doc);
}

export function safeFileName(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join("-")
    .replace(/\(?\b[HF]\s*\/\s*[HF]\b\)?/g, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "cv";
}
