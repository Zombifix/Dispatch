import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";
import { toFigmaPayload } from "../server/exports";

// Faux Figma minimal : arbre de calques, polices, clone/insertChild.
const MIXED = Symbol("mixed");
let loadedFonts: string[] = [];
type FakeNode = {
  name: string; type: string; visible: boolean; parent?: FakeNode; children?: FakeNode[];
  characters?: string; fontName?: any; hasMissingFont?: boolean;
  clone(): FakeNode; insertChild?(i: number, n: FakeNode): void; findAll?(p: (n: FakeNode) => boolean): FakeNode[];
  getStyledTextSegments?(f: string[]): { fontName: any }[];
};
function text(name: string, font: any = { family: "Inter", style: "Regular" }): FakeNode {
  return {
    name, type: "TEXT", visible: true, characters: "", fontName: font,
    clone() { return text(this.name, this.fontName); },
    getStyledTextSegments: () => [{ fontName: { family: "Inter", style: "Bold" } }, { fontName: { family: "Inter", style: "Regular" } }],
  };
}
function frame(name: string, children: FakeNode[]): FakeNode {
  const node: FakeNode = {
    name, type: "FRAME", visible: true, children: [],
    clone() { return frame(this.name, this.children!.map(c => c.clone())); },
    insertChild(i, n) { n.parent = node; node.children!.splice(i, 0, n); },
    findAll(p) { const out: FakeNode[] = []; const walk = (n: FakeNode) => { for (const c of n.children || []) { if (p(c)) out.push(c); walk(c); } }; walk(node); return out; },
  };
  for (const c of children) node.insertChild!(node.children!.length, c);
  return node;
}

let fillTemplate: (payload: unknown, roots: FakeNode[]) => Promise<{ filled: number; missing: string[]; notes: string[] }>;

beforeAll(() => {
  const code = fs.readFileSync(path.join(import.meta.dirname, "..", "figma-plugin", "code.js"), "utf8");
  const hook: any = {};
  const context = vm.createContext({
    __DISPATCH_TEST__: hook,
    figma: { mixed: MIXED, loadFontAsync: async (f: any) => { loadedFonts.push(`${f.family}/${f.style}`); } },
    console,
  });
  (context as any).globalThis = context;
  vm.runInContext(code, context);
  fillTemplate = hook.fillTemplate;
});

const PAYLOAD = toFigmaPayload({
  name: "Alex Martin", targetTitle: "Lead Product Designer", summary: "Je structure les pratiques design.",
  experiences: [
    { title: "Product Designer", company: "Acme", dates: "mars 2021 - Aujourd'hui", bullets: ["Conçoit le design system", "Mène 20 entretiens"] },
    { title: "UX Designer", company: "Beta", dates: "janv. 2017 - févr. 2021", bullets: ["Anime des ateliers"] },
    { title: "Stagiaire", company: "Gamma", dates: "2016", bullets: [] },
  ],
  skills: ["Figma", "Prototypage"], formations: [{ degree: "Master design", school: "Strate", year: "2016" }], languages: [{ name: "Anglais", level: "C1" }],
}, "FR");

describe("plugin Figma", () => {
  it("remplit les champs simples, duplique expériences et bullets, charge les polices", async () => {
    loadedFonts = [];
    const bulletTpl = frame("#bullet", [text("#bullet.text")]);
    const exp = frame("#exp", [text("#exp.title"), text("#exp.company"), text("#exp.dates"), frame("Liste", [bulletTpl])]);
    const page = frame("Page", [text("#name"), text("#title", MIXED), text("#summary"), text("#skills"), text("#label.experience"), frame("Colonne", [exp])]);
    const report = await fillTemplate(PAYLOAD, [page]);

    const byName = (n: string) => page.findAll!(x => x.name === n);
    expect(byName("#name")[0].characters).toBe("Alex Martin");
    expect(byName("#title")[0].characters).toBe("Lead Product Designer");
    expect(byName("#skills")[0].characters).toBe("Figma · Prototypage");
    expect(byName("#label.experience")[0].characters).toBe("Expérience professionnelle");
    const exps = byName("#exp");
    expect(exps).toHaveLength(2); // l'expérience sans bullet n'est pas exportée
    expect(exps.map(e => e.findAll!(x => x.name === "#exp.company")[0].characters)).toEqual(["Acme", "Beta"]);
    expect(exps[0].findAll!(x => x.name === "#bullet.text").map(n => n.characters)).toEqual(["Conçoit le design system", "Mène 20 entretiens"]);
    expect(exps[1].findAll!(x => x.name === "#bullet.text").map(n => n.characters)).toEqual(["Anime des ateliers"]);
    expect(loadedFonts).toContain("Inter/Bold"); // police mixte : chaque segment est chargé
    expect(report.missing).toEqual([]);
  });

  it("accepte un seul texte de bullets et signale les calques manquants", async () => {
    const exp = frame("#exp", [text("#exp.title"), text("#exp.bullets")]);
    const page = frame("Page", [text("#name"), exp]);
    const report = await fillTemplate(PAYLOAD, [page]);
    expect(page.findAll!(x => x.name === "#exp.bullets")[0].characters).toBe("• Conçoit le design system\n• Mène 20 entretiens");
    expect(report.missing).toEqual(expect.arrayContaining(["#title", "#summary", "#exp.company", "#exp.dates"]));
  });

  it("refuse un JSON qui ne vient pas de Dispatch", async () => {
    await expect(fillTemplate({ foo: 1 }, [frame("Page", [])])).rejects.toThrow(/Format inconnu/);
  });
});
