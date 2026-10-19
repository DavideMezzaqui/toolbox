'use strict';
// 1D big case: 100 images of ~6 MB (about 800 MB project file). Needs the fixtures of the perf bench
// (BIG_FIXTURES=<dir with shot001.png ..> or ../../../../perf/fixtures when run from the work folder).
// Save must succeed with no long task above 100 ms, Open must give back 100 identical images, and a
// truncated copy of the big file must be refused without touching the page.
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ ev, command, until, delay, log }) => {
  const dir = process.env.BIG_FIXTURES || path.resolve(__dirname, '../../../../perf/fixtures');
  if (!fs.existsSync(path.join(dir, 'shot100.png'))) return { ok: true, skipped: 'fixtures not found in ' + dir };
  const N = +process.env.BIG_N || 100;
  const files = []; for (let i = 1; i <= N; i++) files.push(path.join(dir, 'shot' + String(i).padStart(3, '0') + '.png'));
  const res = { checks: {} }, fails = [];
  const chk = (n, c, info) => { res.checks[n] = !!c; if (!c) fails.push(n + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 300) : '')); };
  const job = async (name, body, ms = 900000) => {      // run a long async body in the page without holding one CDP call open
    await ev(`window.__j = { done: false }; (async () => { try { window.__j.r = await (${body})(); } catch (e) { window.__j.err = String(e && e.stack || e); } window.__j.done = true; })(); 1`);
    await until(() => ev('__j.done'), name, ms);
    const r = await ev('JSON.stringify(__j)'); const o = JSON.parse(r); if (o.err) throw Error(name + ': ' + o.err); return o.r;
  };
  await ev(`window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask' }); } catch (e) {}
    window.sha = async b => { const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer()); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    window.canon = o => Array.isArray(o) ? o.map(canon) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, canon(o[k])])) : o;
    window.ltMax = from => Math.round(Math.max(0, ...__lt.filter(x => x[0] >= from).map(x => x[1])));
    SHOTS = []; imgShot = null; 1`);

  /* Until package 1A (async thumbnails) is merged, opening 100 images spends ~5 s in one task decoding every full
     image for the strip (miniatura). That is not Save/Open work: stub it so the numbers measure 1D alone.
     BIG_STUB_THUMBS=0 keeps the real thing. */
  const stub = process.env.BIG_STUB_THUMBS ? process.env.BIG_STUB_THUMBS !== '0' : !(await ev('typeof preparaImmagini === "function"'));
  res.thumbsStubbed = stub;
  if (stub) await ev('window.miniatura = function () { const c = document.createElement("canvas"); c.width = 128; c.height = 72; return c; }; 1');
  /* load the fixtures like the Add button */
  const doc = await command('DOM.getDocument', { depth: -1, pierce: true });
  const find = n => { if (n.attributes) { const i = n.attributes.indexOf('id'); if (i >= 0 && n.attributes[i + 1] === 'fImg') return n; } for (const c of (n.children || []).concat(n.contentDocument ? [n.contentDocument] : [])) { const r = find(c); if (r) return r; } return null; };
  const node = find(doc.root); if (!node) throw Error('fImg not found');
  await command('DOM.setFileInputFiles', { files, backendNodeId: node.backendNodeId });
  await until(() => ev(`SHOTS.length === ${N}`), 'images added', 600000);
  await delay(3000);
  log('loaded', N);
  await ev(`state.pack.title = 'Big \\u00e8 "x"'; FORMATS.forEach((f, k) => { const S = state.layouts[f.id].shot; S.panels = 2; S.src = [k % ${N}, (k + 1) % ${N}, -1, -1, -1, -1]; }); window.before = JSON.stringify(canon(JSON.parse(snapState()))); window.sizes = SHOTS.map(s => s.blob.size); 1`);
  res.imgMB = await ev('Math.round(sizes.reduce((a, b) => a + b, 0) / 1048576)');

  /* SAVE */
  const sv = await job('save', `async () => { const root = await navigator.storage.getDirectory(); for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
    const h = await root.getFileHandle('big.json', { create: true }); fileProgetto = h; nomeProgetto = h.name; toast('');
    await new Promise(r => setTimeout(r, 500)); const t0 = performance.now(); await salvaProgetto(false); const ms = Math.round(performance.now() - t0);
    await new Promise(r => setTimeout(r, 300)); const f = await h.getFile();
    return { ms, lt: ltMax(t0), toast: document.getElementById('toast').textContent, MB: Math.round(f.size / 1048576), size: f.size }; }`);
  res.save = sv; log('save', JSON.stringify(sv));
  chk('save succeeded', /^Saved to big\.json, \d+ images inside/.test(sv.toast), sv.toast);
  chk('save: no long task above 100 ms', sv.lt <= 100, sv.lt);
  chk('file is big (> 512 MB, the old open limit)', sv.MB > 512, sv.MB);

  /* how long the scan alone takes on the big file */
  const scan = await job('scan', `async () => { const f = await (await (await navigator.storage.getDirectory()).getFileHandle('big.json')).getFile(); const t0 = performance.now(); const r = await trovaImmagini(f);
    const ms = Math.round(performance.now() - t0); const t1 = performance.now(); const x = await leggiProgetto(f); return { scanMs: ms, elements: r.els.length, leggiProgettoMs: Math.round(performance.now() - t1), lt: ltMax(t0) }; }`);
  res.scan = scan; chk('scan finds 100 elements', scan.elements === N, scan);
  /* OPEN the 100-image file */
  const op = await job('open', `async () => { const root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('big.json'); const f = await h.getFile();
    SHOTS = []; imgShot = null; state.pack.title = 'zz'; await new Promise(r => setTimeout(r, 800)); toast(''); const t0 = performance.now(); caricaPresetFile(f, h);
    while (aprendoProgetto) await new Promise(r => setTimeout(r, 20)); const ms = Math.round(performance.now() - t0);
    const lt = ltMax(t0), toastText = document.getElementById('toast').textContent;
    const same = SHOTS.length === sizes.length && SHOTS.every((s, i) => s.blob.size === sizes[i]);
    return { ms, lt, toast: toastText, n: SHOTS.length, same, snapEq: JSON.stringify(canon(JSON.parse(snapState()))) === before }; }`);
  res.open = op; log('open', JSON.stringify(op));
  chk('open: 100 images', op.n === N && /^Project opened/.test(op.toast), op);
  chk('open: blob sizes equal, snapState equal', op.same && op.snapEq, op);
  /* the bytes: compare every image with its source file */
  const bad = await job('sha', `async () => { const bad = []; for (let i = 0; i < SHOTS.length; i++) { const a = await sha(SHOTS[i].blob); (window.__sh = window.__sh || []).push(a); } return window.__sh.length; }`);
  const shaDisk = files.map(f => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  const shaPage = await ev('JSON.stringify(__sh)'); chk('open: every image byte-identical to its file on disk', JSON.stringify(shaDisk) === shaPage);

  /* truncated copy of the big file */
  const tr = await job('trunc', `async () => { const root = await navigator.storage.getDirectory(); const f = await (await root.getFileHandle('big.json')).getFile();
    const keep = SHOTS, snap = snapState(); const out = [];
    for (const frac of [0.5, 0.97, 0.99999]) { const cut = new File([f.slice(0, Math.floor(f.size * frac))], 'trunc.json'); const t0 = performance.now(); toast(''); caricaPresetFile(cut, null);
      while (aprendoProgetto) await new Promise(r => setTimeout(r, 20)); out.push({ frac, ms: Math.round(performance.now() - t0), toast: document.getElementById('toast').textContent, same: SHOTS === keep && snapState() === snap }); }
    return out; }`);
  res.trunc = tr; chk('truncated big file refused, page untouched', tr.every(x => /could not be read as a project/.test(x.toast) && x.same), tr);

  /* 60 images: save, then open with the timing of the acceptance list */
  const o60 = await job('open60', `async () => { const keepAll = SHOTS.slice(); SHOTS = keepAll.slice(0, 60); imgShot = SHOTS[0].img; const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle('p60.json', { create: true }); fileProgetto = h; nomeProgetto = h.name; await salvaProgetto(false); const f = await h.getFile();
    SHOTS = []; imgShot = null; await new Promise(r => setTimeout(r, 800)); toast(''); const t0 = performance.now(); caricaPresetFile(f, h);
    while (aprendoProgetto) await new Promise(r => setTimeout(r, 20)); const ms = Math.round(performance.now() - t0);
    return { ms, lt: ltMax(t0), MB: Math.round(f.size / 1048576), n: SHOTS.length, toast: document.getElementById('toast').textContent }; }`);
  res.open60 = o60; log('open60', JSON.stringify(o60));
  chk('open 60: longest task <= 150 ms', o60.lt <= 150, o60);
  chk('open 60: wall <= 8.9 s', o60.ms <= 8900, o60);
  chk('open 60: all images', o60.n === 60, o60);
  chk('open 100: wall time recorded (info)', true);
  const errs = await ev('qaErrors'); chk('no page errors', errs.length === 0, errs);
  res.ok = fails.length === 0; if (fails.length) res.fails = fails;
  return res;
};
