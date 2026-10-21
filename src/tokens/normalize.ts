import { toHex } from "../color/format.js";
import { ColorParseError, parseColor } from "../color/parse.js";
import { type ColorToken, TokenError, type TokenFormat, type TokenSet } from "./types.js";

const PREFIXES = new Set(["color", "colors"]);

/** Lower-case a path segment and make it safe for a CSS custom property name. */
function slug(segment: string): string {
  return segment
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build the canonical dotted name from path segments, ensuring a `color.` prefix. */
export function canonicalName(path: string[]): string {
  const segs = path.map((s) => s.trim()).filter(Boolean);
  if (segs.length > 0 && PREFIXES.has(segs[0]!.toLowerCase())) segs[0] = "color";
  else segs.unshift("color");
  return segs.join(".");
}

/** `color.gray.500` → `--color-gray-500`. */
export function cssVarFor(name: string): string {
  return `--${name.split(".").map(slug).join("-")}`;
}

/** `--color-gray-500` → `color.gray.500`. */
export function nameFromCssVar(prop: string): string {
  return canonicalName(prop.replace(/^--/, "").split("-").filter(Boolean));
}

/** First segment after the `color` prefix: `color.gray.500` → `gray`. */
export function groupOf(name: string): string {
  const segs = name.split(".");
  return segs[1] ?? segs[0] ?? name;
}

export interface RawToken {
  name: string;
  /** CSS color string (already alias-resolved). */
  value: string;
  mode?: string;
  aliasOf?: string;
  cssVar?: string;
}

/** Parse a raw token value into a normalized {@link ColorToken}. */
export function makeToken(raw: RawToken, options: { bareHsl?: boolean } = {}): ColorToken {
  let parsed: ReturnType<typeof parseColor>;
  try {
    parsed = parseColor(raw.value, options);
  } catch (error) {
    const reason =
      error instanceof ColorParseError
        ? error.message.replace(/^Could not parse "[^"]*" as a CSS color: /, "")
        : String(error);
    throw new TokenError(`Could not parse token "${raw.name}" value "${raw.value}": ${reason}`);
  }
  const token: ColorToken = {
    name: raw.name,
    cssVar: raw.cssVar ?? cssVarFor(raw.name),
    value: toHex(parsed.rgba),
    rgba: parsed.rgba,
    group: groupOf(raw.name),
  };
  if (raw.mode) token.mode = raw.mode;
  if (raw.aliasOf) token.aliasOf = raw.aliasOf;
  if (parsed.gamutMapped) token.gamutMapped = true;
  return token;
}

/** Natural, locale-independent comparison: `blue.50` < `blue.400`. */
export function naturalCompare(a: string, b: string): number {
  const ca = a.match(/\d+|\D+/g) ?? [];
  const cb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const x = ca[i]!;
    const y = cb[i]!;
    if (x === y) continue;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) return Number(x) - Number(y) || (x < y ? -1 : 1);
    return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

export function compareTokens(a: ColorToken, b: ColorToken): number {
  if (a.name !== b.name) return naturalCompare(a.name, b.name);
  const am = a.mode ?? "";
  const bm = b.mode ?? "";
  return am < bm ? -1 : am > bm ? 1 : 0;
}

/** Sort, de-duplicate (last wins per name+mode) and wrap tokens into a set. */
export function buildSet(
  format: TokenFormat,
  source: string,
  tokens: ColorToken[],
  warnings: string[] = [],
): TokenSet {
  const byKey = new Map<string, ColorToken>();
  for (const t of tokens) byKey.set(`${t.name}\u0000${t.mode ?? ""}`, t);
  const list = [...byKey.values()].sort(compareTokens);
  const modes = [...new Set(list.map((t) => t.mode).filter((m): m is string => !!m))].sort();
  return { format, source, tokens: list, modes, warnings };
}

/**
 * Resolve references between raw values. `lookup(name)` returns the raw value
 * of another token (or undefined); `refOf(value)` extracts a reference name
 * from a value, or null when the value is a literal.
 */
export function resolveAliases(
  name: string,
  lookup: (name: string) => string | undefined,
  refOf: (value: string) => string | null,
  describe: (name: string) => string = (n) => n,
): { value: string; aliasOf?: string } {
  const chain = [name];
  let current = lookup(name);
  let firstRef: string | undefined;
  while (current !== undefined) {
    const ref = refOf(current);
    if (ref === null) return firstRef ? { value: current, aliasOf: firstRef } : { value: current };
    firstRef ??= ref;
    if (chain.includes(ref)) {
      throw new TokenError(`Circular alias: ${[...chain, ref].map(describe).join(" → ")}`);
    }
    chain.push(ref);
    current = lookup(ref);
    if (current === undefined) {
      throw new TokenError(
        `Token ${describe(chain[chain.length - 2]!)} references ${describe(ref)}, which does not exist`,
      );
    }
  }
  throw new TokenError(`Token ${describe(name)} does not exist`);
}
