/* DCX-404 face nova - Pattern Sequencer na face (Fase 4 / B1)
 *
 * Liga o relogio do js/sequencer.js (RJ.D4Seq) aos botoes, pads, visor e knobs da face nova, pelo gancho
 * d404.seqHook do motor (js/dcx404.js chama: key, pad, hit, release, cancel, ctrl, display, renderPads,
 * renderButtons, ownsPads, ptn). Manual do SP-404 p. 34-37:
 *   PATTERN SELECT aceso = "Ptn": bancos A-E escolhem o banco de patterns, pads com pattern piscam, um pad
 *   toca o pattern dele em loop no BPM; outro pad tocando = reservado (entra no fim do loop); SUB PAD + pad =
 *   troca na hora; o pad que esta tocando (ou CANCEL) para.
 *   Gravar: PATTERN SELECT -> REC (pads sem pattern piscam) -> banco -> pad (REC pisca, metronomo) ->
 *   LENGTH / QUANTIZE / START/END/LEVEL + CTRL 3, TIME/BPM + CTRL 2 -> REC (contagem -4..-1) -> pads
 *   (gravacao em loop, overdub; REC de novo = rehearsal "rEH") -> CANCEL (para; o ponto pisca enquanto salva).
 * Fica para o B2/B3: DEL (ErS/dEL/dAL), CHG, mute, disquete.
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  const S = RJ.D4Seq;
  const BANKS = "ABCDE";

  window.addEventListener("DOMContentLoaded", () => {
    const d = RJ.d404;
    if (!d || !S) return;
    const PADS = RJ.D404.PADS, NB = RJ.D404.BANKS, SLOTS = RJ.D404.SLOTS;
    // ptn: PATTERN SELECT aceso; stage: null | "arm" (REC, escolhendo o pad) | "ready" (espera) | "rec" (contagem/gravando)
    // sel: o que o CTRL 3 ajusta ("len" LENGTH, "q" QUANTIZE, "metro" START/END/LEVEL); ate = pads da tela apertados pelo sequenciador
    const U = { ptn: false, stage: null, sel: null, sub: false, saveUntil: 0, ate: new Set(), recKey: -1 };

    const data = () => {
      const st = d.st;
      if (!st.seq || st.seq.v !== 1 || !st.seq.pats) st.seq = S.clean(st.seq, SLOTS, NB);
      return st.seq;
    };
    const ctx = () => d.g && d.g.ctx;
    const now = () => (ctx() ? ctx().currentTime : 0);
    const has = k => { const p = data().pats[k]; return !!(p && p.ev.length); };
    const pbank = () => data().bank;
    const show = k => d.padShow(k);   // "A.01": o pattern do banco A, pad 1

    /* ---------------------------------------- metronomo (so na espera e gravando, p. 35) */
    let clk = null;
    function clicks(c) {
      if (clk && clk.ctx === c) return clk;
      const mk = (f, a) => {
        const n = Math.round(c.sampleRate * 0.03), b = c.createBuffer(1, n, c.sampleRate), x = b.getChannelData(0);
        for (let k = 0; k < n; k++) x[k] = a * Math.sin(2 * Math.PI * f * k / c.sampleRate) * Math.exp(-k / (c.sampleRate * 0.006));
        return b;
      };
      const g = c.createGain();
      g.connect(d.g.vol);   // depois dos efeitos, antes do Volume (o Resample nao grava o metronomo)
      return (clk = { ctx: c, hi: mk(1600, 0.9), lo: mk(1000, 0.7), g });
    }
    function click(when, strong) {
      const c = ctx();
      if (!c || !d.g) return;
      const k = clicks(c), lv = data().metro;
      if (lv <= 0) return;
      const src = c.createBufferSource();
      src.buffer = strong ? k.hi : k.lo;
      const g = c.createGain(); g.gain.value = lv * lv;
      src.connect(g).connect(k.g);
      src.start(Math.max(when, c.currentTime));
      src.onended = () => g.disconnect();
    }

    /* ---------------------------------------- o relogio */
    const seq = new S({
      now, bpm: () => d.st.bpm, data,
      play: (s, when) => { if (!d.buf[s] || !d.g) return null; d.play(s, 1, when); return d.voice[s]; },
      // Gate: solta a voz que esta nota abriu, mesmo se outra nota do pad ja a substituiu no motor
      off: (s, when, v) => { if (d.st.pads[s].gate && !d.st.hold) stopV(s, v, when); },
      cut: (vs, t) => vs.forEach(x => {
        // PATTERN STOP: o que ia tocar nao toca; pad em Loop ou Gate para (senao toca ate o fim); o resto termina sozinho
        const p = d.st.pads[x.s];
        if (x.when > t + 0.001 || p.loop || (p.gate && !d.st.hold)) stopV(x.s, x.v, t);
      }),
      look: () => (document.hidden ? 1.2 : S.LOOK),
      click,
      change: () => { d.renderPads(); d.renderButtons(); },
    });
    RJ.d4seq = seq;   // console/QA
    /** Para a voz v do pad s (a do motor pelo stopVoice; uma ja substituida, direto no no). */
    function stopV(s, v, when) {
      if (!v || !d.g) return;
      if (d.voice[s] === v) { d.stopVoice(s, when); return; }
      const c = d.g.ctx, t = Math.max(when || 0, c.currentTime);
      try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.003); v.src.stop(t + 0.03); } catch (e) { /* ja parou */ }
    }

    /* ---------------------------------------- acoes */
    const render = () => { d.render(); };
    const flash = (t, ms) => d.flash(t, "pad", ms || 900);
    function setPtn(on) {
      if (on && d.smp && d.smp.stage === "rec") return;   // gravando sample: PATTERN SELECT espera o REC parar
      U.ptn = on; U.sub = false;
      if (on) {
        if (d.smp && d.smp.stage !== "rec") d.cancelSmp();   // REC de sample em espera: sai (o REC vira do pattern)
        if (d.delMode) d.cancelDel();
        d.endMfxPick();
      }
      U.ate.clear();
      render();
    }
    function arm() {
      U.stage = "arm"; U.sel = null;
      d.sedExit();
      render();
    }
    function ready(k) {
      U.stage = "ready"; U.recKey = k;
      seq.ready(k);
      render();
      flash(show(k), 900);
    }
    function startRec() {
      U.stage = "rec";
      if (U.sel === "len") U.sel = null;   // LENGTH so na espera
      seq.rec();
      render();
    }
    function endRec() {
      const r = seq.stopRec();
      U.stage = null; U.sel = null; U.recKey = -1;
      U.saveUntil = performance.now() + 700;   // o ponto pisca enquanto salva (p. 35; aqui: nao feche a aba)
      d.dirty();
      setTimeout(() => { d.saveNow(); U.saveUntil = 0; render(); }, 720);
      render();
      return r;
    }
    function quitStandby() { seq.stop(); U.stage = null; U.sel = null; U.recKey = -1; render(); }

    /** O pad da tela t no modo pattern (fora da gravacao). */
    function padPattern(t) {
      const k = pbank() * PADS + t;
      if (U.stage === "arm") { ready(k); return; }   // destino: pad vazio (novo) ou com pattern (overdub, ESTIMATIVA p. 36)
      if (!has(k)) return;                           // pad sem pattern: nada (p. 34)
      if (seq.mode === "play" && seq.key === k) { seq.stop(); flash("Ptn", 500); }                    // o pad tocando para (p. 34)
      else if (seq.mode === "play" && !U.sub) { seq.reserve(k); flash(show(k)); }                     // reserva (fim do loop)
      else { seq.start(k); flash(show(k)); }                                                         // ja (ou SUB PAD + pad)
      d.renderPads();
    }

    function ctrl3Get() {
      if (U.sel === "len") return S.LENGTHS.indexOf(seq.recLen) / (S.LENGTHS.length - 1);
      if (U.sel === "q") return S.QUANT.findIndex(q => q.id === data().quant) / (S.QUANT.length - 1);
      return data().metro;
    }
    function ctrl3Set(v) {
      if (U.sel === "len") {
        const want = S.LENGTHS[Math.round(v * (S.LENGTHS.length - 1))], got = seq.setLen(want);
        flash(String(got), 1500);
      } else if (U.sel === "q") {
        data().quant = S.QUANT[Math.round(v * (S.QUANT.length - 1))].id;
        flash(S.qOf(data().quant).show, 1500);
        d.dirty();
      } else {
        data().metro = v;
        flash(String(Math.round(v * 127)), 1500);
        d.dirty();
      }
    }
    function selShow() {
      if (U.sel === "len") return String(seq.recLen);
      if (U.sel === "q") return S.qOf(data().quant).show;
      return String(Math.round(data().metro * 127));
    }

    /* ---------------------------------------- o gancho do motor */
    d.seqHook = {
      ptn: () => U.ptn || !!U.stage,
      /** Estado novo (disquete/projeto aberto, abortRecs): para o pattern e a gravacao, PATTERN SELECT continua como esta. */
      reset() {
        if (seq.mode !== "idle") seq.stop();
        U.stage = null; U.sel = null; U.sub = false; U.recKey = -1; U.ate.clear();
      },
      ownsPads: () => U.ptn && (!U.stage || U.stage === "arm"),

      key(id, down) {
        const live = U.ptn || !!U.stage;
        if (id === "pattern-select") {
          if (down && !U.stage) setPtn(!U.ptn);   // gravando: PATTERN SELECT nao sai
          return true;
        }
        if (id === "length" || id === "quantize") {
          if (!down) return true;
          const want = id === "length" ? "len" : "q";
          const ok = id === "length" ? U.stage === "ready" : U.stage === "ready" || U.stage === "rec";
          if (!ok) { if (live) flash("---", 500); return true; }
          U.sel = U.sel === want ? null : want;   // QUANTIZE acende e apaga o LENGTH (p. 35); apagar confirma
          d.sedExit();
          render();
          if (U.sel) flash(selShow(), 1500);
          return true;
        }
        if (!live) return false;
        if (id === "start-end" && (U.stage === "ready" || U.stage === "rec")) {   // + CTRL 3 = volume do metronomo (p. 35)
          if (down) { U.sel = U.sel === "metro" ? null : "metro"; d.sedExit(); render(); if (U.sel) flash(selShow(), 1500); }
          return true;
        }
        if (id === "time-bpm") { if (down && U.sel) { U.sel = null; d.renderButtons(); } return false; }   // TIME/BPM + CTRL 2 = BPM global
        if (id === "rec") {
          if (d.rec || d.smp) return false;   // Resample ou REC de sample em curso: o REC e deles (como sempre)
          if (!down) return true;
          if (!U.stage) arm();
          else if (U.stage === "arm") { U.stage = null; render(); }
          else if (U.stage === "ready") startRec();
          else { seq.reh = !seq.reh; render(); }   // rehearsal (p. 35): pads soam e nao gravam
          return true;
        }
        if (/^bank-[a-e]$/.test(id) && U.ptn && (!U.stage || U.stage === "arm")) {
          if (down) {
            const b = BANKS.indexOf(id.slice(5).toUpperCase());
            if (b >= 0 && b < NB) { data().bank = b; d.dirty(); render(); flash("b-" + BANKS[b], 700); }
          }
          return true;
        }
        if (id === "subpad" && !down) U.sub = false;
        if (id === "subpad" && U.ptn && !U.stage) { U.sub = down; return true; }   // SUB PAD + pad = troca na hora
        if (id === "del") { if (down) flash("---", 500); return true; }          // apagar pattern/notas: B2
        return false;
      },

      pad(t) {
        if (!(U.ptn && (!U.stage || U.stage === "arm"))) return false;   // espera/gravando: o pad toca o sample
        U.ate.add(t);
        padPattern(t);
        return true;
      },
      hit(s) {
        if (U.stage !== "rec") return;
        if (seq.hit(s) === "full") flash("FuL", 900);
      },
      release(t, s) {
        if (U.ate.delete(t)) return true;
        if (U.stage === "rec") seq.release(s);
        return false;
      },
      cancel(late) {
        if (!late) {
          if (U.stage === "rec") { endRec(); return true; }
          if (U.stage) { quitStandby(); return true; }
          return false;
        }
        if (seq.mode === "play") { seq.stop(); flash(U.ptn ? "Ptn" : "---", 500); d.renderPads(); return true; }
        return false;
      },
      ctrl(k, v) {
        if (k !== 2 || !U.sel) return undefined;
        if (v === undefined) return ctrl3Get();
        ctrl3Set(v);
        return true;
      },
      /** O visor: devolve true quando desenhou (o motor nao desenha o dele). */
      display() {
        const txt = baseText();
        if (txt == null) return false;
        d.drawDisplay(txt, "pad");
        return true;
      },
      renderPads(els) {
        if (!(U.ptn && (!U.stage || U.stage === "arm"))) return;
        els.forEach((el, t) => {
          const k = pbank() * PADS + t, h = has(k);
          const playing = seq.mode === "play" && seq.key === k, next = seq.mode === "play" && seq.next === k;
          el.classList.toggle("used", h);
          if (U.stage === "arm") { el.classList.toggle("hit", !h); el.classList.toggle("blink", !h); }   // destinos livres piscam (p. 34)
          else { el.classList.toggle("hit", h); el.classList.toggle("blink", h && !playing); }          // com pattern piscam; o tocando fica aceso
          el.title = h ? "Pattern " + show(k) + (playing ? " (tocando)" : next ? " (reservado)" : "") : "";
          el.setAttribute("aria-label", "Pattern " + d.padLabel(k) + (h ? (playing ? ": tocando" : next ? ": reservado" : "") : " (vazio)"));
        });
      },
      renderButtons() {
        const b = d.btn;
        d.led("pattern-select", U.ptn);
        d.led("rec", !!(U.stage || d.smp || d.rec));
        if (b.rec) b.rec.classList.toggle("blink", !!(d.on && ((d.smp && d.smp.stage === "ready") || U.stage === "ready" || (U.stage === "rec" && seq.reh))));
        d.led("length", U.sel === "len");
        d.led("quantize", U.sel === "q");
        if (U.sel === "metro") d.led("start-end", true);
      },
    };

    /** O que o visor mostra no modo pattern (null = o do motor). Manual p. 34-35 e 49. */
    function baseText() {
      if (d.rec || d.smp || d.sed || d.delMode) return null;   // Resample, REC de sample, TIME/BPM (o BPM), DEL: o motor
      if (U.sel) return selShow();
      if (U.saveUntil) return Math.floor((U.saveUntil - performance.now()) / 120) % 2 ? "Ptn." : "Ptn";   // ponto piscando: salvando
      if (U.stage === "rec") {
        const p = seq.pos();
        if (p.count) return String(p.count);   // -4 -3 -2 -1
        return seq.reh ? "rEH" : "rEC";
      }
      if (U.stage === "ready") return show(U.recKey);
      if (U.ptn) return "Ptn";
      return null;
    }

    // o visor anda sozinho na contagem e no ponto do salvar (o resto muda por toque)
    setInterval(() => {
      if (!d.on) return;
      if (!(U.stage === "rec" || U.saveUntil)) return;
      const t = baseText();   // gravando, o visor fica na contagem / rEC / rEH (o nome do pad tocado nao fica por cima)
      if (t != null && t !== d.shown) d.showBase();
    }, 25);
    // estado novo (disquete aberto, por exemplo) sem o pattern tocando: o relogio para sozinho (tick)
    render();
  });
})();
