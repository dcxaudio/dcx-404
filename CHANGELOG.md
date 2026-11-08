# Changelog

## b0.1 (beta)

- Primeira versão do DCX 404, com a tela do mockup v4 e o host do [dcx-core](https://github.com/dcxaudio/dcx-core) v1.0.0 (submódulo em `vendor/dcx-core`). Os dados ficam no navegador com o prefixo `dcx404/`.
- 16 pads num banco. Cada pad recebe um sample (solto no pad, ou Shift + pad) e tem os modos Gate/Trigger, Loop e Reverse. Também tem Hold, Sub Pad (repete o último pad no tempo do BPM) e a curva de velocity suave (padrão), linear ou fixa.
- 9 efeitos: Filter+Drive, Isolator, Delay, Vinyl Sim e DJFX Looper, mais o MFX (Reverb, Lo-fi, Compressor e Stopper/Back Spin pelos pads 1–4). Há um efeito por bus, com Ctrl 1–3. As rampas são curtas para não estalar. DJFX Looper, Stopper e Lo-fi rodam em AudioWorklet.
- Bus 1 (pads e entrada), Bus 2 (master) e Mute (break). Segurar um efeito ou o Mute vale só enquanto segura, a não ser com Hold.
- Entrada pelo `host.input()` no Bus 1, com Level e Source. No solo, a fonte é a Line (microfone ou entrada do navegador), ligada só quando escolhida. A fonte RJ-2000 só acende no Studio.
- Resample: grava a saída com efeito no primeiro pad vazio. Shift + Resample apaga o pad escolhido (confirmar com Resample).
- Set-up: Ctrl 1 muda o BPM, Ctrl 2 o passo do Sub Pad e Ctrl 3 o volume do pad.
- Teclado (1–4, Q–R, A–F, Z–V) e MIDI (canal 10, notas 36–51). O MIDI Learn funciona em todos os controles.
- Estado e samples salvos no navegador. Ao recarregar, a página volta igual.
