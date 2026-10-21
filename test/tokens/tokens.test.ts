import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalName,
  cssVarFor,
  discoverTokenFiles,
  dtcgValueToCss,
  extractDeclarations,
  formatOf,
  formatTokenTable,
  groupOf,
  loadTailwindConfig,
  loadTokenFiles,
  loadTokens,
  modeForContext,
  modeFromFilename,
  nameFromCssVar,
  naturalCompare,
  parseDtcgDocuments,
  TokenError,
  tokensFromComputedProperties,
  tokensFromDeclarations,
} from "../../src/tokens/index.js";

const F = "fixtures/tokens";

async function tempDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rugby-tokens-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

describe("the same palette in all three formats", () => {
  it("normalizes to an identical token list", async () => {
    const dtcg = await loadTokenFiles([`${F}/palette.tokens.json`]);
    const tailwind = await loadTokenFiles([`${F}/tailwind.config.js`]);
    const css = await loadTokenFiles([`${F}/palette.css`]);
    expect(dtcg.tokens.length).toBe(38);
    expect(tailwind.tokens).toEqual(dtcg.tokens);
    expect(css.tokens).toEqual(dtcg.tokens);
    expect([dtcg.format, tailwind.format, css.format]).toEqual(["dtcg", "tailwind", "css"]);
    expect(dtcg.tokens.find((t) => t.name === "color.gray.500")).toEqual({
      name: "color.gray.500",
      cssVar: "--color-gray-500",
      value: "#6B7280",
      rgba: { r: 107 / 255, g: 114 / 255, b: 128 / 255, alpha: 1 },
      group: "gray",
    });
  });

  it("sorts naturally and deterministically", async () => {
    const set = await loadTokenFiles([`${F}/palette.tokens.json`]);
    const blues = set.tokens.filter((t) => t.group === "blue").map((t) => t.name.split(".")[2]);
    expect(blues).toEqual(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]);
  });

  it("reads a Tailwind config without tailwindcss installed (with a warning)", async () => {
    const warnings: string[] = [];
    const tokens = await loadTailwindConfig(`${F}/tailwind.config.js`, warnings, { useTailwind: false });
    expect(tokens).toHaveLength(38);
    expect(warnings[0]).toMatch(/default palette is not included/);
  });
});

describe("DTCG", () => {
  it("resolves aliases, chains, color objects and $extensions modes", async () => {
    const set = await loadTokens(`${F}/semantic.tokens.json`);
    const get = (name: string, mode?: string) =>
      set!.tokens.find((t) => t.name === name && t.mode === mode);
    expect(get("color.text.default")).toMatchObject({ value: "#111827", aliasOf: "color.gray.900" });
    expect(get("color.text.link")).toMatchObject({ aliasOf: "color.text.accent" });
    expect(get("color.text.link")!.value).toBe(get("color.brand.primary")!.value);
    expect(get("color.text.muted", "dark")).toMatchObject({ value: "#374151", aliasOf: "color.gray.700" });
    expect(get("color.brand.display")!.gamutMapped).toBe(true);
    expect(set!.modes).toEqual(["dark"]);
    expect(set!.tokens.some((t) => t.name.startsWith("color.spacing"))).toBe(false);
  });

  it("raises a clear error for circular aliases", async () => {
    await expect(loadTokens(`${F}/circular.tokens.json`)).rejects.toThrow(
      "Circular alias: {color.a} → {color.b} → {color.c} → {color.a}",
    );
  });

  it("raises an actionable error for unparseable values", async () => {
    await expect(loadTokens(`${F}/bad-value.tokens.json`)).rejects.toThrow(
      'Could not parse token "color.brand" value "blue-ish": expected a CSS color',
    );
  });

  it("reports missing alias targets", () => {
    expect(() =>
      parseDtcgDocuments([{ file: "x", doc: { color: { a: { $type: "color", $value: "{color.nope}" } } } }]),
    ).toThrow(/references \{color.nope\}, which does not exist/);
  });

  it("treats separate files as modes, resolving aliases into shared primitives", async () => {
    const set = await loadTokens(`${F}/modes`);
    expect(set!.modes).toEqual(["dark", "light"]);
    const surface = set!.tokens.filter((t) => t.name === "color.surface");
    expect(surface.map((t) => [t.mode, t.value])).toEqual([
      ["dark", "#111827"],
      ["light", "#F9FAFB"],
    ]);
    expect(set!.tokens.find((t) => t.name === "color.gray.500")!.mode).toBeUndefined();
  });

  it("infers modes from file names", () => {
    expect(modeFromFilename("x/colors.dark.tokens.json")).toBe("dark");
    expect(modeFromFilename("light.json")).toBe("light");
    expect(modeFromFilename("base.tokens.json")).toBeUndefined();
  });

  it("converts DTCG color objects", () => {
    expect(dtcgValueToCss({ colorSpace: "srgb", components: [1, 0, 0] }, "x")).toBe("color(srgb 1 0 0)");
    expect(dtcgValueToCss({ colorSpace: "oklch", components: [0.5, 0.1, "none"], alpha: 0.5 }, "x")).toBe(
      "oklch(0.5 0.1 none / 0.5)",
    );
    expect(dtcgValueToCss({ colorSpace: "hsl", components: [10, 50, 50] }, "x")).toBe("hsl(10 50% 50%)");
    expect(dtcgValueToCss({ hex: "#abc" }, "x")).toBe("#abc");
    expect(() => dtcgValueToCss(42, "x")).toThrow(TokenError);
    expect(() => dtcgValueToCss({ foo: 1 }, "x")).toThrow(/colorSpace/);
    expect(() => dtcgValueToCss({ colorSpace: "cmyk", components: [1, 2, 3] }, "x")).toThrow(/unsupported/);
    expect(() => dtcgValueToCss({ colorSpace: "srgb", components: [1, 2] }, "x")).toThrow(/3 entries/);
  });

  it("includes untyped tokens only when their value is a color", () => {
    const tokens = parseDtcgDocuments([
      {
        file: "x",
        doc: {
          brand: { $value: "#ff0000" },
          ref: { $value: "{brand}" },
          size: { $value: "4px", $type: "dimension" },
          obj: { $value: { colorSpace: "srgb", components: [0, 0, 1] } },
        },
      },
    ]);
    expect(tokens.map((t) => t.name)).toEqual(["color.brand", "color.ref", "color.obj"]);
  });

  it("rejects non-object documents and invalid JSON", async () => {
    expect(() => parseDtcgDocuments([{ file: "x.json", doc: [1, 2] }])).toThrow(/JSON object/);
    const dir = await tempDir({ "broken.json": "{ nope" });
    await expect(loadTokenFiles([join(dir, "broken.json")])).rejects.toThrow(/not valid JSON/);
  });
});

