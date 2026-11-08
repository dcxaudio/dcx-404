# DCX 404

Sampler de performance que roda no navegador: 16 pads, 9 efeitos ao vivo em dois buses, entrada com efeito e reamostragem. É um projeto open source da [DCX Audio](https://github.com/dcxaudio), inspirado nos samplers de performance de mesa.

- Solte um arquivo de áudio num pad, ou aperte **Shift** e o pad para escolher o arquivo.
- Teclado: `1`–`4`, `Q`–`R`, `A`–`F` e `Z`–`V` tocam os 16 pads. MIDI: canal 10, notas 36 a 51 (os pads do Arturia Minilab3).
- Escolha o **Bus**, aperte um efeito e gire **Ctrl 1–3**. O display mostra o efeito e o valor.
- O botão **MIDI Learn** no alto da página aprende qualquer controle do painel.
- O manual está em [docs/manual.md](docs/manual.md).

## Rodar no seu computador

O código comum vem do [dcx-core](https://github.com/dcxaudio/dcx-core), um submódulo em `vendor/dcx-core`:

```bash
git clone --recurse-submodules https://github.com/dcxaudio/dcx-404.git
```

```bash
cd dcx-404 && python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. Não tem build nem dependências. Os efeitos com AudioWorklet precisam de `http://` (não abrem por `file://`).

## Estrutura

```
index.html            página solo (host do dcx-core com só o 404)
js/solo.js            monta a página: host, teclado, mapa MIDI padrão, tela de ligar
js/dcx404.js          o aparelho: pads, buses, entrada, Resample, display e armazenamento
js/fx.js              os 9 efeitos e o AudioWorklet (Looper, Stopper, Lo-fi, gravação)
css/dcx404.css        o painel (mockup v4)
docs/manual.md        manual curto
vendor/dcx-core/      submódulo (v1.0.0)
```

## Licença

GPL-3.0 ([LICENSE](LICENSE)).
