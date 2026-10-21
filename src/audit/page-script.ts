/**
 * Code that runs inside the audited page. `installPageApi` is serialized by
 * Playwright (`page.evaluate(installPageApi)`), so it must be self-contained:
 * no imports, no references to module scope.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawTextItem {
  index: number;
  text: string;
  /** Line boxes in document coordinates, clipped by overflow ancestors. */
  rects: Rect[];
  /** Computed glyph fill color (`-webkit-text-fill-color`, which defaults to `color`). */
  color: string;
  /** Product of `opacity` over the element and its ancestors (across frames). */
  opacity: number;
  /** Nearest non-normal `mix-blend-mode` on the element or an ancestor. */
  blendMode: string;
  fontSizePx: number;
  fontWeight: number;
  textShadow: boolean;
  textStroke: boolean;
  /** Ancestor or overlapping backgrounds that make the backdrop non-solid. */
  hints: { gradient: boolean; image: boolean; backdropFilter: boolean };
  inFrame: boolean;
}

export interface CollectResult {
  items: RawTextItem[];
  skipped: { clipped: number; transparent: number; hidden: number; disabled: number };
  docWidth: number;
  docHeight: number;
  frames: { sameOrigin: number; crossOrigin: number };
}

export interface CollectOptions {
  rootSelector: string;
  maxItems: number;
}

/** One element in the ancestor table used to composite painted colors. */
export interface ColorNode {
  /** Computed background-color. */
  bg: string;
  opacity: number;
  /** Computed `filter`, or "none". */
  filter: string;
  /** True when the element paints a background image (url or gradient) or is media. */
  bgImage: boolean;
  /** Parent node index (across shadow roots and frames), -1 at the root. */
  parent: number;
}

/** A visible element and the colors it paints. */
export interface RawColorElement {
  /** Index into `PageApi.colorEls`. */
  index: number;
  node: number;
  /** [property, computed value] pairs for colors that are actually painted. */
  props: [string, string][];
}

export interface ColorCollectResult {
  nodes: ColorNode[];
  elements: RawColorElement[];
  /** Canvas color behind the root element. */
  canvas: string;
  truncated: boolean;
}

/** The API `installPageApi` puts on `window.__rugby`. */
export interface PageApi {
  els: Element[];
  colorEls: Element[];
  collectText(options: CollectOptions): CollectResult;
  collectColors(options: CollectOptions): ColorCollectResult;
  hide(indices: number[]): void;
  restore(): void;
  selectorFor(index: number, kind?: "text" | "color"): string;
  resolveTargets(targets: unknown[]): number[];
}

