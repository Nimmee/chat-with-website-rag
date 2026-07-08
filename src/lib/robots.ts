import robotsParser from "robots-parser";

const USER_AGENT = "RAGChatBot/1.0 (+take-home-assignment)";

/**
 * Fetches and parses robots.txt for a given origin.
 * If robots.txt doesn't exist or fails to load, we default to "allow everything"
 * (that's the standard convention: no robots.txt = no restrictions).
 */
export async function loadRobots(origin: string) {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      // Don't let a slow/broken robots.txt hang the whole crawl
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return robotsParser(robotsUrl, "");
    }
    const body = await res.text();
    return robotsParser(robotsUrl, body);
  } catch {
    return robotsParser(robotsUrl, "");
  }
}

export function isAllowed(robots: ReturnType<typeof robotsParser>, url: string) {
  // robots-parser returns undefined when it can't determine -> treat as allowed
  const allowed = robots.isAllowed(url, USER_AGENT);
  return allowed !== false;
}

export function getCrawlDelayMs(robots: ReturnType<typeof robotsParser>): number {
  const delaySec = robots.getCrawlDelay(USER_AGENT);
  if (delaySec && delaySec > 0) return delaySec * 1000;
  return 600; // sensible default: ~1.6 requests/sec, polite for a small demo crawl
}

export { USER_AGENT };
