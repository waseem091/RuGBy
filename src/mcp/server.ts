/**
 * MCP server: read-only tools whose results are RuGBy JSON, so an agent can
 * audit, apply a suggested fix, and audit again. The only files it writes are
 * the report folder (screenshots, report.json, index.html).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runAudit } from "../audit/run.js";
import { checkContrast } from "../check.js";
import { writeHtmlReport } from "../report/html.js";
import { loadTokens } from "../tokens/detect.js";
import { VERSION } from "../version.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const failure = (error: unknown): ToolResult => ({
  content: [{ type: "text", text: `rugby: ${(error as Error).message ?? String(error)}` }],
  isError: true,
});

export function createServer(options: { cwd?: string } = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer({ name: "rugby", version: VERSION });

  server.registerTool(
    "rugby_audit",
    {
      title: "Audit rendered colors",
      description:
        "Render pages in headless Chromium and report pixel-sampled text contrast (WCAG 2.x + APCA, including text on gradients, images, overlays and blend modes, where axe-core says 'incomplete') and design-token drift traced to the CSS rule, with token-based fix suggestions. Returns the JSON report. Writes only the report folder.",
      inputSchema: {
        targets: z
          .array(z.string())
          .min(1)
          .describe("URLs, local .html files or build directories"),
        tokens: z
          .string()
          .optional()
          .describe("Token file(s) or directory; 'none' to skip; default auto-detect"),
        viewports: z
          .array(z.number().int().min(200).max(4000))
          .optional()
          .describe("Viewport widths, default [375, 1440]"),
        schemes: z
          .array(z.enum(["light", "dark"]))
          .optional()
          .describe("Color schemes, default both"),
        standard: z.enum(["wcag2", "apca", "both"]).optional(),
        level: z.enum(["AA", "AAA"]).optional(),
        selector: z.string().optional().describe("Limit the audit to part of the page"),
        darkClass: z
          .string()
          .optional()
          .describe("Class toggled on <html> for dark mode, e.g. 'dark'"),
        maxPages: z.number().int().positive().optional(),
        includeChecks: z.boolean().optional().describe("Include every measured text element"),
        reportDir: z.string().optional().describe("Report folder, default 'rugby-report'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const reportDir = args.reportDir ?? "rugby-report";
        const report = await runAudit({
          targets: args.targets,
          tokens: args.tokens === "none" ? null : args.tokens,
          ...(args.viewports ? { viewports: args.viewports } : {}),
          ...(args.schemes ? { schemes: args.schemes } : {}),
          ...(args.standard ? { standard: args.standard } : {}),
          ...(args.level ? { level: args.level } : {}),
          ...(args.selector ? { selector: args.selector } : {}),
          ...(args.darkClass ? { darkClass: args.darkClass } : {}),
          ...(args.maxPages ? { maxPages: args.maxPages } : {}),
          includeChecks: !!args.includeChecks,
          reportDir,
          cwd,
        });
        await writeHtmlReport(report, `${reportDir}/index.html`, cwd);
        return json(report);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "rugby_contrast",
    {
      title: "Check one color pair",
      description:
        "WCAG 2.x ratio (AA/AAA, normal and large text) and APCA Lc for a text color on a background color.",
      inputSchema: {
        foreground: z.string().describe("Text color, any CSS color"),
        background: z.string().describe("Background color, any CSS color"),
        fontSizePx: z.number().positive().optional(),
        fontWeight: z.number().positive().optional(),
        level: z.enum(["AA", "AAA"]).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return json(
          checkContrast(args.foreground, args.background, {
            ...(args.fontSizePx ? { fontSizePx: args.fontSizePx } : {}),
            ...(args.fontWeight ? { fontWeight: args.fontWeight } : {}),
            ...(args.level ? { level: args.level } : {}),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "rugby_tokens",
    {
      title: "Read design tokens",
      description:
        "Parse W3C design tokens JSON, a Tailwind config or CSS custom properties into RuGBy's normalized token list (name, CSS variable, hex value, mode, alias).",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Token file(s) or directory; default auto-detect in the working directory"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const set = await loadTokens(args.path, cwd);
        if (!set)
          throw new Error("No token file found (tokens.json, *.tokens.json or tailwind.config.*)");
        return json(set);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
