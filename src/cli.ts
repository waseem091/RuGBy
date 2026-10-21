#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { checkContrast } from "./check.js";
import { ColorParseError } from "./color/parse.js";
import { UsageError } from "./errors.js";
import { writeAllRgbFixture } from "./fixture.js";
import { loadTokens } from "./tokens/detect.js";
import { formatTokenTable } from "./tokens/print.js";
import { TokenError } from "./tokens/types.js";
import { colorEnabled, createStyle } from "./util/ansi.js";
import { VERSION } from "./version.js";

const EXIT = { clean: 0, findings: 1, usage: 2, internal: 3 } as const;

function positiveNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("expected a positive number");
  return n;
}

function level(value: string): "AA" | "AAA" {
  const v = value.toUpperCase();
  if (v !== "AA" && v !== "AAA") throw new InvalidArgumentError("expected AA or AAA");
  return v;
}

const program = new Command();
program
  .name("rugby")
  .description("Audit the colors a browser actually paints: contrast and design-token drift.")
  .version(VERSION)
  .showHelpAfterError()
  // Subcommands inherit this: argument errors exit 2, --help/--version exit 0.
  .exitOverride((err) => process.exit(err.exitCode === 0 ? EXIT.clean : EXIT.usage));

program
  .command("tokens")
  .description("parse a token file (W3C design tokens JSON, Tailwind config or CSS) and print it")
  .argument("[file]", "token file, comma-separated files, or a directory (default: auto-detect)")
  .option("--json", "print the normalized token set as JSON")
  .action(async (file: string | undefined, opts: { json?: boolean }) => {
    const set = await loadTokens(file);
    if (!set) {
      throw new UsageError(
        "No token file found. Pass one, or add tokens.json, *.tokens.json or tailwind.config.* here.",
      );
    }
    if (opts.json) process.stdout.write(`${JSON.stringify(set, null, 2)}\n`);
    else process.stdout.write(formatTokenTable(set, { color: colorEnabled() }));
  });

program
  .command("contrast")
  .description("check the contrast of one foreground/background pair (WCAG 2.x and APCA)")
  .argument("<foreground>", "text color, any CSS color")
  .argument("<background>", "background color, any CSS color")
  .option("--size <px>", "font size in px", positiveNumber, 16)
  .option("--weight <n>", "font weight (100-900)", positiveNumber, 400)
  .option("--level <AA|AAA>", "WCAG level", level, "AA")
  .option("--json", "print JSON")
  .action(
    (
      fg: string,
      bg: string,
      opts: { size: number; weight: number; level: "AA" | "AAA"; json?: boolean },
    ) => {
      const r = checkContrast(fg, bg, {
        fontSizePx: opts.size,
        fontWeight: opts.weight,
        level: opts.level,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        return;
      }
      const s = createStyle(colorEnabled());
      const mark = (ok: boolean) => (ok ? s.green("pass") : s.red("fail"));
      const lines = [
        `${s.bold(r.foreground)} on ${s.bold(r.background)}  ${s.dim(`${r.fontSizePx}px / ${r.fontWeight}${r.largeText ? " (large text)" : ""}`)}`,
        `  WCAG 2.x  ${s.bold(`${r.wcag.ratio.toFixed(2)}:1`)}  ${mark(r.wcag.pass)} ${opts.level} (needs ${r.wcag.required}:1)`,
        `            AA normal ${mark(r.wcag.AA.normal)} · AA large ${mark(r.wcag.AA.large)} · AAA normal ${mark(r.wcag.AAA.normal)} · AAA large ${mark(r.wcag.AAA.large)}`,
        `  APCA      ${s.bold(`Lc ${r.apca.lc.toFixed(1)}`)}  ${mark(r.apca.pass)} (needs |Lc| ${r.apca.required}${r.apca.prohibited ? ", size/weight below APCA minimum" : ""})`,
        ...r.notes.map((n) => s.dim(`  note: ${n}`)),
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    },
  );

program
  .command("fixture")
  .description("regenerate the lossless all-RGB test PNG (fixtures/allrgb.png)")
  .option("-o, --out <path>", "output path", "fixtures/allrgb.png")
  .action(async (opts: { out: string }) => {
    const path = await writeAllRgbFixture(opts.out);
    process.stdout.write(`wrote ${path}\n`);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (
    error instanceof UsageError ||
    error instanceof TokenError ||
    error instanceof ColorParseError
  ) {
    process.stderr.write(`rugby: ${error.message}\n`);
    process.exit(EXIT.usage);
  }
  process.stderr.write(`rugby: internal error: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(EXIT.internal);
}
