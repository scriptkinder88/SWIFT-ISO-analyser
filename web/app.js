// SWIFT ISO Analyser - interactive architecture map and auditor panel.
// No dependencies: plain DOM and SVG.
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const NODE_W = 250;
  const NODE_H = 88;
  const COL_W = 330;
  const ROW_GAP = 46;
  const PAD = 50;

  const STATUSES = [
    ["non_valutato", "Da valutare"],
    ["conforme", "Conforme"],
    ["parzialmente_conforme", "Parzialmente conforme"],
    ["non_conforme", "Non conforme"],
    ["non_applicabile", "Non applicabile"],
  ];

  const state = {
    framework: null,
    arch: null,
    assessments: [],
    selectedComp: null,
    selectedReq: null,
    inventory: {},
    view: { zoom: 1, x: 0, y: 0, w: 1000, h: 600 },
    layout: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- helpers ----------

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
    }
    return el;
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

  function badgeClass(code) {
    switch (code) {
      case "conforme": return "badge-ok";
      case "parzialmente_conforme": return "badge-partial";
      case "non_conforme": return "badge-ko";
      default: return "badge-todo";
    }
  }

  function requirementIndex() {
    const idx = {};
    for (const c of state.framework.controls) {
      for (const r of c.requirements) idx[r.id] = { control: c, req: r };
    }
    return idx;
  }

  // ---------- layout ----------

  // Zones are placed left to right, wrapping to a new band row after MAX_COLS,
  // so the diagram stays close to the container's proportions and scales up.
  const MAX_COLS = 3;

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
      const bandH = 70 + tallest * (NODE_H + ROW_GAP);
      for (const i of idxs) {
        const col = i % cols;
        const x = PAD + col * COL_W;
        bands.push({ zone: zones[i], x: x - 16, y: y0 + 8, w: COL_W - 18, h: bandH - 16 });
        let row = 0;
        for (const comp of state.arch.components) {
          if (comp.zone !== zones[i]) continue;
          pos[comp.id] = { x, y: y0 + 60 + row * (NODE_H + ROW_GAP) };
          row++;
        }
      }
      y0 += bandH + ROW_GAP / 2;
    }
    const w = PAD * 2 + cols * COL_W;
    const h = y0 + 20;
    return { zones, pos, w, h, bands };
  }

  // ---------- map rendering ----------

  function renderMap() {
    const svg = $("#map");
    svg.replaceChildren();
    if (!state.arch) return;

    state.layout = computeLayout();
    const { pos, w, h, bands } = state.layout;
    // Match the viewBox to the container's aspect ratio so the diagram fills the
    // available area; the content is centred vertically inside the extra space.
    const box = svg.getBoundingClientRect();
    const aspect = box.width > 0 && box.height > 0 ? box.height / box.width : h / w;
    const viewH = Math.max(h, w * aspect);
    state.view.w = w;
    state.view.h = viewH;
    state.view.x = 0;
    state.view.y = -(viewH - h) / 2;
    state.view.zoom = 1;
    applyViewBox();

    const defs = svgEl("defs");
    const marker = svgEl("marker", {
      id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse",
    });
    marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" }));
    defs.append(marker);
    svg.append(defs);

    for (const b of bands) {
      svg.append(svgEl("rect", { class: "zone-band", x: b.x, y: b.y, width: b.w, height: b.h, rx: 14 }));
      const label = svgEl("text", { class: "zone-label", x: b.x + 14, y: b.y + 30 });
      label.textContent = b.zone;
      svg.append(label);
    }

    const hitSet = state.selectedReq ? new Set(componentsFor(state.selectedReq).map((c) => c.id)) : null;

    const edgeLayer = svgEl("g");
    const edgeLabelLayer = svgEl("g");
    for (const e of state.arch.edges) {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) continue;
      const { d, mid } = edgePath(a, b);
      const adjacent = state.selectedComp && (e.from === state.selectedComp || e.to === state.selectedComp);
      let cls = "edge flow";
      if (adjacent) cls += " hot";
      if (hitSet && !(hitSet.has(e.from) && hitSet.has(e.to)) && !adjacent) cls += " dim";
      edgeLayer.append(svgEl("path", { class: cls, d }));
      if (e.label) {
        const t = svgEl("text", { class: "edge-label", x: mid.x, y: mid.y - 6, "text-anchor": "middle" });
        t.textContent = e.label;
        edgeLabelLayer.append(t);
      }
    }
    svg.append(edgeLayer, edgeLabelLayer);

    const nodeLayer = svgEl("g");
    state.arch.components.forEach((comp, index) => {
      const p = pos[comp.id];
      const st = nodeStatus(comp);
      let cls = "node";
      if (comp.id === state.selectedComp) cls += " selected";
      if (hitSet) cls += hitSet.has(comp.id) ? " hit" : " dim";
      // Outer group carries position and state; inner group carries the entrance animation.
      const g = svgEl("g", { class: cls, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: "button", "data-id": comp.id });
      const inner = svgEl("g", { class: state.mapAnimated ? "" : "pop" });
      inner.style.animationDelay = `${index * 60}ms`;
      const title = svgEl("title");
      title.textContent = `${comp.name} (${comp.kind}, ${comp.zone})`;
      g.append(title);
      inner.append(svgEl("rect", { width: NODE_W, height: NODE_H, rx: 10 }));
      const name = svgEl("text", { class: "name", x: 16, y: 36 });
      name.textContent = truncate(comp.name, 28);
      const kind = svgEl("text", { class: "kind", x: 16, y: 62 });
      kind.textContent = `${comp.kind}${comp.agent_id ? " · agent " + comp.agent_id : ""}`;
      inner.append(name, kind);
      if (st !== "none") {
        inner.append(svgEl("circle", { class: "badge " + badgeClass(st), cx: NODE_W - 20, cy: 20, r: 9 }));
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

  function edgePath(a, b) {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    let sx, sy, ex, ey, c1x, c1y, c2x, c2y;
    if (Math.abs(bx - ax) >= COL_W - 10) {
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

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function applyViewBox() {
    const v = state.view;
    const w = v.w / v.zoom;
    const hgt = v.h / v.zoom;
    $("#map").setAttribute("viewBox", `${v.x} ${v.y} ${w} ${hgt}`);
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

  // ---------- side panels ----------

  function renderControls() {
    const root = $("#controls");
    root.replaceChildren();
    const meta = state.framework;
    $("#framework-meta").textContent = `${meta.name} · ${meta.version}`;
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
            h("small", { text: `${statusLabel(st)} · ${mapped} componenti${r.mandatory ? "" : " · advisory"}` })),
        );
      });
      root.append(h("details", { class: "control", open: true },
        h("summary", { text: `${control.id} · ${control.title}` }),
        ...reqs,
      ));
    }
  }

  function dotClass(st) {
    switch (st) {
      case "conforme": return "ok";
      case "parzialmente_conforme": return "partial";
      case "non_conforme": return "ko";
      default: return "todo";
    }
  }

  function statusSelect(id, current) {
    return h("select", { id },
      ...STATUSES.map(([code, label]) => h("option", { value: code, selected: code === current ? true : null }, label)));
  }

  function renderDetail() {
    const root = $("#detail");
    root.replaceChildren();
    if (state.selectedComp) return renderComponentDetail(root);
    if (state.selectedReq) return renderRequirementDetail(root);
    root.append(h("p", { class: "empty", text: "Seleziona un componente nella mappa o un sotto-punto a sinistra." }));
  }

  function renderComponentDetail(root) {
    const comp = state.arch.components.find((c) => c.id === state.selectedComp);
    if (!comp) return;
    root.append(h("h3", { text: comp.name }));
    root.append(h("dl", {},
      h("dt", { text: "Tipo" }), h("dd", { text: comp.kind }),
      h("dt", { text: "Zona" }), h("dd", { text: comp.zone }),
      h("dt", { text: "Agent Wazuh" }), h("dd", { text: comp.agent_id || "—" }),
    ));

    const invBox = h("div", { id: "inventory" }, h("p", { class: "empty", text: "Caricamento inventory…" }));
    root.append(h("h3", { text: "Inventory" }), invBox);
    loadInventory(comp.id, invBox);

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
      const save = h("button", {
        type: "button",
        class: "primary",
        onclick: () => saveAssessment(reqId, comp.id,
          document.getElementById(selId).value, document.getElementById(rationaleId).value),
      }, "Salva");
      root.append(h("div", { class: "assessment" },
        h("p", {}, h("strong", { text: reqId + " " }), info ? info.req.text : "(requisito non trovato)"),
        h("label", { class: "field" }, "Esito", statusSelect(selId, current.status)),
        h("label", { class: "field" }, "Motivazione / evidenza",
          h("textarea", { id: rationaleId, maxlength: 4000 }, current.rationale || "")),
        h("div", { class: "row" }, save),
      ));
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
        type: "button",
        class: "primary",
        onclick: () => saveAssessment(info.req.id, "",
          document.getElementById("st-global").value, document.getElementById("ra-global").value),
      }, "Salva")),
    ));

    const comps = componentsFor(info.req.id);
    root.append(h("h3", { text: `Componenti mappati (${comps.length})` }));
    if (comps.length === 0) {
      root.append(h("p", { class: "empty", text: "Nessun componente mappato." }));
    }
    for (const c of comps) {
      root.append(h("button", {
        type: "button",
        class: "req",
        onclick: () => selectComponent(c.id),
      }, h("i", { class: "dot " + dotClass(statusFor(info.req.id, c.id).status), "aria-hidden": "true" }),
        h("span", {}, c.name, h("small", { text: statusLabel(statusFor(info.req.id, c.id).status) }))));
    }
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
      const hw = first("hardware");
      const os = first("os");
      const count = (cat) => items.filter((i) => i.category === cat).length;
      const lines = [];
      if (hw) lines.push(`CPU: ${hw.fields["cpu.name"] || "—"}`, `RAM: ${hw.fields["ram.total"] || "—"}`, `Seriale: ${hw.fields["board_serial"] || "—"}`);
      if (os) lines.push(`OS: ${os.fields["os.name"] || ""} ${os.fields["os.version"] || ""}`.trim());
      lines.push(`Pacchetti: ${count("packages")} · Porte in ascolto: ${count("ports")}`);
      const src = items[0].source;
      const seen = items[0].seen_at ? new Date(items[0].seen_at).toLocaleString("it-IT") : "—";
      box.append(h("ul", { class: "inv-list" }, ...lines.map((l) => h("li", { text: l }))));
      box.append(h("p", { class: "muted", text: `Fonte: ${src} · rilevato: ${seen}` }));
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

  async function saveAssessment(reqId, compId, status, rationale) {
    const auditor = $("#auditor").value.trim();
    if (!auditor) {
      flash("Inserisci il nome dell'auditor prima di salvare.", "error");
      $("#auditor").focus();
      return;
    }
    try {
      localStorage.setItem("auditor", auditor);
    } catch (_) { /* storage may be unavailable */ }
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
      const saved = localStorage.getItem("auditor");
      if (saved) $("#auditor").value = saved;
    } catch (_) { /* ignore */ }

    bindMapInteractions();
    $("#btn-sync").addEventListener("click", syncWazuh);
    refresh();
  }

  init();
})();
