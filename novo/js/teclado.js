/* DCX-404 - face nova: o teclado do computador tambem aprende (Learn) e toca
 *
 * Camada so da /novo/ por cima do MIDI Learn do dcx-core (RJ.MidiMap e RJ.LearnBar
 * nao mudam): usa os mesmos alvos (host.learn.targets, os controles data-ctrl) e
 * guarda um mapa proprio no navegador, ao lado do midimap: "dcx404-novo/keymap".
 * O disquete nao leva: o disquete e do som e dos pads; o teclado e do computador.
 *
 * Learn (botao no alto): toque num controle e aperte uma tecla (vale a posicao,
 * event.code: ABNT2 e US dao no mesmo); Enter salva, Delete apaga, Esc sai.
 * Num knob, a 1a tecla sobe e a 2a desce. Uma tecla vale para um controle so:
 * tecla com dono (padrao ou aprendida) ou knob com uma tecla so, o 1o Enter avisa
 * e o 2o troca; as teclas dos pads, Hold, Sub Pad e bancos -/+ (solo.js) sao fixas.
 *
 * Mapa padrao (alem dos pads/Z/X/C/V do solo.js): Ctrl 1 U/J, Ctrl 2 I/K, Ctrl 3 O/L,
 * Volume =/-, bancos A-E F1-F5, REC T, MFX N, CANCEL Backspace.
 * Knob: a tecla sobe/desce um passo fino; segurando acelera; com a tecla segurada,
 * a roda do mouse tambem gira. Botao: segue a tecla (aperta e solta; repeat ignorado).
 * Nada dispara num campo de texto nem com Cmd/Ctrl/Alt (atalhos do navegador);
 * blur e troca de aba soltam tudo. Shift segue sendo o Shift do 404 (solo.js).
 *
 * No console: RJ.d4Keys (map, resolve(code), label(code)).
 */
