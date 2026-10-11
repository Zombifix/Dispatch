import type { Bullet, Experience } from "@shared/schema";
import type { ParsedJob } from "../server/tailoring-engine";

export function exp(id: string, over: Partial<Experience> = {}): Experience {
  return {
    id, userId: 1, title: "Product Designer", company: `Co-${id}`, contractType: null,
    startDate: "2021-01-01", endDate: null, description: "", priority: 0, createdAt: new Date(),
    ...over,
  };
}

export function bullet(id: string, experienceId: string, text: string, tags: string[] = []): Bullet {
  return { id, experienceId, text, tags, priority: 0, createdAt: new Date() };
}

export function job(over: Partial<ParsedJob> = {}): ParsedJob {
  return {
    title: "Senior Product Designer", company: "Acme", seniority: "senior", domain: "SaaS B2B",
    requiredSkills: ["Figma", "Design System"], preferredSkills: ["User Research"],
    responsibilities: ["Concevoir les parcours", "Faire évoluer le design system"],
    keywords: ["Figma", "Design System", "Prototyping"], criticalKeywords: ["Figma", "Design System", "User Research"],
    language: "FR", intentions: ["structurer les pratiques design"], positioning: "ic",
    roleFrame: { workObjects: ["design system"], deliverables: ["maquettes"], decisions: [], collaborators: [], environments: [], scopeSignals: [] },
    productMaturity: "live_product", complexityLevel: "complex_system", ownershipLevel: "owner",
    ...over,
  };
}
