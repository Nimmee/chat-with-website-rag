"use client";

import { useState, useRef, useEffect } from "react";

interface Source {
  url: string;
  title: string;
  score: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

type CrawlState = "idle" | "crawling" | "ready" | "error";

export default function Home() {
  const [url, setUrl] = useState("");
  const [crawlState, setCrawlState] = useState<CrawlState>("idle");
  const [crawlError, setCrawlError] = useState("");
  const [siteInfo, setSiteInfo] = useState<{ domain: string; pageCount: number; chunkCount: number } | null>(
    null
  );
  const [siteId, setSiteId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function handleCrawl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setCrawlState("crawling");
    setCrawlError("");
    setSiteInfo(null);
    setMessages([]);

    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Crawl failed.");
      }

      setSiteId(data.siteId);
      setSiteInfo({ domain: data.domain, pageCount: data.pageCount, chunkCount: data.chunkCount });
      setCrawlState("ready");
    } catch (err) {
      setCrawlError((err as Error).message);
      setCrawlState("error");
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !siteId || asking) return;

    const q = question.trim();
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setAsking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, question: q })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.answer, sources: data.sources }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${(err as Error).message}` }
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Chat with a Website</h1>
      <p className="text-sm text-stone-500 mb-6 text-center">
        Crawl a site, then ask questions grounded in what it actually says.
      </p>

      <form onSubmit={handleCrawl} className="w-full flex gap-2 mb-4">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          disabled={crawlState === "crawling"}
        />
        <button
          type="submit"
          disabled={crawlState === "crawling" || !url.trim()}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {crawlState === "crawling" ? "Crawling…" : "Crawl site"}
        </button>
      </form>

      {crawlState === "crawling" && (
        <p className="text-sm text-stone-500 mb-4">
          Fetching pages, respecting robots.txt and rate limits — this can take a minute…
        </p>
      )}

      {crawlState === "error" && <p className="text-sm text-red-600 mb-4">{crawlError}</p>}

      {crawlState === "ready" && siteInfo && (
        <p className="text-sm text-green-700 mb-4">
          Indexed {siteInfo.pageCount} page(s) from {siteInfo.domain} ({siteInfo.chunkCount} chunks). Ask away
          below.
        </p>
      )}

      <div className="w-full flex-1 flex flex-col gap-4 border border-stone-200 rounded-lg p-4 min-h-[300px] bg-white">
        {messages.length === 0 && (
          <p className="text-sm text-stone-400 text-center my-auto">
            {siteId ? "Ask a question about the site above." : "Crawl a site to start chatting."}
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[85%]"}>
            <div
              className={
                m.role === "user"
                  ? "bg-accent text-white rounded-lg px-3 py-2 text-sm"
                  : "bg-stone-100 text-ink rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {m.content}
            </div>
            {m.sources && m.sources.length > 0 && (
              <div className="mt-1 flex flex-col gap-0.5">
                {m.sources.map((s, si) => (
                  <a
                    key={si}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent underline underline-offset-2"
                  >
                    [{si + 1}] {s.title || s.url}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        {asking && <div className="text-sm text-stone-400 self-start">Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleAsk} className="w-full flex gap-2 mt-4">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={siteId ? "Ask a question about this site…" : "Crawl a site first"}
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          disabled={!siteId || asking}
        />
        <button
          type="submit"
          disabled={!siteId || asking || !question.trim()}
          className="bg-ink text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </main>
  );
}
