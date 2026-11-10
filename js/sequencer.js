/* DCX 404 - Pattern Sequencer (face nova, Fase 4 / B1-B3)
 *
 * O sequenciador do SP-404 OG (manual p. 34-37): um pattern e uma performance de pads gravada em tempo real,
 * presa a um pad de um banco de patterns (aqui 5 bancos A-E x 12 pads = 60 patterns, como os pads da face nova;
 * os bancos de pattern sao independentes dos de sample, p. 34). BPM global (o st.bpm do 404, p. 34), 96 ticks por
 * seminima (p. 52), 1 a 99 compassos de 4/4, quantize na gravacao (4, 4-3, 8, 8-3, 16, 16-3, 32, oFF; p. 35),
 * contagem de 1 compasso antes de gravar, gravacao em loop com overdub, rehearsal ("rEH").
 * B2 (p. 36-37): apagar notas gravando ("ErS": segurar o pad ou o HOLD), apagar patterns ("dEL"), apagar a memoria
 * ("dAL") e trocar dois patterns de pad ("CHG"), com "EMP", "Prt" (banco protegido) e "FuL".
 * B3: troca reservada (um so reservado, o ultimo pad vale; sem lista/song, p. 13 e 34) e os patterns no disquete
 * (load: o st.seq de um disquete de qualquer versao, com o que ficou de fora).
 *
 * Sem DOM: o relogio (now), o BPM, o tocar e o metronomo chegam por callbacks, entao da para testar com um
 * relogio simulado (tick(now) chamado a mao) e um OfflineAudioContext. Quem liga isto a face e novo/js/sequencer-ui.js.
 *
 * Estado (st.seq do 404, versionado):
 *   { v: 1, bank: 0..4, quant: "16", metro: 0..1, prot: [bancos de pattern protegidos, 0..4],
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
    const out = { v: 1, bank: 0, quant: QDEF, metro: METRO0, prot: [], pats: {} };
    if (!d || typeof d !== "object") return out;
    const b = int(d.bank);
    if (b >= 0 && b < banks) out.bank = b;
    if (QUANT.some(q => q.id === d.quant)) out.quant = d.quant;
    if (typeof d.metro === "number" && isFinite(d.metro)) out.metro = Math.max(0, Math.min(1, d.metro));
    // Protect (p. 43): de fabrica o OG protege o banco A; aqui comeca sem protecao (ESTIMATIVA/decisao: o 404 ainda nao
    // tem o gesto de ligar segurando REMAIN; protegido de fabrica, o pattern recem-gravado no A nao sairia)
    if (Array.isArray(d.prot)) out.prot = [...new Set(d.prot.map(int).filter(x => x >= 0 && x < banks))].sort();
    let total = 0;
    const pats = d.pats && typeof d.pats === "object" ? d.pats : {};
    Object.keys(pats).filter(k => /^\d+$/.test(k)).sort((a, c) => a - c).forEach(key => {   // so chave "0".."59" (nada de "", "0x10", "1e1")
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

  /**
   * Os patterns de um disquete (B3): devolve { seq (limpo), why, pats, notes }. why: null (formato desta face: v 1 com
   * 12 pads por banco, ou sem "pads"), "none" (disquete sem patterns: a memoria fica vazia, como o Load do OG, p. 40),
   * "p16" (patterns de 16 pads por banco, o plano do 404 de 16 pads: os pads 13-16 e os bancos alem do E saem),
   * "ver" (outra versao: nao abre os patterns), "bad" (campo ilegivel). pats/notes = patterns e notas que ficaram de
   * fora (fora da faixa, pattern sem nota, memoria de notas estourada).
   */
  function load(raw, slots = 60, banks = 5, pads = 12) {
    const empty = () => clean(null, slots, banks);
    if (raw === undefined || raw === null) return { seq: empty(), why: "none", pats: 0, notes: 0 };
    if (typeof raw !== "object" || Array.isArray(raw)) return { seq: empty(), why: "bad", pats: 0, notes: 0 };
    const pin = raw.pats && typeof raw.pats === "object" ? raw.pats : {};
    let inPats = 0, inNotes = 0;
    Object.keys(pin).forEach(k => { const p = pin[k]; const n = p && Array.isArray(p.ev) ? p.ev.length : 0; if (n) { inPats++; inNotes += n; } });
    if (raw.v !== 1) return { seq: empty(), why: "ver", pats: inPats, notes: inNotes };
    const per = raw.pads === undefined ? pads : int(raw.pads);
    let src = raw, why = null;
    if (per !== pads) {
      if (!(per > 0 && per <= 16)) return { seq: empty(), why: "bad", pats: inPats, notes: inNotes };
      // outro numero de pads por banco: o pattern do banco b, pad t vai para o mesmo banco e pad aqui (sobra = fora);
      // as notas guardam o pad guardado do sample, que vem igual aos samples (o pad guardado i continua i)
      const pm = {};
      Object.keys(pin).filter(k => /^\d+$/.test(k)).forEach(k => {
        const n = int(+k), b = Math.floor(n / per), t = n - b * per;
        if (n >= 0 && t < pads && b < banks) pm[b * pads + t] = pin[k];
      });
      src = Object.assign({}, raw, { pats: pm });
      why = "p16";
    }
    const seq = clean(src, slots, banks);
    const outNotes = noteCount(seq), outPats = Object.keys(seq.pats).length;
    return { seq, why, per, pats: inPats - outPats, notes: inNotes - outNotes };
  }

  /** Quantos ticks a nota tocada no tick n (continuo) vira com a grade g (0 = oFF: o tick inteiro mais perto). */
  function quantize(n, g) { return g ? Math.round(n / g) * g : Math.round(n); }

  /** Total de notas guardadas (todos os patterns). */
  function noteCount(seq) { let c = 0; Object.values(seq.pats).forEach(p => { c += p.ev.length; }); return c; }

  /* ---------------------------------------- apagar e trocar (p. 36-37), sobre o st.seq; pads = 12 por banco */
  const isProt = (seq, bank) => !!(seq.prot && seq.prot.includes(bank));
  /** Apaga os patterns da lista: "EMP" se nenhum tem pattern, "Prt" se algum esta num banco protegido (nada muda), ou o numero apagado. */
  function delPats(seq, keys, pads = 12) {
    const ks = keys.filter(k => seq.pats[k]);
    if (!ks.length) return "EMP";
    if (ks.some(k => isProt(seq, Math.floor(k / pads)))) return "Prt";
    ks.forEach(k => { delete seq.pats[k]; });
    return ks.length;
  }
  /** Apaga a memoria inteira (dAL): "EMP" vazia, "Prt" se um banco protegido tem pattern (nada muda), ou o numero apagado. */
  function delAll(seq, pads = 12) { return delPats(seq, Object.keys(seq.pats).map(Number), pads); }
  /** Troca os patterns dos pads a e b (b pode ser vazio): "EMP" (a vazio), "Prt", "FuL" (memoria de notas estourada), ou true. */
  function swapPats(seq, a, b, pads = 12, max = MAX_NOTES) {
    if (!seq.pats[a]) return "EMP";
    if (isProt(seq, Math.floor(a / pads)) || isProt(seq, Math.floor(b / pads))) return "Prt";
    if (noteCount(seq) > max) return "FuL";   // memoria unica no DCX: a troca nao gasta nota; so se ja passou do limite
    if (a === b) return true;
    const pa = seq.pats[a], pb = seq.pats[b];
    seq.pats[b] = pa;
    if (pb) seq.pats[a] = pb; else delete seq.pats[a];
    return true;
  }

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
      this.ers = new Map();           // ErS: pad guardado (ou "all" = HOLD) -> tick absoluto ate onde ja apagou
      this.sw = null;                 // troca tardia marcada (reserva nos ultimos ~120 ms): { at, key, a, bpm, end }; o antigo soa ate at
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
    /** Reserva o proximo: entra quando o atual acaba (fim do loop). Um so reservado; o ultimo vale.
     *  Nos ultimos ~120 ms do loop o agendador ja marcou o comeco da proxima passada do atual: desmarca e troca no fim. */
    reserve(k, now = this.o.now()) {
      if (!(this.mode === "play" && this.pat(k))) return;
      if (this.sw && this.sw.at > now) {   // troca tardia ja marcada: o mesmo pad = nada; outro = desfaz e reserva este (o ultimo vale)
        if (k === this.key) return;
        this.unswitch(now);
      }
      this.next = k === this.key ? -1 : k;
      if (this.next < 0) return;
      if (this.o.bpm() !== this.bpm) this.anchor(now, this.tickAt(now));   // como no tick: o BPM mudou desde a ultima marcacao
      const L = this.lenTicks(), n = this.tickAt(now), end = (Math.floor(n / L) + 1) * L;
      if (this.sched <= end) return;   // o fim ainda nao foi marcado: a troca acontece no tick()
      const tE = this.timeAt(end), late = this.voices.filter(x => x.n >= end);   // pelo tick (o BPM pode ter mudado)
      if (late.length) {
        const cut = new Set(late.map(x => x.v));
        this.voices = this.voices.filter(x => !cut.has(x.v));
        this.offs = this.offs.filter(x => !cut.has(x.v));
        if (this.o.cut) this.o.cut(late, now);
      }
      this.sw = { at: tE, key: this.key, a: this.a, bpm: this.bpm, end };
      this.key = this.next; this.next = -1;
      this.anchor(tE, 0); this.sched = 0;
      this.o.change && this.o.change("switch", this.key, tE);
      this.tick(now);
    }
    /** Desfaz a troca tardia (antes da hora dela): o novo nao toca, o antigo segue do fim desta passada. */
    unswitch(now = this.o.now()) {
      const w = this.sw;
      if (!w) return;
      this.sw = null;
      const late = this.voices.filter(x => x.when >= w.at - 1e-6);
      if (late.length) {
        const cut = new Set(late.map(x => x.v));
        this.voices = this.voices.filter(x => !cut.has(x.v));
        this.offs = this.offs.filter(x => !cut.has(x.v));
        if (this.o.cut) this.o.cut(late, now);
      }
      this.key = w.key; this.next = -1;
      this.a = w.a; this.bpm = w.bpm; this.sched = w.end;
      this.o.change && this.o.change("switch", this.key, now);
      this.tick(now);
    }
    /** O pattern que se ouve agora (a troca tardia ainda nao chegou: o antigo); -1 parado. */
    playing(now = this.o.now()) { return this.mode !== "play" ? -1 : this.sw && this.sw.at > now ? this.sw.key : this.key; }
    /** O que entra no fim do loop (reservado, ou a troca tardia ja marcada); -1 nenhum. */
    pending(now = this.o.now()) { return this.mode !== "play" ? -1 : this.sw && this.sw.at > now ? this.key : this.next; }
    /** PATTERN STOP: para o loop; as notas marcadas no futuro nao tocam e o pad em Loop para (ESTIMATIVA). */
    stop(now = this.o.now()) {
      if (this.mode === "idle") return;
      if (this.mode === "rec" || this.mode === "ready") { this.stopRec(now); return; }
      this.mode = "idle"; this.key = -1; this.next = -1;
      this.halt(now);
      this.o.change && this.o.change("stop");
    }
    halt(now) {
      clearInterval(this.timer); this.timer = 0; this.sw = null;
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
    /* ---------------------------------------- ErS: apagar notas gravando (p. 36, 44) */
    /** Comeca a apagar as notas do pad guardado s (ou de todos, s = "all": o HOLD) enquanto estiver segurado. */
    ersOn(s, now = this.o.now()) {
      if (this.mode !== "rec" || this.ers.has(s)) return false;
      this.ers.set(s, this.tickAt(now));
      // o que o agendador ja marcou a frente desse pad nao toca (e some no apagar)
      const late = this.voices.filter(x => x.when > now + 1e-4 && (s === "all" || x.s === s));
      if (late.length) {
        const cut = new Set(late.map(x => x.v));
        this.voices = this.voices.filter(x => !cut.has(x.v));
        this.offs = this.offs.filter(x => !cut.has(x.v));
        if (this.o.cut) this.o.cut(late, now);
      }
      return true;
    }
    /** Soltou: apaga ate agora e devolve o que o agendador pulou a frente (de agora ate o marcado), que nao foi apagado. */
    ersOff(s, now = this.o.now()) {
      if (!this.ers.has(s)) return 0;
      const gone = this.ersSweep(now, s);
      this.ers.delete(s);
      const p = this.pat();
      if (p && this.mode === "rec" && this.sched > 0) {
        const L = p.len * BAR, a0 = this.tickAt(now), a = Math.max(0, a0), b = this.sched;
        for (let base = Math.floor(a / L) * L; base < b; base += L) {
          for (const ev of p.ev) {
            const n = base + ev.t;
            if (n <= a0 || n >= b || !(s === "all" || ev.s === s) || this.erasing(ev.s)) continue;
            if (this.skip.get(ev) === Math.floor(n / L)) continue;
            const when = this.timeAt(n), v = this.o.play(ev.s, when, ev);
            if (v) { this.voices.push({ s: ev.s, v, when, n }); if (ev.l != null) this.offs.push({ s: ev.s, v, when: this.timeAt(n + ev.l) }); }
          }
        }
      }
      return gone;
    }
    erasing(s) { return this.ers.size > 0 && (this.ers.has("all") || this.ers.has(s)); }
    /** Apaga as notas do trecho segurado (do ultimo apagar ate agora; da a volta no loop). Devolve quantas sairam. */
    ersSweep(now = this.o.now(), only) {
      const p = this.pat();
      if (!p || !this.ers.size) return 0;
      const L = p.len * BAR, b = this.tickAt(now);
      let gone = 0;
      this.ers.forEach((a0, s) => {
        if (only !== undefined && s !== only) return;
        const a = Math.max(0, a0);
        this.ers.set(s, Math.max(a0, b));
        if (b < a) return;   // contagem: ainda nao ha o que apagar
        const all = b - a >= L, ta = a - Math.floor(a / L) * L, tb = b - Math.floor(b / L) * L;
        const inWin = t => all || (ta <= tb ? t >= ta && t <= tb : t >= ta || t <= tb);
        const before = p.ev.length;
        p.ev = p.ev.filter(e => !((s === "all" || e.s === s) && inWin(e.t)));
        gone += before - p.ev.length;
      });
      return gone;
    }

    /** Para a gravacao (CANCEL): pattern novo sem nota some. Devolve { key, notes } do que ficou. */
    stopRec(now = this.o.now()) {
      const k = this.key, d = this.o.data();
      const wasRec = this.mode === "rec";
      if (wasRec) this.open.forEach((o, s) => this.release(s, now));   // pad ainda apertado: a nota fecha no CANCEL
      if (wasRec && this.ers.size) this.ersSweep(now);                  // apagando no CANCEL: apaga ate aqui
      this.ers.clear();
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
      if (this.sw && this.sw.at <= now) this.sw = null;   // a troca tardia chegou
      if (this.o.bpm() !== this.bpm) {   // BPM mudou: o resto segue o novo tempo
        this.anchor(now, this.tickAt(now));
        if (this.sw) this.sw.at = this.timeAt(0);   // troca tardia: o novo comeca na hora nova
      }
      const hT = now + (this.o.look ? this.o.look() : LOOK);   // aba em segundo plano: o timer anda de ~1 s em 1 s, a olhada cresce
      for (let guard = 0; guard < 256; guard++) {
        const h = this.tickAt(hT), from = this.sched;
        if (from >= h) break;
        if (this.mode === "ready") { this.beats(from, h); this.sched = h; break; }
        if (from < 0) { const to = Math.min(h, 0); this.beats(from, to); this.sched = to; continue; }   // contagem
        const p = this.pat();
        if (!p) { if (this.mode === "play") this.stop(now); break; }   // o pattern sumiu (estado novo)
        if (this.ers.size) this.ersSweep(now);   // ErS segurado: apaga o trecho que ja passou
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
      // so as velhas saem (por quantidade nao: o ErS e a reserva tardia cortam as marcadas a frente pela lista)
      if (this.voices.length > 64) this.voices = this.voices.filter(x => x.when > now - 30);
    }
    notes(p, base, from, to, pass) {
      for (const ev of p.ev) {
        const n = base + ev.t;
        if (n < from) continue;
        if (n >= to) break;
        if (this.skip.get(ev) === pass) continue;
        if (this.erasing(ev.s)) continue;   // ErS segurado: a nota nao toca (e sai no apagar)
        const when = this.timeAt(n), v = this.o.play(ev.s, when, ev);
        if (v) {
          this.voices.push({ s: ev.s, v, when, n });
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
  Object.assign(Seq, { PPQ, BEATS, BAR, MAX_NOTES, LOOK, LEAD, QUANT, QDEF, LENGTHS, LDEF, METRO0, clean, quantize, noteCount, qOf,
    isProt, delPats, delAll, swapPats, load });
})();
