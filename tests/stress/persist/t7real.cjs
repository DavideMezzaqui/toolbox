'use strict';
// Round trip of a real project file (REAL_PROJECT=<path>; READ ONLY, work on a copy): open it through the
// file input, Save to an OPFS file, hash the result. Run it on the pristine app and on the new one: the
// printed hashes must be equal (same project text, byte for byte). Also reopens the saved file.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
module.exports = async ({ ev, command, until, delay, log }) => {
  const file = process.env.REAL_PROJECT || path.resolve(__dirname, '../../../../real-project.json');
  if (!fs.existsSync(file)) return { ok: true, skipped: 'no REAL_PROJECT' };
  const orig = fs.readFileSync(file, 'utf8'), origObj = JSON.parse(orig);
  await ev(`window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask' }); } catch (e) {}
    window.sha = async b => { const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer()); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    window.canon = o => Array.isArray(o) ? o.map(canon) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, canon(o[k])])) : o; 1`);
  const doc = await command('DOM.getDocument', { depth: -1, pierce: true });
  const find = n => { if (n.attributes) { const i = n.attributes.indexOf('id'); if (i >= 0 && n.attributes[i + 1] === 'fPreset') return n; } for (const c of (n.children || []).concat(n.contentDocument ? [n.contentDocument] : [])) { const r = find(c); if (r) return r; } return null; };
  const node = find(doc.root);
  await ev('toast(""); window.__t0 = performance.now(); 1');
  await command('DOM.setFileInputFiles', { files: [file], backendNodeId: node.backendNodeId });
  await until(() => ev('/Project opened|could not be read|Older preset/.test(document.getElementById("toast").textContent) && (typeof aprendoProgetto==="undefined"||aprendoProgetto===false)'), 'open', 120000).catch(async () => {
    /* the pristine app has no aprendoProgetto: wait on the toast only */
    await until(() => ev('/Project opened|could not be read|Older preset/.test(document.getElementById("toast").textContent)'), 'open2', 120000); });
  await delay(1500);
  const o = await ev(`({ toast: document.getElementById('toast').textContent, n: SHOTS.length, lt: Math.round(Math.max(0, ...__lt.filter(x => x[0] >= __t0).map(x => x[1]))) })`);
  log('open', JSON.stringify(o));
  const r = await ev(`(async () => { const root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('real-out.json', { create: true }); fileProgetto = h; nomeProgetto = h.name;
    const t0 = performance.now(); await salvaProgetto(false); const ms = Math.round(performance.now() - t0); const f = await h.getFile(); const text = await f.text();
    const o = JSON.parse(text);
    return { ms, size: f.size, sha: await sha(f), toast: document.getElementById('toast').textContent, snap: await sha(new Blob([JSON.stringify(canon(JSON.parse(snapState())))])),
      imgs: await Promise.all(SHOTS.map(async s => [s.name, s.path, s.blob.size, await sha(s.blob)])), outKeys: Object.keys(o), canonSha: await sha(new Blob([JSON.stringify(canon(o))])), text: text.length < 1e8 ? text : null }; })()`);
  const outObj = JSON.parse(r.text);
  origObj.v = outObj.v; /* the app version is written fresh on every save */
  const sameCanon = JSON.stringify(canonOf(outObj)) === JSON.stringify(canonOf(origObj));
  function canonOf(x) { return Array.isArray(x) ? x.map(canonOf) : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonOf(x[k])])) : x; }
  const imgsOk = origObj.images.every((im, i) => crypto.createHash('sha256').update(Buffer.from(im.data, 'base64')).digest('hex') === r.imgs[i][3] && im.name === r.imgs[i][0] && (im.path || im.name) === r.imgs[i][1]);
  const out = { open: o, save: { ms: r.ms, size: r.size, toast: r.toast }, sha: r.sha, snapSha: r.snap, canonSha: r.canonSha, sameAsOriginalWhenKeysSorted: sameCanon, imagesIdenticalToOriginal: imgsOk,
    sameBytesAsOriginal: r.text === orig,
    note: 'sameAsOriginalWhenKeysSorted may be false in both apps: an open migrates old layouts (aggiornaMisure); compare the new app against the pristine run (sha)', keyOrderSame: JSON.stringify(Object.keys(origObj)) === JSON.stringify(r.outKeys) };
  /* reopen the saved file and compare once more */
  await ev(`(async () => { const h = await (await navigator.storage.getDirectory()).getFileHandle('real-out.json'); SHOTS = []; imgShot = null; toast(''); caricaPresetFile(await h.getFile(), h); return 1; })()`);
  await until(() => ev('/Project opened/.test(document.getElementById("toast").textContent)'), 'reopen', 120000); await delay(1000);
  const again = await ev(`(async () => ({ n: SHOTS.length, snap: await sha(new Blob([JSON.stringify(canon(JSON.parse(snapState())))])) }))()`);
  out.reopen = { n: again.n, snapEqual: again.snap === r.snap };
  fs.writeFileSync(path.join(__dirname, 't7real.' + (process.env.LABEL || 'new') + '.json'), JSON.stringify(out, null, 1));
  const errs = await ev('qaErrors');
  out.ok = imgsOk && out.reopen.snapEqual && errs.length === 0;
  return out;
};
