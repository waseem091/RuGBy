import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Report } from "../audit/types.js";

/** Placeholder until the full HTML report lands: writes the JSON next to an index page. */
export async function writeHtmlReport(report: Report, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `<!doctype html><meta charset="utf-8"><title>RuGBy report</title><pre>${JSON.stringify(report, null, 2).replace(/</g, "&lt;")}</pre>`,
  );
}
