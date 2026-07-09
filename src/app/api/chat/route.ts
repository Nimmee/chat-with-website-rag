import { NextRequest, NextResponse } from "next/server";
import { embedQuery, answerFromContext } from "@/lib/ai";
import { search, siteMeta } from "@/lib/store";

const TOP_K = Number(process.env.RETRIEVAL_TOP_K || 5);
const MIN_SCORE = Number(process.env.RETRIEVAL_MIN_SCORE || 0.25);

export async function POST(req: NextRequest) {
  try {
    const { siteId, question } = await req.json();

    if (!siteId || !question) {
      return NextResponse.json({ error: "Missing 'siteId' or 'question'." }, { status: 400 });
    }

    const meta = await siteMeta(siteId);
    if (!meta) {
      return NextResponse.json({ error: "Unknown site. Crawl a URL first." }, { status: 404 });
    }

    const queryEmbedding = await embedQuery(question);
    const results = await search(siteId, queryEmbedding, TOP_K);

    const relevant = results.filter((r) => r.score >= MIN_SCORE);

    if (relevant.length === 0) {
      return NextResponse.json({
        answer: "The site doesn't appear to cover that. Try rephrasing, or ask something closer to the site's actual content.",
        sources: []
      });
    }

    const answer = await answerFromContext(question, relevant);

    const seen = new Set<string>();
    const sources = relevant
      .filter((r) => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .map((r) => ({ url: r.url, title: r.title, score: Number(r.score.toFixed(3)) }));

    return NextResponse.json({ answer, sources });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message || "Chat failed." }, { status: 500 });
  }
}