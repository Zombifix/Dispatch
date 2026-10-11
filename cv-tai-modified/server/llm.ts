import crypto from "crypto";
import OpenAI from "openai";
import type { ZodType } from "zod";

/**
 * Point d'accès unique aux modèles de langage.
 *
 * Fournisseur : toute API compatible OpenAI (OpenAI, Mistral, Scaleway, OVH...).
 *   OPENAI_API_KEY (ou LLM_API_KEY) + LLM_BASE_URL optionnelle.
 * Modèles : LLM_MODEL (tâches courtes), WRITER_MODEL (retouches, résumé),
 *   EVAL_MODEL (évaluateur), EMBEDDING_MODEL.
 */
export const LLM_MODELS = {
  fast: process.env.LLM_MODEL || "gpt-4o-mini",
  writer: process.env.WRITER_MODEL || process.env.LLM_MODEL || "gpt-4o",
  eval: process.env.EVAL_MODEL || process.env.LLM_MODEL || "gpt-4o",
  embedding: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
};

export function createLlmClient(): OpenAI | null {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL || undefined,
    timeout: 90_000,
    maxRetries: 2,
  });
}

export class LlmOutputError extends Error {}

/**
 * Appel qui doit renvoyer un objet JSON conforme à `schema`.
 * Une réponse non conforme est redemandée une fois avec l'erreur de validation,
 * puis rejetée : l'appelant décide du repli (jamais de valeur inventée en silence).
 */
export async function completeJson<T>(
  openai: OpenAI,
  params: {
    model: string;
    schema: ZodType<T, any, any>;
    temperature?: number;
  } & ({ system: string; user: string } | { messages: OpenAI.Chat.ChatCompletionMessageParam[] }),
): Promise<T> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = "messages" in params
    ? [...params.messages]
    : [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `Ta réponse précédente ne respecte pas le format attendu (${lastError}). Renvoie uniquement l'objet JSON corrigé.`,
      });
    }
    const res = await openai.chat.completions.create({
      model: params.model,
      temperature: params.temperature ?? 0,
      response_format: { type: "json_object" },
      messages,
    });
    const content = res.choices[0]?.message?.content || "";
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      lastError = "JSON invalide";
      messages.push({ role: "assistant", content });
      continue;
    }
    const parsed = params.schema.safeParse(json);
    if (parsed.success) return parsed.data;
    lastError = parsed.error.issues.slice(0, 3).map(i => `${i.path.join(".") || "racine"}: ${i.message}`).join("; ");
    messages.push({ role: "assistant", content });
  }
  throw new LlmOutputError(`Sortie LLM non conforme : ${lastError}`);
}

// ─── Cache mémoire à durée limitée ──────────────────────────────────────────
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  constructor(private ttlMs: number, private maxEntries: number) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // LRU : l'entrée lue redevient la plus récente
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export function contentHash(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
