'use strict';
// Sweep: many UI states (filters, tracks, sprite sheet, menus, overlays, node menus) -> small / low contrast / clipped text.
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ev, command, delay, capture}) => {
  const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
  await command('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
  await delay(1500);
  const SCAN = fs.readFileSync(path.join(__dirname, 'scan.js'), 'utf8');
  await ev(SCAN + ';1');
  const out = {}, shots = [];
  const key = k => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}));1`);
  const openAll = async () => { for (let p = 0; p < 3; p++) { await ev(`document.querySelectorAll('#texgen-panelbox [aria-expanded="false"]').forEach(h=>h.click());1`); await delay(100); } };
  const clickText = (re, all) => ev(`(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>${re}.test(b.textContent.trim()));(${all ? 'bs' : 'bs.slice(0,1)'}).forEach(b=>b.click());return bs.length})()`);
  const scan = async name => { const r = await ev(`window.__scan()`); const bad = r.small.length + r.low.length + r.clipped.length; out[name] = bad ? r : 'ok'; };
  const snap = async n => { shots.push(await capture(n)); };

  // 1. filters panel: add every filter once
  await key('3'); await delay(300);
  const nf = await ev(`(()=>{const names=['Edge','Normal','Curve','Emboss','Gaussian','Box','Direction','Radial','Zoom','Spin','Slope','Sharpen','Threshold','Posterize','Histo Eq','Grayscale','Invert','Bevel','Hue/Sat','Bright/Con','Tint','Chromatic','FXAA','Tileable','Polar','Pixelize','Quantize'];let n=0;for(const nm of names){const b=[...document.querySelectorAll('#texgen-panelbox button')].find(b=>b.textContent.trim()===nm);if(b){b.click();n++}}return n})()`);
  await delay(600); await openAll(); await scan('filters (' + nf + ' added)'); await snap('st-filters');
  // 2. anim: add tracks
  await key('4'); await delay(300);
  await clickText('/Add Track/'); await clickText('/Add Track/'); await delay(400); await openAll(); await scan('anim tracks'); await snap('st-anim');
  // 3. sprite sheet mode
  await key('6'); await delay(300);
  await ev(`(()=>{const t=[...document.querySelectorAll('#texgen-panelbox div')].find(d=>/Spritesheet Mode/i.test(d.textContent)&&d.children.length===2);t&&t.click()})();1`); await delay(500);
  await scan('sprite sheet'); await snap('st-sprite');
  await ev(`(()=>{const t=[...document.querySelectorAll('#texgen-panelbox div')].find(d=>/Spritesheet Mode/i.test(d.textContent)&&d.children.length===2);t&&t.click()})();1`);
  // 4. layers: groups, chain, compare, vary, 3x3, gizmo, alpha, A/B, recent edits
  await key('1'); await delay(300);
  for (const [name, re] of [['groups', '/Groups/'], ['chain', '/^Chain/']]) { await clickText(re); await delay(400); await openAll(); await scan(name); await snap('st-' + name); await clickText(re); await delay(200); }
  for (const [name, re] of [['compare', '/Compare/'], ['vary', '/Vary/'], ['3x3', '/3×3/'], ['tile', '/Tile/'], ['alpha', '/Alpha/'], ['gizmo', '/Gizmo/'], ['A/B', '/^A\\|B/']]) {
    await clickText(re); await delay(600); await scan(name); await snap('st-' + name.replace('/', '')); await clickText(re); await delay(250);
  }
  // 5. menus: layer menu (right click on strip thumb), canvas menu, view menu
  await ev(`(()=>{const t=[...document.querySelectorAll('div')].find(d=>d.draggable);t&&t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:60,clientY:300}))})();1`); await delay(500); await scan('layer menu'); await snap('st-layermenu');
  await key('Escape'); await ev(`document.body.click();1`);
  await ev(`(()=>{const c=document.querySelector('#root canvas');c&&c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:500}))})();1`); await delay(500); await scan('canvas menu'); await snap('st-canvasmenu');
  await key('Escape');
  // 6. node mode: context menu on a node, wire menu, presets, ANIM timeline
  await ev(`[...document.querySelectorAll('button')].find(b=>/NODES/i.test(b.textContent))?.click();1`); await delay(700);
  await ev(`(()=>{const e=[...document.querySelectorAll('div')].find(d=>/^Source/.test((d.textContent||'').trim())&&d.getBoundingClientRect().width>100&&d.getBoundingClientRect().width<200&&d.getBoundingClientRect().height>100);e&&e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:260,clientY:260}))})();1`); await delay(500); await scan('node menu'); await snap('st-nodemenu');
  await clickText('/^✦$/'); await delay(600); await scan('node presets'); await snap('st-nodepresets'); await clickText('/^✦$/');
  await clickText('/^⋯$/'); await delay(300); await clickText('/^ANIM$/'); await delay(600); await scan('node anim timeline'); await snap('st-nodeanim');
  return {ok: true, out};
};
