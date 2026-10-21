/**
 * Token discovery: an explicit `--tokens` path (file, comma list or directory),
 * then `tokens.json` / `*.tokens.json`, then a Tailwind config. A live page's
 * `:root` custom properties are the last resort and are read during the audit.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { loadCssFiles } from "./css.js";
import { loadDtcgFiles } from "./dtcg.js";
import { buildSet } from "./normalize.js";
import { loadTailwindConfig } from "./tailwind.js";
import { TokenError, type TokenFormat, type TokenSet } from "./types.js";

const TAILWIND_RE = /^tailwind\.config\.(?:js|ts|cjs|mjs|cts|mts)$/;

export function formatOf(file: string): TokenFormat {
  const name = basename(file);
  const ext = extname(file).toLowerCase();
  if (TAILWIND_RE.test(name) || [".js", ".ts", ".cjs", ".mjs", ".cts", ".mts"].includes(ext)) {
    return "tailwind";
  }
  if (ext === ".css") return "css";
  if (ext === ".json") return "dtcg";
  throw new TokenError(
    `Unrecognized token file ${file}: expected a .json (W3C design tokens), a .css file with custom properties, or a tailwind.config.{js,ts,cjs,mjs}`,
  );
}

/** Find token files in a directory, in priority order. Returns [] when none. */
export function discoverTokenFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).sort();
  if (entries.includes("tokens.json")) return [join(dir, "tokens.json")];
  const dtcg = entries.filter((f) => f.endsWith(".tokens.json"));
  if (dtcg.length) return dtcg.map((f) => join(dir, f));
  const tw = entries.find((f) => TAILWIND_RE.test(f));
  if (tw) return [join(dir, tw)];
  return [];
}

/** Load tokens from explicit files (all of one format). */
export async function loadTokenFiles(files: string[]): Promise<TokenSet> {
  if (files.length === 0) throw new TokenError("No token files given");
  for (const f of files) {
    if (!existsSync(f)) throw new TokenError(`Token file not found: ${f}`);
  }
  const formats = new Set(files.map(formatOf));
  if (formats.size > 1) {
    throw new TokenError(
      `Token files must share one format, got ${[...formats].join(" and ")}: ${files.join(", ")}`,
    );
  }
  const format = [...formats][0]!;
  const warnings: string[] = [];
  let tokens;
  if (format === "dtcg") tokens = await loadDtcgFiles(files);
  else if (format === "css") tokens = await loadCssFiles(files, warnings);
  else {
    if (files.length > 1) throw new TokenError("Pass a single Tailwind config");
    tokens = await loadTailwindConfig(files[0]!, warnings);
  }
  if (tokens.length === 0) {
    throw new TokenError(`No color tokens found in ${files.join(", ")}`);
  }
  return buildSet(format, files.join(","), tokens, warnings);
}

/**
 * Resolve `--tokens`. `spec` may be a file, a comma-separated list, or a
 * directory. Without a spec, look in `cwd`. Returns null when nothing is found
 * (the audit then falls back to the page's `:root` custom properties).
 */
export async function loadTokens(spec?: string, cwd = process.cwd()): Promise<TokenSet | null> {
  if (spec) {
    const parts = spec
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolve(cwd, s));
    if (parts.length === 1 && existsSync(parts[0]!) && statSync(parts[0]!).isDirectory()) {
      const found = discoverTokenFiles(parts[0]!);
      if (!found.length) throw new TokenError(`No token files found in directory ${parts[0]}`);
      return loadTokenFiles(found);
    }
    return loadTokenFiles(parts);
  }
  const found = discoverTokenFiles(cwd);
  return found.length ? loadTokenFiles(found) : null;
}
