/* DCX 404 - Pattern Sequencer (face nova, Fase 4 / B1)
 *
 * O sequenciador do SP-404 OG (manual p. 34-37): um pattern e uma performance de pads gravada em tempo real,
 * presa a um pad de um banco de patterns (aqui 5 bancos A-E x 12 pads = 60 patterns, como os pads da face nova;
 * os bancos de pattern sao independentes dos de sample, p. 34). BPM global (o st.bpm do 404, p. 34), 96 ticks por
 * seminima (p. 52), 1 a 99 compassos de 4/4, quantize na gravacao (4, 4-3, 8, 8-3, 16, 16-3, 32, oFF; p. 35),
 * contagem de 1 compasso antes de gravar, gravacao em loop com overdub, rehearsal ("rEH").
 *
 * Sem DOM: o relogio (now), o BPM, o tocar e o metronomo chegam por callbacks, entao da para testar com um
 * relogio simulado (tick(now) chamado a mao) e um OfflineAudioContext. Quem liga isto a face e novo/js/sequencer-ui.js.
 *
 * Estado (st.seq do 404, versionado):
 *   { v: 1, bank: 0..4, quant: "16", metro: 0..1,
 *     pats: { "<n>": { len: compassos, ev: [ { t: tick 0..len*384-1, s: pad guardado 0..59, l: ticks ou null } ] } } }
 *   n = banco do pattern * 12 + pad (0..59); s = o sample tocado (qualquer banco); l = quanto o pad ficou apertado
 *   (so vale para pad em Gate, sem Hold); ev em ordem de t.
 */
window.RJ = window.RJ || {};

