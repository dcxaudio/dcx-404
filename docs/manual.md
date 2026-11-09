# DCX 404: manual curto (b0.1)


## Face nova (teste, Fase 1)
Em [`../novo/`](../novo/), sem substituir esta versão: o painel cinza do Figma com 12 pads e 5 bancos (A–E, 60 pads).
- **Bancos:** as teclas A–E trocam o banco; os pads mostram o banco atual e o visor mostra `A.01`…`E.12`. Teclado `C`/`V` ou notas 50/51 do Arturia: banco anterior/próximo.
- **Pads:** `1`–`4`, `Q`–`R`, `A`–`F` ou notas 36–47 (canal 10). **HOLD** (`Z`, nota 48) e **SUB PAD** (`X`, nota 49) ficam na coluna da direita; **SOURCE** troca a fonte da entrada (o nome aparece no visor).
- **LO-FI** é uma tecla do Sample Mode (Shift do teclado + Reverse também liga). Carregar arquivo: solte num pad ou segure Shift no teclado e toque o pad.
- **Abrir disquete/projeto** (botão na barra de cima, ao lado do MIDI Learn, ou arraste o arquivo para a página): abre o disquete do 404 (`…-dcx-404.json`, salvo no Studio) ou o projeto `.zip` do Studio (só usa o `dcx-404.json` de dentro). Pads 1–12 vão para A1–A12 e 13–16 para B1–B4, com efeitos, volume, nomes e modos; os outros pads ficam vazios. A página estável não muda. Se a face nova já tem samples, ela pergunta antes de trocar. Disquete de outra máquina, zip sem o 404 ou arquivo errado: a barra diz o motivo e nada muda. Na primeira abertura a face nova ainda copia sozinha o que está na página estável deste navegador (atalho, sem Console).
- **Salvar disquete** (ao lado de Abrir): baixa um arquivo `dcx-404-novo-…-dcx-404.json` com a data e a hora no nome, com os 60 pads (A1–E12), efeitos, volume, BPM, nomes e modos. Para voltar, use **Abrir disquete/projeto** com esse arquivo. O DCX Studio também abre, mas ele só tem 16 pads: lá entram A1–A12 e B1–B4; o resto fica de fora.
- Bus 1/2, Mute, Velocity e Set-up não aparecem no painel novo: só pelo MIDI já aprendido na página estável (o mapa é copiado na primeira abertura). Os efeitos ligam no Bus 1.
- Ainda sem ação: PITCH, Pattern Sequencer, Sample Edit, TAP TEMPO, DEL, REC, STEREO, CANCEL, REMAIN, MARK e MIC.

## Ligar
Toque em **LIGAR** (ou aperte Espaço). O display mostra `b0.1` e depois o BPM.

## Pads
- **Carregar:** solte um arquivo de áudio (WAV, MP3, AIFF, OGG, FLAC) num pad. Ou aperte **Shift** e o pad para abrir o seletor de arquivo. Um arquivo solto fora dos pads vai para o primeiro pad vazio.
- **Tocar:** clique no pad, use o teclado (`1`–`4`, `Q`–`R`, `A`–`F`, `Z`–`V`, na ordem dos pads) ou o MIDI (canal 10, notas 36–51). O número do pad acende quando ele tem som, e a borda acende enquanto ele toca.
- **Gate / Loop / Reverse** valem para o último pad tocado (os LEDs mostram os modos dele):
  - **Gate:** aceso, o pad toca enquanto você segura. Apagado (Trigger), toca até o fim.
  - **Loop:** repete. Em Trigger, toque o pad de novo para parar.
  - **Reverse:** toca de trás para frente.
  - **LO-FI (Shift + Reverse):** liga/desliga a redução de bits e de taxa em tudo que passa pelo 404 (pads e a Source), como o Vinyl Sim. O LED do marcador "Lo-fi" (embaixo do Reverse) acende e o display mostra `Lo.` ou `Lo-`. Com o Shift armado, Ctrl 1 muda os bits e Ctrl 2 a taxa (padrão: 6 bits, taxa ÷4). O Resample grava com o LO-FI ligado. Fica salvo com o estado.
