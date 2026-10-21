/**
 * Tailwind config tokens: `theme.colors` from `tailwindcss/resolveConfig`
 * (Tailwind v3, resolved from the project that owns the config) or, when
 * Tailwind is not installed there, straight from the config module.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalName, makeToken } from "./normalize.js";
import { type ColorToken, TokenError } from "./types.js";

const SKIP = new Set(["inherit", "current", "currentcolor", "transparent", "initial", "unset"]);

type ColorTree = { [key: string]: unknown };

/** Flatten `theme.colors` into `[path, value]` pairs; `DEFAULT` keys name their parent. */
export function flattenTailwindColors(
  colors: ColorTree,
  warnings: string[] = [],
): [string[], string][] {
  const out: [string[], string][] = [];
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === "string") {
      if (!SKIP.has(node.trim().toLowerCase())) out.push([path, node]);
      return;
    }
    if (typeof node === "function") {
      warnings.push(`theme.colors.${path.join(".")} is a function; skipped`);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      walk(child, key === "DEFAULT" ? path : [...path, key]);
    }
  };
  walk(colors, []);
  return out;
}

interface TailwindModules {
  loadConfig: (path: string) => unknown;
  resolveConfig: (config: unknown) => { theme?: { colors?: ColorTree } };
}

function findTailwind(configPath: string): TailwindModules | null {
  const require = createRequire(configPath);
  try {
    const load = require("tailwindcss/loadConfig") as
      | TailwindModules["loadConfig"]
      | { default: TailwindModules["loadConfig"] };
    const res = require("tailwindcss/resolveConfig") as
      | TailwindModules["resolveConfig"]
      | { default: TailwindModules["resolveConfig"] };
    return {
      loadConfig: typeof load === "function" ? load : load.default,
      resolveConfig: typeof res === "function" ? res : res.default,
    };
  } catch {
    return null;
  }
}

export interface TailwindLoadOptions {
  /** Set false to skip `tailwindcss/resolveConfig` even when it is installed. */
  useTailwind?: boolean;
}

/** Load color tokens from a `tailwind.config.{js,ts,cjs,mjs}` file. */
export async function loadTailwindConfig(
  file: string,
  warnings: string[] = [],
  options: TailwindLoadOptions = {},
): Promise<ColorToken[]> {
  const path = resolve(file);
  let colors: ColorTree | undefined;
  const tw = options.useTailwind === false ? null : findTailwind(path);
  if (tw) {
    try {
      colors = tw.resolveConfig(tw.loadConfig(path)).theme?.colors;
    } catch (error) {
      throw new TokenError(`Could not load Tailwind config ${file}: ${(error as Error).message}`);
    }
  } else {
    let mod: { default?: unknown } & Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(path).href)) as typeof mod;
    } catch (error) {
      throw new TokenError(
        `Could not import Tailwind config ${file}: ${(error as Error).message}. ` +
          "Install tailwindcss in that project so RuGBy can use resolveConfig.",
      );
    }
    const config = (mod.default ?? mod) as {
      theme?: { colors?: ColorTree; extend?: { colors?: ColorTree } };
    };
    colors = { ...(config.theme?.colors ?? {}), ...(config.theme?.extend?.colors ?? {}) };
    warnings.push(
      `tailwindcss is not installed next to ${file}; read theme.colors directly (Tailwind's default palette is not included)`,
    );
  }
  if (!colors || Object.keys(colors).length === 0) {
    throw new TokenError(`${file} defines no theme.colors`);
  }
  return flattenTailwindColors(colors, warnings).map(([path, value]) =>
    makeToken({ name: canonicalName(path), value }),
  );
}