describe("CSS custom properties", () => {
  it("reads Tailwind v4 @theme and shadcn-style themes with modes", async () => {
    const set = await loadTokens(`${F}/theme.css`);
    const get = (name: string, mode?: string) =>
      set!.tokens.find((t) => t.name === name && t.mode === mode)?.value;
    expect(set!.modes).toEqual(["dark"]);
    expect(get("color.gray.500")).toBe("#6A7282");
    expect(get("color.background")).toBe("#FFFFFF");
    expect(get("color.background", "dark")).toBe("#020817");
    expect(get("color.foreground", "dark")).toBe("#F8FAFC");
    expect(get("color.primary")).toBe("#2563EB");
    expect(get("color.primary", "dark")).toBe("#60A5FA");
    expect(get("color.ring")).toBe("#93C5FD");
    expect(get("color.surface", "dark")).toBe("#020817");
    expect(set!.tokens.some((t) => t.cssVar === "--button-bg")).toBe(false);
    expect(set!.tokens.some((t) => t.cssVar === "--font-display")).toBe(false);
  });

  it("skips component-scoped properties", async () => {
    const set = await loadTokens(`${F}/palette.css`);
    expect(set!.tokens.some((t) => t.cssVar === "--color-card-local")).toBe(false);
  });

  it("classifies block contexts", () => {
    expect(modeForContext([":root"])).toBeUndefined();
    expect(modeForContext(["@theme inline"])).toBeUndefined();
    expect(modeForContext([".dark"])).toBe("dark");
    expect(modeForContext(['[data-theme="midnight"]'])).toBe("midnight");
    expect(modeForContext([":root.theme-ocean"])).toBe("ocean");
    expect(modeForContext(["@media (prefers-color-scheme: dark)", ":root"])).toBe("dark");
    expect(modeForContext(["@layer base", ":root, :where(.light)"])).toBe("light");
    expect(modeForContext([".button"])).toBeNull();
    expect(modeForContext(["@font-face"])).toBeNull();
    expect(modeForContext(["@media (min-width: 40rem)"])).toBeNull();
  });

  it("extracts declarations, ignoring comments, strings and !important", () => {
    const decls = extractDeclarations(
      `/* :root { --c: red } */ :root { --a: #fff !important; --b: url("{;}"); color: red; }
       .x { --hidden: blue }`,
    );
    expect(decls).toEqual([
      { prop: "--a", value: "#fff", mode: undefined },
      { prop: "--b", value: 'url("{;}")', mode: undefined },
    ]);
  });

  it("detects circular var() references", () => {
    expect(() =>
      tokensFromDeclarations([
        { prop: "--a", value: "var(--b)", mode: undefined },
        { prop: "--b", value: "var(--a)", mode: undefined },
      ]),
    ).toThrow("Circular alias: --a → --b → --a");
  });

  it("warns about color-named properties that are not colors", () => {
    const warnings: string[] = [];
    tokensFromDeclarations(
      [
        { prop: "--color-x", value: "banana", mode: undefined },
        { prop: "--color-y", value: "var(--missing)", mode: undefined },
        { prop: "--color-z", value: "var(--q", mode: undefined },
      ],
      { warnings },
    );
    expect(warnings).toEqual([
      '--color-x: "banana" is not a color; skipped',
      "--color-y: Token --color-y references --missing, which does not exist",
      '--color-z: --color-z: unbalanced var() in "var(--q"',
    ]);
  });

  it("builds tokens from a live page's computed custom properties", () => {
    const tokens = tokensFromComputedProperties(
      { "--color-bg": " #0b1020", "--radius": "8px", "--brand": "oklch(0.6 0.2 260)" },
      "dark",
    );
    expect(tokens.map((t) => [t.name, t.mode])).toEqual([
      ["color.bg", "dark"],
      ["color.brand", "dark"],
    ]);
  });
});

