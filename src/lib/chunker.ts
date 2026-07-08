export interface Chunk {
  text: string;
  url: string;
  title: string;
}

const CHUNK_SIZE = 900; // characters -- roughly 180-220 tokens, small enough for precise retrieval
const CHUNK_OVERLAP = 150; // keeps context from being severed mid-thought at chunk boundaries

/**
 * Splits page text into overlapping chunks, trying to break on paragraph/sentence
 * boundaries rather than mid-sentence, so each chunk reads coherently on its own
 * (important since chunks -- not whole pages -- are what gets embedded and cited).
 */
export function chunkText(text: string, url: string, title: string): Chunk[] {
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n" + para).length > CHUNK_SIZE && current.length > 0) {
      chunks.push({ text: current.trim(), url, title });
      // start next chunk with overlap from the tail of the previous one
      const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP);
      current = current.slice(overlapStart) + "\n" + para;
    } else {
      current = current ? current + "\n" + para : para;
    }

    // paragraph itself longer than CHUNK_SIZE -- hard-split it
    while (current.length > CHUNK_SIZE * 1.5) {
      chunks.push({ text: current.slice(0, CHUNK_SIZE).trim(), url, title });
      current = current.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }

  if (current.trim().length > 0) {
    chunks.push({ text: current.trim(), url, title });
  }

  return chunks;
}
