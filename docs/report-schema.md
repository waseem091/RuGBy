# RuGBy report schema

`rugby audit --json` prints this object, the Node API (`audit()`) returns it, and the HTML report writes it to `report.json` next to `index.html`. The machine-readable version is [`schema/report.schema.json`](../schema/report.schema.json) (JSON Schema draft-07). A test validates real audit output against it.

The output is deterministic: the same input gives byte-identical JSON. Everything is sorted, local files appear as `local:/path` instead of a random port, token paths are relative to the working directory, and there's no timestamp unless you pass `--timestamps` (`generatedAt`).

## Top level

| Field | Type | Meaning |
|---|---|---|
| `tool` | `{ name: "rugby", version }` | Producer. |
| `generatedAt` | ISO date string | Only with `--timestamps`. |
| `options` | object | `viewports`, `schemes`, `standard` (`wcag2`/`apca`/`both`), `level` (`AA`/`AAA`), `driftThreshold`, `selector`. |
| `tokens` | object or `null` | `format` (`dtcg`, `tailwind`, `css`, `page`), `source`, `count`, `modes`. `page` means no token file was found and the pages' `:root` custom properties were used. |
| `summary` | object | Counts, below. |
| `pages` | array | One entry per page × viewport × scheme. |
| `findings` | array | Contrast findings (in page and document order), then drift findings (ranked). |
| `tokenUsage` | array | Per token: `used` (elements painted with it), `drifted` (near-miss occurrences whose nearest token is this one). Present when drift ran with tokens. |
| `checks` | array | Every measured text element, with the same fields as a contrast finding minus `type`/`severity`/`suggestion`/`screenshot`. Only with `--include-checks`. |

### `summary`

```json
{
  "pages": 3, "states": 12, "textChecked": 214,
  "findings": { "contrast": { "error": 5, "warning": 1 }, "drift": { "error": 0, "warning": 4, "info": 1 } },
  "axe": { "missed": 4, "incomplete": 9, "incompleteResolved": 9, "incompleteFailed": 3 }
}
```

- `axe.missed`: RuGBy contrast failures where axe-core said `pass` or `incomplete`, or didn't check the element.
- `axe.incomplete`: elements axe left `incomplete` ("needs review"), which most CI setups treat as a pass.
- `axe.incompleteResolved` / `incompleteFailed`: how many of those RuGBy measured from real pixels, and how many failed.

## Contrast finding

```json
{
  "type": "contrast",
  "severity": "error",
  "page": "http://localhost:3000/pricing",
  "viewport": 375,
  "scheme": "dark",
  "selector": "main > section.hero h2",
  "text": "Start your free trial",
  "fontSizePx": 18, "fontWeight": 400, "largeText": false,
  "foreground": "#9CA3AF",
  "background": { "kind": "gradient", "worst": "#D1D5DB", "median": "#E5E7EB", "sampled": 412 },
  "wcag": { "ratio": 1.72, "min": 1.6, "median": 1.9, "required": 4.5, "pass": false },
  "apca": { "lc": -28.1, "required": 75, "pass": false },
  "axeVerdict": "incomplete",
  "suggestion": { "token": "color.gray.700", "value": "#374151", "target": "foreground", "ratio": 7.1, "lc": 72.4, "against": "#E5E7EB", "deltaE": 30.2, "replacement": "color: var(--color-gray-700)" },
  "screenshot": "rugby-report/shots/0007.png",
  "notes": ["text-shadow present; contrast measured without it"],
  "alsoOn": ["http://localhost:3000/"]
}
```

| Field | Meaning |
|---|---|
| `severity` | `error` when the verdict fails and the background is solid or the median also fails; `warning` when only part of the text (on a non-uniform background) fails. |
| `selector` | A short unique CSS selector. Frames are joined with ` >>> `. |
| `foreground` | The text color as painted against the worst background: effective opacity (multiplied up the tree) and `mix-blend-mode` applied. |
| `background.kind` | `solid` (95% of pixels within ΔE 2.5 of the median), else `image` (a `url()` background or media element overlaps), `gradient` (a CSS gradient overlaps) or `mixed`. |
| `background.worst` | The background pixel at the 5th-percentile contrast: the verdict pixel. |
| `background.sampled` | Background pixels measured under the text's line boxes. |
| `wcag.ratio` | 5th-percentile ratio over all sampled pixels: the verdict. `min` and `median` are given too. Ratios are compared unrounded. |
| `wcag.required` | 4.5 or 3 (large text: ≥ 24px, or ≥ 18.66px at weight ≥ 700) at AA; 7 or 4.5 at AAA. |
| `apca.lc` | Signed APCA Lc (0.0.98G-4g) at the 5th percentile of \|Lc\|. `required` comes from the APCA font lookup table. |
| `axeVerdict` | axe-core `color-contrast` on the same element and page state: `pass`, `fail`, `incomplete` or `not-checked`. |
| `suggestion` | Best fix (see below), `null` when no token passes (a note says so), absent when suggestions are off. |
| `screenshot` | Annotated crop (text box + 16px padding, outlined), relative to the working directory. |
| `alsoOn` | Other pages where the same element failed identically (sticky headers, shared footers). |

