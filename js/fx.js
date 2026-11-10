/* DCX 404 - efeitos
 *
 * Os 9 efeitos da v0.1, em Web Audio. Cada um e uma fabrica make(ctx, env) que
 * devolve { input, output, set(i, v), active(on), bpm(b), dispose() }:
 *   i       0, 1 ou 2 (Ctrl 1-3); v de 0 a 1
 *   active  o efeito entrou ou saiu do bus (o Looper e o Stopper capturam ai)
 *   bpm     o tempo mudou (Delay, Looper)
 * make(ctx, { nf }) recebe a face (nf = face nova); a estavel e o Studio chamam sem nf e nada muda.
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
     para "bits" bits.
     mode 0 (a estavel e o LO-FI global, igual a sempre): a amostra so e tomada numa amostra inteira,
     entao com "down" fracionario o tempo entre tomadas pula (3, 4, 4, 3...) e esse tremor de relogio
     vira um chiado largo (-36 dB num seno com down 3,64): era o "chiado por cima".
     mode 1 (MFX 14 da face nova): relogio uniforme. A tomada cai no instante exato (entre duas
     amostras, lido por interpolacao linear) e a amostra onde o degrau acontece leva a media dos dois
     degraus na proporcao certa. Sobra so o que e do Lo-Fi: o espelhamento da taxa (metalico) e a
     quantizacao (que acompanha o sinal). Nada de dither. 1 amostra de atraso.
     mode 1, Onda 1.6 ("radio antigo"): antes da reducao, a faixa de um radio: passa-altas em 300 Hz e passa-baixas
     em 3 kHz (2 polos cada, quedas suaves de 12 dB/oit.), um grao bem baixo que segue o sinal (-34 dB do envelope:
     no silencio, silencio) e uma saturacao leve (tanh). Tudo antes do passa-baixa anti-espelho: o que a saturacao
     cria acima da taxa nova tambem nao dobra. rAt, bit e o FLt (fora do worklet) continuam em volta. */
  class D4Crush extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "down", defaultValue: 4, minValue: 1, maxValue: 64, automationRate: "k-rate" },
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ]; }
    constructor() {
      super(); this.h = [0, 0]; this.c = 0; this.t = 0; this.xp = [0, 0];
      this.zd = 0; this.zq = null;                        // mode 1: o "down" dos coeficientes e os coeficientes
      this.zs = [new Float64Array(28), new Float64Array(28)];   // estados dos 7 biquads (radio 2, antes 4, depois 1) por canal
      this.rq = [D4Crush.bh(300, Math.SQRT1_2), D4Crush.bq(3000, 0.8)];   // mode 1: a faixa do radio (passa-altas, passa-baixas)
      this.env = [0, 0]; this.rs = 0x2545F491;                            // mode 1: envelope do grao e o sorteio dele
    }
    // passa-baixa RBJ em fc (Hz) com Q
    static bq(fc, q) {
      const w0 = 2 * Math.PI * Math.min(fc, 0.45 * sampleRate) / sampleRate, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q), a0 = 1 + al;
      return [(1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0];
    }
    // passa-altas RBJ em fc (Hz) com Q
    static bh(fc, q) {
      const w0 = 2 * Math.PI * fc / sampleRate, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q), a0 = 1 + al;
      return [(1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0];
    }
    static run(c, z, o, x) {
      let y = c[0] * x + c[1] * z[o] + c[2] * z[o + 1] - c[3] * z[o + 2] - c[4] * z[o + 3];
      if (y > -1e-20 && y < 1e-20) y = 0;
      z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = y;
      return y;
    }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length;
      const steps = Math.pow(2, P.bits[0] - 1), down = P.down[0];
      if (P.mode && P.mode[0] >= 0.5) {
        // antes da tomada, um passa-baixa de 4 polos (Butterworth) em 0,45 x a taxa nova: o agudo que nao cabe na taxa
        // nao "dobra" para baixo (era o chiado: um chimbal ganhava +30 a +40 dB abaixo de 3 kHz). Depois, 2 polos em
        // 0,9 x a taxa nova: fica o primeiro espelho (o metalico do Lo-Fi), sai o "fizz" das imagens de cima
        if (down !== this.zd) {
          this.zd = down; const fs = sampleRate / Math.max(1, down);
          // Onda 1.6: o anti-espelho passou a 8 polos (Butterworth) em 0,42 x a taxa nova (eram 4 polos em 0,45): com a
          // faixa do radio em volta, um seno de 5 kHz no padrao (~8,2 kHz) dobra a -32 dB (era -14 dB)
          this.zq = [D4Crush.bq(0.42 * fs, 0.5098), D4Crush.bq(0.42 * fs, 0.6013), D4Crush.bq(0.9 * fs, Math.SQRT1_2),
            D4Crush.bq(0.42 * fs, 0.9000), D4Crush.bq(0.42 * fs, 2.5629)];
        }
        const q = this.zq, R = D4Crush.run, rq = this.rq;
        const ea = 1 - Math.exp(-1 / (0.005 * sampleRate)), er = 1 - Math.exp(-1 / (0.05 * sampleRate));   // envelope do grao: 5 ms sobe, 50 ms desce
        // t = quanto falta (em amostras) para a proxima tomada, contado a partir da amostra anterior
        for (let k = 0; k < n; k++) {
          this.t -= 1;
          const take = this.t <= 0, u = take ? -this.t : 0;   // a tomada foi u amostras antes desta (0 <= u < 1)
          if (take) this.t += Math.max(1, down);
          for (let c = 0; c < out.length; c++) {
            let x = (inp[c] || inp[0] || [])[k] || 0;
            if (!(x > -4 && x < 4)) x = 0;
            const j = c & 1, old = this.h[j], z = this.zs[j];
            // radio: grao que segue o sinal, faixa 300 Hz-3 kHz, saturacao leve (ganho 1,8 no sinal baixo, ~+5 dB no meio da faixa: repoe o nivel que o grave cortado tira; pico teorico 1,125)
            const ax = x < 0 ? -x : x; this.env[j] += (ax - this.env[j]) * (ax > this.env[j] ? ea : er);
            this.rs = (this.rs * 1664525 + 1013904223) >>> 0;
            x += this.env[j] * 0.02 * (this.rs / 2147483648 - 1);
            x = R(rq[1], z, 16, R(rq[0], z, 12, x));
            x = 1.8 * Math.tanh(1.6 * x) / 1.6;
            x = R(q[4], z, 24, R(q[3], z, 20, R(q[1], z, 4, R(q[0], z, 0, x))));
            let y = old;
            if (take) {
              const v = x + (this.xp[j] - x) * u;
              this.h[j] = Math.round(v * steps) / steps;
              y = old * (1 - u) + this.h[j] * u;
            }
            out[c][k] = R(q[2], z, 8, y);
            this.xp[j] = x;
          }
        }
        return true;
      }
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

  /* PITCH (face nova): pitch shifter de linha de atraso com emenda sincronizada (codigo proprio;
     a ideia e a do "harmonizer" de duas leituras, como no PitchShift do Tone.js, mais a busca de
     emenda do SOLA).
     - Uma leitura anda "r" amostras por amostra no anel (r = 2^(semi/12)): o tom sai exato.
     - O atraso dela encolhe (r > 1) ou cresce (r < 1). Antes de sair da faixa, nasce uma leitura nova
       do outro lado. O ponto dela e escolhido por correlacao com o que a velha acabou de tocar (8 ms para
       tras), com ajuste entre amostras: a emenda cai em fase e o tom puro nao "bate" nem desafina.
     - Atraso: a faixa comeca em ~1,5 ms e a busca curta vai a 15 ms; quando ela nao acha a fase (um grave
       de periodo longo) a busca vai a 30 ms e a faixa cresce, enquanto o grave durar. Acima de 1 oitava o
       cruzamento encolhe na mesma proporcao, para o atraso nao crescer com o intervalo.
     - Onda 1.6 (som com varios instrumentos): cada emenda e um salto de fase para tudo o que nao e o som
       dominante. Com emendas curtas (salto minimo de 2 ms, cruzamento de 4 ms, busca de 8 ms) eram ~40
       emendas/s, e a modulacao virava "filtro" aspero (laterais a cada ~40 Hz em volta de cada nota) e um
       resto nas frequencias originais (-20 a -26 dB); descendo 1 oitava o mix ficava quase so ruido.
       Agora o salto minimo e 12 ms e o cruzamento 15 ms: menos emendas, mais suaves. Atraso medio ~10-18 ms.
     - As duas cruzam em 15 ms; a forma do cruzamento vai de soma de amplitude (emenda em fase) a soma
       de potencia (som sem periodo, como ruido), pelo grau da correlacao.
     - Subindo, um passa-baixa (Butterworth) em 0,45 x taxa / r antes da leitura tira o espelhamento
       (descendo ele fica em 0,45 x taxa).
     - FEEDBACK: a saida afinada volta a entrada depois de "time" segundos (o efeito poe 1/8 de nota
       no BPM): cada repeticao sobe/desce mais um passo, e em 0 semitom vira eco. tanh no retorno.
     - BALANCE: direto (0) e efeito (1). Em 0 semitom o efeito e o proprio sinal (sem atraso). */
  class D4Pitch extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: "semi", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "k-rate" },
      { name: "fb", defaultValue: 0, minValue: 0, maxValue: 0.8, automationRate: "k-rate" },
      { name: "bal", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "time", defaultValue: 0.25, minValue: 0.03, maxValue: 1, automationRate: "k-rate" },
    ]; }
    constructor() {
      super();
      const sr = sampleRate;
      this.L = Math.round(sr * 0.010);      // trecho comparado na busca (o que as duas leituras acabaram de tocar)
      this.Ss = Math.round(sr * 0.015);    // busca curta: periodos ate 15 ms (acima de ~67 Hz)
      this.Sl = Math.round(sr * 0.030);    // busca longa: ate 30 ms (um grave de 33 Hz), so quando a curta nao acha a fase
      this.X = Math.round(sr * 0.015);      // cruzamento (amostras de saida): 15 ms (Onda 1.6; era 4 ms)
      this.Lm = Math.round(sr * 0.002);    // vida minima de uma leitura fora do cruzamento
      this.dLo = Math.round(sr * 0.0015) + 4;         // o menor atraso (~1,5 ms)
      this.Jm = Math.round(sr * 0.012);    // o menor salto de uma emenda: 12 ms (Onda 1.6; era 2 ms, emendas demais num mix)
      this.Se = this.Ss;                              // a busca em uso (curta ou longa)
      this.st = sr > 60000 ? 4 : 2;
      let N = 1; while (N < this.dLo + 2 * this.Sl + this.L + this.X + this.Lm + 64) N *= 2;
      this.N = N; this.M = N - 1;
      let F = 1; while (F < sr + 8) F *= 2;     // retorno do feedback: ate 1 s
      this.F = F; this.FM = F - 1;
      this.buf = [new Float32Array(N), new Float32Array(N)];
      this.fbb = [new Float32Array(F), new Float32Array(F)];
      this.w = 0;                               // posicao absoluta de escrita
      this.pa = -this.dLo - this.Ss;            // leitura ativa (posicao absoluta)
      this.pb = 0; this.xf = -1; this.xl = this.X; this.al = 1; this.T = null;   // leitura nova, progresso do cruzamento (-1 = sem), grau da correlacao
      this.byp = 1; this.fb = 0; this.bal = 0.5; this.semi = null; this.r = 1;
      this.z = [[0, 0, 0, 0], [0, 0, 0, 0]];    // estado do passa-baixa (x1, x2, y1, y2) por canal
      this.lp = null;
    }
    rh(b, p) {                        // leitura Hermite (4 pontos) no anel
      const M = this.M, i = Math.floor(p), f = p - i;
      const y0 = b[(i - 1) & M], y1 = b[i & M], y2 = b[(i + 1) & M], y3 = b[(i + 2) & M];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    }
    setSemi(semi) {
      this.semi = semi; const r = this.r = Math.pow(2, semi / 12), sr = sampleRate;
      const g = this.g = Math.abs(1 - r), k = Math.max(1, g);
      // subindo mais de uma oitava a leitura chega g vezes mais rapido no "agora": cruzamento e vida encolhem na mesma
      // proporcao, e a faixa de atraso fica a mesma de 1 oitava (o atraso nao cresce com o intervalo)
      this.xr = Math.max(16, Math.round(this.X / k)); const lm = this.Lm / k;
      this.lm = lm;
      this.lo = r > 1 ? this.dLo + g * (2 * this.xr + lm) : this.dLo;   // a leitura nova entra (xr), vive (lm) e ainda tem margem para sair (xr)
      this.span();
      // passa-baixa Butterworth (RBJ, Q = 0,7071) em 0,45 x sr / r. Roda sempre (descendo fica em 0,45 x sr, quase
      // transparente): ligar/desligar ou zerar o estado deixaria um degrau no anel, ouvido quando a leitura passa por ele
      const w0 = 2 * Math.PI * 0.45 * sr / Math.max(1, r) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2), a0 = 1 + al;
      this.lp = [(1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0];
    }
    // o maior atraso da faixa, com a busca em uso: subindo, a leitura nova nasce entre lo e dHi; descendo, a velha vai ate dHi
    span() { this.dHi = this.r > 1 ? this.lo + this.Se : this.dLo + this.Se + this.g * (2 * this.xr + this.lm); }
    // escolhe a posicao da leitura nova: atraso alvo em [lo, lo + busca]. Compara o que as duas acabaram de tocar
    // (L amostras para tras: nao precisa esperar o futuro, e o atraso minimo nao depende de L). Primeiro a busca curta;
    // se ela nao achar a fase (grave de periodo longo) e a longa achar bem melhor, usa a longa e a faixa cresce
    splice(lo) {
      const B0 = this.buf[0], B1 = this.buf[1], M = this.M, L = this.L, Ss = this.Ss, Sl = this.Sl;
      const base = Math.floor(this.pa), fr = this.pa - base;
      const j0 = Math.round(this.w - lo) - base;   // deslocamento (em amostras) da leitura nova contra a velha, no atraso "lo"
      let ea = 0;
      const st = this.st;   // passo da comparacao e da busca (4 acima de 60 kHz: o mesmo custo de 48 kHz)
      for (let m = 0; m < L; m += st) { const a = B0[(base - m) & M] + B1[(base - m) & M]; ea += a * a; }
      const score = j => {
        let c = 0, eb = 0;
        for (let m = 0; m < L; m += st) {
          const a = B0[(base - m) & M] + B1[(base - m) & M], b = B0[(base + j - m) & M] + B1[(base + j - m) & M];
          c += a * b; eb += b * b;
        }
        return c / Math.sqrt(ea * eb + 1e-12);
      };
      const find = (j1, j2) => {
        let best = j2, bs = -2;
        for (let j = j2; j >= j1; j -= st) { const s = score(j); if (s > bs) { bs = s; best = j; } }
        for (let h = 1; h < st; h++) for (const j of [best - h, best + h]) { if (j <= j2 && j >= j1) { const s = score(j); if (s > bs) { bs = s; best = j; } } }
        return [best, bs];
      };
      // o salto (j = atraso velho - atraso novo) tem no minimo Jm: um salto quase nulo "acerta" a fase de qualquer grave,
      // mas desfaz o que a leitura andou (o tom volta ao original). Subindo, j < 0; descendo, j > 0
      const Jm = this.Jm, up = this.r > 1, cut = (a, b) => up ? [a, Math.min(b, -Jm)] : [Math.max(a, Jm), b];
      const r0 = cut(j0 - Ss, j0);
      if (r0[0] > r0[1]) { this.pa = this.w - lo - Ss; return; }   // a leitura esta longe demais da faixa (nao deve acontecer): volta para ela
      let [best, bs] = find(...r0), S = Ss;
      const better = x => x > bs + 0.25 * (1 - bs);   // a longa so ganha se fechar 1/4 do que falta para a fase exata
      if (ea > 1e-9 && bs < 0.995) {
        if (up || this.Se === Sl) {
          const [bl, sl] = find(...cut(j0 - Sl, j0 - Ss - 1));
          if (better(sl)) { best = bl; bs = sl; S = Sl; }
        } else {
          // descendo na busca curta, a leitura velha ainda nao foi longe o bastante para um salto de um periodo longo:
          // se o som se repete melhor num periodo longo (grave), adia a emenda e deixa a faixa crescer
          const [, sk] = find(-Sl, -Ss - 1);
          if (better(sk)) { this.Se = Sl; this.span(); return; }
        }
      }
      if (S !== this.Se) { this.Se = S; this.span(); }
      // ponto exato entre amostras: parabola nos vizinhos (um erro de meia amostra a cada emenda curta ja desafina ~5 cent)
      const sm = score(best - 1), s0 = score(best), sp = score(best + 1), den = sm - 2 * s0 + sp;
      const dj = den < -1e-9 ? Math.max(-0.5, Math.min(0.5, 0.5 * (sm - sp) / den)) : 0;
      this.pb = base + best + dj + fr;
      this.al = ea < 1e-9 ? 1 : Math.max(0, Math.min(1, bs));
      this.xf = 0;
      this.xl = this.xr;
    }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, M = this.M, FM = this.FM, X = this.X;
      const semi = Math.round(P.semi[0]);
      if (semi !== this.semi) this.setSemi(semi);
      const r = this.r, fbT = P.fb[0], balT = P.bal[0], bypT = semi === 0 ? 1 : 0;
      const T = Math.max(2, Math.min(this.F - 4, P.time[0] * sampleRate));
      if (this.T == null) this.T = T;
      if (!this.ready) { this.ready = true; this.fb = fbT; this.bal = balT; this.byp = bypT; }
      const lp = this.lp;
      for (let k = 0; k < n; k++) {
        this.fb += (fbT - this.fb) * 0.002; this.bal += (balT - this.bal) * 0.002;
        if (Math.abs(fbT - this.fb) < 1e-6) this.fb = fbT;
        if (Math.abs(balT - this.bal) < 1e-6) this.bal = balT;
        if (this.byp !== bypT) this.byp = bypT > this.byp ? Math.min(1, this.byp + 1 / 512) : Math.max(0, this.byp - 1 / 512);
        // cruzamento: soma de amplitude (al = 1) ou de potencia (al = 0)
        let ga = 1, gb = 0;
        if (this.xf >= 0) {
          const u = this.xf / this.xl, ca = 0.5 + 0.5 * Math.cos(Math.PI * u), pa = Math.cos(0.5 * Math.PI * u), pb = Math.sin(0.5 * Math.PI * u);
          ga = this.al * ca + (1 - this.al) * pa; gb = this.al * (1 - ca) + (1 - this.al) * pb;
        }
        if (this.T !== T) this.T = Math.abs(T - this.T) < 0.02 ? T : this.T + (T > this.T ? 0.02 : -0.02);   // muda o tempo do eco devagar (sem clique)
        const tp = this.w - this.T, ti = Math.floor(tp), tf = tp - ti;
        const dry = 1 - this.bal, wg = this.bal * (1 - 0.5 * this.fb), byp = this.byp, fb = this.fb, wi = this.w & M, fi = this.w & FM;
        for (let c = 0; c < out.length; c++) {
          let x = (inp[c] || inp[0] || [])[k] || 0;
          if (!(x > -1e4 && x < 1e4)) x = 0;   // NaN/Infinity nao entram no anel (ficariam la para sempre)
          const j = c & 1, b = this.buf[j], fq = this.fbb[j];
          const z0 = fq[ti & FM], zr = z0 + (fq[(ti + 1) & FM] - z0) * tf;   // o retorno, "time" atras
          let v = x + fb * Math.tanh(zr);
          { const z = this.z[j]; let y = lp[0] * v + lp[1] * z[0] + lp[2] * z[1] - lp[3] * z[2] - lp[4] * z[3]; if (y > -1e-20 && y < 1e-20) y = 0; z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y; v = y; }
          b[wi] = v > -1e-20 && v < 1e-20 ? 0 : v;   // sem denormais no silencio
          let sh = ga * this.rh(b, this.pa);
          if (gb) sh += gb * this.rh(b, this.pb);
          const wet = byp > 0 ? byp * (x + fb * Math.tanh(zr)) + (1 - byp) * sh : sh;
          fq[fi] = wet > -1e-20 && wet < 1e-20 ? 0 : wet;
          out[c][k] = dry * x + wg * wet;
        }
        // subindo, a leitura velha chega mais perto do "agora" a cada amostra; logo depois de trocar de tom ela pode
        // nao ter margem para o cruzamento inteiro: ai ela anda mais devagar (some em fade, sem ler o que nao foi escrito)
        if (this.xf >= 0) {
          const left = this.xl - this.xf;   // a nova tambem: trocando para cima no meio de um cruzamento, ela pode estar perto do "agora"
          if (r > 1) { this.pa += Math.min(r, 1 + Math.max(0, this.w - this.pa - 4) / left); this.pb += Math.min(r, 1 + Math.max(0, this.w - this.pb - 4) / left); }
          else { this.pa += r; this.pb += r; }
        }
        else this.pa += r;
        this.w++;
        if (this.xf >= 0 && ++this.xf >= this.xl) { this.pa = this.pb; this.xf = -1; }
        if (this.w - this.pa < 3) this.pa = this.w - 3;                               // nunca le o que ainda nao foi escrito
        if (this.xf < 0) {
          const d = this.w - this.pa;
          if (d < 4 || d > this.N - 8) this.pa = this.w - this.dLo - this.Ss;         // fora do anel (nao deve acontecer)
          else if (r > 1 && (d - this.g * this.xr <= this.dLo || d > this.lo + this.Sl + this.Ss)) this.splice(this.lo);   // (ou longe demais: veio de outro tom)
          else if (r < 1 && d + this.g * this.xr >= this.dHi) this.splice(this.lo);
        }
      }
      return true;
    }
  }
  registerProcessor("d4-pitch", D4Pitch);

  /* MFX da Onda 2 (face nova): Chorus, Flanger, Phaser, Tremolo/Pan, Wah e Ring Mod num processador so (codigo proprio).
     processorOptions.mode: 0 chorus, 1 flanger, 2 phaser, 3 tremolo/pan, 4 wah, 5 ring mod.
     p0-p3 ja chegam em unidades fisicas (o mapa 0-1 -> unidade esta fora, em RJ.d4Mfx, e os testes leem o mesmo):
       chorus  p0 profundidade (ms), p1 taxa (Hz), p2 mix (0 direto - 1 efeito)
       flanger p0 largura da varredura (ms), p1 taxa (Hz), p2 mix, p3 realimentacao (0-0,9)
       phaser  p0 varredura (oitavas acima de 180 Hz), p1 taxa (Hz), p2 mix, p3 realimentacao
       tremolo p0 profundidade (0-1), p1 taxa (Hz), p2 forma (0-1 do Ctrl 3: < 0,5 tremolo, >= 0,5 pan; longe do centro = mais quadrada)
       wah     p0 sensibilidade (oitavas por unidade de envelope), p1 frequencia de base (Hz), p2 Q
       ring    p0 frequencia da portadora (Hz), p1 sensibilidade (oitavas por unidade de envelope), p2 mix
     Os valores andam com uma rampa de ~10 ms por amostra (sem degrau). Quando "rst" muda, zera linhas, filtros e envelope
     (o efeito liga sem o resto da ultima vez). O molhado das modulacoes com realimentacao passa por um teto suave (pico 1). */
  class D4Mfx extends AudioWorkletProcessor {
    static get parameterDescriptors() { return ["p0", "p1", "p2", "p3", "rst"].map(name => ({ name, defaultValue: 0, automationRate: "k-rate" })); }
    constructor(o) {
      super();
      this.mode = (o && o.processorOptions && o.processorOptions.mode) | 0;
      this.N = 4096; this.M = 4095;                      // linha de atraso: 85 ms a 48 kHz (chorus ate ~25 ms)
      while (this.N < sampleRate * 0.06) { this.N *= 2; } this.M = this.N - 1;
      this.buf = [new Float32Array(this.N), new Float32Array(this.N)];
      this.ap = [new Float64Array(12), new Float64Array(12)];   // phaser: x1/y1 de 6 estagios por canal
      this.fbv = [0, 0];                                         // phaser: a ultima saida (realimentacao)
      this.ic = [[0, 0], [0, 0]];                                // wah: estados do filtro (TPT SVF)
      this.w = 0; this.ph = 0; this.cph = 0; this.env = 0; this.s = null;
      this.k = 1 - Math.exp(-1 / (0.01 * sampleRate));
      this.ea = 1 - Math.exp(-1 / (0.003 * sampleRate)); this.er = 1 - Math.exp(-1 / (0.12 * sampleRate));
      this.rs = 0;
    }
    reset() {
      this.buf[0].fill(0); this.buf[1].fill(0); this.ap[0].fill(0); this.ap[1].fill(0);
      this.fbv = [0, 0]; this.ic = [[0, 0], [0, 0]]; this.env = 0; this.ph = 0; this.cph = 0;
    }
    static soft(x) {   // teto suave: igual ate 0,8, depois curva ate 1
      const a = x < 0 ? -x : x;
      if (a <= 0.8) return x;
      const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
      return x < 0 ? -y : y;
    }
    rd(b, d) {          // leitura com interpolacao linear, d amostras atras de w
      const p = this.w - d, i = Math.floor(p), f = p - i, M = this.M;
      const a = b[i & M]; return a + (b[(i + 1) & M] - a) * f;
    }
    process(inputs, outputs, P) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, sr = sampleRate, mode = this.mode;
      if (P.rst[0] !== this.rs) { this.rs = P.rst[0]; this.reset(); }   // "rst" mudou: zera no comeco deste bloco (no tempo certo)
      const T = [P.p0[0], P.p1[0], P.p2[0], P.p3[0]];
      for (let i = 0; i < 4; i++) if (!(T[i] > -1e6 && T[i] < 1e6)) T[i] = 0;
      if (!this.s) this.s = T.slice();
      const s = this.s, k = this.k, soft = D4Mfx.soft, TAU = 2 * Math.PI;
      const L = inp[0] || [], R = inp[1] || inp[0] || [];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < 4; i++) s[i] += (T[i] - s[i]) * k;
        let xl = L[j] || 0, xr = R[j] || 0;
        if (!(xl > -8 && xl < 8)) xl = 0;
        if (!(xr > -8 && xr < 8)) xr = 0;
        let yl = xl, yr = xr;
        if (mode === 0) {                     // CHORUS: duas leituras moduladas, L e R em quadratura; sem realimentacao
          const dep = s[0] * 0.001 * sr, base = 0.008 * sr + dep, mix = s[2];
          const dl = base + dep * Math.sin(TAU * this.ph), dr = base + dep * Math.sin(TAU * (this.ph + 0.25));
          const b0 = this.buf[0], b1 = this.buf[1], wi = this.w & this.M;
          b0[wi] = xl; b1[wi] = xr;
          yl = (1 - mix) * xl + mix * this.rd(b0, dl);
          yr = (1 - mix) * xr + mix * this.rd(b1, dr);
          this.ph += s[1] / sr;
        } else if (mode === 1) {              // FLANGER: atraso curto varrido (0,3 ms ate 0,3 + largura) com realimentacao
          const wd = s[0] * 0.001 * sr, d = 0.0003 * sr + wd * 0.5 * (1 - Math.cos(TAU * this.ph));
          const fb = s[3], mix = s[2], nm = Math.sqrt(1 - fb * fb), b0 = this.buf[0], b1 = this.buf[1], wi = this.w & this.M;
          const wl = this.rd(b0, d), wr = this.rd(b1, d);
          let ul = xl + fb * wl, ur = xr + fb * wr;
          b0[wi] = ul > -1e-20 && ul < 1e-20 ? 0 : ul; b1[wi] = ur > -1e-20 && ur < 1e-20 ? 0 : ur;
          // o molhado e so a linha (todo a direita some o direto, manual p. 19); no meio direto + linha = o pente do flanger
          yl = (1 - mix) * xl + mix * soft(wl * nm);
          yr = (1 - mix) * xr + mix * soft(wr * nm);
          this.ph += s[1] / sr;
        } else if (mode === 2) {              // PHASER: 6 passa-tudo de 1a ordem varridos em escala log, realimentacao da saida
          const fc = Math.min(0.45 * sr, 180 * Math.pow(2, s[0] * 0.5 * (1 - Math.cos(TAU * this.ph))));
          const t = Math.tan(Math.PI * fc / sr), a = (t - 1) / (t + 1);
          const fb = s[3], mix = s[2], nm = Math.sqrt(1 - fb * fb);
          for (let c = 0; c < 2; c++) {
            const z = this.ap[c], x = c ? xr : xl;
            let v = x + fb * this.fbv[c];
            for (let g = 0; g < 6; g++) {
              const y = a * v + z[2 * g] - a * z[2 * g + 1];
              z[2 * g] = v; z[2 * g + 1] = y > -1e-20 && y < 1e-20 ? 0 : y; v = z[2 * g + 1];
            }
            this.fbv[c] = v;
            const y = (1 - mix) * x + mix * soft(v * nm);   // como no flanger: no meio direto + passa-tudo = os vales
            if (c) yr = y; else yl = y;
          }
          this.ph += s[1] / sr;
        } else if (mode === 3) {              // TREMOLO / PAN: LFO seno que fica quadrado longe do centro do Ctrl 3
          const sh = s[2], q = Math.abs(sh - 0.5) * 2, kk = 0.05 + 11.95 * q * q;
          const lf = Math.tanh(kk * Math.sin(TAU * this.ph)) / Math.tanh(kk), dep = s[0];
          // tremolo (esquerda) e pan (direita); perto do centro (0,47-0,53) os dois cruzam: girar por cima nao da degrau
          const wp = Math.max(0, Math.min(1, (sh - 0.47) / 0.06)), g = 1 - dep * 0.5 * (1 + lf), p = dep * lf;
          yl = xl * ((1 - wp) * g + wp * Math.min(1, 1 - p)); yr = xr * ((1 - wp) * g + wp * Math.min(1, 1 + p));
          this.ph += s[1] / sr;
        } else if (mode === 4) {              // WAH: passa-banda ressonante (SVF) cuja frequencia sobe com o envelope
          const ax = Math.max(xl < 0 ? -xl : xl, xr < 0 ? -xr : xr);
          this.env += (ax - this.env) * (ax > this.env ? this.ea : this.er);
          if (this.env < 1e-12) this.env = 0;
          const fc = Math.min(Math.min(8000, 0.45 * sr), s[1] * Math.pow(2, Math.min(5, s[0] * this.env)));
          const g = Math.tan(Math.PI * fc / sr), kq = 1 / Math.max(0.5, s[2]);
          const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2, mk = 1 + 0.15 * s[2];
          for (let c = 0; c < 2; c++) {
            const z = this.ic[c], x = c ? xr : xl;
            const v3 = x - z[1], v1 = a1 * z[0] + a2 * v3, v2 = z[1] + a2 * z[0] + a3 * v3;
            z[0] = 2 * v1 - z[0]; z[1] = 2 * v2 - z[1];
            if (z[0] > -1e-20 && z[0] < 1e-20) z[0] = 0;
            if (z[1] > -1e-20 && z[1] < 1e-20) z[1] = 0;
            const y = soft(kq * v1 * mk);
            if (c) yr = y; else yl = y;
          }
        } else {                              // RING MOD: entrada x seno da portadora; a frequencia sobe com o envelope (SEn)
          const ax = Math.max(xl < 0 ? -xl : xl, xr < 0 ? -xr : xr);
          this.env += (ax - this.env) * (ax > this.env ? this.ea : this.er);
          if (this.env < 1e-12) this.env = 0;
          const f = Math.min(0.45 * sr, s[0] * Math.pow(2, Math.min(4, s[1] * this.env)));
          const cr = Math.sin(TAU * this.cph), mix = s[2];
          yl = (1 - mix) * xl + mix * xl * cr; yr = (1 - mix) * xr + mix * xr * cr;
          this.cph += f / sr; if (this.cph >= 1) this.cph -= 1;
        }
        if (this.ph >= 1) this.ph -= 1;
        this.w++;
        out[0][j] = yl;
        if (out[1]) out[1][j] = yr;
      }
      return true;
    }
  }
  registerProcessor("d4-mfx", D4Mfx);

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

  // face nova: a tabela do manual (p. 22), em tempos (1 = uma seminima), e a trava de ~2000 ms
  const DELAY_NF = [1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4];
  const DELAY_NF_SHOW = ["t32", "t16", "t8t", "t16.", "t8", "t4t", "t8.", "t4", "t2t", "t4.", "t2", "t2.", "t1"];
  const DELAY_MAX = 2;   // s
  /** O indice da nota da face nova para v (0-1) no BPM: a maior que cabe nos ~2000 ms. */
  const delayNfIdx = (v, bpm) => {
    let i = Math.round(clamp(v, 0, 1) * (DELAY_NF.length - 1));
    while (i > 0 && DELAY_NF[i] * 60 / (bpm || 90) > DELAY_MAX + 1e-9) i--;
    return i;
  };
  RJ.d4DelayNf = { notes: DELAY_NF, show: DELAY_NF_SHOW, max: DELAY_MAX, idx: delayNfIdx };

  /** 3. Delay: tempo em notas (no BPM), feedback e nivel do eco. Eco de fita: o retorno perde agudo.
   *  Face nova (env.nf): o tempo vem do parametro 3 com a tabela t32-t1 do manual e trava em ~2000 ms;
   *  o Ctrl 3 e o BALANCE (esquerda so o direto, centro os dois cheios, direita so o eco). */
  function delay(ctx, env) {
    if (env && env.nf) return delayNf(ctx);
    const input = ctx.createGain(), output = ctx.createGain();
    const d = ctx.createDelay(4), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), wet = ctx.createGain();
    tone.type = "lowpass"; tone.frequency.value = 5000; tone.Q.value = -3.01; // Butterworth: sem o pico de +1 dB que, com feedback alto, fazia o laco passar de 1
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
  function delayNf(ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    const d = ctx.createDelay(4), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), wet = ctx.createGain(), dry = ctx.createGain();
    // Q em dB: -3,01 = Butterworth, sem o pico de +1 dB do padrao (com feedback 0,9 o pico fazia o laco passar de 1 perto de 5 kHz)
    tone.type = "lowpass"; tone.frequency.value = 5000; tone.Q.value = -3.01;
    input.connect(dry).connect(output);
    input.connect(d); d.connect(tone).connect(fb).connect(d);
    d.connect(wet).connect(output);
    let v3 = 4 / 12, bpm = 90;
    const born = ctx.currentTime;
    // ao montar (mesmo instante do relogio) o tempo entra direto, sem rampa; depois desliza em ~0,15 s como fita
    const time = () => {
      const T = DELAY_NF[delayNfIdx(v3, bpm)] * 60 / bpm;
      if (ctx.currentTime === born) { hold(d.delayTime, born); d.delayTime.setValueAtTime(T, born); } else glide(d.delayTime, T, ctx, 0.05);
    };
    return {
      input, output,
      set(i, v) {
        if (i === 3) { v3 = v; time(); }
        if (i === 1) glide(fb.gain, v * 0.9, ctx);
        if (i === 2) { glide(dry.gain, Math.min(1, 2 * (1 - v)), ctx); glide(wet.gain, Math.min(1, 2 * v), ctx); }
      },
      bpm(b) { bpm = b; time(); },
    };
  }

  /** PITCH (face nova, worklet d4-pitch): Ctrl 1 = semitons (-24 a +24), Ctrl 2 = feedback, Ctrl 3 = balance.
   *  O retorno do feedback espera 1/8 de nota no BPM (entre 0,12 e 0,5 s): cada repeticao sobe/desce mais um passo. */
  const pitchSemi = v => Math.round((clamp(v, 0, 1) - 0.5) * 48);
  const pitchFbTime = bpm => clamp(30 / (bpm || 90), 0.12, 0.5);
  RJ.d4PitchFbTime = pitchFbTime;
  function pitch(ctx) {
    const node = workletNode(ctx, "d4-pitch", { time: pitchFbTime(90) });
    const P = k => node.parameters.get(k);
    return {
      input: node, output: node,
      set(i, v) {
        if (i === 0) P("semi").setValueAtTime(pitchSemi(v), ctx.currentTime);
        if (i === 1) P("fb").setValueAtTime(v * 0.8, ctx.currentTime);
        if (i === 2) P("bal").setValueAtTime(v, ctx.currentTime);
      },
      bpm(b) { P("time").setValueAtTime(pitchFbTime(b), ctx.currentTime); },
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

  /** 4. Vinyl Sim: faixa mais estreita, ruido de disco e wow/flutter, com um compressor leve.
   *  Parametros: 0 faixa, 1 ruido, 2 wow, 3 compressor (a estavel nao tem Ctrl para o 3: fica no 0,5 de sempre). */
  function vinyl(ctx, env) {
    const nf = !!(env && env.nf);
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
        // 3: o COMPRESSOR (Ctrl 1 da face nova). 0,5 = o de sempre (-18 dB, 3:1); 0 = sem compressao
        if (i === 3 && nf) { glide(comp.threshold, -36 * v, ctx); glide(comp.ratio, 1 + 4 * v, ctx); }   // a estavel fica no de sempre
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

  const lofiBits = v => Math.round(16 - clamp(v, 0, 1) * 13);
  /** Face nova: o divisor da taxa para o rAt (0-1). Curva que desce mais cedo que a da estavel:
   *  0 = taxa cheia, 0,35 (o padrao) ~ 8 kHz, 0,5 ~ 5 kHz, 1 = 1 kHz (na taxa de 48 kHz). */
  const lofiDownNf = v => Math.pow(48, Math.pow(clamp(v, 0, 1), 0.75));
  RJ.d4LofiDownNf = lofiDownNf;
  /** 7. Lo-fi / Bit Crush (worklet): bits, taxa de amostragem e tom.
   *  Face nova (MFX 14): relogio uniforme no worklet (mode 1, sem o chiado do tremor de relogio) e a curva lofiDownNf. */
  function lofi(ctx, env) {
    const nf = !!(env && env.nf);   // face nova: bits inteiros (degraus de 2^bits)
    const input = ctx.createGain(), output = ctx.createGain();
    const node = workletNode(ctx, "d4-crush", nf ? { mode: 1 } : null);
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.Q.value = 0.5;
    input.connect(node).connect(tone).connect(output);
    const P = k => node.parameters.get(k);
    return {
      input, output,
      set(i, v) {
        if (i === 0) { if (nf) P("bits").setValueAtTime(lofiBits(v), ctx.currentTime); else P("bits").setTargetAtTime(16 - v * 13, ctx.currentTime, 0.01); }
        if (i === 1) P("down").setTargetAtTime(nf ? lofiDownNf(v) : exp(v, 1, 40), ctx.currentTime, 0.01);
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

  /* ---------------------------------------------------------------- Onda 2 (face nova): MFX 3-10 e 18 */

  /** O mapa 0-1 -> unidade de cada Ctrl dos MFX da Onda 2 (o worklet d4-mfx recebe ja na unidade; os testes leem daqui). */
  RJ.d4Mfx = {
    chorus: { depth: v => 5 * v, rate: v => exp(v, 0.1, 8), mix: v => v },                           // ms, Hz
    flanger: { width: v => 0.2 + 7.8 * v, fb: v => 0.85 * v, rate: v => exp(v, 0.05, 8), mix: v => v }, // d-r: largura e ressonancia juntas
    phaser: { oct: v => 1 + 4.5 * v, fb: v => 0.75 * v, rate: v => exp(v, 0.05, 8), mix: v => v },
    tremolo: { depth: v => v, rate: v => exp(v, 0.3, 15) },
    wah: { sens: v => 6 * v, freq: v => exp(v, 300, 2500), q: v => 0.7 + 11 * v * v },
    ring: { freq: v => exp(v, 20, 2000), sens: v => 8 * v, mix: v => v },
    // drives: ganho antes da curva (Ctrl 1), passa-baixa do tom (Ctrl 2, Hz) e nivel (Ctrl 3: 0,7 = mesmo nivel)
    drive: {
      od: { pre: v => exp(v, 1, 25), tone: v => exp(v, 1200, 16000) },
      dist: { pre: v => exp(v, 2, 150), tone: v => exp(v, 800, 12000) },
      fuzz: { pre: v => exp(v, 3, 300), tone: v => exp(v, 800, 12000) },
      level: v => 1.4 * v,
    },
  };
  const MX = RJ.d4Mfx;

  /** Um MFX do worklet d4-mfx. map[i] = a lista de [parametro, funcao 0-1 -> unidade] que o Ctrl i move. */
  function modFx(mode, map) {
    return function (ctx) {
      const node = new AudioWorkletNode(ctx, "d4-mfx", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { mode },
      });
      const P = k => node.parameters.get(k);
      let rst = 0, offAt = -1;
      return {
        input: node, output: node,
        set(i, v) { (map[i] || []).forEach(([k, f]) => P(k).setValueAtTime(f(clamp(v, 0, 1)), ctx.currentTime)); },
        // ao entrar no bus: linhas, filtros e envelope zerados (nada da ultima vez) e o LFO do comeco. O D4Slot so abre o
        // molhado 15 ms depois, entao o zero cai com ele fechado. Religado em menos de 0,1 s (o D4Slot so desliga a saida velha aos 0,12 s) o molhado velho ainda esta
        // sumindo: ai nao zera (seria um degrau nele)
        active(a) {
          if (!a) { offAt = ctx.currentTime; return; }
          if (offAt < 0 || ctx.currentTime - offAt > 0.1) P("rst").setValueAtTime(++rst, ctx.currentTime);
        },
      };
    };
  }
  /** 3. Chorus: DEPTH (dBt), RATE (rAt), BALANCE (o manual nao da codigo). */
  const chorus = modFx(0, [[["p0", MX.chorus.depth]], [["p1", MX.chorus.rate]], [["p2", MX.chorus.mix]]]);
  /** 4. Flanger (Send/Return ligado, o de fabrica, manual p. 19): DEPTH/RESONANCE (d-r) juntos, RATE (rAt), BALANCE (bAL). */
  const flanger = modFx(1, [[["p0", MX.flanger.width], ["p3", MX.flanger.fb]], [["p1", MX.flanger.rate]], [["p2", MX.flanger.mix]]]);
  /** 5. Phaser: o mesmo mapa do Flanger. */
  const phaser = modFx(2, [[["p0", MX.phaser.oct], ["p3", MX.phaser.fb]], [["p1", MX.phaser.rate]], [["p2", MX.phaser.mix]]]);
  /** 6. Tremolo/Pan: DEPTH (dPt), RATE (rAt), WAVEFORM (trM/PAn: esquerda tremolo, direita pan; nas pontas quadrada). */
  const tremolo = modFx(3, [[["p0", MX.tremolo.depth]], [["p1", MX.tremolo.rate]], [["p2", v => v]]]);
  /** 10. Wah: SENS (SnS), FREQUENCY (Frq), RESONANCE (rES). Insercao (sem balance, como no manual). */
  const wah = modFx(4, [[["p0", MX.wah.sens]], [["p1", MX.wah.freq]], [["p2", MX.wah.q]]]);
  /** 18. Ring Mod: FREQUENCY (Frq), SENS (SEn: a portadora sobe com o volume), BALANCE (bAL). */
  const ringmod = modFx(5, [[["p0", MX.ring.freq]], [["p1", MX.ring.sens]], [["p2", MX.ring.mix]]]);

  // as curvas dos drives (entrada -4..4); o WaveShaper prende o que passa de 4 na ponta (ja saturada)
  const DRIVE_CURVE = {
    od: x => Math.tanh(x),                                              // suave, simetrica (harmonicos impares)
    dist: x => x / Math.pow(1 + Math.pow(Math.abs(x), 5), 0.2),         // joelho duro
    fuzz: x => { const b = 0.35; return Math.tanh(2 * (x + b)) - Math.tanh(2 * b); },   // assimetrica (pares e impares)
  };
  RJ.d4DriveCurve = DRIVE_CURVE;
  /** 7-9. Distortion, Overdrive, Fuzz: DRIVE (drV), TONE (ton), LEVEL (LEV). Insercao.
   *  ganho -> WaveShaper (4x) -> passa-altas 20 Hz (o Fuzz cria DC) -> passa-baixa do tom -> compensacao -> nivel.
   *  A compensacao deixa um seno de -9 dB (0,35) com o mesmo pico com qualquer DRIVE (o volume nao pula). */
  function driveFx(kind) {
    const F = DRIVE_CURVE[kind], Mk = MX.drive[kind];
    let peak = 0;   // o maior |curva| na faixa: a curva sai normalizada (pico 1)
    for (let i = 0; i <= 800; i++) peak = Math.max(peak, Math.abs(F(-4 + i / 100)));
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = F((i / 2048 - 1) * 4) / peak;
    // o pico a pico de um seno de 0,35 depois da curva, sobre 2: o ganho que devolve 0,35
    const comp = g => { const x = Math.min(4, 0.35 * g), y = (F(x) - F(-x)) / 2 / peak; return 0.35 / Math.max(1e-3, y); };
    return function (ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      const pre = ctx.createGain(), sh = ctx.createWaveShaper(), dc = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), post = ctx.createGain();
      sh.curve = curve; sh.oversample = "4x";
      dc.type = "highpass"; dc.frequency.value = 20; dc.Q.value = -3.01;   // Q em dB: Butterworth
      lp.type = "lowpass"; lp.Q.value = -3.01;
      input.connect(pre).connect(sh).connect(dc).connect(lp).connect(post).connect(output);
      const seen = [false, false, false];
      // o primeiro valor de cada Ctrl (na criacao) entra direto; depois desliza
      const put = (i, p, v, tc) => { if (seen[i]) glide(p, v, ctx, tc); else { hold(p, ctx.currentTime); p.setValueAtTime(v, ctx.currentTime); } };
      return {
        input, output,
        set(i, v) {
          v = clamp(v, 0, 1);
          // o WaveShaper le -1..1 como -4..4: o ganho entra dividido por 4
          if (i === 0) { const g = Mk.pre(v); put(0, pre.gain, g / 4); put(0, post.gain, comp(g)); }
          if (i === 1) put(1, lp.frequency, Mk.tone(v), 0.01);
          if (i === 2) put(2, output.gain, MX.drive.level(v));
          if (i < 3) seen[i] = true;
        },
      };
    };
  }
  const distortion = driveFx("dist"), overdrive = driveFx("od"), fuzz = driveFx("fuzz");
  const showTrem = v => (v < 0.5 ? "trM" : "PAn");

  // visor da face nova: o valor do Ctrl como o manual mostra (p. 20-22); null = 0-127
  const showDelayNf = (v, bpm) => DELAY_NF_SHOW[delayNfIdx(v, bpm)];
  const showSemi = v => String(pitchSemi(v));
  const showSpeed = v => { const s = v * 2 - 1; return (Math.abs(s) < 0.05 ? 0 : s).toFixed(1); };   // -1.0 a 1.0
  const showSw = v => (v >= 0.5 ? "on" : "oFF");

  /**
   * A lista. n: o numero no display da pagina estavel (F.01 a F.09); caps: as legendas de Ctrl 1-3;
   * def: os valores de inicio; mfx: entra pelo MFX da estavel (pad 1-4); worklet: precisa do worklet.
   * Face nova (ordem do manual, p. 20-22): dir = botao direto 1-5 (visor "F.1".."F.5"); m = MFX 1-24 (visor "1".."24");
   * m 25 = extra fora do manual (Stopper, visor "StP"); codes = o codigo do Ctrl no visor (manual; null = so o valor);
   * show = como o valor aparece (null = 0-127; recebe (v, bpm)); soon = so o lugar na lista (o som ainda nao existe: nao liga);
   * nfK = na face nova, o parametro que cada Ctrl move (o estado guarda por parametro: as duas faces leem o mesmo).
   * make(ctx, env): env.nf = face nova (Delay com a tabela do manual; Lo-fi com bits inteiros).
   */
  RJ.D4FX = [
    { id: "filter", n: 1, dir: 1, name: "Filter+Drive", caps: ["Cutoff", "Reso", "Drive"], codes: ["CoF", "rES", "drV"], def: [0.75, 0.3, 0.2], make: filterDrive },
    // nfK: na face nova o Ctrl k move o parametro nfK[k] (ordem do manual); show/codes sao por Ctrl da face nova
    { id: "pitch", n: null, dir: 2, name: "Pitch", caps: ["Pitch", "Feedbk", "Balance"], codes: ["Pit", "Fdb", "bAL"], show: [showSemi, null, null], def: [0.5, 0, 1], make: pitch, worklet: true },
    // Delay: parametro 0 = nota da estavel (9 notas), 3 = nota da face nova (t32-t1, def t8); 2 = Level na estavel, BALANCE na face nova
    { id: "delay", n: 3, dir: 3, name: "Delay", caps: ["Time", "Feedbk", "Level"], codes: [null, "Fdb", "bAL"], show: [showDelayNf, null, null], nfK: [3, 1, 2], def: [0.5, 0.4, 0.5, 4 / 12], make: delay },
    { id: "isolator", n: 2, dir: 4, name: "Isolator", caps: ["Low", "Mid", "High"], codes: ["Lo", "Mid", "Hi"], def: [0.5, 0.5, 0.5], make: isolator },
    // Vinyl: na face nova o Ctrl 1 e o COMPRESSOR (parametro 3); a faixa (0) fica no valor guardado
    { id: "vinyl", n: 4, dir: 5, name: "Vinyl Sim", caps: ["Freq", "Noise", "Wow"], codes: ["CMP", "noS", "FLu"], nfK: [3, 1, 2], def: [0.45, 0.35, 0.3, 0.5], make: vinyl },
    { id: "reverb", n: 6, m: 1, name: "Reverb", caps: ["Time", "Tone", "Level"], codes: ["tiM", "ton", "bAL"], def: [0.5, 0.6, 0.45], make: reverb, mfx: 1 },
    // Onda 2 (so a face nova: sem n nem mfx, a estavel nao os ve). Flanger e Phaser no mapa do Send/Return ligado (o de fabrica)
    { id: "chorus", m: 3, name: "Chorus", caps: ["Depth", "Rate", "Balance"], codes: ["dBt", "rAt", null], def: [0.5, 0.3, 0.5], make: chorus, worklet: true },
    { id: "flanger", m: 4, name: "Flanger", caps: ["Depth/Reso", "Rate", "Balance"], codes: ["d-r", "rAt", "bAL"], def: [0.5, 0.35, 0.5], make: flanger, worklet: true },
    { id: "phaser", m: 5, name: "Phaser", caps: ["Depth/Reso", "Rate", "Balance"], codes: ["d-r", "rAt", "bAL"], def: [0.5, 0.35, 0.5], make: phaser, worklet: true },
    { id: "tremolo", m: 6, name: "Tremolo/Pan", caps: ["Depth", "Rate", "Waveform"], codes: ["dPt", "rAt", null], show: [null, null, showTrem], def: [0.7, 0.45, 0.25], make: tremolo, worklet: true },
    { id: "distortion", m: 7, name: "Distortion", caps: ["Drive", "Tone", "Level"], codes: ["drV", "ton", "LEV"], def: [0.5, 0.5, 0.7], make: distortion },
    { id: "overdrive", m: 8, name: "Overdrive", caps: ["Drive", "Tone", "Level"], codes: ["drV", "ton", "LEV"], def: [0.4, 0.6, 0.7], make: overdrive },
    { id: "fuzz", m: 9, name: "Fuzz", caps: ["Drive", "Tone", "Level"], codes: ["drV", "ton", "LEV"], def: [0.5, 0.5, 0.7], make: fuzz },
    { id: "wah", m: 10, name: "Wah", caps: ["Sens", "Freq", "Reso"], codes: ["SnS", "Frq", "rES"], def: [0.6, 0.3, 0.5], make: wah, worklet: true },
    { id: "ringmod", m: 18, name: "Ring Mod", caps: ["Freq", "Sens", "Balance"], codes: ["Frq", "SEn", "bAL"], def: [0.4, 0, 0.75], make: ringmod, worklet: true },
    { id: "comp", n: 8, m: 12, name: "Compressor", caps: ["Sustain", "Attack", "Level"], codes: ["SuS", "Att", "LEV"], def: [0.5, 0.3, 0.4], make: compressor, mfx: 3 },
    // Lo-fi: os parametros sao Bits, Rate, Tone (a estavel); na face nova o Ctrl 1 e SAMPLE RATE e o 2 e BIT, como no manual
    { id: "lofi", n: 7, m: 14, name: "Lo-fi", caps: ["Bits", "Rate", "Tone"], codes: ["rAt", "bit", "FLt"], show: [null, v => String(lofiBits(v)), null], nfK: [1, 0, 2], def: [0.55, 0.35, 0.6], make: lofi, mfx: 2, worklet: true },
    { id: "djfx", n: 5, m: 24, name: "DJFX Looper", caps: ["Length", "Speed", "Loop"], codes: ["LEn", null, null], show: [null, showSpeed, showSw], def: [0.5, 1, 1], make: djfx, worklet: true },
    { id: "stopper", n: 9, m: 25, name: "Stopper", caps: ["Time", "Type", "Trig"], codes: [null, null, null], def: [0.4, 0, 1], make: stopper, mfx: 4, worklet: true },
  ];
  RJ.D4FX.byId = id => RJ.D4FX.find(f => f.id === id) || null;
  RJ.D4FX.mfx = k => RJ.D4FX.find(f => f.mfx === k) || null;   // estavel: MFX pad 1-4
  RJ.D4FX.byM = k => RJ.D4FX.find(f => f.m === k) || null;     // face nova: MFX 1-24 (+ 25 extra)
  RJ.D4FX.MFX_MAX = 25;                                         // o CTRL 3 com [MFX] vai de 1 a 24 e o extra (Stopper)
  // os 24 MFX do manual (p. 20-22), na ordem do painel: o nome de cada numero (os que ainda nao existem nao ligam)
  RJ.D4FX.MFX_NAMES = ["Reverb", "Tape Echo", "Chorus", "Flanger", "Phaser", "Tremolo/Pan", "Distortion", "Overdrive", "Fuzz", "Wah",
    "Octave", "Comp", "Equalizer", "Lo-Fi", "Noise Gen", "Radio Tuning", "Slicer", "Ring Mod", "Chromatic PS", "Voice Trans",
    "C.Canceler", "Subsonic", "BPM Looper", "DJFX Looper"];
  /** Os numeros antigos -> o efeito: F.01-F.09 da estavel e o MFX pad 1-4 (o estado guarda o id; isto le um numero solto). */
  RJ.D4FX.OLD_N = { 1: "filter", 2: "isolator", 3: "delay", 4: "vinyl", 5: "djfx", 6: "reverb", 7: "lofi", 8: "comp", 9: "stopper" };
  RJ.D4FX.OLD_MFX = { 1: "reverb", 2: "lofi", 3: "comp", 4: "stopper" };
  /** id, numero antigo (5 ou "F.05") ou nada -> id valido ou null. mfx = true le o numero como o MFX pad 1-4 antigo. */
  RJ.D4FX.fromOld = (x, mfx = false) => {
    if (typeof x === "string" && RJ.D4FX.byId(x)) return x;
    const m = typeof x === "number" ? x : typeof x === "string" ? /^\s*(?:F\.?)?0*(\d+)\s*$/i.exec(x) : null;
    const k = typeof m === "number" ? m : m ? +m[1] : NaN;
    return (mfx ? RJ.D4FX.OLD_MFX : RJ.D4FX.OLD_N)[k] || null;
  };

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
