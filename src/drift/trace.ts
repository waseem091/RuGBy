/**
 * Trace a painted color back to the CSS declaration that produced it, via
 * the Chrome DevTools Protocol (`CSS.getMatchedStylesForNode`).
 */
import type { CDPSession, Page } from "playwright-core";

/** The slice of the CDP CSS domain this module reads (playwright-core does not export its Protocol types). */
interface CssProperty {
  name: string;
  value: string;
  important?: boolean;
  parsedOk?: boolean;
  disabled?: boolean;
  range?: { startLine: number };
}
interface CssStyle {
  styleSheetId?: string;
  cssProperties: CssProperty[];
}
interface CssRule {
  selectorList: { text: string };
  origin: string;
  style: CssStyle;
}
interface RuleMatch {
  rule: CssRule;
}
interface MatchedStyles {
  inlineStyle?: CssStyle;
  attributesStyle?: CssStyle;
  matchedCSSRules?: RuleMatch[];
  inherited?: { inlineStyle?: CssStyle; matchedCSSRules: RuleMatch[] }[];
}
interface SheetHeader {
  styleSheetId: string;
  sourceURL: string;
  isInline: boolean;
  startLine: number;
}

export interface SourceInfo {
  /** `selector { property: value }` as authored. */
  rule: string;
  selector: string;
  /** The declaration that won, e.g. `color: #6b7281`. */
  declaration: string;
  value: string;
  stylesheet: string | null;
  /** 1-based line in the stylesheet (or HTML document for inline <style>). */
  line?: number;
  /** `regular`, `user-agent`, `inline` (style attribute), `attributes` (SVG presentation attribute). */
  origin: string;
  /** True when the value was inherited from an ancestor. */
  inherited: boolean;
}

/** Declarations that can set each reported property (longhand first). */
const SETTERS: Record<string, string[]> = {
  color: ["-webkit-text-fill-color", "color"],
  "background-color": ["background-color", "background"],
  "border-color": [
    "border-color",
    "border",
    "border-top-color",
    "border-top",
    "border-block",
    "border-inline",
  ],
  "outline-color": ["outline-color", "outline"],
  "text-decoration-color": ["text-decoration-color", "text-decoration"],
  fill: ["fill"],
  stroke: ["stroke"],
  "box-shadow": ["box-shadow"],
};
for (const side of ["top", "right", "bottom", "left"]) {
  const logical = side === "top" || side === "bottom" ? "border-block" : "border-inline";
  SETTERS[`border-${side}-color`] = [
    `border-${side}-color`,
    `border-${side}`,
    "border-color",
    "border",
    logical,
  ];
}

const INHERITED = new Set(["color", "fill", "stroke"]);

interface Candidate {
  property: CssProperty;
  rule?: CssRule;
  style: CssStyle;
  origin: string;
}

function candidatesIn(
  rules: RuleMatch[] | undefined,
  inline: CssStyle | undefined,
  attributes: CssStyle | undefined,
  names: string[],
): Candidate[] {
  const out: Candidate[] = [];
  const add = (style: CssStyle, origin: string, rule?: CssRule) => {
    for (const p of style.cssProperties) {
      if (!names.includes(p.name) || p.disabled || p.parsedOk === false) continue;
      // Skip longhands the browser expanded from a shorthand; the shorthand itself is listed.
      if (!p.range && origin !== "attributes" && rule?.origin !== "user-agent") continue;
      out.push({ property: p, style, origin, ...(rule ? { rule } : {}) });
    }
  };
  if (attributes) add(attributes, "attributes");
  for (const m of rules ?? []) add(m.rule.style, m.rule.origin, m.rule);
  if (inline) add(inline, "inline");
  return out;
}

/** The cascade winner: !important beats normal, later beats earlier. */
function winner(candidates: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (!best || !!c.property.important >= !!best.property.important) best = c;
  }
  return best;
}

export class Tracer {
  private sheets = new Map<string, SheetHeader>();
  private matched = new Map<number, Promise<MatchedStyles | null>>();

  private constructor(
    private readonly cdp: CDPSession,
    private readonly pageUrl: string,
  ) {
    cdp.on("CSS.styleSheetAdded", ({ header }) => this.sheets.set(header.styleSheetId, header));
  }

  static async create(page: Page): Promise<Tracer> {
    const cdp = await page.context().newCDPSession(page);
    const tracer = new Tracer(cdp, page.url());
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    return tracer;
  }

  private async stylesFor(index: number) {
    const { result } = await this.cdp.send("Runtime.evaluate", {
      expression: `window.__rugby.colorEls[${index}]`,
    });
    if (!result.objectId) return null;
    const { nodeId } = await this.cdp.send("DOM.requestNode", { objectId: result.objectId });
    if (!nodeId) return null;
    let pending = this.matched.get(nodeId);
    if (!pending) {
      pending = this.cdp.send("CSS.getMatchedStylesForNode", { nodeId }).catch(() => null);
      this.matched.set(nodeId, pending);
    }
    return pending;
  }

  private describe(c: Candidate, inherited: boolean): SourceInfo {
    const decl = `${c.property.name}: ${c.property.value}${c.property.important ? " !important" : ""}`;
    const selector =
      c.origin === "inline"
        ? "element.style"
        : c.origin === "attributes"
          ? "[presentation attribute]"
          : (c.rule?.selectorList.text ?? "");
    const header = c.style.styleSheetId ? this.sheets.get(c.style.styleSheetId) : undefined;
    let stylesheet: string | null = null;
    if (c.origin === "inline" || c.origin === "attributes") stylesheet = this.pageUrl;
    else if (header) stylesheet = header.sourceURL || (header.isInline ? this.pageUrl : null);
    const range = c.property.range;
    const line =
      range && header && c.origin !== "inline" ? header.startLine + range.startLine + 1 : undefined;
    return {
      rule: `${selector} { ${decl} }`,
      selector,
      declaration: decl,
      value: c.property.value,
      stylesheet,
      ...(line !== undefined ? { line } : {}),
      origin: c.origin,
      inherited,
    };
  }

  /** Find the declaration behind `property` on `window.__rugby.colorEls[index]`. */
  async trace(index: number, property: string): Promise<SourceInfo | null> {
    const names = SETTERS[property] ?? [property];
    let styles: MatchedStyles | null;
    try {
      styles = await this.stylesFor(index);
    } catch {
      return null;
    }
    if (!styles) return null;
    const own = winner(
      candidatesIn(styles.matchedCSSRules, styles.inlineStyle, styles.attributesStyle, names),
    );
    if (own) return this.describe(own, false);
    if (!INHERITED.has(property)) return null;
    for (const entry of styles.inherited ?? []) {
      const found = winner(
        candidatesIn(entry.matchedCSSRules, entry.inlineStyle, undefined, names),
      );
      if (found) return this.describe(found, true);
    }
    return null;
  }

  async close(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}
