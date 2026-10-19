'use strict';
// 1D streaming Save/Open of a project file (the riskiest path: his project files).
//  - testoProgetto() is byte-identical to the old one-shot JSON.stringify output
//  - Save through an OPFS handle writes exactly that text; Open gives back the same project
//  - a file saved by the PRISTINE app (t7-pristine.json, made by t7-gen-pristine.cjs) opens
//  - unicode, quotes and backslashes in names/paths/titles
//  - truncated / malformed files: toast, nothing changes, the page stays alive
//  - the scanner gives the same answer however the bytes are split into chunks (and vs JSON.parse on random strings)
//  - a write that fails midway leaves the file on disk untouched
const fs = require('node:fs'), path = require('node:path');
const setup = require('./t7setup.cjs');
module.exports = async ({ ev, delay }) => {
  const res = { checks: {} }; const fails = [];
  const chk = (name, cond, info) => { res.checks[name] = !!cond; if (!cond) { fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 300) : '')); } };

  await setup(ev);
  /* helpers in the page */
  await ev(`window.sha = async b => { const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer()); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    window.untilTrue = async (fn, ms = 60000) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) return false; await new Promise(r => setTimeout(r, 5)); } return true; };
    window.openWait = async (file, handle) => { toast(''); const u0 = undoStack.length; caricaPresetFile(file, handle); await new Promise(r => setTimeout(r, 0));
      const ok = await untilTrue(() => aprendoProgetto === false, 120000); return { ok, toast: document.getElementById('toast').textContent, undoGrew: undoStack.length - u0 }; };
    window.canon = o => Array.isArray(o) ? o.map(canon) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, canon(o[k])])) : o;
    window.digest = async () => ({ snap: JSON.stringify(canon(JSON.parse(snapState()))), active: state.active, title: state.pack.title, nSh: SHOTS.length,
      shots: await Promise.all(SHOTS.map(async s => [s.name, s.path, s.blob.size, s.blob.type, await sha(s.blob)])),
      logo: logoBlob ? [logoBlob.name, logoBlob.size, await sha(logoBlob)] : null,
      src: JSON.stringify(FORMATS.map(f => state.layouts[f.id].shot.src)) });
    window.oldTesto = async () => { const images = []; for (const sh of SHOTS) { const blob = sh.blob || await immagineInBlob(sh.img);
        images.push({ name: sh.name, path: sh.path || sh.name, type: blob.type || 'image/png', data: await blobInBase64(blob) }); }
      const logo = logoBlob ? { name: logoBlob.name || 'logo.png', type: logoBlob.type || 'image/png', data: await blobInBase64(logoBlob) } : null;
      return JSON.stringify({ app: 'store-graphics', v: APP.version, format: 2, pack: state.pack, theme: state.theme, naming: state.naming, export: state.export,
        variants: state.variants, layouts: state.layouts, active: state.active, images, logo }); };
    window.opfsHandle = async name => { const root = await navigator.storage.getDirectory(); return root.getFileHandle(name, { create: true }); };
    1`);

  /* 1. byte-identical text */
  const same = await ev(`(async () => { const a = await oldTesto(), b = await testoProgetto(); return { eq: a === b, la: a.length, lb: b.length }; })()`);
  chk('testoProgetto == old JSON.stringify', same.eq, same);

  /* 2. save through a real OPFS handle, compare the bytes on disk with the old text */
  const sv = await ev(`(async () => { const h = await opfsHandle('t7-a.json'); fileProgetto = h; nomeProgetto = h.name; toast('');
    await salvaProgetto(false); const f = await h.getFile(); const disk = new Uint8Array(await f.arrayBuffer());
    const want = new TextEncoder().encode(await oldTesto());
    let eq = disk.length === want.length; if (eq) for (let i = 0; i < disk.length; i++) if (disk[i] !== want[i]) { eq = false; break; }
    return { eq, disk: disk.length, want: want.length, toast: document.getElementById('toast').textContent, auto: document.querySelector('#projInfo .auto').textContent }; })()`);
  chk('saved bytes == old text bytes', sv.eq, sv);
  chk('save toast', /^Saved to t7-a\.json, 8 images inside/.test(sv.toast), sv.toast);

  /* 3. round trip */
  const before = await ev('digest()');
  const rt = await ev(`(async () => { const h = await opfsHandle('t7-a.json'); const f = await h.getFile();
    state.pack.title = 'changed'; SHOTS = []; imgShot = null; logoBlob = null; imgLogo = null; state.active = 'unity_cover';
    const r = await openWait(f, h); r.d = await digest(); r.fh = fileProgetto === h; return r; })()`);
  chk('open finished', rt.ok, rt);
  chk('open toast', /^Project opened: .*8 images/.test(rt.toast), rt.toast);
  chk('round trip equal (snap, shots sha, logo sha, src)', JSON.stringify(rt.d) === JSON.stringify(before), { a: rt.d.title, b: before.title, n: rt.d.nSh });
  chk('save target restored', rt.fh);
  chk('unicode title back', rt.d.title === before.title && rt.d.title.includes('日本'), rt.d.title);
  chk('names back', JSON.stringify(rt.d.shots.map(s => s[0])) === JSON.stringify(setup.NAMES), rt.d.shots.map(s => s[0]));
  chk('paths back', rt.d.shots[0][1] === setup.PATH0 && rt.d.shots[1][1] === setup.PATH1, rt.d.shots.slice(0, 2).map(s => s[1]));
  /* re-save after open gives the same bytes */
  /* (the layout keys come back in another order after an open, in the old code too: compare sorted, then check it is stable) */
  const again = await ev(`(async () => { const h = await opfsHandle('t7-a.json'); const disk = await (await h.getFile()).text(); const b = await testoProgetto();
    const same = JSON.stringify(canon(JSON.parse(disk))) === JSON.stringify(canon(JSON.parse(b)));
    fileProgetto = h; await salvaProgetto(false); const t1 = await (await h.getFile()).text(); await openWait(await h.getFile(), h); await salvaProgetto(false); const t2 = await (await h.getFile()).text();
    return { same, stable: t1 === t2, ident: b === await oldTesto() }; })()`);
  chk('open then re-save: same project (sorted), and stable from then on', again.same && again.stable && again.ident, again);

  /* 4. file saved by the pristine app */
  const pj = path.join(__dirname, 't7-pristine.json'), pm = path.join(__dirname, 't7-pristine.meta.json');
  if (fs.existsSync(pj) && fs.existsSync(pm)) {
    const ptxt = fs.readFileSync(pj, 'utf8'), meta = JSON.parse(fs.readFileSync(pm, 'utf8'));
    const pr = await ev(`(async () => { const t = ${JSON.stringify(ptxt)}; SHOTS = []; imgShot = null; logoBlob = null; imgLogo = null; state.pack.title = 'zz';
      const r = await openWait(new File([t], 'pristine.json', { type: 'application/json' }), null); r.d = await digest(); r.again = await testoProgetto(); r.t = t; return r; })()`);
    chk('pristine file opens', pr.ok && /^Project opened/.test(pr.toast), pr.toast);
    const canonN = o => Array.isArray(o) ? o.map(canonN) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, canonN(o[k])])) : o;
    /* settings added after the pristine file was written (1.7.0: export.bundle) get their default on open: leave them out */
    const senzaNuovi = o => { o = JSON.parse(JSON.stringify(o)); if (o && o.export) delete o.export.bundle; return o; };
    chk('pristine snapState equal (sorted keys)', JSON.stringify(canonN(senzaNuovi(JSON.parse(pr.d.snap)))) === JSON.stringify(canonN(senzaNuovi(JSON.parse(meta.snap)))), 'differs');
    chk('pristine images (name,path,size,type)', JSON.stringify(pr.d.shots.map(s => s.slice(0, 4))) === JSON.stringify(meta.shots), pr.d.shots.map(s => s.slice(0, 4)));
    chk('pristine logo', pr.d.logo && pr.d.logo[1] === meta.logo);
    chk('pristine active', pr.d.active === meta.active, pr.d.active);
    chk('pristine: reopen then save gives the same project (sorted keys)', JSON.stringify(canonN(senzaNuovi(JSON.parse(pr.again)))) === JSON.stringify(canonN(senzaNuovi(JSON.parse(pr.t)))));
    res.pristineBytes = ptxt.length;
  } else res.pristine = 'SKIPPED (t7-pristine.json missing)';

  /* 5. truncated and malformed files: nothing changes, page keeps working */
  await ev(`(async () => { const h = await opfsHandle('t7-a.json'); await openWait(await h.getFile(), h); window.base = await digest(); window.baseShots = SHOTS; window.txt = await (await h.getFile()).text();
    window.bytes = new TextEncoder().encode(txt); window.mkF = (u8, n) => new File([u8], n || 'bad.json', { type: 'application/json' }); return 1; })()`);
  const L = await ev('bytes.length');
  const cuts = [0, 1, 2, 10, 60, 5000, Math.floor(L / 3), Math.floor(L / 2), L - 5000, L - 200, L - 30, L - 3, L - 2, L - 1];
  const badOut = [];
  for (const k of cuts) {
    const r = await ev(`(async () => { const r = await openWait(mkF(bytes.slice(0, ${k}), 'cut${k}.json'), null); const d = await digest();
      return { ok: r.ok, toast: r.toast, undoGrew: r.undoGrew, same: JSON.stringify(d) === JSON.stringify(base), refSame: SHOTS === baseShots }; })()`);
    const good = r.ok && /could not be read as a project/.test(r.toast) && r.same && r.refSame && r.undoGrew === 0;
    if (!good) badOut.push([k, r]);
  }
  chk('truncated at ' + cuts.length + ' offsets: error toast, state untouched, no undo step', badOut.length === 0, badOut.slice(0, 2));
  const mal = {
    garbage: 'garbage<<', empty: '', array: '[1,2,3]', nullv: 'null', str: '"x"', num: '12',
    unbalanced: '{"pack":{"title":"x"}', extra: '{"pack":{"title":"x"}}}', badesc: '{"pack":{"title":"x\\q"}}',
    dupquote: '{"pack":{"title":"x""}}',
  };
  const malBad = [];
  for (const [k, v] of Object.entries(mal)) {
    const r = await ev(`(async () => { const r = await openWait(new File([${JSON.stringify(v)}], 'm.json'), null); const d = await digest(); return { ok: r.ok, toast: r.toast, same: JSON.stringify(d) === JSON.stringify(base), undoGrew: r.undoGrew }; })()`);
    const expect = (k === 'array' || k === 'nullv' || k === 'str' || k === 'num') ? /not a Store Graphics project|could not be read/ : /could not be read as a project/;
    if (!(r.ok && expect.test(r.toast) && r.same && r.undoGrew === 0)) malBad.push([k, r]);
  }
  chk('malformed files: error toast, state untouched', malBad.length === 0, malBad.slice(0, 2));
  const notmine = await ev(`(async () => { const r = await openWait(new File(['{"hello":1}'], 'x.json'), null); return { toast: r.toast, same: JSON.stringify(await digest()) === JSON.stringify(base) }; })()`);
  chk('foreign JSON: "not a Store Graphics project"', /is not a Store Graphics project/.test(notmine.toast) && notmine.same, notmine);
  const old = await ev(`(async () => { const r = await openWait(new File([JSON.stringify({ pack: { title: 'Old preset' }, layouts: {} })], 'old.json'), null); return { toast: r.toast, title: state.pack.title, nSh: SHOTS.length }; })()`);
  chk('preset without images: "Older preset opened", images kept', /^Older preset opened, images not included/.test(old.toast) && old.title === 'Old preset' && old.nSh === 8, old);

  /* pretty-printed project (indentation, newlines between everything) */
  const pretty = await ev(`(async () => { await openWait(mkF(bytes), null); const o = JSON.parse(txt); const p = JSON.stringify(o, null, 2); state.pack.title = 'zz'; SHOTS = [];
    const r = await openWait(new File([p], 'pretty.json'), null); const d = await digest(); return { toast: r.toast, same: JSON.stringify(d.shots) === JSON.stringify(base.shots) && d.snap === base.snap }; })()`);
  chk('pretty-printed project opens identically', /^Project opened/.test(pretty.toast) && pretty.same, pretty);

  /* a damaged image inside an otherwise good file: counted, the others load */
  const dmg = await ev(`(async () => { const o = JSON.parse(txt); o.images[2].data = '!!!not base64!!!'; o.images[4].data = btoa('this is not an image'); o.images[6].data = '';
    const r = await openWait(new File([JSON.stringify(o)], 'dmg.json'), null); return { toast: r.toast, n: SHOTS.length }; })()`);
  chk('damaged images skipped and counted', /^Project opened: .*5 images, 3 images could not be read/.test(dmg.toast) && dmg.n === 5, dmg);

  /* adversarial text inside strings: keys, brackets, escaped quotes, backslash runs */
  const adv = await ev(`(async () => { await openWait(mkF(bytes), null);
    state.pack.title = '], "images": [ {"name":"x"} ] \\\\\\\\" \\\\"images\\\\": [{ } ]}'; state.pack.sub = '"}],"logo":{"data":"zz'; SHOTS[0].name = '"data":"'; SHOTS[1].name = '\\\\'; SHOTS[2].name = '\\\\"}';
    const want = await digest(); const t = await testoProgetto(); state.pack.title = 'q'; SHOTS = [];
    const r = await openWait(new File([t], 'adv.json'), null); const got = await digest();
    return { toast: r.toast, same: JSON.stringify(got) === JSON.stringify(want), title: got.title }; })()`);
  chk('adversarial strings (fake keys, brackets, backslash runs)', /^Project opened/.test(adv.toast) && adv.same, adv);

  /* 6. scanner vs chunk size vs JSON.parse oracle */
  const sc = await ev(`(async () => {
    await openWait(mkF(bytes), null);
    const fake = (u8, k) => ({ size: u8.length, stream() { let i = 0; return new ReadableStream({ pull(c) { if (i >= u8.length) { c.close(); return; } const n = typeof k === 'function' ? k() : k; c.enqueue(u8.slice(i, i + n)); i += n; } }); },
      slice(a, b) { return new Blob([u8.slice(a, b)]); }, text() { return new Blob([u8]).text(); } });
    const full = await trovaImmagini(fake(bytes, 1e9)); const out = { n: full.els.length, bad: [] };
    for (const k of [1, 2, 3, 5, 7, 13, 64, 1000, 4097, 65536]) { const r = await trovaImmagini(fake(bytes, k)); if (JSON.stringify(r) !== JSON.stringify(full)) out.bad.push(k); }
    const rnd = () => 1 + Math.floor(Math.random() * 40);
    for (let t = 0; t < 20; t++) { const r = await trovaImmagini(fake(bytes, rnd)); if (JSON.stringify(r) !== JSON.stringify(full)) out.bad.push('rnd'); }
    /* random strings in names/paths/titles: parse via leggiProgetto with random chunking and compare to JSON.parse */
    const al = ['"', '\\\\', 'a', ' ', '\\u00e9', '\\u65e5', '\\ud83d\\ude00', '\\n', '/', "'", '[', '{', ']', '}', ':', ',', 'images'];
    const rs = () => { let s = ''; const n = 1 + Math.floor(Math.random() * 14); for (let i = 0; i < n; i++) s += al[Math.floor(Math.random() * al.length)]; return s; };
    out.fz = 0;
    for (let t = 0; t < 60; t++) {
      const o = JSON.parse(txt); o.pack.title = rs(); o.pack.sub = rs(); o.images.slice(0, 3).forEach(im => { im.name = rs(); im.path = rs(); }); o.images = o.images.slice(0, 3); if (t % 4 === 0) o.images = [];
      const s = JSON.stringify(o), u8 = new TextEncoder().encode(s), ff = fake(u8, rnd);
      const { d, immagini } = await leggiProgetto(ff); const els = [];
      if (immagini) for (let i = 0; i < immagini.n; i++) els.push(await immagini.leggi(i));
      const exp = JSON.parse(s); const okd = JSON.stringify(Object.assign({}, d, { images: undefined })) === JSON.stringify(Object.assign({}, exp, { images: undefined }));
      if (!(okd && JSON.stringify(els) === JSON.stringify(exp.images) && (immagini ? true : false) === (Array.isArray(exp.images)))) out.bad.push('fz' + t + ':' + s.slice(0, 80)); else out.fz++;
    }
    return out; })()`);
  chk('scanner: same answer for every chunking, random strings vs JSON.parse', sc.bad.length === 0 && sc.n === 8 && sc.fz === 60, sc);

  /* 7. progress text during Save with more than 10 images */
  const pg = await ev(`(async () => { SHOTS = []; imgShot = null; const fl = []; for (let i = 0; i < 14; i++) fl.push(await mkImg('p' + i + '.png', 'png', 20 + i * 5, 3000 + i));
    await new Promise(r => addShots(fl, r)); const h = await opfsHandle('t7-p.json'); fileProgetto = h; nomeProgetto = h.name;
    const seen = new Set(); let stop = false; const poll = (async () => { while (!stop) { const a = document.querySelector('#projInfo .auto'); if (a && /Saving/.test(a.textContent)) seen.add(a.textContent.trim().replace(/^\\u00b7\\s*/, '')); await new Promise(r => setTimeout(r, 0)); } })();
    await salvaProgetto(false); stop = true; await poll; const a = document.querySelector('#projInfo .auto').textContent;
    const r = await openWait(await h.getFile(), h); return { seen: [...seen], after: a, open: r.toast, nSh: SHOTS.length }; })()`);
  chk('Saving k/n shown (>10 images), cleared after', pg.seen.length >= 1 && pg.seen.every(x => /^Saving \d+\/14$/.test(x)) && !/Saving/.test(pg.after), pg);
  chk('14-image project reopens', /^Project opened/.test(pg.open) && pg.nSh === 14, pg);

  /* 8. failures while writing: the file on disk stays as it was */
  const fl = await ev(`(async () => { const h = await opfsHandle('t7-f.json'); { const w = await h.createWritable(); await w.write('ORIGINAL'); await w.close(); }
    const mk = (n, name) => ({ name: 't7-f.json', queryPermission: undefined, async createWritable() { const w = await h.createWritable(); let c = 0, ab = 0; window.__aborted = 0;
      return { async write(p) { if (++c === n) throw new DOMException('disk full', name); return w.write(p); }, close: () => w.close(), async abort() { window.__aborted++; return w.abort(); } }; } });
    const out = {};
    for (const [tag, n, name] of [['generic', 5, 'Error'], ['denied', 3, 'NotAllowedError'], ['first', 1, 'QuotaExceededError']]) {
      fileProgetto = mk(n, name); nomeProgetto = 't7-f.json'; toast(''); await salvaProgetto(false);
      out[tag] = { toast: document.getElementById('toast').textContent, disk: await (await h.getFile()).text(), aborted: window.__aborted, salvando };
    }
    return out; })()`);
  chk('failed write: file untouched, abort called, message says so', ['generic', 'denied', 'first'].every(k => fl[k].disk === 'ORIGINAL' && fl[k].aborted === 1 && !fl[k].salvando && /The file on disk was not changed/.test(fl[k].toast)), fl);
  chk('"Save as" hint only for NotAllowedError', /Use Save as/.test(fl.denied.toast) && !/Use Save as/.test(fl.generic.toast), fl);

  /* 8b. no file picker (plain browser): the download fallback writes the same bytes */
  const fb = await ev(`(async () => { await openWait(mkF(bytes), null); const keepPicker = window.showSaveFilePicker; window.showSaveFilePicker = undefined; fileProgetto = null;
    let blob = null; const cu = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return 'blob:x'; }; const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; };
    try { toast(''); await salvaProgetto(true); } finally { URL.createObjectURL = cu; HTMLAnchorElement.prototype.click = ck; window.showSaveFilePicker = keepPicker; }
    return { got: !!blob, same: blob ? (await blob.text()) === await oldTesto() : false, name: window.__dl, toast: document.getElementById('toast').textContent }; })()`);
  chk('fallback download (no picker) writes the same project', fb.got && fb.same && /.json$/.test(fb.name || '') && fb.toast === 'Project saved', fb);

  /* 9. a second Open while one is running */
  const dbl = await ev(`(async () => { const h = await opfsHandle('t7-a.json'); const f = await h.getFile(); toast(''); caricaPresetFile(f, h); caricaPresetFile(f, h);
    const second = document.getElementById('toast').textContent; await untilTrue(() => aprendoProgetto === false); return { second, nSh: SHOTS.length, errs: qaErrors.length }; })()`);
  chk('second Open while opening is refused politely', /Still opening/.test(dbl.second) && dbl.nSh === 8, dbl);

  const errs = await ev('qaErrors');
  chk('no page errors', errs.length === 0, errs);
  res.ok = fails.length === 0; if (fails.length) res.fails = fails;
  return res;
};