- **Hold:** os pads em Gate continuam tocando depois de soltar. Ao apagar o Hold, eles param.
- **Sub Pad (Roll):** segure para repetir o último pad no tempo do BPM. Com Hold, um toque liga e outro desliga.
- **Velocity:** troca a curva de força: `5UA` (suave, padrão, levanta os toques fracos), `Lin` (linear) e `127` (sempre no máximo). Teclado e mouse tocam no máximo.

## Efeitos
1. Escolha o bus: **Bus 1** (Perform: pads e entrada) ou **Bus 2** (Master: tudo, depois do Mute). Cada bus tem um efeito.
2. Aperte um efeito: ele liga no bus escolhido (outro toque desliga). Se você segurar mais de meio segundo, ele vale só enquanto segura (a não ser com Hold).
3. Gire **Ctrl 1–3**. As legendas embaixo dos knobs mudam com o efeito, e o display mostra o valor (0–127). Em repouso, o display mostra `F.0n`, o número do efeito.

| n | Efeito | Ctrl 1 | Ctrl 2 | Ctrl 3 |
|---|---|---|---|---|
| F.01 | Filter+Drive | Cutoff | Resonance | Drive |
| F.02 | Isolator | Low | Mid | High (meio = 0 dB, todo para baixo = corta) |
| F.03 | Delay | Time (1/32 a 1/2, no BPM) | Feedback | Level |
| F.04 | Vinyl Sim | Freq (estreita a faixa) | Noise | Wow/Flutter |
| F.05 | DJFX Looper | Length (1/32 a 2 tempos) | Speed (−1 a +1) | Loop (liga/desliga) |
| F.06 | Reverb (MFX pad 1) | Time | Tone | Level |
| F.07 | Lo-fi (MFX pad 2) | Bits | Rate | Tone |
| F.08 | Compressor (MFX pad 3) | Sustain | Attack | Level |
| F.09 | Stopper / Back Spin (MFX pad 4) | Time | Type (freio / giro) | Trig |

- **MFX:** ao ligar, os pads 1–4 piscam por 5 s. Toque um deles para escolher o efeito (sem tocar o pad). **Shift + MFX** escolhe de novo.
- **DJFX Looper e Stopper** capturam o som no momento em que ligam. Com Ctrl 3 para cima, ligar já prende o loop ou freia. Com Ctrl 3 para baixo, o som passa normal, e girar Ctrl 3 para cima dispara.
- O LED do efeito que está no outro bus pisca, e o LED do outro bus também pisca quando ele tem efeito.

## Mute, Resample e Set-up
- **Mute (Break):** corta o Bus 1 (pads e entrada). O efeito do Bus 2 continua soando a cauda. Se você segurar, ele vale só enquanto segura.
- **Resample:** grava o que sai (com os efeitos, antes do Volume) no primeiro pad vazio. Aperte de novo para parar (máximo de 60 s). `FUL` quer dizer que não há pad vazio.
- **Apagar um pad:** Shift + Resample mostra `dEL`. Aperte Resample em até 3 s para apagar o último pad tocado.
- **Set-up:** Ctrl 1 = BPM (40–240), Ctrl 2 = passo do Sub Pad (1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32), Ctrl 3 = volume do pad escolhido. Aperte Set-up de novo para sair.
- **Shift:** um toque arma para o próximo botão. Também dá para segurar o Shift do teclado.

## Entrada
- **Source** troca entre desligada, **RJ-2000** (só no DCX Studio) e **Line**. Na página solo, a Line pede o microfone ou a entrada de áudio ao navegador na primeira vez. Se ela não abrir, o display mostra `Err`.
- **Level** regula a entrada. Cuidado com microfone e caixas de som abertas: dá microfonia.

## MIDI
- Mapa padrão: canal 10, notas 36–51 → pads 1–16, com a força do toque.
- **MIDI Learn** (botão no alto): toque num controle, mexa no controlador e aperte Enter. Delete apaga, Esc sai. No Minilab3, os knobs lisos (CC 86, 87, 89, 90…) vão bem nos Ctrl 1–3. O que foi aprendido vem antes do mapa padrão.

## Salvar
Tudo fica no navegador (painel, modos, efeitos, samples e mapa MIDI) e volta ao recarregar. Limpar os dados do site apaga tudo.
