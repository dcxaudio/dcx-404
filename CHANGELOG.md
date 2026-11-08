# Changelog

## Próxima

- **Shift do teclado:** `setShiftKey(on)` liga/desliga o Shift vindo da tecla do computador (acende o botão Shift e vale também na página de envios Set-up + Mix). A página solo usa; o Studio usa quando o 404 está selecionado.

- **LO-FI (b0.2):** Shift + Reverse liga/desliga o LO-FI do 404, um efeito global como o Vinyl Sim: reduz bits e taxa de tudo que sai do Bus 2 (pads, Source RJ-2000, RJ-950 e Mix, Line). Ponto de partida: 6 bits e taxa ÷4 (bem audível, como o LO-FI do SP-404A). Com o Shift armado (fora do Set-up), Ctrl 1 ajusta os bits (2 a 16) e Ctrl 2 a taxa (÷24 a ÷1). Liga e desliga com crossfade de ~20 ms, sem estalo; desligado, o som é idêntico ao de antes (bit a bit). Um marcador "Lo-fi" com LED fica embaixo do Reverse (clicável, aparece no MIDI Learn como "404 Lo-fi"). O display mostra `Lo.` ou `Lo-`. O Resample grava com o LO-FI. Salvo no estado (`lofi`, `lofiBits`, `lofiDown`); estados antigos abrem com o LO-FI desligado (o campo por pad, `pads[i].lofi`, foi descartado). No Studio, o `index.html` precisa do marcador (`data-ctrl="lofi"`, veja o `index.html` do 404); sem ele o LO-FI funciona, só sem o LED.
- O Input Level padrão agora é 0,8 (102 no LCD), no lugar de 0,7: com a Source em RJ-2000 e sem efeitos, o 404 soa igual ao som direto (ganho 1,0, antes 0,77, cerca de 2,3 dB abaixo). Estados já salvos mantêm o valor deles.
- Source ganha **RJ-950** e **Mix**: off, RJ-2000, RJ-950, Mix, Line. Com RJ-950, o som do 950 entra no Bus 1 do 404 (pelos efeitos) e some da saída direta, sem soar duplo; Mix soma RJ-2000 e RJ-950 na entrada. Só aparecem no Studio (Mix só com os dois). O LCD mostra rJ, 950, Mix ou Lin.
- Envio de cada aparelho na Mix: no Set-up, com Shift armado, Ctrl 1 é o envio do RJ-2000 e Ctrl 2 o do RJ-950 (64 = som igual ao direto, o padrão). Salvos no estado (`sendRj`, `send950`).
- A página do Studio precisa ligar `host.route("rj950", d404.g.src950, { dry: false })` junto com a rota do RJ-2000 (feito no dcx-studio).

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
