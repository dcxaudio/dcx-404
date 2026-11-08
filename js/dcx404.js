/* DCX 404 - o aparelho
 *
 * Sampler de performance: 16 pads, 9 efeitos ao vivo em dois buses, entrada,
 * reamostragem e MIDI Learn. Recebe so a vista do host (host.view("dcx404")):
 * quem monta a pagina e o solo.js (pagina solo) ou o DCX Studio.
 *
 * Caminho do som:
 *   pads ─┐
 *         ├─> Bus 1 (efeito) ─> Mute ─> Bus 2 (efeito) ─> Volume ─> host.output()
 *   input ┘                                        └─> Resample (grava aqui)
 *   input = host.input() (RJ-2000 no Studio) ou Line (microfone do navegador)
 *
 * Armazenamento (host.store, prefixo "dcx404/" no solo):
 *   "state"   JSON do painel (pads, modos, efeitos, knobs)
 *   "pad/N"   o sample do pad N (0 a 15): { v, name, rate, ch: [base64 Int16, ...] }
 *   (o mapa MIDI fica com o host: "midimap")
 */
window.RJ = window.RJ || {};

(function () {
  "use strict";
  const RJ = window.RJ;
  const VERSION = "b0.1";
  const STATE_KEY = "state";
  const PADS = 16;
  const MAX_REC = 60;              // segundos de Resample
  const ROLLS = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8];  // Sub Pad: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32
  const ROLL_SHOW = [" 4", " 8", "8t", "16", "16t", "32"];
  const VELS = ["soft", "linear", "fixed"];
  const VEL_SHOW = { soft: "5UA", linear: "Lin", fixed: "127" };
  const LONG = 400;                // ms: segurar mais que isso = momentaneo (sem Hold)
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------ curva de velocity */
  /** suave (padrao): levanta as batidas fracas (o Minilab3 manda 6 a 75); linear; fixa no maximo. */
  RJ.d4Velocity = function (curve, v) {
    v = clamp(v, 0, 1);
    if (curve === "fixed") return 1;
    if (curve === "linear") return v;
    return Math.pow(v, 0.5);
  };

  /* ------------------------------------------------------------ display de 7 segmentos (o do RJ-42) */
  const SEG = {
    a: "4,2 18,2 15,5 7,5", b: "19,3 19,18 16,16 16,6", c: "19,20 19,35 16,32 16,22", d: "4,36 18,36 15,33 7,33",
    e: "3,20 6,22 6,32 3,35", f: "3,3 6,6 6,16 3,18", g: "4,19 7,17 15,17 18,19 15,21 7,21",
  };
  const DIG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd",
    "F": "aefg", "P": "abefg", "b": "cdefg", "d": "bcdeg", "E": "adefg", "r": "eg", "-": "g", " ": "",
    "A": "abcefg", "C": "adef", "L": "def", "U": "bcdef", "u": "cde", "n": "ceg", "o": "cdeg", "i": "e", "t": "defg",
    "H": "bcefg", "h": "cefg", "y": "bcdfg", "S": "afgcd", "c": "deg", "_": "d" };
  function drawSeg(w, txt) {
    const chars = [];
    for (const ch of txt) { if (ch === "." && chars.length) chars[chars.length - 1].dp = true; else chars.push({ ch, dp: false }); }
    while (chars.length < 3) chars.unshift({ ch: " ", dp: false });
    w.innerHTML = chars.slice(-3).map(({ ch, dp }) => {
      const on = DIG[ch] || "";
      const polys = Object.keys(SEG).map(k => `<polygon class="r42-seg${on.includes(k) ? " on" : ""}" points="${SEG[k]}"/>`).join("");
      return `<svg viewBox="0 0 24 40">${polys}<circle class="r42-seg${dp ? " on" : ""}" cx="22" cy="36" r="1.8"/></svg>`;
    }).join("");
    w.setAttribute("aria-label", "Display " + txt.trim());
  }
  RJ.d4DrawSeg = drawSeg;

  const newPad = () => ({ name: "", gate: false, loop: false, rev: false });
  function newState() {
    const params = {};
    RJ.D4FX.forEach(f => { params[f.id] = f.def.slice(); });
    return {
      format: "dcx404", v: 1,
      vol: 0.8, inLevel: 0.8, sendRj: 1, send950: 1, vel: "soft", bpm: 90, roll: 3, padLevel: new Array(PADS).fill(0.8),
      bus: 1, fx: { 1: null, 2: null }, mfx: "reverb", params,
      hold: false, mute: false, cur: 0,
      lofi: false, lofiBits: RJ.D4_LOFI.bits, lofiDown: RJ.D4_LOFI.down,
      pads: new Array(PADS).fill(null).map(newPad),
    };
  }

  RJ.D404 = class {
    constructor(host) {
      this.host = host;
      this.engine = host.engine;
      this.st = newState();
      this.buf = new Array(PADS).fill(null);    // AudioBuffer de cada pad
      this.rbuf = new Array(PADS).fill(null);   // o mesmo, de tras para frente (Reverse)
      this.voice = new Array(PADS).fill(null);  // a voz tocando em cada pad (uma por pad)
      this.held = new Set();                    // pads apertados agora
      this.on = false;
      this.loaded = false;
      this.g = null;                            // o grafo de audio
      this.fxi = { 1: {}, 2: {} };              // instancias por bus: fxi[bus][id]
      this.shift = false; this.shiftKey = false;
      this.setup = false;
      this.mfxPick = false;
      this.last = { pad: -1, vel: 1 };
      this.roll = null;
      this.rec = null;
      this.src = "off";                         // off | rj2000 | rj950 | mix | line
      this.line = null;
      this.shown = null;
      this.confirmDel = 0;
    }

    /* =========================================================== montagem */

    build(root = $("#d4")) {
      this.root = root;
      this.el = { seg: $("#d4-seg", root), pads: $("#d4-pads", root), file: $("#d4-file") || this.makeFileInput() };
      const L = this.host.learn;

      // pads 4 x 4 (o mesmo .pcol/.pad do RJ-2000)
      this.padEls = [];
      for (let i = 0; i < PADS; i++) {
        const pc = document.createElement("div");
        pc.className = "pcol";
        pc.innerHTML = `<button class="pad" data-ctrl="pad-${i + 1}" aria-label="Pad ${i + 1}"></button><span class="cap">${i + 1}</span>`;
        const b = pc.firstElementChild;
        this.el.pads.appendChild(pc);
        this.padEls.push(b);
        b.addEventListener("pointerdown", e => {
          e.preventDefault();
          if (!this.host.on) return;
          try { b.setPointerCapture(e.pointerId); } catch (_) {}
          b.classList.add("down");
          this.padDown(i, 1);
        });
        const up = () => { if (!b.classList.contains("down")) return; b.classList.remove("down"); this.padUp(i); };
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("contextmenu", e => e.preventDefault());
        // arrastar um arquivo para o pad carrega nele
        b.addEventListener("dragenter", e => { e.preventDefault(); b.classList.add("drop"); });
        b.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
        b.addEventListener("dragleave", () => b.classList.remove("drop"));
        b.addEventListener("drop", e => {
          e.preventDefault(); e.stopPropagation();
          b.classList.remove("drop");
          const f = (e.dataTransfer.files || [])[0];
          if (f) this.loadFile(i, f);
        });
        L.add("pad-" + (i + 1), b, "Pad " + (i + 1), "pad", { down: v => { if (this.host.on) this.padDown(i, v); }, up: () => this.padUp(i) });
      }
      // arquivo solto fora dos pads: vai para o primeiro pad vazio
      root.addEventListener("dragover", e => e.preventDefault());
      root.addEventListener("drop", e => {
        e.preventDefault();
        const f = (e.dataTransfer.files || [])[0];
        if (!f) return;
        const i = this.emptyPad();
        if (i < 0) this.flash("FUL"); else this.loadFile(i, f);
      });

      // teclas
      const BTN = {
        "fx-filter": ["Filter+Drive", () => this.fxDown("filter"), () => this.fxUp("filter")],
        "fx-isolator": ["Isolator", () => this.fxDown("isolator"), () => this.fxUp("isolator")],
        "fx-delay": ["Delay", () => this.fxDown("delay"), () => this.fxUp("delay")],
        "fx-vinyl": ["Vinyl Sim", () => this.fxDown("vinyl"), () => this.fxUp("vinyl")],
        "fx-djfx": ["DJFX Looper", () => this.fxDown("djfx"), () => this.fxUp("djfx")],
        "fx-mfx": ["MFX", () => this.fxDown("mfx"), () => this.fxUp("mfx")],
        "bus-1": ["Bus 1", () => this.selectBus(1)],
        "bus-2": ["Bus 2", () => this.selectBus(2)],
        "mute": ["Mute", () => this.muteDown(), () => this.muteUp()],
        "hold": ["Hold", () => this.toggleHold()],
        "subpad": ["Sub Pad", () => this.subDown(), () => this.subUp()],
        "resample": ["Resample", () => this.resample()],
        "gate": ["Gate", () => this.padMode("gate")],
        "loop": ["Loop", () => this.padMode("loop")],
        "reverse": ["Reverse", () => (this.shift || this.shiftKey) ? this.toggleLofi() : this.padMode("rev")],
        "lofi": ["Lo-fi", () => this.toggleLofi(true)],
        "velocity": ["Velocity", () => this.nextVelocity()],
        "setup": ["Set-up", () => this.toggleSetup()],
        "shift": ["Shift", () => this.shiftDown(), () => this.shiftUp()],
        "in-source": ["Source", () => this.nextSource()],
      };
      this.btn = {};
      Object.keys(BTN).forEach(id => {
        const el = $(`[data-ctrl="${id}"]`, root);
        if (!el) return;
        const [name, down, up] = BTN[id];
        this.btn[id] = el;
        el.addEventListener("pointerdown", e => {
          e.preventDefault();
          if (!this.host.on) return;
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          el.dataset.press = "1";
          down();
          this.renderButtons();
        });
        const end = () => { if (!el.dataset.press) return; delete el.dataset.press; if (up) up(); this.renderButtons(); };
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        el.addEventListener("contextmenu", e => e.preventDefault());
        L.add(id, el, "404 " + name, "button", {
          down: () => { if (this.host.on) { down(); this.renderButtons(); } },
          up: () => { if (up) up(); this.renderButtons(); },
        });
      });

      // knobs
      this.knobs = {};
      this.bindKnob("volume", "404 Volume", () => this.st.vol, v => { this.st.vol = v; this.applyVol(); this.flash(String(Math.round(v * 127)), null); });
      this.bindKnob("in-level", "404 Input Level", () => this.st.inLevel, v => { this.st.inLevel = v; this.applyInput(); this.flash(String(Math.round(v * 127)), null); });
      [0, 1, 2].forEach(k => this.bindKnob("ctrl-" + (k + 1), "404 Ctrl " + (k + 1), () => this.ctrlGet(k), v => this.ctrlSet(k, v)));

      // o teclado do computador vai para o 404 depois de um clique nele (solo.js decide)
      document.addEventListener("pointerdown", e => {
        this.focused = root.contains(e.target);
        root.classList.toggle("focus", this.focused && this.on && this.host.targets().length > 1);
      });
      this.el.file.addEventListener("change", e => {
        const f = (e.target.files || [])[0];
        e.target.value = "";
        if (f && this.pickPad != null) this.loadFile(this.pickPad, f);
        this.pickPad = null;
      });
      this.render();
    }

    makeFileInput() {
      const inp = document.createElement("input");
      inp.type = "file"; inp.hidden = true; inp.accept = "audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac,.m4a";
      document.body.appendChild(inp);
      return inp;
    }

    bindKnob(id, name, get, set) {
      const el = $(`[data-ctrl="${id}"]`, this.root);
      if (!el) return;
      const draw = () => el.style.setProperty("--a", (-135 + get() * 270) + "deg");
      const put = v => { if (!this.host.on) return; set(clamp(v, 0, 1)); draw(); this.dirty(); };
      this.knobs[id] = { el, draw };
      this.host.learn.add(id, el, name, "value", { get, set: put });
      let y0 = 0, v0 = 0;
      el.addEventListener("pointerdown", e => { e.preventDefault(); el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); el.dataset.drag = "1"; });
      el.addEventListener("pointermove", e => { if (!el.dataset.drag) return; put(v0 + (y0 - e.clientY) / 170); });
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { delete el.dataset.drag; }));
      el.addEventListener("wheel", e => { e.preventDefault(); put(get() - Math.sign(e.deltaY) * 0.02); }, { passive: false });
      el.addEventListener("keydown", e => {
        const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
        if (d == null) return;
        e.preventDefault(); e.stopPropagation(); put(get() + d);
      });
      draw();
    }

    /* =========================================================== liga */

    async boot() {
      if (this.on || !this.host.on) return;
      this.on = true;
      this.root.classList.add("on");
      const ctx = this.engine.ensure();
      drawSeg(this.el.seg, "404");
      this.worklet = await RJ.d4LoadWorklets(ctx);
      this.graph(ctx);
      if (!this.loaded) {
        try {
          const saved = await this.host.store.get(STATE_KEY);
          if (saved) this.useState(JSON.parse(saved));
        } catch (e) { console.warn("Estado do 404 ilegivel, comecando limpo", e); }
        await this.loadSamples();
        this.loaded = true;
      }
      this.applyAll();
      this.render();
      this.flash("b0.1", null, 900);
    }

    /** O grafo fixo: pads e entrada no Bus 1, Mute, Bus 2, Volume e a saida do host. */
    graph(ctx) {
      if (this.g && this.g.ctx === ctx) return;
      const G = { ctx };
      G.pads = ctx.createGain();
      G.srcRj = ctx.createGain(); G.srcRj.gain.value = 0;
      G.srcLine = ctx.createGain(); G.srcLine.gain.value = 0;
      G.src950 = ctx.createGain(); G.src950.gain.value = 0;   // o Studio liga a saida do RJ-950 aqui
      G.inLevel = ctx.createGain();
      this.host.input().connect(G.srcRj);
      G.srcRj.connect(G.inLevel); G.src950.connect(G.inLevel); G.srcLine.connect(G.inLevel);
      G.bus1 = new RJ.D4Slot(ctx);
      G.bus2 = new RJ.D4Slot(ctx);
      G.mute = ctx.createGain();
      G.vol = ctx.createGain();
      G.pads.connect(G.bus1.input);
      G.inLevel.connect(G.bus1.input);
      G.bus1.output.connect(G.mute).connect(G.bus2.input);
      // LO-FI: seco (ganho 1) e molhado (o worklet entra so quando liga) somam em post, antes do Volume
      G.lofiDry = ctx.createGain(); G.lofiWet = ctx.createGain(); G.lofiWet.gain.value = 0;
      G.post = ctx.createGain(); G.crush = null;
      G.bus2.output.connect(G.lofiDry).connect(G.post);
      G.lofiWet.connect(G.post);
      G.post.connect(G.vol).connect(this.host.output());
      // o Looper e o Stopper precisam ouvir sempre: a saida deles vai para um ralo mudo,
      // para o navegador continuar chamando o worklet mesmo com o efeito fora do bus
      G.sink = ctx.createGain(); G.sink.gain.value = 0; G.sink.connect(ctx.destination);
      this.g = G;
      this.fxi = { 1: {}, 2: {} };
      if (this.worklet) [1, 2].forEach(b => ["djfx", "stopper"].forEach(id => this.fxInstance(b, id)));
    }

    /** A instancia do efeito id no bus b, criada na primeira vez. */
    fxInstance(b, id) {
      let fx = this.fxi[b][id];
      if (fx) return fx;
      const def = RJ.D4FX.byId(id);
      if (!def || (def.worklet && !this.worklet)) return null;
      fx = def.make(this.g.ctx);
      fx.def = def;
      this.st.params[id].forEach((v, i) => fx.set(i, v));
      if (fx.bpm) fx.bpm(this.st.bpm);
      if (fx.keep) { this.slot(b).attach(fx); fx.output.connect(this.g.sink); }
      this.fxi[b][id] = fx;
      return fx;
    }

    slot(b) { return b === 1 ? this.g.bus1 : this.g.bus2; }

    applyAll() {
      this.applyVol(); this.applyInput(); this.applyMute(); this.applyLofi();
      [1, 2].forEach(b => this.applyBus(b));
    }

    applyVol() { if (this.g) this.ramp(this.g.vol.gain, Math.pow(this.st.vol * 1.25, 2)); }
    applyInput() {
      if (!this.g) return;
      this.ramp(this.g.inLevel.gain, Math.pow(this.st.inLevel * 1.25, 2));
      // RJ-2000 e RJ-950 tem cada um o seu envio (1,0 = som igual ao direto); so a Mix soma os dois
      this.ramp(this.g.srcRj.gain, this.src === "rj2000" || this.src === "mix" ? this.st.sendRj : 0);
      this.ramp(this.g.src950.gain, this.src === "rj950" || this.src === "mix" ? this.st.send950 : 0);
      this.ramp(this.g.srcLine.gain, this.src === "line" ? 1 : 0);
    }
    applyMute() { if (this.g) this.ramp(this.g.mute.gain, this.st.mute ? 0 : 1, 0.002); }
    applyBus(b) {
      if (!this.g) return;
      const id = this.st.fx[b];
      this.slot(b).use(id ? this.fxInstance(b, id) : null);
    }
    ramp(p, v, tc = 0.005) { RJ.d4Glide(p, v, this.g.ctx, tc); }

    /* =========================================================== estado e armazenamento */

    useState(d) {
      if (!d || d.format !== "dcx404") throw new Error("Nao e um estado do DCX 404");
      const st = newState();
      ["vol", "inLevel", "sendRj", "send950", "bpm", "roll", "bus", "mfx", "hold", "mute", "cur"].forEach(k => { if (d[k] !== undefined) st[k] = d[k]; });
      st.vol = clamp(+st.vol || 0, 0, 1); st.inLevel = clamp(+st.inLevel || 0, 0, 1);
      st.sendRj = d.sendRj === undefined ? 1 : clamp(+d.sendRj || 0, 0, 2);
      st.send950 = d.send950 === undefined ? 1 : clamp(+d.send950 || 0, 0, 2);
      st.bpm = clamp(Math.round(+st.bpm) || 90, 40, 240); st.roll = clamp(st.roll | 0, 0, ROLLS.length - 1);
      st.bus = st.bus === 2 ? 2 : 1; st.cur = clamp(st.cur | 0, 0, PADS - 1);
      st.hold = !!st.hold; st.mute = !!st.mute;
      st.lofi = d.lofi === true;
      st.lofiBits = clamp(Math.round(+d.lofiBits) || RJ.D4_LOFI.bits, RJ.D4_LOFI.minBits, RJ.D4_LOFI.maxBits);
      st.lofiDown = clamp(Math.round(+d.lofiDown) || RJ.D4_LOFI.down, 1, RJ.D4_LOFI.maxDown);
      if (VELS.includes(d.vel)) st.vel = d.vel;
      if (!RJ.D4FX.byId(st.mfx) || !RJ.D4FX.byId(st.mfx).mfx) st.mfx = "reverb";
      [1, 2].forEach(b => { const id = d.fx && d.fx[b]; st.fx[b] = RJ.D4FX.byId(id) ? id : null; });
      RJ.D4FX.forEach(f => {
        const p = d.params && d.params[f.id];
        if (Array.isArray(p)) st.params[f.id] = f.def.map((v, i) => (typeof p[i] === "number" ? clamp(p[i], 0, 1) : v));
      });
      if (Array.isArray(d.padLevel)) st.padLevel = st.padLevel.map((v, i) => (typeof d.padLevel[i] === "number" ? clamp(d.padLevel[i], 0, 1) : v));
      if (Array.isArray(d.pads)) st.pads = st.pads.map((p, i) => {
        const x = d.pads[i] || {};
        return { name: String(x.name || "").slice(0, 40), gate: !!x.gate, loop: !!x.loop, rev: !!x.rev };
      });
      this.st = st;
    }

    serialize() { return JSON.stringify(this.st); }

    dirty() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), 800);
    }

    saveNow() {
      clearTimeout(this.saveTimer);
      if (!this.loaded) return;
      try { this.host.store.put(STATE_KEY, this.serialize()); } catch (e) { console.warn(e); }
    }

    async loadSamples() {
      const ctx = this.engine.ensure();
      await Promise.all(this.st.pads.map(async (p, i) => {
        try {
          const s = await this.host.store.get("pad/" + i);
          if (!s) return;
          const d = JSON.parse(s);
          const chs = d.ch.map(b => RJ.dsp.b64ToFloat(b));
          const len = chs[0].length;
          if (!len) return;
          const b = ctx.createBuffer(chs.length, len, d.rate);
          chs.forEach((c, k) => b.copyToChannel(c, k));
          this.setBuffer(i, b, d.name, false);
        } catch (e) { console.warn("Sample do pad " + (i + 1) + " ilegivel", e); }
      }));
    }

    saveSample(i) {
      const b = this.buf[i];
      if (!b) { this.host.store.put("pad/" + i, null); return; }
      const ch = [];
      for (let c = 0; c < b.numberOfChannels; c++) ch.push(RJ.dsp.floatToB64(b.getChannelData(c)));
      this.host.store.put("pad/" + i, JSON.stringify({ v: 1, name: this.st.pads[i].name, rate: b.sampleRate, ch }));
    }

    /* =========================================================== samples */

    emptyPad() { return this.buf.findIndex(b => !b); }

    /** Carrega um arquivo de audio no pad i (estereo, ate 2 canais). */
    async loadFile(i, file) {
      if (!this.host.on) return;
      const ctx = this.engine.ensure();
      this.flash("Lod", "pad", 4000);
      let b;
      try {
        const ab = await file.arrayBuffer();
        b = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
      } catch (e) { console.warn(e); this.flash("Err", "pad"); return; }
      if (b.numberOfChannels > 2) {
        const s = ctx.createBuffer(2, b.length, b.sampleRate);
        s.copyToChannel(b.getChannelData(0), 0); s.copyToChannel(b.getChannelData(1), 1);
        b = s;
      }
      const name = String(file.name || "SAMPLE").replace(/\.[^.]+$/, "").slice(0, 40);
      this.setBuffer(i, b, name, true);
      this.st.cur = i;
      this.flash("P." + String(i + 1).padStart(2, "0"), "pad");
      this.render();
    }

    /** Recebe um WAV de outro aparelho (host.send("dcx404", wav)): vai para o primeiro pad vazio. */
    receive(file) {
      const i = this.emptyPad();
      if (i < 0) { this.flash("FUL"); return "full"; }
      this.loadFile(i, file);
      return "ok";
    }

    setBuffer(i, b, name, save) {
      this.stopVoice(i);
      this.buf[i] = b;
      this.rbuf[i] = null;
      if (name != null) this.st.pads[i].name = name;
      if (save) { this.saveSample(i); this.dirty(); }
      this.renderPads();
    }

    reversed(i) {
      if (this.rbuf[i]) return this.rbuf[i];
      const b = this.buf[i], r = this.g.ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c).slice(); d.reverse(); r.copyToChannel(d, c); }
      return (this.rbuf[i] = r);
    }

    clearPad(i) {
      this.setBuffer(i, null, "", false);
      this.st.pads[i] = newPad();
      this.saveSample(i);
      this.dirty();
    }

    /* =========================================================== pads */

    padDown(i, vel = 1) {
      if (!this.on) return;
      this.held.add(i);
      if (this.shift || this.shiftKey) { this.shiftUsed(); this.pickFile(i); return; }
      if (this.mfxPick && i < 4) { this.pickMfx(i + 1); return; }
      this.st.cur = i;
      this.last = { pad: i, vel };
      this.flash("P." + String(i + 1).padStart(2, "0"), "pad");
      const p = this.st.pads[i];
      // Loop sem Gate: o mesmo pad de novo para o loop
      if (p.loop && !p.gate && this.voice[i]) { this.stopVoice(i); this.renderModes(); return; }
      this.play(i, vel);
      this.renderModes();
      this.dirty();
    }

    padUp(i) {
      this.held.delete(i);
      const p = this.st.pads[i];
      if (p.gate && !this.st.hold && !(this.roll && this.roll.pad === i)) this.stopVoice(i);
    }

    /** Toca o pad i (uma voz por pad: a nova corta a anterior). when: hora do AudioContext. */
    play(i, vel, when) {
      if (!this.buf[i] || !this.g) return;
      const ctx = this.g.ctx, t = Math.max(when || 0, ctx.currentTime);
      this.stopVoice(i, t);
      const p = this.st.pads[i];
      const src = ctx.createBufferSource();
      src.buffer = p.rev ? this.reversed(i) : this.buf[i];
      src.loop = p.loop;
      const g = ctx.createGain();
      const amp = RJ.d4Velocity(this.st.vel, vel) * this.st.padLevel[i] * 1.25;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      src.connect(g).connect(this.g.pads);
      src.start(t);
      const v = { src, g, t };
      this.voice[i] = v;
      src.onended = () => { if (this.voice[i] === v) { this.voice[i] = null; this.renderPads(); } g.disconnect(); };
      const el = this.padEls[i];
      const lit = () => { if (this.voice[i] === v) el.classList.add("hit"); };
      if (t - ctx.currentTime > 0.01) setTimeout(lit, (t - ctx.currentTime) * 1000); else lit();
    }

    stopVoice(i, when) {
      const v = this.voice[i];
      if (!v) return;
      this.voice[i] = null;
      const ctx = this.g.ctx, t = Math.max(when || 0, ctx.currentTime);
      if (t <= ctx.currentTime + 0.001) RJ.d4Glide(v.g.gain, 0, ctx, 0.003);
      else { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.003); }
      try { v.src.stop(t + 0.03); } catch (e) { /* ja parou */ }
      if (this.padEls) this.padEls[i].classList.remove("hit");
    }

    stopAll() { for (let i = 0; i < PADS; i++) this.stopVoice(i); this.stopRoll(); }

    pickFile(i) {
      this.pickPad = i;
      this.st.cur = i;
      this.flash("Lod", "pad");
      const inp = this.el.file;
      const ua = navigator.userActivation;
      if (ua && !ua.isActive) window.addEventListener("pointerup", () => inp.click(), { once: true });
      else inp.click();
    }

    /** Gate, Loop e Reverse valem para o pad escolhido (o ultimo tocado). */
    padMode(k) {
      const p = this.st.pads[this.st.cur];
      p[k] = !p[k];
      const v = this.voice[this.st.cur];
      if (k === "loop" && v) v.src.loop = p.loop;
      this.flash({ gate: p.gate ? "GAt" : "trG", loop: p.loop ? "LP." : "LP-", rev: p.rev ? "rEu" : "Fud" }[k], "pad");
      this.renderModes();
      this.dirty();
    }

    /** Shift + Reverse: liga/desliga o LO-FI do 404 (reducao de bits e de taxa em tudo que sai do Bus 2: pads e Source). */
    toggleLofi(direct) {
      if (!direct) this.shiftUsed();
      if (!this.st.lofi && !this.worklet) { this.flash("Err", "fx"); return; }
      this.st.lofi = !this.st.lofi;
      this.applyLofi();
      this.flash(this.st.lofi ? "Lo." : "Lo-", "fx");
      this.renderModes();
      this.dirty();
    }

    /** O estagio do LO-FI: entre o Bus 2 e o Volume. Desligado, so o caminho seco (ganho 1: som igual ao de antes). */
    applyLofi() {
      const G = this.g;
      if (!G) return;
      const on = !!(this.st.lofi && this.worklet), ctx = G.ctx;
      if (on) {
        clearTimeout(G.lofiTimer);
        if (!G.crush) {
          G.crush = RJ.d4LofiNode(ctx, this.st.lofiBits, this.st.lofiDown);
          G.bus2.output.connect(G.crush).connect(G.lofiWet);
        }
        G.crush.parameters.get("bits").value = this.st.lofiBits;
        G.crush.parameters.get("down").value = this.st.lofiDown;
      }
      this.ramp(G.lofiDry.gain, on ? 0 : 1, 0.006);
      this.ramp(G.lofiWet.gain, on ? 1 : 0, 0.006);
      if (!on && G.crush) {
        // tira o worklet do grafo depois que o crossfade terminou
        clearTimeout(G.lofiTimer);
        G.lofiTimer = setTimeout(() => {
          if (this.st.lofi || !G.crush) return;
          try { G.bus2.output.disconnect(G.crush); } catch (e) { /* ja desligado */ }
          G.crush.disconnect(); G.crush = null;
        }, 150);
      }
    }

    nextVelocity() {
      this.st.vel = VELS[(VELS.indexOf(this.st.vel) + 1) % VELS.length];
      this.flash(VEL_SHOW[this.st.vel], null, 1400);
      this.dirty();
    }

    toggleHold() {
      this.st.hold = !this.st.hold;
      if (!this.st.hold) {
        // soltar o Hold: os pads Gate que ninguem esta apertando param
        this.st.pads.forEach((p, i) => { if (p.gate && !this.held.has(i)) this.stopVoice(i); });
        if (this.roll && !this.roll.pressed) this.stopRoll();
      }
      this.dirty();
    }

    /* ---------------------------------------- Sub Pad: repete o ultimo pad no tempo do BPM */

    subDown() {
      if (this.roll && this.st.hold) { this.stopRoll(); return; }   // com Hold, aperta de novo para parar
      const i = this.last.pad;
      if (i < 0 || !this.buf[i]) { this.flash("---", "pad"); return; }
      this.startRoll(i, this.last.vel);
      this.roll.pressed = true;
    }

    subUp() {
      if (!this.roll) return;
      this.roll.pressed = false;
      if (!this.st.hold) this.stopRoll();
    }

    startRoll(i, vel) {
      this.stopRoll();
      const ctx = this.g.ctx;
      const r = { pad: i, vel, next: ctx.currentTime + 0.005, pressed: false };
      const tick = () => {
        const step = ROLLS[this.st.roll] * 60 / this.st.bpm;
        while (r.next < ctx.currentTime + 0.09) { this.play(r.pad, r.vel, r.next); r.next += step; }
      };
      tick();
      r.timer = setInterval(tick, 20);
      this.roll = r;
      this.flash(ROLL_SHOW[this.st.roll], "bpm");
    }

    stopRoll() {
      const r = this.roll;
      if (!r) return;
      clearInterval(r.timer);
      this.roll = null;
      const p = this.st.pads[r.pad];
      // a ultima batida ja marcada no futuro nao toca
      const v = this.voice[r.pad];
      if (v && v.t > this.g.ctx.currentTime + 0.001) this.stopVoice(r.pad);
      if (p.gate && !this.st.hold && !this.held.has(r.pad)) this.stopVoice(r.pad);
      this.renderButtons();
    }

    /* =========================================================== efeitos */

    /** Aperta um efeito: liga no bus escolhido (ou desliga, se ja estava). Segurar = so enquanto segura. */
    fxDown(name) {
      if (this.setup) this.toggleSetup(false);
      const b = this.st.bus;
      if (name === "mfx" && (this.shift || this.shiftKey)) { this.shiftUsed(); this.startMfxPick(); return; }
      const id = name === "mfx" ? this.st.mfx : name;
      const cur = this.st.fx[b];
      const isOn = name === "mfx" ? !!(cur && RJ.D4FX.byId(cur).mfx) : cur === id;
      this.press = { name, t: performance.now(), turnedOn: !isOn };
      if (isOn) { this.setFx(b, null); this.endMfxPick(); return; }
      if (!this.fxAvailable(id)) { this.flash("Err", "fx"); this.press.turnedOn = false; return; }
      this.setFx(b, id);
      if (name === "mfx") this.startMfxPick();
    }

    fxUp(name) {
      const p = this.press;
      this.press = null;
      if (!p || p.name !== name || !p.turnedOn || this.st.hold) return;
      if (performance.now() - p.t > LONG) { this.setFx(this.st.bus, null); this.endMfxPick(); }
    }

    fxAvailable(id) { const d = RJ.D4FX.byId(id); return !!d && (!d.worklet || this.worklet); }

    setFx(b, id) {
      this.st.fx[b] = id;
      this.applyBus(b);
      this.showBase();
      this.renderCaps();
      this.dirty();
    }

    startMfxPick() {
      this.mfxPick = true;
      clearTimeout(this.mfxTimer);
      this.mfxTimer = setTimeout(() => this.endMfxPick(), 5000);
      this.renderPads();
    }
    endMfxPick() { if (!this.mfxPick) return; this.mfxPick = false; clearTimeout(this.mfxTimer); this.renderPads(); }

    /** MFX: pad 1 Reverb, 2 Lo-fi, 3 Compressor, 4 Stopper. */
    pickMfx(k) {
      const d = RJ.D4FX.mfx(k);
      this.endMfxPick();
      if (!d || !this.fxAvailable(d.id)) { this.flash("Err", "fx"); return; }
      this.st.mfx = d.id;
      this.setFx(this.st.bus, d.id);
      this.render();
    }

    selectBus(b) {
      this.st.bus = b;
      this.endMfxPick();
      this.showBase();
      this.renderCaps();
      this.dirty();
    }

    /* ---------------------------------------- Ctrl 1-3: o efeito do bus escolhido, ou o Set-up */

    curFx() { const id = this.st.fx[this.st.bus]; return id ? RJ.D4FX.byId(id) : null; }

    /** Set-up com Shift armado e Source em Mix: Ctrl 1 e 2 viram os envios do RJ-2000 e do RJ-950. */
    sendPage() { return this.setup && (this.shift || this.shiftKey) && this.src === "mix"; }

    /** Shift armado (fora do Set-up): Ctrl 1 e 2 ajustam o LO-FI (bits e taxa). */
    lofiPage() { return !this.setup && (this.shift || this.shiftKey) && !this.sendPage(); }

    ctrlGet(k) {
      if (this.lofiPage()) {
        const L = RJ.D4_LOFI;
        return [(this.st.lofiBits - L.minBits) / (L.maxBits - L.minBits), 1 - Math.log(this.st.lofiDown) / Math.log(L.maxDown), 0][k];
      }
      if (this.sendPage()) return [this.st.sendRj / 2, this.st.send950 / 2, 0][k];
      if (this.setup) return [ (this.st.bpm - 40) / 200, this.st.roll / (ROLLS.length - 1), this.st.padLevel[this.st.cur] ][k];
      const f = this.curFx();
      return f ? this.st.params[f.id][k] : 0.5;
    }

    ctrlSet(k, v) {
      if (this.lofiPage()) {
        const L = RJ.D4_LOFI;
        if (k === 0) { this.st.lofiBits = Math.round(L.minBits + v * (L.maxBits - L.minBits)); this.flash(String(this.st.lofiBits), "fx"); }
        if (k === 1) { this.st.lofiDown = clamp(Math.round(Math.pow(L.maxDown, 1 - v)), 1, L.maxDown); this.flash("r." + this.st.lofiDown, "fx"); }
        this.applyLofi();
        return;
      }
      if (this.sendPage()) {
        if (k === 0) { this.st.sendRj = v * 2; this.applyInput(); this.flash(String(Math.round(v * 127)), "fx"); }
        if (k === 1) { this.st.send950 = v * 2; this.applyInput(); this.flash(String(Math.round(v * 127)), "fx"); }
        return;
      }
      if (this.setup) {
        if (k === 0) { this.st.bpm = Math.round(40 + v * 200); this.applyBpm(); this.flash(String(this.st.bpm), "bpm"); }
        if (k === 1) { this.st.roll = Math.round(v * (ROLLS.length - 1)); this.flash(ROLL_SHOW[this.st.roll], "bpm"); }
        if (k === 2) { this.st.padLevel[this.st.cur] = v; this.flash(String(Math.round(v * 127)), "pad"); }
        return;
      }
      const f = this.curFx();
      if (!f) { this.flash("---", "fx"); return; }
      this.st.params[f.id][k] = v;
      [1, 2].forEach(b => { const fx = this.fxi[b][f.id]; if (fx) fx.set(k, v); });
      this.flash(String(Math.round(v * 127)), "fx");
    }

    applyBpm() { [1, 2].forEach(b => Object.values(this.fxi[b]).forEach(fx => fx.bpm && fx.bpm(this.st.bpm))); }

    toggleSetup(on = !this.setup) {
      this.setup = on;
      this.showBase();
      this.renderCaps();
      Object.values(this.knobs).forEach(k => k.draw());
    }

    /* =========================================================== Mute, Shift, Resample, entrada */

    muteDown() {
      this.st.mute = !this.st.mute;
      this.mutePress = { t: performance.now(), turnedOn: this.st.mute };
      this.applyMute();
      this.dirty();
    }
    muteUp() {
      const p = this.mutePress;
      this.mutePress = null;
      if (p && p.turnedOn && !this.st.hold && performance.now() - p.t > LONG) { this.st.mute = false; this.applyMute(); }
    }

    /** Shift: tocar e soltar arma para o proximo botao; segurar vale enquanto segura. */
    shiftDown() { this.shiftT = performance.now(); this.shiftHeldUsed = false; this.shift = !this.shift; this.renderCaps(); }
    shiftUp() { if (performance.now() - this.shiftT > LONG || this.shiftHeldUsed) this.shift = false; this.renderCaps(); }
    /** Shift do teclado do computador: vale enquanto a tecla esta apertada (nao arma o proximo botao). */
    setShiftKey(on) { on = !!on; if (this.shiftKey === on) return; this.shiftKey = on; if (this.btn && this.btn.shift) { this.renderCaps(); this.renderButtons(); } }
    shiftUsed() { this.shiftHeldUsed = true; if (this.btn.shift && !this.btn.shift.dataset.press) this.shift = false; this.renderButtons(); }

    /** Resample: grava a saida com efeito (antes do Volume) no primeiro pad vazio. Shift + Resample apaga o pad escolhido. */
    resample() {
      if (this.shift || this.shiftKey) {
        this.shiftUsed();
        if (!this.buf[this.st.cur]) { this.flash("---", "pad"); return; }
        this.confirmDel = performance.now();
        this.flash("dEL", "pad", 3000);
        return;
      }
      if (this.confirmDel && performance.now() - this.confirmDel < 3000) {
        this.confirmDel = 0;
        this.clearPad(this.st.cur);
        this.flash("P." + String(this.st.cur + 1).padStart(2, "0"), "pad");
        return;
      }
      if (this.rec) { this.stopRec(); return; }
      if (!this.worklet) { this.flash("Err"); return; }
      const i = this.emptyPad();
      if (i < 0) { this.flash("FUL", "pad"); return; }
      const ctx = this.g.ctx;
      const node = new AudioWorkletNode(ctx, "d4-rec", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: "explicit" });
      const r = { pad: i, node, chunks: [], len: 0, max: MAX_REC * ctx.sampleRate };
      node.port.onmessage = e => {
        if (e.data === "done") { this.finishRec(r); return; }
        r.chunks.push(e.data); r.len += e.data[0].length;
        if (r.len >= r.max && this.rec === r) this.stopRec();
      };
      this.g.post.connect(node);
      node.connect(this.g.sink);
      node.port.postMessage("start");
      this.rec = r;
      this.renderButtons();
      this.flash("rEC", "pad", 1e9);
    }

    stopRec() {
      const r = this.rec;
      if (!r) return;
      this.rec = null;
      r.node.port.postMessage("stop");
      this.renderButtons();
    }

    finishRec(r) {
      try { this.g.post.disconnect(r.node); } catch (e) { /* ja desligado */ }
      r.node.disconnect();
      const ctx = this.g.ctx, len = Math.min(r.len, r.max);
      if (len < ctx.sampleRate * 0.05) { this.flash("---", "pad"); return; }
      const b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let o = 0;
        for (const ch of r.chunks) { const n = Math.min(ch[c].length, len - o); d.set(ch[c].subarray(0, n), o); o += n; if (o >= len) break; }
        // rampas de 3 ms nas pontas
        const f = Math.min(Math.floor(ctx.sampleRate * 0.003), len >> 1);
        for (let k = 0; k < f; k++) { d[k] *= k / f; d[len - 1 - k] *= k / f; }
      }
      this.setBuffer(r.pad, b, "RESAMPLE " + (r.pad + 1), true);
      this.st.pads[r.pad] = Object.assign(newPad(), { name: "RESAMPLE " + (r.pad + 1) });
      this.st.cur = r.pad;
      this.dirty();
      this.flash("P." + String(r.pad + 1).padStart(2, "0"), "pad");
      this.render();
    }

    /** As fontes que existem nesta pagina: o RJ-2000 so no Studio (quando ele esta em targets()). */
    sources() {
      const s = [];
      const has = id => this.host.targets().some(t => t.id === id);
      if (has("rj2000")) s.push("rj2000");
      if (has("rj950")) s.push("rj950");
      if (has("rj2000") && has("rj950")) s.push("mix");
      s.push("line");
      return s;
    }

    /** Source: troca a fonte da entrada (desligada, RJ-2000, RJ-950, Mix dos dois, Line). A Line so liga quando escolhida. */
    async nextSource() {
      const list = ["off"].concat(this.sources());
      const next = list[(list.indexOf(this.src) + 1) % list.length];
      if (next === "line" && !this.line) {
        this.flash("in.", null, 8000);
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("sem getUserMedia");
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          const node = this.g.ctx.createMediaStreamSource(stream);
          node.connect(this.g.srcLine);
          this.line = { stream, node };
        } catch (e) {
          console.warn("Line In nao abriu", e);
          this.src = "off"; this.applyInput(); this.flash("Err"); this.renderButtons();
          return;
        }
      }
      this.src = next;
      if (next !== "line") this.closeLine();
      this.applyInput();
      this.renderCaps();
      this.flash({ off: "oFF", rj2000: "rJ", rj950: "950", mix: "Mix", line: "Lin" }[next]);
      this.renderButtons();
    }

    closeLine() {
      if (!this.line) return;
      this.line.node.disconnect();
      this.line.stream.getTracks().forEach(t => t.stop());
      this.line = null;
    }

    /* =========================================================== display e LEDs */

    /** Mostra txt por ms (depois volta ao normal). led: "bpm" | "pad" | "fx" | null. */
    flash(txt, led = "fx", ms = 1100) {
      if (!this.el) return;
      clearTimeout(this.flashTimer);
      this.drawDisplay(txt, led);
      this.flashTimer = setTimeout(() => this.showBase(), ms);
    }

    /** O normal: no Set-up, o BPM; com efeito no bus escolhido, "F.0n"; senao o BPM. */
    showBase() {
      if (!this.el) return;
      if (this.rec) { this.drawDisplay("rEC", "pad"); return; }
      const f = this.curFx();
      if (!this.setup && f) this.drawDisplay("F." + String(f.n).padStart(2, "0"), "fx");
      else this.drawDisplay(String(this.st.bpm), "bpm");
    }

    drawDisplay(txt, led) {
      if (!this.on) txt = "   ";
      if (this.shown !== txt) { drawSeg(this.el.seg, txt); this.shown = txt; }
      $$("[data-led]", this.el.seg.parentNode).forEach(l => l.classList.toggle("on", this.on && l.dataset.led === led));
    }

    render() {
      this.renderButtons();
      this.renderPads();
      this.renderCaps();
      Object.values(this.knobs || {}).forEach(k => k.draw());
      if (this.on) this.showBase(); else this.drawDisplay("   ", null);
    }

    /** LED da tecla: o <i class="led"> do mesmo bloco. */
    led(id, on, blink = false) {
      const b = this.btn[id];
      if (!b) return;
      const box = b.closest(".d4-fxk, .r42-bk");
      const l = box && box.querySelector("i.led");
      if (l) { l.classList.toggle("on", !!(this.on && (on || blink))); l.classList.toggle("blink", !!(this.on && blink && !on)); }
    }

    renderButtons() {
      if (!this.btn) return;
      const st = this.st, b = st.bus, other = b === 1 ? 2 : 1;
      const cur = st.fx[b], oth = st.fx[other];
      const fxBtn = id => (RJ.D4FX.byId(id) && RJ.D4FX.byId(id).mfx ? "mfx" : id);
      ["filter", "isolator", "delay", "vinyl", "djfx", "mfx"].forEach(k => {
        const on = cur && fxBtn(cur) === k, bl = oth && fxBtn(oth) === k;
        this.led("fx-" + k, on, bl);
        this.btn["fx-" + k].classList.toggle("down", !!(this.on && on) || !!this.btn["fx-" + k].dataset.press);
      });
      this.led("bus-1", b === 1, b !== 1 && !!st.fx[1]);
      this.led("bus-2", b === 2, b !== 2 && !!st.fx[2]);
      this.led("mute", st.mute);
      this.led("hold", st.hold);
      this.led("subpad", !!this.roll);
      this.led("resample", !!this.rec, !!this.rec);
      if (this.rec) { const l = this.btn.resample.closest(".r42-bk").querySelector("i.led"); l.classList.add("blink"); }
      this.renderModes();
      // teclas que ficam "presas": Set-up e Shift
      this.btn.setup.classList.toggle("down", this.setup || !!this.btn.setup.dataset.press);
      this.btn.shift.classList.toggle("down", this.shift || this.shiftKey || !!this.btn.shift.dataset.press);
      ["bus-1", "bus-2", "mute", "hold", "subpad", "resample", "gate", "loop", "reverse", "velocity", "in-source"].forEach(id => {
        const el = this.btn[id];
        if (el) el.classList.toggle("down", !!el.dataset.press);
      });
      // entrada
      const srcs = this.sources();
      $$("[data-src]", this.root).forEach(s => {
        s.classList.toggle("off", !srcs.includes(s.dataset.src));
        const l = s.querySelector(".led");
        l.classList.toggle("on", this.on && this.src === s.dataset.src);
      });
    }

    renderModes() {
      if (!this.btn) return;
      const p = this.st.pads[this.st.cur];
      this.led("gate", p.gate); this.led("loop", p.loop); this.led("reverse", p.rev);
      this.led("lofi", this.st.lofi);
    }

    renderPads() {
      if (!this.padEls) return;
      this.padEls.forEach((el, i) => {
        el.parentNode.classList.toggle("used", !!this.buf[i]);
        el.classList.toggle("hit", !!this.voice[i] || (this.mfxPick && i < 4));
        el.title = this.st.pads[i].name || "";
        el.setAttribute("aria-label", "Pad " + (i + 1) + (this.st.pads[i].name ? ": " + this.st.pads[i].name : this.buf[i] ? "" : " (vazio)"));
      });
    }

    renderCaps() {
      if (!this.root) return;
      const f = this.curFx();
      const caps = this.lofiPage() ? ["Lo Bits", "Lo Rate", "–"] : this.sendPage() ? ["Snd 2000", "Snd 950", "–"] : this.setup ? ["BPM", "Roll", "Pad Lvl"] : f ? f.caps : ["–", "–", "–"];
      $$("[data-cap]", this.root).forEach((el, k) => { el.textContent = caps[k]; });
      Object.values(this.knobs || {}).forEach(k => k.draw());
    }
  };

  RJ.D404.VERSION = VERSION;
})();
