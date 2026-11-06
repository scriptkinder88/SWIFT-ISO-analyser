// SWIFT ISO Analyser: architecture drawing, symbol library, auditor panel.
// Plain DOM and SVG, no dependencies. Symbols come from symbols.js.
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
  const MAX_SVG_BYTES = 64 * 1024;

  const STATUSES = [
    ["non_valutato", "Da valutare"],
    ["conforme", "Conforme"],
    ["parzialmente_conforme", "Parzialmente conforme"],
    ["non_conforme", "Non conforme"],
    ["non_applicabile", "Non applicabile"],
  ];

  // Line style per network type: colour, width, dash pattern.
  const NETWORKS = {
    internet:   { label: "Internet / non fidata", color: "#c62828", width: 2,   dash: "" },
    dmz:        { label: "DMZ",                  color: "#ef6c00", width: 2,   dash: "8 4" },
    swift:      { label: "Zona SWIFT",           color: "#1f3864", width: 4,   dash: "" },
    internal:   { label: "Rete interna",         color: "#546e7a", width: 1.5, dash: "" },
    management: { label: "Gestione / sicurezza", color: "#2e7d32", width: 1.5, dash: "2 3" },
    backup:     { label: "Backup",               color: "#6a1b9a", width: 1.5, dash: "10 3 2 3" },
  };
  const DEFAULT_NET = { label: "Non classificata", color: "#7f8a99", width: 1.5, dash: "" };

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
    return found ? found[1] : "Da valutare";
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

  // ---------- layout ----------

  // Zones are placed left to right, wrapping to a new band row after MAX_COLS.
  function computeLayout() {
    const zones = [];
    for (const c of state.arch.components) {
      if (!zones.includes(c.zone)) zones.push(c.zone);
    }
    const counts = zones.map((z) => state.arch.components.filter((c) => c.zone === z).length);
    const cols = Math.max(1, Math.min(MAX_COLS, zones.length));
    const bandRows = Math.ceil(zones.length / cols);
    const pos = {};
    const bands = [];
    let y0 = 0;
    for (let r = 0; r < bandRows; r++) {
      const idxs = zones.map((_, i) => i).filter((i) => Math.floor(i / cols) === r);
      const tallest = Math.max(1, ...idxs.map((i) => counts[i]));
      const bandH = BAND_HEAD + 30 + tallest * (NODE_H + ROW_GAP);
      for (const i of idxs) {
        const x = PAD + (i % cols) * COL_W;
        bands.push({ zone: zones[i], x: x - 20, y: y0 + 10, w: NODE_W + 40, h: bandH - 20 });
        let row = 0;
        for (const comp of state.arch.components) {
          if (comp.zone !== zones[i]) continue;
          pos[comp.id] = { x, y: y0 + BAND_HEAD + row * (NODE_H + ROW_GAP) };
          row++;
        }
      }
      y0 += bandH + ROW_GAP / 2;
    }
    const w = PAD * 2 + cols * COL_W - (COL_W - NODE_W);
    const h = y0 + 30;
    return { zones, pos, w, h, bands };
  }

  // ---------- map ----------

  function edgePath(a, b) {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    let sx, sy, ex, ey, c1x, c1y, c2x, c2y;
    if (Math.abs(bx - ax) >= COL_W - 20) {
      const right = bx > ax;
      sx = right ? ax + NODE_W : ax;
      ex = right ? bx : bx + NODE_W;
      sy = ay + NODE_H / 2;
      ey = by + NODE_H / 2;
      const off = Math.max(40, Math.abs(ex - sx) / 2) * (right ? 1 : -1);
      c1x = sx + off; c1y = sy; c2x = ex - off; c2y = ey;
    } else {
      const down = by > ay;
      sx = ax + NODE_W / 2;
      ex = bx + NODE_W / 2;
      sy = down ? ay + NODE_H : ay;
      ey = down ? by : by + NODE_H;
      const off = Math.max(30, Math.abs(ey - sy) / 2) * (down ? 1 : -1);
      c1x = sx; c1y = sy + off; c2x = ex; c2y = ey - off;
    }
    const mid = { x: (sx + 3 * c1x + 3 * c2x + ex) / 8, y: (sy + 3 * c1y + 3 * c2y + ey) / 8 };
    return { d: `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`, mid };
  }

  function buildDefs(svg) {
    const defs = svgEl("defs");
    // paper grid, drawing-style background
    const pattern = svgEl("pattern", { id: "grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" });
    pattern.append(svgEl("circle", { cx: 1, cy: 1, r: 1, class: "grid-dot" }));
    defs.append(pattern);
    // one arrow marker per network type, coloured like its line
    const keys = [...Object.keys(NETWORKS), "none"];
    for (const key of keys) {
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
    const { pos, w, h, bands } = layout;
    const box = svg.getBoundingClientRect();
    const aspect = box.width > 0 && box.height > 0 ? box.height / box.width : h / w;
    const viewH = Math.max(h, w * aspect);
    state.view.w = w;
    state.view.h = viewH;
    state.view.x = 0;
    state.view.y = -(viewH - h) / 2;
    state.view.zoom = 1;
    applyViewBox();

    buildDefs(svg);
    svg.append(svgEl("rect", { class: "paper", x: -5000, y: -5000, width: 10000, height: 10000 }));
    svg.append(svgEl("rect", { class: "grid", x: -5000, y: -5000, width: 10000, height: 10000 }));

    // zones
    for (const b of bands) {
      const info = zoneInfo(b.zone);
      const st = netStyle(info ? info.network : "");
      svg.append(svgEl("rect", {
        class: "zone", x: b.x, y: b.y, width: b.w, height: b.h, rx: 10,
        stroke: st.color, "stroke-dasharray": "12 6",
      }));
      const text = b.zone + (info ? "  ·  " + st.label : "");
      const tabW = Math.min(b.w + 40, 28 + text.length * 8.6);
      svg.append(svgEl("rect", { class: "zone-tab", x: b.x + 12, y: b.y - 12, width: tabW, height: 24, rx: 4, stroke: st.color }));
      const label = svgEl("text", { class: "zone-label", x: b.x + 22, y: b.y + 4 });
      label.textContent = text;
      svg.append(label);
    }

    const hitSet = state.selectedReq ? new Set(componentsFor(state.selectedReq).map((c) => c.id)) : null;

    // links
    const linkLayer = svgEl("g");
    const labelLayer = svgEl("g");
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

    // nodes
    const nodeLayer = svgEl("g");
    state.arch.components.forEach((comp, index) => {
      const p = pos[comp.id];
      const st = nodeStatus(comp);
      let cls = "node";
      if (comp.id === state.selectedComp) cls += " selected";
      if (hitSet) cls += hitSet.has(comp.id) ? " hit" : " dim";
      const g = svgEl("g", { class: cls, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: "button", "data-id": comp.id });
      const inner = svgEl("g", { class: state.mapAnimated ? "" : "pop" });
      inner.style.animationDelay = `${index * 50}ms`;
      const title = svgEl("title");
      title.textContent = `${comp.name}${comp.vendor ? " · " + comp.vendor : ""}${comp.model ? " " + comp.model : ""}`;
      g.append(title);
      g.append(svgEl("rect", { class: "hitbox", width: NODE_W, height: NODE_H, rx: 8 }));
      if (comp.id === state.selectedComp || (hitSet && hitSet.has(comp.id))) {
        g.append(svgEl("rect", { class: "ring", x: 4, y: -2, width: NODE_W - 8, height: NODE_H + 4, rx: 10 }));
      }
      inner.append(...symbolNodes(comp));
      const name = svgEl("text", { class: "node-name", x: NODE_W / 2, y: 74 });
      name.textContent = truncate(comp.name, 26);
      const meta = svgEl("text", { class: "node-meta", x: NODE_W / 2, y: 92 });
      meta.textContent = truncate(nodeMeta(comp), 34);
      inner.append(name, meta);
      if (st !== "none") {
        inner.append(svgEl("circle", { class: "badge " + badgeClass(st), cx: NODE_W / 2 + 30, cy: 12, r: 7 }));
      }
      g.append(inner);
      g.addEventListener("click", () => selectComponent(comp.id));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectComponent(comp.id); }
      });
      nodeLayer.append(g);
    });
    svg.append(nodeLayer);
    state.mapAnimated = true;
  }

  // Returns a group holding the symbol, centred at the top of the node box.
  function symbolNodes(comp) {
    const holder = svgEl("g");
    window.SymbolLib.draw(holder, comp.symbol || "appliance", (NODE_W - window.SymbolLib.SIZE) / 2, 8, state.symbols.custom);
    return [...holder.childNodes];
  }

  function nodeMeta(comp) {
    const parts = [comp.vendor, comp.model].filter(Boolean);
    if (parts.length) return parts.join(" · ");
    return comp.kind + (comp.agent_id ? " · agent " + comp.agent_id : "");
  }

  function applyViewBox() {
    const v = state.view;
    $("#map").setAttribute("viewBox", `${v.x} ${v.y} ${v.w / v.zoom} ${v.h / v.zoom}`);
  }

  function setZoom(next) {
    state.view.zoom = Math.min(3, Math.max(0.4, next));
    applyViewBox();
  }

  function bindMapInteractions() {
    const svg = $("#map");
    let drag = null;
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".node")) return;
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
    $("#zoom-reset").addEventListener("click", () => {
      state.view.zoom = 1; state.view.x = 0; state.view.y = 0; applyViewBox();
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
            h("small", { text: `${statusLabel(st)} · ${mapped} componenti${r.mandatory ? "" : " · advisory"}` })));
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
    root.append(h("p", { class: "muted", text: "Simboli generici" }), grid);

    const custom = Object.values(state.symbols.custom);
    root.append(h("p", { class: "muted", text: custom.length ? "Simboli vendor caricati" : "Nessun simbolo vendor caricato." }));
    for (const c of custom) {
      root.append(h("div", { class: "custom-row" },
        window.SymbolLib.preview("custom:" + c.id, state.symbols.custom),
        h("span", {}, c.name, h("small", { text: c.vendor || "vendor non indicato" })),
        h("button", { type: "button", class: "small", onclick: () => deleteSymbol(c) }, "Elimina")));
    }

    const file = h("input", { id: "sym-file", type: "file", accept: ".svg,image/svg+xml" });
    const name = h("input", { id: "sym-name", type: "text", maxlength: 80, placeholder: "Es. Firewall NGFW-A", autocomplete: "off" });
    const vendor = h("input", { id: "sym-vendor", type: "text", maxlength: 80, placeholder: "Es. nome del vendor", autocomplete: "off" });
    root.append(h("details", { class: "upload" },
      h("summary", { text: "Aggiungi simbolo vendor (SVG)" }),
      h("label", { class: "field" }, "Nome", name),
      h("label", { class: "field" }, "Vendor", vendor),
      h("label", { class: "field" }, "File SVG (max 64 KB)", file),
      h("p", { class: "muted", text: "Usa un disegno tuo o autorizzato: il tool non include loghi di terzi." }),
      h("button", { type: "button", class: "primary", onclick: uploadSymbol }, "Carica simbolo")));
  }

  async function uploadSymbol() {
    const file = $("#sym-file").files[0];
    const name = $("#sym-name").value.trim();
    if (!name) { flash("Indica il nome del simbolo.", "error"); return; }
    if (!file) { flash("Scegli un file SVG.", "error"); return; }
    if (file.size > MAX_SVG_BYTES) { flash("File troppo grande (max 64 KB).", "error"); return; }
    try {
      const svg = await file.text();
      const created = await api("/api/symbols", {
        method: "POST",
        body: JSON.stringify({ name, vendor: $("#sym-vendor").value.trim(), svg }),
      });
      flash(`Simbolo «${created.name}» caricato e pulito.`, "ok");
      await loadSymbols();
      refresh();
    } catch (err) {
      flash("Caricamento non riuscito: " + err.message, "error");
    }
  }

  async function deleteSymbol(sym) {
    if (!window.confirm(`Eliminare il simbolo «${sym.name}»?`)) return;
    try {
      await api("/api/symbols/" + encodeURIComponent(sym.id), { method: "DELETE" });
      flash("Simbolo eliminato.", "ok");
      await loadSymbols();
      refresh();
    } catch (err) {
      flash("Eliminazione non riuscita: " + err.message, "error");
    }
  }

  async function loadSymbols() {
    const res = await api("/api/symbols");
    state.symbols.generic = res.generic;
    state.symbols.custom = {};
    for (const c of res.custom) {
      state.symbols.custom["custom:" + c.id] = { ...c, name: c.name, vendor: c.vendor };
    }
  }

  // ---------- panel ----------

  function renderDetail() {
    const root = $("#detail");
    root.replaceChildren();
    if (state.selectedComp) return renderComponentDetail(root);
    if (state.selectedReq) return renderRequirementDetail(root);
    root.append(
      h("p", { class: "empty", text: "Seleziona un componente nella mappa o un sotto-punto a sinistra." }),
      renderAddComponent(),
      renderAddEdge(),
    );
  }

  function renderComponentDetail(root) {
    const comp = state.arch.components.find((c) => c.id === state.selectedComp);
    if (!comp) return;
    root.append(h("h3", { text: comp.name }));

    const name = h("input", { id: "ed-name", type: "text", maxlength: 120, value: comp.name });
    const sym = h("select", { id: "ed-symbol" }, ...symbolOptions(comp.symbol || "appliance"));
    const vendor = h("input", { id: "ed-vendor", type: "text", maxlength: 80, value: comp.vendor || "" });
    const model = h("input", { id: "ed-model", type: "text", maxlength: 80, value: comp.model || "" });
    const zone = h("select", { id: "ed-zone" }, ...zoneNames().map((z) =>
      h("option", { value: z, selected: z === comp.zone ? true : null }, z)));
    const agent = h("input", { id: "ed-agent", type: "text", maxlength: 5, value: comp.agent_id || "", placeholder: "es. 001" });
    root.append(h("div", { class: "assessment" },
      h("label", { class: "field" }, "Nome", name),
      h("label", { class: "field" }, "Simbolo", sym),
      h("label", { class: "field" }, "Vendor", vendor),
      h("label", { class: "field" }, "Modello", model),
      h("label", { class: "field" }, "Zona", zone),
      h("label", { class: "field" }, "Agent Wazuh (ID)", agent),
      h("div", { class: "row" }, h("button", {
        type: "button", class: "primary",
        onclick: () => saveComponentFields(comp.id),
      }, "Salva componente"))));

    root.append(h("h3", { text: "Inventory" }));
    const invBox = h("div", { id: "inventory" }, h("p", { class: "empty", text: "Caricamento inventory…" }));
    root.append(invBox);
    loadInventory(comp.id, invBox);

    const links = state.arch.edges.filter((e) => e.from === comp.id || e.to === comp.id);
    root.append(h("h3", { text: `Collegamenti (${links.length})` }));
    if (links.length === 0) root.append(h("p", { class: "empty", text: "Nessun collegamento." }));
    for (const e of links) {
      const other = state.arch.components.find((c) => c.id === (e.from === comp.id ? e.to : e.from));
      const dir = e.from === comp.id ? "→ " : "← ";
      const sel = h("select", { onchange: (ev) => setEdgeNetwork(e, ev.target.value) },
        h("option", { value: "", selected: !e.network ? true : null }, "— non classificata"),
        ...Object.entries(NETWORKS).map(([k, st]) =>
          h("option", { value: k, selected: e.network === k ? true : null }, st.label)));
      root.append(h("div", { class: "link-row" },
        h("span", { text: dir + (other ? other.name : "?") + (e.label ? " · " + e.label : "") }),
        sel));
    }

    root.append(h("h3", { text: "Sotto-punti mappati" }));
    const reqIdx = requirementIndex();
    if (!comp.controls || comp.controls.length === 0) {
      root.append(h("p", { class: "empty", text: "Nessun sotto-punto mappato su questo componente." }));
      return;
    }
    for (const reqId of comp.controls) {
      const info = reqIdx[reqId];
      const current = statusFor(reqId, comp.id);
      const selId = `st-${comp.id}-${reqId}`;
      const rationaleId = `ra-${comp.id}-${reqId}`;
      root.append(h("div", { class: "assessment" },
        h("p", {}, h("strong", { text: reqId + " " }), info ? info.req.text : "(requisito non trovato)"),
        h("label", { class: "field" }, "Esito", statusSelect(selId, current.status)),
        h("label", { class: "field" }, "Motivazione / evidenza",
          h("textarea", { id: rationaleId, maxlength: 4000 }, current.rationale || "")),
        h("div", { class: "row" }, h("button", {
          type: "button", class: "primary",
          onclick: () => saveAssessment(reqId, comp.id,
            document.getElementById(selId).value, document.getElementById(rationaleId).value),
        }, "Salva"))));
    }
  }

  function renderRequirementDetail(root) {
    const info = requirementIndex()[state.selectedReq];
    if (!info) return;
    root.append(h("h3", { text: `${info.req.id} · ${info.control.title}` }));
    root.append(h("p", {}, info.req.text));
    root.append(h("p", { class: "muted", text: info.req.mandatory ? "Obbligatorio" : "Advisory" }));
    const current = statusFor(info.req.id, "");
    root.append(h("div", { class: "assessment" },
      h("p", { text: "Esito globale dell'istituzione" }),
      h("label", { class: "field" }, "Esito", statusSelect("st-global", current.status)),
      h("label", { class: "field" }, "Motivazione",
        h("textarea", { id: "ra-global", maxlength: 4000 }, current.rationale || "")),
      h("div", { class: "row" }, h("button", {
        type: "button", class: "primary",
        onclick: () => saveAssessment(info.req.id, "",
          document.getElementById("st-global").value, document.getElementById("ra-global").value),
      }, "Salva"))));
    const comps = componentsFor(info.req.id);
    root.append(h("h3", { text: `Componenti mappati (${comps.length})` }));
    if (comps.length === 0) root.append(h("p", { class: "empty", text: "Nessun componente mappato." }));
    for (const c of comps) {
      const st = statusFor(info.req.id, c.id).status;
      root.append(h("button", { type: "button", class: "req", onclick: () => selectComponent(c.id) },
        h("i", { class: "dot " + dotClass(st), "aria-hidden": "true" }),
        h("span", {}, c.name, h("small", { text: statusLabel(st) }))));
    }
  }

  function zoneNames() {
    const names = [];
    for (const z of state.arch.zones || []) names.push(z.name);
    for (const c of state.arch.components) if (!names.includes(c.zone)) names.push(c.zone);
    return names;
  }

  function statusSelect(id, current) {
    return h("select", { id },
      ...STATUSES.map(([code, label]) => h("option", { value: code, selected: code === current ? true : null }, label)));
  }

  function renderAddComponent() {
    const name = h("input", { id: "new-name", type: "text", maxlength: 120, placeholder: "Nome componente" });
    const sym = h("select", { id: "new-symbol" }, ...symbolOptions("server"));
    const zone = h("select", { id: "new-zone" }, ...zoneNames().map((z) => h("option", { value: z }, z)));
    const vendor = h("input", { id: "new-vendor", type: "text", maxlength: 80, placeholder: "Vendor (opzionale)" });
    return h("details", { class: "upload", open: true },
      h("summary", { text: "Aggiungi componente" }),
      h("label", { class: "field" }, "Nome", name),
      h("label", { class: "field" }, "Simbolo", sym),
      h("label", { class: "field" }, "Zona", zone),
      h("label", { class: "field" }, "Vendor", vendor),
      h("button", { type: "button", class: "primary", onclick: addComponent }, "Aggiungi"));
  }

  function renderAddEdge() {
    const from = h("select", { id: "new-from" }, ...state.arch.components.map((c) => h("option", { value: c.id }, c.name)));
    const to = h("select", { id: "new-to" }, ...state.arch.components.map((c) => h("option", { value: c.id }, c.name)));
    const net = h("select", { id: "new-net" },
      h("option", { value: "" }, "— non classificata"),
      ...Object.entries(NETWORKS).map(([k, st]) => h("option", { value: k }, st.label)));
    const label = h("input", { id: "new-label", type: "text", maxlength: 80, placeholder: "Etichetta (es. HTTPS)" });
    return h("details", { class: "upload" },
      h("summary", { text: "Aggiungi collegamento" }),
      h("label", { class: "field" }, "Da", from),
      h("label", { class: "field" }, "A", to),
      h("label", { class: "field" }, "Tipo di rete", net),
      h("label", { class: "field" }, "Etichetta", label),
      h("button", { type: "button", class: "primary", onclick: addEdge }, "Aggiungi collegamento"));
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
        box.append(h("p", { class: "empty", text: "Nessun dato. Usa «Sincronizza Wazuh» se l'agent è configurato." }));
        return;
      }
      const first = (cat) => items.find((i) => i.category === cat);
      const count = (cat) => items.filter((i) => i.category === cat).length;
      const hw = first("hardware");
      const os = first("os");
      const lines = [];
      if (hw) lines.push(`CPU: ${hw.fields["cpu.name"] || "—"}`, `RAM: ${hw.fields["ram.total"] || "—"}`, `Seriale: ${hw.fields["board_serial"] || "—"}`);
      if (os) lines.push(`OS: ${os.fields["os.name"] || ""} ${os.fields["os.version"] || ""}`.trim());
      lines.push(`Pacchetti: ${count("packages")} · Porte in ascolto: ${count("ports")}`);
      const seen = items[0].seen_at ? new Date(items[0].seen_at).toLocaleString("it-IT") : "—";
      box.append(h("ul", { class: "inv-list" }, ...lines.map((l) => h("li", { text: l }))));
      box.append(h("p", { class: "muted", text: `Fonte: ${items[0].source} · rilevato: ${seen}` }));
    } catch (err) {
      box.replaceChildren(h("p", { class: "empty", text: "Inventory non disponibile: " + err.message }));
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
      flash("Modifica non salvata: " + err.message, "error");
    }
  }

  function saveComponentFields(id) {
    const values = {
      name: $("#ed-name").value.trim(),
      symbol: $("#ed-symbol").value,
      vendor: $("#ed-vendor").value.trim(),
      model: $("#ed-model").value.trim(),
      zone: $("#ed-zone").value,
      agent_id: $("#ed-agent").value.trim(),
    };
    if (!values.name) { flash("Il nome è obbligatorio.", "error"); return; }
    saveArchitecture((arch) => {
      const c = arch.components.find((x) => x.id === id);
      Object.assign(c, values);
      if (!c.agent_id) delete c.agent_id;
      if (!c.vendor) delete c.vendor;
      if (!c.model) delete c.model;
    }, "Componente salvato.");
  }

  function setEdgeNetwork(edge, network) {
    saveArchitecture((arch) => {
      const e = arch.edges.find((x) => x.from === edge.from && x.to === edge.to && x.label === edge.label);
      if (!e) throw new Error("collegamento non trovato");
      if (network) e.network = network; else delete e.network;
    }, "Tipo di rete aggiornato.");
  }

  function addComponent() {
    const name = $("#new-name").value.trim();
    if (!name) { flash("Indica il nome del componente.", "error"); return; }
    const id = "c-" + Date.now().toString(36);
    saveArchitecture((arch) => {
      arch.components.push({
        id,
        name,
        kind: "server",
        zone: $("#new-zone").value,
        symbol: $("#new-symbol").value,
        vendor: $("#new-vendor").value.trim() || undefined,
      });
    }, "Componente aggiunto.");
  }

  function addEdge() {
    const from = $("#new-from").value;
    const to = $("#new-to").value;
    if (from === to) { flash("Un collegamento deve unire due componenti diversi.", "error"); return; }
    const network = $("#new-net").value;
    const label = $("#new-label").value.trim();
    saveArchitecture((arch) => {
      arch.edges.push({ from, to, label: label || undefined, network: network || undefined });
    }, "Collegamento aggiunto.");
  }

  async function saveAssessment(reqId, compId, status, rationale) {
    const auditor = $("#auditor").value.trim();
    if (!auditor) {
      flash("Inserisci il nome dell'auditor prima di salvare.", "error");
      $("#auditor").focus();
      return;
    }
    try { localStorage.setItem("auditor", auditor); } catch (_) { /* storage may be unavailable */ }
    try {
      state.assessments = await api("/api/assessments", {
        method: "PUT",
        body: JSON.stringify({ requirement_id: reqId, component_id: compId, status, rationale, auditor }),
      });
      flash("Valutazione salvata.", "ok");
      refresh();
    } catch (err) {
      flash("Salvataggio non riuscito: " + err.message, "error");
    }
  }

  async function syncWazuh() {
    const btn = $("#btn-sync");
    btn.disabled = true;
    flash("Sincronizzazione con Wazuh in corso…");
    try {
      const res = await api("/api/wazuh/sync", { method: "POST" });
      state.inventory = {};
      const errs = Object.keys(res.errors || {}).length;
      flash(`Sincronizzati ${res.synced} componenti${errs ? ` · ${errs} con errori (vedi log del server)` : ""}.`, errs ? "error" : "ok");
      refresh();
    } catch (err) {
      flash("Sincronizzazione non riuscita: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  function refresh() {
    renderMap();
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
      flash("Impossibile caricare i dati: " + err.message, "error");
      return;
    }
    try {
      await loadSymbols();
    } catch (err) {
      flash("Libreria simboli non disponibile: " + err.message, "error");
    }
    try {
      const saved = localStorage.getItem("auditor");
      if (saved) $("#auditor").value = saved;
    } catch (_) { /* ignore */ }
    bindMapInteractions();
    renderLegend();
    $("#btn-sync").addEventListener("click", syncWazuh);
    refresh();
  }

  init();
})();
