# Decisions

One line per decision: what was chosen, why, and the alternative.

## Process

- **Branch:** worked on `claude/blissful-pascal-p4qr6q` (the branch this session was assigned by its harness) instead of `claude/tender-planck-1vd81z` named in the build prompt; the harness forbids pushing anywhere else. Alternative: the prompt's branch name.
- **Package manager:** pnpm 10 (available in the environment). `pnpm.onlyBuiltDependencies` allow-lists esbuild/biome install scripts. Alternative: npm.

## Tooling

- **Lint/format:** Biome (one dev dependency instead of eslint + prettier + plugins). Alternative: eslint + prettier.
- **Pinned versions:** `playwright-core@1.56.1` because the environment's preinstalled Chromium (`/opt/pw-browsers/chromium-1194`) belongs to that release; TypeScript 5.9, Vitest 3.2 and Commander 14 (Commander 15 requires Node ≥ 22.12, the prompt requires Node ≥ 20). Alternative: latest of each.
- **PNG codec:** a small in-house encoder/decoder (`src/util/png.ts`, ~250 lines, `node:zlib` only) for the all-RGB fixture, screenshot sampling and report crops. Alternative: `pngjs` as a runtime dependency.
- **all-RGB fixture:** generated with the PNG Sub filter, which compresses the 48 MiB of pixels to ~186 KB in under a second, so it is cheap to regenerate in every test run. Alternative: commit it (forbidden by the prompt).

## Blockers

- **Public sites are unreachable from this environment.** The sandbox's egress policy answers 403 to CONNECT for ui.shadcn.com, nextjs.org, developer.mozilla.org, tailwindcss.com, vercel.com, radix-ui.com and example.com (checked 2026-10-21). Phase 9 (real-world validation) cannot use live sites from here; see `docs/case-studies.md`.

## Color core

- **WCAG linearization threshold:** 0.04045 (IEC sRGB) rather than WCAG's printed 0.03928; no 8-bit value falls between them, which the exhaustive test confirms against a 0.03928 reference. Alternative: 0.03928.
- **APCA required-Lc table:** the 0.0.98G-4g "font lookup table" (rows 14–96px, weights 100–900). Sizes between rows use the next smaller row; sizes below 14px use the 14px row; cells APCA marks "do not use" require Lc 100 and are flagged `prohibited`. The table was transcribed from memory of the published README (no network access to re-check it). **Owner should verify against apca-w3.** Alternative: apca-w3's inverse `fontLookupAPCA`.
- **Gamut mapping:** CSS Color 4 OKLCH chroma reduction (binary search, JND 0.02) for every space, not just Display-P3. Alternative: plain clipping.
- **ΔE:** Euclidean OKLab ×100 (ΔEOK); ΔE in OKLCH is the same distance. Alternative: CIEDE2000.
- **culori as oracle only:** its `hard-light`/`overlay` blend formulas are wrong (`2s(1-b)-1` instead of Screen), so those two modes are tested against the spec formula instead; its Lab D50 adaptation differs from CSS Color 4 by ~1e-5 on a 0–100 scale.
- **Compositing space:** all compositing, blend modes and CSS filter functions use gamma-encoded sRGB, matching how Chromium paints CSS (not linear light). Alternative: linearRGB (the SVG default).
- **Bare HSL triplets** (`222.2 84% 4.9%`, the shadcn/ui custom-property convention) parse as colors only when `bareHsl` is set, which the CSS-variable token loader does. Alternative: never accept them.
