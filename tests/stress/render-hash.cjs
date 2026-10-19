'use strict';
// Every format rendered from its default layout, plus a busy layout (three
// images, three panels, long title, version), hashed pixel by pixel and
// compared with render-hash.json. The default overlays are measured on
// Davide's Photoshop files: any change here must be on purpose.
//   node tests/stress/run.cjs tests/stress/render-hash.cjs
//   UPDATE_HASH=1 ... rewrites the baseline (only after a deliberate change)
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, 'render-hash.json');
module.exports = async ({ev}) => {
  const got = await ev(`(async()=>{
    const mk = async (n, h) => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + h + ',55%,45%)'; g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#fff'; g.fillRect(200, 150, 700, 500); g.fillStyle = '#222'; g.beginPath(); g.arc(1400, 600, 300, 0, 7); g.fill();
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type:'image/png', lastModified:h}); };
    const files = [await mk('a', 20), await mk('b', 140), await mk('c', 260)];
    SHOTS = []; imgShot = null;
    await new Promise(r => addShots(files, r));
    const hash = async c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const b = new Uint8Array(await crypto.subtle.digest('SHA-256', d)); return [...b.slice(0, 8)].map(x => x.toString(16).padStart(2, '0')).join(''); };
    const out = {};
    for (const busy of [false, true]) for (const fm of FORMATS) {
      const L = busy ? JSON.parse(JSON.stringify(defLayout(fm))) : defLayout(fm);
      const keep = [state.pack.title, state.pack.version];
      if (busy) { L.shot.panels = 3; state.pack.title = 'A Very Long Pack Title For Testing Fit'; state.pack.version = 'v9.9'; }
      const s = sizeOf(fm), c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
      renderTo(c.getContext('2d'), fm, L, false);
      state.pack.title = keep[0]; state.pack.version = keep[1];
      out[(busy ? 'busy:' : '') + fm.id] = await hash(c);
    }
    return out; })()`);
  if (process.env.UPDATE_HASH === '1' || !fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n');
    return {ok: true, written: file, got};
  }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diff = Object.keys({...want, ...got}).filter(k => want[k] !== got[k]);
  return {ok: diff.length === 0, diff};
};
