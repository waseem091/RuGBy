/**
 * W3C Design Tokens Community Group format: nested groups, `$value`, `$type`
 * (inherited from groups), `{alias}` references, DTCG color objects, and modes
 * either as separate files or under `$extensions.mode(s)`.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { canonicalName, makeToken, resolveAliases } from "./normalize.js";
import { type ColorToken, TokenError } from "./types.js";

interface FlatEntry {
  /** Original dotted path as authored, e.g. `color.gray.500`. */
  path: string;
  value: unknown;
  type?: string;
  modes: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(doc: unknown, file: string): Map<string, FlatEntry> {
  const out = new Map<string, FlatEntry>();
  const walk = (node: unknown, path: string[], inheritedType: string | undefined) => {
    if (!isObject(node)) return;
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      const ext = isObject(node.$extensions) ? node.$extensions : {};
      const modeSource = isObject(ext.modes) ? ext.modes : isObject(ext.mode) ? ext.mode : {};
      const entry: FlatEntry = { path: path.join("."), value: node.$value, modes: modeSource };
      if (type) entry.type = type;
      out.set(entry.path, entry);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      walk(child, [...path, key], type);
    }
  };
  if (!isObject(doc)) throw new TokenError(`${file}: expected a JSON object of token groups`);
  walk(doc, [], undefined);
  return out;
}

const ALIAS_RE = /^\{([^{}]+)\}$/;
const refOf = (value: string): string | null => ALIAS_RE.exec(value.trim())?.[1] ?? null;

const RGB_SPACES = new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d65",
  "xyz-d50",
]);

/** Convert a DTCG color value (string or 2025 color object) into a CSS color string. */
export function dtcgValueToCss(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  if (!isObject(value)) {
    throw new TokenError(
      `Could not parse token "${path}" value ${JSON.stringify(value)}: expected a CSS color`,
    );
  }
  if (typeof value.colorSpace !== "string" || !Array.isArray(value.components)) {
    if (typeof value.hex === "string") return value.hex;
    throw new TokenError(
      `Could not parse token "${path}" value ${JSON.stringify(value)}: expected { colorSpace, components }`,
    );
  }
  const space = value.colorSpace;
  const c = value.components.map((n) => (n === "none" ? "none" : String(Number(n))));
  if (c.length !== 3) throw new TokenError(`Token "${path}": components must have 3 entries`);
  const alpha = typeof value.alpha === "number" && value.alpha !== 1 ? ` / ${value.alpha}` : "";
  if (RGB_SPACES.has(space)) return `color(${space} ${c.join(" ")}${alpha})`;
  if (space === "hsl" || space === "hwb") return `${space}(${c[0]} ${c[1]}% ${c[2]}%${alpha})`;
  if (["lab", "lch", "oklab", "oklch"].includes(space)) return `${space}(${c.join(" ")}${alpha})`;
  throw new TokenError(`Token "${path}": unsupported colorSpace "${space}"`);
}

/** Names that mark a file as mode-less (shared primitives) rather than a theme mode. */
const BASE_NAMES = new Set([
  "tokens",
  "base",
  "core",
  "global",
  "primitives",
  "primitive",
  "default",
]);

/** `colors.dark.tokens.json` → `dark`; `base.tokens.json` → undefined. */
export function modeFromFilename(file: string): string | undefined {
  const stem = basename(file)
    .replace(/\.tokens\.json$|\.json$/i, "")
    .toLowerCase();
  const last = stem.split(".").pop() ?? stem;
  return BASE_NAMES.has(last) ? undefined : last;
}

export interface DtcgDocument {
  file: string;
  doc: unknown;
  /** Mode for every token in this document (multi-file modes). */
  mode?: string;
}

/** Normalize one or more parsed DTCG documents. Aliases resolve across documents. */
export function parseDtcgDocuments(documents: DtcgDocument[]): ColorToken[] {
  const flat = documents.map((d) => ({ ...d, entries: flatten(d.doc, d.file) }));
  // Lookup prefers the same document, then mode-less documents, then any.
  const lookupIn = (docIndex: number) => (name: string) => {
    const order = [
      flat[docIndex]!,
      ...flat.filter((d, i) => i !== docIndex && !d.mode),
      ...flat.filter((d, i) => i !== docIndex && d.mode),
    ];
    for (const d of order) {
      const e = d.entries.get(name);
      if (e) return e;
    }
    return undefined;
  };
  const tokens: ColorToken[] = [];
  flat.forEach((d, docIndex) => {
    const find = lookupIn(docIndex);
    const isColor = (entry: FlatEntry, seen = new Set<string>()): boolean => {
      if (entry.type) return entry.type === "color";
      if (typeof entry.value === "string") {
        const ref = refOf(entry.value);
        if (ref) {
          const target = find(ref);
          if (!target || seen.has(ref)) return true; // let resolution report the problem
          seen.add(ref);
          return isColor(target, seen);
        }
        return true;
      }
      return isObject(entry.value) && "colorSpace" in entry.value;
    };
    const valueLookup = (name: string) => {
      const e = find(name);
      return e === undefined ? undefined : dtcgValueToCss(e.value, name);
    };
    for (const entry of d.entries.values()) {
      if (!isColor(entry)) continue;
      const name = canonicalName(entry.path.split("."));
      const resolved = resolveAliases(entry.path, valueLookup, refOf, (n) => `{${n}}`);
      const base = {
        name,
        value: resolved.value,
        ...(d.mode ? { mode: d.mode } : {}),
        ...(resolved.aliasOf ? { aliasOf: canonicalName(resolved.aliasOf.split(".")) } : {}),
      };
      tokens.push(makeToken(base));
      for (const [mode, raw] of Object.entries(entry.modes)) {
        const css = dtcgValueToCss(raw, `${entry.path} (${mode})`);
        const ref = refOf(css);
        const value = ref ? resolveAliases(ref, valueLookup, refOf, (n) => `{${n}}`).value : css;
        tokens.push(
          makeToken({
            name,
            value,
            mode,
            ...(ref ? { aliasOf: canonicalName(ref.split(".")) } : {}),
          }),
        );
      }
    }
  });
  return tokens;
}

/** Read DTCG JSON files. With several files, each file's name supplies its mode. */
export async function loadDtcgFiles(files: string[]): Promise<ColorToken[]> {
  const docs: DtcgDocument[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      throw new TokenError(`Cannot read token file ${file}: ${(error as Error).message}`);
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (error) {
      throw new TokenError(`${file} is not valid JSON: ${(error as Error).message}`);
    }
    const mode = files.length > 1 ? modeFromFilename(file) : undefined;
    docs.push(mode ? { file, doc, mode } : { file, doc });
  }
  return parseDtcgDocuments(docs);
}
