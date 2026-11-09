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
    new RJ.LearnBar(host, { root, bar: document.getElementById("learnbar") });
    const N = d404.padEls.length;

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
    const on = () => { host.power(); power.classList.add("off"); };
    document.getElementById("power-btn").addEventListener("click", on);

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
