import { createRequire } from "node:module";
import { readBoundedBody as readBounded } from "../src/http-body.js";
interface RobotRules { isAllowed(url: string, agent: string): boolean | undefined; getCrawlDelay(agent: string): number | undefined }
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, text: string) => RobotRules;
const USER_AGENT = "ai-ui-cleaner-reference-indexer/0.1";
const robots = new Map<string, ReturnType<typeof robotsParser>>();
const lastRequest = new Map<string, number>();

export function publicHttps(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(url.hostname) || /^[\d.:\[\]]+$/.test(url.hostname)) throw new Error("Only public HTTPS sources are supported");
  return url;
}

async function permitted(url: URL) {
  if (!robots.has(url.origin)) {
    const endpoint = new URL("/robots.txt", url.origin);
    const response = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": USER_AGENT } });
    if (response.status === 404) robots.set(url.origin, robotsParser(endpoint.href, ""));
    else if (!response.ok) throw new Error(`Cannot verify robots rules (${response.status}) for ${url.origin}`);
    else robots.set(url.origin, robotsParser(endpoint.href, new TextDecoder().decode(await readBounded(response, 200_000))));
  }
  if (robots.get(url.origin)!.isAllowed(url.href, USER_AGENT) === false) throw new Error(`Source disallows collection: ${url.href}`);
}

export async function fetchSource(value: string, maximum = 2_000_000, hops = 0): Promise<{ bytes: Uint8Array; mediaType: string; url: string }> {
  const url = publicHttps(value);
  await permitted(url);
  const interval = Math.max(800, (robots.get(url.origin)?.getCrawlDelay(USER_AGENT) ?? 0) * 1000);
  if (interval > 60_000) throw new Error("Crawl delay exceeds this bounded collector's schedule; import an authorized export instead");
  const delay = Math.max(0, interval - (Date.now() - (lastRequest.get(url.origin) ?? 0)));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastRequest.set(url.origin, Date.now());
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": USER_AGENT, Accept: "text/markdown,text/html,application/json,image/*;q=0.8,*/*;q=0.5" } });
  if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
    if (hops >= 3) throw new Error("Too many redirects");
    return fetchSource(new URL(response.headers.get("location")!, url).href, maximum, hops + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.href}`);
  return { bytes: await readBounded(response, maximum), mediaType: response.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream", url: url.href };
}
