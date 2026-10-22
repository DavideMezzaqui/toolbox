'use strict';
// Visual QA helper: every panel with all its sections open, cut into chunks of the panel box.
//   PANELS=1,2 W=1920 H=1080 node tests/stress/run-tab.cjs tests/stress/texgen/panels.cjs
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ev, command, delay}) => {
  const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
  await command('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
  await delay(1500);
  const outDir = path.join(__dirname, 'shots', 'p' + W);
  fs.mkdirSync(outDir, {recursive: true});
  const files = [];
  const rectOf = sel => ev(`(()=>{const el=${sel};if(!el)return null;let r=el.getBoundingClientRect();r={x:r.left,y:r.top,w:r.width,h:r.height};let w=window;while(w!==w.top){const f=w.frameElement.getBoundingClientRect();r.x+=f.left;r.y+=f.top;w=w.parent}return r})()`);
  const key = k => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}));1`);
  const which = (process.env.PANELS || '1,2,3,4,5,6').split(',');
  for (const p of which) {
    await key(p); await delay(500);
    // open every section (twice: nested ones appear after the first pass)
    for (let pass = 0; pass < 3; pass++) {
      await ev(`document.querySelectorAll('#texgen-panelbox [aria-expanded="false"]').forEach(h=>h.click());1`); await delay(300);
    }
    const scroller = `(()=>{const b=document.getElementById('texgen-panelbox');return [...b.querySelectorAll('div')].find(d=>getComputedStyle(d).overflowY==='auto'&&d.scrollHeight>d.clientHeight+4)||[...b.querySelectorAll('div')].find(d=>getComputedStyle(d).overflowY==='auto')})()`;
    const info = await ev(`(()=>{const s=${scroller};return s?{sh:s.scrollHeight,ch:s.clientHeight}:null})()`);
    const box = await rectOf(`document.getElementById('texgen-panelbox')`);
    if (!info || !box) { files.push('panel ' + p + ': no scroller'); continue; }
    let n = 0;
    for (let y = 0; y < info.sh && n < 8; y += info.ch - 40) {
      await ev(`(()=>{const s=${scroller};s.scrollTop=${y}})();1`); await delay(200);
      const r = await command('Page.captureScreenshot', {format: 'png', clip: {x: box.x, y: box.y, width: box.w, height: box.h, scale: 1}});
      const f = path.join(outDir, `panel${p}-${n}.png`);
      fs.writeFileSync(f, Buffer.from(r.data, 'base64')); files.push(f); n++;
    }
    await ev(`(()=>{const s=${scroller};s&&(s.scrollTop=0)})();1`);
  }
  return {ok: true, files};
};
