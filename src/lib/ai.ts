import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it to your .env.local file.");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

/** Embeds an array of texts in a single batched API call. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getClient();
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts
  });
  return res.data.map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

export interface RetrievedChunk {
  text: string;
  url: string;
  title: string;
  score: number;
}

/**
 * Answers a question using ONLY the retrieved chunks as context.
 * The system prompt explicitly forbids using outside knowledge, which is what
 * keeps answers "grounded" -- if the context doesn't contain the answer, the
 * model is instructed to say so rather than fall back on its own training data.
 */
export async function answerFromContext(question: string, chunks: RetrievedChunk[]): Promise<string> {
  const openai = getClient();

  const context = chunks
    .map((c, i) => `[Source ${i + 1}] (${c.url})\n${c.text}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are a helpful assistant that answers questions using ONLY the provided website excerpts below.

Rules:
- Only use information found in the "Context" section. Do not use outside knowledge.
- If the context does not contain enough information to answer, say clearly: "The site doesn't appear to cover that." Do not guess or invent an answer.
- When you use information from a source, cite it inline using its bracket number, e.g. [Source 1].
- Be concise and direct.

Context:
${context || "(no relevant content was retrieved)"}`;

  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ]
  });

  return res.choices[0]?.message?.content?.trim() || "I couldn't generate a response.";
}
