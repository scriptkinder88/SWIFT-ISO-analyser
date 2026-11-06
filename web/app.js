// SWIFT ISO Analyser: architecture diagram, model explorer, symbol library and
// auditor panel. Plain DOM and SVG, no dependencies. Symbols come from symbols.js.
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const NODE_W = 200;
  const NODE_H = 104;
  const COL_W = 280;
  const ROW_GAP = 36;
  const PAD = 60;
  const BAND_HEAD = 58;
  const MAX_COLS = 4;
  const CHIP_H = 28;
  const CHIP_GAP = 6;
  const MAX_SVG_BYTES = 64 * 1024;
  const DETAIL_ZOOM = 0.8; // below this zoom the diagram shows compact labels

  const STATUSES = [
    ["non_valutato", "Not assessed"],
    ["conforme", "Compliant"],
    ["parzialmente_conforme", "Partially compliant"],
    ["non_conforme", "Non-compliant"],
    ["non_applicabile", "Not applicable"],
  ];

  const KINDS = {
    server: "Physical server", vm: "Virtual machine", container: "Container",
    application: "Application", database: "Database", network: "Network device",
    hsm: "HSM", workstation: "Workstation", storage: "Storage",
    "cloud-service": "Cloud service", external: "External",
  };

  // Line style per network type: colour, width, dash pattern.
  const NETWORKS = {
    internet:   { label: "Internet / untrusted", color: "#c62828", width: 2,   dash: "" },
    dmz:        { label: "DMZ",                 color: "#ef6c00", width: 2,   dash: "8 4" },
    swift:      { label: "SWIFT zone",          color: "#1f3864", width: 4,   dash: "" },
    internal:   { label: "Internal network",    color: "#546e7a", width: 1.5, dash: "" },
    management: { label: "Management / security", color: "#2e7d32", width: 1.5, dash: "2 3" },
    backup:     { label: "Backup",              color: "#6a1b9a", width: 1.5, dash: "10 3 2 3" },
    cloud:      { label: "Cloud",               color: "#0288d1", width: 1.8, dash: "12 4 2 4" },
  };
  const DEFAULT_NET = { label: "Unclassified", color: "#7f8a99", width: 1.5, dash: "" };

  const state = {
    framework: null,
    arch: null,
    assessments: [],
    symbols: { generic: [], custom: {} },
    selectedComp: null,
    selectedReq: null,
    inventory: {},
    view: { zoom: 1, x: 0, y: 0, w: 1000, h: 600 },
    mapAnimated: false,
    layout: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- helpers ----------

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
    }
    return node;
  }

  function flash(text, kind = "") {
    const msg = $("#message");
    msg.textContent = text;
    msg.className = "message " + kind;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  }

  function statusLabel(code) {
    const found = STATUSES.find(([c]) => c === code);
    return found ? found[1] : "Not assessed";
  }

  function dotClass(st) {
    switch (st) {
      case "conforme": return "ok";
      case "parzialmente_conforme": return "partial";
      case "non_conforme": return "ko";
      default: return "todo";
    }
  }

  function badgeClass(code) {
    switch (code) {
      case "conforme": return "badge-ok";
      case "parzialmente_conforme": return "badge-partial";
      case "non_conforme": return "badge-ko";
      default: return "badge-todo";
    }
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function netStyle(type) {
    return NETWORKS[type] || DEFAULT_NET;
  }

  function netKey(type) {
    return NETWORKS[type] ? type : "none";
  }

  // Mirrors model.Database.StatusFor on the server.
  function statusFor(reqId, compId) {
    let global = null;
    for (const a of state.assessments) {
      if (a.requirement_id !== reqId) continue;
      if (compId && a.component_id === compId) return a;
      if (!a.component_id) global = a;
    }
    return global || { status: "non_valutato", rationale: "" };
  }

  function componentsFor(reqId) {
    return state.arch.components.filter((c) => (c.controls || []).includes(reqId));
  }

  function childrenOf(id) {
    return state.arch.components.filter((c) => c.parent === id);
  }

  function nodeStatus(comp) {
    const reqs = comp.controls || [];
    if (reqs.length === 0) return "none";
    const sts = reqs.map((r) => statusFor(r, comp.id).status);
    if (sts.includes("non_conforme")) return "non_conforme";
    if (sts.includes("parzialmente_conforme")) return "parzialmente_conforme";
    if (sts.every((s) => s === "conforme" || s === "non_applicabile")) return "conforme";
    return "non_valutato";
  }

  function requirementIndex() {
    const idx = {};
    for (const c of state.framework.controls) {
      for (const r of c.requirements) idx[r.id] = { control: c, req: r };
    }
    return idx;
  }

  function zoneInfo(name) {
    return (state.arch.zones || []).find((z) => z.name === name) || null;
  }

  function zoneNames() {
    const names = [];
    for (const z of state.arch.zones || []) names.push(z.name);
    for (const c of state.arch.components) if (!names.includes(c.zone)) names.push(c.zone);
    return names;
  }

  function symbolOptions(current) {
    const opts = state.symbols.generic.map((g) =>
      h("option", { value: g, selected: g === current ? true : null }, window.SymbolLib.LABELS[g] || g));
    for (const c of Object.values(state.symbols.custom)) {
      const ref = "custom:" + c.id;
      opts.push(h("option", { value: ref, selected: ref === current ? true : null },
        `${c.name}${c.vendor ? " (" + c.vendor + ")" : ""}`));
    }
    return opts;
  }

  function nodeMeta(comp) {
    const parts = [comp.vendor, comp.model, comp.os].filter(Boolean);
    if (parts.length) return parts.join(" · ");
    return KINDS[comp.kind] || comp.kind || "";
  }

  function nodeTitle(comp) {
    return `${comp.name}${comp.vendor ? " · " + comp.vendor : ""}${comp.model ? " " + comp.model : ""}${comp.os ? " · " + comp.os : ""}`;
  }

  // ---------- layout ----------

  // Height of a top-level box: grows with the containers it hosts.
  function boxHeight(comp) {
    const n = childrenOf(comp.id).length;
    return n ? NODE_H + 10 + n * (CHIP_H + CHIP_GAP) + 4 : NODE_H;
  }

  // Zones are placed left to right, wrapping to a new band row after MAX_COLS.
  function computeLayout() {
    const zones = [];
    for (const c of state.arch.components) {
      if (!c.parent && !zones.includes(c.zone)) zones.push(c.zone);
    }
    const cols = Math.max(1, Math.min(MAX_COLS, zones.length));
    const bandRows = Math.ceil(zones.length / cols);
    const pos = {};
    const bands = [];
    let y0 = 0;
    for (let r = 0; r < bandRows; r++) {
      const idxs = zones.map((_, i) => i).filter((i) => Math.floor(i / cols) === r);
      const sums = idxs.map((i) => state.arch.components
        .filter((c) => !c.parent && c.zone === zones[i])
        .reduce((acc, c) => acc + boxHeight(c) + ROW_GAP, 0));
      const tallest = Math.max(NODE_H, ...sums);
      const bandH = BAND_HEAD + 30 + tallest;
      for (const i of idxs) {
        const x = PAD + (i % cols) * COL_W;
        bands.push({ zone: zones[i], x: x - 20, y: y0 + 10, w: NODE_W + 40, h: bandH - 20 });
        let cy = y0 + BAND_HEAD;
        for (const comp of state.arch.components) {
          if (comp.parent || comp.zone !== zones[i]) continue;
          const bh = boxHeight(comp);
          pos[comp.id] = { x, y: cy, w: NODE_W, h: bh };
          childrenOf(comp.id).forEach((child, k) => {
            pos[child.id] = { x: x + 12, y: cy + NODE_H + 10 + k * (CHIP_H + CHIP_GAP), w: NODE_W - 24, h: CHIP_H };
          });
          cy += bh + ROW_GAP;
        }
      }
      y0 += bandH + ROW_GAP / 2;
    }
    const w = PAD * 2 + cols * COL_W - (COL_W - NODE_W);
    const h = y0 + 30;
    return { zones, pos, w, h, bands };
  }

  function edgePath(a, b) {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    const acx = ax + a.w / 2, bcx = bx + b.w / 2;
    const acy = ay + a.h / 2, bcy = by + b.h / 2;
    let sx, sy, ex, ey, c1x, c1y, c2x, c2y;
    if (Math.abs(bcx - acx) >= COL_W - 40) {
      const right = bcx > acx;
      sx = right ? ax + a.w : ax;
      ex = right ? bx : bx + b.w;
      sy = acy;
      ey = bcy;
      const off = Math.max(40, Math.abs(ex - sx) / 2) * (right ? 1 : -1);
      c1x = sx + off; c1y = sy; c2x = ex - off; c2y = ey;
    } else {
      const down = bcy > acy;
      sx = acx;
      ex = bcx;
      sy = down ? ay + a.h : ay;
      ey = down ? by : by + b.h;
      const off = Math.max(30, Math.abs(ey - sy) / 2) * (down ? 1 : -1);
      c1x = sx; c1y = sy + off; c2x = ex; c2y = ey - off;
    }
    const mid = { x: (sx + 3 * c1x + 3 * c2x + ex) / 8, y: (sy + 3 * c1y + 3 * c2y + ey) / 8 };
    return { d: `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`, mid };
  }

  // ---------- diagram ----------

  function buildDefs(svg) {
    const defs = svgEl("defs");
    const pattern = svgEl("pattern", { id: "grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" });
    pattern.append(svgEl("circle", { cx: 1, cy: 1, r: 1, class: "grid-dot" }));
    defs.append(pattern);
    for (const key of [...Object.keys(NETWORKS), "none"]) {
      const st = key === "none" ? DEFAULT_NET : NETWORKS[key];
      const marker = svgEl("marker", {
        id: "arrow-" + key, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse",
      });
      marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: st.color }));
      defs.append(marker);
    }
    svg.append(defs);
  }

  function renderMap() {
    const svg = $("#map");
    svg.replaceChildren();
    if (!state.arch) return;

    const layout = computeLayout();
    state.layout = layout;
    const { pos, w, h, bands } = layout;
    const box = svg.getBoundingClientRect();
    const aspect = box.width > 0 && box.height > 0 ? box.height / box.width : h / w;
    const viewH = Math.max(h, w * aspect);
    state.view.w = w;
    state.view.h = viewH;
    if (!state.fitted) fitView();
    applyViewBox();

    buildDefs(svg);
    svg.append(svgEl("rect", { class: "paper", x: -5000, y: -5000, width: 10000, height: 10000 }));
    svg.append(svgEl("rect", { class: "grid", x: -5000, y: -5000, width: 10000, height: 10000 }));

    const zoneLayer = svgEl("g", { class: "zone-layer" });
    for (const b of bands) {
      const info = zoneInfo(b.zone);
      const st = netStyle(info ? info.network : "");
      zoneLayer.append(svgEl("rect", {
        class: "zone", x: b.x, y: b.y, width: b.w, height: b.h, rx: 10,
        stroke: st.color, "stroke-dasharray": "12 6",
      }));
      const text = b.zone;
      const tabW = Math.min(b.w + 40, 28 + text.length * 8.6);
      zoneLayer.append(svgEl("rect", { class: "zone-tab", x: b.x + 12, y: b.y - 12, width: tabW, height: 24, rx: 4, stroke: st.color }));
      const label = svgEl("text", { class: "zone-label", x: b.x + 22, y: b.y + 4 });
      label.textContent = text;
      zoneLayer.append(label);
    }
    svg.append(zoneLayer);

    const hitSet = state.selectedReq ? new Set(componentsFor(state.selectedReq).map((c) => c.id)) : null;

    const linkLayer = svgEl("g");
    const labelLayer = svgEl("g", { class: "link-labels" });
    for (const e of state.arch.edges) {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) continue;
      const { d, mid } = edgePath(a, b);
      const adjacent = state.selectedComp && (e.from === state.selectedComp || e.to === state.selectedComp);
      const key = netKey(e.network);
      const st = netStyle(e.network);
      let cls = "link net-" + key;
      if (adjacent) cls += " hot";
      if (hitSet && !(hitSet.has(e.from) && hitSet.has(e.to)) && !adjacent) cls += " dim";
      linkLayer.append(svgEl("path", {
        class: cls, d, stroke: st.color, "stroke-width": st.width,
        "stroke-dasharray": st.dash || null, "marker-end": `url(#arrow-${key})`,
      }));
      if (e.label) {
        const t = svgEl("text", { class: "link-label", x: mid.x, y: mid.y - 8, "text-anchor": "middle" });
        t.textContent = e.label;
        labelLayer.append(t);
      }
    }
    svg.append(linkLayer, labelLayer);

    // top-level components as boxes; contained components as chips inside them
    const nodeLayer = svgEl("g");
    const topLevel = state.arch.components.filter((c) => !c.parent);
    topLevel.forEach((comp, index) => {
      const p = pos[comp.id];
      const st = nodeStatus(comp);
      let cls = "node";
      if (comp.id === state.selectedComp) cls += " selected";
      if (hitSet) cls += hitSet.has(comp.id) ? " hit" : " dim";
      const g = svgEl("g", { class: cls, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: "button", "data-id": comp.id });
      const inner = svgEl("g", { class: state.mapAnimated ? "" : "pop" });
      inner.style.animationDelay = `${index * 50}ms`;
      const title = svgEl("title");
      title.textContent = nodeTitle(comp);
      g.append(title);
      g.append(svgEl("rect", { class: "hitbox", width: p.w, height: p.h, rx: 8 }));
      if (comp.id === state.selectedComp || (hitSet && hitSet.has(comp.id))) {
        g.append(svgEl("rect", { class: "ring", x: 4, y: -2, width: p.w - 8, height: p.h + 4, rx: 10 }));
      }
      inner.append(...symbolNodes(comp));
      const name = svgEl("text", { class: "node-name", x: p.w / 2, y: 74 });
      name.textContent = truncate(comp.name, 26);
      const meta = svgEl("text", { class: "node-meta", x: p.w / 2, y: 92 });
      meta.textContent = truncate(nodeMeta(comp), 34);
      inner.append(name, meta);
      if (st !== "none") {
        inner.append(svgEl("circle", { class: "badge " + badgeClass(st), cx: p.w / 2 + 30, cy: 12, r: 7 }));
      }
      g.append(inner);
      for (const child of childrenOf(comp.id)) {
        const cp = pos[child.id];
        g.append(chipNode(child, { x: cp.x - p.x, y: cp.y - p.y, w: cp.w, h: cp.h }, hitSet));
      }
      g.addEventListener("click", () => selectComponent(comp.id));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectComponent(comp.id); }
      });
      nodeLayer.append(g);
    });
    svg.append(nodeLayer);
    state.mapAnimated = true;
    applyLayers();
    $("#zoom-level").textContent = Math.round(state.view.zoom * 100) + "%";
  }

  // A contained component (container, VM, service) drawn as a chip inside its host.
  function chipNode(child, rel, hitSet) {
    let cls = "chip";
    if (child.id === state.selectedComp) cls += " selected";
    if (hitSet) cls += hitSet.has(child.id) ? " hit" : " dim";
    const g = svgEl("g", { class: cls, transform: `translate(${rel.x},${rel.y})`, tabindex: 0, role: "button", "data-id": child.id });
    const title = svgEl("title");
    title.textContent = nodeTitle(child);
    g.append(title);
    g.append(svgEl("rect", { class: "chip-box", width: rel.w, height: rel.h, rx: 6 }));
    const icon = svgEl("g", { transform: "translate(5,2) scale(0.5)" });
    window.SymbolLib.draw(icon, child.symbol || "container", 0, 0, state.symbols.custom);
    g.append(icon);
    const label = svgEl("text", { class: "chip-text", x: 34, y: rel.h / 2 + 4 });
    label.textContent = truncate(child.name, 22);
    g.append(label);
    const open = (ev) => {
      ev.stopPropagation();
      selectComponent(child.id);
    };
    g.addEventListener("click", open);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(ev); }
    });
    return g;
  }

  // Returns the symbol nodes, centred at the top of the box.
  function symbolNodes(comp) {
    const holder = svgEl("g");
    window.SymbolLib.draw(holder, comp.symbol || "appliance", (NODE_W - window.SymbolLib.SIZE) / 2, 8, state.symbols.custom);
    return [...holder.childNodes];
  }

  function applyViewBox() {
    const v = state.view;
    $("#map").setAttribute("viewBox", `${v.x} ${v.y} ${v.w / v.zoom} ${v.h / v.zoom}`);
    const svg = $("#map");
    // semantic zoom: compact labels when zoomed out
    svg.classList.toggle("lod-compact", v.zoom < DETAIL_ZOOM);
    const zl = $("#zoom-level");
    if (zl) zl.textContent = Math.round(v.zoom * 100) + "%";
  }

  function fitView() {
    const v = state.view;
    const content = state.layout;
    v.zoom = 1;
    v.x = 0;
    v.y = content ? -(v.h - content.h) / 2 : 0;
    state.fitted = true;
  }

  function setZoom(next) {
    state.view.zoom = Math.min(3, Math.max(0.3, next));
    applyViewBox();
  }

  // Centres the view on a component (used by the model explorer).
  function focusComponent(id) {
    const p = state.layout && state.layout.pos[id];
    if (!p) return;
    const v = state.view;
    const vw = v.w / v.zoom;
    const vh = v.h / v.zoom;
    v.x = p.x + p.w / 2 - vw / 2;
    v.y = p.y + p.h / 2 - vh / 2;
    applyViewBox();
  }

  // Layers are toggled with CSS classes on the diagram, so they cost no re-render.
  function applyLayers() {
    const svg = $("#map");
    const on = (key) => {
      const box = document.querySelector(`[data-layer="${key}"]`);
      return box ? box.checked : true;
    };
    svg.classList.toggle("hide-zones", !on("zones"));
    svg.classList.toggle("hide-link-labels", !on("linkLabels"));
    svg.classList.toggle("hide-grid", !on("grid"));
    svg.classList.toggle("hide-badges", !on("badges"));
  }

  function bindMapInteractions() {
    const svg = $("#map");
    let drag = null;
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".node, .chip")) return;
      drag = { x: ev.clientX, y: ev.clientY, vx: state.view.x, vy: state.view.y };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const rect = svg.getBoundingClientRect();
      const scale = (state.view.w / state.view.zoom) / rect.width;
      state.view.x = drag.vx - (ev.clientX - drag.x) * scale;
      state.view.y = drag.vy - (ev.clientY - drag.y) * scale;
      applyViewBox();
    });
    const end = () => { drag = null; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      setZoom(state.view.zoom * (ev.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
    $("#zoom-in").addEventListener("click", () => setZoom(state.view.zoom * 1.2));
    $("#zoom-out").addEventListener("click", () => setZoom(state.view.zoom / 1.2));
    $("#zoom-fit").addEventListener("click", () => { fitView(); applyViewBox(); });
    document.querySelectorAll("[data-layer]").forEach((box) => box.addEventListener("change", applyLayers));

    document.addEventListener("keydown", (ev) => {
      if (ev.target.closest("input, select, textarea")) return;
      if (ev.key === "f" || ev.key === "F") { fitView(); applyViewBox(); }
      if (ev.key === "+" || ev.key === "=") setZoom(state.view.zoom * 1.2);
      if (ev.key === "-") setZoom(state.view.zoom / 1.2);
      if (ev.key === "Escape") { state.selectedComp = null; state.selectedReq = null; refresh(); }
    });
  }

  function renderLegend() {
    const root = $("#legend");
    root.replaceChildren();
    for (const st of Object.values(NETWORKS)) {
      const sample = svgEl("svg", { viewBox: "0 0 44 12", width: 44, height: 12, class: "legend-line", "aria-hidden": "true" });
      sample.append(svgEl("path", { d: "M2 6 H42", stroke: st.color, "stroke-width": st.width, "stroke-dasharray": st.dash || null, fill: "none" }));
      root.append(h("span", { class: "legend-item" }, sample, st.label));
    }
  }

  // ---------- sidebar ----------

  // Model explorer: zones → components → contained components, filterable.
  function renderTree() {
    const root = $("#tree");
    root.replaceChildren();
    if (!state.arch) return;
    const filter = ($("#tree-search").value || "").trim().toLowerCase();
    const match = (c) => !filter || c.name.toLowerCase().includes(filter) || (c.vendor || "").toLowerCase().includes(filter);
    for (const zone of zoneNames()) {
      const tops = state.arch.components.filter((c) => !c.parent && c.zone === zone);
      const rows = [];
      for (const c of tops) {
        const kids = childrenOf(c.id);
        if (!match(c) && !kids.some(match)) continue;
        rows.push(treeRow(c, 0));
        for (const k of kids) if (match(k) || match(c)) rows.push(treeRow(k, 1));
      }
      if (rows.length === 0) continue;
      const zi = zoneInfo(zone);
      root.append(h("div", { class: "tree-zone" },
        h("span", { class: "tree-zone-name", text: zone }),
        h("small", { class: "muted", text: zi ? netStyle(zi.network).label : "" })));
      root.append(...rows);
    }
    if (!root.childNodes.length) root.append(h("p", { class: "empty", text: "No components match the filter." }));
  }

  function treeRow(comp, depth) {
    const st = nodeStatus(comp);
    return h("button", {
      type: "button",
      class: "tree-row" + (depth ? " tree-child" : "") + (comp.id === state.selectedComp ? " current" : ""),
      onclick: () => { selectComponent(comp.id); focusComponent(comp.id); },
    },
      h("i", { class: "dot " + dotClass(st), "aria-hidden": "true" }),
      h("span", { text: comp.name }),
      h("small", { class: "muted", text: KINDS[comp.kind] || comp.kind }));
  }

  function renderControls() {
    const root = $("#controls");
    root.replaceChildren();
    $("#framework-meta").textContent = `${state.framework.name} · ${state.framework.version}`;
    for (const control of state.framework.controls) {
      const reqs = control.requirements.map((r) => {
        const st = statusFor(r.id, "").status;
        const mapped = componentsFor(r.id).length;
        return h("button", {
          type: "button",
          class: "req",
          "aria-pressed": state.selectedReq === r.id ? "true" : "false",
          onclick: () => selectRequirement(r.id),
        },
          h("i", { class: "dot " + dotClass(st), "aria-hidden": "true" }),
          h("span", {}, h("strong", { text: r.id + " " }), r.text,
            h("small", { text: `${statusLabel(st)} · ${mapped} component${mapped === 1 ? "" : "s"}${r.mandatory ? "" : " · advisory"}` })));
      });
      root.append(h("details", { class: "control", open: true },
        h("summary", { text: `${control.id} · ${control.title}` }), ...reqs));
    }
  }

  function renderSymbolLibrary() {
    const root = $("#symbol-library");
    root.replaceChildren();
    const grid = h("div", { class: "symbol-grid" });
    for (const g of state.symbols.generic) {
      grid.append(h("div", { class: "symbol-cell", title: window.SymbolLib.LABELS[g] || g },
        window.SymbolLib.preview(g, state.symbols.custom),
        h("small", { text: window.SymbolLib.LABELS[g] || g })));
    }
    root.append(h("p", { class: "muted", text: "Generic symbols" }), grid);

    const custom = Object.values(state.symbols.custom);
    root.append(h("p", { class: "muted", text: custom.length ? "Vendor symbols" : "No vendor symbols uploaded yet." }));
    for (const c of custom) {
      root.append(h("div", { class: "custom-row" },
        window.SymbolLib.preview("custom:" + c.id, state.symbols.custom),
        h("span", {}, c.name, h("small", { text: c.vendor || "no vendor" })),
        h("button", { type: "button", class: "small", onclick: () => deleteSymbol(c) }, "Delete")));
    }

    const file = h("input", { id: "sym-file", type: "file", accept: ".svg,image/svg+xml" });
    const name = h("input", { id: "sym-name", type: "text", maxlength: 80, placeholder: "e.g. NGFW-A firewall", autocomplete: "off" });
    const vendor = h("input", { id: "sym-vendor", type: "text", maxlength: 80, placeholder: "e.g. vendor name", autocomplete: "off" });
    root.append(h("details", { class: "upload" },
      h("summary", { text: "Add vendor symbol (SVG)" }),
      h("label", { class: "field" }, "Name", name),
      h("label", { class: "field" }, "Vendor", vendor),
      h("label", { class: "field" }, "SVG file (max 64 KB)", file),
      h("p", { class: "muted", text: "Use your own or licensed artwork: the tool does not ship third-party logos." }),
      h("button", { type: "button", class: "primary", onclick: uploadSymbol }, "Upload symbol")));
  }

  async function uploadSymbol() {
    const file = $("#sym-file").files[0];
    const name = $("#sym-name").value.trim();
    if (!name) { flash("Enter a name for the symbol.", "error"); return; }
    if (!file) { flash("Choose an SVG file.", "error"); return; }
    if (file.size > MAX_SVG_BYTES) { flash("File is too large (max 64 KB).", "error"); return; }
    try {
      const svg = await file.text();
      const created = await api("/api/symbols", {
        method: "POST",
        body: JSON.stringify({ name, vendor: $("#sym-vendor").value.trim(), svg }),
      });
      flash(`Symbol "${created.name}" uploaded and sanitized.`, "ok");
      await loadSymbols();
      refresh();
    } catch (err) {
      flash("Upload failed: " + err.message, "error");
    }
  }

  async function deleteSymbol(sym) {
    if (!window.confirm(`Delete the symbol "${sym.name}"?`)) return;
    try {
      await api("/api/symbols/" + encodeURIComponent(sym.id), { method: "DELETE" });
      flash("Symbol deleted.", "ok");
      await loadSymbols();
      refresh();
    } catch (err) {
      flash("Delete failed: " + err.message, "error");
    }
  }

  async function loadSymbols() {
    const res = await api("/api/symbols");
    state.symbols.generic = res.generic;
    state.symbols.custom = {};
    for (const c of res.custom) {
      state.symbols.custom["custom:" + c.id] = { ...c };
    }
  }

  // ---------- details panel ----------

  function renderDetail() {
    const root = $("#detail");
    root.replaceChildren();
    if (state.selectedComp) return renderComponentDetail(root);
    if (state.selectedReq) return renderRequirementDetail(root);
    root.append(
      h("p", { class: "empty", text: "Select a component on the diagram or in the model explorer, or a requirement on the left." }),
      renderAddComponent(),
      renderAddEdge(),
    );
  }

  function renderComponentDetail(root) {
    const comp = state.arch.components.find((c) => c.id === state.selectedComp);
    if (!comp) return;
    root.append(h("h3", { text: comp.name }));

    const hasChildren = childrenOf(comp.id).length > 0;
    const parentOptions = [h("option", { value: "", selected: !comp.parent ? true : null }, "— standalone element")];
    for (const c of state.arch.components) {
      if (c.id === comp.id || c.parent) continue;
      parentOptions.push(h("option", { value: c.id, selected: c.id === comp.parent ? true : null }, `${c.name} (${c.zone})`));
    }
    root.append(h("div", { class: "assessment" },
      h("label", { class: "field" }, "Name",
        h("input", { id: "ed-name", type: "text", maxlength: 120, value: comp.name })),
      h("label", { class: "field" }, "Type",
        h("select", { id: "ed-kind" }, ...Object.entries(KINDS).map(([k, label]) =>
          h("option", { value: k, selected: k === comp.kind ? true : null }, label)))),
      h("label", { class: "field" }, "Symbol",
        h("select", { id: "ed-symbol" }, ...symbolOptions(comp.symbol || "appliance"))),
      h("label", { class: "field" }, "Vendor",
        h("input", { id: "ed-vendor", type: "text", maxlength: 80, value: comp.vendor || "" })),
      h("label", { class: "field" }, "Model",
        h("input", { id: "ed-model", type: "text", maxlength: 80, value: comp.model || "" })),
      h("label", { class: "field" }, "Operating system",
        h("input", { id: "ed-os", type: "text", maxlength: 80, value: comp.os || "", placeholder: "e.g. RHEL 9.4" })),
      h("label", { class: "field" }, "Zone",
        h("select", { id: "ed-zone" }, ...zoneNames().map((z) =>
          h("option", { value: z, selected: z === comp.zone ? true : null }, z)))),
      h("label", { class: "field" }, "Hosted in",
        h("select", { id: "ed-parent", disabled: hasChildren ? true : null }, ...parentOptions)),
      hasChildren ? h("p", { class: "muted", text: "This element hosts other components, so it cannot be nested." }) : null,
      h("label", { class: "field" }, "Wazuh agent ID",
        h("input", { id: "ed-agent", type: "text", maxlength: 5, value: comp.agent_id || "", placeholder: "e.g. 001" })),
      h("div", { class: "row" }, h("button", {
        type: "button", class: "primary",
        onclick: () => saveComponentFields(comp.id),
      }, "Save component"))));

    root.append(h("h3", { text: "Inventory" }));
    const invBox = h("div", { id: "inventory" }, h("p", { class: "empty", text: "Loading inventory…" }));
    root.append(invBox);
    loadInventory(comp.id, invBox);

    const links = state.arch.edges.filter((e) => e.from === comp.id || e.to === comp.id);
    root.append(h("h3", { text: `Links (${links.length})` }));
    if (links.length === 0) root.append(h("p", { class: "empty", text: "No links." }));
    for (const e of links) {
      const other = state.arch.components.find((c) => c.id === (e.from === comp.id ? e.to : e.from));
      const dir = e.from === comp.id ? "→ " : "← ";
      const sel = h("select", { onchange: (ev) => setEdgeNetwork(e, ev.target.value) },
        h("option", { value: "", selected: !e.network ? true : null }, "— unclassified"),
        ...Object.entries(NETWORKS).map(([k, st]) =>
          h("option", { value: k, selected: e.network === k ? true : null }, st.label)));
      root.append(h("div", { class: "link-row" },
        h("span", { text: dir + (other ? other.name : "?") + (e.label ? " · " + e.label : "") }),
        sel));
    }

    root.append(h("h3", { text: "Mapped requirements" }));
    const reqIdx = requirementIndex();
    if (!comp.controls || comp.controls.length === 0) {
      root.append(h("p", { class: "empty", text: "No requirement mapped to this component." }));
      return;
    }
    for (const reqId of comp.controls) {
      const info = reqIdx[reqId];
      const current = statusFor(reqId, comp.id);
      const selId = `st-${comp.id}-${reqId}`;
      const rationaleId = `ra-${comp.id}-${reqId}`;
      root.append(h("div", { class: "assessment" },
        h("p", {}, h("strong", { text: reqId + " " }), info ? info.req.text : "(requirement not found)"),
        h("label", { class: "field" }, "Result", statusSelect(selId, current.status)),
        h("label", { class: "field" }, "Rationale / evidence",
          h("textarea", { id: rationaleId, maxlength: 4000 }, current.rationale || "")),
        h("div", { class: "row" }, h("button", {
          type: "button", class: "primary",
          onclick: () => saveAssessment(reqId, comp.id,
            document.getElementById(selId).value, document.getElementById(rationaleId).value),
        }, "Save"))));
    }
  }

  function renderRequirementDetail(root) {
    const info = requirementIndex()[state.selectedReq];
    if (!info) return;
    root.append(h("h3", { text: `${info.req.id} · ${info.control.title}` }));
    root.append(h("p", {}, info.req.text));
    root.append(h("p", { class: "muted", text: info.req.mandatory ? "Mandatory" : "Advisory" }));
    const current = statusFor(info.req.id, "");
    root.append(h("div", { class: "assessment" },
      h("p", { text: "Institution-wide result" }),
      h("label", { class: "field" }, "Result", statusSelect("st-global", current.status)),
      h("label", { class: "field" }, "Rationale",
        h("textarea", { id: "ra-global", maxlength: 4000 }, current.rationale || "")),
      h("div", { class: "row" }, h("button", {
        type: "button", class: "primary",
        onclick: () => saveAssessment(info.req.id, "",
          document.getElementById("st-global").value, document.getElementById("ra-global").value),
      }, "Save"))));
    const comps = componentsFor(info.req.id);
    root.append(h("h3", { text: `Mapped components (${comps.length})` }));
    if (comps.length === 0) root.append(h("p", { class: "empty", text: "No component mapped." }));
    for (const c of comps) {
      const st = statusFor(info.req.id, c.id).status;
      root.append(h("button", { type: "button", class: "req", onclick: () => selectComponent(c.id) },
        h("i", { class: "dot " + dotClass(st), "aria-hidden": "true" }),
        h("span", {}, c.name, h("small", { text: statusLabel(st) }))));
    }
  }

  function statusSelect(id, current) {
    return h("select", { id },
      ...STATUSES.map(([code, label]) => h("option", { value: code, selected: code === current ? true : null }, label)));
  }

  function renderAddComponent() {
    const name = h("input", { id: "new-name", type: "text", maxlength: 120, placeholder: "Component name" });
    const kind = h("select", { id: "new-kind" }, ...Object.entries(KINDS).map(([k, label]) =>
      h("option", { value: k, selected: k === "server" ? true : null }, label)));
    const sym = h("select", { id: "new-symbol" }, ...symbolOptions("server"));
    const zone = h("input", { id: "new-zone", type: "text", maxlength: 60, list: "zone-list", value: zoneNames()[0] || "", placeholder: "e.g. Cloud (example)" });
    const zones = h("datalist", { id: "zone-list" }, ...zoneNames().map((z) => h("option", { value: z })));
    const vendor = h("input", { id: "new-vendor", type: "text", maxlength: 80, placeholder: "Vendor (optional)" });
    const os = h("input", { id: "new-os", type: "text", maxlength: 80, placeholder: "Operating system (optional)" });
    return h("details", { class: "upload", open: true },
      h("summary", { text: "Add component" }),
      h("label", { class: "field" }, "Name", name),
      h("label", { class: "field" }, "Type", kind),
      h("label", { class: "field" }, "Symbol", sym),
      h("label", { class: "field" }, "Zone (type a new name to create one)", zone, zones),
      h("label", { class: "field" }, "Vendor", vendor),
      h("label", { class: "field" }, "Operating system", os),
      h("button", { type: "button", class: "primary", onclick: addComponent }, "Add component"));
  }

  function renderAddEdge() {
    const from = h("select", { id: "new-from" }, ...state.arch.components.map((c) => h("option", { value: c.id }, c.name)));
    const to = h("select", { id: "new-to" }, ...state.arch.components.map((c) => h("option", { value: c.id }, c.name)));
    const net = h("select", { id: "new-net" },
      h("option", { value: "" }, "— unclassified"),
      ...Object.entries(NETWORKS).map(([k, st]) => h("option", { value: k }, st.label)));
    const label = h("input", { id: "new-label", type: "text", maxlength: 80, placeholder: "Label (e.g. HTTPS)" });
    return h("details", { class: "upload" },
      h("summary", { text: "Add link" }),
      h("label", { class: "field" }, "From", from),
      h("label", { class: "field" }, "To", to),
      h("label", { class: "field" }, "Network type", net),
      h("label", { class: "field" }, "Label", label),
      h("button", { type: "button", class: "primary", onclick: addEdge }, "Add link"));
  }

  async function loadInventory(compId, box) {
    try {
      let items = state.inventory[compId];
      if (!items) {
        items = await api(`/api/components/${encodeURIComponent(compId)}/inventory`);
        state.inventory[compId] = items;
      }
      box.replaceChildren();
      if (items.length === 0) {
        box.append(h("p", { class: "empty", text: "No data yet. Run “Sync Wazuh” if the agent is configured." }));
        return;
      }
      const first = (cat) => items.find((i) => i.category === cat);
      const count = (cat) => items.filter((i) => i.category === cat).length;
      const hw = first("hardware");
      const os = first("os");
      const lines = [];
      if (hw) lines.push(`CPU: ${hw.fields["cpu.name"] || "—"}`, `RAM: ${hw.fields["ram.total"] || "—"}`, `Serial: ${hw.fields["board_serial"] || "—"}`);
      if (os) lines.push(`OS: ${os.fields["os.name"] || ""} ${os.fields["os.version"] || ""}`.trim());
      lines.push(`Packages: ${count("packages")} · Listening ports: ${count("ports")}`);
      const seen = items[0].seen_at ? new Date(items[0].seen_at).toLocaleString("en-GB") : "—";
      box.append(h("ul", { class: "inv-list" }, ...lines.map((l) => h("li", { text: l }))));
      box.append(h("p", { class: "muted", text: `Source: ${items[0].source} · last seen: ${seen}` }));
    } catch (err) {
      box.replaceChildren(h("p", { class: "empty", text: "Inventory not available: " + err.message }));
    }
  }

  // ---------- actions ----------

  function selectComponent(id) {
    state.selectedComp = id;
    state.selectedReq = null;
    refresh();
  }

  function selectRequirement(id) {
    state.selectedReq = state.selectedReq === id ? null : id;
    state.selectedComp = null;
    refresh();
  }

  // Sends the whole architecture; the server validates it before saving.
  async function saveArchitecture(mutate, okText) {
    const copy = JSON.parse(JSON.stringify(state.arch));
    try {
      mutate(copy);
      state.arch = await api("/api/architecture", { method: "PUT", body: JSON.stringify(copy) });
      if (okText) flash(okText, "ok");
      refresh();
    } catch (err) {
      flash("Change not saved: " + err.message, "error");
    }
  }

  function saveComponentFields(id) {
    const parentId = $("#ed-parent").value;
    const host = state.arch.components.find((x) => x.id === parentId);
    const values = {
      name: $("#ed-name").value.trim(),
      kind: $("#ed-kind").value,
      symbol: $("#ed-symbol").value,
      vendor: $("#ed-vendor").value.trim(),
      model: $("#ed-model").value.trim(),
      os: $("#ed-os").value.trim(),
      zone: host ? host.zone : $("#ed-zone").value,
      parent: parentId,
      agent_id: $("#ed-agent").value.trim(),
    };
    if (!values.name) { flash("Name is required.", "error"); return; }
    saveArchitecture((arch) => {
      const c = arch.components.find((x) => x.id === id);
      Object.assign(c, values);
      for (const k of ["agent_id", "vendor", "model", "os", "parent"]) {
        if (!c[k]) delete c[k];
      }
    }, "Component saved.");
  }

  function setEdgeNetwork(edge, network) {
    saveArchitecture((arch) => {
      const e = arch.edges.find((x) => x.from === edge.from && x.to === edge.to && x.label === edge.label);
      if (!e) throw new Error("link not found");
      if (network) e.network = network; else delete e.network;
    }, "Network type updated.");
  }

  function addComponent() {
    const name = $("#new-name").value.trim();
    if (!name) { flash("Enter a component name.", "error"); return; }
    const id = "c-" + Date.now().toString(36);
    saveArchitecture((arch) => {
      arch.components.push({
        id,
        name,
        kind: $("#new-kind").value,
        zone: $("#new-zone").value.trim(),
        symbol: $("#new-symbol").value,
        vendor: $("#new-vendor").value.trim() || undefined,
        os: $("#new-os").value.trim() || undefined,
      });
    }, "Component added.");
  }

  function addEdge() {
    const from = $("#new-from").value;
    const to = $("#new-to").value;
    if (from === to) { flash("A link must join two different components.", "error"); return; }
    const network = $("#new-net").value;
    const label = $("#new-label").value.trim();
    saveArchitecture((arch) => {
      arch.edges.push({ from, to, label: label || undefined, network: network || undefined });
    }, "Link added.");
  }

  async function saveAssessment(reqId, compId, status, rationale) {
    const auditor = $("#auditor").value.trim();
    if (!auditor) {
      flash("Enter the auditor's name before saving.", "error");
      $("#auditor").focus();
      return;
    }
    try { localStorage.setItem("auditor", auditor); } catch (_) { /* storage may be unavailable */ }
    try {
      state.assessments = await api("/api/assessments", {
        method: "PUT",
        body: JSON.stringify({ requirement_id: reqId, component_id: compId, status, rationale, auditor }),
      });
      flash("Assessment saved.", "ok");
      refresh();
    } catch (err) {
      flash("Save failed: " + err.message, "error");
    }
  }

  async function syncWazuh() {
    const btn = $("#btn-sync");
    btn.disabled = true;
    flash("Syncing with Wazuh…");
    try {
      const res = await api("/api/wazuh/sync", { method: "POST" });
      state.inventory = {};
      const errs = Object.keys(res.errors || {}).length;
      flash(`Synced ${res.synced} component${res.synced === 1 ? "" : "s"}${errs ? ` · ${errs} with errors (see server log)` : ""}.`, errs ? "error" : "ok");
      refresh();
    } catch (err) {
      flash("Sync failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  function refresh() {
    renderMap();
    renderTree();
    renderControls();
    renderDetail();
    renderSymbolLibrary();
  }

  async function init() {
    try {
      const [framework, arch, assessments] = await Promise.all([
        api("/api/framework"),
        api("/api/architecture"),
        api("/api/assessments"),
      ]);
      state.framework = framework;
      state.arch = arch;
      state.assessments = assessments;
    } catch (err) {
      flash("Could not load data: " + err.message, "error");
      return;
    }
    try {
      await loadSymbols();
    } catch (err) {
      flash("Symbol library not available: " + err.message, "error");
    }
    try {
      const saved = localStorage.getItem("auditor");
      if (saved) $("#auditor").value = saved;
    } catch (_) { /* ignore */ }
    bindMapInteractions();
    renderLegend();
    $("#btn-sync").addEventListener("click", syncWazuh);
    $("#tree-search").addEventListener("input", renderTree);
    refresh();
  }

  init();
})();
