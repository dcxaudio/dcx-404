/* DCX-404 - face nova: abrir o disquete do 404 ou o projeto .zip do DCX Studio
 *
 * RJ.d4Open.parse(file)            -> Promise<{ data, from }>  (data = o disquete: { state, pads })
 *   aceita: o disquete salvo pelo Studio (dcx-disk, machine "dcx404", arquivo *dcx-404.json),
 *   o disquete "cru" ({ state, pads }) e o projeto .zip do Studio (so le o dcx-404.json de dentro).
 *   Arquivo de outra maquina, zip sem o 404 ou arquivo que nao e disquete: erro com mensagem clara.
 * RJ.d4Open.apply(d404, data, ctx) -> { pads, banks }  troca estado e samples do 404 da pagina.
 * RJ.d4Open.build(d404)            -> { blob, name, ... } o inverso: o disquete da pagina (60 pads, A1-E12)
 *   no mesmo envelope dcx-disk que o parse le. O Studio (16 pads) abre os 16 primeiros (A1-A12, B1-B4)
 *   e o estado; B5-E12 ficam de fora la.
 *
 * A conversao e a mesma da migracao automatica (solo.js): o pad guardado i do 404 estavel
 * vai para o pad guardado i da face nova, entao 1-12 viram A1-A12 e 13-16 viram B1-B4;
 * o estado (efeitos, volume, nomes, modos, nivel dos pads) passa pelo useState do motor.
 * So escreve no armazenamento da propria pagina ("dcx404-novo/"); a estavel nao muda.
 */
