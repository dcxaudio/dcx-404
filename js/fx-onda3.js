/*
 * DCX-404 · Onda 3a da face nova (so /novo/ carrega este arquivo): MFX 2 Tape Echo, 15 Noise Gen,
 * 21 C.Canceler e 22 Subsonic, com os codigos e parametros do manual do SP-404 (p. 20-22).
 * Codigo proprio (GPL-3.0, como o resto do DCX). Registra no RJ.D4FX como o fx.js faz; a pagina
 * estavel e o Studio nao carregam este arquivo, entao o som deles nao muda.
 *
 * Tape Echo e C.Canceler sao nos nativos. Noise Gen e Subsonic usam um worklet proprio (d4-onda3),
 * que entra junto com o do fx.js: o RJ.d4LoadWorklets e embrulhado para carregar os dois.
 * O RJ.Tape (dcx-core) nao esta carregado na /novo/: o Tape Echo tem wow/flutter e saturacao proprios.
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  if (!RJ || !RJ.D4FX || !RJ.d4LoadWorklets) { console.warn("fx-onda3.js: carregue depois do fx.js"); return; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const glide = RJ.d4Glide;
  const db = x => Math.pow(10, x / 20);
  const exp = (v, a, b) => a * Math.pow(b / a, v);
  const bal = v => [Math.min(1, 2 * (1 - v)), Math.min(1, 2 * v)];   // [direto, efeito]: centro = os dois cheios

  /* ================================================================ worklet */
  const W3 = `
  // teto suave: igual ate 0,9; acima encosta em 0,99 (nunca passa)
  const knee = y => { const a = Math.abs(y); return a <= 0.9 ? y : Math.sign(y) * (0.9 + 0.09 * Math.tanh((a - 0.9) / 0.09)); };
  /* mode 0 NOISE GEN: p0 cor (0 branco, 0,5 rosa, 1 marrom), p1 estalos de disco por segundo, p2 nivel do ruido.
     mode 1 SUBSONIC: p0 frequencia da senoide (Hz), p1 limiar (linear), p2 balance (0 direto .. 1 senoide).
     Os valores andam em rampa de ~10 ms. "rst" mudou = zera ruidos, envelope e fase (o efeito liga limpo). */
  class D4Onda3 extends AudioWorkletProcessor {
    static get parameterDescriptors() { return ["p0", "p1", "p2", "rst"].map(name => ({ name, defaultValue: 0, automationRate: "k-rate" })); }
    constructor(o) {
      super();
      this.mode = (o && o.processorOptions && o.processorOptions.mode) | 0;
      this.k = 1 - Math.exp(-1 / (0.01 * sampleRate));
      this.seed = 0x2545F491; this.rs = 0; this.s = null;
      this.reset();
    }
    reset() {
      this.pk = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]]; this.br = [0, 0];
      this.ck = 0; this.ca = 0; this.cl = 1;
      this.env = 0; this.amp = 0; this.gate = 0; this.ph = 0;
    }
    rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 2147483648 - 1; }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, sr = sampleRate;
      if (P.rst[0] !== this.rs) { this.rs = P.rst[0]; this.reset(); }
      const T = [P.p0[0], P.p1[0], P.p2[0]];
      for (let i = 0; i < 3; i++) if (!(T[i] > -1e6 && T[i] < 1e6)) T[i] = 0;
      if (!this.s) this.s = T.slice();
      const s = this.s, k = this.k, L = inp[0] || [], R = inp[1] || inp[0] || [];
      const oL = out[0], oR = out[1] || out[0];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < 3; i++) s[i] += (T[i] - s[i]) * k;
        let xl = L[j] || 0, xr = R[j] || 0;
        if (!(xl > -8 && xl < 8)) xl = 0;
        if (!(xr > -8 && xr < 8)) xr = 0;
        let yl, yr;
        if (this.mode === 0) {
          const c = Math.min(1, Math.max(0, s[0])), lv = Math.max(0, s[2]);
          // estalo de disco: impulso curto que cai, sinal trocando ao acaso (igual nos dois lados, como o disco)
          let cr = 0;
          if (this.ck <= 0 && this.rnd() * 0.5 + 0.5 < Math.max(0, s[1]) / sr) { this.cl = 8 + Math.floor((this.rnd() * 0.5 + 0.5) * 32); this.ck = this.cl; this.ca = (0.3 + (this.rnd() * 0.5 + 0.5) * 0.3) * (this.rnd() < 0 ? -1 : 1); }
          if (this.ck > 0) { cr = this.ca * (this.ck / this.cl) * (0.4 + 0.6 * Math.abs(this.rnd())); this.ck--; }
          const y = [0, 0];
          for (let ch = 0; ch < 2; ch++) {
            const w = this.rnd(), b = this.pk[ch];
            b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852;
            b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898;
            const pink = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) / 1.73; b[6] = w * 0.115926;
            this.br[ch] = (this.br[ch] + 0.02 * w) / 1.02;
            const white = w / 0.577, brown = this.br[ch] / 0.0572;   // os tres com o mesmo RMS (1)
            const col = c < 0.5 ? white + (pink - white) * (c * 2) : pink + (brown - pink) * (c * 2 - 1);
            y[ch] = lv * (0.15 * col + cr);
          }
          yl = xl + y[0]; yr = xr + y[1];
        } else {
          // envelope (pico): sobe em ~0,5 ms, cai em ~60 ms
          const a = Math.max(Math.abs(xl), Math.abs(xr));
          this.env += (a - this.env) * (a > this.env ? 1 - Math.exp(-1 / (0.0005 * sr)) : 1 - Math.exp(-1 / (0.06 * sr)));
          const thr = Math.max(1e-5, s[1]);
          // portao com histerese: abre acima do limiar, fecha abaixo de 0,7 x limiar
          if (this.env > thr) { if (!this.gate && this.amp < 1e-4) this.ph = 0; this.gate = 1; }
          else if (this.env < thr * 0.7) this.gate = 0;
          const tgt = this.gate ? this.env : 0;
          this.amp += (tgt - this.amp) * (1 - Math.exp(-1 / (0.002 * sr)));
          if (this.amp < 1e-9) this.amp = 0;   // sem denormal
          const sub = Math.sin(2 * Math.PI * this.ph) * this.amp * 0.8;
          this.ph += Math.max(0, s[0]) / sr; if (this.ph >= 1) this.ph -= 1;
          const m = Math.min(1, Math.max(0, s[2])), gd = Math.min(1, 2 * (1 - m)), gw = Math.min(1, 2 * m);
          yl = gd * xl + gw * sub; yr = gd * xr + gw * sub;
        }
        if (this.env < 1e-12) this.env = 0;
        oL[j] = knee(yl); if (oR !== oL) oR[j] = knee(yr);
      }
      return true;
    }
  }
  registerProcessor("d4-onda3", D4Onda3);
  `;

  const ok3 = new WeakMap();
  const base = RJ.d4LoadWorklets;
  /** O loader do fx.js carrega tambem o d4-onda3. O resultado continua sendo o do fx.js. Falha parcial aceita de
   *  proposito: se so o nosso falhar, os outros efeitos seguem e Noise Gen e Subsonic ligam como passagem direta
   *  (sem "Err" no visor; aviso no console). */
  RJ.d4LoadWorklets = function (ctx) {
    const a = base(ctx);
    if (!ok3.has(ctx)) {
      let p;
      if (!ctx.audioWorklet) p = Promise.resolve(false);
      else {
        const url = URL.createObjectURL(new Blob([W3], { type: "application/javascript" }));
        p = ctx.audioWorklet.addModule(url).then(() => true, e => { console.warn("AudioWorklet da Onda 3 nao carregou", e); return false; })
          .finally(() => URL.revokeObjectURL(url));
      }
      ok3.set(ctx, p.then(v => { ok3.set(ctx, v); return v; }));
    }
    return Promise.all([a, ok3.get(ctx)]).then(r => r[0]);
  };

  /* ================================================================ os mapas 0-1 -> unidade (os testes leem daqui) */
  RJ.d4Onda3 = {
    tape: { time: v => exp(v, 0.5, 0.06), fb: v => 1.0 * v, mix: bal },           // s (REPEAT RATE: direita = fita rapida = eco curto)
    noise: { color: v => v, rate: v => 40 * v * v, level: v => v * v },              // estalos/s; nivel (1 = ruido em -16,5 dB RMS)
    sub: { freq: v => exp(v, 25, 150), thr: v => db(-50 + 44 * v), mix: v => v },  // Hz; limiar de -50 a -6 dBFS
    cc: { lr: v => [db(Math.min(0, v - 0.5) * 24), db(Math.min(0, 0.5 - v) * 24)], lo: v => 2 * v, hi: v => 2 * v },
  };
  const O3 = RJ.d4Onda3;

  // teto suave num WaveShaper: igual ate 0,9, chega a 0,972 em 1 (o WaveShaper so le -1..1: acima disso fica em 0,972)
  const KNEE = (() => {
    const c = new Float32Array(4097);
    for (let i = 0; i < c.length; i++) { const x = i / 2048 - 1, a = Math.abs(x); c[i] = a <= 0.9 ? x : Math.sign(x) * (0.9 + 0.09 * Math.tanh((a - 0.9) / 0.09)); }
    return c;
  })();
  const knee = ctx => { const w = ctx.createWaveShaper(); w.curve = KNEE; return w; };
  // saturacao de fita no laco: tanh(2,4u)/2,4 para u em -1..1 (ganho 1 no sinal baixo, teto ~0,42: as repeticoes
  // de um som alto saem comprimidas, como fita cheia; o laco nunca dispara). O primeiro eco nao passa por ela
  const SAT = (() => {
    const c = new Float32Array(4097);
    for (let i = 0; i < c.length; i++) { const x = (i / 2048 - 1) * 2; c[i] = Math.tanh(1.2 * x) / 1.2 / 2; }
    return c;
  })();

  /** 2. Tape Echo: REPEAT RATE (rAt), INTENSITY (int, Effect Limit), BALANCE (bAL).
   *  entrada -> porta -> DelayNode (wow 0,6 Hz + flutter 6,5 Hz no tempo) -> porta do laco -> cabeca (passa-baixa 6 kHz) -> eco
   *  e, no laco: passa-baixa 3,2 kHz + passa-altas 120 Hz + saturacao -> INTENSITY -> de volta ao DelayNode.
   *  Cada repeticao passa de novo pelos filtros: perde agudo e grave a cada volta (o eco de fita).
   *  Ao sair do bus o laco esvazia; ao religar, nada da vez anterior volta (a porta so abre depois de o resto sair). */
  function tapeEcho(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const dry = ctx.createGain(), inG = ctx.createGain(), d = ctx.createDelay(2), gate = ctx.createGain();
    const head = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
    const sat = ctx.createWaveShaper(), fb = ctx.createGain(), wet = ctx.createGain(), sum = ctx.createGain(), top = knee(ctx);
    head.type = "lowpass"; head.frequency.value = 6000; head.Q.value = -3.01;
    lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = -3.01;
    hp.type = "highpass"; hp.frequency.value = 120; hp.Q.value = -3.01;
    sat.curve = SAT; sat.oversample = "2x";   // o RJ.Tape (dcx-core) nao esta carregado na /novo/: saturacao propria
    input.connect(dry).connect(sum);
    input.connect(inG).connect(d).connect(gate);
    gate.connect(head).connect(wet).connect(sum);
    gate.connect(lp).connect(hp).connect(sat).connect(fb).connect(d);
    sum.connect(top).connect(output);
    // wow e flutter: dois senos no tempo do atraso (juntos, ate ~+-11 cents)
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), w1 = ctx.createGain(), w2 = ctx.createGain();
    o1.frequency.value = 0.6; o2.frequency.value = 6.5; w1.gain.value = 0.0009; w2.gain.value = 0.0001;
    o1.connect(w1).connect(d.delayTime); o2.connect(w2).connect(d.delayTime); o1.start(); o2.start();
    const born = ctx.currentTime;
    // openAt: quando a porta abriu (ou vai abrir); Tpk: o maior atraso desde o ultimo religar (o atraso real escorrega)
    let T = O3.tape.time(0.35), offAt = -1, openAt = 0, wasOpen = true, Tpk = T;
    return {
      input, output,
      set(i, v) {
        v = clamp(v, 0, 1);
        if (i === 0) {
          T = O3.tape.time(v); Tpk = Math.max(Tpk, T, d.delayTime.value);
          // ao montar o tempo entra direto; depois a fita muda de velocidade devagar (o tom escorrega, como no eco de fita)
          if (ctx.currentTime === born) { d.delayTime.cancelScheduledValues(born); d.delayTime.setValueAtTime(T, born); } else glide(d.delayTime, T, ctx, 0.08);
        }
        if (i === 1) glide(fb.gain, O3.tape.fb(v), ctx);
        if (i === 2) { const [a, b] = O3.tape.mix(v); glide(dry.gain, a, ctx); glide(wet.gain, b, ctx); }
      },
      active(a) {
        const now = ctx.currentTime;
        if (!a) {
          // a porta estava aberta (ou com abertura agendada que ja passou) neste instante?
          wasOpen = openAt <= now;
          offAt = now;
          glide(inG.gain, 0, ctx);
          // o D4Slot fecha o molhado em ~0,1 s: entao a porta fecha e o laco para de girar
          gate.gain.cancelScheduledValues(now); gate.gain.setValueAtTime(wasOpen ? 1 : 0, now); gate.gain.setValueAtTime(0, now + 0.12);
          return;
        }
        glide(inG.gain, 1, ctx);
        gate.gain.cancelScheduledValues(now);
        // primeira vez, ou religado com o eco aberto ainda saindo (o molhado velho nao chegou a sumir): segue aberta
        if (offAt < 0 || (wasOpen && now - offAt < 0.12)) { gate.gain.setValueAtTime(1, now); openAt = now; Tpk = T; return; }
        // o que ainda esta na fita (entrou ate offAt + 0,12) sai ate offAt + 0,12 + o maior atraso desde entao (o Rate
        // escorrega devagar; + wow); a porta abre depois disso, antes do primeiro eco novo (que so sai em now + T)
        openAt = Math.max(now, offAt + 0.12 + Tpk + 0.001 + 0.01);
        gate.gain.setValueAtTime(0, now); gate.gain.setValueAtTime(1, openAt);
        Tpk = T;
      },
      dispose() { try { o1.stop(); o2.stop(); } catch (e) { /* ja parado */ } },
    };
  }

  /** Um efeito do worklet d4-onda3. map[i] = [parametro, funcao 0-1 -> unidade] do Ctrl i. */
  function o3Fx(mode, map) {
    return function (ctx) {
      if (ok3.get(ctx) !== true) {   // o worklet nao carregou: passagem direta (o som nao muda)
        console.warn("d4-onda3 indisponivel: efeito sem som");
        const g = ctx.createGain();
        return { input: g, output: g, set() {} };
      }
      const node = new AudioWorkletNode(ctx, "d4-onda3", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { mode },
      });
      const P = k => node.parameters.get(k);
      let rst = 0, offAt = -1;
      return {
        input: node, output: node,
        set(i, v) { const m = map[i]; if (m) P(m[0]).setValueAtTime(m[1](clamp(v, 0, 1)), ctx.currentTime); },
        // ao entrar no bus: ruidos, envelope e fase do comeco (religado em menos de 0,1 s o molhado velho ainda sai: nao zera)
        active(a) {
          if (!a) { offAt = ctx.currentTime; return; }
          if (offAt < 0 || ctx.currentTime - offAt > 0.1) P("rst").setValueAtTime(++rst, ctx.currentTime);
        },
      };
    };
  }
  /** 15. Noise Gen: COLOR (CoL), QUALITY (qLt: estalos de disco), LEVEL (LEV). Soma o ruido ao som (insercao). */
  const noiseGen = o3Fx(0, [["p0", O3.noise.color], ["p1", O3.noise.rate], ["p2", O3.noise.level]]);
  /** 22. Subsonic: PITCH (Pit), THRESHOLD (tHr), BALANCE (bAL). Senoide grave que segue o envelope acima do limiar. */
  const subsonic = o3Fx(1, [["p0", O3.sub.freq], ["p1", O3.sub.thr], ["p2", O3.sub.mix]]);

  /** 21. C.Canceler: L-R BALANCE (L-r), LOW BOOST (Lo), HIGH BOOST (Hi).
   *  S = a.L - b.R (o que esta igual nos dois lados some); sai S na esquerda e -S na direita (inversao de fase).
   *  L-r: centro = a = b = 1; para um lado reduz ate -12 dB o peso daquele canal (cancela o que esta um pouco fora do centro).
   *  Lo e Hi devolvem os graves (< 150 Hz) e agudos (> 5 kHz) do meio (L+R)/2, que o cancelamento tirou (bumbo, baixo, pratos).
   *  Mono (L = R) com Lo e Hi em 0 vira silencio. */
  function cCanceler(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    input.channelCount = 2; input.channelCountMode = "explicit"; input.channelInterpretation = "speakers";
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
    const ga = ctx.createGain(), gb = ctx.createGain(), S = ctx.createGain(), inv = ctx.createGain();
    const mL = ctx.createGain(), M = ctx.createGain(), lo = ctx.createGain(), hi = ctx.createGain(), top = knee(ctx);
    S.channelCount = 1; S.channelCountMode = "explicit"; M.channelCount = 1; M.channelCountMode = "explicit";
    inv.gain.value = -1; mL.gain.value = 0.5;
    input.connect(sp);
    sp.connect(ga, 0); sp.connect(gb, 1);
    ga.connect(S); gb.connect(S); gb.gain.value = -1;
    S.connect(mg, 0, 0); S.connect(inv).connect(mg, 0, 1);
    sp.connect(mL, 0); sp.connect(mL, 1); mL.connect(M);
    const bq = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = -3.01; return b; };
    const l1 = bq("lowpass", 150), l2 = bq("lowpass", 150), h1 = bq("highpass", 5000), h2 = bq("highpass", 5000);
    M.connect(l1).connect(l2).connect(lo); M.connect(h1).connect(h2).connect(hi);
    const sum = ctx.createGain();
    mg.connect(sum); lo.connect(sum); hi.connect(sum);   // lo e hi sao mono: entram iguais nos dois lados
    sum.connect(top).connect(output);
    return {
      input, output,
      set(i, v) {
        v = clamp(v, 0, 1);
        if (i === 0) { const [a, b] = O3.cc.lr(v); glide(ga.gain, a, ctx); glide(gb.gain, -b, ctx); }
        if (i === 1) glide(lo.gain, O3.cc.lo(v), ctx);
        if (i === 2) glide(hi.gain, O3.cc.hi(v), ctx);
      },
    };
  }

  /* ================================================================ registro (como no fx.js: m = o numero do MFX) */
  const add = [
    { id: "tapeecho", m: 2, name: "Tape Echo", caps: ["Rate", "Intensity", "Balance"], codes: ["rAt", "int", "bAL"], def: [0.35, 0.45, 0.5], lim: { 1: [0, 0.7] }, make: tapeEcho },
    { id: "noisegen", m: 15, name: "Noise Gen", caps: ["Color", "Quality", "Level"], codes: ["CoL", "qLt", "LEV"], def: [0.5, 0.3, 0.5], lim: { 1: [0, 0.7], 2: 0.75 }, make: noiseGen, worklet: true },
    { id: "ccancel", m: 21, name: "C.Canceler", caps: ["L-R Bal", "Low", "High"], codes: ["L-r", "Lo", "Hi"], def: [0.5, 0.5, 0.25], make: cCanceler },
    { id: "subsonic", m: 22, name: "Subsonic", caps: ["Pitch", "Thresh", "Balance"], codes: ["Pit", "tHr", "bAL"], def: [0.7, 0.4, 0.5], make: subsonic, worklet: true },
  ];
  add.forEach(f => { if (!RJ.D4FX.byId(f.id) && !RJ.D4FX.byM(f.m)) RJ.D4FX.push(f); });
})();
