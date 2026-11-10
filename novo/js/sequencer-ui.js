/* DCX-404 face nova - Pattern Sequencer na face (Fase 4 / B1-B3)
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
 * B2 (p. 36-37): gravando, DEL aceso = "ErS" (segurar um pad apaga as notas dele no trecho; segurar HOLD apaga as de
 *   todos; DEL de novo volta a gravar). Fora da gravacao, com PATTERN SELECT: DEL = "dEL" (pads com pattern piscam,
 *   escolha um ou mais do mesmo banco, DEL apaga; "EMP" banco vazio, "Prt" protegido); CANCEL + DEL = "dAL" (bancos
 *   piscam; um banco = a memoria toda; DEL apaga); DEL + REC = "CHG" (pad de origem, pad de destino, que pode ser
 *   vazio, REC troca os dois). CANCEL desiste.
 * B3: um so pattern reservado (o ultimo pad vale; o reservado de novo nao muda nada; o que se ouve de novo para);
 *   CANCEL 4x rapido = silencia tudo (p. 8); fechar a aba com o ponto piscando (salvando) ou gravando = aviso (p. 36).
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
    // op: null | { kind: "del", sel: Set } | { kind: "dal", on: bool } | { kind: "chg", from: -1, to: -1 } (apagar/trocar, B2)
    // ers: DEL aceso gravando ("ErS"); erp: pad da tela -> pad guardado sendo apagado; ersHold: HOLD segurado no ErS
    const U = { ptn: false, stage: null, sel: null, sub: false, saveUntil: 0, saveTxt: "Ptn", ate: new Set(), recKey: -1,
      op: null, ers: false, erp: new Map(), ersHold: false, delDown: false, ersAte: new Set() };

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
      // troca marcada a frente (fim do loop): redesenha de novo na hora em que ela soa
      change: (what, k, t) => {
        d.renderPads(); d.renderButtons();
        const c = ctx();
        if (what === "switch" && c && t > c.currentTime) setTimeout(() => d.renderPads(), (t - c.currentTime) * 1000 + 15);
      },
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
        if (d.sed) d.sedExit();   // SAMPLE EDIT aberto: fecha (no modo pattern o START/END/LEVEL nao o fecharia)
        d.endMfxPick();
      }
      U.ate.clear(); U.op = null;
      render();
    }
    function arm() {
      U.stage = "arm"; U.sel = null;
      d.sedExit();
      render();
    }
    function ready(k) {
      if (has(k) && S.isProt(data(), Math.floor(k / PADS))) { U.stage = null; render(); flash("Prt", 900); return; }   // overdub em banco protegido
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
    /** O ponto pisca enquanto salva (p. 35-37; aqui: nao feche a aba), com txt no visor; depois grava o estado. */
    function saving(txt) {
      U.saveUntil = performance.now() + 700; U.saveTxt = txt || "Ptn";
      d.dirty();
      clearTimeout(d.flashTimer);
      clearTimeout(U.saveTimer);   // dois seguidos: o ponto (e o aviso ao fechar) vai ate o fim do ultimo
      U.saveTimer = setTimeout(() => { d.saveNow(); U.saveUntil = 0; render(); }, 720);
    }
    function ersEnd() {
      U.erp.forEach(s => seq.ersOff(s)); U.erp.clear();
      if (U.ersHold) seq.ersOff("all");
      U.ersHold = false; U.ers = false;
    }
    function endRec() {
      U.erp.clear(); U.ersHold = false; U.ers = false;   // o stopRec apaga ate aqui o que estiver segurado
      const r = seq.stopRec();
      U.stage = null; U.sel = null; U.recKey = -1;
      saving("Ptn");
      render();
      return r;
    }

    /* ---------------------------------------- apagar e trocar patterns (p. 36-37) */
    const bankHas = b => { for (let t = 0; t < PADS; t++) if (has(b * PADS + t)) return true; return false; };
    const anyPat = () => Object.keys(data().pats).some(k => has(+k));
    /** O que sai ou muda: se e o tocando (ou o reservado), o pattern para (ou a reserva cai). */
    function touch(keys) {
      if (keys.includes(seq.playing())) seq.stop();   // o que se ouve (na troca tardia, o antigo)
      else if (keys.includes(seq.pending())) { if (seq.sw && seq.sw.at > now()) seq.unswitch(); else seq.next = -1; }   // o reservado: a reserva cai
    }
    function opEnd(msg) { U.op = null; render(); if (msg) flash(msg, 500); }
    function opResult(r, txt) {
      if (r === "EMP" || r === "Prt" || r === "FuL") { U.op = null; render(); flash(r, 900); return false; }
      U.op = null; saving(txt); render();
      return true;
    }
    function delStart() {
      // nenhum pattern: "EMP" (p. 36); banco atual vazio com patterns em outro: entra (escolha o banco depois do DEL)
      if (!anyPat()) { flash("EMP", 900); return; }
      U.op = { kind: "del", sel: new Set() };
      clearTimeout(d.flashTimer);
      render();
    }
    function delGo() {
      const ks = [...U.op.sel];
      if (!ks.length) { opEnd("---"); return; }   // nada escolhido: DEL de novo sai sem apagar
      const dd = data();
      const r = S.isProt(dd, Math.floor(ks[0] / PADS)) ? "Prt" : (touch(ks), S.delPats(dd, ks, PADS));
      opResult(r, "dEL");
    }
    function dalStart() {
      if (!anyPat()) { flash("EMP", 900); return; }
      U.op = { kind: "dal", on: false };
      clearTimeout(d.flashTimer);
      render();
    }
    function dalGo() {
      if (!U.op.on) { opEnd("---"); return; }
      const dd = data(), ks = Object.keys(dd.pats).map(Number);
      const r = ks.some(k => S.isProt(dd, Math.floor(k / PADS))) ? "Prt" : (touch(ks), S.delAll(dd, PADS));
      opResult(r, "dAL");
    }
    function chgStart() {
      if (!anyPat()) { U.op = null; render(); flash("EMP", 900); return; }
      U.op = { kind: "chg", from: -1, to: -1 };
      clearTimeout(d.flashTimer);
      render();
    }
    function chgGo() {
      const o = U.op;
      if (o.from < 0 || o.to < 0) { flash("---", 500); return; }   // falta escolher a origem ou o destino
      const dd = data();
      const prt = S.isProt(dd, Math.floor(o.from / PADS)) || S.isProt(dd, Math.floor(o.to / PADS));
      const r = prt ? "Prt" : (touch([o.from, o.to]), S.swapPats(dd, o.from, o.to, PADS));
      opResult(r, "CHG");
    }
    function opPad(t) {
      const o = U.op, k = pbank() * PADS + t;
      if (o.kind === "del") {
        if (!has(k)) return;   // pad sem pattern: nada
        if (o.sel.has(k)) o.sel.delete(k); else o.sel.add(k);
        flash(show(k), 700);
      } else if (o.kind === "chg") {
        if (o.from < 0) { if (!has(k)) return; o.from = k; }        // origem: um pad com pattern
        else if (k === o.from) { if (o.to < 0) o.from = -1; else return; }   // a origem de novo: desescolhe (com destino: nada)
        else o.to = k === o.to ? -1 : k;                             // destino (pode ser vazio); de novo desescolhe
        flash(show(k), 700);
      }
      d.renderPads();
    }
    function quitStandby() { seq.stop(); U.stage = null; U.sel = null; U.recKey = -1; U.ers = false; render(); }

    /** O pad da tela t no modo pattern (fora da gravacao). */
    function padPattern(t) {
      const k = pbank() * PADS + t;
      if (U.stage === "arm") { ready(k); return; }   // destino: pad vazio (novo) ou com pattern (overdub, ESTIMATIVA p. 36)
      if (!has(k)) return;                           // pad sem pattern: nada (p. 34)
      if (seq.playing() === k) { seq.stop(); flash("Ptn", 500); }                                     // o pad que se ouve para (p. 34)
      else if (seq.mode === "play" && !U.sub) { seq.reserve(k); flash(show(k)); }   // reserva (fim do loop; nos ultimos ~120 ms o reserve desmarca e troca no fim)
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

    /* ---------------------------------------- CANCEL 4x rapido = silencia tudo (p. 8) */
    // ESTIMATIVA: "rapido" = cada toque ate 400 ms depois do anterior; os 3 primeiros fazem o CANCEL de sempre
    let taps = [];
    function tap() {
      const t = performance.now();
      if (taps.length && t - taps[taps.length - 1] >= 400) taps = [];
      taps.push(t);
      if (taps.length < 4) return false;
      taps = [];
      if (U.stage === "rec") endRec(); else if (U.stage) quitStandby();
      if (seq.mode !== "idle") seq.stop();
      U.op = null; U.sel = null; U.sub = false;
      d.stopAll();
      d.renderPads(); d.renderButtons();
      flash("---", 500);
      return true;
    }

    /* ---------------------------------------- fechar a aba salvando ou gravando (p. 36, 47-48) */
    const busy = () => !!(U.saveUntil || U.stage === "rec");
    window.addEventListener("beforeunload", e => { if (busy()) { e.preventDefault(); e.returnValue = ""; } });
    window.addEventListener("pagehide", () => { if (busy()) { try { d.saveNow(); } catch (err) { /* fechando */ } } });   // saiu mesmo assim: guarda o que ha

    /* ---------------------------------------- o gancho do motor */
    d.seqHook = {
      ptn: () => U.ptn || !!U.stage,
      tap,
      busy,
      /** Estado novo (disquete/projeto aberto, abortRecs): para o pattern e a gravacao, PATTERN SELECT continua como esta. */
      reset() {
        if (seq.mode !== "idle") seq.stop();
        U.stage = null; U.sel = null; U.sub = false; U.recKey = -1; U.ate.clear();
        U.op = null; U.ers = false; U.erp.clear(); U.ersHold = false; U.ersAte.clear(); U.delDown = false;
      },
      ownsPads: () => U.ptn && (!U.stage || U.stage === "arm"),

      key(id, down) {
        const live = U.ptn || !!U.stage;
        if (id === "pattern-select") {
          if (down && !U.stage) setPtn(!U.ptn);   // gravando: PATTERN SELECT nao sai
          return true;
        }
        if (id === "del" && !down) { U.delDown = false; return U.ptn || !!U.stage; }
        if (!(U.ptn || U.stage)) return false;
        // DEL (p. 36-37): gravando = ErS; com PATTERN SELECT = dEL; CANCEL segurado + DEL = dAL
        if (id === "del") {
          U.delDown = true;
          if (U.stage === "rec") {
            if (U.ers) ersEnd(); else U.ers = true;
            render();
            return true;
          }
          if (U.stage) { flash("---", 500); return true; }   // espera/escolhendo o destino: nada
          if (d.cancelHeld) {
            d.cancelHeld.used = true;
            if (U.op && U.op.kind === "dal") dalGo(); else { U.op = null; dalStart(); }
            return true;
          }
          if (!U.op) delStart();
          else if (U.op.kind === "del") delGo();
          else if (U.op.kind === "dal") dalGo();
          else opEnd("---");   // CHG: DEL de novo desiste
          return true;
        }
        // DEL + REC = CHG; no CHG o REC troca
        if (id === "rec" && down && !U.stage && U.ptn && !(d.rec || d.smp)) {
          if (U.delDown && (!U.op || U.op.kind !== "chg")) { chgStart(); return true; }
          if (U.op && U.op.kind === "chg") { chgGo(); return true; }
          if (U.op) return true;   // dEL/dAL: REC nao faz nada
        }
        // ErS: HOLD segurado apaga as notas de todos os pads enquanto estiver segurado (p. 36)
        if (id === "hold" && U.stage === "rec" && U.ers) {
          if (down) { if (seq.ersOn("all")) U.ersHold = true; } else if (U.ersHold) { seq.ersOff("all"); U.ersHold = false; }
          d.showBase();
          return true;
        }
        if (id === "hold" && !down && U.ersHold) { seq.ersOff("all"); U.ersHold = false; return true; }
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
        // PATTERN SELECT aceso, fora da gravacao: START/END/LEVEL nao abre o SAMPLE EDIT (p. 35: so o metronomo gravando)
        if (id === "start-end") { if (down) { if (U.op) opEnd(null); flash("---", 500); } return true; }
        if (U.op && (id === "time-bpm" || id === "length" || id === "quantize")) return true;   // apagando/trocando: nada
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
        if (/^bank-[a-e]$/.test(id) && U.op && U.op.kind === "dal") {
          // dAL: um banco = a memoria toda (o DCX tem uma so; no OG A/B = interna, C-J = cartao, p. 37); de novo desescolhe
          if (down) { U.op.on = !U.op.on; render(); flash(U.op.on ? "ALL" : "dAL", 700); }
          return true;
        }
        if (/^bank-[a-e]$/.test(id) && U.ptn && (!U.stage || U.stage === "arm")) {
          if (down) {
            const b = BANKS.indexOf(id.slice(5).toUpperCase());
            if (b >= 0 && b < NB) {
              data().bank = b; d.dirty();
              if (U.op && U.op.kind === "del") U.op.sel.clear();   // dEL: os escolhidos sao de um banco so (p. 36)
              render(); flash("b-" + BANKS[b], 700);
            }
          }
          return true;
        }
        if (id === "subpad" && !down) U.sub = false;
        if (id === "subpad" && U.ptn && !U.stage) { U.sub = down; return true; }   // SUB PAD + pad = troca na hora
        return false;
      },

      pad(t, s) {
        if (U.stage === "rec" && U.ers) {   // ErS: segurar o pad apaga as notas dele no trecho (o pad nao toca nem grava)
          U.ersAte.add(t);   // a soltura e do sequenciador mesmo que o ErS acabe antes
          if (!U.erp.has(t) && seq.ersOn(s)) U.erp.set(t, s);
          d.showBase();
          return true;
        }
        if (!(U.ptn && (!U.stage || U.stage === "arm"))) return false;   // espera/gravando: o pad toca o sample
        U.ate.add(t);
        if (U.op) opPad(t); else padPattern(t);
        return true;
      },
      hit(s) {
        if (U.stage !== "rec") return;
        if (seq.hit(s) === "full") flash("FuL", 900);
      },
      release(t, s) {
        if (U.erp.has(t)) { seq.ersOff(U.erp.get(t)); U.erp.delete(t); U.ersAte.delete(t); d.showBase(); return true; }
        if (U.ersAte.delete(t)) return true;
        if (U.ate.delete(t)) return true;
        if (U.stage === "rec") seq.release(s);
        return false;
      },
      cancel(late) {
        if (!late) {
          if (U.op) { opEnd("---"); return true; }   // dEL / dAL / CHG: desiste
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
        const o = U.op;
        els.forEach((el, t) => {
          const k = pbank() * PADS + t, h = has(k);
          if (o) {
            // dEL: com pattern piscam, escolhidos acesos; CHG: origem (com pattern) pisca, depois todos piscam como destino;
            // origem e destino escolhidos acesos; dAL: pads apagados (os bancos piscam)
            el.classList.toggle("used", h);
            let lit = false, bl = false;
            if (o.kind === "del") { lit = h; bl = h && !o.sel.has(k); }
            else if (o.kind === "chg") {
              const picked = k === o.from || k === o.to;
              lit = picked || (o.from < 0 ? h : o.to < 0); bl = !picked && lit;
            }
            el.classList.toggle("hit", lit); el.classList.toggle("blink", bl);
            el.title = h ? "Pattern " + show(k) : "";
            el.setAttribute("aria-label", "Pattern " + d.padLabel(k) + (h ? "" : " (vazio)") + (o.kind === "del" && o.sel.has(k) ? ": escolhido" : k === o.from ? ": origem" : k === o.to ? ": destino" : ""));
            return;
          }
          const playing = seq.playing() === k, next = seq.pending() === k;
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
        if (!(U.ptn || U.stage)) return;
        const o = U.op;
        d.led("del", !!(U.ers || (o && o.kind !== "chg")));
        if (o && o.kind === "chg") d.led("rec", true);
        // os bancos mostram o banco de patterns; no dAL piscam (escolhido: todos acesos)
        for (let k = 0; k < NB; k++) {
          const id = "bank-" + BANKS[k].toLowerCase(), el = b[id];
          if (!el) continue;
          const dal = o && o.kind === "dal";
          d.led(id, dal ? o.on : (U.ptn && !U.stage) || U.stage === "arm" ? k === pbank() : k === d.st.bank);
          el.classList.toggle("blink", !!(d.on && dal && !o.on));
        }
      },
    };

    /** O que o visor mostra no modo pattern (null = o do motor). Manual p. 34-35 e 49. */
    function baseText() {
      if (d.rec || d.smp || d.sed || d.delMode) return null;   // Resample, REC de sample, TIME/BPM (o BPM), DEL: o motor
      if (U.ers && U.stage === "rec") {   // ErS; segurando (apagando): o ponto pisca (p. 36)
        const busy = U.erp.size || U.ersHold;
        return busy && Math.floor(performance.now() / 120) % 2 ? "ErS." : "ErS";
      }
      if (U.sel) return selShow();
      if (U.saveUntil) return Math.floor((U.saveUntil - performance.now()) / 120) % 2 ? U.saveTxt + "." : U.saveTxt;   // ponto piscando: salvando
      if (U.op) return U.op.kind === "del" ? "dEL" : U.op.kind === "dal" ? "dAL" : "CHG";
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
