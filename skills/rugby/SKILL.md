---
name: rugby
description: Audit the colors a web page actually renders. Pixel-sampled text contrast (WCAG 2.x + APCA), including text on gradients, images, overlays, backdrop-filter and blend modes where axe-core says "incomplete", plus design-token drift traced to the CSS rule, with token-based fixes. Use after changing colors, themes, dark mode, design tokens, Tailwind classes or CSS variables, or when asked about contrast, accessibility of colors, or off-token colors.
---

# RuGBy

RuGBy renders pages in headless Chromium, measures every background pixel under each line of text, and compares every painted color with the design tokens.

## Run it

```sh
# A running app (start the dev server first):
npx rugby audit http://localhost:3000 --tokens tokens.json --json --no-html > rugby.json

# A static build folder (served automatically):
npx rugby audit ./dist --json --no-html > rugby.json

# Class-based dark mode (e.g. Tailwind darkMode: "class"):
npx rugby audit http://localhost:3000 --dark-class dark --json --no-html > rugby.json

# One color pair:
npx rugby contrast "#9ca3af" "#ffffff" --size 16 --weight 400
```

Tokens are auto-detected (`tokens.json`, `*.tokens.json`, `tailwind.config.*`, then the page's `:root` custom properties). Pass `--tokens` explicitly when you know the file. Pass `--tokens none` to skip drift.

## Read the findings

- **Contrast** (`type: "contrast"`): failing when `wcag.pass` is false. `wcag.ratio` is the 5th-percentile ratio over all sampled background pixels, `background.worst` the deciding pixel, `selector` the element, `axeVerdict` what axe said. `suggestion.replacement` (e.g. `color: var(--color-gray-700)`) is verified to pass.
- **Drift** (`type: "drift"`): a rendered color that isn't a token. `source.rule`, `source.stylesheet` and `source.line` point at the declaration; `suggestion.replacement` is the edit (`#6b7281 → var(--color-gray-500)`, `text-[#6b7281] → text-gray-500`). `label: "likely-typo"` is a near-copy of a token; `cause` (opacity, filter) means a token was altered at render time.

## Fix loop

1. Audit and save the JSON.
2. Apply each `suggestion.replacement` in the source file it points to (for contrast, find the element by `selector`). Prefer token references over raw hex.
3. Audit again. Confirm the finding is gone and nothing new appeared. Repeat until clean.
4. `suggestion: null` means no token passes on that background: change the background, raise the element's opacity (see `notes`), or ask whether a new token is needed. Don't invent hex values.

Exit code `1` means findings matched `--fail-on` (default `contrast`); `2` is bad input; `3` is an internal error.
