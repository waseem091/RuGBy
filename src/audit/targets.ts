/**
 * Turn CLI inputs into page URLs: http(s) URLs pass through, local HTML files
 * and build directories are served over a local static server (so same-origin
 * iframes and relative assets behave like production), and sitemaps expand
 * into their <loc> URLs.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { UsageError } from "../errors.js";
import { type StaticServer, serveStatic } from "../server/static.js";

export interface ResolvedTargets {
  urls: string[];
  servers: StaticServer[];
}

function htmlFilesIn(dir: string, limit: number): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) visit(full);
      else if (/\.html?$/i.test(name)) out.push(full);
    }
  };
  visit(dir);
  // index.html first, then the rest in path order.
  out.sort((a, b) => {
    const ia = basename(a) === "index.html" && dirname(a) === dir ? 0 : 1;
    const ib = basename(b) === "index.html" && dirname(b) === dir ? 0 : 1;
    return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
  });
  return out.slice(0, limit);
}

/** Extract <loc> URLs from a sitemap or sitemap index. */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = (tag: string) =>
    [
      ...xml.matchAll(
        new RegExp(`<${tag}>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>[\\s\\S]*?</${tag}>`, "g"),
      ),
    ].map((m) => m[1]!.replace(/&amp;/g, "&"));
  return { pages: locs("url"), sitemaps: locs("sitemap") };
}

export async function fetchSitemap(url: string, maxPages: number, depth = 0): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "rugby-audit (+https://github.com/waseem091/RuGBy)" },
    });
  } catch (error) {
    throw new UsageError(`Could not fetch sitemap ${url}: ${(error as Error).message}`);
  }
  if (!res.ok) throw new UsageError(`Could not fetch sitemap ${url}: HTTP ${res.status}`);
  const { pages, sitemaps } = parseSitemap(await res.text());
  const out = [...pages];
  for (const child of sitemaps) {
    if (out.length >= maxPages || depth > 2) break;
    out.push(...(await fetchSitemap(child, maxPages - out.length, depth + 1)));
  }
  return [...new Set(out)].slice(0, maxPages);
}

export async function resolveTargets(
  inputs: string[],
  options: { sitemap?: string; maxPages: number },
): Promise<ResolvedTargets> {
  const urls: string[] = [];
  const servers: StaticServer[] = [];
  const byRoot = new Map<string, StaticServer>();
  const serverFor = async (root: string) => {
    let s = byRoot.get(root);
    if (!s) {
      s = await serveStatic(root);
      byRoot.set(root, s);
      servers.push(s);
    }
    return s;
  };
  try {
    for (const input of inputs) {
      if (/^https?:\/\//i.test(input)) {
        urls.push(input);
        continue;
      }
      if (/^file:\/\//i.test(input)) {
        throw new UsageError(`Pass a path instead of a file:// URL: ${input}`);
      }
      const path = resolve(input);
      if (!existsSync(path)) {
        throw new UsageError(`Not a URL, file or directory: ${input}`);
      }
      if (statSync(path).isDirectory()) {
        const files = htmlFilesIn(path, options.maxPages);
        if (!files.length) throw new UsageError(`No .html files in ${input}`);
        const s = await serverFor(path);
        for (const f of files) urls.push(`${s.url}/${relative(path, f).split("\\").join("/")}`);
      } else {
        const s = await serverFor(dirname(path));
        urls.push(`${s.url}/${encodeURIComponent(basename(path))}`);
      }
    }
    if (options.sitemap) urls.push(...(await fetchSitemap(options.sitemap, options.maxPages)));
  } catch (error) {
    await Promise.all(servers.map((s) => s.close()));
    throw error;
  }
  if (!urls.length)
    throw new UsageError(
      "Nothing to audit: pass a URL, an HTML file, a build directory or --sitemap",
    );
  return { urls: [...new Set(urls)], servers };
}

/** Per-host politeness: at most one navigation every `intervalMs` to any public host. */
export class RateLimiter {
  private next = new Map<string, number>();
  constructor(private readonly intervalMs = 2000) {}

  async wait(url: string): Promise<void> {
    const host = new URL(url).hostname;
    if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/.test(host)) return;
    const now = Date.now();
    const at = Math.max(now, this.next.get(host) ?? 0);
    this.next.set(host, at + this.intervalMs);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}
