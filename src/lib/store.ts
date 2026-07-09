import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

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

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePathFor(siteId: string) {
  return path.join(DATA_DIR, `${siteId}.json`);
}

function redisKeyFor(siteId: string) {
  return `site:${siteId}`;
}

export function siteIdFor(seedUrl: string): string {
  const domain = new URL(seedUrl).hostname;
  return crypto.createHash("sha1").update(domain).digest("hex").slice(0, 12);
}

export async function saveSite(data: SiteData): Promise<void> {
  if (redis) {
    await redis.set(redisKeyFor(data.siteId), JSON.stringify(data));
    return;
  }
  ensureDataDir();
  fs.writeFileSync(filePathFor(data.siteId), JSON.stringify(data), "utf-8");
}

export async function loadSite(siteId: string): Promise<SiteData | null> {
  if (redis) {
    const raw = await redis.get(redisKeyFor(siteId));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as SiteData) : (raw as SiteData);
  }
  const file = filePathFor(siteId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SiteData;
  } catch {
    return null;
  }
}

export async function siteMeta(siteId: string): Promise<Omit<SiteData, "chunks"> | null> {
  const site = await loadSite(siteId);
  if (!site) return null;
  const { chunks, ...meta } = site;
  return meta;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
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

export async function search(siteId: string, queryEmbedding: number[], topK = 5): Promise<SearchResult[]> {
  const site = await loadSite(siteId);
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