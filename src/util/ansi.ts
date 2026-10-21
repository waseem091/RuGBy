/** Tiny ANSI helper that respects NO_COLOR / FORCE_COLOR and TTY detection. */
export interface Style {
  enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  /** A two-space truecolor swatch. */
  swatch(r8: number, g8: number, b8: number): string;
}

export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return !!stream.isTTY;
}

export function createStyle(enabled: boolean): Style {
  const wrap = (open: string, close: string) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    enabled,
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    yellow: wrap("33", "39"),
    green: wrap("32", "39"),
    cyan: wrap("36", "39"),
    magenta: wrap("35", "39"),
    swatch: (r, g, b) => (enabled ? `\u001b[48;2;${r};${g};${b}m  \u001b[49m` : "  "),
  };
}

/** Visible width of a string, ignoring ANSI escapes. */
export function visibleLength(s: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
  return s.replace(/\u001b\[[0-9;]*m/g, "").length;
}

export function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleLength(s)));
}
