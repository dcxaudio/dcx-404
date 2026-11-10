/* DCX 404 - o aparelho
 *
 * Sampler de performance: pads (16 na versao estavel; 12 x 5 bancos na face nova, novo/),
 * 9 efeitos ao vivo em dois buses, entrada, reamostragem e MIDI Learn. Recebe so a vista do host (host.view("dcx404")):
 * quem monta a pagina e o solo.js (pagina solo) ou o DCX Studio.
 *
 * Caminho do som:
 *   pads ─┐
 *         ├─> Bus 1 (efeito) ─> Mute ─> Bus 2 (efeito) ─> Volume ─> host.output()
 *   input ┘                                        └─> Resample (grava aqui)
 *   input = host.input() (RJ-2000 no Studio) ou Line (microfone do navegador)
 *   Face nova (tem REMAIN): so os pads ALVO do efeito entram no Bus 1; os outros vao direto (seco, com o Mute)
 *   para depois do Bus 2 (manual p. 18-19: current pad, varios com REMAIN + pads, todos com REMAIN + efeito).
 *   A entrada entra sempre no Bus 1. A estavel nao tem REMAIN: todos os pads sao alvo, como antes.
 *
 * Armazenamento (host.store, prefixo "dcx404/" no solo):
 *   "state"   JSON do painel (pads, modos, efeitos, knobs)
 *   "pad/N"   o sample do pad N: { v, name, rate, ch: [base64 Int16, ...] }
 *             N = banco * pads + pad (banco A = 0); com 1 banco, N e o numero do pad - 1
 *
 * A pagina diz quantos pads e bancos o aparelho tem em #d4: data-pad-count (1 a 16,
 * padrao 16) e data-banks (1 a 5, padrao 1). Os pads da tela sao os do banco atual;
 * padDown(i)/padUp(i) recebem o pad da tela (0 a pads - 1). data-face="dcx" e a face nova
 * (Figma): as teclas acesas ganham a classe .lit e o visor usa os digitos do Figma.
 *   (o mapa MIDI fica com o host: "midimap")
 */
window.RJ = window.RJ || {};

