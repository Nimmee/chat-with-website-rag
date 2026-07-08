# Chat with a Website

A small RAG (Retrieval-Augmented Generation) app: give it a URL, it crawls that
site (politely, within scope), indexes the content, and lets you ask questions
that get answered using only what the site actually says — with links back to
the source pages.

## Stack

- **Frontend:** Next.js 14 (App Router) + React + Tailwind
- **Backend:** Next.js API routes (Node.js) — `/api/crawl`, `/api/chat`
- **Crawling:** `fetch` + `cheerio` (HTML parsing), `robots-parser` (robots.txt)
- **Embeddings / chat:** Google Gemini API (`gemini-embedding-001`, `gemini-2.5-flash`) — free tier, no credit card required
- **Vector store:** a small in-memory / JSON-file index (see rationale below) —
  no external vector DB required

## How to run it

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set your API key**
   ```bash
   cp .env.example .env.local
   ```
   Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (Google account, no credit card). Open `.env.local` and set:
   ```
   GEMINI_API_KEY=AIza...
   ```
   Everything else in `.env.local` is optional — defaults are already sensible.

3. **Run it**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

4. **Use it**
   - Paste a URL (e.g. `https://example.com`) and click "Crawl site." This
     fetches pages, cleans them, chunks them, embeds the chunks, and saves the
     index to `data/<siteId>.json`.
   - Once indexed, ask questions in the chat box below. Every answer that
     draws on the site shows numbered source links.

No database setup, no paid API keys, no external services.

## Crawling strategy

- **Scope:** breadth-first crawl starting at the seed URL, restricted to the
  seed's origin (`protocol + host`). Any link to a different domain is
  discarded immediately, so it can't wander off-site.
- **Limits:** capped by `CRAWL_MAX_PAGES` (default 25) and `CRAWL_MAX_DEPTH`
  (default 2, i.e. seed page → its links → their links). Both are
  intentionally small for a take-home — easy to raise via env vars.
- **Politeness:**
  - Fetches and respects `robots.txt` (`Allow`/`Disallow` rules and
    `Crawl-delay` if present) before touching any page.
  - Requests are sequential, not parallel, with a delay between each
    (`Crawl-delay` from robots.txt, or 600ms by default).
  - Sends an honest `User-Agent` string identifying the bot.
- **Cleaning:** strips `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`,
  cookie-banner-ish elements, etc. before extracting text, and prefers
  `<main>`/`<article>` over `<body>` when present, so the index isn't polluted
  with navigation links and boilerplate.
- Fragment URLs (`#section`) and common `utm_*` tracking params are stripped
  during URL normalization so the same page isn't crawled multiple times
  under near-duplicate URLs.

## Chunking & retrieval

- **Chunking:** page text is split into ~900-character chunks with a
  150-character overlap, breaking on paragraph boundaries where possible
  (never mid-sentence when avoidable). Overlap means an idea that spans a
  chunk boundary isn't completely lost in one chunk. 900 characters (~180-220
  tokens) is small enough to keep retrieval precise — a big page-sized chunk
  would often get pulled in for the wrong reason and dilute what the model
  actually gets to see.
- **Embedding:** each chunk is embedded with `text-embedding-3-small` and
  stored alongside its source URL and page title.
- **Retrieval:** a question is embedded the same way, and the top-K
  (default 5) chunks by cosine similarity are pulled from the index.
- **Vector store choice:** brute-force cosine similarity over an in-memory
  array, persisted to a per-site JSON file on disk. For a single-site demo
  with at most a few hundred chunks, this is well under 50ms per query — a
  real vector DB (pgvector, Pinecone, etc.) would add setup and infra cost
  with no measurable benefit at this scale. This would **not** be the right
  choice for many sites or millions of chunks — see "What I'd improve" below.

## Keeping answers grounded

Two layers:

1. **Retrieval threshold:** if the best-matching chunk's cosine similarity is
   below `RETRIEVAL_MIN_SCORE` (default 0.25), the app doesn't call the LLM at
   all — it returns "the site doesn't appear to cover that" directly. This
   catches clearly off-topic questions cheaply and deterministically.
2. **System prompt constraint:** for everything else, the retrieved chunks
   are passed to the model with an explicit instruction to answer *only* from
   that context, cite sources inline (`[Source 1]`), and say so plainly if the
   context doesn't fully answer the question rather than filling the gap from
   its own training data.

This isn't a hallucination-proof guarantee (no prompt-based approach is), but
it's the standard, practical way to bias a RAG pipeline strongly toward
grounded answers.

## What works well

- Clean, scoped, polite crawling with real robots.txt compliance.
- Chunking that keeps context coherent across boundaries.
- Citations are always tied to the actual chunk(s) the model was given, not
  guessed after the fact.
- Off-topic questions are reliably deflected before ever reaching the LLM.

## What's weak / what I'd improve with more time

- **Long pages:** a single very long page (e.g. a long docs article) becomes
  many chunks, and generic questions about "the page" can retrieve a scattered,
  non-representative subset of it. I'd add a page-level summary chunk (one
  extra embedding per page, containing a short auto-summary) so broad
  questions have something to latch onto in addition to fine-grained chunks.
- **No JS rendering:** the crawler fetches raw HTML, so client-side-rendered
  content (SPA-style pages that fetch data after load) won't be indexed. A
  headless-browser fetch (Playwright) would fix this but adds real latency
  and infra weight, which felt out of scope for the time budget here.
- **No eval:** given more time I'd add a small fixed set of
  question → expected-source pairs per test site to measure retrieval
  precision/recall as I tune chunk size, top-K, and the score threshold,
  instead of eyeballing it.
- **Vector store won't scale or persist on serverless:** the JSON-file store
  works well locally and for a single demo site, but on a serverless deploy
  (e.g. Vercel) the filesystem isn't guaranteed to persist across
  invocations/deploys, and it doesn't scale past one process. For production
  this would move to pgvector or a hosted vector DB.
- **No streaming:** answers arrive as one block rather than streaming token by
  token. Straightforward to add (`stream: true` + Server-Sent Events) but
  skipped to stay within the time budget.
- **Single-site only:** by design, per the assignment scope — there's no
  multi-site management UI.

## Notes on ambiguous calls

- Interpreted "site" as "single origin" (protocol + host) — subdomains are
  treated as out of scope unless the seed URL itself uses one.
- Chose Google Gemini over other providers because it offers a genuinely free
  tier (no credit card, no trial expiry) with both an embedding model and a
  capable chat model, which suits a take-home project well; the code isolates
  all model calls in `src/lib/ai.ts` so swapping providers means changing one
  file.
- Went with a JSON-file store instead of an actual vector DB — justified above
  under "Vector store choice."
