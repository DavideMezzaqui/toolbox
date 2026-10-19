'use strict';
// 1E: layout skeleton at three viewport sizes (Emulation.setDeviceMetricsOverride).
// Checks: no horizontal scroll, header <= 46px, every header / pack-card button visible,
// canvas fit unchanged (cv style width == misureVista().dispW), canvasHint only when empty.
// body.no-images is toggled here the way 1A does it. Screenshots are saved in ./shots next to this file (SHOT_PREFIX=before|after, default after).
//   node tests/stress/run.cjs tests/stress/ui/t8.cjs
const SIZES = [[1280, 720], [1920, 1080], [2560, 1440]];
const IDS = ['bNew', 'bLoad', 'bSave', 'bSaveAs', 'projInfo', 'bExp', 'bZip', 'bKeys', 'bLogo', 'bLogoDef', 'bFont', 'bAll'];
module.exports = async ({ev, command, delay, capture}) => {
  const prefix = process.env.SHOT_PREFIX || 'after';
  const res = {ok: true, sizes: {}};
  const probe = `(()=>{
    const q = id => document.getElementById(id), vis = id => { const e = q(id); if(!e) return 'missing';
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if(!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return 'hidden';
      if(r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) return 'offscreen';
      return 'ok'; };
    const f = FORMATS.find(x => x.id === state.active), m = misureVista(f, false);
    const hd = document.querySelector('header').getBoundingClientRect();
    const hint = q('canvasHint');
    return {iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth,
      header: Math.round(hd.height), cvStyleW: parseFloat(cv.style.width), dispW: m.dispW,
      vis: ${JSON.stringify(IDS)}.reduce((o, id) => (o[id] = vis(id), o), {}),
      hint: hint ? getComputedStyle(hint).display : null, noImages: document.body.classList.contains('no-images'),
      packcard: !!q('packcard'), formatsInLeft: !!document.querySelector('aside.left #formats')}; })()`;
  const mkImages = `(async()=>{
    const mk = async (n, h) => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1920, 1080);
      gr.addColorStop(0, 'hsl(' + h + ',60%,14%)'); gr.addColorStop(1, 'hsl(' + (h + 40) + ',70%,34%)');
      g.fillStyle = gr; g.fillRect(0, 0, 1920, 1080);
      for(let i = 0; i < 70; i++){ const x = (i * 337 + h * 11) % 1920, y = (i * 211 + h * 7) % 1080, r = 12 + (i * 29) % 110;
        const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'hsla(' + (h + i * 5) + ',90%,70%,.9)'); rg.addColorStop(1, 'hsla(' + (h + i * 5) + ',90%,60%,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(700, 300, 520, 480);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type: 'image/png', lastModified: h}); };
    const files = []; for(const [n, h] of [['impact_a', 20], ['impact_b', 150], ['impact_c', 260], ['impact_d', 330], ['impact_e', 60], ['impact_f', 200]]) files.push(await mk(n, h));
    await new Promise(r => addShots(files, r)); return SHOTS.length; })()`;
  for (const [w, h] of SIZES) {
    await command('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await delay(700);
    // empty state
    await ev(`SHOTS = []; imgShot = null; buildControls(); render(); document.body.classList.toggle('no-images', !SHOTS.length); 1`);
    await delay(300);
    const empty = await ev(probe);
    await capture(`${prefix}-${w}x${h}-empty`);
    // with images
    if (w === SIZES[0][0]) await ev(`state.pack.title = 'Realistic Impacts'; state.pack.version = 'v1.2'; state.pack.category = 'VFX'; 1`);
    await ev(mkImages); await delay(1200);
    await ev(`buildControls(); buildFormats(); render(); document.body.classList.toggle('no-images', !SHOTS.length); 1`); await delay(600);
    const full = await ev(probe);
    await capture(`${prefix}-${w}x${h}`);
    const bad = Object.entries(full.vis).filter(([, v]) => v !== 'ok');
    const r = {empty: {header: empty.header, hint: empty.hint, noImages: empty.noImages}, full, bad};
    r.pass = full.sw <= full.iw && full.bw <= full.iw && full.header <= 46 && !bad.length && Math.abs(full.cvStyleW - full.dispW) < 1.5 &&
      full.packcard && full.formatsInLeft && empty.noImages && empty.hint !== 'none' && full.hint === 'none';
    res.sizes[w + 'x' + h] = r;
    if (process.env.SHOT_PREFIX !== 'before' && !r.pass) res.ok = false;
  }
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  return res;
};