(function () {
  "use strict";
  const RJ = window.RJ;
  const PPQ = 96, BEATS = 4, BAR = PPQ * BEATS;   // 96 ticks por seminima (p. 52), compasso 4/4 (ESTIMATIVA: o manual nao fala em outra formula)
  const MAX_NOTES = 8000;                         // ~8.000 notas na memoria (p. 52); passou disso: "FuL" e nao grava
  const LOOK = 0.12;                              // s: o agendador marca as notas ate 120 ms a frente
  const LEAD = 0.03;                              // s: o pattern comeca 30 ms depois do toque (tempo de marcar a 1a nota)
  // QUANTIZE (p. 35): g = grade em ticks; 0 = oFF (o tick do dedo). O visor tem 3 digitos: "16-3" vira "16.3"
  const QUANT = [
    { id: "4", show: "4", g: 96 }, { id: "4-3", show: "4-3", g: 64 }, { id: "8", show: "8", g: 48 }, { id: "8-3", show: "8-3", g: 32 },
    { id: "16", show: "16", g: 24 }, { id: "16-3", show: "16.3", g: 16 }, { id: "32", show: "32", g: 12 }, { id: "oFF", show: "oFF", g: 0 },
  ];
  const QDEF = "16";                              // ESTIMATIVA: o manual nao diz o quantize ao ligar
  // LENGTH (p. 35): 1 a 20 de 1 em 1, acima de 4 em 4, ate 99
  const LENGTHS = [];
  for (let k = 1; k <= 20; k++) LENGTHS.push(k);
  for (let k = 24; k < 99; k += 4) LENGTHS.push(k);
  LENGTHS.push(99);
  const LDEF = 1;                                 // ESTIMATIVA: compassos de um pattern novo (o exemplo da p. 44 usa 2)
  const METRO0 = 0.6;                             // nivel do metronomo de fabrica (0-1)
  const qOf = id => QUANT.find(q => q.id === id) || QUANT.find(q => q.id === QDEF);
  const int = v => (typeof v === "number" && isFinite(v) ? Math.round(v) : NaN);

  /** O st.seq limpo (estado/disquete de qualquer versao, ou nada): campos fora da faixa caem no padrao, notas ruins saem. */
  function clean(d, slots = 60, banks = 5) {
    const out = { v: 1, bank: 0, quant: QDEF, metro: METRO0, pats: {} };
    if (!d || typeof d !== "object") return out;
    const b = int(d.bank);
    if (b >= 0 && b < banks) out.bank = b;
    if (QUANT.some(q => q.id === d.quant)) out.quant = d.quant;
    if (typeof d.metro === "number" && isFinite(d.metro)) out.metro = Math.max(0, Math.min(1, d.metro));
    let total = 0;
    const pats = d.pats && typeof d.pats === "object" ? d.pats : {};
    Object.keys(pats).sort((a, c) => a - c).forEach(key => {
      const n = int(+key), p = pats[key];
      if (!(n >= 0 && n < slots) || !p || typeof p !== "object") return;
      const len = Math.max(1, Math.min(99, int(p.len) || LDEF));
      const L = len * BAR, ev = [];
      (Array.isArray(p.ev) ? p.ev : []).forEach(e => {
        if (!e || total >= MAX_NOTES) return;
        const t = int(e.t), s = int(e.s), l = e.l == null ? null : int(e.l);
        if (!(t >= 0 && t < L) || !(s >= 0 && s < slots)) return;
        ev.push({ t, s, l: l > 0 ? Math.min(l, L) : null });
        total++;
      });
      ev.sort((x, y) => x.t - y.t || x.s - y.s);
      if (ev.length) out.pats[n] = { len, ev };   // pattern sem nota = pad sem pattern
    });
    return out;
  }

  /** Quantos ticks a nota tocada no tick n (continuo) vira com a grade g (0 = oFF: o tick inteiro mais perto). */
  function quantize(n, g) { return g ? Math.round(n / g) * g : Math.round(n); }

  /** Total de notas guardadas (todos os patterns). */
  function noteCount(seq) { let c = 0; Object.values(seq.pats).forEach(p => { c += p.ev.length; }); return c; }

  /**
   * O relogio do sequenciador. o = {
   *   now(): hora do AudioContext (s); bpm(): o BPM do 404; data(): o st.seq (limpo) atual;
   *   play(s, when, ev): toca o pad guardado s na hora when e devolve a voz (ou null);
   *   off(s, when, voz): solta a nota (Gate) na hora when; cut(lista de { s, v, when }, agora): para o que o pattern tocou;
   *   click(when, forte): o metronomo; change(o que, ...): avisa a tela (troca de pattern, parou) }
   * Modos: "idle"; "play" (tocando key em loop; next = reservado); "ready" (gravacao em espera: so o metronomo);
   * "rec" (contagem com o tick < 0, depois gravando em loop; reh = rehearsal).
   * O tempo e ancorado: o tick absoluto a.tick acontece em a.time, e cada tick dura a.spt s; mudar o BPM re-ancora
   * no instante atual (o que ja tocou nao muda). Tick absoluto: 0 = comeco do pattern, cresce sem voltar (passada =
   * floor(tick / L)); a nota de tick t toca em passada * L + t.
   */
  class Seq {
    constructor(o) {
      this.o = o;
      this.mode = "idle";
      this.key = -1; this.next = -1;
      this.reh = false;
      this.recLen = LDEF; this.minLen = 1; this.isNew = false;
      this.a = { time: 0, tick: 0, spt: 0.01 };
      this.bpm = 0;
      this.sched = 0;                 // tick absoluto ate onde ja foi marcado (exclusivo)
      this.voices = [];               // { s, v, when }: as vozes que o pattern pos para tocar
      this.offs = [];                 // { s, v, when }: notas Gate esperando a hora de soltar
      this.open = new Map();          // pad guardado -> { ev, n0 }: nota sendo gravada (pad ainda apertado)
      this.skip = new WeakMap();      // nota -> passada em que ela nao toca (o dedo ja tocou ao vivo)
      this.timer = 0;
    }

    /* ---------------------------------------- tempo */
    spt(bpm) { return 60 / (bpm * PPQ); }
    anchor(time, tick) { this.bpm = this.o.bpm(); this.a = { time, tick, spt: this.spt(this.bpm) }; }
    tickAt(t) { return this.a.tick + (t - this.a.time) / this.a.spt; }
    timeAt(n) { return this.a.time + (n - this.a.tick) * this.a.spt; }
    pat(k = this.key) { const d = this.o.data(); return (d && d.pats[k]) || null; }
    /** Ticks do pattern em uso (gravando: o comprimento escolhido no LENGTH). */
    lenTicks() { const p = this.pat(); return (p ? p.len : this.recLen) * BAR; }
    quant() { const d = this.o.data(); return qOf(d && d.quant); }

    /* ---------------------------------------- tocar (p. 13, 34) */
    /** Toca o pattern k ja (do comeco). false se o pad nao tem pattern. */
    start(k, now = this.o.now()) {
      const p = this.pat(k);
      if (!p || !p.ev.length) return false;
      if (this.mode === "rec" || this.mode === "ready") this.stopRec(now);
      if (this.mode === "play") this.halt(now);   // troca na hora: o que o antigo ja marcou a frente nao toca por cima
      this.mode = "play"; this.key = k; this.next = -1;
      this.anchor(now + LEAD, 0); this.sched = 0;
      this.run(); this.tick(now);
      return true;
    }
    /** Reserva o proximo: entra quando o atual acaba (fim do loop). Um so reservado; o ultimo vale. */
    reserve(k) { if (this.mode === "play" && this.pat(k)) this.next = k === this.key ? -1 : k; }
    /** PATTERN STOP: para o loop; as notas marcadas no futuro nao tocam e o pad em Loop para (ESTIMATIVA). */
    stop(now = this.o.now()) {
      if (this.mode === "idle") return;
      if (this.mode === "rec" || this.mode === "ready") { this.stopRec(now); return; }
      this.mode = "idle"; this.key = -1; this.next = -1;
      this.halt(now);
      this.o.change && this.o.change("stop");
    }
    halt(now) {
      clearInterval(this.timer); this.timer = 0;
      const vs = this.voices; this.voices = []; this.offs = [];
      if (this.o.cut) this.o.cut(vs, now);
    }

    /* ---------------------------------------- gravar (p. 34-35) */
    /** Espera da gravacao no pad k (pattern novo ou overdub): o metronomo comeca; LENGTH e QUANTIZE valem aqui. */
    ready(k, now = this.o.now()) {
      if (this.mode !== "idle") this.stop(now);
      const p = this.pat(k);
      this.key = k; this.next = -1; this.isNew = !p;
      this.recLen = p ? p.len : LDEF; this.minLen = p ? p.len : 1;   // um pattern existente nao fica mais curto (p. 35)
      this.mode = "ready"; this.reh = false;
      this.anchor(now + LEAD, 0); this.sched = 0;
      this.run(); this.tick(now);
    }
    /** LENGTH (so na espera): compassos, preso a LENGTHS e ao minimo do pattern existente. Devolve o valor. */
    setLen(bars) {
      if (this.mode !== "ready") return this.recLen;
      let v = LENGTHS.reduce((b, x) => (Math.abs(x - bars) < Math.abs(b - bars) ? x : b), LENGTHS[0]);
      if (v < this.minLen) v = this.minLen;
      this.recLen = v;
      return v;
    }
    /** REC na espera: contagem de 1 compasso (-4..-1, o tocado nela nao grava) e a gravacao em loop. */
    rec(now = this.o.now()) {
      if (this.mode !== "ready") return false;
      const d = this.o.data();
      if (!d.pats[this.key]) d.pats[this.key] = { len: this.recLen, ev: [] };
      else d.pats[this.key].len = Math.max(d.pats[this.key].len, this.recLen);
      this.mode = "rec"; this.reh = false;
      // a contagem comeca depois do ultimo clique ja marcado da espera (senao dois cliques quase juntos)
      const lastClick = Math.ceil(this.sched / PPQ) * PPQ - PPQ;
      const t0 = Math.max(now + LEAD, this.sched > 0 ? this.timeAt(lastClick) + this.a.spt * PPQ * 0.5 : 0);
      this.anchor(t0, -BAR); this.sched = -BAR;
      this.tick(now);
      return true;
    }
    /** Nota tocada ao vivo (pad guardado s): grava no tick do quantize do momento. null fora da gravacao,
     *  na contagem ou no rehearsal; "full" sem memoria. */
    hit(s, now = this.o.now()) {
      if (this.mode !== "rec" || this.reh) return null;
      const n = this.tickAt(now);
      if (n < 0) return null;   // contagem: nao grava (p. 35)
      const d = this.o.data(), p = d.pats[this.key];
      if (!p) return null;
      const L = p.len * BAR, q = quantize(n, this.quant().g);
      const pass = Math.floor(q / L), t = q - pass * L;
      let ev = p.ev.find(e => e.t === t && e.s === s);   // o mesmo pad no mesmo tick (quantize): uma nota so
      if (!ev) {
        if (noteCount(d) >= MAX_NOTES) return "full";
        ev = { t, s, l: null };
        let at = p.ev.length;
        while (at > 0 && p.ev[at - 1].t > t) at--;
        p.ev.splice(at, 0, ev);
      }
      this.skip.set(ev, pass);   // o dedo ja tocou: esta passada nao toca a nota de novo
      this.open.set(s, { ev, n0: n });
      return ev;
    }
    /** Soltou o pad s gravando: a duracao da nota (ticks, minimo 1, no maximo o pattern). */
    release(s, now = this.o.now()) {
      const o = this.open.get(s);
      if (!o) return;
      this.open.delete(s);
      const p = this.pat();
      if (!p || this.mode !== "rec") return;
      o.ev.l = Math.max(1, Math.min(p.len * BAR, Math.round(this.tickAt(now) - o.n0)));
    }
    /** Para a gravacao (CANCEL): pattern novo sem nota some. Devolve { key, notes } do que ficou. */
    stopRec(now = this.o.now()) {
      const k = this.key, d = this.o.data();
      const wasRec = this.mode === "rec";
      if (wasRec) this.open.forEach((o, s) => this.release(s, now));   // pad ainda apertado: a nota fecha no CANCEL
      this.mode = "idle"; this.key = -1; this.next = -1; this.reh = false;
      this.open.clear(); this.skip = new WeakMap();
      this.halt(now);
      const p = d && d.pats[k];
      if (p && !p.ev.length) delete d.pats[k];
      this.o.change && this.o.change("stop");
      return { key: k, notes: p && d.pats[k] ? p.ev.length : 0 };
    }

    /* ---------------------------------------- agendador */
    run() { if (!this.timer && this.o.timer !== false) this.timer = setInterval(() => this.tick(), 25); }

    /** Marca tudo o que cai ate now + LOOK: notas (play/rec com tick >= 0), metronomo (ready/rec), troca reservada. */
    tick(now = this.o.now()) {
      if (this.mode === "idle") return;
      if (this.o.bpm() !== this.bpm) this.anchor(now, this.tickAt(now));   // BPM mudou: o resto segue o novo tempo
      const hT = now + (this.o.look ? this.o.look() : LOOK);   // aba em segundo plano: o timer anda de ~1 s em 1 s, a olhada cresce
      for (let guard = 0; guard < 256; guard++) {
        const h = this.tickAt(hT), from = this.sched;
        if (from >= h) break;
        if (this.mode === "ready") { this.beats(from, h); this.sched = h; break; }
        if (from < 0) { const to = Math.min(h, 0); this.beats(from, to); this.sched = to; continue; }   // contagem
        const p = this.pat();
        if (!p) { if (this.mode === "play") this.stop(now); break; }   // o pattern sumiu (estado novo)
        const L = p.len * BAR, pass = Math.floor(from / L), end = (pass + 1) * L, to = Math.min(h, end);
        if (this.mode === "rec") this.beats(from, to);
        this.notes(p, pass * L, from, to, pass);
        this.sched = to;
        if (to >= end && this.mode === "play" && this.next >= 0 && this.pat(this.next)) {
          // reservado: entra no fim da passada; o tick 0 dele cai na hora do fim desta
          const t = this.timeAt(end);
          this.key = this.next; this.next = -1;
          this.anchor(t, 0); this.sched = 0;
          this.o.change && this.o.change("switch", this.key, t);
        }
      }
      // notas Gate: solta na hora (marca ate LOOK a frente, como as notas)
      if (this.offs.length) {
        const due = this.offs.filter(x => x.when < hT);
        if (due.length) { this.offs = this.offs.filter(x => x.when >= hT); due.forEach(x => this.o.off && this.o.off(x.s, x.when, x.v)); }
      }
      if (this.voices.length > 64) this.voices = this.voices.filter(x => x.when > now - 30).slice(-64);
    }
    notes(p, base, from, to, pass) {
      for (const ev of p.ev) {
        const n = base + ev.t;
        if (n < from) continue;
        if (n >= to) break;
        if (this.skip.get(ev) === pass) continue;
        const when = this.timeAt(n), v = this.o.play(ev.s, when, ev);
        if (v) {
          this.voices.push({ s: ev.s, v, when });
          if (ev.l != null) this.offs.push({ s: ev.s, v, when: this.timeAt(n + ev.l) });
        }
      }
    }
    beats(from, to) {
      if (!this.o.click) return;
      for (let n = Math.ceil(from / PPQ) * PPQ; n < to; n += PPQ) this.o.click(this.timeAt(n), ((n % BAR) + BAR) % BAR === 0, n);
    }

    /** Onde o relogio esta agora: { mode, key, next, tick, beat (contagem: -4..-1), bar, reh }. */
    pos(now = this.o.now()) {
      const n = this.mode === "idle" ? 0 : this.tickAt(now);
      const L = this.mode === "ready" ? BAR : this.lenTicks();
      return { mode: this.mode, key: this.key, next: this.next, reh: this.reh, tick: n,
        count: this.mode === "rec" && n < 0 ? -Math.min(BEATS, Math.floor(-n / PPQ - 1e-9) + 1) : 0,   // antes do 1o tempo (LEAD) ja e -4
        bar: n >= 0 ? Math.floor((n % L) / BAR) + 1 : 0, beat: n >= 0 ? Math.floor((n % BAR) / PPQ) + 1 : 0 };
    }
  }

  RJ.D4Seq = Seq;
  Object.assign(Seq, { PPQ, BEATS, BAR, MAX_NOTES, LOOK, LEAD, QUANT, QDEF, LENGTHS, LDEF, METRO0, clean, quantize, noteCount, qOf });
})();
