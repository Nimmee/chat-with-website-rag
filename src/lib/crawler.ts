import * as cheerio from "cheerio";
import { loadRobots, isAllowed, getCrawlDelayMs, USER_AGENT } from "./robots";

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  onProgress?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Strips boilerplate (nav, footer, header, script, style, ads, cookie banners)
 * and returns the main readable text, plus the page title.
 */
function extractContent(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, nav, footer, header, iframe, svg, form, " +
      "[role='navigation'], [role='banner'], [role='contentinfo'], " +
      ".cookie, .cookies, .cookie-banner, .nav, .navbar, .footer, .header, .sidebar, .ads, .advertisement"
  ).remove();

  const title = $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled page";

  // Prefer <main> or <article> if present -- usually the actual content
  const container = $("main").length ? $("main") : $("article").length ? $("article") : $("body");

  const text = container
    .find("p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0)
    .join("\n");

  return { title, text: text.replace(/\n{3,}/g, "\n\n").trim() };
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    u.hash = ""; // ignore #fragments -- same content, different anchor
    // strip common tracking params to avoid crawling near-duplicate URLs
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((p) =>
      u.searchParams.delete(p)
    );
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractLinks($: cheerio.CheerioAPI, base: string): string[] {
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(base, href);
    if (normalized) links.push(normalized);
  });
  return links;
}

/**
 * Scoped, polite, breadth-first crawl of a single site.
 * - Stays within the same origin as the seed URL (no wandering off-domain).
 * - Respects robots.txt (Allow/Disallow + Crawl-delay).
 * - Rate-limits requests (sequential, with a delay between each).
 * - Bounded by maxPages and maxDepth so it can't run away on huge sites.
 */
export async function crawlSite(seedUrl: string, opts: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxPages = opts.maxPages ?? 25;
  const maxDepth = opts.maxDepth ?? 2;
  const log = opts.onProgress ?? (() => {});

  const seed = new URL(seedUrl);
  const origin = seed.origin;

  const robots = await loadRobots(origin);
  const delayMs = getCrawlDelayMs(robots);

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: seed.toString(), depth: 0 }];
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift()!;
    const { url, depth } = next;

    if (visited.has(url)) continue;
    visited.add(url);

    const target = new URL(url);
    if (target.origin !== origin) continue; // stay in scope: same domain only

    if (!isAllowed(robots, url)) {
      log(`Skipped (robots.txt disallows): ${url}`);
      continue;
    }

    try {
      log(`Fetching: ${url}`);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) {
        continue;
      }

      const html = await res.text();
      const { title, text } = extractContent(html);

      if (text.length > 100) {
        pages.push({ url, title, text });
      }

      if (depth < maxDepth) {
        const $ = cheerio.load(html);
        const links = extractLinks($, url);
        for (const link of links) {
          const linkUrl = new URL(link);
          if (linkUrl.origin === origin && !visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (err) {
      log(`Failed to fetch ${url}: ${(err as Error).message}`);
    }

    // Politeness: wait between requests instead of hammering the server
    await sleep(delayMs);
  }

  return pages;
}
