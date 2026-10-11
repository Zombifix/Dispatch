import { describe, it, expect } from "vitest";
import { z } from "zod";
import { completeJson, TtlCache, LlmOutputError } from "../server/llm";
import { hybridScoreAllBullets, parseJobDescription, type EmbeddingStore } from "../server/tailoring-engine";
import { fakeOpenAI } from "./fake-openai";
import { exp, bullet, job } from "./fixtures";

const schema = z.object({ n: z.number() });

describe("completeJson", () => {
  it("redemande une fois quand la réponse ne respecte pas le schéma", async () => {
    let i = 0;
    const { client, calls } = fakeOpenAI(() => (i++ === 0 ? { n: "pas un nombre" } : { n: 3 }));
    const r = await completeJson(client, { model: "m", system: "s", user: "u", schema });
    expect(r).toEqual({ n: 3 });
    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls[1].messages)).toContain("ne respecte pas le format");
  });
  it("échoue explicitement après deux réponses invalides", async () => {
    const { client } = fakeOpenAI(() => "pas du json");
    await expect(completeJson(client, { model: "m", system: "s", user: "u", schema })).rejects.toBeInstanceOf(LlmOutputError);
  });
});

describe("TtlCache", () => {
  it("expire et borne le nombre d'entrées", () => {
    const c = new TtlCache<number>(60_000, 2);
    c.set("a", 1); c.set("b", 2); c.get("a"); c.set("c", 3);
    expect(c.get("b")).toBeUndefined(); // la moins récemment utilisée sort
    expect(c.get("a")).toBe(1);
    const short = new TtlCache<number>(-1, 5);
    short.set("x", 1);
    expect(short.get("x")).toBeUndefined();
  });
});

describe("parseJobDescription", () => {
  it("ne parse qu'une fois la même annonce", async () => {
    const { client, calls } = fakeOpenAI(() => ({ title: "Designer", positioning: "lead", criticalKeywords: ["Figma"] }));
    const text = `Annonce unique ${Math.random()} : Product Designer, Figma, design system.`;
    const a = await parseJobDescription(text, client);
    a.language = "EN"; // une mutation par l'appelant ne doit pas polluer le cache
    const b = await parseJobDescription(text, client);
    expect(calls.length).toBe(1);
    expect(b.positioning).toBe("lead");
    expect(b.language).toBe("EN"); // parsé comme EN par défaut, mais copie indépendante
    expect(b).not.toBe(a);
  });
});

describe("embeddings persistés", () => {
  it("n'embedde que les bullets nouveaux ou modifiés", async () => {
    const vec = (t: string) => Array.from({ length: 8 }, (_, k) => ((t.charCodeAt(k % t.length) || 1) % 7) + 1);
    const { client, calls } = fakeOpenAI(() => ({ scores: [] }), (texts) => texts.map(vec));
    const saved = new Map<string, { key: string; vector: number[] }>();
    const store: EmbeddingStore = {
      load: async () => new Map(saved),
      save: async (entries) => { for (const e of entries) saved.set(e.id, { key: e.key, vector: e.vector }); },
    };
    const e = exp("e1");
    const bs = [bullet("b1", "e1", "Conçoit le design system"), bullet("b2", "e1", "Mène les tests utilisateurs")];
    await hybridScoreAllBullets(job(), [e], bs, client, store);
    const firstInputs = calls.find(c => c.embeddings)!.embeddings.length;
    calls.length = 0;
    bs[1] = bullet("b2", "e1", "Mène 12 tests utilisateurs");
    const scored = await hybridScoreAllBullets(job(), [e], bs, client, store);
    const secondInputs = calls.find(c => c.embeddings)!.embeddings.length;
    expect(saved.size).toBe(2);
    expect(secondInputs).toBe(firstInputs - 1); // b1 réutilisé, b2 recalculé
    expect(scored.every(s => s.embedding)).toBe(true);
  });
});
