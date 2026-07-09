import { NextRequest, NextResponse } from "next/server";
import { crawlSite } from "@/lib/crawler";
import { chunkText } from "@/lib/chunker";
import { embedTexts } from "@/lib/ai";
import { saveSite, siteIdFor, StoredChunk } from "@/lib/store";

export const maxDuration = 300; // allow up to 5 min for a crawl on platforms that support it

const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES || 25);
const MAX_DEPTH = Number(process.env.CRAWL_MAX_DEPTH || 2);

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing 'url'." }, { status: 400 });
    }

    let seed: URL;
    try {
      seed = new URL(url);
    } catch {
      return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
    }
    if (seed.protocol !== "http:" && seed.protocol !== "https:") {
      return NextResponse.json({ error: "Only http/https URLs are supported." }, { status: 400 });
    }

    const logs: string[] = [];
    const pages = await crawlSite(seed.toString(), {
      maxPages: MAX_PAGES,
      maxDepth: MAX_DEPTH,
      onProgress: (msg) => logs.push(msg)
    });

    if (pages.length === 0) {
      console.error("Crawl produced 0 pages. Debug log:\n" + logs.join("\n"));
      return NextResponse.json(
        {
          error: "Couldn't extract any content from that site.",
          debugLog: logs.slice(-10)
        },
        { status: 422 }
      );
    }

    const allChunks = pages.flatMap((p) => chunkText(p.text, p.url, p.title));

    const BATCH_SIZE = 100;
    const storedChunks: StoredChunk[] = [];
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const embeddings = await embedTexts(batch.map((c) => c.text));
      batch.forEach((c, idx) => {
        storedChunks.push({
          id: `${i + idx}`,
          url: c.url,
          title: c.title,
          text: c.text,
          embedding: embeddings[idx]
        });
      });
    }

    const siteId = siteIdFor(seed.toString());
    await saveSite({
      siteId,
      seedUrl: seed.toString(),
      domain: seed.hostname,
      crawledAt: new Date().toISOString(),
      pageCount: pages.length,
      chunks: storedChunks
    });

    return NextResponse.json({
      siteId,
      domain: seed.hostname,
      pageCount: pages.length,
      chunkCount: storedChunks.length,
      pages: pages.map((p) => ({ url: p.url, title: p.title }))
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message || "Crawl failed." }, { status: 500 });
  }
}