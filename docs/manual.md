# DCX 404: manual curto (b0.1)


## Face nova (teste, Fase 1)
Em [`../novo/`](../novo/), sem substituir esta versão: o painel cinza do Figma com 12 pads e 5 bancos (A–E, 60 pads).
- **Bancos:** as teclas A–E trocam o banco; os pads mostram o banco atual e o visor mostra `A.01`…`E.12`. Teclado `C`/`V` ou notas 50/51 do Arturia: banco anterior/próximo.
- **Pads:** `1`–`4`, `Q`–`R`, `A`–`F` ou notas 36–47 (canal 10). **HOLD** (`Z`, nota 48) e **SUB PAD** (`X`, nota 49) ficam na coluna da direita; **SOURCE** troca a fonte da entrada (o nome aparece no visor).
- **LO-FI** é uma tecla do Sample Mode (Shift do teclado + Reverse também liga). Carregar arquivo: solte num pad ou segure Shift no teclado e toque o pad.
- **Abrir disquete/projeto** (botão na barra de cima, ao lado do MIDI Learn, ou arraste o arquivo para a página): abre o disquete do 404 (`…-dcx-404.json`, salvo no Studio) ou o projeto `.zip` do Studio (só usa o `dcx-404.json` de dentro). Pads 1–12 vão para A1–A12 e 13–16 para B1–B4, com efeitos, volume, nomes e modos; os outros pads ficam vazios. A página estável não muda. Se a face nova já tem samples, ela pergunta antes de trocar. Disquete de outra máquina, zip sem o 404 ou arquivo errado: a barra diz o motivo e nada muda. Na primeira abertura a face nova ainda copia sozinha o que está na página estável deste navegador (atalho, sem Console).
- **Salvar disquete** (ao lado de Abrir): baixa um arquivo `dcx-404-novo-…-dcx-404.json` com a data e a hora no nome, com os 60 pads (A1–E12), efeitos, volume, BPM, nomes e modos. Para voltar, use **Abrir disquete/projeto** com esse arquivo. O DCX Studio também abre, mas ele só tem 16 pads: lá entram A1–A12 e B1–B4; o resto fica de fora.
- **Sem Bus 1/2, Mute, Velocity, Set-up, Shift, DJFX e Input Level** (não existem no SP-404; saíram também do MIDI). Os efeitos ligam sempre no Bus 1. A força do toque (MIDI) não muda o volume, como no SP-404 (p. 12). Shift é só a tecla do teclado (Shift + pad carrega arquivo, Shift + Reverse liga o LO-FI, Shift + Ctrl 1/2 ajusta o LO-FI). O DJFX Looper é o MFX 24.
  - **BPM:** TAP TEMPO, ou **TIME/BPM** com o pad atual vazio (ou com SOURCE aceso e nada tocando): o visor mostra o BPM do 404 e o **Ctrl 2** ajusta (40–240). Com um sample no pad atual, TIME/BPM continua sendo o BPM do sample (Time Modify). O Ctrl 1 não é mais BPM.
  - **Sub Pad:** repete em 1/16 no BPM (fixo; o valor antigo fica guardado no estado).
  - **Nível do pad:** START/END/LEVEL + Ctrl 3 (0–127).
  - **Nível da entrada e envios RJ-2000/RJ-950:** SOURCE aceso → START/END/LEVEL → **Ctrl 3** ajusta a fonte escolhida no SOURCE: `rJ` = envio do RJ-2000, `950` = envio do RJ-950, `Lin` e `Mix` = nível da entrada (a Mix soma os dois envios: ajuste cada um escolhendo-o antes). Com o pad atual vazio, o visor mostra o nome da fonte. Ctrl 1/2 seguem no start/end do pad atual.
  - **Estado e disquete antigos** abrem sem erro: um efeito no Bus 2 (o Stopper, por exemplo) vem para o Bus 1 com o mesmo som; com efeito nos dois buses fica o do bus que estava escolhido. Mute, Velocity e a divisão do Sub Pad são ignorados (ficam guardados).
  - **MIDI aprendido na estável:** os atalhos de Bus 1/2, Mute, Velocity, Set-up, Shift, DJFX, Input Level (e pads 13–16) são ignorados em silêncio; a barra do MIDI Learn avisa uma vez "N atalhos antigos sem lugar". Uma cópia intacta do mapa fica em `dcx404-novo/midimap.old`. O mapa guardado só perde esses atalhos quando você fizer um Learn novo (Save).