(function () {
  "use strict";
  const RJ = window.RJ;
  const DISK_FILE = "dcx-404.json";
  // os nomes que o Studio usa (dcx-studio/js/bar.js, DISKS)
  const LABEL = { rj2000: "RJ-2000", rj950: "RJ-950", rj42: "RJ-42", dcx404: "DCX 404", rj1202: "RJ-1202" };
  const labelOf = id => LABEL[id] || String(id || "outra maquina");

  /* zip em modo "store" (o que o Studio grava, dcx-studio/js/zip.js) e, se o navegador tiver
     DecompressionStream, "deflate" (zip refeito por outro programa) */
  async function inflate(u8) {
    if (typeof DecompressionStream === "undefined") throw new Error("Este navegador nao abre zip comprimido. Use o .zip salvo pelo Studio.");
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
    if (e < 0) throw new Error("Esse .zip esta danificado.");
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("Esse .zip esta danificado.");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith("/")) continue;
      // so abre o que interessa (o indice e o disquete do 404)
      out.push({ name, get: async () => {
        // o cabecalho local tem de estar dentro do arquivo (zip cortado ou mexido: mensagem clara, nao erro tecnico)
        if (lo + 30 > u8.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error("Esse .zip esta danificado.");
        const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
        if (start + csize > u8.length) throw new Error("Esse .zip esta danificado.");
        const data = u8.subarray(start, start + csize);
        if (method === 0) return data;
        if (method === 8) {
          try { return await inflate(data); } catch (e) { if (/navegador/.test(e.message || "")) throw e; throw new Error("Esse .zip esta danificado."); }
        }
        throw new Error("Esse .zip usa uma compressao que o 404 nao abre. Use o .zip salvo pelo Studio.");
      } });
    }
    return out;
  }

  /** O disquete do 404 de dentro de um JSON (wrapper do Studio ou cru); senao, erro com o nome da maquina. */
  function unwrap(d) {
    if (!d || typeof d !== "object") throw new Error("Esse arquivo nao e um disquete do DCX 404.");
    if (d.format === "dcx-studio-project") throw new Error("Esse e o indice do projeto (projeto.json). Abra o .zip do projeto inteiro.");
    if (d.format === "dcx-disk") {
      if (d.machine !== "dcx404") throw new Error("Esse disquete e do " + labelOf(d.machine) + ", nao do DCX 404.");
      if (!d.data || typeof d.data !== "object" || !d.data.state || typeof d.data.state !== "object") throw new Error("Esse disquete do DCX 404 esta vazio ou danificado.");
      return d.data;
    }
    // o disquete cru (sem o envelope do Studio): o estado diz que e do 404 ou, se antigo, tem a cara dele
    const s = d.state;
    if (s && typeof s === "object" && (s.format === "dcx404" || (s.format === undefined && (Array.isArray(d.pads) || "fx" in s || "pads" in s || "padLevel" in s)))) return d;
    // a memoria avulsa de outro aparelho (format "rj950", "rj42", ...)
    if (typeof d.format === "string" && LABEL[d.format] && d.format !== "dcx404") throw new Error("Esse arquivo e do " + labelOf(d.format) + ", nao do DCX 404.");
    if (d.format === "dcx404") throw new Error("Esse e so o estado do 404, sem os samples. Abra o disquete (dcx-404.json) ou o projeto .zip.");
    throw new Error("Esse arquivo nao e um disquete do DCX 404.");
  }

  const json = u8 => {
    if (!u8.length) throw new Error("Esse arquivo esta vazio.");
    let t;
    // o navegador nao monta um texto com mais de ~500 MB: dizer isso, nao "nao e JSON"
    const big = () => new Error("Esse disquete e grande demais para o navegador abrir (" + Math.round(u8.length / 1048576) + " MB).");
    try { t = new TextDecoder().decode(u8); } catch (e) { throw big(); }
    if (!t.length) throw big();   // o Chrome devolve "" (sem erro) quando passa do limite de texto
    try { return JSON.parse(t); } catch (e) {
      if (e instanceof RangeError) throw big();
      throw new Error("Esse arquivo nao e um disquete do DCX 404 (nao e JSON).");
    }
  };

  async function parse(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (!u8.length) throw new Error("Esse arquivo esta vazio.");
    const isZip = u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5);
    if (!isZip) {
      if (/\.zip$/i.test(file.name || "")) throw new Error("Esse .zip esta danificado.");
      return { data: unwrap(json(u8)), from: "disquete" };
    }
    const files = await readZip(buf);
    // o indice diz qual arquivo e o do 404; sem indice, o nome do Studio (tambem dentro de uma pasta)
    let want = null;
    const idx = files.find(f => f.name.split("/").pop() === "projeto.json");
    if (idx) {
      try {
        const x = json(await idx.get());
        const e = x && Array.isArray(x.disks) && x.disks.find(k => k && k.machine === "dcx404");
        if (e && e.file) want = String(e.file);
      } catch (_) { /* indice ilegivel: procura pelo nome */ }
    }
    const f = (want && files.find(k => k.name === want || k.name.endsWith("/" + want)))
      || files.find(k => k.name.split("/").pop() === DISK_FILE);
    if (!f) {
      if (!idx && !files.some(k => /\.json$/i.test(k.name))) throw new Error("Esse .zip nao e um projeto do DCX Studio.");
      throw new Error("Esse projeto nao tem o disquete do DCX 404 (" + DISK_FILE + ").");
    }
    return { data: unwrap(json(await f.get())), from: "projeto" };
  }

  /** Troca o 404 da pagina pelo disquete (o mesmo que o A.dcx404.set do Studio, com a conversao 16 -> 12 x 5). */
  function apply(d404, data, ctx) {
    const S = RJ.D404.SLOTS, P = RJ.D404.PADS;
    const st = Object.assign({}, data.state);
    if (st.format === undefined) st.format = "dcx404";   // estado antigo sem o campo: o disquete ja diz que e do 404
    d404.stopAll();
    d404.abortRecs();   // REC em espera/gravando (ou Resample): cancela antes, a gravacao nao cai no disquete novo
    if (d404.delMode) d404.delMode = null;
    d404.useState(st);
    let pads = 0, bad = 0;
    const banks = new Set();
    for (let i = 0; i < S; i++) {
      const x = Array.isArray(data.pads) ? data.pads[i] : null;
      let b = null;
      if (x && Array.isArray(x.ch) && x.ch.length && x.ch[0]) {
        try {
          const chs = x.ch.slice(0, 2).map(c => RJ.dsp.b64ToFloat(c));
          const rate = Number(x.rate) || ctx.sampleRate;
          if (chs[0].length) { b = ctx.createBuffer(chs.length, chs[0].length, rate); chs.forEach((c, k) => b.copyToChannel(c.subarray(0, chs[0].length), k)); }
        } catch (e) { console.warn("Sample do pad " + (i + 1) + " do disquete ilegivel", e); b = null; bad++; }
      }
      // o nome vem do estado; disquete antigo sem nomes no estado: o do sample (como a migracao, que le o pad guardado)
      const nm = b && !d404.st.pads[i].name && x && x.name ? String(x.name).slice(0, 40) : null;
      d404.setBuffer(i, b, nm, false);
      d404.saveSample(i);
      if (b) { pads++; banks.add("ABCDE"[Math.floor(i / P)]); }
    }
    const extra = Array.isArray(data.pads) ? data.pads.slice(S).filter(Boolean).length : 0;
    d404.applyAll(); d404.render(); d404.saveNow();
    return { pads, banks: [...banks], bad, extra };
  }

  /* ================================================================ salvar (o inverso do apply) */

  // Float32 -> base64 de Int16, o mesmo formato do dsp.floatToB64 (o Studio e o abrir leem com
  // dsp.b64ToFloat = i16 / 0x8000), mas com a escala inversa exata (x 0x8000, arredondado): um sample
  // que veio do disquete ou do navegador volta com os mesmos valores (o floatToB64 perde 1 bit nos positivos)
  function f2b64(data) {
    const i16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = Math.round(data[i] * 0x8000);
      i16[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    const u8 = new Uint8Array(i16.buffer);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const two = n => String(n).padStart(2, "0");
  /** nome do arquivo com data e hora: dcx-404-novo-2026-11-09-1530-dcx-404.json (termina como o do Studio) */
  function fileName(d) {
    d = d || new Date();
    return "dcx-404-novo-" + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + "-" + two(d.getHours()) + two(d.getMinutes()) + "-" + DISK_FILE;
  }

  /**
   * O disquete da pagina: o mesmo envelope do Studio (dcx-disk, machine "dcx404", data = { state, pads })
   * que o parse le, com os 60 pads guardados (A1-E12). Devolve { blob, name, pads, banks, bytes }.
   * O JSON vai em pedacos (um por pad) para um disquete grande nao virar um texto unico gigante.
   */
  function build(d404, opts) {
    const o = opts || {};
    const S = RJ.D404.SLOTS, P = RJ.D404.PADS;
    const state = JSON.parse(d404.serialize());
    const head = { format: "dcx-disk", version: 1, machine: "dcx404", name: LABEL.dcx404,
      project: o.project || "DCX 404 (face nova)", saved: new Date().toISOString(),
      layout: { pads: P, banks: RJ.D404.BANKS } };
    const s0 = JSON.stringify(head);
    const parts = [s0.slice(0, -1) + ',"data":{"state":' + JSON.stringify(state) + ',"pads":['];
    let pads = 0;
    const banks = new Set();
    for (let i = 0; i < S; i++) {
      const b = d404.buf[i];
      if (i) parts.push(",");
      if (!b) { parts.push("null"); continue; }
      const ch = [];
      for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) ch.push(f2b64(b.getChannelData(c)));
      parts.push(JSON.stringify({ name: (state.pads[i] && state.pads[i].name) || "", rate: b.sampleRate, ch }));
      pads++; banks.add("ABCDE"[Math.floor(i / P)]);
    }
    parts.push("]}}");
    const blob = new Blob(parts, { type: "application/json" });
    return { blob, name: o.name || fileName(), pads, banks: [...banks], bytes: blob.size };
  }

  RJ.d4Open = { parse, apply, unwrap, readZip, build, fileName };
})();
