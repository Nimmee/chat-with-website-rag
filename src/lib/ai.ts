import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Add it to your .env.local file.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// gemini-embedding-001: free-tier embedding model.
// gemini-2.5-flash: free-tier chat model, good quality/speed tradeoff for RAG answers.
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
const CHAT_MODEL = process.env.CHAT_MODEL || "gemini-2.5-flash";

/**
 * Embeds an array of texts. The Gemini API embeds one request at a time per
 * "contents" call reliably returning one vector per input string, but to stay
 * safely within free-tier rate limits we embed sequentially in small batches
 * rather than firing everything in parallel.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getClient();

  const results: number[][] = [];
  const BATCH = 20; // keep individual requests small and well within free-tier TPM limits

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch
    });
    const embeddings = res.embeddings || [];
    for (const e of embeddings) {
      results.push(e.values || []);
    }
    // Small pause between batches to be gentle on free-tier RPM limits.
    if (i + BATCH < texts.length) await new Promise((r) => setTimeout(r, 300));
  }

  return results;
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
  const ai = getClient();

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

  const res = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: question,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2
    }
  });

  return res.text?.trim() || "I couldn't generate a response.";
}
