/**
 * Rendered color of a painted property: composite the authored value up the
 * ancestor tree exactly as CSS paints solid colors. Each element is a layer
 * (its content over its own background), filtered by its own `filter`, faded
 * by its own `opacity`, then composited over its parent's background, and so
 * on up to the canvas.
 */

import type { ColorNode } from "../audit/page-script.js";
import { applyFilters, compositeOver, parseFilter, withAlpha } from "../color/composite.js";
import { tryParseColor } from "../color/parse.js";
import type { Rgba } from "../color/types.js";

export interface RenderedColor {
  /** Authored value (gamut-mapped sRGB, with alpha). */
  raw: Rgba;
  /** What the browser paints (opaque). */
  rendered: Rgba;
  /** Why rendered differs from raw (empty when it doesn't). */
  causes: string[];
  /** True when opacity or a filter changed the color (not just alpha compositing). */
  modified: boolean;
  /** A background image sits somewhere behind: the backdrop is approximate. */
  unknownBackdrop: boolean;
  gamutMapped: boolean;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, alpha: 0 };
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function renderColor(
  prop: string,
  value: string,
  nodeIndex: number,
  nodes: ColorNode[],
  canvas: string,
): RenderedColor | null {
  const parsed = tryParseColor(value);
  if (!parsed) return null;
  const raw = parsed.rgba;
  const causes: string[] = [];
  if (prop === "box-shadow") {
    // Shadows are almost always translucent black by design: compare the authored color.
    return {
      raw,
      rendered: { ...raw, alpha: 1 },
      causes,
      modified: false,
      unknownBackdrop: false,
      gamutMapped: parsed.gamutMapped,
    };
  }
  if (raw.alpha < 1) causes.push(`alpha ${fmt(raw.alpha)} composited over the backdrop`);
  const bgOf = (n: ColorNode) => tryParseColor(n.bg)?.rgba ?? TRANSPARENT;
  let modified = false;
  let unknownBackdrop = false;
  let node: ColorNode | undefined = nodes[nodeIndex];
  if (!node) return null;
  // Content painted inside the element's own layer.
  let inner = prop === "background-color" ? raw : compositeOver(raw, bgOf(node));
  if (prop !== "background-color" && node.bgImage) unknownBackdrop = true;
  let first = true;
  while (node) {
    if (!first) {
      inner = compositeOver(inner, bgOf(node));
      if (node.bgImage) unknownBackdrop = true;
    }
    first = false;
    const filters = parseFilter(node.filter);
    if (filters.length) {
      inner = applyFilters(inner, filters);
      modified = true;
      causes.push(`filter: ${node.filter}`);
    }
    if (node.opacity < 1) {
      inner = withAlpha(inner, node.opacity);
      modified = true;
      causes.push(`opacity ${fmt(node.opacity)}`);
    }
    node = node.parent >= 0 ? nodes[node.parent] : undefined;
  }
  const base = tryParseColor(canvas)?.rgba ?? { r: 1, g: 1, b: 1, alpha: 1 };
  const rendered = compositeOver(inner, { ...base, alpha: 1 });
  if (unknownBackdrop && (raw.alpha < 1 || modified)) {
    causes.push("over a background image; composited over its fallback color");
  }
  return {
    raw,
    rendered: { ...rendered, alpha: 1 },
    causes: [...new Set(causes)],
    modified,
    unknownBackdrop,
    gamutMapped: parsed.gamutMapped,
  };
}