export function installPageApi(): void {
  type W = Window & typeof globalThis & { __rugby?: PageApi };
  const w = window as W;
  if (w.__rugby) return;

  const els: Element[] = [];
  const colorEls: Element[] = [];
  const saved: [HTMLElement, string | null][] = [];
  const SKIP_TAGS = new Set([
    "script",
    "style",
    "noscript",
    "template",
    "head",
    "title",
    "meta",
    "link",
    "option",
    "optgroup",
    "textarea",
    "select",
    "svg",
    "math",
    "canvas",
    "iframe",
    "object",
    "embed",
  ]);
  const MEDIA_TAGS = new Set(["img", "video", "canvas", "picture", "object", "embed"]);

  const styleOf = (el: Element) => (el.ownerDocument.defaultView ?? window).getComputedStyle(el);

  const parentAcross = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    if (root instanceof (el.ownerDocument.defaultView ?? window).ShadowRoot) return root.host;
    const frame = el.ownerDocument.defaultView?.frameElement;
    return frame ?? null;
  };

  /** Offset of a frame's document inside the top document. */
  const frameOffset = (doc: Document): { x: number; y: number; clip: Rect | null } => {
    let x = 0;
    let y = 0;
    let clip: Rect | null = null;
    let win = doc.defaultView;
    while (win?.frameElement) {
      const fe = win.frameElement as HTMLElement;
      const parentWin = fe.ownerDocument.defaultView ?? window;
      const r = fe.getBoundingClientRect();
      const cs = parentWin.getComputedStyle(fe);
      const left = r.left + fe.clientLeft + Number.parseFloat(cs.paddingLeft);
      const top = r.top + fe.clientTop + Number.parseFloat(cs.paddingTop);
      x += left - win.scrollX + parentWin.scrollX;
      y += top - win.scrollY + parentWin.scrollY;
      const box = {
        x: left + parentWin.scrollX,
        y: top + parentWin.scrollY,
        w: fe.clientWidth,
        h: fe.clientHeight,
      };
      clip = clip ? intersect(clip, box) : box;
      win = parentWin;
    }
    return { x, y, clip };
  };

  const intersect = (a: Rect, b: Rect): Rect | null => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const btm = Math.min(a.y + a.h, b.y + b.h);
    return r - x > 0.5 && btm - y > 0.5 ? { x, y, w: r - x, h: btm - y } : null;
  };

  /** Overflow clip of the element and its ancestors, in document coordinates. */
  const clipFor = (el: Element, offX: number, offY: number): Rect | null | undefined => {
    let clip: Rect | undefined;
    let node: Element | null = el;
    const doc = el.ownerDocument;
    while (node && node.ownerDocument === doc && node !== doc.documentElement) {
      const cs = styleOf(node);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const r = node.getBoundingClientRect();
        const box = {
          x: r.left + node.clientLeft + offX,
          y: r.top + node.clientTop + offY,
          w: node.clientWidth || r.width,
          h: node.clientHeight || r.height,
        };
        if (cs.overflowX === "visible") {
          box.x = -1e6;
          box.w = 2e6;
        }
        if (cs.overflowY === "visible") {
          box.y = -1e6;
          box.h = 2e6;
        }
        const next: Rect | null = clip ? intersect(clip, box) : box;
        if (!next) return null;
        clip = next;
      }
      if (cs.position === "fixed") break;
      node = node.parentElement;
    }
    return clip;
  };

  const effectiveOpacity = (el: Element): number => {
    let o = 1;
    let node: Element | null = el;
    while (node) {
      o *= Number.parseFloat(styleOf(node).opacity);
      node = parentAcross(node);
    }
    return o;
  };

  const blendModeOf = (el: Element): string => {
    let node: Element | null = el;
    while (node) {
      const m = styleOf(node).mixBlendMode;
      if (m && m !== "normal") return m;
      node = parentAcross(node);
    }
    return "normal";
  };

  const isDisabled = (el: Element): boolean => {
    let node: Element | null = el;
    while (node) {
      if (
        node.hasAttribute("disabled") &&
        /^(button|input|select|textarea|fieldset)$/i.test(node.localName)
      ) {
        return true;
      }
      if (node.getAttribute("aria-disabled") === "true") return true;
      node = node.parentElement;
    }
    return false;
  };

  const directText = (el: Element): Text[] => {
    const out: Text[] = [];
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 && /\S/.test((n as Text).data)) out.push(n as Text);
    }
    return out;
  };

  /** Walk elements in document order, through open shadow roots and same-origin frames. */
  const walk = (
    root: ParentNode,
    visit: (el: Element) => void,
    frames: { sameOrigin: number; crossOrigin: number },
  ) => {
    const stack: Element[] = [];
    const pushChildren = (parent: ParentNode) => {
      const kids = Array.from(parent.children);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    };
    if (root instanceof Element) stack.push(root);
    else pushChildren(root);
    while (stack.length) {
      const el = stack.pop()!;
      visit(el);
      if (el.localName === "iframe" || el.localName === "frame") {
        let doc: Document | null = null;
        try {
          doc = (el as HTMLIFrameElement).contentDocument;
        } catch {
          doc = null;
        }
        if (doc?.body) {
          frames.sameOrigin++;
          stack.push(doc.body);
        } else frames.crossOrigin++;
        continue;
      }
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) pushChildren(sr);
      pushChildren(el);
    }
  };

  const SHAPES = new Set([
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
  ]);
  const transparent = (c: string) =>
    !c || c === "transparent" || /^rgba\(0, 0, 0, 0\)$/.test(c) || /\/ 0\)$/.test(c);

  const api: PageApi = {
    els,
    colorEls,

    collectColors(options) {
      colorEls.length = 0;
      const nodes: ColorNode[] = [];
      const ids = new Map<Element, number>();
      const elements: RawColorElement[] = [];
      const frames = { sameOrigin: 0, crossOrigin: 0 };
      let truncated = false;
      const de = document.documentElement;
      const docBox: Rect = {
        x: 0,
        y: 0,
        w: Math.max(de.scrollWidth, window.innerWidth),
        h: Math.max(de.scrollHeight, window.innerHeight),
      };
      const nodeFor = (el: Element): number => {
        const known = ids.get(el);
        if (known !== undefined) return known;
        const parentEl = parentAcross(el);
        const parent = parentEl ? nodeFor(parentEl) : -1;
        const cs = styleOf(el);
        const tag = el.localName;
        const id = nodes.length;
        nodes.push({
          bg: cs.backgroundColor,
          opacity: Number.parseFloat(cs.opacity),
          filter: cs.filter || "none",
          bgImage: (cs.backgroundImage !== "none" && !!cs.backgroundImage) || MEDIA_TAGS.has(tag),
          parent,
        });
        ids.set(el, id);
        return id;
      };
      const roots = Array.from(document.querySelectorAll(options.rootSelector));
      const visit = (el: Element) => {
        if (truncated) return;
        const tag = el.localName;
        if (
          tag === "script" ||
          tag === "style" ||
          tag === "head" ||
          tag === "template" ||
          tag === "noscript"
        )
          return;
        const cs = styleOf(el);
        if (cs.visibility !== "visible" || cs.display === "contents") return;
        const rectList = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (!rectList.length) return;
        const off = frameOffset(el.ownerDocument);
        const r0 = rectList[0]!;
        if (
          !intersect(
            {
              x: r0.left + off.x + window.scrollX,
              y: r0.top + off.y + window.scrollY,
              w: r0.width,
              h: r0.height,
            },
            docBox,
          )
        )
          return;
        if (effectiveOpacity(el) <= 0.001) return;
        // Disabled controls are exempt from contrast rules and usually faded on purpose.
        if (isDisabled(el)) return;
        const props: [string, string][] = [];
        const isSvg = el.namespaceURI === "http://www.w3.org/2000/svg";
        if (isSvg) {
          if (SHAPES.has(tag)) {
            if (
              cs.fill &&
              cs.fill !== "none" &&
              !cs.fill.startsWith("url(") &&
              Number.parseFloat(cs.fillOpacity || "1") > 0
            ) {
              props.push(["fill", cs.fill]);
            }
            if (
              cs.stroke &&
              cs.stroke !== "none" &&
              !cs.stroke.startsWith("url(") &&
              Number.parseFloat(cs.strokeWidth || "0") > 0
            ) {
              props.push(["stroke", cs.stroke]);
            }
          }
        } else {
          const hasText = directText(el).length > 0;
          if (hasText && !SKIP_TAGS.has(tag)) {
            props.push(["color", cs.webkitTextFillColor || cs.color]);
            if (cs.textDecorationLine && cs.textDecorationLine !== "none") {
              props.push(["text-decoration-color", cs.textDecorationColor]);
            }
          }
          if (!transparent(cs.backgroundColor))
            props.push(["background-color", cs.backgroundColor]);
          const sides = ["top", "right", "bottom", "left"] as const;
          const borders = sides
            .filter((side) => {
              const style = cs.getPropertyValue(`border-${side}-style`);
              return (
                style !== "none" &&
                style !== "hidden" &&
                Number.parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0
              );
            })
            .map((side) => [side, cs.getPropertyValue(`border-${side}-color`)] as const)
            .filter(([, c]) => !transparent(c));
          if (borders.length && borders.every(([, c]) => c === borders[0]![1])) {
            props.push([
              borders.length === 4 ? "border-color" : `border-${borders[0]![0]}-color`,
              borders[0]![1],
            ]);
          } else for (const [side, c] of borders) props.push([`border-${side}-color`, c]);
          if (
            cs.outlineStyle !== "none" &&
            Number.parseFloat(cs.outlineWidth) > 0 &&
            !transparent(cs.outlineColor)
          ) {
            props.push(["outline-color", cs.outlineColor]);
          }
          if (cs.boxShadow && cs.boxShadow !== "none") {
            const colors =
              cs.boxShadow.match(
                /(?:rgba?|color|oklch|oklab|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/gi,
              ) ?? [];
            for (const c of new Set(colors)) if (!transparent(c)) props.push(["box-shadow", c]);
          }
        }
        if (!props.length) return;
        if (colorEls.length >= options.maxItems) {
          truncated = true;
          return;
        }
        colorEls.push(el);
        elements.push({ index: colorEls.length - 1, node: nodeFor(el), props });
      };
      for (const root of roots) walk(root, visit, frames);
      const rootStyle = styleOf(de);
      const bodyStyle = document.body ? styleOf(document.body) : rootStyle;
      const darkCanvas =
        window.matchMedia("(prefers-color-scheme: dark)").matches &&
        /dark/.test(rootStyle.colorScheme || "");
      const canvas = !transparent(rootStyle.backgroundColor)
        ? rootStyle.backgroundColor
        : !transparent(bodyStyle.backgroundColor)
          ? bodyStyle.backgroundColor
          : darkCanvas
            ? "rgb(18, 18, 18)"
            : "rgb(255, 255, 255)";
      return { nodes, elements, canvas, truncated };
    },

    collectText(options) {
      els.length = 0;
      const frames = { sameOrigin: 0, crossOrigin: 0 };
      const skipped = { clipped: 0, transparent: 0, hidden: 0, disabled: 0 };
      const items: RawTextItem[] = [];
      const de = document.documentElement;
      const docWidth = Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0, window.innerWidth);
      const docHeight = Math.max(
        de.scrollHeight,
        document.body?.scrollHeight ?? 0,
        window.innerHeight,
      );
      const docBox: Rect = { x: 0, y: 0, w: docWidth, h: docHeight };
      // Backgrounds that make a backdrop non-solid, with their document boxes.
      const decorated: { rect: Rect; gradient: boolean; image: boolean; el: Element }[] = [];
      const candidates: Element[] = [];
      const roots = Array.from(document.querySelectorAll(options.rootSelector));
      for (const root of roots) {
        walk(
          root,
          (el) => {
            const cs = styleOf(el);
            const tag = el.localName;
            const bg = cs.backgroundImage;
            const media = MEDIA_TAGS.has(tag) || (tag === "svg" && el.querySelector("image"));
            if ((bg && bg !== "none") || media) {
              const off = frameOffset(el.ownerDocument);
              const r = el.getBoundingClientRect();
              decorated.push({
                rect: {
                  x: r.left + off.x + window.scrollX,
                  y: r.top + off.y + window.scrollY,
                  w: r.width,
                  h: r.height,
                },
                gradient: /gradient\(/.test(bg),
                image: !!media || /url\(/.test(bg),
                el,
              });
            }
            if (!SKIP_TAGS.has(tag)) candidates.push(el);
          },
          frames,
        );
      }
      for (const el of candidates) {
        if (items.length >= options.maxItems) break;
        const texts = directText(el);
        if (!texts.length) continue;
        const cs = styleOf(el);
        if (cs.visibility !== "visible") {
          skipped.hidden++;
          continue;
        }
        const opacity = effectiveOpacity(el);
        if (opacity <= 0.001) {
          skipped.hidden++;
          continue;
        }
        if (isDisabled(el)) {
          skipped.disabled++;
          continue;
        }
        const fill = cs.webkitTextFillColor || cs.color;
        if (/^(transparent|rgba\(0, 0, 0, 0\))$/.test(fill)) {
          skipped.transparent++;
          continue;
        }
        const off = frameOffset(el.ownerDocument);
        const ox = off.x + window.scrollX;
        const oy = off.y + window.scrollY;
        const clip = clipFor(el, ox, oy);
        if (clip === null) {
          skipped.clipped++;
          continue;
        }
        const rects: Rect[] = [];
        const range = el.ownerDocument.createRange();
        for (const t of texts) {
          range.selectNodeContents(t);
          for (const r of Array.from(range.getClientRects())) {
            if (r.width < 0.5 || r.height < 0.5) continue;
            let rect: Rect | null = { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height };
            if (clip) rect = intersect(rect, clip);
            if (rect && off.clip) rect = intersect(rect, off.clip);
            if (rect) rect = intersect(rect, docBox);
            if (rect) rects.push(rect);
          }
        }
        if (!rects.length) {
          skipped.clipped++;
          continue;
        }
        const hints = { gradient: false, image: false, backdropFilter: false };
        for (const d of decorated) {
          if (
            d.el !== el &&
            !d.el.contains(el) &&
            d.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
          ) {
            continue; // painted after (above) the text in document order; not a backdrop
          }
          if (rects.some((r) => intersect(r, d.rect))) {
            if (d.gradient) hints.gradient = true;
            if (d.image) hints.image = true;
          }
        }
        let node: Element | null = el;
        while (node) {
          const bf = styleOf(node).backdropFilter;
          if (bf && bf !== "none") hints.backdropFilter = true;
          node = parentAcross(node);
        }
        const text = texts
          .map((t) => t.data)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        els.push(el);
        items.push({
          index: els.length - 1,
          text: text.length > 120 ? `${text.slice(0, 117)}...` : text,
          rects,
          color: fill,
          opacity,
          blendMode: blendModeOf(el),
          fontSizePx: Number.parseFloat(cs.fontSize),
          fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
          textShadow: cs.textShadow !== "none" && cs.textShadow !== "",
          textStroke: Number.parseFloat(cs.webkitTextStrokeWidth || "0") > 0,
          hints,
          inFrame: el.ownerDocument !== document,
        });
      }
      return { items, skipped, docWidth, docHeight, frames };
    },

    hide(indices) {
      for (const i of indices) {
        const el = els[i] as HTMLElement | undefined;
        if (!el?.style) continue;
        saved.push([el, el.getAttribute("style")]);
        const s = el.style;
        s.setProperty("color", "transparent", "important");
        s.setProperty("-webkit-text-fill-color", "transparent", "important");
        s.setProperty("text-shadow", "none", "important");
        s.setProperty("-webkit-text-stroke-width", "0", "important");
        s.setProperty("text-decoration-color", "transparent", "important");
        s.setProperty("text-emphasis-color", "transparent", "important");
        s.setProperty("caret-color", "transparent", "important");
      }
    },

    restore() {
      while (saved.length) {
        const [el, style] = saved.pop()!;
        if (style === null) el.removeAttribute("style");
        else el.setAttribute("style", style);
      }
    },

    selectorFor(index, kind = "text") {
      const el = (kind === "color" ? colorEls : els)[index];
      if (!el) return "";
      const esc = (s: string) => (window.CSS?.escape ? window.CSS.escape(s) : s);
      const partsFor = (start: Element): string[] => {
        const doc = start.ownerDocument;
        const parts: string[] = [];
        let node: Element | null = start;
        while (node && node.ownerDocument === doc) {
          if (node.id && doc.querySelectorAll(`#${esc(node.id)}`).length === 1) {
            parts.unshift(`#${esc(node.id)}`);
            break;
          }
          let part = node.localName;
          const classes = Array.from(node.classList)
            .filter((c) => c.length < 40)
            .slice(0, 2);
          if (classes.length) part += `.${classes.map(esc).join(".")}`;
          const parentEl: Element | null = node.parentElement;
          if (parentEl) {
            const same = Array.from(parentEl.children).filter(
              (c) => c.localName === node!.localName,
            );
            if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
          }
          parts.unshift(part);
          if (node.localName === "body" || node.localName === "html") break;
          if (!parentEl) {
            const root = node.getRootNode();
            if (root instanceof (doc.defaultView ?? window).ShadowRoot) {
              parts.unshift(">>>");
              node = root.host;
              continue;
            }
          }
          node = parentEl;
        }
        // Shorten from the left while the selector stays unique.
        const scoped = parts.lastIndexOf(">>>");
        if (scoped < 0) {
          for (let i = 1; i < parts.length; i++) {
            const candidate = parts.slice(i).join(" > ");
            try {
              if (doc.querySelectorAll(candidate).length !== 1) return parts.slice(i - 1);
            } catch {
              return parts.slice(i - 1);
            }
          }
          return parts.slice(-1);
        }
        return parts;
      };
      const chain: string[] = [partsFor(el).join(" > ")];
      let frame = el.ownerDocument.defaultView?.frameElement ?? null;
      while (frame) {
        chain.unshift(partsFor(frame).join(" > "));
        frame = frame.ownerDocument.defaultView?.frameElement ?? null;
      }
      return chain.join(" >>> ").replace(/ > >>> > /g, " >>> ");
    },

    resolveTargets(targets) {
      const find = (target: unknown): Element | null => {
        if (!Array.isArray(target)) return null;
        let doc: Document | null = document;
        let el: Element | null = null;
        for (let i = 0; i < target.length; i++) {
          if (!doc) return null;
          const sel = target[i];
          if (Array.isArray(sel)) {
            let scope: Document | ShadowRoot | null = doc;
            for (const s of sel) {
              el = scope?.querySelector(String(s)) ?? null;
              scope = (el as HTMLElement | null)?.shadowRoot ?? null;
            }
          } else {
            el = doc.querySelector(String(sel));
          }
          if (!el) return null;
          if (i < target.length - 1) doc = (el as HTMLIFrameElement).contentDocument;
        }
        return el;
      };
      return targets.map((t) => {
        try {
          const el = find(t);
          return el ? els.indexOf(el) : -1;
        } catch {
          return -1;
        }
      });
    },
  };
  w.__rugby = api;
}
