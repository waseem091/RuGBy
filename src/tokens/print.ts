import { to8 } from "../color/format.js";
import { createStyle, padEnd } from "../util/ansi.js";
import type { TokenSet } from "./types.js";

/** Render a token set as a readable, aligned table. */
export function formatTokenTable(set: TokenSet, options: { color?: boolean } = {}): string {
  const s = createStyle(options.color ?? false);
  const header = ["", "token", "value", "mode", "css variable", "alias of"];
  const rows = set.tokens.map((t) => [
    s.swatch(to8(t.rgba.r), to8(t.rgba.g), to8(t.rgba.b)),
    t.name,
    t.value + (t.gamutMapped ? "*" : ""),
    t.mode ?? "",
    t.cssVar,
    t.aliasOf ?? "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  widths[0] = 2;
  const line = (cells: string[]) =>
    cells
      .map((c, i) => padEnd(c, widths[i]!))
      .join("  ")
      .trimEnd();
  const out = [
    s.bold(`${set.tokens.length} color tokens`) +
      s.dim(
        ` · ${set.format} · ${set.source}${set.modes.length ? ` · modes: ${set.modes.join(", ")}` : ""}`,
      ),
    "",
    s.dim(line(header)),
    ...rows.map(line),
  ];
  if (set.tokens.some((t) => t.gamutMapped))
    out.push("", s.dim("* outside sRGB; gamut-mapped in OKLCH"));
  for (const w of set.warnings) out.push(s.yellow(`warning: ${w}`));
  return `${out.join("\n")}\n`;
}