- Ainda sem ação: Pattern Sequencer e MIC (decorativo).
- **Efeitos na ordem do manual (Fase 3a):** os 5 diretos e os 24 MFX com os números e os códigos de visor do SP-404 (manual p. 20–22). A página estável continua com `F.01`–`F.09`.
  - **Diretos:** FILTER+DRIVE `F.1`, PITCH `F.2`, DELAY `F.3`, ISOLATOR `F.4`, VINYL SIM `F.5` (o visor mostra isso com o efeito ligado).
  - **MFX 1–24** (a lista impressa ao lado do visor): segure **MFX** e gire **Ctrl 3** (o número aparece no visor e fica marcado na lista; soltar o MFX liga), ou segure **MFX** e toque o **pad 1–12** (MFX 1–12; segurando também **VINYL SIM**, 13–24). Com o mouse: aperte MFX e, nos 5 s em que os pads piscam, toque o pad aceso (VINYL SIM troca 1–12 / 13–24) ou gire o Ctrl 3 (liga 0,7 s depois de parar). Com o MFX ligado, o visor mostra o número.
  - Já têm som: **1 Reverb**, **3 Chorus**, **4 Flanger**, **5 Phaser**, **6 Tremolo/Pan**, **7 Distortion**, **8 Overdrive**, **9 Fuzz**, **10 Wah**, **12 Comp**, **14 Lo-Fi**, **18 Ring Mod**, **24 DJFX Looper** (só pelo MFX: a tecla escondida e o MIDI aprendido nela na página estável saíram) e o extra **Stopper/Back Spin** (não é do SP-404 OG: Ctrl 3 todo à direita com o MFX, visor `StP`). Os outros números mostram o número e `---` e não mudam o efeito (cada onda seguinte traz alguns).
  - **Ctrl 1–3:** ao começar a girar, o visor mostra o código do parâmetro e depois o valor: Filter+Drive `CoF` `rES` `drV`; PITCH `Pit` (`-24`…`24` semitons) `Fdb` `bAL`; Delay (tempo em nota) `Fdb` `bAL`; Isolator `Lo` `Mid` `Hi`; Vinyl Sim `CMP` `noS` `FLu`; Reverb `tiM` `ton` `bAL`; Comp `SuS` `Att` `LEV`; Lo-Fi `rAt` `bit` (`16`…`3`) `FLt`; DJFX `LEn`, velocidade `-1.0`…`1.0`, loop `on`/`oFF`.
  - **Onda 2 (MFX 3–10 e 18):** modulação e drives, como no manual (p. 20–22). Ao girar, o visor mostra o código e depois 0–127.
    - **3 Chorus:** Ctrl 1 `dBt` profundidade, Ctrl 2 `rAt` velocidade (~0,1 a 8 Hz), Ctrl 3 balance (o manual não dá código: o visor mostra só o valor). Duas cópias levemente atrasadas (~8–18 ms) que oscilam, uma em cada lado (estéreo).
    - **4 Flanger** e **5 Phaser:** no mapa do Send/Return ligado (o de fábrica do SP-404; o modo desligado é um card próprio): Ctrl 1 `d-r` profundidade e ressonância juntas, Ctrl 2 `rAt` (~0,05 a 8 Hz), Ctrl 3 `bAL`: todo à esquerda só o direto, no meio o efeito clássico (direto + cópia varrida), todo à direita só a cópia (some o direto, como o manual diz). Flanger: atraso de 0,3 a ~8 ms com realimentação; Phaser: 6 passa-tudo varridos a partir de 180 Hz (1 a 5,5 oitavas) com realimentação.
    - **6 Tremolo/Pan:** Ctrl 1 `dPt` profundidade, Ctrl 2 `rAt` (~0,3 a 15 Hz), Ctrl 3 forma de onda: metade esquerda `trM` (tremolo: o volume sobe e desce), metade direita `PAn` (o som vai de um lado ao outro). Perto do centro a onda é suave (seno); nas pontas fica quadrada (liga/desliga).
    - **7 Distortion, 8 Overdrive, 9 Fuzz:** Ctrl 1 `drV` quanto satura, Ctrl 2 `ton` (passa-baixa: escurece), Ctrl 3 `LEV` nível (por volta de 90 = o mesmo volume da entrada). Overdrive é a mais suave, Distortion tem joelho duro, Fuzz é assimétrica (harmônicos pares e ímpares). O volume não pula ao subir o drive.
    - **10 Wah:** Ctrl 1 `SnS` quanto o volume do som abre o filtro (0 = filtro parado, "wah meio aberto"), Ctrl 2 `Frq` frequência de base (~300 Hz a 2,5 kHz), Ctrl 3 `rES` ressonância. Só o som filtrado sai (sem balance, como no manual).
    - **18 Ring Mod:** Ctrl 1 `Frq` frequência da portadora (~20 Hz a 2 kHz), Ctrl 2 `SEn` quanto o volume sobe a portadora (0 = fixa), Ctrl 3 `bAL`. Um som de 440 Hz com a portadora em 126 Hz vira 314 Hz e 566 Hz (o metálico).
  - **PITCH (`F.2`):** muda o tom em até 2 oitavas para cima ou para baixo, em semitons (centro = `0`, o som passa igual). FEEDBACK devolve o som afinado para a entrada depois de 1/8 de nota no BPM (entre 0,12 e 0,5 s): cada repetição sobe (ou desce) mais um passo, uma escada que se ouve nota a nota; em `0` o FEEDBACK vira um eco simples. BALANCE: todo à esquerda só o direto, todo à direita só o efeito, no meio os dois. Ligado, começa com BALANCE todo à direita (só o efeito: ouve-se o tom mudar, não um segundo som atrasado). Um estado salvo antes disso, com BALANCE ainda no meio de fábrica, abre com ele todo à direita; com BALANCE no meio, o som original toca junto, por desenho. É um pitch shifter em tempo real (como o do SP-404), de linha de atraso, com a emenda das leituras escolhida em fase com o som: o tom sai exato (erro ≤0,01 cent medido), sem o "tremido" de janela num tom parado. Num som com vários instrumentos juntos cada emenda mexe na fase de tudo o que não é o som principal; por isso as emendas são poucas e suaves (salto mínimo de 12 ms, cruzamento de 15 ms): o atraso fica em ~10–18 ms (medido em bateria e num mix de bateria, baixo, teclado e voz) e até ~30 ms só enquanto um grave longo precisar.
  - **DELAY (`F.3`):** o tempo é em nota, no BPM do 404: `t32` (fusa), `t16`, `t8t` (tercina), `t16.` (pontuada), `t8`, `t4t`, `t8.`, `t4`, `t2t`, `t4.`, `t2`, `t2.`, `t1` (compasso). Não passa de ~2000 ms: num BPM lento o Ctrl 1 para na maior nota que cabe (a 90 BPM, `t2.`; a 60, `t2`). FEEDBACK no meio ≈ −6 dB por repetição; todo à direita as repetições caem devagar, sem estourar. BALANCE: esquerda só o direto, centro direto e eco cheios, direita só o eco.
  - **VINYL SIM (`F.5`):** Ctrl 1 é o COMPRESSOR (todo à esquerda sem compressão; no meio o de antes), Ctrl 2 o chiado/estalos, Ctrl 3 o wow/flutter. A faixa estreita de disco continua (fixa, no valor que o efeito tinha).
  - **Lo-Fi (MFX 14) — em ajuste:** Igor ouviu e ainda não ficou bom; fica como está enquanto se pesquisa uma forma melhor. Na ordem do manual: Ctrl 1 `rAt` (taxa de amostragem: todo à esquerda a taxa cheia, ~8 kHz no padrão, ~5 kHz no meio, 1 kHz todo à direita), Ctrl 2 `bit` (16 a 3 bits, em degraus inteiros), Ctrl 3 `FLt` (passa-baixa depois do crush, escurece o espelhamento). Som de rádio antigo: antes do crush o som passa pela faixa de um rádio (corta abaixo de ~300 Hz e acima de ~3 kHz, com quedas suaves), por uma saturação leve e por um grão bem baixo que segue o som (sem som, sai silêncio). Antes da taxa baixa, um passa-baixa íngreme tira o agudo que não cabe nela (sem ele, chimbal e caixa "dobravam" para baixo como chiado); depois, outro tira as imagens de cima e deixa o primeiro espelho (o metálico, que o `FLt` escurece). Sem dither. O LO-FI global (Shift + Reverse) e o Lo-fi da página estável continuam como eram.
  - A página estável e o Studio não mudam: lá o Delay segue com `1/32`…`1/2` e o Level, o Vinyl Sim com a faixa no Ctrl 1 e o Lo-fi com Bits/Rate/Tone. O estado guarda cada parâmetro com o mesmo nome nas duas faces (o tempo do Delay da face nova e o compressor do Vinyl são parâmetros novos; quem abre um estado antigo pega `t8` e o compressor de antes).
  - Estados e disquetes antigos abrem com o mesmo efeito: o arquivo guarda o nome do efeito, não o número (`F.01` Filter+Drive → `F.1`, `F.02` Isolator → `F.4`, `F.03` Delay → `F.3`, `F.04` Vinyl Sim → `F.5`, `F.05` DJFX → MFX 24, `F.06` Reverb → MFX 1, `F.07` Lo-fi → MFX 14, `F.08` Comp → MFX 12, `F.09` Stopper → `StP`).

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
