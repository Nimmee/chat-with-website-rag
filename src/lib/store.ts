import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface StoredChunk {
  id: string;
  url: string;
  title: string;
  text: string;
  embedding: number[];
}

export interface SiteData {
  siteId: string;
  seedUrl: string;
  domain: string;
  crawledAt: string;
  pageCount: number;
  chunks: StoredChunk[];
}

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function siteIdFor(seedUrl: string): string {
  const domain = new URL(seedUrl).hostname;
  return crypto.createHash("sha1").update(domain).digest("hex").slice(0, 12);
}

function filePathFor(siteId: string) {
  return path.join(DATA_DIR, `${siteId}.json`);
}

/**
 * We use a JSON-file-backed store instead of a real vector database.
 * Rationale (see README): this is a single-site, small-scale demo -- likely a
 * few hundred chunks at most. Brute-force cosine similarity over that many
 * vectors is well under 50ms, so a dedicated vector DB (pgvector, Pinecone,
 * etc.) would add infra complexity without a measurable benefit here. This
 * would NOT be the right choice at real scale (many sites / millions of chunks).
 */
export function saveSite(data: SiteData) {
  ensureDataDir();
  fs.writeFileSync(filePathFor(data.siteId), JSON.stringify(data), "utf-8");
}

export function loadSite(siteId: string): SiteData | null {
  const file = filePathFor(siteId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SiteData;
  } catch {
    return null;
  }
}

export function siteMeta(siteId: string): Omit<SiteData, "chunks"> | null {
  const site = loadSite(siteId);
  if (!site) return null;
  const { chunks, ...meta } = site;
  return meta;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SearchResult {
  text: string;
  url: string;
  title: string;
  score: number;
}

/** Brute-force top-K nearest neighbor search by cosine similarity. */
export function search(siteId: string, queryEmbedding: number[], topK = 5): SearchResult[] {
  const site = loadSite(siteId);
  if (!site) return [];

  const scored = site.chunks.map((c) => ({
    text: c.text,
    url: c.url,
    title: c.title,
    score: cosineSimilarity(queryEmbedding, c.embedding)
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
