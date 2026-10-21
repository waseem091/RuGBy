# RuGBy

**RuGBy audits the colors a browser actually paints**: pixel-sampled text contrast (WCAG 2.x and APCA) on gradients, photos, overlays and blend modes, plus drift between rendered colors and your design tokens.

> Work in progress. See `MORNING_REPORT.md` for current status.

```sh
npx rugby audit http://localhost:3000 --tokens tokens.json
npx rugby contrast "#777" "#fff"
npx rugby fixture   # regenerate the lossless all-RGB test PNG
```

## History

RuGBy began as a Figma plugin and "all-RGB pixel engine" that turned hex ranges into one-pixel rectangles and stitched all 16,777,216 RGB colors into a 4096×4096 image. The plugin now lives in `legacy/figma/`; its all-RGB image survives as `rugby fixture`, a lossless test fixture that the color math is checked against exhaustively.