describe("discovery", () => {
  it("prefers tokens.json, then *.tokens.json, then a Tailwind config", async () => {
    const a = await tempDir({ "tokens.json": "{}", "x.tokens.json": "{}", "tailwind.config.js": "" });
    expect(discoverTokenFiles(a)).toEqual([join(a, "tokens.json")]);
    const b = await tempDir({ "b.tokens.json": "{}", "a.tokens.json": "{}", "tailwind.config.ts": "" });
    expect(discoverTokenFiles(b)).toEqual([join(b, "a.tokens.json"), join(b, "b.tokens.json")]);
    const c = await tempDir({ "tailwind.config.mjs": "", "readme.md": "" });
    expect(discoverTokenFiles(c)).toEqual([join(c, "tailwind.config.mjs")]);
    expect(discoverTokenFiles(join(c, "missing"))).toEqual([]);
  });

  it("auto-detects from the working directory, or returns null", async () => {
    const dir = await tempDir({
      "tokens.json": JSON.stringify({ color: { brand: { $type: "color", $value: "#123456" } } }),
    });
    expect((await loadTokens(undefined, dir))!.tokens[0]!.value).toBe("#123456");
    expect(await loadTokens(undefined, await tempDir({}))).toBeNull();
  });

  it("accepts comma lists and rejects mixed or unknown formats", async () => {
    const set = await loadTokens(`${F}/modes/light.tokens.json,${F}/modes/dark.tokens.json,${F}/modes/base.tokens.json`);
    expect(set!.modes).toEqual(["dark", "light"]);
    await expect(loadTokens(`${F}/palette.css,${F}/palette.tokens.json`)).rejects.toThrow(/share one format/);
    expect(() => formatOf("tokens.yaml")).toThrow(/Unrecognized token file/);
    await expect(loadTokens(`${F}/nope.json`)).rejects.toThrow(/not found/);
    await expect(loadTokens(await tempDir({}))).rejects.toThrow(/No token files found/);
    await expect(loadTokenFiles([])).rejects.toThrow(/No token files/);
  });

  it("rejects files without color tokens", async () => {
    const dir = await tempDir({ "empty.json": "{}", "empty.css": ":root { --x: 1px }" });
    await expect(loadTokenFiles([join(dir, "empty.json")])).rejects.toThrow(/No color tokens/);
    await expect(loadTokenFiles([join(dir, "empty.css")])).rejects.toThrow(/No color tokens/);
  });
});

describe("names and printing", () => {
  it("normalizes names", () => {
    expect(canonicalName(["colors", "gray", "500"])).toBe("color.gray.500");
    expect(canonicalName(["brand"])).toBe("color.brand");
    expect(cssVarFor("color.lightBlue.500")).toBe("--color-light-blue-500");
    expect(nameFromCssVar("--color-gray-500")).toBe("color.gray.500");
    expect(groupOf("color.gray.500")).toBe("gray");
    expect(naturalCompare("a10", "a9")).toBeGreaterThan(0);
    expect(naturalCompare("a", "a1")).toBeLessThan(0);
  });

  it("prints a readable table", async () => {
    const set = await loadTokens(`${F}/semantic.tokens.json`);
    const plain = formatTokenTable(set!);
    expect(plain).toContain("10 color tokens · dtcg");
    expect(plain).toMatch(/color\.text\.muted\s+#374151\s+dark\s+--color-text-muted\s+color\.gray\.700/);
    expect(plain).toContain("* outside sRGB; gamut-mapped in OKLCH");
    expect(formatTokenTable(set!, { color: true })).toContain("\u001b[48;2;");
    const css = await loadTokens(`${F}/theme.css`);
    expect(formatTokenTable(css!)).toContain("modes: dark");
  });
});
