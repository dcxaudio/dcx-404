# DCX 404: manual curto (b0.1)

## Ligar
Toque em **LIGAR** (ou aperte Espaço). O display mostra `b0.1` e depois o BPM.

## Pads
- **Carregar:** solte um arquivo de áudio (WAV, MP3, AIFF, OGG, FLAC) num pad. Ou aperte **Shift** e o pad para abrir o seletor de arquivo. Um arquivo solto fora dos pads vai para o primeiro pad vazio.
- **Tocar:** clique no pad, use o teclado (`1`–`4`, `Q`–`R`, `A`–`F`, `Z`–`V`, na ordem dos pads) ou o MIDI (canal 10, notas 36–51). O número do pad acende quando ele tem som, e a borda acende enquanto ele toca.
- **Gate / Loop / Reverse** valem para o último pad tocado (os LEDs mostram os modos dele):
  - **Gate:** aceso, o pad toca enquanto você segura. Apagado (Trigger), toca até o fim.
  - **Loop:** repete. Em Trigger, toque o pad de novo para parar.
  - **Reverse:** toca de trás para frente.
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
