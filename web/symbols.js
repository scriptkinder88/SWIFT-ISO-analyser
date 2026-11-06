// Symbol library: generic network/server symbols drawn in a 48x48 box, plus
// rendering of sanitized custom (vendor) SVG symbols. Drawings use CSS classes
// (sym-ink, sym-fill, sym-accent) so they follow light and dark themes.
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const SIZE = 48;

  // Each generic symbol is a list of [tag, attributes] pairs.
  const GENERIC = {
    server: [
      ["rect", { x: 9, y: 4, width: 30, height: 40, rx: 3, class: "sym-fill" }],
      ["line", { x1: 13, y1: 16, x2: 35, y2: 16 }],
      ["line", { x1: 13, y1: 24, x2: 35, y2: 24 }],
      ["line", { x1: 13, y1: 32, x2: 35, y2: 32 }],
      ["circle", { cx: 32, cy: 10, r: 1.8, class: "sym-accent-fill" }],
      ["circle", { cx: 32, cy: 38, r: 1.8, class: "sym-accent-fill" }],
    ],
    firewall: [
      ["rect", { x: 4, y: 10, width: 40, height: 28, rx: 2, class: "sym-accent-soft" }],
      ["line", { x1: 4, y1: 19, x2: 44, y2: 19 }],
      ["line", { x1: 4, y1: 28, x2: 44, y2: 28 }],
      ["line", { x1: 16, y1: 10, x2: 16, y2: 19 }],
      ["line", { x1: 32, y1: 10, x2: 32, y2: 19 }],
      ["line", { x1: 24, y1: 19, x2: 24, y2: 28 }],
      ["line", { x1: 10, y1: 28, x2: 10, y2: 38 }],
      ["line", { x1: 38, y1: 28, x2: 38, y2: 38 }],
    ],
    router: [
      ["circle", { cx: 24, cy: 24, r: 18, class: "sym-fill" }],
      ["path", { d: "M14 19 H34 M30 15 L34 19 L30 23" }],
      ["path", { d: "M34 29 H14 M18 25 L14 29 L18 33" }],
    ],
    switch: [
      ["rect", { x: 4, y: 15, width: 40, height: 18, rx: 2, class: "sym-fill" }],
      ["path", { d: "M10 24 H38 M10 24 l4 -3 M10 24 l4 3 M38 24 l-4 -3 M38 24 l-4 3" }],
      ["circle", { cx: 40, cy: 19, r: 1, class: "sym-ink-fill" }],
    ],
    hsm: [
      ["rect", { x: 6, y: 6, width: 36, height: 36, rx: 4, class: "sym-fill" }],
      ["rect", { x: 17, y: 23, width: 14, height: 11, rx: 1.5, class: "sym-accent-fill" }],
      ["path", { d: "M20 23 V19 A4 4 0 0 1 28 19 V23" }],
    ],
    database: [
      ["path", { d: "M10 12 V36 A14 6 0 0 0 38 36 V12", class: "sym-fill" }],
      ["ellipse", { cx: 24, cy: 12, rx: 14, ry: 6, class: "sym-fill" }],
      ["path", { d: "M10 22 A14 6 0 0 0 38 22" }],
    ],
    workstation: [
      ["rect", { x: 6, y: 7, width: 36, height: 24, rx: 2, class: "sym-fill" }],
      ["rect", { x: 10, y: 11, width: 28, height: 16, class: "sym-accent-soft" }],
      ["path", { d: "M20 31 H28 L30 38 H18 Z", class: "sym-fill" }],
      ["line", { x1: 14, y1: 41, x2: 34, y2: 41 }],
    ],
    cloud: [
      ["path", { d: "M14 36 A9 9 0 0 1 15.5 18.1 A12 12 0 0 1 38.5 21 A7.5 7.5 0 0 1 36 36 Z", class: "sym-fill" }],
    ],
    internet: [
      ["circle", { cx: 24, cy: 24, r: 18, class: "sym-fill" }],
      ["ellipse", { cx: 24, cy: 24, rx: 8, ry: 18 }],
      ["line", { x1: 6, y1: 24, x2: 42, y2: 24 }],
      ["path", { d: "M9 16 H39 M9 32 H39" }],
    ],
    appliance: [
      ["rect", { x: 4, y: 13, width: 40, height: 22, rx: 3, class: "sym-fill" }],
      ["rect", { x: 9, y: 19, width: 16, height: 4, class: "sym-accent-soft" }],
      ["circle", { cx: 33, cy: 21, r: 1.6, class: "sym-accent-fill" }],
      ["circle", { cx: 38, cy: 21, r: 1.6, class: "sym-accent-fill" }],
      ["line", { x1: 9, y1: 28, x2: 39, y2: 28 }],
    ],
    loadbalancer: [
      ["circle", { cx: 24, cy: 24, r: 18, class: "sym-fill" }],
      ["path", { d: "M12 24 H24 M24 24 L35 15 M24 24 L35 33" }],
      ["circle", { cx: 36, cy: 14, r: 2.2, class: "sym-accent-fill" }],
      ["circle", { cx: 36, cy: 34, r: 2.2, class: "sym-accent-fill" }],
    ],
    storage: [
      ["rect", { x: 7, y: 6, width: 34, height: 10, rx: 2, class: "sym-fill" }],
      ["rect", { x: 7, y: 19, width: 34, height: 10, rx: 2, class: "sym-fill" }],
      ["rect", { x: 7, y: 32, width: 34, height: 10, rx: 2, class: "sym-fill" }],
      ["circle", { cx: 35, cy: 11, r: 1.5, class: "sym-accent-fill" }],
      ["circle", { cx: 35, cy: 24, r: 1.5, class: "sym-accent-fill" }],
      ["circle", { cx: 35, cy: 37, r: 1.5, class: "sym-accent-fill" }],
    ],
    application: [
      ["rect", { x: 4, y: 7, width: 40, height: 34, rx: 3, class: "sym-fill" }],
      ["line", { x1: 4, y1: 16, x2: 44, y2: 16 }],
      ["rect", { x: 10, y: 22, width: 28, height: 12, rx: 1.5, class: "sym-accent-soft" }],
    ],
  };

  const LABELS = {
    server: "Server", firewall: "Firewall", router: "Router", switch: "Switch",
    hsm: "HSM", database: "Database", workstation: "Workstation", cloud: "Cloud",
    internet: "Internet", appliance: "Appliance", loadbalancer: "Load balancer",
    storage: "Storage", application: "Applicazione",
  };

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
  }

  // Parses a sanitized custom symbol and returns its children, or null.
  function parseCustom(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return null;
    return doc.documentElement;
  }

  // Appends the symbol identified by `symbol` into `parent`, positioned at
  // (x, y) and scaled to fit a 48x48 box. `custom` maps "custom:<id>" to
  // {viewBox, svg}. Returns false when the symbol is unknown.
  function draw(parent, symbol, x, y, custom) {
    const g = el("g", { class: "sym", transform: `translate(${x},${y})` });
    parent.append(g);
    if (symbol && symbol.startsWith("custom:")) {
      const def = custom && custom[symbol];
      if (!def) return drawFallback(g);
      const root = parseCustom(def.svg);
      if (!root) return drawFallback(g);
      const parts = def.viewBox.split(/\s+/).map(Number);
      const vbX = parts[0], vbY = parts[1], vbW = parts[2], vbH = parts[3];
      const s = SIZE / Math.max(vbW, vbH, 1);
      const inner = el("g", { transform: `scale(${s}) translate(${-vbX},${-vbY})` });
      for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === 1) inner.append(document.importNode(child, true));
      }
      g.append(inner);
      return true;
    }
    const shapes = GENERIC[symbol || "appliance"] || GENERIC.appliance;
    for (const [tag, attrs] of shapes) g.append(el(tag, attrs));
    return true;
  }

  function drawFallback(g) {
    g.append(el("rect", { x: 6, y: 6, width: 36, height: 36, rx: 4, class: "sym-fill sym-missing" }));
    g.append(el("line", { x1: 14, y1: 14, x2: 34, y2: 34, class: "sym-missing" }));
    g.append(el("line", { x1: 34, y1: 14, x2: 14, y2: 34, class: "sym-missing" }));
    return false;
  }

  // Small preview for the symbol library (returns an <svg> element).
  function preview(symbol, custom) {
    const svg = el("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: 36, height: 36, class: "sym-preview", "aria-hidden": "true" });
    draw(svg, symbol, 0, 0, custom);
    return svg;
  }

  window.SymbolLib = {
    GENERIC_IDS: Object.keys(GENERIC),
    LABELS,
    SIZE,
    draw,
    preview,
    label(symbol, custom) {
      if (symbol && symbol.startsWith("custom:")) {
        const def = custom && custom[symbol];
        return def ? def.name : "Simbolo personalizzato";
      }
      return LABELS[symbol] || "Applicazione";
    },
  };
})();
