/**
 * CSS custom properties as tokens: `:root`/`html`/`@theme` blocks (base), and
 * `.dark`, `[data-theme=…]` or `@media (prefers-color-scheme: …)` blocks
 * (modes). Covers Tailwind v4 CSS-first configs and shadcn/ui themes.
 */
import { readFile } from "node:fs/promises";
import { tryParseColor } from "../color/parse.js";
import { makeToken, nameFromCssVar } from "./normalize.js";
import { type ColorToken, TokenError } from "./types.js";

interface Declaration {
  prop: string;
  value: string;
  /** undefined = base. */
  mode: string | undefined;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const BASE_SELECTOR = /^(?::root|html|:host|\*)$/;
const THEME_ATTR =
  /^(?::root|html|:host)?\[data-(?:theme|mode|color-scheme|appearance)\s*=\s*["']?([\w-]+)["']?\]$/i;
const THEME_CLASS =
  /^(?::root|html|:host)?\.(dark|light|dim|night|high-contrast|theme-[\w-]+|[\w-]+-(?:theme|mode))$/i;

/**
 * Work out the mode a block applies to from its selector and enclosing at-rules.
 * Returns `null` for blocks that are not token definitions (component scopes).
 */
export function modeForContext(stack: string[]): string | undefined | null {
  let mode: string | undefined;
  let tokenScope = false;
  for (const prelude of stack) {
    const p = prelude.trim();
    if (p.startsWith("@theme")) {
      tokenScope = true;
      continue;
    }
    if (p.startsWith("@media")) {
      const m = /prefers-color-scheme\s*:\s*(dark|light)/.exec(p);
      if (m) mode = m[1];
      continue;
    }
    if (p.startsWith("@layer") || p.startsWith("@supports")) continue;
    if (p.startsWith("@")) return null;
    // A selector list: accept it only if every selector is a theme scope.
    let all = true;
    let selectorMode: string | undefined;
    for (const raw of p.split(",")) {
      const sel = raw
        .trim()
        .replace(/:(?:where|is)\(([^)]*)\)/g, "$1")
        .trim();
      if (BASE_SELECTOR.test(sel)) continue;
      const attr = THEME_ATTR.exec(sel);
      const cls = THEME_CLASS.exec(sel);
      if (attr) selectorMode = attr[1]!.toLowerCase();
      else if (cls) selectorMode = cls[1]!.toLowerCase().replace(/^theme-/, "");
      else all = false;
    }
    if (!all) return null;
    tokenScope = true;
    if (selectorMode) mode = selectorMode;
  }
  return tokenScope ? mode : null;
}

/** Split declarations on `;` outside strings and parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Extract custom-property declarations from token-defining blocks of a stylesheet. */
export function extractDeclarations(cssText: string): Declaration[] {
  const css = stripComments(cssText);
  const out: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  let quote: string | null = null;
  let parenDepth = 0;
  const flushDeclarations = (text: string) => {
    const context = modeForContext(stack);
    if (context === null) return;
    for (const part of splitTopLevel(text)) {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(part);
      if (!m) continue;
      const value = m[2]!.replace(/\s*!important\s*$/i, "").trim();
      if (!value) continue;
      out.push({ prop: m[1]!, value, mode: context });
    }
  };
  for (const ch of css) {
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === "(") parenDepth++;
    if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (ch === "{" && parenDepth === 0) {
      // Text before the brace: earlier declarations, then the nested prelude.
      const lastSemi = buffer.lastIndexOf(";");
      if (lastSemi >= 0) flushDeclarations(buffer.slice(0, lastSemi + 1));
      stack.push(buffer.slice(lastSemi + 1).trim());
      buffer = "";
      continue;
    }
    if (ch === "}" && parenDepth === 0) {
      flushDeclarations(buffer);
      stack.pop();
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  return out;
}

const WHOLE_VAR_RE = /^var\(\s*(--[\w-]+)\s*\)$/;

/** Find the end index of a balanced parenthesis group starting at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Turn declarations into tokens. `var()` references (whole values or nested,
 * e.g. `hsl(var(--x))`) resolve within the same mode first, then the base; a
 * base token whose reference chain is overridden in a mode also gets a value
 * for that mode.
 */
export function tokensFromDeclarations(
  decls: Declaration[],
  options: { warnings?: string[]; mode?: string } = {},
): ColorToken[] {
  const base = new Map<string, string>();
  const modes = new Map<string, Map<string, string>>();
  for (const d of decls) {
    const mode = d.mode ?? options.mode;
    if (!mode) base.set(d.prop, d.value);
    else {
      if (!modes.has(mode)) modes.set(mode, new Map());
      modes.get(mode)!.set(d.prop, d.value);
    }
  }
  const resolveIn = (prop: string, mode: string | undefined) => {
    const scoped = mode ? modes.get(mode) : undefined;
    const lookup = (p: string) => scoped?.get(p) ?? base.get(p);
    const substitute = (value: string, chain: string[]): string => {
      let out = "";
      let i = 0;
      while (i < value.length) {
        const at = value.indexOf("var(", i);
        if (at < 0) {
          out += value.slice(i);
          break;
        }
        out += value.slice(i, at);
        const close = matchParen(value, at + 3);
        if (close < 0) throw new TokenError(`${chain[0]}: unbalanced var() in "${value}"`);
        const inner = value.slice(at + 4, close);
        const comma = inner.indexOf(",");
        const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
        const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
        if (chain.includes(name)) {
          throw new TokenError(`Circular alias: ${[...chain, name].join(" → ")}`);
        }
        const target = lookup(name);
        if (target !== undefined) out += substitute(target, [...chain, name]);
        else if (fallback !== undefined) out += substitute(fallback, chain);
        else {
          throw new TokenError(
            `Token ${chain[chain.length - 1]} references ${name}, which does not exist`,
          );
        }
        i = close + 1;
      }
      return out.trim();
    };
    const raw = lookup(prop);
    if (raw === undefined) throw new TokenError(`Token ${prop} does not exist`);
    const whole = WHOLE_VAR_RE.exec(raw.trim());
    const value = substitute(raw, [prop]);
    return whole && lookup(whole[1]!) !== undefined ? { value, aliasOf: whole[1]! } : { value };
  };
  const tokens: ColorToken[] = [];
  const emit = (prop: string, mode: string | undefined) => {
    let resolved: { value: string; aliasOf?: string };
    try {
      resolved = resolveIn(prop, mode);
    } catch (error) {
      if (error instanceof TokenError && /Circular alias/.test(error.message)) throw error;
      options.warnings?.push(`${prop}: ${(error as Error).message}`);
      return undefined;
    }
    if (!tryParseColor(resolved.value, { bareHsl: true })) {
      if (
        /color/i.test(prop) &&
        !/^(initial|inherit|unset|none|currentcolor)$/i.test(resolved.value)
      ) {
        options.warnings?.push(`${prop}: "${resolved.value}" is not a color; skipped`);
      }
      return undefined;
    }
    const token = makeToken(
      {
        name: nameFromCssVar(prop),
        cssVar: prop,
        value: resolved.value,
        ...(mode ? { mode } : {}),
        ...(resolved.aliasOf ? { aliasOf: nameFromCssVar(resolved.aliasOf) } : {}),
      },
      { bareHsl: true },
    );
    tokens.push(token);
    return token;
  };
  const baseTokens = new Map<string, ColorToken>();
  for (const prop of base.keys()) {
    const t = emit(prop, undefined);
    if (t) baseTokens.set(prop, t);
  }
  for (const [mode, scoped] of modes) {
    const props = new Set([...scoped.keys(), ...base.keys()]);
    for (const prop of props) {
      if (!scoped.has(prop)) {
        // Only emit a mode variant of a base token when its resolved value changes.
        const b = baseTokens.get(prop);
        if (!b) continue;
        let r: { value: string };
        try {
          r = resolveIn(prop, mode);
        } catch {
          continue;
        }
        const parsed = tryParseColor(r.value, { bareHsl: true });
        const same =
          parsed &&
          parsed.rgba.r === b.rgba.r &&
          parsed.rgba.g === b.rgba.g &&
          parsed.rgba.b === b.rgba.b &&
          parsed.rgba.alpha === b.rgba.alpha;
        if (!parsed || same) continue;
      }
      emit(prop, mode);
    }
  }
  return tokens;
}

/** Read custom-property tokens from CSS files (later files override earlier ones). */
export async function loadCssFiles(
  files: string[],
  warnings: string[] = [],
): Promise<ColorToken[]> {
  const decls: Declaration[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      throw new TokenError(`Cannot read CSS token file ${file}: ${(error as Error).message}`);
    }
    decls.push(...extractDeclarations(text));
  }
  return tokensFromDeclarations(decls, { warnings });
}

/**
 * Tokens from a live page's computed `:root` custom properties
 * (`getComputedStyle(document.documentElement)`), one call per color scheme.
 */
export function tokensFromComputedProperties(
  props: Record<string, string>,
  mode?: string,
): ColorToken[] {
  const decls: Declaration[] = Object.entries(props).map(([prop, value]) => ({
    prop,
    value: value.trim(),
    mode,
  }));
  return tokensFromDeclarations(decls, mode ? { mode } : {});
}
