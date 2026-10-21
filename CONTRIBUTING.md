# Contributing to RuGBy

Thanks for helping. RuGBy's value is that its numbers are right, so most of this guide is about how claims get verified.

## Setup

```sh
pnpm install            # Node ≥ 20; also builds dist/ via `prepare`
pnpm exec playwright-core install chromium   # skip if PLAYWRIGHT_BROWSERS_PATH already has one
pnpm test
```

`pnpm test` builds `dist/` first (the CLI and MCP tests run the real binaries) and runs test files one at a time, because the browser suites compete for CPU otherwise.

## Before you open a pull request

- `pnpm run lint` (Biome: formatting and lint), `pnpm run typecheck`, `pnpm test` all pass.
- New behavior has a test. Contrast behavior gets a fixture page.
- Judgment calls go in `DECISIONS.md`: what you chose, why, and the alternative.

## Where things live

| Path | What |
|---|---|
| `src/color/` | Color math: parsing, conversions, gamut mapping, compositing, blend modes, filters, WCAG, APCA, ΔE. No dependencies. |
| `src/tokens/` | DTCG, Tailwind and CSS custom-property loaders, normalized to one shape. |
| `src/audit/` | The browser engine: page preparation, the in-page script (`page-script.ts`, serialized into the page, so keep it self-contained), pixel sampling, axe comparison. |
| `src/drift/` | Painted-color collection, render compositing, token matching, CDP source tracing, grouping. |
| `src/suggest/` | Fix suggestions, re-evaluated over the measured pixels. |
| `src/report/` | Terminal, JSON and HTML output. |
| `src/mcp/` | The `rugby-mcp` server. |
| `fixtures/pages/` + `fixtures/expected/` | Contrast fixtures and their expected results. |
| `fixtures/drift-app/` | The drift fixture with five planted off-token colors. |
| `fixtures/tokens/` | The same palette in all three token formats, plus edge cases. |

## Adding a contrast fixture

1. Add `fixtures/pages/<name>.html`. Design it so the worst-case background is known exactly: put a flat region of the worst color where the text starts, covering at least 5% of the text's pixels at every viewport. The 5th-percentile verdict then doesn't depend on font metrics.
2. Add its expectations to `scripts/compute-expected.mjs`, derived from the CSS (colors, compositing, blend formulas), never from RuGBy's own output. Then run `node scripts/compute-expected.mjs`.
3. `pnpm exec vitest run test/audit/fixtures.test.ts`. The `axe` field records what axe-core really says; check it by hand when you add a row.

## Color math changes

Run the exhaustive oracle test before and after: `RUGBY_EXHAUSTIVE=1 pnpm exec vitest run test/color/exhaustive.test.ts` (about 45 s, all 16,777,216 colors against culori). culori is a dev dependency used only as a test oracle and must never be imported from `src/`.

## Determinism

The same input must produce byte-identical JSON. Sort everything, keep timestamps behind `--timestamps`, and normalize machine-specific values (local server ports become `local:/`, token paths are relative). `test/audit/drift.test.ts` checks this.

## Scope rules for real-world audits

Only audit public pages, read-only: no logins, no form submissions, no more than one page every 2 seconds per host (the built-in rate limiter enforces this). Don't contact site owners about findings through RuGBy's repository.
