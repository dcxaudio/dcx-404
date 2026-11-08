/* DCX 404 - efeitos
 *
 * Os 9 efeitos da v0.1, em Web Audio. Cada um e uma fabrica make(ctx, env) que
 * devolve { input, output, set(i, v), active(on), bpm(b), dispose() }:
 *   i       0, 1 ou 2 (Ctrl 1-3); v de 0 a 1
 *   active  o efeito entrou ou saiu do bus (o Looper e o Stopper capturam ai)
 *   bpm     o tempo mudou (Delay, Looper)
 * O output ja traz o seco quando o efeito e de mistura (Delay, Reverb).
 *
 * DJFX Looper, Stopper/Back Spin, Lo-fi e a gravacao do Resample rodam num
 * AudioWorklet. O codigo do worklet esta aqui mesmo (WORKLET) e entra por um
 * Blob, para o aparelho funcionar em qualquer pagina (solo ou Studio) sem
 * depender do caminho do arquivo.
 *
 * RJ.D4Slot: o lugar de um efeito num bus. Liga e desliga com rampas curtas
 * (seco e molhado cruzam em ~20 ms), para nao estalar.
 */
window.RJ = window.RJ || {};

(function () {
  "use strict";
  const RJ = window.RJ;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TC = 0.006; // constante de tempo das rampas (s): ~20 ms ate assentar

  /**
   * Muda um AudioParam sem degrau, a partir de agora (ou de "at").
   * Cancelar um setTargetAtTime com cancelScheduledValues faz o valor voltar de uma vez
   * ao de antes (estalo); por isso segura o valor atual antes de mudar.
   */
  function hold(p, t) {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
  }
  function glide(p, v, ctx, tc = TC, at = 0) {
    const t = Math.max(ctx.currentTime, at);
    hold(p, ctx.currentTime);
    p.setTargetAtTime(v, t, tc);
  }
  RJ.d4Glide = glide;
  const db = x => Math.pow(10, x / 20);
  const exp = (v, a, b) => a * Math.pow(b / a, v); // 0..1 -> a..b em escala log

  /* ================================================================ worklet */
  const WORKLET = `
  const fade = 64;
  function rd(buf, N, p) {           // leitura com interpolacao linear num anel de N amostras
    const i = Math.floor(p), f = p - i;
    const a = ((i % N) + N) % N, b = (a + 1) % N;
    return buf[a] + (buf[b] - buf[a]) * f;
  }

  /* DJFX Looper: grava sempre os ultimos 4 s. Ao ligar (on), copia o anel e toca os
     ultimos "len" segundos em loop, na velocidade "speed" (-1 a 1; negativo = de tras
     para frente). As pontas do loop tem uma rampa de 64 amostras. */
  class D4Looper extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: "len", defaultValue: 0.25, minValue: 0.005, maxValue: 4, automationRate: "k-rate" },
      { name: "speed", defaultValue: 1, minValue: -2, maxValue: 2, automationRate: "k-rate" },
      { name: "on", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ]; }
    constructor() {
      super();
      this.N = Math.ceil(sampleRate * 4);
      this.ring = [new Float32Array(this.N), new Float32Array(this.N)];
      this.loop = [new Float32Array(this.N), new Float32Array(this.N)];
      this.w = 0; this.p = 0; this.on = false; this.mix = 0;
    }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, N = this.N;
      const on = P.on[0] >= 0.5;
      const len = Math.max(32, Math.min(N - 2, Math.round(P.len[0] * sampleRate)));
      const speed = P.speed[0];
      if (on && !this.on) {
        // o loop: o anel em ordem, do mais antigo ao mais novo
        for (let c = 0; c < 2; c++) {
          const r = this.ring[c], l = this.loop[c];
          l.set(r.subarray(this.w), 0);
          l.set(r.subarray(0, this.w), N - this.w);
        }
        this.p = 0;
      }
      this.on = on;
      for (let k = 0; k < n; k++) {
        const target = on ? 1 : 0;
        if (this.mix !== target) this.mix = target > this.mix ? Math.min(1, this.mix + 1 / 256) : Math.max(0, this.mix - 1 / 256);
        let r = this.p % len; if (r < 0) r += len;
        const g = Math.min(1, r / fade, (len - r) / fade);
        const base = N - len;
        for (let c = 0; c < out.length; c++) {
          const x = (inp[c] || inp[0] || [])[k] || 0;
          this.ring[c & 1][this.w] = x;
          let y = x;
          if (this.mix > 0) {
            const i = Math.floor(r), f = r - i;
            const l = this.loop[c & 1];
            const a = l[base + i], b = l[base + Math.min(i + 1, len - 1)];
            y = x * (1 - this.mix) + (a + (b - a) * f) * g * this.mix;
          }
          out[c][k] = y;
        }
        this.w = (this.w + 1) % N;
        if (this.mix > 0) this.p = r + speed;
      }
      return true;
    }
  }
  registerProcessor("d4-looper", D4Looper);

  /* Stopper / Back Spin: grava sempre os ultimos 8 s. Ao ligar, a leitura sai do
     "agora" e a velocidade cai ate 0 no tempo "time" (freio de toca-discos) ou comeca
     em -3 e volta a 0 (giro para tras). Ao desligar, o som ao vivo volta com rampa. */
  class D4Stopper extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: "time", defaultValue: 0.8, minValue: 0.05, maxValue: 4, automationRate: "k-rate" },
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "on", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ]; }
    constructor() {
      super();
      this.N = Math.ceil(sampleRate * 8);
      this.ring = [new Float32Array(this.N), new Float32Array(this.N)];
      this.w = 0; this.wa = 0; this.rp = 0; this.t = 0; this.on = false; this.mix = 0; this.spin = false;
    }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, N = this.N;
      const on = P.on[0] >= 0.5;
      if (on && !this.on) { this.rp = this.wa; this.t = 0; this.spin = P.mode[0] >= 0.5; }
      this.on = on;
      const T = Math.max(1, P.time[0] * sampleRate);
      for (let k = 0; k < n; k++) {
        const target = on ? 1 : 0;
        if (this.mix !== target) this.mix = target > this.mix ? Math.min(1, this.mix + 1 / 128) : Math.max(0, this.mix - 1 / 512);
        let rate = 0, amp = 0;
        if (this.mix > 0) {
          const x = this.t / T;
          if (x < 1) {
            if (this.spin) { rate = -3 * (1 - x) * (1 - x); amp = Math.pow(1 - x, 0.7); }
            else { rate = Math.pow(1 - x, 1.6); amp = Math.min(1, (1 - x) * 12); }
          }
          this.t++;
        }
        for (let c = 0; c < out.length; c++) {
          const x = (inp[c] || inp[0] || [])[k] || 0;
          this.ring[c & 1][this.w] = x;
          let y = x;
          if (this.mix > 0) y = x * (1 - this.mix) + (amp ? rd(this.ring[c & 1], N, this.rp) * amp : 0) * this.mix;
          out[c][k] = y;
        }
        this.w = (this.w + 1) % N; this.wa++;
        if (this.mix > 0) this.rp = Math.max(this.wa - N + 4, Math.min(this.wa - 1, this.rp + rate));
      }
      return true;
    }
  }
  registerProcessor("d4-stopper", D4Stopper);

  /* Lo-fi / Bit Crush: segura a amostra por "down" amostras (taxa menor) e reduz
     para "bits" bits. */
  class D4Crush extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "down", defaultValue: 4, minValue: 1, maxValue: 64, automationRate: "k-rate" },
    ]; }
    constructor() { super(); this.h = [0, 0]; this.c = 0; }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length;
      const steps = Math.pow(2, P.bits[0] - 1), down = P.down[0];
      for (let k = 0; k < n; k++) {
        this.c += 1;
        const take = this.c >= down;
        if (take) this.c -= down;
        for (let c = 0; c < out.length; c++) {
          if (take) { const x = (inp[c] || inp[0] || [])[k] || 0; this.h[c & 1] = Math.round(x * steps) / steps; }
          out[c][k] = this.h[c & 1];
        }
      }
      return true;
    }
  }
  registerProcessor("d4-crush", D4Crush);

  /* Gravador do Resample: manda blocos de ~0,1 s pela porta enquanto grava. */
  class D4Rec extends AudioWorkletProcessor {
    constructor() {
      super(); this.on = false; this.buf = null; this.i = 0;
      this.port.onmessage = e => {
        if (e.data === "start") { this.on = true; this.fresh(); }
        if (e.data === "stop") { this.flush(); this.on = false; this.port.postMessage("done"); }
      };
    }
    fresh() { this.buf = [new Float32Array(4096), new Float32Array(4096)]; this.i = 0; }
    flush() { if (this.buf && this.i) this.port.postMessage([this.buf[0].slice(0, this.i), this.buf[1].slice(0, this.i)]); this.fresh(); }
    process(inputs, outputs) {
      if (!this.on) return true;
      const inp = inputs[0] || [], n = 128;
      for (let k = 0; k < n; k++) {
        this.buf[0][this.i] = (inp[0] || [])[k] || 0;
        this.buf[1][this.i] = (inp[1] || inp[0] || [])[k] || 0;
        if (++this.i === 4096) this.flush();
      }
      return true;
    }
  }
  registerProcessor("d4-rec", D4Rec);
  `;

  const loaded = new WeakMap();
  /** Carrega o worklet uma vez por AudioContext. Devolve true se deu certo. */
  RJ.d4LoadWorklets = function (ctx) {
    if (loaded.has(ctx)) return loaded.get(ctx);
    let p;
    if (!ctx.audioWorklet) p = Promise.resolve(false);
    else {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      p = ctx.audioWorklet.addModule(url).then(() => true, e => { console.warn("AudioWorklet do 404 nao carregou", e); return false; })
        .finally(() => URL.revokeObjectURL(url));
    }
    loaded.set(ctx, p);
    return p;
  };

  function workletNode(ctx, name, params) {
    const n = new AudioWorkletNode(ctx, name, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
      parameterData: params || {},
    });
    return n;
  }

  /* ================================================================ os 9 efeitos */

  // notas do Delay e do Looper, em tempos (1 = uma seminima)
  const DELAY_NOTES = [1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 3 / 4, 1, 3 / 2, 2];
  const LOOP_NOTES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
  const pick = (list, v) => list[Math.round(clamp(v, 0, 1) * (list.length - 1))];

  /** 1. Filter+Drive: passa-baixa com ressonancia e saturacao. */
  function filterDrive(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    const pre = ctx.createGain(), sh = ctx.createWaveShaper(), post = ctx.createGain();
    const curve = new Float32Array(2048);
    // a curva e tanh(4x): com pre 0,12 fica quase limpa; com pre 1, satura forte
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 8 - 4; curve[i] = Math.tanh(x); }
    sh.curve = curve; sh.oversample = "2x";
    input.connect(lp).connect(pre).connect(sh).connect(post).connect(output);
    return {
      input, output,
      set(i, v) {
        if (i === 0) glide(lp.frequency, exp(v, 40, 20000), ctx, 0.01);
        if (i === 1) glide(lp.Q, 0.5 + v * v * 18, ctx);
        if (i === 2) {
          // o post deixa um sinal de -10 dB (0,3) no mesmo nivel com qualquer drive:
          // o drive satura e comprime os picos, sem o volume pular
          const g = 0.12 + v * v * 0.88;
          glide(pre.gain, g, ctx);
          glide(post.gain, 0.3 / Math.tanh(1.2 * g), ctx);
        }
      },
    };
  }

  /** 2. Isolator: graves, medios e agudos separados (250 Hz e 2,5 kHz), cada um de -inf a +6 dB. */
  function isolator(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const bq = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Math.SQRT1_2; return b; };
    const chain = (...ns) => { ns.reduce((a, b) => a.connect(b)); return ns; };
    const gl = ctx.createGain(), gm = ctx.createGain(), gh = ctx.createGain();
    const low = chain(bq("lowpass", 250), bq("lowpass", 250), gl);
    const mid = chain(bq("highpass", 250), bq("highpass", 250), bq("lowpass", 2500), bq("lowpass", 2500), gm);
    const high = chain(bq("highpass", 2500), bq("highpass", 2500), gh);
    [low, mid, high].forEach(c => { input.connect(c[0]); c[c.length - 1].connect(output); });
    const gain = v => (v < 0.5 ? Math.pow(v * 2, 2) : 1 + (v - 0.5) * 2);
    const gs = [gl, gm, gh];
    return { input, output, set(i, v) { glide(gs[i].gain, gain(v), ctx, 0.008); } };
  }

  /** 3. Delay: tempo em notas (no BPM), feedback e nivel do eco. Eco de fita: o retorno perde agudo. */
  function delay(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const d = ctx.createDelay(4), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), wet = ctx.createGain();
    tone.type = "lowpass"; tone.frequency.value = 5000;
    input.connect(output);
    input.connect(d); d.connect(tone).connect(fb).connect(d);
    d.connect(wet).connect(output);
    let note = 0.5, bpm = 90;
    const time = () => glide(d.delayTime, Math.min(3.9, note * 60 / bpm), ctx, 0.05);
    return {
      input, output,
      set(i, v) {
        if (i === 0) { note = pick(DELAY_NOTES, v); time(); }
        if (i === 1) glide(fb.gain, v * 0.9, ctx);
        if (i === 2) glide(wet.gain, v, ctx);
      },
      bpm(b) { bpm = b; time(); },
    };
  }

  /** Ruido de disco: chiado fino e estalos, 3 s em loop. */
  function vinylNoise(ctx) {
    const n = Math.floor(ctx.sampleRate * 3), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0, k = 0, amp = 0;
      for (let i = 0; i < n; i++) {
        lp += (Math.random() * 2 - 1 - lp) * 0.25;
        let x = lp * 0.035;
        if (k <= 0 && Math.random() < 0.00035) { k = 6 + Math.floor(Math.random() * 30); amp = (0.2 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1); }
        if (k > 0) { x += amp * (k / 30) * (Math.random() * 0.6 + 0.4); k--; }
        d[i] = x;
      }
    }
    return b;
  }

  /** 4. Vinyl Sim: faixa mais estreita, ruido de disco e wow/flutter, com um compressor leve. */
  function vinyl(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    const wow = ctx.createDelay(0.1); wow.delayTime.value = 0.012;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.6;
    input.connect(comp).connect(wow).connect(hp).connect(lp).connect(output);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), d1 = ctx.createGain(), d2 = ctx.createGain();
    o1.frequency.value = 0.55; o2.frequency.value = 6.5; d1.gain.value = 0; d2.gain.value = 0;
    o1.connect(d1).connect(wow.delayTime); o2.connect(d2).connect(wow.delayTime);
    o1.start(); o2.start();
    const ns = ctx.createBufferSource(); ns.buffer = vinylNoise(ctx); ns.loop = true;
    const ng = ctx.createGain(); ng.gain.value = 0;
    ns.connect(ng).connect(output); ns.start();
    return {
      input, output,
      set(i, v) {
        if (i === 0) { glide(lp.frequency, exp(v, 18000, 2200), ctx, 0.01); glide(hp.frequency, exp(v, 20, 320), ctx, 0.01); }
        if (i === 1) glide(ng.gain, v * v * 0.9, ctx);
        if (i === 2) { glide(d1.gain, v * 0.004, ctx); glide(d2.gain, v * 0.0005, ctx); }
      },
      dispose() { try { o1.stop(); o2.stop(); ns.stop(); } catch (e) { /* ja parado */ } },
    };
  }

  /** 5. DJFX Looper (worklet): tamanho em notas, velocidade de -1 a +1, loop liga/desliga (Ctrl 3). */
  function djfx(ctx) {
    const node = workletNode(ctx, "d4-looper");
    let note = 1 / 4, bpm = 90, loopOn = true, act = false;
    const P = k => node.parameters.get(k);
    const len = () => P("len").setValueAtTime(Math.min(3.9, note * 60 / bpm), ctx.currentTime);
    const on = () => P("on").setValueAtTime(act && loopOn ? 1 : 0, ctx.currentTime);
    return {
      input: node, output: node, keep: true,
      set(i, v) {
        if (i === 0) { note = pick(LOOP_NOTES, v); len(); }
        if (i === 1) P("speed").setTargetAtTime(v * 2 - 1, ctx.currentTime, 0.01);
        if (i === 2) { loopOn = v >= 0.5; on(); }
      },
      active(a) { act = a; on(); },
      bpm(b) { bpm = b; len(); },
    };
  }

  /** Resposta ao impulso: ruido estereo caindo 60 dB em "secs", com um pre-delay curto. */
  function impulse(ctx, secs) {
    const sr = ctx.sampleRate, pre = Math.floor(sr * 0.012), n = Math.floor(sr * secs) + pre;
    const b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        lp += (Math.random() * 2 - 1 - lp) * 0.6;
        d[i] = lp * Math.exp(-6.9 * t / secs) * 0.5;
      }
    }
    return b;
  }

  /** 6. Reverb: tempo da cauda, tom e nivel. Duas convolucoes cruzam quando o tempo muda. */
  function reverb(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass";
    const wet = ctx.createGain();
    input.connect(output);
    const cv = [ctx.createConvolver(), ctx.createConvolver()], cg = [ctx.createGain(), ctx.createGain()];
    cv.forEach((c, k) => { input.connect(c); c.connect(cg[k]).connect(tone); cg[k].gain.value = 0; });
    tone.connect(wet).connect(output);
    let cur = 0, secs = 2, timer = 0, made = 0;
    const build = () => {
      if (secs === made) return;
      made = secs;
      const k = 1 - cur;
      cv[k].buffer = impulse(ctx, secs);
      glide(cg[k].gain, 1, ctx, 0.03); glide(cg[cur].gain, 0, ctx, 0.03);
      cur = k;
    };
    return {
      input, output,
      set(i, v) {
        if (i === 0) { secs = Math.round(exp(v, 0.3, 7) * 20) / 20; clearTimeout(timer); timer = setTimeout(build, made ? 120 : 0); if (!made) build(); }
        if (i === 1) glide(tone.frequency, exp(v, 1500, 16000), ctx, 0.01);
        if (i === 2) glide(wet.gain, v * 2, ctx);
      },
      dispose() { clearTimeout(timer); },
    };
  }

  /** 7. Lo-fi / Bit Crush (worklet): bits, taxa de amostragem e tom. */
  function lofi(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const node = workletNode(ctx, "d4-crush");
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.Q.value = 0.5;
    input.connect(node).connect(tone).connect(output);
    const P = k => node.parameters.get(k);
    return {
      input, output,
      set(i, v) {
        if (i === 0) P("bits").setTargetAtTime(16 - v * 13, ctx.currentTime, 0.01);
        if (i === 1) P("down").setTargetAtTime(exp(v, 1, 40), ctx.currentTime, 0.01);
        if (i === 2) glide(tone.frequency, exp(v, 900, 20000), ctx, 0.01);
      },
    };
  }

  /** LO-FI global do 404 (Shift + Reverse): o mesmo worklet d4-crush do efeito Lo-fi, com bits e taxa direto (sem o tom).
   *  O worklet precisa ter carregado (d4LoadWorklets). Ponto de partida: 6 bits, taxa dividida por 4 (bem audivel, como o LO-FI do SP-404A). */
  RJ.D4_LOFI = { bits: 6, down: 4, minBits: 2, maxBits: 16, maxDown: 24 };
  RJ.d4LofiNode = function (ctx, bits, down) {
    const node = workletNode(ctx, "d4-crush");
    node.parameters.get("bits").value = bits;
    node.parameters.get("down").value = down;
    return node;
  };

  /** 8. Compressor: sustain (limiar e razao juntos), ataque e nivel de saida. */
  function compressor(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const c = ctx.createDynamicsCompressor(); c.knee.value = 6; c.release.value = 0.12;
    const make = ctx.createGain();
    input.connect(c).connect(make).connect(output);
    // o DynamicsCompressor ja traz ganho de compensacao; acima da metade do Sustain ele
    // nao basta, e o make devolve o que falta. Level 0,4 = 0 dB.
    return {
      input, output,
      set(i, v) {
        if (i === 0) { glide(c.threshold, -v * 40, ctx); glide(c.ratio, 1.5 + v * 10.5, ctx); glide(make.gain, db(Math.max(0, v - 0.5) * 12), ctx); }
        if (i === 1) glide(c.attack, exp(v, 0.0005, 0.08), ctx);
        if (i === 2) glide(output.gain, db(-9.6 + v * 24), ctx);
      },
    };
  }

  /** 9. Stopper / Back Spin (worklet): tempo, tipo (freio ou giro) e disparo (Ctrl 3). */
  function stopper(ctx) {
    const node = workletNode(ctx, "d4-stopper");
    let trig = true, act = false;
    const P = k => node.parameters.get(k);
    const on = () => P("on").setValueAtTime(act && trig ? 1 : 0, ctx.currentTime);
    return {
      input: node, output: node, keep: true,
      set(i, v) {
        if (i === 0) P("time").setValueAtTime(exp(v, 0.1, 3), ctx.currentTime);
        if (i === 1) P("mode").setValueAtTime(v >= 0.5 ? 1 : 0, ctx.currentTime);
        if (i === 2) { trig = v >= 0.5; on(); }
      },
      active(a) { act = a; on(); },
    };
  }

  /**
   * A lista. n: o numero no display (F.01 a F.09); caps: as legendas de Ctrl 1-3;
   * def: os valores de inicio; mfx: entra pelo MFX (pad 1-4); worklet: precisa do worklet.
   */
  RJ.D4FX = [
    { id: "filter", n: 1, name: "Filter+Drive", caps: ["Cutoff", "Reso", "Drive"], def: [0.75, 0.3, 0.2], make: filterDrive },
    { id: "isolator", n: 2, name: "Isolator", caps: ["Low", "Mid", "High"], def: [0.5, 0.5, 0.5], make: isolator },
    { id: "delay", n: 3, name: "Delay", caps: ["Time", "Feedbk", "Level"], def: [0.5, 0.4, 0.5], make: delay },
    { id: "vinyl", n: 4, name: "Vinyl Sim", caps: ["Freq", "Noise", "Wow"], def: [0.45, 0.35, 0.3], make: vinyl },
    { id: "djfx", n: 5, name: "DJFX Looper", caps: ["Length", "Speed", "Loop"], def: [0.5, 1, 1], make: djfx, worklet: true },
    { id: "reverb", n: 6, name: "Reverb", caps: ["Time", "Tone", "Level"], def: [0.5, 0.6, 0.45], make: reverb, mfx: 1 },
    { id: "lofi", n: 7, name: "Lo-fi", caps: ["Bits", "Rate", "Tone"], def: [0.55, 0.35, 0.6], make: lofi, mfx: 2, worklet: true },
    { id: "comp", n: 8, name: "Compressor", caps: ["Sustain", "Attack", "Level"], def: [0.5, 0.3, 0.4], make: compressor, mfx: 3 },
    { id: "stopper", n: 9, name: "Stopper", caps: ["Time", "Type", "Trig"], def: [0.4, 0, 1], make: stopper, mfx: 4, worklet: true },
  ];
  RJ.D4FX.byId = id => RJ.D4FX.find(f => f.id === id) || null;
  RJ.D4FX.mfx = k => RJ.D4FX.find(f => f.mfx === k) || null;

  /* ================================================================ o lugar do efeito no bus */
  RJ.D4Slot = class {
    constructor(ctx) {
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.output = ctx.createGain();
      this.dry = ctx.createGain();
      this.input.connect(this.dry).connect(this.output);
      this.cur = null;     // instancia ligada
      this.wet = null;     // ganho dela neste momento
    }

    /** Liga a instancia (ou null para so o seco). Cruza em ~20 ms. */
    use(fx) {
      if (fx === this.cur) return;
      const ctx = this.ctx;
      const old = this.cur, oldWet = this.wet;
      if (old) {
        glide(oldWet.gain, 0, ctx);
        if (old.active) old.active(false);
        setTimeout(() => {
          try { old.output.disconnect(oldWet); } catch (e) { /* ja desligado */ }
          oldWet.disconnect();
          if (!old.keep && this.cur !== old) { try { this.input.disconnect(old.input); } catch (e) { /* ja desligado */ } }
        }, 120);
      }
      this.cur = fx;
      this.wet = null;
      // um efeito que estava sem entrada pode ter restos no buffer (o compressor tem
      // lookahead): ele recebe o som 15 ms antes de a rampa comecar
      let at = 0;
      if (fx) {
        const wet = ctx.createGain();
        wet.gain.value = 0;
        if (!fx.keep) { try { this.input.disconnect(fx.input); } catch (e) { /* nao estava */ } this.input.connect(fx.input); at = ctx.currentTime + 0.015; }
        fx.output.connect(wet).connect(this.output);
        glide(wet.gain, 1, ctx, TC, at);
        if (fx.active) fx.active(true);
        this.wet = wet;
      }
      glide(this.dry.gain, fx ? 0 : 1, ctx, TC, at);
    }

    /** Efeito que precisa ouvir sempre (Looper, Stopper): entrada ligada desde ja. */
    attach(fx) { if (fx.keep) this.input.connect(fx.input); }
  };
})();
