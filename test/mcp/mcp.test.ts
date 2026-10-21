/** Smoke test: spawn the real rugby-mcp binary over stdio and call its tools. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let client: Client;
const cwd = mkdtempSync(join(tmpdir(), "rugby-mcp-"));

const text = (result: unknown) => {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0]!.text;
};

beforeAll(async () => {
  client = new Client({ name: "rugby-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/mcp/bin.js")],
      cwd,
      stderr: "pipe",
    }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
});

describe("rugby-mcp", () => {
  it("lists three read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "rugby_audit",
      "rugby_contrast",
      "rugby_tokens",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("rugby_contrast returns WCAG and APCA for a pair", async () => {
    const result = await client.callTool({
      name: "rugby_contrast",
      arguments: { foreground: "#777", background: "#fff" },
    });
    const body = JSON.parse(text(result));
    expect(body.wcag.ratio).toBe(4.48);
    expect(body.wcag.pass).toBe(false);
    expect(body.apca.lc).toBeCloseTo(71.1, 1);
  });

  it("reports errors as tool errors", async () => {
    const result = await client.callTool({
      name: "rugby_contrast",
      arguments: { foreground: "blue-ish", background: "#fff" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Could not parse "blue-ish"');
  });

  it("rugby_tokens parses a token file", async () => {
    const result = await client.callTool({
      name: "rugby_tokens",
      arguments: { path: resolve("fixtures/tokens/palette.tokens.json") },
    });
    expect(JSON.parse(text(result)).tokens).toHaveLength(38);
    const missing = await client.callTool({ name: "rugby_tokens", arguments: {} });
    expect(missing.isError).toBe(true);
  });

  it("rugby_audit audits a page and writes only the report folder", async () => {
    const result = await client.callTool({
      name: "rugby_audit",
      arguments: {
        targets: [resolve("fixtures/pages/linear-gradient.html")],
        tokens: resolve("fixtures/tokens/palette.tokens.json"),
        viewports: [1440],
        schemes: ["light"],
      },
    });
    const report = JSON.parse(text(result));
    expect(report.findings.some((f: { selector: string }) => f.selector === "#cta")).toBe(true);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(cwd)).toEqual(["rugby-report"]);
    expect(readdirSync(join(cwd, "rugby-report")).sort()).toEqual([
      "index.html",
      "report.json",
      "shots",
    ]);
  }, 60_000);
});
