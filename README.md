# DCX 404

Sampler de performance que roda no navegador, inspirado no SP-404: 12 pads por banco em 5 bancos (A–E, 60 pads), 5 efeitos diretos, 24 MFX numerados como na lista impressa do SP-404, gravação da entrada e reamostragem. É um projeto open source da [DCX Audio](https://github.com/dcxaudio).

O painel novo (o cinza do Figma, "DX 404") está em [`novo/`](novo/). A página da raiz continua sendo a versão estável antiga (16 pads, 9 efeitos), sem mudanças.

## O que o painel novo faz

- **Pads e bancos:** 12 pads por banco, bancos A–E. Teclado: `1`–`4`, `Q`–`R`, `A`–`F` tocam os pads; `A`–`E` no painel trocam o banco; `C` e `V` vão ao banco anterior e ao próximo. `Z` é HOLD e `X` é SUB PAD (repete o pad em 1/16 no BPM). MIDI (canal 10): notas 36–47 são os pads, 48 Hold, 49 Sub Pad, 50 e 51 banco anterior e próximo (os pads do Arturia Minilab3).
- **Carregar som:** solte um arquivo de áudio num pad, ou segure **Shift** (do teclado) e toque o pad.
- **Efeitos:** os 5 diretos (FILTER+DRIVE, PITCH, DELAY, ISOLATOR, VINYL SIM) e os MFX 1–24. Aperte o efeito e gire **Ctrl 1–3**; o visor mostra o código do parâmetro e depois o valor. Para os MFX, segure **MFX** e gire o Ctrl 3, ou segure MFX e toque um pad.
  - **Onda 1:** PITCH (pitch shifter em tempo real, de -24 a +24 semitons, com feedback e balance), DELAY com tempo em nota no BPM, VINYL SIM com compressor, Reverb (MFX 1), Comp (12), Lo-Fi (14, ainda em ajuste) e DJFX Looper (24). Há também o extra Stopper/Back Spin.
  - **Onda 2:** Chorus (3), Flanger (4), Phaser (5), Tremolo/Pan (6), Distortion (7), Overdrive (8), Fuzz (9), Wah (10) e Ring Mod (18).
  - Os MFX que ainda não têm som mostram o número e `---`.
- **Gravar e marcar:** **REC** grava a entrada num pad (escolha a fonte em **SOURCE**; **STEREO** grava em 2 canais), **REMAIN** mostra o tempo livre de gravação e escolhe a que pads o efeito vale, **MARK** marca o trecho do pad, **DEL** apaga pads. Há também **TAP TEMPO** e **TIME/BPM**.
- **Reamostragem:** grava o que sai do 404 (com os efeitos) num pad.
- **Salvar e abrir disquete:** os botões na barra de cima salvam e abrem o estado inteiro (60 pads, efeitos, volume, BPM, nomes e modos) num arquivo `…-dcx-404.json`. O mesmo botão abre o disquete ou o projeto `.zip` do [DCX Studio](https://github.com/dcxaudio/dcx-studio), que só tem 16 pads (entram A1–A12 e B1–B4).
- **MIDI Learn:** o botão no alto da página aprende qualquer controle do painel.
- **Pattern Sequencer:** 60 patterns (bancos A–E × 12 pads, independentes dos bancos de sample). **PATTERN SELECT** escolhe e toca em loop (pad reservado entra no fim do loop; **SUB PAD** + pad troca na hora). Gravar com **REC**: contagem de 1 compasso, metrônomo, **LENGTH** (compassos), **QUANTIZE** e overdub. Apagar e editar: `ErS` (apaga notas gravando), `dEL`, `dAL` e `CHG` (trocar pads). Proteção por banco: com PATTERN SELECT aceso, segure REMAIN e aperte um banco A–E para ligar ou desligar (visor `A.on`/`A.oF`); Shift + LIGAR protege os 5 bancos (`P.on`). Em banco protegido, `dEL`, `dAL`, `CHG` e overdub mostram `Prt`; a proteção fica salva no estado e no disquete. Os patterns vão no disquete. Teclas padrão do computador: Ctrl 1–3 em U/J, I/K e O/L; bancos em F1–F5; REC em T; MFX em N; CANCEL em Backspace; do sequencer, P PATTERN SELECT, Y LENGTH, H QUANTIZE, G DEL, B REMAIN, vírgula START/END/LEVEL e ponto TIME/BPM.
- Ainda sem ação: MIC (decorativo).

Detalhes e códigos de visor de cada efeito estão no [manual](docs/manual.md); o histórico, no [CHANGELOG](CHANGELOG.md).

## Rodar no seu computador

O código comum vem do [dcx-core](https://github.com/dcxaudio/dcx-core), um submódulo em `vendor/dcx-core`:

```bash
git clone --recurse-submodules https://github.com/dcxaudio/dcx-404.git
```

```bash
cd dcx-404 && python3 -m http.server 8000
```

Depois abra `http://localhost:8000/novo/` (painel novo) ou `http://localhost:8000` (versão estável) e toque em LIGAR. Não tem build nem dependências. Os efeitos com AudioWorklet precisam de `http://` (não abrem por `file://`).

## Estrutura

```
index.html            página estável (host do dcx-core com só o 404, 16 pads)
js/solo.js            monta a página estável: host, teclado, mapa MIDI, tela de ligar
js/dcx404.js          o motor do aparelho (usado pelas duas faces): pads, bancos, buses, entrada, REC, Resample, display e armazenamento
js/fx.js              os efeitos e os AudioWorklets (PITCH, Looper, Stopper, Lo-Fi, modulação, drives)
css/dcx404.css        o painel da versão estável
novo/                 o painel novo do Figma: index.html, js/solo.js, js/abrir.js (disquete), css, fontes e 69 SVG
beta-2/               versão intermediária anterior
docs/manual.md        manual curto
CHANGELOG.md          histórico de mudanças
vendor/dcx-core/      submódulo (v1.0.0)
```

## Licença

GPL-3.0 ([LICENSE](LICENSE)).


---

Projeto independente, sem vínculo com os fabricantes dos equipamentos que inspiraram as máquinas. Os nomes SP-1200, SP-404, S950 e 1202 pertencem a seus donos e aparecem só em texto, como referência.

*Independent project, not affiliated with the makers of the gear that inspired the machines; names belong to their owners and appear as text only, for reference.*