## Drift finding

```json
{
  "type": "drift",
  "severity": "warning",
  "page": "http://localhost:3000/",
  "viewports": [375, 1440],
  "schemes": ["light", "dark"],
  "color": "#6B7281",
  "likelyTypo": true,
  "label": "likely-typo",
  "nearestToken": { "name": "color.gray.500", "value": "#6B7280", "deltaE": 0.16 },
  "property": "color",
  "selectors": ["a.footer-link", "p.muted"],
  "source": { "rule": ".muted { color: #6b7281 }", "stylesheet": "/_next/static/css/app.css", "line": 12, "origin": "regular" },
  "occurrences": 14,
  "cause": ["opacity 0.6"],
  "suggestion": { "token": "color.gray.500", "value": "#6B7280", "target": "foreground", "deltaE": 0.16, "replacement": "#6b7281 → var(--color-gray-500)" }
}
```

| Field | Meaning |
|---|---|
| `color` | The rendered color: the authored value composited up the tree through `opacity`, `filter` and translucent backgrounds. |
| `property` | `color`, `background-color`, `border-color` (or one side), `outline-color`, `text-decoration-color`, `fill`, `stroke` or `box-shadow`. |
| `likelyTypo` / `label` | ΔE below 0.5 from a token for an authored opaque value: almost always a hard-coded near-copy. |
| `severity` | `warning`; `info` for box-shadow colors (compared without alpha), which `--fail-on drift` ignores. |
| `source` | The winning declaration from CDP `CSS.getMatchedStylesForNode`: `rule` as authored, `stylesheet` URL, 1-based `line`, `origin` (`regular`, `inline` for style attributes, `attributes` for SVG presentation attributes). `null` when CDP was unavailable. |
| `occurrences` | Distinct page + element pairs. Findings are ranked by `occurrences × ΔE`. |
| `cause` | Why the rendered color differs from the authored one. |

A color is off-token when ΔE (OKLab ×100) to the nearest token exceeds `--drift-threshold` (default 2). An unmodified translucent value equal to a translucent token (a scrim) is on-token. Colors with no author declaration (initial values, user-agent defaults) are ignored.

## Suggestion

| Field | Meaning |
|---|---|
| `token` | Token name. Absent when no tokens were available and RuGBy computed the nearest passing lightness instead. |
| `value` | `#RRGGBB`. |
| `target` | `foreground` or `background`. |
| `ratio`, `lc` | Contrast after the change, re-measured over the same background pixels with the same 5th-percentile math. |
| `against` | The background pixel that decides the new verdict (it can differ from the current worst pixel on a gradient). |
| `deltaE` | Distance from the current color. |
| `replacement` | The concrete edit, e.g. `color: var(--color-gray-700)`, `#6b7281 → var(--color-gray-500)` or `text-[#6b7281] → text-gray-500`. |

## Page entry

```json
{
  "url": "local:/index.html", "viewport": 375, "scheme": "light", "status": "ok",
  "stats": {
    "textChecked": 31, "textSkipped": 2, "contrastFailures": 3,
    "axe": { "pass": 25, "fail": 1, "incomplete": 4, "not-checked": 1 },
    "axeIncompleteResolved": 4, "axeIncompleteFailed": 2, "axeMissed": 2
  },
  "notes": ["1 cross-origin frame(s) were not measured"]
}
```

`status: "error"` comes with an `error` message (for example an HTTP 404 or a navigation timeout); the audit carries on with the other pages.

## Exit codes

`0` clean · `1` findings matching `--fail-on` · `2` bad input or configuration · `3` internal error.
