'use strict';
// The REAL export path (renderFormatToBlob -> PNG blob), hashed pixel by pixel
// and compared with export-hash.json. render-hash.cjs hashes renderTo on a
// fresh canvas; this one hashes what a file on disk would contain, with large
// fine-textured images (3840x2160 noise + lines) so that every downscale step
// of imgRidotta matters. Two phases: (1) every export on emptied caches,
// (2) warm caches, after heavy preview activity (renders of every format,
// sharp view, zoom, preview size, thumbs, card clicks) - the caches filled by
// the preview must not change one pixel of an export. Both phases must equal
// the baseline.
//   node tests/stress/run.cjs tests/stress/export-hash.cjs
//   UPDATE_HASH=1 ... rewrites the baseline (only after a deliberate change,
//   and only from the pristine app)
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, 'export-hash.json');

module.exports = async ({ev, delay, log}) => {
  // ---- helpers installed in the page
  await ev(`(()=>{
    window.__eh = {};
    const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    // image with a smooth base, fine per-pixel noise, diagonal hairlines and a few shapes
    __eh.mk = async (n, w, h, seed) => {
      const rnd = mulberry(seed), c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, nz = (rnd() - 0.5) * 36;
        const line = ((x + y) % 7 === 0 || (x - 2 * y + 4000) % 11 === 0) ? 60 : 0;
        d[o]     = Math.max(0, Math.min(255, 40 + 150 * x / w + nz + line + seed * 3));
        d[o + 1] = Math.max(0, Math.min(255, 70 + 120 * y / h + nz * 0.8 + line));
        d[o + 2] = Math.max(0, Math.min(255, 110 + 60 * Math.sin(x / 97) + nz * 1.2 + line));
        d[o + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      g.fillStyle = '#f4f4f4'; g.fillRect(w * 0.1, h * 0.12, w * 0.3, h * 0.35);
      g.strokeStyle = '#101010'; g.lineWidth = 1; for (let i = 0; i < 90; i++) { g.beginPath(); g.moveTo(w * 0.5 + i * 3, h * 0.1); g.lineTo(w * 0.5 + i * 3 + 40, h * 0.9); g.stroke(); }
      g.fillStyle = '#e03a2f'; g.beginPath(); g.arc(w * 0.72, h * 0.62, h * 0.2, 0, 7); g.fill();
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type: 'image/png', lastModified: 1000 + seed}); };
    __eh.hash = async blob => {
      const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); bmp.close && bmp.close();
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const b = new Uint8Array(await crypto.subtle.digest('SHA-256', d));
      return c.width + 'x' + c.height + ':' + [...b.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    __eh.layout = (fm, kind, res) => {
      const L = JSON.parse(JSON.stringify(defLayout(fm)));
      if (res && fm.sizes) L.res = res;
      if (kind === 'm' || kind === 'b') {
        L.shot.panels = 3;
        for (let i = 0; i < 3; i++) { L.shot.rot[i] = 7; L.shot.sc[i] = 1.3; }
        L.shot.src = [-1, 1, 2, 3, 4, 5];
      }
      if (kind === 'b') { L.fx.blur = 0.01; L.fx.zoomBlur = 0.3; L.fx.edgeBlur = 0.4; L.fx.vignette = 0.5; }
      return L; };
    // one export: layout swapped in for the duration of the real export call
    __eh.one = async (fm, kind, res) => {
      const keep = state.layouts[fm.id], keepT = [state.pack.title, state.pack.version];
      state.layouts[fm.id] = __eh.layout(fm, kind, res);
      if (kind === 'b') { state.pack.title = 'A Very Long Pack Title For Testing Fit'; state.pack.version = 'v9.9'; }
      try { const blob = await new Promise(r => renderFormatToBlob(fm, r)); return await __eh.hash(blob); }
      finally { state.layouts[fm.id] = keep; state.pack.title = keepT[0]; state.pack.version = keepT[1]; } };
    // list of jobs: [key, formatId, kind, res, exportScale]
    __eh.jobs = () => {
      const j = [];
      for (const kind of ['d', 'm', 'b']) for (const fm of FORMATS) {
        if (fm.sizes) for (const s of fm.sizes) j.push([kind + ':' + fm.id + ':' + s[2], fm.id, kind, s[2], 1]);
        else j.push([kind + ':' + fm.id, fm.id, kind, null, 1]);
      }
      for (const fm of FORMATS) j.push(['s50:' + fm.id, fm.id, 'd', null, 0.5]);
      return j; };
    // cold = every cache that can influence a drawing is emptied before the export,
    // so the value belongs to that export alone and not to what ran before it
    __eh.cold = () => {
      const imgs = SHOTS.map(s => s.img).concat([imgLogo, imgLogoDefault].filter(Boolean));
      if (typeof svuotaRidotte === 'function') svuotaRidotte();
      else imgs.forEach(i => _ridCache.delete(i));
      imgs.forEach(i => _sfocCache.delete(i));
      svuotaMemoriaSchermate(); };
    __eh.run = async (from, to, cold) => {
      const out = {}, keepS = state.export.scale;
      try { for (const [key, id, kind, res, sc] of __eh.jobs().slice(from, to)) {
        state.export.scale = sc;
        if (cold) __eh.cold();
        out[key] = await __eh.one(FORMATS.find(f => f.id === id), kind, res); } }
      finally { state.export.scale = keepS; }
      return out; };
    return 1; })()`);

  // ---- images: three 3840x2160 and one 1920x1080
  const nImg = await ev(`(async()=>{
    SHOTS = []; imgShot = null;
    const files = [await __eh.mk('n1', 3840, 2160, 1), await __eh.mk('n2', 3840, 2160, 2), await __eh.mk('n3', 3840, 2160, 3), await __eh.mk('n4', 1920, 1080, 4)];
    await new Promise(r => addShots(files, r));
    await Promise.all(SHOTS.map(s => s.img.decode ? s.img.decode().catch(() => {}) : null));
    return SHOTS.length; })()`);
  if (nImg !== 4) return {ok: false, why: 'images loaded: ' + nImg};
  const total = await ev('__eh.jobs().length');

  const pass = async cold => {
    const out = {};
    for (let a = 0; a < total; a += 8) Object.assign(out, await ev(`__eh.run(${a}, ${Math.min(total, a + 8)}, ${cold ? 'true' : 'false'})`));
    return out;
  };

  // ---- priming: the very first time an image is drawn at a size, Chromium
  // itself (not the app) draws it a little differently from the later times
  // (mip levels built after the first small draws: measured on the logo of
  // the Cover, ~2300 px). Every format is exported once and thrown away, so
  // that no value below depends on which format happened to be drawn first.
  await ev(`__eh.run(0, ${total}, false).then(() => 1)`);
  log('priming done');

  // ---- phase 1: every export on emptied caches (the value of that export alone)
  const p1 = await pass(true);
  log('phase 1 done', Object.keys(p1).length);

  // ---- heavy preview activity
  await ev(`(async()=>{
    const keepL = JSON.stringify(state.layouts), keepImg = SHOTS.findIndex(s => s.img === imgShot),
          keepAct = state.active, keepThumb = state.ui.thumb, keepSel = state.sel;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let round = 0; round < 2; round++) for (const fm of FORMATS) {
      state.active = fm.id; render(); await wait(30);
      vistaNitida = true; try { render(); } finally { vistaNitida = false; }
      const r = cvwrap.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.6); render(); await wait(20);
      vistaNitida = true; try { render(); } finally { vistaNitida = false; }
      viewFit();
    }
    thumbSize(1); drawThumbs(true); await wait(300); thumbSize(-1); thumbSize(-1); drawThumbs(true); await wait(300); thumbSize(1);
    state.active = FORMATS[0].id;
    for (let k = 0; k < 2; k++) for (const card of document.querySelectorAll('#imgs .card')) { card.click(); await wait(20); }
    for (const fm of FORMATS) { state.active = fm.id; render(); }
    // put the project back exactly as it was
    const old = JSON.parse(keepL);
    Object.keys(state.layouts).forEach(id => { state.layouts[id] = old[id]; });
    imgShot = keepImg >= 0 ? SHOTS[keepImg].img : imgShot;
    state.active = keepAct; state.ui.thumb = keepThumb; state.sel = keepSel;
    viewFit(); render();
    return 1; })()`);
  log('preview activity done');

  // ---- phase 2: warm caches, in order, after the activity
  const p2 = await pass(false);
  log('phase 2 done', Object.keys(p2).length);

  const diff12 = Object.keys({...p1, ...p2}).filter(k => p1[k] !== p2[k]);
  if (process.env.UPDATE_HASH === '1' || !fs.existsSync(file)) {
    /* the baseline is the cold value of each export. On the pristine app some
       warm values differ (imgRidotta keeps one entry per image keyed by the
       rounded size, so an export can inherit a copy made for another size):
       listed for the record, they are what package 1B removes */
    fs.writeFileSync(file, JSON.stringify(p1, null, 1) + '\n');
    return {ok: true, written: file, count: Object.keys(p1).length, warmDiffersFromCold: diff12.map(k => [k, p1[k], p2[k]]), got: p1};
  }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diff1 = Object.keys({...want, ...p1}).filter(k => want[k] !== p1[k]);
  const diff2 = Object.keys({...want, ...p2}).filter(k => want[k] !== p2[k]);
  return {ok: !diff12.length && !diff1.length && !diff2.length, count: Object.keys(p1).length, diffPhase1VsPhase2: diff12.map(k => [k, p1[k], p2[k]]), diffFreshVsBaseline: diff1, diffAfterActivityVsBaseline: diff2};
};
