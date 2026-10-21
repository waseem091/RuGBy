# AGENTS.md

Guidance for AI coding agents working in a project that uses RuGBy, and for agents working on RuGBy itself.

## When to use RuGBy

Use it whenever you change how something **looks**: colors, themes, dark mode, design tokens, Tailwind classes, CSS variables, backgrounds, images behind text, opacity, filters or blend modes. Linters only read source; RuGBy renders the page and measures the pixels the browser actually paints:

- **Contrast**: the WCAG 2.x ratio (and APCA Lc) of each text element against every background pixel under it. This includes gradients, photos, scrims, `backdrop-filter` and `mix-blend-mode`, where axe-core says "incomplete".
- **Drift**: every rendered color that isn't a design token, traced to the CSS rule that produced it.

## Commands

```sh
npx rugby audit http://localhost:3000 --tokens tokens.json        # audit a running app
npx rugby audit ./dist --dark-class dark                          # serve and audit a static build
npx rugby audit http://localhost:3000 --json > rugby.json         # machine-readable report
npx rugby contrast "#6b7280" "#ffffff" --size 14                  # check one pair
npx rugby tokens tokens.json                                      # see the normalized tokens
```

Useful options: `--viewports 375,1440`, `--schemes light,dark`, `--standard wcag2|apca|both`, `--level AA|AAA`, `--selector main`, `--hide ".cookie-banner"`, `--fail-on contrast,drift`, `--no-html`.

Exit codes: `0` clean, `1` findings matching `--fail-on`, `2` bad input, `3` internal error.

## Reading the report

The JSON follows [`docs/report-schema.md`](docs/report-schema.md).

- `type: "contrast"`: `wcag.ratio` is the 5th-percentile ratio (the verdict), `wcag.required` the threshold, `background.worst` the deciding background pixel, `axeVerdict` what axe said. `suggestion.replacement` is the edit to make, e.g. `color: var(--color-gray-700)`. Its `ratio` was re-measured over the same pixels, so it passes.
- `type: "drift"`: `color` is the rendered color, `source.rule` / `source.stylesheet` / `source.line` locate the declaration, `nearestToken` is the closest token, `label: "likely-typo"` means a near-copy (ΔE < 0.5), and `suggestion.replacement` is the edit (`#6b7281 → var(--color-gray-500)`, `text-[#6b7281] → text-gray-500`).
- `cause` on a drift finding (e.g. `opacity 0.6`, `filter: brightness(0.85)`) means the authored value is a token but the rendered color isn't. Fix the opacity or filter, or use the token that matches the intended result.

## The loop

1. `npx rugby audit <url> --tokens <tokens> --json --no-html > before.json`
2. For each finding, apply `suggestion.replacement` at `source.stylesheet:source.line` (drift), or to the element at `selector` (contrast). Prefer changing the token reference over hard-coding a hex value.
3. Re-run the audit and compare: the finding should be gone and nothing new should appear.
4. If `suggestion` is `null`, read `notes`. Usually no token passes on that background (fix the background or add a token), or the text is faded by `opacity`.

From an MCP client, use the `rugby-mcp` server: `rugby_audit` → edit → `rugby_audit` again. `rugby_contrast` checks a single pair and `rugby_tokens` lists tokens. All three tools are read-only; only the report folder is written.

## Working on RuGBy itself

- `pnpm install`, then `pnpm test` (Vitest, which builds `dist/` first), `pnpm run lint` (Biome) and `pnpm run typecheck`.
- Color math lives in `src/color/` and is checked against culori over all 16.7M colors (`RUGBY_EXHAUSTIVE=1 pnpm exec vitest run test/color/exhaustive.test.ts`).
- Contrast fixtures live in `fixtures/pages/`, with expected results in `fixtures/expected/`. Regenerate the expected values with `node scripts/compute-expected.mjs`; they are derived from first principles, never copied from tool output.
- Record every judgment call in `DECISIONS.md`.
