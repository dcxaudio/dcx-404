/* DCX 404 - pagina solo
 *
 * Monta um host so com o 404 (RJ.Host.solo): targets() devolve so "file" (por
 * isso a fonte RJ-2000 fica apagada) e o armazenamento usa o prefixo "dcx404/".
 * No Studio, quem monta o 404 e a pagina do dcx-studio, que tambem liga a
 * saida do RJ-2000 na entrada dele (host.route("rj2000", "dcx404")).
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  // 4 x 4, na ordem dos pads: 1-4 / Q-R / A-F / Z-V
  const PAD_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "KeyQ", "KeyW", "KeyE", "KeyR",
    "KeyA", "KeyS", "KeyD", "KeyF", "KeyZ", "KeyX", "KeyC", "KeyV"];
  // mapa MIDI padrao: canal 10, notas 36-51 (os pads do Arturia Minilab3, bancos A e B)
  const MIDI_CH = 10, NOTE0 = 36;

  window.addEventListener("DOMContentLoaded", () => {
    const host = RJ.Host.solo("dcx404");
    const d404 = new RJ.D404(host.view("dcx404"));
    host.add("dcx404", d404, { label: "DCX 404", receive: f => d404.receive(f) });
    d404.build(document.getElementById("d4"));
    new RJ.LearnBar(host, { root: document.getElementById("d4"), bar: document.getElementById("learnbar") });

    // O que foi aprendido vem antes (o Learn usa a mensagem primeiro); o resto das
    // notas 36-51 no canal 10 toca os pads, com a forca do toque.
    host.midi.addDefaults(d => {
      const st = d[0] & 0xf0, ch = (d[0] & 0x0f) + 1, n = d[1] - NOTE0;
      if (!(st === 0x90 || st === 0x80) || ch !== MIDI_CH || n < 0 || n >= 16) return null;
      if (!host.on) return "Off";
      if (st === 0x90 && d[2] > 0) { d404.padEls[n].classList.add("down"); d404.padDown(n, d[2] / 127); return "Def: Pad " + (n + 1); }
      d404.padEls[n].classList.remove("down");
      d404.padUp(n);
      return "Def: Pad " + (n + 1) + " Off";
    });

    // tela de ligar: o navegador so libera o som depois de um toque
    const power = document.getElementById("power");
    const on = () => { host.power(); power.classList.add("off"); };
    document.getElementById("power-btn").addEventListener("click", on);

    // teclado: os 16 pads; Shift do teclado = Shift do 404 (segurando)
    const held = new Set();
    window.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!host.on) { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); on(); } return; }
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { d404.setShiftKey(true); return; }
      const i = PAD_KEYS.indexOf(e.code);
      if (i < 0) return;
      e.preventDefault();
      if (e.repeat || held.has(i)) return;
      held.add(i);
      d404.padEls[i].classList.add("down");
      d404.padDown(i, 1);
    });
    window.addEventListener("keyup", e => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") { d404.setShiftKey(false); return; }
      const i = PAD_KEYS.indexOf(e.code);
      if (i >= 0 && held.delete(i)) { d404.padEls[i].classList.remove("down"); d404.padUp(i); }
    });
    window.addEventListener("blur", () => { d404.setShiftKey(false); });

    // no console: RJ.solo (o host) e RJ.d404
    RJ.solo = host; RJ.d404 = d404;
  });
})();