(function () {
  "use strict";
  const RJ = (window.RJ = window.RJ || {});
  const STORE_KEY = "keymap";
  // alvo -> teclas (knob: [sobe, desce])
  const DEF = {
    "ctrl-1": ["KeyU", "KeyJ"], "ctrl-2": ["KeyI", "KeyK"], "ctrl-3": ["KeyO", "KeyL"],
    "volume": ["Equal", "Minus"],
    "bank-a": ["F1"], "bank-b": ["F2"], "bank-c": ["F3"], "bank-d": ["F4"], "bank-e": ["F5"],
    "rec": ["KeyT"], "fx-mfx": ["KeyN"], "cancel": ["Backspace"],
  };
  // teclas que o solo.js ja toca (so para a legenda; quem toca e ele)
  const BUILTIN = { "hold": "KeyZ", "subpad": "KeyX" };
  ["Digit1", "Digit2", "Digit3", "Digit4", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyA", "KeyS", "KeyD", "KeyF"].forEach((c, i) => { BUILTIN["pad-" + (i + 1)] = c; });
  // teclas fixas do solo.js: o Learn recusa (code -> { t: alvo ou null, name })
  const FIXED = { KeyC: { t: null, name: "banco anterior" }, KeyV: { t: null, name: "próximo banco" } };
  Object.keys(BUILTIN).forEach(id => { FIXED[BUILTIN[id]] = { t: id, name: id === "hold" ? "Hold" : id === "subpad" ? "Sub Pad" : "pad " + id.slice(4) }; });
  // nao se aprendem: sao do Learn (Enter/Esc/Delete/Backspace), do navegador ou do 404 (Shift)
  const RESERVED = new Set(["Enter", "NumpadEnter", "Escape", "Backspace", "Delete", "Tab", "ShiftLeft", "ShiftRight",
    "MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "CapsLock", "ContextMenu", "Fn", "OSLeft", "OSRight"]);
  const NAMES = { Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", IntlBackslash: "\\", IntlRo: "/",
    Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/", Space: "Espaço", Backspace: "⌫",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", NumpadAdd: "Num+", NumpadSubtract: "Num-",
    NumpadMultiply: "Num*", NumpadDivide: "Num/", NumpadDecimal: "Num.", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn" };
  const STEP = 1 / 127;        // passo fino de um toque
  const WHEEL = 0.02;          // o mesmo passo da roda no knob (dcx404.js)
  const isText = el => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const mod = e => e.metaKey || e.ctrlKey || e.altKey;
  const isValue = t => !!t && (t.kind === "value" || t.kind === "encoder");
  const isShift = c => c === "ShiftLeft" || c === "ShiftRight";

  const K = RJ.d4Keys = {
    ready: false,
    map: {},            // "KeyM" -> { t: "fx-mfx", d: 0 }   (knob: d 1 sobe, -1 desce)
    show: true,         // mostrar as teclas nos controles
    cand: null,         // no Learn: ["KeyU"] ou ["KeyU", "KeyJ"]
    note: null,         // aviso na barra (tecla fixa, tecla com dono, knob com uma tecla so)
    confirm: null,      // o Enter que ja avisou (o proximo troca)
    after: "",          // quem perdeu tecla no ultimo save
    held: new Map(),    // code -> { t, knob, d, t0 }
    layout: null,       // navigator.keyboard.getLayoutMap(), quando o navegador da
    host: null, L: null, d404: null, root: null, bar: null, btn: null,

    /* ------------------------------------------------ mapa */
    learned(id) { return Object.keys(this.map).some(c => this.map[c].t === id); },
    /** A tecla -> { t, d } (o aprendido vem antes; um alvo com tecla aprendida perde as padrao). */
    resolve(code) {
      const m = this.map[code];
      if (m) return this.L.targets.has(m.t) ? m : null;
      for (const id in DEF) {
        const i = DEF[id].indexOf(code);
        if (i >= 0 && !this.learned(id) && this.L.targets.has(id)) return { t: id, d: i === 0 ? 1 : -1 };
      }
      return null;
    },
    /** As teclas que valem hoje para um controle (para a legenda e a barra). */
    keysOf(id) {
      const own = Object.keys(this.map).filter(c => this.map[c].t === id).sort((a, b) => this.map[b].d - this.map[a].d);
      let list = own.length ? own : (DEF[id] || []).filter(c => !this.map[c]);
      const b = BUILTIN[id];
      if (b && !this.map[b] && !list.includes(b)) list = [b].concat(list);
      return list;
    },
    label(code) {
      if (K.layout && !/^(Numpad|F\d)/.test(code)) {
        const ch = K.layout.get(code);
        if (ch && ch.length === 1 && ch.trim()) return ch.toUpperCase();
      }
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit\d$/.test(code)) return code.slice(5);
      if (/^Numpad\d$/.test(code)) return "Num" + code.slice(6);
      if (/^F\d+$/.test(code)) return code;
      return NAMES[code] || code;
    },

    async load() {
      try {
        const s = await this.L.store.get(STORE_KEY);
        const d = s ? JSON.parse(s) : null;
        if (d && d.map && typeof d.map === "object") {
          Object.keys(d.map).forEach(c => {
            const b = d.map[c];
            if (/^[A-Za-z0-9]+$/.test(c) && !RESERVED.has(c) && b && typeof b.t === "string" && [-1, 0, 1].includes(b.d)) this.map[c] = { t: b.t, d: b.d };
          });
        }
        if (d && typeof d.show === "boolean") this.show = d.show;
      } catch (e) { console.warn("Mapa de teclado ilegivel, comecando com o padrao", e); }
    },
    persist() {
      try { this.L.store.put(STORE_KEY, JSON.stringify({ v: 1, show: this.show, map: this.map })); } catch (e) { console.warn(e); }
    },

    /* ------------------------------------------------ Learn */
    candText(t) {
      if (!this.cand) return "";
      if (isValue(t)) return this.label(this.cand[0]) + " ↑" + (this.cand[1] ? " " + this.label(this.cand[1]) + " ↓" : "");
      return "Tecla " + this.label(this.cand[0]);
    },
    learnKey(e) {
      // Cmd/Ctrl/Alt + tecla: atalho do navegador, mesmo no Learn (a barra do core prenderia)
      if (mod(e)) { e.stopImmediatePropagation(); return; }
      if (isText(e.target) || !e.code || RESERVED.has(e.code)) return;   // Enter/Esc/Delete: a barra cuida
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const L = this.L, t = L.sel && L.targets.get(L.sel);
      this.confirm = null;
      // pads, Hold, Sub Pad e bancos -/+ do solo.js: fixos, nao trocam de dono
      const fx = FIXED[e.code];
      if (fx && !(t && fx.t === t.id)) {
        this.note = this.label(e.code) + " é do " + fx.name + " (tecla fixa): escolha outra tecla";
        if (this.bar) this.bar.render();
        return;
      }
      this.note = null;
      if (isValue(t) && this.cand && this.cand.length === 1 && this.cand[0] !== e.code) this.cand = [this.cand[0], e.code];
      else this.cand = [e.code];
      L.cand = null;   // a ultima coisa que chegou (tecla ou MIDI) e a que o Enter salva
      if (this.bar) this.bar.render();
    },
    short(id) { const t = this.L.targets.get(id); return t ? t.name.replace(/^404 /, "") : id; },
    /** Quem ficaria pela metade ou sem tecla depois de salvar: "REC ficou sem tecla", "Ctrl 2 ficou só com K". */
    lost(owners) {
      return owners.map(id => {
        const ks = this.keysOf(id), t = this.L.targets.get(id);
        if (!ks.length) return this.short(id) + " ficou sem tecla";
        if (isValue(t) && ks.length === 1) return this.short(id) + " ficou só com " + this.label(ks[0]);
        return null;
      }).filter(Boolean);
    },
    /**
     * Enter: se a tecla ja tem dono (padrao ou aprendida) ou um knob ficaria com uma tecla so,
     * o 1o Enter so avisa na barra e o 2o troca (e a barra diz quem perdeu a tecla).
     */
    save() {
      const L = this.L, t = L.sel && L.targets.get(L.sel);
      if (!t || !this.cand) return null;
      const v = isValue(t), codes = v ? this.cand : this.cand.slice(0, 1);
      const owners = [], warn = [];
      codes.forEach(c => {
        const b = this.resolve(c);
        if (b && b.t !== t.id) { if (!owners.includes(b.t)) owners.push(b.t); warn.push(this.label(c) + " já é " + this.short(b.t)); }
      });
      if (v && codes.length === 1) warn.push("só com " + this.label(codes[0]) + " (sobe; falta a tecla de descer)");
      const sig = t.id + ":" + codes.join(",");
      if (warn.length && this.confirm !== sig) {
        this.confirm = sig;
        this.note = warn.join("; ") + (owners.length ? "; Enter de novo troca" : "; Enter de novo salva assim");
        return null;
      }
      Object.keys(this.map).forEach(c => { if (this.map[c].t === t.id) delete this.map[c]; });
      codes.forEach((c, i) => { this.map[c] = { t: t.id, d: v ? (i === 0 ? 1 : -1) : 0 }; });
      this.after = this.lost(owners).join("; ");
      this.cand = null; this.confirm = null; this.note = null;
      this.persist();
      this.renderHints();
      L.select(null);
      return t.name;
    },
    clear(id) {
      if (!this.learned(id)) return false;
      Object.keys(this.map).forEach(c => { if (this.map[c].t === id) delete this.map[c]; });
      this.persist();
      this.renderHints();
      return true;
    },

    /* ------------------------------------------------ tocar */
    press(t, down) {
      if (t.kind === "pad") {
        if (down) { if (!this.host.on) return; t.el.classList.add("down"); t.down(1); }
        else { t.el.classList.remove("down"); t.up && t.up(); }
        return;
      }
      if (down) t.down(1); else if (t.up) t.up();
    },
    nudge(t, d) { t.set(t.get() + d); },
    knobRelease(t) {
      if ([...this.held.values()].some(h => h.t === t)) return;   // a outra tecla do par ainda esta segurada
      const k = this.d404.knobs && this.d404.knobs[t.id];
      if (k && k.release) k.release();
    },
    down(e) {
      if (mod(e) || !this.host.on || isText(e.target) || isShift(e.code)) return;
      const b = this.resolve(e.code), t = b && this.L.targets.get(b.t);
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();   // a tecla e deste mapa: o solo.js nao toca o pad dela
      if (isValue(t)) {
        // o repeat do teclado e de proposito: segurando, o passo cresce (ate 8x em ~2 s)
        let h = this.held.get(e.code);
        if (!h) { h = { t, knob: true, d: b.d || 1, t0: performance.now() }; this.held.set(e.code, h); }
        const acc = e.repeat ? Math.min(8, 1 + (performance.now() - h.t0) / 300) : 1;
        this.nudge(t, h.d * STEP * acc);
        return;
      }
      if (e.repeat || this.held.has(e.code)) return;
      this.held.set(e.code, { t, knob: false });
      this.press(t, true);
    },
    up(e) {
      const h = this.held.get(e.code);
      if (!h) return;
      this.held.delete(e.code);
      e.stopImmediatePropagation();
      if (h.knob) this.knobRelease(h.t); else this.press(h.t, false);
    },
    releaseAll() {
      const hs = [...this.held.values()];
      this.held.clear();
      const knobs = new Set();
      hs.forEach(h => { if (h.knob) knobs.add(h.t); else this.press(h.t, false); });
      knobs.forEach(t => this.knobRelease(t));
    },
    wheel(e) {
      if (!this.ready || this.L.learning || !e.deltaY) return;
      const ts = new Set([...this.held.values()].filter(h => h.knob).map(h => h.t));
      if (!ts.size) return;
      e.preventDefault();
      e.stopPropagation();
      ts.forEach(t => this.nudge(t, -Math.sign(e.deltaY) * WHEEL));
    },

    /* ------------------------------------------------ tela */
    renderHints() {
      if (!this.root) return;
      this.root.classList.toggle("keys-on", this.show);
      this.L.targets.forEach(t => {
        const keys = this.keysOf(t.id);
        let cap = t.el.querySelector(":scope > .dx-keycap");
        if (!keys.length) { if (cap) cap.remove(); return; }
        if (!cap) { cap = document.createElement("span"); cap.className = "dx-keycap"; cap.setAttribute("aria-hidden", "true"); t.el.appendChild(cap); }
        cap.textContent = keys.map(c => this.label(c)).join(isValue(t) ? "/" : " ");
      });
      if (this.btn) {
        this.btn.classList.toggle("on", this.show);
        this.btn.setAttribute("aria-pressed", this.show ? "true" : "false");
      }
    },
    /** Texto da barra do Learn (por cima do render do core, que nao conhece o teclado). */
    barText(bar) {
      const L = bar.L, M = bar.host.midi, ml = RJ.MidiMap.label;
      bar.btn.textContent = "Learn";
      bar.btn.title = "Learn: toque num controle e aperte uma tecla do computador ou mexa no controlador MIDI. Enter salva, Delete apaga, Esc sai.";
      if (!L.learning) {
        if (!bar.msg) {
          const n = Object.keys(L.map).length, k = Object.keys(this.map).length, p = [];
          if (n) p.push(n + " MIDI");
          if (k) p.push(k + (k === 1 ? " tecla" : " teclas"));
          bar.text.textContent = p.length ? "Aprendidos: " + p.join(", ") : "";
        }
        return;
      }
      const t = L.sel && L.targets.get(L.sel);
      bar.save.hidden = !(t && (L.cand || this.cand));
      if (bar.msg && !t && !/^MIDI unavailable/.test(bar.msg)) return;
      const kc = this.candText(t);
      let s;
      if (this.note) s = (t ? this.short(t.id) + ": " : "") + this.note;
      else if (!t) s = kc ? kc + ": toque num controle" : L.cand ? ml(L.cand.key) + ": toque num controle" : "Toque num controle";
      else if (kc) s = t.name + " ← " + kc + (isValue(t) && this.cand.length === 1 ? " (outra tecla desce; Enter salva)" : " (Enter)");
      else if (L.cand) s = t.name + " ← " + ml(L.cand.key) + " (Enter)";
      else {
        const keys = this.keysOf(t.id), b = L.bound(t.id), now = [];
        if (keys.length) now.push("tecla " + keys.map(c => this.label(c)).join("/"));
        if (b) now.push(ml(b).replace(/\s+/g, " "));
        s = t.name + ": " + (now.length ? "agora " + now.join(" + ") + "; " : "") + "aperte uma tecla ou mexa o controlador";
      }
      if (M.failed && !kc && !L.cand && !this.note) s += " (sem MIDI: só o teclado)";
      bar.text.textContent = s;
    },
  };

  // a barra do core: o mesmo Learn, com o teclado junto (o arquivo do dcx-core nao muda)
  const P = RJ.LearnBar && RJ.LearnBar.prototype;
  if (P) {
    const render0 = P.render, enter0 = P.enter;
    P.render = function () { render0.call(this); K.bar = this; if (K.ready) K.barText(this); };
    P.enter = function () {
      if (K.ready && K.cand && this.L.sel) { const n = K.save(); if (n) this.msg = "Salvo " + n + " no teclado" + (K.after ? "; " + K.after : ""); this.render(); return; }
      enter0.call(this);
    };
  }

  // na captura e antes da barra do core (que registra o dela no DOMContentLoaded)
  window.addEventListener("keydown", e => {
    if (!K.ready) return;
    if (K.L.learning) K.learnKey(e); else K.down(e);
  }, true);
  window.addEventListener("keyup", e => { if (K.ready) K.up(e); }, true);
  window.addEventListener("wheel", e => K.wheel(e), { capture: true, passive: false });
  window.addEventListener("blur", () => { if (K.ready) K.releaseAll(); });
  // trocar de aba: o keyup nao chega; solta o deste mapa e avisa o solo.js e o motor (o blur deles solta pads e teclas)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !K.ready) return;
    K.releaseAll();
    window.dispatchEvent(new Event("blur"));
  });

  window.addEventListener("DOMContentLoaded", () => {
    const host = RJ.solo, d404 = RJ.d404;   // o solo.js montou antes (a tag dele vem antes desta)
    if (!host || !d404) return;
    K.host = host; K.L = host.learn; K.d404 = d404; K.root = d404.root;
    const L = K.L;
    // o Learn do core, sabendo do teclado
    const sel0 = L.select.bind(L), start0 = L.start.bind(L), stop0 = L.stop.bind(L), cap0 = L.capture.bind(L), clear0 = L.clear.bind(L);
    L.select = id => { if (L.sel) K.cand = null; K.confirm = K.note = null; sel0(id); };   // tecla antes de tocar no controle fica valendo
    L.start = () => { K.releaseAll(); K.cand = K.confirm = K.note = null; start0(); };
    L.stop = () => { K.cand = K.confirm = K.note = null; stop0(); };
    L.capture = m => { if (!(m.type === "note" && !m.on)) K.cand = K.confirm = K.note = null; cap0(m); };
    L.clear = id => { const k = K.clear(id), n = clear0(id); return n || (k && L.targets.get(id) ? L.targets.get(id).name : null); };

    // botao "Teclas" na barra: mostra/esconde as teclas nos controles
    const bar = document.getElementById("learnbar");
    if (bar) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "d4-open-btn d4-keys-btn"; b.textContent = "Teclas";
      b.title = "Mostra ou esconde, em cada controle, a tecla do computador que o toca";
      b.addEventListener("click", () => { K.show = !K.show; K.persist(); K.renderHints(); });
      const after = bar.querySelector(".learnbar-text");
      bar.insertBefore(b, after ? after.nextSibling : null);
      K.btn = b;
    }

    const layout = navigator.keyboard && navigator.keyboard.getLayoutMap ? navigator.keyboard.getLayoutMap().catch(() => null) : Promise.resolve(null);
    Promise.all([K.load(), layout]).then(([, lm]) => {
      K.layout = lm || null;
      K.ready = true;
      K.renderHints();
      if (K.bar) K.bar.render();
    });
  });
})();