(function () {
  "use strict";
  const RJ = window.RJ;
  const VERSION = "b0.1";
  const STATE_KEY = "state";
  const ROOT0 = document.getElementById("d4");
  const PADS = Math.max(1, Math.min(16, Number(ROOT0?.dataset.padCount) || 16));   // pads na tela
  const BANKS = Math.max(1, Math.min(5, Number(ROOT0?.dataset.banks) || 1));        // bancos A-E
  const SLOTS = PADS * BANKS;                                                      // pads guardados
  const BANK_NAMES = "ABCDE";
  const MAX_REC = 60;              // segundos de Resample
  // REC (face nova): a "memoria" do aparelho em segundos de audio mono (estereo gasta o dobro).
  // O SP-404 tem ~5 min mono para os bancos A+B (manual p. 23): 2,5 min por banco, aqui 12,5 min para A-E.
  const MEM_SEC = 150 * BANKS;
  const REC_MIN = 0.05;            // s: gravacao mais curta que isso nao vira sample ("---")
  const REC_FREE = 0.5;            // s: com menos que isso livre, REC mostra "FuL"
  const ROLLS = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8];  // Sub Pad: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32
  const ROLL_SHOW = [" 4", " 8", "8t", "16", "16t", "32"];
  const ROLL_NF = 3;               // face nova: o Sub Pad repete em 1/16 (fixo)
  const SRC_SHOW = { off: "oFF", rj2000: "rJ", rj950: "950", mix: "Mix", line: "Lin" };
  const VELS = ["soft", "linear", "fixed"];
  const VEL_SHOW = { soft: "5UA", linear: "Lin", fixed: "127" };
  const LONG = 400;                // ms: segurar mais que isso = momentaneo (sem Hold)
  const TAP_RESET = 2000;          // ms: TAP TEMPO, pausa maior que isso recomeca a contagem
  const TAP_N = 4;                 // TAP TEMPO: media dos ultimos 4 intervalos
  const BPM_MIN = 40, BPM_MAX = 240;   // TAP TEMPO: a faixa do Set-up (o manual vai a 200, p. 25, 34; Igor pediu 240)
  const PEAK_DB = -1;              // LED PEAK: pico do master acima de -1 dBFS
  const PEAK_HOLD = 120;           // ms que o PEAK fica aceso depois do ultimo pico
  const PEAK_THR = Math.pow(10, PEAK_DB / 20);
  // SAMPLE EDIT (Fase 2c, manual p. 29-33)
  const EDIT_MIN = 0.1;            // s: start e end nao ficam a menos de ~100 ms um do outro (p. 31)
  const EDIT_FINE = 0.13;          // s: ajuste fino de START/END, ate ~130 ms para cada lado do centro (p. 31)
  const LOOP_XF = 0.01;            // s: crossfade na volta do loop quando ha audio antes do start (sem estalo)
  const SBPM_LO = 80;              // BPM do sample: o automatico fica entre 80 e 160 (CTRL 2 = metade/dobro, p. 33)
  const PAD_LEVEL0 = 0.8;          // LEVEL de um pad novo (ganho 1; visor 102)
  const TIME_END = 0.02;           // TIME (CTRL 1): a ponta esquerda e "oFF", a direita "Ptn" (p. 33)
  const $ =(s, r = document) => r.querySelector(s);
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
    "B": "cdefg", "D": "bcdeg",   // bancos B e D (7 segmentos: como b e d)
    "A": "abcefg", "C": "adef", "L": "def", "U": "bcdef", "u": "cde", "n": "ceg", "o": "cdeg", "i": "e", "t": "defg",
    "H": "bcefg", "h": "cefg", "y": "bcdfg", "S": "afgcd", "c": "deg", "_": "d",
    "M": "abcef",     // M (do "EMP"): o arco de 7 segmentos, como nos visores da Boss
    "q": "abcfg",     // q (Frq do Wah e do Ring Mod)
    "V": "bcdef" };   // V (drV, LEV): em 7 segmentos e o U
  // o digito do visor da face nova (Figma, "Digito de sete segmentos", 39 x 63)
  const DCX_SEG = {
    a: "M8 0H31L34 3L31 6H8L5 3L8 0Z", b: "M35 5L38 8V26L35 29L32 26V8L35 5Z", c: "M33 34L36 37V55L33 58L30 55V37L33 34Z",
    d: "M5 57H28L31 60L28 63H5L2 60L5 57Z", e: "M3 34L6 37V55L3 58L0 55V37L3 34Z", f: "M5 5L8 8V26L5 29L2 26V8L5 5Z",
    g: "M6 29H29L32 32L29 35H6L3 32L6 29Z",
  };
  function drawSeg(w, txt) {
    const chars = [];
    for (const ch of txt) { if (ch === "." && chars.length) chars[chars.length - 1].dp = true; else chars.push({ ch, dp: false }); }
    while (chars.length < 3) chars.unshift({ ch: " ", dp: false });
    if (w.dataset.seg === "dcx") {
      // ponto decimal: o Figma nao tem; so aparece aceso, no vao entre os digitos
      w.innerHTML = chars.slice(-3).map(({ ch, dp }) => {
        const on = DIG[ch] || "";
        const paths = Object.keys(DCX_SEG).map(k => `<path class="dx-sg${on.includes(k) ? " on" : ""}" d="${DCX_SEG[k]}"/>`).join("");
        // classe propria (dx-sg): com "dx-seg" o <rect> herdava width/height do visor (131 x 63) e virava um bloco vermelho
        return `<svg width="39" height="63" viewBox="0 0 39 63" overflow="visible" aria-hidden="true">${paths}${dp ? '<rect class="dx-sg on" x="39" y="58" width="4" height="5"/>' : ""}</svg>`;
      }).join("");
      w.setAttribute("aria-label", "Display " + txt.trim());
      return;
    }
    w.innerHTML = chars.slice(-3).map(({ ch, dp }) => {
      const on = DIG[ch] || "";
      const polys = Object.keys(SEG).map(k => `<polygon class="r42-seg${on.includes(k) ? " on" : ""}" points="${SEG[k]}"/>`).join("");
      return `<svg viewBox="0 0 24 40">${polys}<circle class="r42-seg${dp ? " on" : ""}" cx="22" cy="36" r="1.8"/></svg>`;
    }).join("");
    w.setAttribute("aria-label", "Display " + txt.trim());
  }
  RJ.d4DrawSeg = drawSeg;

  /** LED PEAK: algum valor do bloco passa do limiar (|x| >= thr, padrao -1 dBFS)? */
  RJ.d4PeakOver = function (data, thr = PEAK_THR) {
    for (let k = 0; k < data.length; k++) if (data[k] >= thr || data[k] <= -thr) return true;
    return false;
  };
  RJ.D4_PEAK = { db: PEAK_DB, thr: PEAK_THR, hold: PEAK_HOLD };

  /** TAP TEMPO: BPM pelos toques (ms, em ordem); null com menos de 2 toques. Media dos intervalos, 40 a 240. */
  RJ.d4TapBpm = function (taps) {
    if (!taps || taps.length < 2) return null;
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    return avg > 0 ? clamp(Math.round(60000 / avg), BPM_MIN, BPM_MAX) : null;
  };

  /** Time stretch sem mudar o tom (WSOLA, offline): factor > 1 alonga, < 1 encurta. chs: Float32Array por canal. */
  RJ.d4Stretch = function (chs, rate, factor) {
    const n = chs[0].length;
    if (!(factor > 0) || Math.abs(factor - 1) < 1e-3 || n < 4) return chs.map(c => c.slice());
    let N = Math.max(64, Math.round(rate * 0.046)); N -= N % 2;           // janela de ~46 ms, 50% de sobreposicao
    const Hs = N / 2, Ha = Hs / factor;
    let tol = Math.max(8, Math.round(rate * 0.01)); tol -= tol % 2;       // busca de +-10 ms pelo encaixe
    const outLen = Math.max(1, Math.round(n * factor));
    const w = new Float32Array(N);
    for (let j = 0; j < N; j++) w[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / N);
    const w0 = w.map((v, j) => (j < Hs ? 1 : v));
    const ref = chs.length > 1 ? chs[0].map((v, k) => (v + chs[1][k]) * 0.5) : chs[0];
    const out = chs.map(() => new Float32Array(outLen + N)), ws = new Float32Array(outLen + N);
    const at = (a, k) => (k >= 0 && k < n ? a[k] : 0);
    let prev = 0;
    const maxPos = Math.max(0, n - N);   // o quadro nunca passa do fim da entrada (senao a ponta sai cortada: estalo)
    for (let m = 0, o = 0; o < outLen; m++, o += Hs) {
      const nom = Math.min(Math.round(m * Ha), maxPos);
      let pos = nom;
      if (m > 0) {
        // o trecho que continuaria o quadro anterior (prev + Hs) e procurado perto da posicao nominal
        // busca em dois passos (grossa de 8 em 8 amostras, depois fina de 1 em 1 em volta): ~10x menos conta que a busca
        // inteira; sample longo com TIME nao trava a pagina (60 s estereo: ~1,6 s -> ~0,15 s)
        const tgt = prev + Hs;
        const score = (c, step) => { let s = 0; for (let j = 0; j < Hs; j += step) s += at(ref, c + j) * at(ref, tgt + j); return s; };
        let best = -Infinity, c0 = nom;
        for (let d = -tol; d <= tol; d += 8) {
          const c = nom + d;
          if (c < 0 || c > maxPos) continue;
          const s = score(c, 16);
          if (s > best || (s === best && Math.abs(d) < Math.abs(c0 - nom))) { best = s; c0 = c; }
        }
        best = -Infinity; pos = c0;
        for (let d = -7; d <= 7; d++) {
          const c = c0 + d;
          if (c < 0 || c > maxPos || Math.abs(c - nom) > tol) continue;
          const s = score(c, 4);
          if (s > best || (s === best && Math.abs(c - nom) < Math.abs(pos - nom))) { best = s; pos = c; }
        }
      }
      // 1o quadro sem a subida da janela: senao as primeiras amostras (janela ~0) saem quase mudas e "pulam" (estalo no
      // crossfade do loop, que usa esse comeco como o audio de antes do start)
      const wm = m === 0 ? w0 : w;
      for (let k = 0; k < chs.length; k++) { const x = chs[k], y = out[k]; for (let j = 0; j < N; j++) y[o + j] += at(x, pos + j) * wm[j]; }
      for (let j = 0; j < N; j++) ws[o + j] += wm[j];
      prev = pos;
    }
    return out.map(y => { const r = new Float32Array(outLen); for (let k = 0; k < outLen; k++) r[k] = ws[k] > 1e-3 ? y[k] / ws[k] : y[k]; return r; });
  };

  /** BPM do sample: batidas (potencia de 2) que poem o trecho entre 80 e 160 BPM; lista = as que cabem em 40-240. */
  const autoBeats = L => { let b = Math.pow(2, Math.ceil(Math.log2(SBPM_LO * L / 60))); if (60 * b / L >= 2 * SBPM_LO) b /= 2; return b; };
  const beatList = L => { const a = []; for (let k = Math.ceil(Math.log2(BPM_MIN * L / 60)); k <= Math.floor(Math.log2(BPM_MAX * L / 60)); k++) a.push(Math.pow(2, k)); return a; };
  RJ.d4AutoBeats = autoBeats; RJ.d4BeatList = beatList;

  // start/end em segundos (end null = fim do sample); beats: batidas do trecho (null = automatico);
  // time: Time Modify (null = oFF, "ptn" = segue o BPM do 404, numero = BPM alvo)
  const newPad = () => ({ name: "", gate: false, loop: false, rev: false, start: 0, end: null, beats: null, time: null });
  function newState() {
    const params = {};
    RJ.D4FX.forEach(f => { params[f.id] = f.def.slice(); });
    return {
      format: "dcx404", v: 1,
      pv: 2,   // versao dos padroes dos efeitos: 2 = PITCH com BALANCE todo no efeito (Onda 1.5b); sem o campo = estado de antes
      vol: 0.8, inLevel: 0.8, sendRj: 1, send950: 1, vel: "soft", bpm: 90, roll: 3, padLevel: new Array(SLOTS).fill(PAD_LEVEL0),
      bus: 1, fx: { 1: null, 2: null }, mfx: "reverb", params,
      hold: false, mute: false, cur: 0, bank: 0,
      lofi: false, lofiBits: RJ.D4_LOFI.bits, lofiDown: RJ.D4_LOFI.down,
      stereo: false,   // STEREO (face nova): REC grava em 2 canais; apagado = mono (manual p. 23)
      // alvo do efeito (face nova, manual p. 18-19): fxAll = todos (botao do efeito pisca); fxPads = varios
      // (pads guardados escolhidos com REMAIN + pads); null = so o current pad (o padrao)
      fxAll: false, fxPads: null,
      pads: new Array(SLOTS).fill(null).map(newPad),
    };
  }

  RJ.D404 = class {
    constructor(host) {
      this.host = host;
      this.engine = host.engine;
      this.version = VERSION;
      this.st = newState();
      this.buf = new Array(SLOTS).fill(null);    // AudioBuffer de cada pad (todos os bancos)
      this.rbuf = new Array(SLOTS).fill(null);   // o mesmo, de tras para frente (Reverse)
      this.voice = new Array(SLOTS).fill(null);  // a voz tocando em cada pad (uma por pad)
      this.held = new Set();                     // pads apertados agora (numero guardado)
      this.downSlot = new Array(PADS).fill(-1);  // pad da tela -> pad guardado que ele apertou
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
      this.delMode = null;                      // DEL: { sel: Set de pads guardados escolhidos }
      this.taps = [];                           // TAP TEMPO: horas dos toques (ms)
      this.tapHeld = false;                     // TAP apertado: botao de efeito = Effect Grab
      this.tapT0 = 0;                           // TAP: hora do ultimo toque que deu o BPM (o LED pisca a partir dela)
      this.lastFx = "filter";                   // ultimo efeito (manual p. 19: ao ligar e o Filter+Drive)
      this.sed = null;                          // SAMPLE EDIT: { mode: "se" (START/END/LEVEL) | "tb" (TIME/BPM), pad, base, knob }
      this.pbuf = new Array(SLOTS).fill(null);  // o trecho start-end pronto para tocar (com Time Modify e as pontas sem estalo)
      this.remainHeld = null;                   // REMAIN apertado: { fxAll, fxPads, preset } de antes (o CANCEL volta a eles)
      this.preset = [null, null, null];         // preselecao C-1/C-2/C-3 (REMAIN + Ctrl): vale para o proximo efeito ligado
      this.markOp = null;                       // MARK em curso: { pad, stage: "end" | "armEnd", p1, prev: { start, end }, wait }
      this.markHeld = false;                    // MARK apertado (MARK + pad = so o end, manual p. 31)
    }

    /* =========================================================== montagem */

    build(root = $("#d4")) {
      this.root = root;
      this.version = root.dataset.version || VERSION;
      this.el = { seg: $("#d4-seg", root), pads: $("#d4-pads", root), file: $("#d4-file") || this.makeFileInput() };
      const L = this.host.learn;

      // pads: os que a pagina ja trouxe (face nova) ou 4 x 4 criados aqui (o mesmo .pcol/.pad do RJ-2000)
      this.padEls = [];
      for (let i = 0; i < PADS; i++) {
        let b = $(`[data-ctrl="pad-${i + 1}"]`, this.el.pads);
        if (!b) {
          const pc = document.createElement("div");
          pc.className = "pcol";
          pc.innerHTML = `<button class="pad" data-ctrl="pad-${i + 1}" aria-label="Pad ${i + 1}"></button><span class="cap">${i + 1}</span>`;
          b = pc.firstElementChild;
          this.el.pads.appendChild(pc);
        }
        this.padEls.push(b);
        b.addEventListener("pointerdown", e => {
          e.preventDefault();
          if (!this.host.on) return;
          try { b.setPointerCapture(e.pointerId); } catch (_) {}
          b.classList.add("down");
          b.dataset.ptr = "1";
          this.padDown(i, 1);
        });
        const up = () => { delete b.dataset.ptr; if (!b.classList.contains("down")) return; b.classList.remove("down"); this.padUp(i); };
        b.d4Release = () => { if (b.dataset.ptr) up(); };
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
          if (f) this.loadFile(this.slotOf(i), f);
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
        "fx-pitch": ["Pitch", () => this.fxDown("pitch"), () => this.fxUp("pitch")],   // face nova (o som e da Onda 1)
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
        // face nova (so existem la): DEL, CANCEL (por ora so cancela o DEL) e TAP TEMPO / Effect Grab
        "del": ["Del", () => this.delPress()],
        "cancel": ["Cancel", () => this.cancelPress()],
        "tap": ["Tap Tempo", () => this.tapDown(), () => this.tapUp()],
        // REC / STEREO / REMAIN (Fase 2b): sampling da entrada (manual p. 14, 23-25, 28)
        "rec": ["Rec", () => this.recPress()],
        "stereo": ["Stereo", () => this.toggleStereo()],
        // REMAIN (2d): toque = tempo livre; segurado + pads = alvos do efeito, + efeito = todos, + Ctrl = C-1/C-2/C-3
        "remain": ["Remain", () => this.remainDown(), () => this.remainUp()],
        // MARK (2d): marca START POINT / END POINT do pad tocando (manual p. 30-32)
        "mark": ["Mark", () => this.markDown(), () => this.markUp()],
        // SAMPLE EDIT (Fase 2c): CTRL 1/2/3 viram START/END/LEVEL ou TIME/BPM do pad atual (manual p. 29-33)
        "start-end": ["Start/End/Level", () => this.sedPress("se")],
        "time-bpm": ["Time/BPM", () => this.sedPress("tb")],
      };
      // a pagina ainda traz REC, STEREO, REMAIN, START/END/LEVEL e TIME/BPM como teclas sem funcao (data-dead): viram teclas do motor
      // aqui, antes do solo.js ligar as data-dead (assim o HTML da face nova nao precisa mudar)
      ["rec", "stereo", "remain", "start-end", "time-bpm", "mark"].forEach(id => {
        const el = $(`[data-dead="${id}"]`, root);
        if (el && !$(`[data-ctrl="${id}"]`, root)) { el.dataset.ctrl = id; delete el.dataset.dead; }
      });
      for (let k = 0; k < BANKS && BANKS > 1; k++) BTN["bank-" + BANK_NAMES[k].toLowerCase()] = ["Bank " + BANK_NAMES[k], () => this.setBank(k)];
      this.btn = {};
      this.btnFn = {};
      Object.keys(BTN).forEach(id => {
        const el = $(`[data-ctrl="${id}"]`, root);
        if (!el) return;
        const [name, down, up] = BTN[id];
        this.btn[id] = el;
        this.btnFn[id] = { down, up };
        el.addEventListener("pointerdown", e => {
          e.preventDefault();
          if (!this.host.on) return;
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          el.dataset.press = "1";
          down();
          this.renderButtons();
        });
        const end = () => { if (!el.dataset.press) return; delete el.dataset.press; if (up) up(); this.renderButtons(); };
        el.d4Release = end;
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        el.addEventListener("contextmenu", e => e.preventDefault());
        // MIDI Learn: o midimap poe .down na tecla, mas renderButtons redesenha .down a partir das marcas;
        // data-midi e a marca do MIDI (separada da do ponteiro, data-press; data-learn ja e o id do Learn)
        L.add(id, el, "404 " + name, "button", {
          down: () => { if (this.host.on) { el.dataset.midi = "1"; down(); this.renderButtons(); } },
          up: () => { const was = !!el.dataset.midi; delete el.dataset.midi; if (was && up) up(); this.renderButtons(); },
        });
      });

      // knobs
      this.knobs = {};
      this.bindKnob("volume", "404 Volume", () => this.st.vol, v => { this.st.vol = v; this.applyVol(); this.flash(String(Math.round(v * 127)), null); });
      this.bindKnob("in-level", "404 Input Level", () => this.st.inLevel, v => { this.st.inLevel = v; this.applyInput(); this.flash(String(Math.round(v * 127)), null); });
      [0, 1, 2].forEach(k => this.bindKnob("ctrl-" + (k + 1), "404 Ctrl " + (k + 1), () => this.ctrlGet(k), v => this.ctrlSet(k, v), () => this.ctrlRelease(k)));

      // trocar de janela com o dedo (mouse) numa tecla ou pad: o pointerup pode nao chegar, entao solta aqui
      // (senao o TAP fica "apertado" e todo efeito vira Effect Grab, ou o pad com Gate segue tocando)
      window.addEventListener("blur", () => {
        Object.values(this.btn).forEach(el => el.dataset.press && el.d4Release());
        this.padEls.forEach(el => el.d4Release && el.d4Release());
      });
      // face nova: LED do TAP no tempo e o ultimo efeito piscando enquanto o TAP esta apertado
      if (this.btn.tap) this.blinkTimer = setInterval(() => this.renderBlink(), 25);

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

    /** Aperta (down = true) ou solta uma tecla pelo id, como o dedo (para mapas MIDI padrao e teclado). */
    pressKey(id, down) {
      const f = this.btnFn && this.btnFn[id];
      if (!f || !this.host.on) return;
      if (down) f.down(); else if (f.up) f.up();
      this.renderButtons();
    }

    /* ---------------------------------------- bancos (A-E) */

    /** Pad da tela i -> numero guardado no banco atual. */
    slotOf(i) { return this.st.bank * PADS + i; }
    /** O botao da tela de um pad guardado (null se o banco dele nao esta na tela). */
    elOf(s) { const i = s - this.st.bank * PADS; return this.padEls && i >= 0 && i < PADS ? this.padEls[i] : null; }
    /** Nome curto no visor: "A.01" com bancos, "P.01" sem. */
    padShow(s) { return (BANKS > 1 ? BANK_NAMES[Math.floor(s / PADS)] : "P") + "." + String(s % PADS + 1).padStart(2, "0"); }
    padLabel(s) { return BANKS > 1 ? BANK_NAMES[Math.floor(s / PADS)] + String(s % PADS + 1).padStart(2, "0") : String(s + 1); }

    setBank(b) {
      b = clamp(b | 0, 0, BANKS - 1);
      this.st.bank = b;
      this.endMfxPick();
      if (this.delMode) this.delMode.sel.clear();   // DEL: os pads escolhidos sao de um banco so (manual p. 27)
      this.flash("b-" + BANK_NAMES[b], "pad");
      this.renderPads();
      this.renderButtons();
      this.dirty();
    }
    /** Banco anterior (-1) ou proximo (+1), dando a volta. */
    bankStep(d) { if (BANKS > 1) this.setBank((this.st.bank + d + BANKS) % BANKS); }

    makeFileInput() {
      const inp = document.createElement("input");
      inp.type = "file"; inp.hidden = true; inp.accept = "audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac,.m4a";
      document.body.appendChild(inp);
      return inp;
    }

    /** release: chamado ao soltar o knob da tela (ou 600 ms depois da roda/setas): o ajuste fino de START/END recentra. */
    bindKnob(id, name, get, set, release) {
      const el = $(`[data-ctrl="${id}"]`, this.root);
      if (!el) return;
      const draw = () => el.style.setProperty("--a", (-135 + get() * 270) + "deg");
      const put = v => { if (!this.host.on) return; set(clamp(v, 0, 1)); draw(); this.dirty(); };
      this.knobs[id] = { el, draw };
      this.host.learn.add(id, el, name, "value", { get, set: put });
      let y0 = 0, v0 = 0;
      el.addEventListener("pointerdown", e => { e.preventDefault(); el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); el.dataset.drag = "1"; });
      el.addEventListener("pointermove", e => { if (!el.dataset.drag) return; put(v0 + (y0 - e.clientY) / 170); });
      let relT = 0;
      const later = () => { if (!release) return; clearTimeout(relT); relT = setTimeout(release, 600); };
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { const was = !!el.dataset.drag; delete el.dataset.drag; if (was && release) release(); }));
      el.addEventListener("wheel", e => { e.preventDefault(); put(get() - Math.sign(e.deltaY) * 0.02); later(); }, { passive: false });
      el.addEventListener("keydown", e => {
        const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
        if (d == null) return;
        e.preventDefault(); e.stopPropagation(); put(get() + d); later();
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
        if (this.pvOld) { this.pvOld = false; this.dirty(); }
      }
      this.prepSoon();   // os pads com start/end ou Time Modify ficam prontos para tocar
      this.applyAll();
      this.render();
      this.flash(this.version, null, 900);
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
      // monitoracao da entrada: STEREO apagado = mono (L+R)/2 nos dois lados (manual p. 17); aceso = estereo.
      // So a escuta: o REC le o inLevel (2 canais) e dobra no fim; pads e Resample nao passam aqui
      G.inSt = ctx.createGain();
      G.inMono = ctx.createGain(); G.inMono.gain.value = 0;
      G.inMono.channelCount = 1; G.inMono.channelCountMode = "explicit"; G.inMono.channelInterpretation = "speakers";
      G.inLevel.connect(G.inSt).connect(G.bus1.input);
      G.inLevel.connect(G.inMono).connect(G.bus1.input);
      G.bus1.output.connect(G.mute).connect(G.bus2.input);
      // LO-FI: seco (ganho 1) e molhado (o worklet entra so quando liga) somam em post, antes do Volume
      G.lofiDry = ctx.createGain(); G.lofiWet = ctx.createGain(); G.lofiWet.gain.value = 0;
      G.post = ctx.createGain(); G.crush = null;
      // mix = saida do Bus 2 + os pads que nao sao alvo do efeito (seco, passando pelo Mute como o resto)
      G.dry = ctx.createGain(); G.dryMute = ctx.createGain(); G.mix = ctx.createGain();
      G.dry.connect(G.dryMute).connect(G.mix);
      G.bus2.output.connect(G.mix);
      G.mix.connect(G.lofiDry).connect(G.post);
      G.lofiWet.connect(G.post);
      G.post.connect(G.vol).connect(this.host.output());
      // o Looper e o Stopper precisam ouvir sempre: a saida deles vai para um ralo mudo,
      // para o navegador continuar chamando o worklet mesmo com o efeito fora do bus
      G.sink = ctx.createGain(); G.sink.gain.value = 0; G.sink.connect(ctx.destination);
      // LED PEAK (so na face que tem o LED): mede o master (depois do Volume), nao o conversor
      clearInterval(this.peakTimer);
      this.peakEl = this.root ? $(".dx-peak", this.root) : null;
      if (this.peakEl) {
        G.peak = ctx.createAnalyser();
        // a janela lida tem que cobrir o intervalo de leitura (40 ms) seja qual for a taxa (2048 a 96 kHz = 21 ms perdia picos)
        G.peak.fftSize = Math.min(32768, Math.pow(2, Math.ceil(Math.log2(ctx.sampleRate * 0.06))));
        G.vol.connect(G.peak);
        G.peak.connect(G.sink);   // o ralo mudo mantem o analisador andando
        const data = new Float32Array(G.peak.fftSize);
        let until = 0;
        this.peakTimer = setInterval(() => {
          const now = performance.now();
          if (this.on && ctx.state === "running") {
            G.peak.getFloatTimeDomainData(data);
            if (RJ.d4PeakOver(data)) until = now + PEAK_HOLD;
          }
          const lit = this.on && now < until;
          if (lit !== this.peakLit) { this.peakLit = lit; this.peakEl.classList.toggle("lit", lit); }
        }, 40);
      }
      this.g = G;
      this.fxi = { 1: {}, 2: {} };
      if (this.worklet) [1, 2].forEach(b => ["djfx", "stopper"].forEach(id => this.fxInstance(b, id)));
    }

    /** A instancia do efeito id no bus b, criada na primeira vez. */
    fxInstance(b, id) {
      let fx = this.fxi[b][id];
      if (fx) return fx;
      const def = RJ.D4FX.byId(id);
      if (!def || !def.make || (def.worklet && !this.worklet)) return null;
      fx = def.make(this.g.ctx, { nf: this.nf });   // a face nova pode ter outra tabela (Delay t32-t1, balance)
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
      // so a face nova tem STEREO: na estavel a entrada segue estereo como sempre
      const mono = !!(this.btn && this.btn.stereo) && !this.st.stereo;
      this.ramp(this.g.inSt.gain, mono ? 0 : 1);
      this.ramp(this.g.inMono.gain, mono ? 1 : 0);
    }
    applyMute() { if (this.g) { this.ramp(this.g.mute.gain, this.st.mute ? 0 : 1, 0.002); this.ramp(this.g.dryMute.gain, this.st.mute ? 0 : 1, 0.002); } }
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
      st.bus = st.bus === 2 ? 2 : 1; st.cur = clamp(st.cur | 0, 0, SLOTS - 1);
      st.bank = clamp(d.bank | 0, 0, BANKS - 1);
      st.hold = !!st.hold; st.mute = !!st.mute;
      st.lofi = d.lofi === true;
      // disquete/estado sem o campo: o STEREO fica como estava (nao volta a apagado sem querer)
      st.stereo = d.stereo === undefined ? !!(this.st && this.st.stereo) : d.stereo === true;
      // alvo do efeito (2d): opcional; estado/disquete antigo = so o current pad
      st.fxAll = d.fxAll === true;
      st.fxPads = !st.fxAll && Array.isArray(d.fxPads) ? [...new Set(d.fxPads.filter(s => Number.isInteger(s) && s >= 0 && s < SLOTS))] : null;
      if (st.fxPads && !st.fxPads.length) st.fxPads = null;   // lista vazia salva (versao antiga) = current pad
      this.markOp = null; this.remainHeld = null; this.preset = [null, null, null];
      st.lofiBits = clamp(Math.round(+d.lofiBits) || RJ.D4_LOFI.bits, RJ.D4_LOFI.minBits, RJ.D4_LOFI.maxBits);
      st.lofiDown = clamp(Math.round(+d.lofiDown) || RJ.D4_LOFI.down, 1, RJ.D4_LOFI.maxDown);
      if (VELS.includes(d.vel)) st.vel = d.vel;
      // Fase 3a: o estado guarda o id do efeito (a renumeracao nao muda nada); um numero antigo solto (F.01-F.09,
      // MFX pad 1-4) e lido pelo RJ.D4FX.fromOld. MFX: na face nova vale qualquer MFX 1-24/extra (o DJFX e o 24)
      st.mfx = RJ.D4FX.fromOld(d.mfx, true);
      const mf = RJ.D4FX.byId(st.mfx);
      if (!mf || !mf.make || !(this.nf ? mf.m : mf.mfx)) st.mfx = "reverb";
      [1, 2].forEach(b => { const id = RJ.D4FX.fromOld(d.fx && d.fx[b]); const fd = id && RJ.D4FX.byId(id); st.fx[b] = fd && fd.make && (this.nf || fd.n) ? id : null; });   // a estavel nao tem PITCH: um estado da face nova abre la sem ele
      // face nova: um bus so (o Bus 1) e sem Mute (as teclas Bus 1/2 e Mute sairam do painel). O efeito do bus que estava
      // escolhido (ou, se ele estava vazio, o do outro: o Stopper no Bus 2, por exemplo) vem para o Bus 1. Com o Bus 1 vazio
      // o som e o mesmo: o Bus 2 so recebia a saida do Bus 1 (pads alvo e entrada). vel e roll ficam guardados (ignorados aqui)
      if (this.nf) {
        const keep = st.fx[st.bus] || st.fx[st.bus === 1 ? 2 : 1] || null;
        st.fx = { 1: keep, 2: null }; st.bus = 1; st.mute = false;
      }
      RJ.D4FX.forEach(f => {
        const p = d.params && (d.params[f.id] || (f.n && d.params[f.n]));
        if (Array.isArray(p)) st.params[f.id] = f.def.map((v, i) => (typeof p[i] === "number" ? clamp(p[i], 0, 1) : v));
      });
      // estado/disquete de antes da Onda 1.5b: o PITCH comecava com BALANCE no meio (0,5) e o estado guardou esse valor;
      // com ele toca o direto inteiro junto da copia afinada (que vem uns ms depois): som original de fundo, "atraso",
      // filtro pente. Se o bAL ainda esta exatamente no padrao antigo (ninguem girou), vai para o novo (todo no efeito)
      if (!(d.pv >= 2) && st.params.pitch && st.params.pitch[2] === 0.5) st.params.pitch[2] = 1;
      this.pvOld = !(d.pv >= 2);   // o boot grava logo o estado migrado (sem esperar um toque): o guardado deixa de ter o 0,5
      if (Array.isArray(d.padLevel)) st.padLevel = st.padLevel.map((v, i) => (typeof d.padLevel[i] === "number" ? clamp(d.padLevel[i], 0, 1) : v));
      if (Array.isArray(d.pads)) st.pads = st.pads.map((p, i) => {
        const x = d.pads[i] || {};
        // campos da 2c sao opcionais: estado/disquete antigo abre com o sample inteiro, sem Time Modify
        const num = v => (typeof v === "number" && isFinite(v) ? v : null);
        const start = num(x.start), end = num(x.end), beats = num(x.beats), time = num(x.time);
        return { name: String(x.name || "").slice(0, 40), gate: !!x.gate, loop: !!x.loop, rev: !!x.rev,
          start: start > 0 ? start : 0, end: end > 0 ? end : null, beats: beats > 0 ? beats : null,
          time: x.time === "ptn" ? "ptn" : time > 0 ? clamp(time, BPM_MIN, BPM_MAX) : null };
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

    /** O primeiro pad vazio, comecando pelo banco atual (pula os pads reservados por REC ou Resample). */
    emptyPad() {
      const b0 = this.st.bank * PADS;
      for (let k = 0; k < SLOTS; k++) { const s = (b0 + k) % SLOTS; if (!this.buf[s] && !this.recBusy(s, true)) return s; }
      return -1;
    }

    /** O pad s esta sendo gravado (REC ou Resample, ate o sample cair nele)? wait: conta tambem o destino do REC em espera. */
    recBusy(s, wait) {
      const sm = this.smp;
      return !!((sm && sm.pad === s && (wait || sm.stage === "rec")) || (this.stoppingSmp && this.stoppingSmp.pad === s) || (this.rec && this.rec.pad === s) || (this.stoppingRec && this.stoppingRec.pad === s));
    }

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
      // o pad esta sendo gravado (REC ou Resample): o arquivo nao entra (senao a gravacao some ou apaga o arquivo)
      if (this.recBusy(i, false)) { this.flash("rEC", "pad", 800); return; }
      if (b.numberOfChannels > 2) {
        const s = ctx.createBuffer(2, b.length, b.sampleRate);
        s.copyToChannel(b.getChannelData(0), 0); s.copyToChannel(b.getChannelData(1), 1);
        b = s;
      }
      const name = String(file.name || "SAMPLE").replace(/\.[^.]+$/, "").slice(0, 40);
      // sample novo: start/end, BPM e Time Modify voltam ao padrao (Gate/Loop/Reverse ficam)
      Object.assign(this.st.pads[i], { start: 0, end: null, beats: null, time: null });
      this.setBuffer(i, b, name, true);
      this.st.cur = i;
      // REC em espera com este pad escolhido: ele encheu, volta a escolher (os vazios piscam)
      if (this.smp && this.smp.stage === "ready" && this.smp.pad === i) { this.smp.stage = "arm"; this.smp.pad = -1; }
      this.render();
      this.flash(this.padShow(i), "pad");
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
      this.pbuf[i] = null;
      // SAMPLE EDIT neste pad: o ajuste fino recomeca da posicao do sample novo (senao parte do start/end do antigo)
      if (this.sed && this.sed.pad === i) this.sed.pad = -1;
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
      // o LEVEL (SAMPLE EDIT, Pad Lvl) era do sample apagado: o proximo sample do pad (REC, Resample) comeca no padrao
      this.st.padLevel[i] = PAD_LEVEL0;
      // nem o alvo do efeito (REMAIN + pads): o proximo sample gravado nele nao entra no efeito sem ser escolhido
      if (this.st.fxPads) { this.st.fxPads = this.st.fxPads.filter(s => s !== i); this.fxPadsTidy(); }
      this.saveSample(i);
      this.dirty();
    }

    /* =========================================================== pads */

    /** i: o pad da tela (0 a pads - 1), no banco atual. */
    padDown(i, vel = 1) {
      if (!this.on) return;
      const t = i;
      i = this.slotOf(t);
      this.downSlot[t] = i;
      this.held.add(i);
      if (this.delMode) { this.delPick(i); return; }
      if (this.smp && this.smp.stage !== "rec") { this.smpPick(i); return; }   // REC em espera: o pad escolhe o destino
      if (this.shift || this.shiftKey) { this.shiftUsed(); this.pickFile(i); return; }
      // MFX: [MFX] segurado + pad 1-12 = MFX 1-12 (+ [VINYL SIM] = 13-24); na janela de 5 s so os pads que piscam
      if (this.nf ? this.mfxPadTakes(t) : this.mfxPick && t < 4) { this.pickMfx(this.nf ? this.mfxPadNum(t) : t + 1); return; }
      if (this.remainHeld) { this.remainPick(i); return; }   // REMAIN + pad: escolhe os alvos do efeito (o pad nao toca)
      // MARK: o pad do "so o start" de novo fecha no fim do sample; outro pad desiste; MARK + pad = "so o end"
      const mo = this.markOp;
      if (mo && mo.stage === "end" && mo.pad === i) this.markFinish(null);
      else if (mo && mo.pad !== i) this.cancelMark(true);
      if (this.markHeld && !this.markOp && !this.markStartEnd(i)) return;
      this.st.cur = i;
      this.last = { pad: i, vel };
      this.retarget();   // current pad mudou: o efeito vai com ele (manual p. 18)
      this.flash(this.padShow(i), "pad");
      if (this.sed) { this.sedSync(); Object.values(this.knobs).forEach(k => k.draw()); }   // SAMPLE EDIT segue o pad atual
      const p = this.st.pads[i];
      // Loop sem Gate: o mesmo pad de novo para o loop
      if (p.loop && !p.gate && this.voice[i]) { this.stopVoice(i); this.renderModes(); return; }
      this.play(i, vel);
      this.renderModes();
      this.dirty();
    }

    padUp(t) {
      // solta o pad que este botao apertou (mesmo que o banco tenha mudado no meio)
      const i = this.downSlot[t] >= 0 ? this.downSlot[t] : this.slotOf(t);
      this.downSlot[t] = -1;
      this.held.delete(i);
      const p = this.st.pads[i];
      if (p.gate && !this.st.hold && !(this.roll && this.roll.pad === i)) {
        // Gate: soltar o pad no "so o start" fecha o end no fim do sample (manual p. 31)
        if (this.markOp && this.markOp.stage === "end" && this.markOp.pad === i) this.markFinish(null);
        this.stopVoice(i);
      }
    }

    /** Toca o pad i (uma voz por pad: a nova corta a anterior). when: hora do AudioContext. */
    play(i, vel, when) {
      if (!this.buf[i] || !this.g) return;
      const ctx = this.g.ctx, t = Math.max(when || 0, ctx.currentTime);
      this.stopVoice(i, t);
      const p = this.st.pads[i];
      const src = ctx.createBufferSource();
      // trecho start-end (e Time Modify): buffer pronto, com as pontas sem estalo; sem edicao, o sample inteiro como antes
      const pb = this.playBuf(i);
      src.buffer = pb ? (p.loop ? pb.loop : pb.one) : p.rev ? this.reversed(i) : this.buf[i];
      src.loop = p.loop;
      const g = ctx.createGain();
      // face nova: a forca do toque nao muda o volume (manual p. 12; a tecla Velocity saiu): curva fixa no maximo
      const amp = RJ.d4Velocity(this.nf ? "fixed" : this.st.vel, vel) * this.st.padLevel[i] * 1.25;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      src.connect(g);
      // r/f/rev: o trecho com que a voz comecou (o MARK mede a posicao no sample por eles, mesmo se o pad mudar no meio)
      const r = this.region(i);
      const v = { src, g, t, amp, pb: !!pb, r, f: pb ? this.timeFactor(i, r) : 1, rev: !!p.rev };
      if (this.hasTargets()) {
        // face nova: o pad vai ao efeito (alvo) ou direto (seco); trocar o alvo com a voz tocando cruza em 4 ms
        v.wet = this.isTarget(i) ? 1 : 0;
        v.w = ctx.createGain(); v.w.gain.value = v.wet;
        v.d = ctx.createGain(); v.d.gain.value = 1 - v.wet;
        g.connect(v.w).connect(this.g.pads);
        g.connect(v.d).connect(this.g.dry);
      } else g.connect(this.g.pads);
      src.start(t);
      this.voice[i] = v;
      src.onended = () => { if (this.voice[i] === v) { this.voice[i] = null; this.renderPads(); } g.disconnect(); if (v.w) { v.w.disconnect(); v.d.disconnect(); } };
      const lit = () => { const el = this.elOf(i); if (this.voice[i] === v && el) el.classList.add("hit"); };
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
      const el = this.elOf(i);
      if (el) el.classList.remove("hit");
    }

    stopAll() { for (let i = 0; i < SLOTS; i++) this.stopVoice(i); this.stopRoll(); }

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
      if (k === "loop" && v) {
        v.src.loop = p.loop;
        if (v.pb) {
          // trecho editado: desligar o Loop no meio deixa a volta terminar e desce o ganho no fim (o fim do buffer de loop
          // emenda com o audio antes do start); religar antes disso cancela a descida
          const ctx = this.g.ctx, now = ctx.currentTime, d = v.src.buffer.duration, el = now - v.t;
          if (!p.loop && el > 0) { v.fadeAt = now + Math.max(0, d - (el % d) - 0.006); v.g.gain.setTargetAtTime(0, v.fadeAt, 0.0015); }
          else if (p.loop && v.fadeAt && now < v.fadeAt - 0.001) { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.amp, now); v.fadeAt = 0; }
        }
      }
      if (k === "rev") this.prepSoon(this.st.cur);
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
          G.mix.connect(G.crush).connect(G.lofiWet);
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
          try { G.mix.disconnect(G.crush); } catch (e) { /* ja desligado */ }
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
        const step = ROLLS[this.rollIdx()] * 60 / this.st.bpm;
        while (r.next < ctx.currentTime + 0.09) { this.play(r.pad, r.vel, r.next); r.next += step; }
      };
      tick();
      r.timer = setInterval(tick, 20);
      this.roll = r;
      this.flash(ROLL_SHOW[this.rollIdx()], "bpm");
    }
    /** A divisao do Sub Pad. Face nova: 1/16 fixo (o manual nao tem ajuste; o Set-up saiu); o estado guarda o valor (st.roll). */
    rollIdx() { return this.nf ? ROLL_NF : this.st.roll; }

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
      // face nova: [MFX] + [VINYL SIM] + pad = MFX 13-24 (manual p. 18); na janela de 5 s o VINYL SIM troca 1-12 / 13-24
      // a janela de 5 s so vale enquanto o MFX e o efeito do bus: outro botao de efeito a fecha
      if (this.nf && this.mfxPick && name !== "mfx" && !(name === "vinyl" && this.isMfx(this.st.fx[b]))) this.endMfxPick();
      if (this.nf && name === "mfx") { this.mfxSel = null; this.mfxPage2 = false; this.mfxVinyl = false; clearTimeout(this.mfxSelTimer); }
      if (this.nf && name === "vinyl" && (this.mfxHeld() || this.mfxPick)) {
        if (this.mfxHeld()) this.mfxVinyl = true; else { this.mfxPage2 = !this.mfxPage2; this.startMfxPick(); }
        this.flash(this.mfxPage2 || this.mfxVinyl ? "13-" : "1-", "fx", 700);
        this.renderPads();
        return;
      }
      const id = name === "mfx" ? this.st.mfx : name;
      if (this.remainHeld) { this.press = null; this.remainFx(id); return; }   // REMAIN + efeito = todos os pads (p. 19)
      // Effect Grab (manual p. 18): TAP TEMPO apertado + efeito = ligado so enquanto o botao do efeito estiver apertado
      if (this.tapHeld) {
        this.taps = [];   // o toque que segurou o TAP nao conta para o tempo (e desfaz o BPM que ele mudou)
        if (this.tapBpm0 != null && this.st.bpm !== this.tapBpm0) { this.st.bpm = this.tapBpm0; this.applyBpm(); this.dirty(); }
        if (!this.fxAvailable(id)) { this.fxErr(id); this.press = null; return; }
        // prev: o efeito que estava no bus; ao soltar ele volta (se era o mesmo, o Grab o desliga, como no manual)
        this.press = { name, id, bus: b, t: performance.now(), turnedOn: true, grab: true,
          prev: this.press && this.press.grab && this.press.bus === b ? this.press.prev : this.st.fx[b] };   // dois Grabs juntos: vale o de antes do 1o
        if (this.st.fx[b] !== id) this.setFx(b, id);
        return;
      }
      const cur = this.st.fx[b];
      const isOn = name === "mfx" ? !!(cur && this.isMfx(cur)) : cur === id;
      this.press = { name, t: performance.now(), turnedOn: !isOn };
      if (isOn) { this.setFx(b, null); this.endMfxPick(); this.fxOffReset(); return; }
      if (!this.fxAvailable(id)) { this.fxErr(id); this.press.turnedOn = false; return; }
      this.setFx(b, id);
      if (name === "mfx") this.startMfxPick();
    }

    fxUp(name) {
      const p = this.press;
      if (this.nf && name === "vinyl" && this.mfxVinyl) { this.mfxVinyl = false; this.renderPads(); }   // soltou o VINYL do [MFX] + [VINYL SIM]
      if (p && p.name !== name) return;   // soltou outra tecla de efeito (dois dedos): o aperto que vale e o mais recente
      this.press = null;
      // face nova: soltar o [MFX] depois de girar o CTRL 3 liga o MFX do numero escolhido (manual p. 18);
      // escolhido por pad (ja ligou) ou pelo CTRL 3: soltar nao desliga (nao e o "segurar = so enquanto segura")
      if (this.nf && p && name === "mfx" && !p.grab) {
        this.mfxVinyl = false;
        if (this.mfxSel != null) { const k = this.mfxSel; this.mfxSel = null; clearTimeout(this.mfxSelTimer); this.pickMfx(k, p); return; }
        if (p.used) { this.renderPads(); return; }
      }
      // Effect Grab: solta o botao, o efeito sai (vale com Hold e seja qual for o tempo apertado);
      // se havia OUTRO efeito ligado no bus antes do Grab, ele volta
      if (p && p.grab && p.name === name) {
        if (this.st.fx[p.bus] === p.id) this.setFx(p.bus, p.prev && p.prev !== p.id && this.fxAvailable(p.prev) ? p.prev : null);
        return;
      }
      if (!p || p.name !== name || !p.turnedOn || this.st.hold) return;
      if (performance.now() - p.t > LONG) { this.setFx(this.st.bus, null); this.endMfxPick(); this.fxOffReset(); }
    }

    /** Efeito desligado (pelo botao, nao pelo Grab) e nenhum bus com efeito: o alvo volta ao current pad. */
    fxOffReset() {
      if (this.st.fx[1] || this.st.fx[2] || (!this.st.fxAll && !this.st.fxPads)) return;
      this.st.fxAll = false; this.st.fxPads = null;
      this.retarget(); this.renderButtons(); this.dirty();
    }

    fxAvailable(id) { const d = RJ.D4FX.byId(id); return !!d && !!d.make && (!d.worklet || this.worklet); }
    /** Nao liga: efeito que ainda nao existe (PITCH, MFX sem som) = "---"; sem worklet = "Err". */
    fxErr(id) { const d = RJ.D4FX.byId(id); this.flash(!d || d.soon || !d.make ? "---" : "Err", "fx"); }

    /** A face nova (data-face="dcx"): efeitos na ordem do manual (5 diretos + MFX 1-24); a estavel segue F.01-F.09. */
    get nf() { return !!(this.root && this.root.dataset.face === "dcx"); }
    /** O efeito entra pelo [MFX]? Face nova: MFX 1-24 (o DJFX e o 24) e o extra; estavel: os 4 do MFX pad 1-4. */
    isMfx(id) { const d = typeof id === "string" ? RJ.D4FX.byId(id) : id; return !!d && (this.nf ? !!d.m : !!d.mfx); }
    /** A tecla de efeito que acende para o efeito id ("mfx" para os MFX). */
    fxKey(id) { const d = id && RJ.D4FX.byId(id); return d ? (this.isMfx(d) ? "mfx" : id) : null; }
    /** O visor do efeito: estavel "F.0n"; face nova "F.1".."F.5" (diretos, ordem do manual), "1".."24" (MFX), "StP" (extra). */
    fxShow(f) {
      if (!this.nf) return "F." + String(f.n).padStart(2, "0");
      if (f.dir) return "F." + f.dir;
      return f.m > 24 ? "StP" : String(f.m);
    }
    /** [MFX] apertado agora (dedo, MIDI ou teclado), fora do Effect Grab. */
    mfxHeld() { const p = this.press; return !!(p && p.name === "mfx" && !p.grab); }
    /** Pad da tela t -> numero do MFX (1-12, ou 13-24 com [VINYL SIM]). */
    mfxPadNum(t) { return t + 1 + (this.mfxVinyl || this.mfxPage2 ? 12 : 0); }
    /** O pad t escolhe MFX? Com [MFX] segurado: todos os 12; na janela de 5 s: so os que tem efeito (piscam). */
    mfxPadTakes(t) {
      if (this.remainHeld || this.markHeld) return false;   // REMAIN + pad (alvos) e MARK + pad vem antes
      if (this.mfxHeld()) return true;
      if (!this.mfxPick) return false;
      const d = RJ.D4FX.byM(this.mfxPadNum(t));
      return !!(d && this.fxAvailable(d.id));
    }
    /** Pad t aceso pelo MFX: na janela de 5 s ou com [MFX] segurado, os pads cujo MFX existe (1 Reverb, 12 Comp;
     *  com [VINYL SIM]: 2 Lo-Fi, 12 DJFX). */
    mfxPadLit(t) {
      if (!this.mfxPick && !this.mfxHeld()) return false;
      const d = RJ.D4FX.byM(this.mfxPadNum(t));
      return !!(d && this.fxAvailable(d.id));
    }
    /** CTRL 3 com [MFX] segurado (ou na janela de 5 s): escolhe o numero 1-24 (25 = Stopper, extra); o visor mostra. */
    mfxKnob(v) {
      const k = clamp(1 + Math.round(v * (RJ.D4FX.MFX_MAX - 1)), 1, RJ.D4FX.MFX_MAX);
      this.mfxSel = k; this.mfxRaw = v;   // a posicao exata do knob: a roda e as setas andam 0,02 por vez, menos que um numero (1/24)
      if (this.press && this.press.name === "mfx") this.press.used = true;
      this.flash(k > 24 ? "StP" : String(k), "fx", 1500);
      this.renderMfxList();
      // sem o [MFX] segurado (janela de 5 s, mouse): liga 0,7 s depois do ultimo giro
      clearTimeout(this.mfxSelTimer);
      if (!this.mfxHeld()) {
        this.startMfxPick();
        this.mfxSelTimer = setTimeout(() => { if (this.mfxSel != null && !this.mfxHeld()) { const n = this.mfxSel; this.mfxSel = null; this.pickMfx(n); } }, 700);
      }
    }
    /** A lista impressa dos 24 MFX: o numero do visor (escolhendo, ou o MFX ligado no bus) fica marcado. */
    renderMfxList() {
      if (!this.nf || !this.root) return;
      const f = this.curFx();
      const n = this.on ? (this.mfxSel != null ? this.mfxSel : f && f.m ? f.m : null) : null;
      $$(".dx-list li", this.root).forEach((li, k) => li.classList.toggle("on", n === k + 1));
    }

    setFx(b, id) {
      const was = this.st.fx[b];
      // preselecao (REMAIN + Ctrl, "C-1".."C-3"): os valores entram no efeito que liga agora e se gastam (manual p. 19)
      if (id && id !== was && this.preset.some(v => v != null)) {
        this.preset.forEach((v, k) => {
          if (v == null) return;
          const i = this.pk(RJ.D4FX.byId(id), k);
          this.st.params[id][i] = v;
          [1, 2].forEach(x => { const fx = this.fxi[x][id]; if (fx) fx.set(i, v); });
        });
        this.preset = [null, null, null];
      }
      this.st.fx[b] = id;
      if (id) this.lastFx = id;
      if (id && this.nf && this.isMfx(id)) this.st.mfx = id;   // face nova: o DJFX (pela tecla escondida) tambem vira o MFX atual
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
    endMfxPick() {
      if (!this.mfxPick) return;
      this.mfxPick = false; this.mfxPage2 = false; clearTimeout(this.mfxTimer);
      if (this.mfxSel != null && !this.mfxHeld()) { this.mfxSel = null; clearTimeout(this.mfxSelTimer); }
      this.renderPads(); this.renderMfxList();
    }

    /** MFX. Estavel: pad 1 Reverb, 2 Lo-fi, 3 Compressor, 4 Stopper. Face nova: o numero do manual (1-24; 25 = Stopper). */
    /** p: o aperto do [MFX] que escolheu (o soltar passa o dele, ja tirado de this.press). */
    pickMfx(k, p = this.press) {
      const d = this.nf ? RJ.D4FX.byM(k) : RJ.D4FX.mfx(k);
      if (this.nf && p && p.name === "mfx") p.used = true;   // soltar o [MFX] nao desliga
      this.endMfxPick();
      if (this.nf && (!d || !d.make)) {
        // MFX do manual que ainda nao tem som: o numero aparece e depois "---"; o MFX atual nao muda.
        // O aperto do [MFX] tinha desligado o MFX ligado: escolher um numero sem som devolve o que estava
        if (p && p.name === "mfx" && !p.grab && !p.turnedOn && !this.st.fx[this.st.bus] && this.fxAvailable(this.st.mfx)) {
          p.turnedOn = true;
          this.setFx(this.st.bus, this.st.mfx);
        }
        clearTimeout(this.flashTimer);
        this.drawDisplay(String(k), "fx");
        this.flashTimer = setTimeout(() => this.flash("---", "fx", 800), 500);
        this.renderMfxList();
        return;
      }
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
      if (this.smp && k === 2) return this.st.inLevel;   // REC: o CTRL 3 e o nivel da entrada (manual p. 23), mesmo com REMAIN segurado
      if (k === 2 && this.mfxChoosing()) {   // [MFX] + CTRL 3: a posicao do numero escolhido (ou do MFX atual)
        const d = RJ.D4FX.byId(this.st.mfx), n = this.mfxSel != null ? this.mfxSel : d && d.m ? d.m : 1;
        // girando: a posicao exata (senao cada passo pequeno arredondava de volta ao mesmo numero e a roda ficava parada)
        if (this.mfxSel != null && this.mfxRaw != null && 1 + Math.round(this.mfxRaw * (RJ.D4FX.MFX_MAX - 1)) === n) return this.mfxRaw;
        return (n - 1) / (RJ.D4FX.MFX_MAX - 1);
      }
      if (this.remainHeld && !this.setup) { const f = this.curFx(); return this.preset[k] != null ? this.preset[k] : f ? this.st.params[f.id][this.pk(f, k)] : 0.5; }
      if (this.lofiPage()) {
        const L = RJ.D4_LOFI;
        return [(this.st.lofiBits - L.minBits) / (L.maxBits - L.minBits), 1 - Math.log(this.st.lofiDown) / Math.log(L.maxDown), 0][k];
      }
      if (this.sendPage()) return [this.st.sendRj / 2, this.st.send950 / 2, 0][k];
      if (this.setup) return [ (this.st.bpm - 40) / 200, this.st.roll / (ROLLS.length - 1), this.st.padLevel[this.st.cur] ][k];
      if (this.sed && this.sed.global && k < 2) return k === 1 ? (this.st.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN) : 0.5;
      if (this.sed && this.sed.mode === "se" && k === 2 && this.srcLevelOn()) return this.srcLevelGet();
      if (this.sed && (this.sed.mode === "se" || k < 2)) return this.sedGet(k);
      const f = this.curFx();
      return f ? this.st.params[f.id][this.pk(f, k)] : 0.5;
    }

    ctrlSet(k, v) {
      // REC: o CTRL 3 e o nivel da entrada, mesmo com REMAIN segurado
      if (this.smp && k === 2) { this.st.inLevel = v; this.applyInput(); this.flash(String(Math.round(v * 127)), "pad"); return; }
      // face nova: segurar [MFX] e girar o CTRL 3 escolhe o MFX 1-24 (manual p. 18); vale tambem na janela de 5 s (mouse)
      if (k === 2 && this.mfxChoosing()) { this.mfxKnob(v); return; }
      // REMAIN segurado + Ctrl: preselecao para o proximo efeito (visor "C-1".."C-3", manual p. 19); o efeito ligado nao muda
      if (this.remainHeld && !this.setup) { this.preset[k] = v; this.remainHeld.used = true; this.flash("C-" + (k + 1), "fx", 900); return; }
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
      // TIME/BPM do 404 (face nova): CTRL 2 = BPM (40-240, a faixa do TAP TEMPO); CTRL 1 nao tem funcao aqui
      if (this.sed && this.sed.global && k < 2) {
        if (k === 1) { this.st.bpm = Math.round(BPM_MIN + v * (BPM_MAX - BPM_MIN)); this.applyBpm(); this.flash(String(this.st.bpm), "bpm"); }
        else this.flash("---", "bpm", 600);
        return;
      }
      if (this.sed && this.sed.mode === "se" && k === 2 && this.srcLevelOn()) { this.srcLevelSet(v); return; }
      if (this.sed && (this.sed.mode === "se" || k < 2)) { this.sedSet(k, v); return; }
      const f = this.curFx();
      if (!f) { this.flash("---", "fx"); return; }
      const pi = this.pk(f, k);
      this.st.params[f.id][pi] = v;
      [1, 2].forEach(b => { const fx = this.fxi[b][f.id]; if (fx) fx.set(pi, v); });
      if (!this.nf) { this.flash(String(Math.round(v * 127)), "fx"); return; }
      // face nova: ao comecar a girar, o visor mostra o codigo do manual (CoF, rES, drV...) e depois o valor
      const now = performance.now(), code = f.codes && f.codes[k], fmt = f.show && f.show[k];
      const val = fmt ? fmt(v, this.st.bpm) : String(Math.round(v * 127));
      const fresh = this.codeK !== k || this.codeFx !== f.id || now - this.codeAt > 1200;
      this.codeAt = now;
      if (code && fresh) { this.codeK = k; this.codeFx = f.id; this.codeUntil = now + 500; this.flash(code, "fx", 1100); }
      else if (code && now < this.codeUntil) { clearTimeout(this.codeTimer); this.codeTimer = setTimeout(() => { if (this.codeK === k) this.flash(this.ctrlShow(k), "fx"); }, this.codeUntil - now); }
      else this.flash(val, "fx");
    }
    /** O valor do Ctrl k do efeito atual como o visor mostra. */
    ctrlShow(k) {
      const f = this.curFx();
      if (!f) return "---";
      const v = this.st.params[f.id][this.pk(f, k)], fmt = f.show && f.show[k];
      return fmt ? fmt(v, this.st.bpm) : String(Math.round(v * 127));
    }
    /** O parametro guardado que o Ctrl k move. Na face nova alguns efeitos seguem a ordem do manual (nfK):
     *  Lo-Fi rAt/bit/FLt, Vinyl CMP/noS/FLu, Delay t32-t1; o estado guarda por parametro, entao as duas faces leem o mesmo. */
    pk(f, k) { return this.nf && f && f.nfK ? f.nfK[k] : k; }
    /** [MFX] segurado ou a janela de 5 s aberta (face nova): o CTRL 3 escolhe o numero. */
    mfxChoosing() {
      if (!this.nf || this.setup || this.remainHeld || this.sed || this.lofiPage()) return false;   // REMAIN (C-3), SAMPLE EDIT e LO-FI vem antes
      return this.mfxHeld() || (this.mfxPick && this.isMfx(this.st.fx[this.st.bus]));
    }

    applyBpm() {
      [1, 2].forEach(b => Object.values(this.fxi[b]).forEach(fx => fx.bpm && fx.bpm(this.st.bpm)));
      if (this.st.pads.some((p, i) => p.time === "ptn" && this.buf[i])) this.prepSoon();   // Time Modify "Ptn" segue o BPM
    }

    toggleSetup(on = !this.setup) {
      if (on && this.sed) this.sed = null;   // Set-up e SAMPLE EDIT usam os mesmos knobs: um por vez
      this.setup = on;
      this.showBase();
      this.renderCaps();
      Object.values(this.knobs).forEach(k => k.draw());
    }


    /* =========================================================== SAMPLE EDIT (face nova, manual p. 29-33) */

    /** O trecho tocado do pad i, em segundos: start/end guardados, presos ao sample e a 100 ms um do outro. */
    region(i) {
      const b = this.buf[i], p = this.st.pads[i];
      if (!b) return { s: 0, e: 0, len: 0 };
      const len = b.duration;
      let s = clamp(+p.start || 0, 0, len), e = p.end == null ? len : clamp(+p.end || 0, 0, len);
      if (e - s < EDIT_MIN) {
        if (len <= EDIT_MIN) { s = 0; e = len; }
        else { s = Math.min(s, len - EDIT_MIN); e = Math.max(e, s + EDIT_MIN); if (e > len) e = len; }
      }
      return { s, e, len };
    }
    /** Batidas do trecho (as guardadas se o BPM cabe em 40-240; senao o automatico). */
    padBeats(i, r = this.region(i)) {
      const L = r.e - r.s, x = this.st.pads[i].beats;
      return x > 0 && 60 * x / L >= BPM_MIN - 1e-6 && 60 * x / L <= BPM_MAX + 1e-6 ? x : autoBeats(L);
    }
    /** BPM do sample: o comprimento start-end e as batidas (manual p. 33). */
    sampleBpm(i, r = this.region(i)) { const L = r.e - r.s; return L > 0 ? 60 * this.padBeats(i, r) / L : 0; }
    /** A faixa do TIME: de metade a 1,3x o BPM do sample, dentro de 40-240 (p. 33). */
    timeRange(sb) { return [Math.max(BPM_MIN, sb / 2), Math.min(BPM_MAX, sb * 1.3)]; }
    /** O BPM alvo do Time Modify (null = oFF; "Ptn" = o BPM do 404 dentro de 40-240). */
    timeTarget(i, r = this.region(i)) {
      const t = this.st.pads[i].time;
      if (t == null) return null;
      if (t === "ptn") return clamp(this.st.bpm, BPM_MIN, BPM_MAX);
      const [lo, hi] = this.timeRange(this.sampleBpm(i, r));
      return clamp(t, lo, hi);
    }
    /** Quanto o trecho estica (1 = nada). Reverse ignora o Time Modify (p. 30, 33). */
    timeFactor(i, r = this.region(i)) {
      if (this.st.pads[i].rev) return 1;
      const tb = this.timeTarget(i, r);
      if (!tb) return 1;
      const f = Math.round(this.sampleBpm(i, r) / tb * 1e4) / 1e4;
      return Math.abs(f - 1) < 0.003 ? 1 : f;
    }

    /** O buffer do trecho para tocar (cache), ou null se o pad toca o sample inteiro sem Time Modify. */
    playBuf(i) {
      const b = this.buf[i];
      if (!b || !this.g) return null;
      const p = this.st.pads[i], r = this.region(i), f = this.timeFactor(i, r);
      if (r.s <= 0 && r.e >= r.len - 1e-6 && f === 1) return null;
      const key = [r.s, r.e, p.rev ? 1 : 0, f].join("|");
      const c = this.pbuf[i];
      if (c && c.b === b && c.key === key) return c;
      return (this.pbuf[i] = this.makePlayBuf(i, r, f, key));
    }

    /** Monta o trecho: "one" (One-shot: pontas com 2 e 4 ms de rampa) e "loop" (a volta emenda com o audio de antes do start,
     *  crossfade de 10 ms; sem audio antes do start, as mesmas rampas). Com Reverse, start e end se invertem. */
    makePlayBuf(i, r, f, key) {
      const b = this.buf[i], rev = this.st.pads[i].rev, ctx = this.g.ctx, rate = b.sampleRate, n = b.length;
      const sb = rev ? this.reversed(i) : b;
      let s = Math.round(r.s * rate), e = Math.max(Math.round(r.e * rate), s + 1);
      if (rev) [s, e] = [n - e, n - s];
      const pre = Math.min(Math.round(LOOP_XF * rate), s);
      let chs = [];
      for (let c = 0; c < sb.numberOfChannels; c++) chs.push(sb.getChannelData(c).slice(s - pre, e));
      let pre2 = pre;
      if (f !== 1) { chs = RJ.d4Stretch(chs, rate, f); pre2 = Math.min(Math.round(pre * f), chs[0].length - 1); }
      const L = Math.max(1, chs[0].length - pre2);
      const one = ctx.createBuffer(chs.length, L, rate), loop = ctx.createBuffer(chs.length, L, rate);
      const fin = Math.min(Math.round(rate * 0.002), L >> 2), fout = Math.min(Math.round(rate * 0.004), L >> 2);
      const xf = Math.min(pre2, L >> 1), useXf = xf >= rate * 0.002;
      const fade = o => { for (let k = 0; k < fin; k++) o[k] *= k / fin; for (let k = 0; k < fout; k++) o[L - 1 - k] *= k / fout; return o; };
      chs.forEach((d, c) => {
        const core = d.subarray(pre2, pre2 + L);
        one.copyToChannel(fade(core.slice()), c);
        const l = core.slice();
        if (useXf) for (let k = 0; k < xf; k++) { const w = (k + 1) / xf; l[L - xf + k] = l[L - xf + k] * (1 - w) + d[pre2 - xf + k] * w; }
        else fade(l);
        loop.copyToChannel(l, c);
      });
      return { b, key, one, loop };
    }

    /** Prepara (fora do toque) os trechos dos pads editados; i = so esse pad. */
    prepSoon(i) {
      clearTimeout(this.prepTimer);
      this.prepTimer = setTimeout(() => {
        const list = i != null ? [i] : this.st.pads.map((_, k) => k);
        let d = 0;
        list.forEach(k => { if (this.buf[k]) setTimeout(() => { try { this.playBuf(k); } catch (e) { console.warn(e); } }, d++ * 20); });
      }, 150);
    }

    /** START/END/LEVEL ("se") ou TIME/BPM ("tb"): acende (e apaga a outra); de novo apaga. Pad atual vazio: "EMP". */
    sedPress(mode) {
      if (this.smp || this.delMode) return;   // REC ou DEL em curso: os knobs ficam com eles
      if (this.sed && this.sed.mode === mode) { this.sedExit(); return; }
      // face nova (o Set-up saiu): TIME/BPM sem sample para medir (pad atual vazio, ou SOURCE aceso e nada tocando) e o
      // BPM do 404 no CTRL 2 (manual p. 45 e 14/34); START/END/LEVEL com SOURCE aceso: o CTRL 3 e o nivel da fonte (p. 17)
      const glob = this.nf && mode === "tb" && (!this.buf[this.st.cur] || (this.src !== "off" && !this.playing()));
      if (!this.buf[this.st.cur] && !glob && !(mode === "se" && this.srcLevelOn())) { this.flash("EMP", "pad"); return; }
      if (this.setup) this.toggleSetup(false);
      this.endMfxPick();
      this.sed = { mode, pad: -1, base: null, knob: [0.5, 0.5], global: glob };
      this.sedSync();
      clearTimeout(this.flashTimer);
      this.render();
    }
    sedExit() { if (!this.sed) return; this.sed = null; clearTimeout(this.flashTimer); this.render(); }
    /** Algum pad tocando (voz ou Sub Pad)? */
    playing() { return !!this.roll || this.voice.some(Boolean); }

    /** Face nova com SOURCE aceso: o CTRL 3 do START/END/LEVEL ajusta a fonte escolhida (manual p. 17, "volume da entrada"). */
    srcLevelOn() { return this.nf && this.src !== "off"; }
    /** rJ = envio do RJ-2000, 950 = envio do RJ-950 (0 a 2; 1 = igual ao direto); Lin e Mix = o nivel da entrada. */
    srcLevelGet() { return this.src === "rj2000" ? this.st.sendRj / 2 : this.src === "rj950" ? this.st.send950 / 2 : this.st.inLevel; }
    srcLevelSet(v) {
      if (this.src === "rj2000") this.st.sendRj = v * 2;
      else if (this.src === "rj950") this.st.send950 = v * 2;
      else this.st.inLevel = v;
      this.applyInput();
      this.flash(String(Math.round(v * 127)), "pad");
    }

    /** O ajuste fino comeca da posicao atual do pad atual (centro do knob = como esta; manual p. 29, 31). */
    sedSync() {
      const sd = this.sed;
      if (!sd || sd.pad === this.st.cur) return;
      sd.pad = this.st.cur;
      const r = this.region(sd.pad);
      sd.base = { s: r.s, e: r.e };
      sd.knob = [0.5, 0.5];
    }
    /** Soltou o knob da tela: START/END recentra (o proximo gesto anda mais ~130 ms; "repetir o gesto", p. 31). */
    ctrlRelease(k) {
      const sd = this.sed;
      if (!sd || sd.mode !== "se" || k > 1 || !this.buf[this.st.cur]) return;
      this.sedSync();
      const r = this.region(sd.pad);
      sd.base[k ? "e" : "s"] = k ? r.e : r.s;
      sd.knob[k] = 0.5;
      const kn = this.knobs["ctrl-" + (k + 1)];
      if (kn) kn.draw();
    }

    sedGet(k) {
      const sd = this.sed, i = this.st.cur;
      this.sedSync();
      if (k === 2) return this.st.padLevel[i];
      if (sd.mode === "se") return sd.knob[k];
      if (!this.buf[i]) return 0.5;
      const r = this.region(i), p = this.st.pads[i];
      if (k === 0) {
        if (p.time == null) return 0;
        if (p.time === "ptn") return 1;
        const [lo, hi] = this.timeRange(this.sampleBpm(i, r));
        return TIME_END + (clamp(p.time, lo, hi) - lo) / (hi - lo) * (1 - 2 * TIME_END);
      }
      const list = beatList(r.e - r.s), x = list.indexOf(this.padBeats(i, r));
      return list.length > 1 && x >= 0 ? x / (list.length - 1) : 0.5;
    }

    sedSet(k, v) {
      const sd = this.sed, i = this.st.cur, p = this.st.pads[i];
      this.sedSync();
      if (k === 2) { this.st.padLevel[i] = v; this.flash(String(Math.round(v * 127)), "pad"); return; }
      if (!this.buf[i]) { this.flash("EMP", "pad"); return; }
      const r = this.region(i);
      if (sd.mode === "se") {
        sd.knob[k] = v;
        const d = (v - 0.5) * 2 * EDIT_FINE;
        if (r.len <= EDIT_MIN) { this.flash(this.secShow(k ? r.e : r.s), "pad"); return; }   // curto demais para cortar
        if (k === 0) { const s = clamp(sd.base.s + d, 0, r.e - EDIT_MIN); p.start = s > 1e-5 ? Math.round(s * 1e5) / 1e5 : 0; this.flash(this.secShow(s), "pad"); }
        else { const e = clamp(sd.base.e + d, r.s + EDIT_MIN, r.len); p.end = e >= r.len - 1e-5 ? null : Math.round(e * 1e5) / 1e5; this.flash(this.secShow(e), "pad"); }
      } else if (k === 0) {
        // TIME: esquerda alonga, direita encurta; pontas = "oFF" e "Ptn" (p. 33)
        if (v <= TIME_END) { p.time = null; this.flash("oFF", "bpm"); }
        else if (v >= 1 - TIME_END) { p.time = "ptn"; this.flash("Ptn", "bpm"); }
        else {
          const [lo, hi] = this.timeRange(this.sampleBpm(i, r));
          p.time = Math.round((lo + (v - TIME_END) / (1 - 2 * TIME_END) * (hi - lo)) * 10) / 10;
          this.flash(String(Math.round(p.time)), "bpm");
        }
      } else {
        // BPM: o calculado pelo trecho, com metade/dobro (esquerda/direita) dentro de 40-240
        const list = beatList(r.e - r.s);
        if (list.length) p.beats = list[clamp(Math.round(v * (list.length - 1)), 0, list.length - 1)];
        this.flash(String(Math.round(this.sampleBpm(i, r))), "bpm");
      }
      this.prepSoon(i);
      this.renderModes();   // MARK acende com start/end mexido e apaga nas pontas do sample (p. 31)
    }

    /** Segundos no visor de 3 digitos: "1.23", "12.3", "123". */
    secShow(t) {
      t = Math.max(0, t);
      if (t < 9.995) return t.toFixed(2);
      if (t < 99.95) return t.toFixed(1);
      return String(Math.min(999, Math.round(t)));
    }

    /* =========================================================== TAP TEMPO e DEL (face nova) */

    /** TAP TEMPO: cada toque marca o tempo; com 2 ou mais, o BPM do 404 vira a media dos intervalos (visor mostra). */
    tapDown() {
      this.tapHeld = true;
      this.tapBpm0 = this.st.bpm;   // se este toque virar Effect Grab, o tempo volta a este
      const now = performance.now();
      if (this.taps.length && now - this.taps[this.taps.length - 1] > TAP_RESET) this.taps = [];
      this.taps.push(now);
      if (this.taps.length > TAP_N + 1) this.taps.shift();
      const bpm = RJ.d4TapBpm(this.taps);
      if (bpm == null) { this.flash(String(this.st.bpm), "bpm", 1500); return; }
      this.st.bpm = bpm;
      this.tapT0 = now;   // o LED do TAP pisca a partir do ultimo toque
      this.applyBpm();
      this.flash(String(bpm), "bpm", 1500);
      this.dirty();
    }
    tapUp() { this.tapHeld = false; }

    /** Face nova, a cada 25 ms: o TAP acende no comeco de cada batida do BPM (100 ms, ou meia batida se for menos);
     *  com o TAP apertado e o bus sem efeito, o botao do ultimo efeito pisca (manual p. 19). */
    renderBlink() {
      const t = this.btn && this.btn.tap;
      if (!t) return;
      const now = performance.now(), beat = 60000 / this.st.bpm;
      const ph = ((now - this.tapT0) % beat + beat) % beat;
      t.classList.toggle("lit", !!(this.on && ph < Math.min(100, beat / 2)));
      const key = id => this.fxKey(id);
      // efeito em todos os pads (REMAIN + efeito): o botao do efeito ligado pisca (manual p. 18)
      const ak = this.on && this.hasTargets() && this.st.fxAll ? key(this.st.fx[this.st.bus]) : null;
      if (this.allFx && this.allFx !== ak) {
        const el = this.btn["fx-" + this.allFx];
        if (el) el.classList.toggle("lit", !!(this.on && key(this.st.fx[this.st.bus]) === this.allFx));
        this.allFx = null;
      }
      if (ak && this.btn["fx-" + ak]) {
        if (this.allFx !== ak) { this.allFx = ak; this.allAt = now; }
        this.btn["fx-" + ak].classList.toggle("lit", Math.floor((now - this.allAt) / 250) % 2 === 0);
      }
      const k = this.on && this.tapHeld && !this.st.fx[this.st.bus] ? key(this.lastFx) : null;
      if (this.blinkFx && this.blinkFx !== k) {
        // parou de piscar: a tecla volta ao estado dela (acesa se e o efeito do bus escolhido)
        const el = this.btn["fx-" + this.blinkFx];
        if (el) el.classList.toggle("lit", !!(this.on && key(this.st.fx[this.st.bus]) === this.blinkFx));
        this.blinkFx = null;
      }
      const el = k && this.btn["fx-" + k];
      if (!el) return;
      if (this.blinkFx !== k) { this.blinkFx = k; this.blinkAt = now; }
      el.classList.toggle("lit", Math.floor((now - this.blinkAt) / 250) % 2 === 0);   // 2 vezes por segundo, comeca aceso
    }

    /** DEL (manual p. 27): 1o toque arma ("dEL", pads com sample piscam); pads escolhem (do mesmo banco); DEL de novo apaga. */
    delPress() {
      if (this.smp) return;   // REC em espera ou gravando: DEL nao arma (CANCEL desiste do REC)
      const dm = this.delMode;
      if (!dm) {
        if (this.sed) this.sedExit();
        const b0 = this.st.bank * PADS;
        let any = false;
        for (let k = 0; k < PADS; k++) if (this.buf[b0 + k]) any = true;
        if (!any) { this.flash("EMP", "pad"); return; }
        this.endMfxPick();
        this.delMode = { sel: new Set() };
        clearTimeout(this.flashTimer);
        this.showBase();
        this.renderPads();
        return;
      }
      if (!dm.sel.size) { this.cancelDel(); return; }   // nada escolhido: DEL de novo sai sem apagar
      const sel = [...dm.sel];
      this.delMode = null;
      if (this.roll && sel.includes(this.roll.pad)) this.stopRoll();
      sel.forEach(s => this.clearPad(s));
      if (sel.includes(this.last.pad)) this.last = { pad: -1, vel: 1 };
      this.render();
      this.flash("dEL.", "pad", 700);   // o ponto aceso: apagou
    }

    /** Em DEL: o pad com sample entra ou sai da escolha (pad vazio nao faz nada). */
    delPick(s) {
      const dm = this.delMode;
      if (!dm || !this.buf[s]) return;
      if (dm.sel.has(s)) dm.sel.delete(s); else dm.sel.add(s);
      this.flash(this.padShow(s), "pad", 700);
      this.renderPads();
    }

    cancelDel() {
      if (!this.delMode) return;
      this.delMode = null;
      this.flash("---", "pad", 500);
      this.renderPads();
    }

    /** CANCEL: desiste da operacao em curso, uma por toque: REC em espera, MARK, REMAIN segurado (alvos e preselecao
     *  voltam ao de antes), DEL, SAMPLE EDIT e, por fim, a preselecao guardada. Visor "---". Nao para o REC gravando
     *  nem o Resample, e nao mexe no sequenciador (o "PATTERN STOP" do painel e da Fase 4). */
    cancelPress() {
      if (this.smp && this.smp.stage !== "rec") this.cancelSmp();
      else if (this.markOp) this.cancelMark();
      else if (this.remainHeld) this.cancelRemain();
      else if (this.delMode) this.cancelDel();
      else if (this.sed) { this.sedExit(); this.flash("---", "pad", 500); }
      else if (this.preset.some(v => v != null)) { this.preset = [null, null, null]; this.flash("---", "fx", 500); }
    }

    /* =========================================================== REC, STEREO e REMAIN (face nova, manual p. 14, 23-28) */

    /** Memoria usada, em segundos de audio mono (um sample estereo conta o dobro), mais a gravacao em curso. */
    memUsed() {
      let s = 0;
      this.buf.forEach(b => { if (b) s += b.length * b.numberOfChannels / b.sampleRate; });
      [this.smp && this.smp.r, this.stoppingSmp].forEach(r => { if (r) s += Math.min(r.len, r.max) * r.ch / r.rate; });
      return s;
    }
    /** Tempo livre em segundos para gravar com ch canais (estereo = metade). */
    memLeft(ch = 1) { return Math.max(0, MEM_SEC - this.memUsed()) / ch; }
    /** O tempo no visor (manual p. 28): ate 10 min "m.ss"; ate 100 min "mm.s" (dezenas de segundo); acima, so minutos. */
    remainShow(sec) {
      sec = Math.max(0, Math.floor(sec));
      const m = Math.floor(sec / 60), s = sec % 60;
      if (m < 10) return m + "." + String(s).padStart(2, "0");
      if (m < 100) return m + "." + Math.floor(s / 10);
      return String(Math.min(999, m));
    }
    recCh() { return this.st.stereo ? 2 : 1; }

    /** REC: 1o toque = espera (REC aceso, pads vazios piscam); pad = destino (REC pisca); REC = grava (aceso); REC = para. */
    recPress() {
      if (this.rec) { this.stopRec(); return; }   // REC tambem para o Resample (manual p. 27)
      if (this.delMode) return;                  // apagando: nao sampleia (manual p. 47)
      const sm = this.smp;
      if (!sm) {
        if (!this.worklet) { this.flash("Err", "pad"); return; }
        if (this.src === "off") { this.flash("oFF", "pad"); return; }   // sem fonte: escolher a Source antes
        if (this.emptyPad() < 0 || this.memLeft(this.recCh()) < REC_FREE) { this.flash("FuL", "pad", 1500); return; }
        this.endMfxPick();
        this.confirmDel = 0;
        this.sed = null;   // REC: o CTRL 3 vira o nivel da entrada
        this.smp = { stage: "arm", pad: -1 };
        clearTimeout(this.flashTimer);
        this.render();
        return;
      }
      if (sm.stage === "arm") { this.cancelSmp(); return; }   // REC de novo sem pad: sai
      if (sm.stage === "ready") { this.startSmp(); return; }
      if (sm.stage === "rec") this.stopSmp(false);
    }

    /** Em espera: pad vazio vira o destino (outro pad vazio troca); pad com sample nao faz nada. */
    smpPick(s) {
      if (this.buf[s] || this.recBusy(s, false)) return;   // com sample, ou ainda recebendo a gravacao anterior
      this.smp.pad = s;
      this.smp.stage = "ready";
      this.st.cur = s;
      this.render();
      this.flash(this.padShow(s), "pad", 900);
    }

    cancelSmp() {
      if (!this.smp || this.smp.stage === "rec") return;
      this.smp = null;
      this.render();
      this.flash("---", "pad", 500);
    }

    startSmp() {
      const sm = this.smp, ctx = this.g.ctx, ch = this.recCh();
      if (this.buf[sm.pad]) { sm.stage = "arm"; sm.pad = -1; this.render(); return; }   // o pad encheu na espera (arquivo solto)
      if (this.src === "off") { this.flash("oFF", "pad"); return; }
      const left = this.memLeft(ch);
      if (left < REC_FREE) { this.flash("FuL", "pad", 1500); return; }
      const node = new AudioWorkletNode(ctx, "d4-rec", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: "explicit" });
      // grava a entrada (Source) no nivel do CTRL 3, antes dos efeitos e sem os pads; o Resample grava o pos-efeito
      const r = { pad: sm.pad, node, ch, rate: ctx.sampleRate, chunks: [], len: 0, max: Math.floor(left * ctx.sampleRate) };
      node.port.onmessage = e => {
        if (e.data === "done") { this.finishSmp(r); return; }
        r.chunks.push(e.data); r.len += e.data[0].length;
        if (r.len >= r.max && this.smp && this.smp.r === r) this.stopSmp(true);   // memoria cheia: "FuL" e para sozinho
      };
      this.g.inLevel.connect(node);
      node.connect(this.g.sink);
      node.port.postMessage("start");
      sm.r = r;
      sm.stage = "rec";
      clearTimeout(this.flashTimer);
      this.render();
    }

    stopSmp(full) {
      const sm = this.smp;
      if (!sm || !sm.r) return;
      sm.r.full = !!full;
      this.smp = null;
      this.stoppingSmp = sm.r;   // entra na conta da memoria ate o "done" chegar
      sm.r.node.port.postMessage("stop");
      this.render();
    }

    finishSmp(r) {
      if (this.stoppingSmp === r) this.stoppingSmp = null;
      try { this.g.inLevel.disconnect(r.node); } catch (e) { /* ja desligado */ }
      r.node.disconnect();
      const ctx = this.g.ctx, len = Math.min(r.len, r.max);
      if (len < r.rate * REC_MIN || this.buf[r.pad]) { this.render(); this.flash(r.full ? "FuL" : "---", "pad"); return; }
      const b = ctx.createBuffer(r.ch, len, r.rate);
      const L = new Float32Array(len), R = new Float32Array(len);
      let o = 0;
      for (const c of r.chunks) { const n = Math.min(c[0].length, len - o); L.set(c[0].subarray(0, n), o); R.set(c[1].subarray(0, n), o); o += n; if (o >= len) break; }
      // STEREO apagado: L e R viram o mesmo som (manual p. 23: perde a imagem, gasta metade da memoria)
      const chans = r.ch === 2 ? [L, R] : [L.map((v, k) => (v + R[k]) * 0.5)];
      const f = Math.min(Math.floor(r.rate * 0.003), len >> 1);   // rampas de 3 ms nas pontas
      chans.forEach((d, c) => {
        for (let k = 0; k < f; k++) { d[k] *= k / f; d[len - 1 - k] *= k / f; }
        b.copyToChannel(d, c);
      });
      const name = "REC " + this.padLabel(r.pad);
      this.st.pads[r.pad] = Object.assign(newPad(), { name });
      this.setBuffer(r.pad, b, name, true);
      this.st.cur = r.pad;
      this.dirty();
      this.render();
      this.flash(r.full ? "FuL" : this.padShow(r.pad), "pad", r.full ? 1500 : 1100);
    }

    /** Abrir disquete/projeto: cancela o REC (espera ou gravando) e o Resample, inclusive o que ainda espera o "done";
     *  nada gravado cai no disquete novo. */
    abortRecs() {
      const kill = (r, from) => {
        if (!r) return;
        r.node.port.onmessage = null;   // o "done" nao chega mais: nada vira sample
        try { r.node.port.postMessage("stop"); } catch (e) { /* ja parado */ }
        try { from.disconnect(r.node); } catch (e) { /* ja desligado */ }
        r.node.disconnect();
      };
      if (!this.g) return;
      kill(this.smp && this.smp.r, this.g.inLevel); kill(this.stoppingSmp, this.g.inLevel);
      kill(this.rec, this.g.post); kill(this.stoppingRec, this.g.post);
      if (this.smp || this.rec) clearTimeout(this.flashTimer);   // o "rEC" do Resample ficava no visor
      this.smp = null; this.stoppingSmp = null; this.rec = null; this.stoppingRec = null;
    }

    /** STEREO: gravacao em 2 canais (aceso) ou mono; travado durante a gravacao. O visor mostra o tempo livre no modo novo. */
    toggleStereo() {
      if (this.smp && this.smp.stage === "rec") return;
      this.st.stereo = !this.st.stereo;
      this.applyInput();   // a escuta da entrada segue o STEREO (mono/estereo)
      this.dirty();
      this.renderButtons();
      if (this.smp) this.showBase(); else this.flash(this.remainShow(this.memLeft(this.recCh())), "pad", 1500);
    }

    /* =========================================================== REMAIN: alvo do efeito e preselecao (Fase 2d, manual p. 18-19, 28) */

    /** A pagina tem REMAIN (face nova): o efeito vale so para os pads alvo. Sem REMAIN (estavel): todos, como antes. */
    hasTargets() { return !!(this.btn && this.btn.remain); }
    /** O pad guardado s recebe o efeito? Todos (fxAll), os escolhidos (fxPads) ou so o current pad. */
    isTarget(s) {
      if (!this.hasTargets() || this.st.fxAll) return true;
      return this.st.fxPads ? this.st.fxPads.includes(s) : s === this.st.cur;
    }
    /** As vozes tocando seguem o alvo atual (cruza em ~4 ms, sem estalo). */
    retarget() {
      if (!this.g || !this.hasTargets()) return;
      const ctx = this.g.ctx;
      this.voice.forEach((v, s) => {
        if (!v || !v.w) return;
        const w = this.isTarget(s) ? 1 : 0;
        if (w === v.wet) return;
        v.wet = w;
        RJ.d4Glide(v.w.gain, w, ctx, 0.004); RJ.d4Glide(v.d.gain, 1 - w, ctx, 0.004);
      });
    }

    /** REMAIN apertado: mostra o tempo livre (mono, p. 28) e abre a escolha dos alvos / a preselecao enquanto segura. */
    remainDown() {
      const st = this.st;
      this.remainHeld = { fxAll: st.fxAll, fxPads: st.fxPads ? st.fxPads.slice() : null, preset: this.preset.slice(), used: false };
      this.flash(this.remainShow(this.memLeft(1)), "pad", 1500);
      this.renderPads();
    }
    remainUp() {
      const rh = this.remainHeld;
      if (!rh) return;
      this.remainHeld = null;
      // escolheu so o current pad: volta ao modo "current pad" (o efeito segue o pad tocado)
      // ou tirou todos (lista vazia): tambem volta ao current pad (decisao de Igor, 2d c), em vez de REMAIN aceso sem pad
      const fp = this.st.fxPads;
      if (fp && fp.length === 1 && fp[0] === this.st.cur) { this.st.fxPads = null; this.retarget(); this.dirty(); }
      else this.fxPadsTidy();
      this.renderPads(); this.renderButtons();
      Object.values(this.knobs || {}).forEach(k => k.draw());
    }
    /** Lista de alvos vazia = volta a "so o current pad" (REMAIN apaga). Com REMAIN segurado espera soltar (ainda pode escolher). */
    fxPadsTidy() {
      const st = this.st;
      if (!st.fxPads || st.fxPads.length || this.remainHeld) return;
      st.fxPads = null;
      this.retarget(); this.renderButtons(); this.dirty();
    }
    /** REMAIN + pad: o pad entra ou sai dos alvos (comeca pelo current pad). Com "todos" (botao piscando) nao muda por pad. */
    remainPick(s) {
      const st = this.st, rh = this.remainHeld;
      if (!this.buf[s]) return;   // pad vazio nao vira alvo
      rh.used = true;
      if (st.fxAll) return;
      const set = new Set(st.fxPads || [st.cur]);
      if (set.has(s)) set.delete(s); else set.add(s);
      st.fxPads = [...set];
      this.retarget();
      this.flash(this.padShow(s), "pad", 700);
      this.renderPads(); this.renderButtons();
      this.dirty();
    }
    /** REMAIN + botao de efeito: o efeito vale para todos os pads (o botao pisca); de novo volta ao current pad. */
    remainFx(id) {
      const st = this.st, b = st.bus, rh = this.remainHeld;
      rh.used = true;
      if (!this.fxAvailable(id)) { this.fxErr(id); return; }
      if (st.fx[b] !== id) { this.setFx(b, id); st.fxAll = true; }
      else st.fxAll = !st.fxAll;
      st.fxPads = null;
      this.retarget();
      clearTimeout(this.flashTimer);
      this.showBase();   // o visor mostra o efeito ("F.0n"; face nova "F.1"/"14"); "todos" e o botao piscando (o manual nao tem codigo)
      this.renderPads(); this.renderButtons();
      this.dirty();
    }
    /** CANCEL com REMAIN segurado: os alvos e a preselecao voltam ao de antes do aperto; o resto do aperto e normal. */
    cancelRemain() {
      const rh = this.remainHeld;
      if (!rh) return;
      this.st.fxAll = rh.fxAll; this.st.fxPads = rh.fxPads; this.preset = rh.preset;
      this.remainHeld = null;
      if (this.st.fxPads) { this.st.fxPads = this.st.fxPads.filter(s => this.buf[s]); this.fxPadsTidy(); }   // pad apagado no meio
      this.retarget();
      this.flash("---", "pad", 500);
      this.renderPads(); this.renderButtons();
      Object.values(this.knobs || {}).forEach(k => k.draw());
      this.dirty();
    }

    /* =========================================================== MARK: start/end ao vivo (Fase 2d, manual p. 30-32) */

    /** O pad i tem start/end marcados (trecho menor que o sample)? E o que acende o MARK (p. 31). */
    hasMarks(i) {
      if (!this.buf[i]) return false;
      const r = this.region(i);
      return r.s > 1e-5 || r.e < r.len - 1e-5;
    }
    /** Onde a voz do pad i esta agora, em segundos do sample (para frente), ou null se nao toca. */
    voicePos(i) {
      const v = this.voice[i];
      if (!v || !this.g) return null;
      const el = this.g.ctx.currentTime - v.t;
      if (el < 0) return null;
      const d = v.src.buffer.duration;
      let e = v.src.loop ? el % d : Math.min(el, d);
      // o trecho, o esticar e o Reverse de quando a voz comecou (apagar a marca ou mexer no pad tocando nao muda o audio que soa)
      const r = v.r;
      e /= v.f;
      return clamp(v.rev ? r.e - e : r.s + e, 0, r.len);
    }

    /** MARK: com o pad atual tocando, marca o start ("---", MARK pisca) e depois o end (MARK aceso); MARK aceso
     *  tocando apaga a marcacao; parado, segurar MARK e tocar o pad = so o end (start no comeco). */
    markDown() {
      this.markHeld = true;
      if (this.smp || this.rec || this.delMode) return;   // gravando ou apagando: MARK nao age
      const mo = this.markOp;
      if (mo) {
        if (mo.wait) return;                               // MARK + pad: o end so vale depois de soltar o MARK
        const pos = this.voicePos(mo.pad);
        this.markFinish(pos);                              // parou antes (One-shot acabou): o end e o fim do sample
        return;
      }
      const i = this.st.cur;
      if (!this.buf[i] || this.voice[i] == null) return;   // nada tocando: espera um pad (MARK + pad)
      if (this.hasMarks(i)) {
        // errou: MARK aceso durante a reproducao apaga a marcacao (p. 31); o pad volta a tocar inteiro no proximo toque
        Object.assign(this.st.pads[i], { start: 0, end: null });
        this.markChanged(i);
        this.flash("---", "pad", 600);
        return;
      }
      if (this.buf[i].duration <= EDIT_MIN) { this.flash("---", "pad", 500); return; }   // curto demais para cortar
      const p = this.st.pads[i];
      this.markOp = { pad: i, stage: "end", p1: this.voicePos(i), prev: { start: p.start, end: p.end }, wait: false };
      clearTimeout(this.flashTimer);
      this.render();
    }
    markUp() {
      this.markHeld = false;
      if (this.markOp && this.markOp.wait) this.markOp.wait = false;
      this.renderButtons();
    }
    /** MARK segurado + pad i: so o end (start = comeco do sample, o pad toca inteiro). false = o pad nao toca. */
    markStartEnd(i) {
      if (!this.buf[i] || this.smp || this.rec || this.delMode) return !!this.buf[i];
      if (this.buf[i].duration <= EDIT_MIN) return true;
      const p = this.st.pads[i];
      this.markOp = { pad: i, stage: "armEnd", p1: 0, prev: { start: p.start, end: p.end }, wait: true };
      Object.assign(p, { start: 0, end: null });   // toca do comeco ao fim enquanto marca
      this.markChanged(i, true);
      clearTimeout(this.flashTimer);
      return true;
    }
    /** Fecha a marcacao: start/end = os dois pontos (em ordem), a 100 ms no minimo; nas pontas do sample, sem marca. */
    markFinish(pos) {
      const mo = this.markOp;
      if (!mo) return;
      this.markOp = null;
      const i = mo.pad, b = this.buf[i];
      if (!b) { this.render(); return; }
      const len = b.duration, p2 = pos == null ? len : pos;
      let s = Math.min(mo.p1, p2), e = Math.max(mo.p1, p2);
      if (e - s < EDIT_MIN) { e = s + EDIT_MIN; if (e > len) { e = len; s = len - EDIT_MIN; } }
      const p = this.st.pads[i];
      p.start = s > 1e-3 ? Math.round(s * 1e5) / 1e5 : 0;
      p.end = e >= len - 1e-3 ? null : Math.round(e * 1e5) / 1e5;
      this.markChanged(i);
      this.flash(this.hasMarks(i) ? this.padShow(i) : "---", "pad", 900);
    }
    /** CANCEL (ou outro pad) no meio da marcacao: start/end voltam ao de antes. */
    cancelMark(quiet) {
      const mo = this.markOp;
      if (!mo) return;
      this.markOp = null;
      Object.assign(this.st.pads[mo.pad], mo.prev);
      this.markChanged(mo.pad);
      if (!quiet) this.flash("---", "pad", 500);
    }
    /** start/end do pad i mudaram: SAMPLE EDIT recomeca dali, trecho novo preparado, MARK redesenhado. */
    markChanged(i, live) {
      if (this.sed && this.sed.pad === i) this.sed.pad = -1;
      if (!live) this.prepSoon(i);
      this.dirty();
      this.render();
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
    // face nova: a tecla Shift saiu do painel; so o Shift do teclado (os knobs redesenham: Shift + Ctrl 1/2 = LO-FI)
    setShiftKey(on) { on = !!on; if (this.shiftKey === on) return; this.shiftKey = on; if (this.btn && (this.btn.shift || this.nf)) { this.renderCaps(); this.renderButtons(); } }
    shiftUsed() { this.shiftHeldUsed = true; if (this.btn.shift && !this.btn.shift.dataset.press) this.shift = false; this.renderButtons(); }

    /** Resample: grava a saida com efeito (antes do Volume) no primeiro pad vazio. Shift + Resample apaga o pad escolhido. */
    resample() {
      if (this.smp) return;   // REC da entrada em espera ou gravando: um gravador por vez
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
        this.flash(this.padShow(this.st.cur), "pad");
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
      this.stoppingRec = r;   // o pad segue reservado ate o "done" chegar
      r.node.port.postMessage("stop");
      this.renderButtons();
    }

    finishRec(r) {
      if (this.stoppingRec === r) this.stoppingRec = null;
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
      this.setBuffer(r.pad, b, "RESAMPLE " + this.padLabel(r.pad), true);
      this.st.pads[r.pad] = Object.assign(newPad(), { name: "RESAMPLE " + this.padLabel(r.pad) });
      this.st.cur = r.pad;
      this.dirty();
      this.render();   // antes do flash: o render redesenha o visor base (era o "F.03" no lugar do pad novo)
      this.flash(this.padShow(r.pad), "pad");
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
      if (this.smp && this.smp.stage === "rec") { this.flash("rEC", "pad", 600); return; }   // gravando: a fonte fica
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
      this.flash(SRC_SHOW[next]);
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
      // REC: gravando "rEC"; em espera, o tempo livre no modo escolhido (STEREO = metade)
      if (this.smp) { this.drawDisplay(this.smp.stage === "rec" ? "rEC" : this.remainShow(this.memLeft(this.recCh())), "pad"); return; }
      if (this.delMode) { this.drawDisplay("dEL", "pad"); return; }
      if (this.markOp) { this.drawDisplay("---", "pad"); return; }   // MARK: "---" ate o end (manual p. 30)
      // SAMPLE EDIT: START/END/LEVEL mostra "Edt" (sample sendo editado, p. 49); TIME/BPM mostra o BPM do sample
      if (this.sed) {
        const i = this.st.cur;
        if (this.sed.global) this.drawDisplay(String(this.st.bpm), "bpm");   // TIME/BPM do 404 (face nova)
        else if (!this.buf[i]) this.drawDisplay(this.sed.mode === "se" && this.srcLevelOn() ? SRC_SHOW[this.src] : "EMP", "pad");
        else if (this.sed.mode === "se") this.drawDisplay("Edt", "pad");
        else this.drawDisplay(String(Math.round(this.sampleBpm(i))), "bpm");
        return;
      }
      const f = this.curFx();
      if (!this.setup && f) this.drawDisplay(this.fxShow(f), "fx");
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
      b.classList.toggle("lit", !!(this.on && on));   // face nova: a tecla inteira acende
      const box = b.closest(".d4-fxk, .r42-bk");
      const l = box && box.querySelector("i.led");
      if (l) { l.classList.toggle("on", !!(this.on && (on || blink))); l.classList.toggle("blink", !!(this.on && blink && !on)); }
    }

    renderButtons() {
      if (!this.btn) return;
      const st = this.st, b = st.bus, other = b === 1 ? 2 : 1;
      const cur = st.fx[b], oth = st.fx[other];
      const fxBtn = id => this.fxKey(id);
      const face = this.root && this.root.dataset.face === "dcx";
      ["filter", "pitch", "isolator", "delay", "vinyl", "djfx", "mfx"].forEach(k => {
        const el = this.btn["fx-" + k];
        if (!el) return;
        const on = cur && fxBtn(cur) === k, bl = oth && fxBtn(oth) === k;
        this.led("fx-" + k, on, bl);
        // face nova: .down so enquanto o dedo aperta (aceso e .lit); a estavel afunda a tecla ligada
        el.classList.toggle("down", (!face && !!(this.on && on)) || !!(el.dataset.press || el.dataset.midi));
      });
      this.led("bus-1", b === 1, b !== 1 && !!st.fx[1]);
      this.led("bus-2", b === 2, b !== 2 && !!st.fx[2]);
      this.led("mute", st.mute);
      this.led("hold", st.hold);
      this.led("subpad", !!this.roll);
      this.led("resample", !!this.rec, !!this.rec);
      if (this.btn.resample) {
        this.btn.resample.classList.toggle("blink", !!(this.on && this.rec));
        const bx = this.btn.resample.closest(".r42-bk"), l = bx && bx.querySelector("i.led");
        if (this.rec && l) l.classList.add("blink");
      }
      this.led("in-source", this.src !== "off");
      this.led("del", !!this.delMode);
      // REC: aceso em espera e gravando (e no Resample), pisca com o pad escolhido; STEREO aceso = 2 canais
      const sm = this.smp;
      this.led("rec", !!(sm || this.rec));
      if (this.btn.rec) this.btn.rec.classList.toggle("blink", !!(this.on && sm && sm.stage === "ready"));
      this.led("stereo", this.st.stereo);
      this.led("start-end", !!(this.sed && this.sed.mode === "se"));
      this.led("time-bpm", !!(this.sed && this.sed.mode === "tb"));
      this.led("remain", !st.fxAll && !!st.fxPads);   // REMAIN aceso = o efeito esta em varios pads escolhidos
      for (let k = 0; k < BANKS && BANKS > 1; k++) this.led("bank-" + BANK_NAMES[k].toLowerCase(), k === st.bank);
      this.renderModes();
      this.renderMfxList();
      // teclas que ficam "presas": Set-up e Shift
      const held = el => !!(el.dataset.press || el.dataset.midi);   // ponteiro ou MIDI (Learn) segurando
      if (this.btn.setup) this.btn.setup.classList.toggle("down", this.setup || held(this.btn.setup));
      if (this.btn.shift) this.btn.shift.classList.toggle("down", this.shift || this.shiftKey || held(this.btn.shift));
      Object.keys(this.btn).forEach(id => {
        if (id.startsWith("fx-") || id === "setup" || id === "shift") return;
        const el = this.btn[id];
        el.classList.toggle("down", held(el));
      });
      this.renderBlink();   // led() acabou de redesenhar o .lit: o pisca do TAP e do ultimo efeito volta por cima
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
      // MARK: aceso = o pad atual tem start/end marcados; pisca marcando (p. 30-31)
      const mo = this.markOp;
      this.led("mark", !!mo || this.hasMarks(this.st.cur));
      if (this.btn.mark) this.btn.mark.classList.toggle("blink", !!(this.on && mo));
    }

    renderPads() {
      if (!this.padEls) return;
      this.retarget();
      const dm = this.delMode, sm = this.smp, wait = sm && sm.stage !== "rec";
      const rh = this.remainHeld && !dm && !wait;
      this.padEls.forEach((el, t) => {
        const i = this.slotOf(t);
        (el.closest(".pcol") || el).classList.toggle("used", !!this.buf[i]);
        if (rh) {
          // REMAIN segurado: os alvos do efeito acesos (todos: os pads com sample); o current pad pisca (manual p. 18-19)
          el.classList.toggle("hit", !!this.buf[i] && this.isTarget(i));
          el.classList.toggle("blink", !this.st.fxAll && i === this.st.cur && !!this.buf[i]);
        } else {
          // DEL: pads com sample piscam (aceso + .blink); os escolhidos ficam acesos sem piscar
          // REC em espera: os pads vazios piscam; o escolhido fica aceso (e segue aceso gravando)
          el.classList.toggle("hit", dm ? !!this.buf[i] : wait ? !this.buf[i] : !!this.voice[i] || (this.nf ? this.mfxPadLit(t) : this.mfxPick && t < 4) || !!(sm && sm.pad === i));
          el.classList.toggle("blink", !!(dm && this.buf[i] && !dm.sel.has(i)) || !!(wait && !this.buf[i] && sm.pad !== i));
        }
        el.title = this.st.pads[i].name || "";
        el.setAttribute("aria-label", "Pad " + this.padLabel(i) + (this.st.pads[i].name ? ": " + this.st.pads[i].name : this.buf[i] ? "" : " (vazio)"));
      });
    }

    renderCaps() {
      if (!this.root) return;
      const f = this.curFx();
      let caps = this.lofiPage() ? ["Lo Bits", "Lo Rate", "–"] : this.sendPage() ? ["Snd 2000", "Snd 950", "–"] : this.setup ? ["BPM", "Roll", "Pad Lvl"] : f ? f.caps : ["–", "–", "–"];
      if (this.sed && !this.setup) caps = this.sed.mode === "se" ? ["Start", "End", "Level"] : ["Time", "BPM", caps[2]];
      if (this.smp) caps = [caps[0], caps[1], "Level"];
      $$("[data-cap]", this.root).forEach((el, k) => { el.textContent = caps[k]; });
      Object.values(this.knobs || {}).forEach(k => k.draw());
    }
  };

  RJ.D404.VERSION = VERSION;
  RJ.D404.PADS = PADS; RJ.D404.BANKS = BANKS; RJ.D404.SLOTS = SLOTS;
})();
