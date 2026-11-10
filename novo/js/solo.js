/* DCX-404 - pagina solo da face nova (novo/)
 *
 * O mesmo motor da pagina estavel (js/dcx404.js e js/fx.js) com 12 pads x 5 bancos.
 * Guarda com o prefixo "dcx404-novo/" e, na primeira abertura, copia o estado,
 * os samples (pads 1-16 viram A1-A12 e B1-B4) e o mapa MIDI da pagina estavel,
 * sem mexer nela.
 *
 * Teclado: 1-4 / Q-R / A-F = os 12 pads do banco; Z Hold, X Sub Pad, C e V banco
 * anterior e proximo (o mesmo lugar dos pads 13-16 do Arturia). Shift = Shift do 404.
 * MIDI padrao (Arturia Minilab3, canal 10): notas 36-47 pads do banco, 48 Hold,
 * 49 Sub Pad, 50 banco anterior, 51 proximo banco.
 * "Abrir disquete/projeto" (na barra de cima, ou arrastar o arquivo para a pagina): abre o
 * disquete do 404 (dcx-404.json) ou o projeto .zip do Studio com a mesma conversao (js/abrir.js).
 * "Salvar disquete" (ao lado): baixa o disquete desta pagina (60 pads + estado, envelope dcx-disk).
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  const PAD_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyA", "KeyS", "KeyD", "KeyF"];
  // teclas 13-16 (Z X C V) e notas 48-51: o mesmo papel nos dois mapas
  const EXTRA = [
    { code: "KeyZ", note: 48, id: "hold", name: "Hold" },
    { code: "KeyX", note: 49, id: "subpad", name: "Sub Pad" },
    { code: "KeyC", note: 50, bank: -1, name: "Bank -" },
    { code: "KeyV", note: 51, bank: +1, name: "Bank +" },
  ];
  const MIDI_CH = 10, NOTE0 = 36;
  const OLD = "dcx404/", NEW = "dcx404-novo/";

  window.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("d4");
    // o aparelho guarda em "dcx404-novo/dcx404/" (view "dcx404" numa pagina de outro nome);
    // o mapa MIDI e da pagina, em "dcx404-novo/midimap"
    const DEV = NEW + "dcx404/";
    const migrate = { [OLD + "state"]: DEV + "state", [OLD + "midimap"]: NEW + "midimap" };
    for (let i = 0; i < 16; i++) migrate[OLD + "pad/" + i] = DEV + "pad/" + i;
    const host = RJ.Host.solo(root.dataset.hostPage || "dcx404-novo", { migrate });
    const d404 = new RJ.D404(host.view("dcx404"));
    host.add("dcx404", d404, { label: "DCX-404", receive: f => d404.receive(f) });
    d404.build(root);
    const learnBar = new RJ.LearnBar(host, { root, bar: document.getElementById("learnbar") });
    const N = d404.padEls.length;

    // Mapa MIDI copiado da estavel: atalhos de controles que a face nova nao tem (Bus 1/2, Mute, Velocity, Set-up, Shift,
    // DJFX, Input Level, pads 13-16...) sao ignorados em silencio. Antes, uma copia intacta vai para "midimap.old" (uma vez);
    // a barra avisa uma vez quantos ficaram sem lugar. O mapa guardado so perde esses atalhos num Learn novo (Save/Enter):
    // ate la, qualquer gravacao do mapa devolve os antigos junto (nada se perde sem querer).
    const L = host.learn, load0 = L.load.bind(L), persist0 = L.persist.bind(L), save0 = L.save.bind(L), import0 = L.importData.bind(L);
    let dead = null;   // { tecla MIDI: atalho sem lugar } ainda guardados no mapa
    L.load = async function () {
      await load0();
      const gone = Object.keys(L.map).filter(k => !L.targets.has(L.map[k] && L.map[k].t));
      if (!gone.length) return;
      dead = {};
      gone.forEach(k => { dead[k] = L.map[k]; delete L.map[k]; });
      try {
        if (!(await L.store.get("midimap.old"))) { const raw = await L.store.get("midimap"); if (raw) await L.store.put("midimap.old", raw); }
        if (!(await L.store.get("midimap.aviso"))) {
          learnBar.msg = gone.length + (gone.length === 1 ? " atalho antigo sem lugar" : " atalhos antigos sem lugar");
          learnBar.render();
          await L.store.put("midimap.aviso", "1");
        }
      } catch (e) { console.warn(e); }
    };
    L.persist = function () {
      if (!dead) return persist0();
      const live = L.map;
      L.map = Object.assign({}, dead, live);
      try { persist0(); } finally { L.map = live; }
    };
    L.save = function () { if (L.sel && L.cand) dead = null; return save0(); };   // Learn novo: o mapa e regravado sem os antigos
    L.importData = function (d) { dead = null; return import0(d); };
    const clearAll0 = L.clearAll.bind(L);
    L.clearAll = function () { dead = null; return clearAll0(); };   // "apagar tudo" apaga tambem os antigos (a copia fica no .old)

    // a tela de uma tecla 13-16: Hold/Sub Pad sao teclas do motor; bancos andam um
    const extraEl = x => (x.id ? root.querySelector(`[data-ctrl="${x.id}"]`) : root.querySelector(`[data-ctrl="bank-${"abcde"[(d404.st.bank + x.bank + 5) % 5]}"]`));
    // a tecla da tela fica afundada enquanto o teclado ou o MIDI a segura: o motor desenha .down
    // a partir de data-press (renderButtons), entao a marca vai la e nao direto na classe
    const pressedX = new Map();   // "k:KeyZ" / "m:48" -> elemento da tela
    function extraDown(x, src) {
      if (pressedX.has(src)) return;
      const el = extraEl(x);
      pressedX.set(src, el);
      if (el) el.dataset.press = "1";
      if (x.id) d404.pressKey(x.id, true); else d404.bankStep(x.bank);
      d404.renderButtons();
    }
    function extraUp(x, src) {
      if (!pressedX.has(src)) return;
      const el = pressedX.get(src);
      pressedX.delete(src);
      if (el && ![...pressedX.values()].includes(el)) delete el.dataset.press;
      if (x.id) d404.pressKey(x.id, false);
      d404.renderButtons();
    }

    // O que foi aprendido vem antes (o Learn usa a mensagem primeiro)
    host.midi.addDefaults(d => {
      const st = d[0] & 0xf0, ch = (d[0] & 0x0f) + 1, note = d[1], n = note - NOTE0;
      if (!(st === 0x90 || st === 0x80) || ch !== MIDI_CH) return null;
      const on = st === 0x90 && d[2] > 0;
      if (n >= 0 && n < N) {
        if (!host.on) return "Off";
        if (on) { d404.padEls[n].classList.add("down"); d404.padDown(n, d[2] / 127); return "Def: Pad " + (n + 1); }
        d404.padEls[n].classList.remove("down");
        d404.padUp(n);
        return "Def: Pad " + (n + 1) + " Off";
      }
      const x = EXTRA.find(e => e.note === note);
      if (!x) return null;
      if (!host.on) return "Off";
      if (on) extraDown(x, "m:" + note); else extraUp(x, "m:" + note);
      return "Def: " + x.name + (on ? "" : " Off");
    });

    // tela de ligar: o navegador so libera o som depois de um toque
    const power = document.getElementById("power");
    // aviso "sem vinculo" (provisorio; trocar pelo texto final do Marketing). Marcas citadas so como referencia.
    const AVISO_SEM_VINCULO = [
      "Projeto independente, sem vínculo com E-mu, Roland, Akai ou Mackie.",
      "Independent project, not affiliated with E-mu, Roland, Akai or Mackie."
    ];
    const aviso = document.createElement("p");
    aviso.className = "power-note";
    AVISO_SEM_VINCULO.forEach((t, i) => { if (i) aviso.appendChild(document.createElement("br")); aviso.appendChild(document.createTextNode(t)); });
    const hint = power.querySelector(".power-hint");
    if (hint) hint.after(aviso); else power.appendChild(aviso);
    const on = () => { host.power(); power.classList.add("off"); };
    document.getElementById("power-btn").addEventListener("click", on);

    // Abrir: o disquete do 404 (dcx-404.json) ou o projeto .zip do Studio, pela secao Disquete do painel
    // Config ou arrastando o arquivo para a pagina (novo/js/abrir.js converte 16 pads -> A1-A12, B1-B4)
    const bar = document.getElementById("d4cfg-disk");
    const openBtn = document.createElement("button");
    openBtn.type = "button"; openBtn.className = "d4-open-btn"; openBtn.textContent = "Abrir disquete/projeto";
    openBtn.title = "Abre o disquete do DCX 404 (dcx-404.json) ou o projeto .zip do DCX Studio. Tambem da para arrastar o arquivo para a pagina.";
    const openMsg = document.createElement("span");
    openMsg.className = "d4-open-msg"; openMsg.setAttribute("aria-live", "polite");
    const openInp = document.createElement("input");
    openInp.type = "file"; openInp.accept = ".json,.zip,application/json,application/zip"; openInp.hidden = true;
    // Salvar: baixa o disquete desta pagina (60 pads A1-E12 + estado) que o Abrir e o Studio reabrem
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "d4-open-btn d4-save-btn"; saveBtn.textContent = "Salvar disquete";
    saveBtn.title = "Baixa o disquete do DCX 404 desta pagina (os 60 pads, A1-E12, efeitos, volume e nomes). O Abrir daqui e o DCX Studio reabrem (o Studio so tem 16 pads: A1-A12 e B1-B4).";
    bar.append(openBtn, saveBtn, openMsg, openInp);
    let msgTimer = 0;
    // aviso GRANDE e visivel no meio de cima da pagina (a barra de cima e pequena e a tela LIGAR a cobre)
    const toast = document.createElement("div");
    toast.className = "d4-toast"; toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); toast.hidden = true;
    document.body.appendChild(toast);
    let toastTimer = 0;
    const say = (t, err) => {
      clearTimeout(msgTimer); clearTimeout(toastTimer);
      openMsg.textContent = t; openMsg.classList.toggle("err", !!err);
      toast.textContent = t; toast.classList.toggle("err", !!err); toast.hidden = !t;
      if (!err) { msgTimer = setTimeout(() => { openMsg.textContent = ""; }, 12000); toastTimer = setTimeout(() => { toast.hidden = true; }, 8000); }
      else toastTimer = setTimeout(() => { toast.hidden = true; }, 20000);
    };
    // pergunta na propria pagina (o confirm() do navegador pode ser bloqueado ou passar despercebido)
    const ask = (t) => new Promise(res => {
      clearTimeout(toastTimer);
      toast.className = "d4-toast ask"; toast.hidden = false; toast.textContent = "";
      const p = document.createElement("p"); p.textContent = t;
      const ok = document.createElement("button"); ok.type = "button"; ok.textContent = "Abrir";
      const no = document.createElement("button"); no.type = "button"; no.textContent = "Cancelar";
      const done = v => { toast.hidden = true; toast.className = "d4-toast"; toast.textContent = ""; res(v); };
      ok.addEventListener("click", () => done(true)); no.addEventListener("click", () => done(false));
      toast.append(p, ok, no); ok.focus();
    });
    const until = (fn, ms) => new Promise((res, rej) => {
      const t0 = performance.now();
      (function tick() { if (fn()) res(); else if (performance.now() - t0 > ms) rej(new Error("O 404 nao ligou a tempo. Toque LIGAR e tente de novo.")); else setTimeout(tick, 50); })();
    });
    let busy = false;
    async function openFile(f) {
      if (busy) return;
      busy = true;
      try {
        if (!/\.(json|zip)$/i.test(f.name || "") && !/json|zip/.test(f.type || "")) {
          throw new Error("\"" + f.name + "\" nao e um disquete (.json) nem um projeto (.zip). Audio vai num pad.");
        }
        say("Abrindo \"" + f.name + "\"...");    // disquete grande leva alguns segundos
        const { data, from } = await RJ.d4Open.parse(f);
        if (!host.on) on();                       // o arquivo escolhido ou solto vale como o toque de ligar
        await until(() => d404.loaded, 15000);    // o estado guardado ja entrou: o disquete vem por cima
        const hasPats = !!(d404.st.seq && d404.st.seq.pats && Object.keys(d404.st.seq.pats).length);
        if ((d404.buf.some(Boolean) || hasPats) && !(await ask("Abrir o " + from + " troca os pads e efeitos desta pagina (a versao estavel nao muda). Continuar?"))) { say("Nada mudou."); return; }
        const r = RJ.d4Open.apply(d404, data, d404.engine.ensure());
        say((from === "projeto" ? "Projeto aberto (disquete do 404): " : "Disquete aberto: ") +
          (r.pads ? r.pads + (r.pads === 1 ? " pad" : " pads") + " em " + r.banks.join(", ") : "sem samples") + ", efeitos e volume." +
          (r.bad ? " " + r.bad + " sample(s) ilegivel(is) ficaram vazios." : "") +
          (r.extra ? " " + r.extra + " pad(s) a mais que 60 ficaram de fora." : "") + RJ.d4Open.seqMsg(r));
      } catch (e) {
        console.warn(e);
        say(e.message || "Nao deu para abrir esse arquivo.", true);
      } finally { busy = false; }
    }
    openBtn.addEventListener("click", () => { openInp.value = ""; openInp.click(); });
    // a tela LIGAR cobre a barra de cima: o mesmo botao fica tambem nela
    const powerOpen = document.createElement("button");
    powerOpen.type = "button"; powerOpen.className = "d4-power-open"; powerOpen.textContent = "Abrir disquete/projeto";
    power.appendChild(powerOpen);
    powerOpen.addEventListener("click", () => { openInp.value = ""; openInp.click(); });
    openInp.addEventListener("change", () => { const f = openInp.files[0]; if (f) openFile(f); });
    // arrastar: .json/.zip abre (mesmo solto num pad); audio segue para o pad (o motor cuida);
    // fora do 404 o navegador nao troca de pagina
    const isDisk = f => f && (/\.(json|zip)$/i.test(f.name || "") || /json|zip/.test(f.type || ""));
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", e => {
      const f = e.dataTransfer && (e.dataTransfer.files || [])[0];
      if (!f) return;
      if (isDisk(f)) { e.preventDefault(); e.stopPropagation(); openFile(f); return; }
      if (!root.contains(e.target)) { e.preventDefault(); say("Para abrir, solte o disquete (.json) ou o projeto (.zip). Audio vai num pad.", true); }
    }, true);
    RJ.d4OpenFile = openFile;   // para o QA (e o console): RJ.d4OpenFile(file)

    async function saveFile(opts) {
      if (busy) return null;
      busy = true;
      try {
        if (!host.on) on();
        await until(() => d404.loaded, 15000);    // o estado e os samples guardados ja entraram
        d404.abortRecs();                         // REC em espera/gravando: nao entra pela metade
        say("Salvando o disquete...");
        await new Promise(r => setTimeout(r, 30)); // deixa o aviso aparecer (disquete grande leva um tempo)
        const r = RJ.d4Open.build(d404, opts);
        if (!(opts && opts.noDownload)) RJ.dsp.downloadBlob(r.blob, r.name);
        const mb = r.bytes / 1048576;
        say("Disquete salvo: \"" + r.name + "\" (" + (r.pads ? r.pads + (r.pads === 1 ? " pad" : " pads") + " em " + r.banks.join(", ") : "sem samples") +
          ", " + (mb < 0.1 ? Math.max(1, Math.round(r.bytes / 1024)) + " KB" : mb.toFixed(1).replace(".", ",") + " MB") + ").");
        return r;
      } catch (e) {
        console.warn(e);
        say(e.message || "Nao deu para salvar o disquete.", true);
        return null;
      } finally { busy = false; }
    }
    saveBtn.addEventListener("click", () => saveFile());
    RJ.d4SaveFile = saveFile;   // para o QA (e o console): RJ.d4SaveFile({ noDownload: true }) -> { blob, name }

    // Barra de baixo (no estilo da do DCX Studio): logo do 404 e "Subir sample", para o toque/celular,
    // onde nao ha Shift nem arrastar. Tocar o botao: os 12 pads piscam e a barra pede "Toque no pad";
    // o pad tocado abre o seletor (#d4-file) e carrega nele pelo mesmo caminho do Shift + pad
    // (d404.pickFile). Tocar fora, o botao de novo, CANCEL ou Esc desistem. Nao muda som nem a face.
    const upBtn = document.getElementById("d4-up"), upMsg = document.getElementById("d4bar-msg");
    let upPick = false, upEatCancel = false, upTimer = 0;
    const upSay = (t, ms) => { clearTimeout(upTimer); upMsg.textContent = t || ""; if (t && ms) upTimer = setTimeout(() => { upMsg.textContent = ""; }, ms); };
    function upSet(v, msg, ms) {
      upPick = !!v;
      upBtn.classList.toggle("on", upPick);
      upBtn.setAttribute("aria-pressed", String(upPick));
      upSay(msg, ms);
      d404.renderPads();
    }
    const renderPads0 = d404.renderPads.bind(d404);
    d404.renderPads = function () {
      renderPads0();
      if (upPick && d404.padEls) d404.padEls.forEach(el => el.classList.add("hit", "blink"));   // o mesmo piscar do REC/DEL
    };
    const padDown0 = d404.padDown.bind(d404);
    d404.padDown = function (t, vel) {
      if (!upPick || !d404.on) return padDown0(t, vel);
      const i = d404.slotOf(t);
      d404.downSlot[t] = i; d404.held.add(i);   // o padUp do mesmo toque solta normalmente
      upSet(false, "Pad " + d404.padLabel(i) + ": escolha o arquivo", 15000);
      d404.pickFile(i);
    };
    const cancel0 = d404.cancelPress.bind(d404);
    d404.cancelPress = function () {
      if (upEatCancel) { upEatCancel = false; return; }   // o CANCEL que desistiu do "Subir sample" nao faz mais nada
      if (upPick) { upSet(false, "Nada mudou.", 3000); return; }
      return cancel0();
    };
    upBtn.addEventListener("click", () => {
      if (upPick) { upSet(false, "Nada mudou.", 3000); return; }
      if (!host.on) on();
      upSet(true, "Toque no pad");
    });
    // tocar fora dos pads desiste (o toque segue valendo para o que foi tocado, menos o CANCEL)
    document.addEventListener("pointerdown", e => {
      if (!upPick || upBtn.contains(e.target)) return;
      if (d404.padEls.some(el => el.contains(e.target))) return;
      if (e.target.closest && e.target.closest('[data-ctrl="cancel"]')) {
        upEatCancel = true;
        window.addEventListener("pointerup", () => setTimeout(() => { upEatCancel = false; }, 0), { once: true });
      }
      upSet(false, "Nada mudou.", 3000);
    }, true);
    window.addEventListener("keydown", e => { if (upPick && e.code === "Escape") upSet(false, "Nada mudou.", 3000); });
    d404.el.file.addEventListener("change", () => { if (/escolha o arquivo/.test(upMsg.textContent)) upSay("", 0); });
    // arquivo subido com silencio no comeco: o motor corta e avisa so aqui ("Cortei 23 ms de silêncio do começo.")
    d404.onLoadNote = t => upSay(t, 5000);

    // Painel Config (como o do DCX Studio, js/bar.js #cfg): o que nao e da maquina (MIDI Learn, Teclas,
    // disquete, ajuda, creditos). O botao da barra abre e fecha; Esc e tocar fora fecham.
    // Durante o Learn o painel fecha e a barra do Learn (#learnbar, a mesma, com os mesmos handlers)
    // vai para a barra de baixo, para tocar nos controles da face; ao sair do Learn ela volta ao painel.
    const cfgEl = document.getElementById("d4cfg"), cfgBtn = document.getElementById("d4cfg-btn");
    const d4bar = document.getElementById("d4bar"), lb = document.getElementById("learnbar");
    const lbHome = lb.parentNode, lbNext = lb.nextSibling;
    const cfgOpen = () => !cfgEl.hidden;
    function panel(open, refocus) {
      cfgEl.hidden = !open;
      cfgBtn.setAttribute("aria-expanded", String(open));
      if (open) cfgEl.focus({ preventScroll: true });
      else if (refocus) cfgBtn.focus({ preventScroll: true });
    }
    // Sobre: latencia do audio do aparelho (o que o navegador informa; o site gasta < 1 ms do toque ao som)
    const latEl = document.getElementById("d4-lat");
    function latencia() {
      const c = host.engine && host.engine.ctx;
      if (!c) { latEl.textContent = "Latência de áudio: ligue o aparelho (LIGAR) para medir."; return; }
      const ms = v => (typeof v === "number" && v > 0) ? (v * 1000).toFixed(1) + " ms" : "não informado";
      let total = "";
      if (c.baseLatency > 0 && c.outputLatency > 0) total = " · total ≈ " + ((c.baseLatency + c.outputLatency) * 1000).toFixed(0) + " ms";
      latEl.textContent = "Latência de áudio: base " + ms(c.baseLatency) + " · saída " + ms(c.outputLatency) + total +
        " · " + Math.round(c.sampleRate) + " Hz · " + c.state;
    }
    cfgBtn.addEventListener("click", () => { panel(!cfgOpen()); if (cfgOpen()) latencia(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && cfgOpen()) { e.preventDefault(); panel(false, true); } });
    document.addEventListener("pointerdown", e => {
      if (cfgOpen() && !cfgEl.contains(e.target) && !cfgBtn.contains(e.target)) panel(false);
    }, true);
    const placeLearn = () => {
      const on = document.body.classList.contains("learning");
      if (on) { if (cfgOpen()) panel(false); if (lb.parentNode !== d4bar) d4bar.insertBefore(lb, cfgBtn); }
      else if (lb.parentNode !== lbHome) lbHome.insertBefore(lb, lbNext);
      cfgBtn.disabled = on;
    };
    new MutationObserver(placeLearn).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    placeLearn();

    // teclado
    const held = new Set();
    window.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!host.on) { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); on(); } return; }
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { d404.setShiftKey(true); return; }
      const i = PAD_KEYS.indexOf(e.code);
      if (i >= 0 && i < N) {
        e.preventDefault();
        if (e.repeat || held.has(i)) return;
        held.add(i);
        d404.padEls[i].classList.add("down");
        d404.padDown(i, 1);
        return;
      }
      const x = EXTRA.find(k => k.code === e.code);
      if (!x) return;
      e.preventDefault();
      if (e.repeat) return;
      extraDown(x, "k:" + x.code);
    });
    const padKeyUp = i => { if (held.delete(i)) { d404.padEls[i].classList.remove("down"); d404.padUp(i); } };
    window.addEventListener("keyup", e => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { d404.setShiftKey(false); return; }
      const i = PAD_KEYS.indexOf(e.code);
      if (i >= 0) { padKeyUp(i); return; }
      const x = EXTRA.find(k => k.code === e.code);
      if (x) extraUp(x, "k:" + x.code);
    });
    // trocar de janela com uma tecla apertada: o keyup nao chega, entao solta tudo aqui (senao o pad fica preso)
    window.addEventListener("blur", () => {
      d404.setShiftKey(false);
      [...held].forEach(padKeyUp);
      EXTRA.forEach(x => extraUp(x, "k:" + x.code));
    });

    // teclas do Figma que ainda nao tem funcao (Fases 2 e 3): afundam e voltam, sem acao
    root.querySelectorAll("[data-dead]").forEach(el => {
      el.addEventListener("pointerdown", e => {
        e.preventDefault();
        if (!host.on) return;   // como as teclas com funcao: desligado, nada afunda
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add("down");
      });
      const up = () => el.classList.remove("down");
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
      el.addEventListener("contextmenu", e => e.preventDefault());
    });

    // o aparelho tem 660 x 988 (escala 1 do Figma); em tela estreita, diminui para caber
    const fit = document.getElementById("dx-fit");
    const scale = () => {
      const avail = Math.max(280, fit.parentNode.clientWidth);
      fit.style.zoom = avail < 660 ? String(avail / 660) : "";
    };
    window.addEventListener("resize", scale);
    scale();

    // no console: RJ.solo (o host) e RJ.d404
    RJ.solo = host; RJ.d404 = d404;
  });
})();
