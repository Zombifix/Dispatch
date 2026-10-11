import type OpenAI from "openai";

/** Faux client OpenAI : renvoie des réponses JSON prédéfinies, enregistre les appels. */
export function fakeOpenAI(responder: (messages: any[]) => unknown, embed?: (texts: string[]) => number[][]) {
  const calls: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (req: any) => {
          calls.push(req);
          const content = responder(req.messages);
          return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] };
        },
      },
    },
    embeddings: {
      create: async (req: any) => {
        if (!embed) throw new Error("pas d'embeddings dans ce test");
        calls.push({ embeddings: req.input });
        return { data: embed(req.input).map((embedding, index) => ({ embedding, index })) };
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}
