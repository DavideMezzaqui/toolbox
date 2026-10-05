'use strict';
// Store Graphics and the shell, inside the real app. Disposable images made
// in the page; the export folder is the page's private file system, never a
// real folder of Davide's.
const assert = require('node:assert/strict');

module.exports = async function storeCheck({ command, evaluate, until, contexts, checks, capture }) {
  /* ---------------------------------------------------------------- shell */
  assert.equal(await evaluate('document.querySelectorAll("#bar .dot").length'), 0, 'no colour dots left in the tab bar');
  await evaluate('document.getElementById("hide").click()');
  assert(await evaluate('document.body.classList.contains("nobar")'), 'the bar hides');
  await evaluate('document.getElementById("edge").dispatchEvent(new MouseEvent("mouseenter"))');
  assert(await evaluate('document.getElementById("bar").classList.contains("peek")'), 'the top edge brings it back');
  await evaluate('document.getElementById("hide").click()');
  assert(!(await evaluate('document.body.classList.contains("nobar")')), 'and it can be pinned again');
  checks.push('Shell: no colour dots; the tab bar hides, peeks from the top edge and pins back');

  /* ------------------------------------------------------- store graphics */
  await evaluate('show("store")');
  await until(() => evaluate('frames["store"]?.contentDocument?.readyState==="complete" && typeof frames["store"].contentWindow.stripImmagini==="function"'), 'Store Graphics ready');
  const tree = await command('Page.getFrameTree');
  const frame = tree.frameTree.childFrames.find(f => f.frame.url.includes('/store/')).frame.id;
  const ctx = contexts.find(c => c.auxData?.frameId === frame && c.auxData?.isDefault).id;
  const ev = x => evaluate(x, ctx);
  await ev(`window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));addEventListener("unhandledrejection",e=>qaErrors.push(String(e.reason)));1`);
  await until(() => ev('autoArmed === true'), 'Store Graphics started');
  await ev(`(async()=>{
    const mk = async (name, hue) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + hue + ',60%,40%)'; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#fff'; g.font = 'bold 200px Arial'; g.fillText(name, 500, 420);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name + '.png', {type:'image/png', lastModified:hue}); };
    SHOTS = []; imgShot = null;
    const files = [await mk('A', 10), await mk('B', 140), await mk('C', 220)];
    await new Promise(r => addShots(files, r));
    state.active = 'unity_cover'; const S = state.layouts.unity_cover.shot; S.panels = 3; buildControls(); render();
    return 1; })()`);
  assert.equal(await ev('document.querySelectorAll("#imgs .card").length'), 3, 'three images in the strip');
  assert.equal(await ev('typeof LOOKS + SECTIONS.map(s => s.t).join()').then(x => /Looks|^object/.test(x)), false, 'the Looks panel is gone');
  assert(await ev('getComputedStyle(document.getElementById("imgs")).position === "sticky"'), 'the strip stays at the top');
  /* the images are kept for next time, and still there after a click that
     only changes which panel shows what */
  const kept = await ev(`(async()=>{ const count = ()=> new Promise(r=>{ dbApri().then(d=>{ const q = d.transaction('shots').objectStore('shots').count(); q.onsuccess = ()=> r(q.result); }); });
    await new Promise(r=> setTimeout(r, 900)); const a = await count();
    usaImmagine(1, false); await new Promise(r=> setTimeout(r, 900)); const b = await count(); undo();
    return [a, b]; })()`);
  assert.deepEqual(kept, [3, 3], 'images stored for the next session');

  /* each panel moves alone */
  const moved = await ev(`(()=>{ const S = state.layouts.unity_cover.shot; S.active = 2; state.sel = 'shot';
    const el = elOf('shot'); el.x = 0.3; el.scale = 1.4; S.rot[2] = 5;
    return {px:S.px.slice(0,3), sc:S.sc.slice(0,3), rot:S.rot.slice(0,3)}; })()`);
  assert.deepEqual(moved.px, [0.5, 0.5, 0.3]); assert.deepEqual(moved.sc, [1, 1, 1.4]); assert.deepEqual(moved.rot, [0, 0, 5]);
  checks.push('Store Graphics: moving, scaling and rotating one panel leaves the others alone');
  await ev('activeTab = "image"; openSecs[SECTIONS.findIndex(x => x.t === "Screenshot")] = true; buildControls(); render(); 1');
  await new Promise(r => setTimeout(r, 400));
  await capture('store-images');

  /* reorder by drag keeps every panel on its image */
  const order = await ev(`(()=>{ const S = state.layouts.unity_cover.shot;
    const shown = () => [0,1,2].map(i => (SHOTS.find(x => x.img === shotByIndex(panelSrc(S, i))) || {name:'?'}).name);
    const before = shown(); spostaImmagine(2, 0);
    return {before, after: shown(), list: SHOTS.map(x => x.name)}; })()`);
  assert.deepEqual(order.list, ['C.png', 'A.png', 'B.png']);
  assert.deepEqual(order.after, order.before, 'panels keep their images after a reorder');
  checks.push('Store Graphics: image strip pinned on top, drag-and-drop reorder keeps the panels on their images');

  /* project file with images inside, opened again */
  const back = await ev(`(async()=>{ const text = await testoProgetto();
    SHOTS = []; imgShot = null; state.layouts.unity_cover = defLayout(FORMATS.find(f => f.id === 'unity_cover'));
    caricaPresetFile(new File([text], 'qa.json', {type:'application/json'}));
    await new Promise(r => setTimeout(r, 1500));
    const S = state.layouts.unity_cover.shot;
    return {n: SHOTS.length, names: SHOTS.map(x => x.name), rot2: S.rot[2], px2: S.px[2]}; })()`);
  assert.equal(back.n, 3); assert.deepEqual(back.names, ['C.png', 'A.png', 'B.png']); assert.equal(back.rot2, 5); assert.equal(back.px2, 0.3);
  checks.push('Store Graphics: a saved project carries its images and reopens with them, order and transforms intact');

  /* numbered exports never overwrite */
  const files = await ev(`(async()=>{ const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
    for (const n of ['Cover_1.png', 'Cover_4.png']) { const h = await root.getFileHandle(n, {create:true}); const w = await h.createWritable(); await w.write('x'); await w.close(); }
    cartellaExport = root;
    await document.getElementById('bExp').onclick(); await document.getElementById('bExp').onclick();
    const out = []; for await (const [n] of root.entries()) out.push(n); return out.sort(); })()`);
  assert.deepEqual(files, ['Cover_1.png', 'Cover_4.png', 'Cover_5.png', 'Cover_6.png']);
  checks.push('Store Graphics: exports get short names and the next free number, nothing overwritten');

  /* colour swap and the empty canvas */
  const sw = await ev(`(()=>{ const L = state.layouts.unity_cover; L.accent.gradLink = false;
    activeTab = 'design'; openSecs[SECTIONS.findIndex(x => x.t === 'Accent line')] = true; buildControls();
    const a = L.accent.color, b = L.accent.color2;
    document.querySelector('[data-hexof="accent.color2"]').parentNode.querySelector('.swapc').click();
    SHOTS = []; imgShot = null; render();
    const px = document.getElementById('cv').getContext('2d').getImageData(3, 3, 1, 1).data;
    return {ok: L.accent.color === b && L.accent.color2 === a, hex: document.querySelectorAll('.row button.hex').length, empty: [px[0], px[1], px[2]]}; })()`);
  assert(sw.ok, 'swap exchanges the two colours'); assert(sw.hex > 0, 'colour codes shown'); assert.deepEqual(sw.empty, [0, 0, 0], 'empty canvas is plain black');
  checks.push('Store Graphics: colour swap and HEX codes; the empty canvas has no dotted background');

  /* a layout saved before the overlay pass picks up the new measures, but
     keeps what was moved by hand */
  const mig = await ev(`(()=>{ const f = FORMATS.find(x => x.id === 'unity_cover'), d = defLayout(f);
    const old = JSON.parse(JSON.stringify(d)); delete old.misure;
    old.accent.thick = MISURE_PRIMA.unity_cover['accent.thick']; old.accent.x1 = 0.997; old.band.opacity = 0.8; old.row.x = 0.5;
    const m = mergeLayout(f, old);
    /* once migrated, an 80% band set back by hand must survive the next load */
    m.band.opacity = 0.8; const again = mergeLayout(f, JSON.parse(JSON.stringify(m)));
    return [m.accent.thick === d.accent.thick, m.accent.x1 === 1, m.row.x === 0.5, again.band.opacity === 0.8]; })()`);
  assert.deepEqual(mig, [true, true, true, true]);
  checks.push('Store Graphics: saved layouts take the new overlay measures, hand-made changes stay');
  assert.deepEqual(await ev('qaErrors'), []);
  await evaluate('show("scene-sync")');
};
