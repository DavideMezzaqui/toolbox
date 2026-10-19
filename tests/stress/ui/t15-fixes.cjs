'use strict';
// 4B: hitTest follows the draw order; format checkbox undoable; undo keeps state.ui; logoMapped cache keyed by
// logo; trimAlpha canvases get __uid; layer ids after load; wheel at the limit pushes no undo; side panels and
// image strip resizable by dragging (persisted in localStorage, never in the project).
//   node tests/stress/run.cjs tests/stress/ui/t15-fixes.cjs
module.exports = async ({ev, delay, capture, reload}) => {
  const out = {ok: true, checks: {}};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const undoN = () => ev('undoStack.length');
  await ev(`localStorage.removeItem('davfx-store-graphics-panels'); 1`);

  /* --- 1. hitTest: a back layer sits above the band in draw order only if it is drawn later (25 > 20),
         so on the band it must win over the band; a front layer wins too; the part under both loses */
  const h1 = await ev(`(()=>{
    state.active = FORMATS[0].id; buildFormats(); buildControls();
    const L = state.layouts[state.active]; L.layers = [];
    render();
    const B = BOXES.band; if(!B) return {noband:true};
    const l = layerDefaults('shape', 'T'); l.front = false; l.on = true;
    /* un punto della fascia dove nessuna parte disegnata dopo (accento, logo, testo) arriva */
    const sopra = (x, y) => DRAW_PARTS.some(p => p.select && p.key !== 'shot' && p.key !== 'band' && p.order > 25 && BOXES[p.key]
      && x >= BOXES[p.key].x - 6 && x <= BOXES[p.key].x + BOXES[p.key].w + 6 && y >= BOXES[p.key].y - 6 && y <= BOXES[p.key].y + BOXES[p.key].h + 6);
    let pt = null;
    for(let fy = 0.2; fy < 0.9 && !pt; fy += 0.1) for(let fx = 0.05; fx < 0.95 && !pt; fx += 0.05){
      const x = B.x + B.w*fx, y = B.y + B.h*fy; if(!sopra(x, y) && !sopra(x + 20, y + 12)) pt = [x, y];
    }
    if(!pt) return {nopoint: true};
    l.x = pt[0]/PW; l.y = pt[1]/PH; l.w = 0.01; l.h = 0.006;
    layersOf(L).push(l); render();
    const LB = BOXES['lay:'+l.id]; if(!LB) return {nolayer:true, B};
    const px = LB.x + LB.w/2, py = LB.y + LB.h/2;
    const inB = px>=B.x && px<=B.x+B.w && py>=B.y && py<=B.y+B.h;
    const back = hitTest(px, py);
    l.front = true; render();
    const front = hitTest(BOXES['lay:'+l.id].x + 1, BOXES['lay:'+l.id].y + 1);
    return {inB, back, front, id: 'lay:'+l.id};
  })()`);
  chk('back layer over the band is hit', h1.inB && h1.back === h1.id, h1);
  chk('front layer is hit', h1.front === h1.id, h1);
  await ev(`state.layouts[state.active].layers = []; render(); 1`);

  /* --- 2. include-format checkbox: one undo step */
  const c2 = await ev(`(()=>{
    const n0 = undoStack.length, id = FORMATS[1].id, was = state.layouts[id].on;
    const cb = document.querySelectorAll('#formats .fmt input[type=checkbox]')[1];
    cb.click();
    const n1 = undoStack.length, now = state.layouts[id].on;
    undo();
    return {n0, n1, was, now, back: state.layouts[id].on, cb: document.querySelectorAll('#formats .fmt input[type=checkbox]')[1].checked};
  })()`);
  chk('checkbox pushes one undo step', c2.n1 === c2.n0 + 1 && c2.now === !c2.was, c2);
  chk('undo restores include flag and checkbox', c2.back === c2.was && c2.cb === c2.was, c2);

  /* --- 3. undo does not touch state.ui; snapshots for autosave still carry it */
  const u3 = await ev(`(()=>{
    state.ui.thumb = 110; pushUndo(); state.ui.thumb = 44; state.pack.title = 'xx'; undo();
    return {thumb: state.ui.thumb, title: state.pack.title, undoHasUi: 'ui' in JSON.parse(undoStack.length ? undoStack[undoStack.length-1] : '{}'),
            autosave: JSON.parse(snapState()).ui && JSON.parse(snapState()).ui.thumb, noUi: !('ui' in JSON.parse(snapState(true)))};
  })()`);
  chk('undo keeps ui.thumb', u3.thumb === 44 && u3.title !== 'xx', u3);
  chk('autosave snapshot keeps ui', u3.autosave === 44 && u3.noUi, u3);
  await ev(`state.ui.thumb = 72; 1`);

  /* --- 4. logoMapped keyed by the logo; trimAlpha gives __uid */
  const l4 = await ev(`(()=>{
    const mk = col => { const c = document.createElement('canvas'); c.width = 40; c.height = 40;
      const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0,0,40,40); return segnaImmagine(c); };
    const A = mk('#000000'), B = mk('#ffffff');
    const l = Object.assign({}, state.layouts[state.active].logo, {mapMode:'dark', darkColor:'#ff0000', lightColor:'#00ff00', mapCut:0.5});
    imgLogo = A; const a1 = logoMapped(20, 20, l), a2 = logoMapped(20, 20, l);
    imgLogo = B; const b1 = logoMapped(20, 20, l);
    imgLogo = A; const a3 = logoMapped(20, 20, l);
    const px = c => Array.from(c.getContext('2d').getImageData(5,5,1,1).data).join();
    const t = document.createElement('canvas'); t.width = 100; t.height = 100;
    const g = t.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(40,40,10,10);
    const tr = trimAlpha(t);
    return {same: a1 === a2, differs: a1 !== b1, back: a3 === a1, pa: px(a1), pb: px(b1), trimmed: tr.trimmed, uid: !!tr.img.__uid};
  })()`);
  chk('same logo reuses the cache', l4.same && l4.back, l4);
  chk('another logo of the same size is not reused', l4.differs && l4.pa !== l4.pb, l4);
  chk('trimAlpha canvas has __uid', l4.trimmed && l4.uid, l4);

  /* --- 5. layer ids after a load */
  const i5 = await ev(`(()=>{ fixLayer({id:'ly500-123', type:'shape'}); const n = newLayerId(); return n; })()`);
  chk('new layer id is above loaded ones', /^ly50[1-9]-/.test(i5) || Number(i5.slice(2).split('-')[0]) > 500, i5);

  /* --- 7. wheel at the limit pushes no undo step */
  const w7 = await ev(`(async()=>{
    clearTimeout(wheelTimer); wheelTimer = null;
    state.sel = 'logo'; const el = elOf('logo'), sk = sizeKeyOf('logo');
    el[sk] = sizeMaxOf('logo'); render();
    const st = document.getElementById('stage');
    const fire = d => st.dispatchEvent(new WheelEvent('wheel', {deltaY: d, altKey: true, bubbles: true, cancelable: true}));
    const n0 = undoStack.length; fire(-100); const n1 = undoStack.length;
    fire(100); const n2 = undoStack.length;
    clearTimeout(wheelTimer); wheelTimer = null;
    return {n0, n1, n2};
  })()`);
  chk('wheel at the limit: no undo step', w7.n1 === w7.n0, w7);
  chk('wheel that changes the value: one step', w7.n2 === w7.n0 + 1, w7);
  await ev(`undo(); 1`);

  /* --- 8. side panels resizable */
  const drag = (id, x0, x1) => ev(`(()=>{
    const h = document.getElementById('${id}'); const mk = (t, x) => new PointerEvent(t, {clientX: x, clientY: 300, pointerId: 7, button: 0, bubbles: true, cancelable: true});
    h.dispatchEvent(mk('pointerdown', ${x0})); h.dispatchEvent(mk('pointermove', ${x1})); h.dispatchEvent(mk('pointerup', ${x1})); 1;
  })()`);
  const wd = side => ev(`Math.round(document.querySelector('aside.${side}').getBoundingClientRect().width)`);
  await ev(`window.__av = 0; const o = aggiornaVista; window.aggiornaVista = function(){ __av++; return o.apply(this, arguments); }; 1`);
  const l0 = await wd('left'), r0 = await wd('right');
  await drag('rzL', 300, 380);
  const l1 = await wd('left');
  chk('left handle widens the column', l1 === l0 + 80, [l0, l1]);
  await drag('rzR', 1000, 940);
  const r1 = await wd('right');
  chk('right handle widens the column (drag left)', r1 === r0 + 60, [r0, r1]);
  await drag('rzL', 300, 5000);
  chk('left max 520', (await wd('left')) === 520);
  await drag('rzL', 300, -5000);
  chk('left min 200', (await wd('left')) === 200);
  chk('canvas refit called', (await ev('__av')) > 0);
  chk('stage never below 400', (await ev(`document.getElementById('stage').getBoundingClientRect().width`)) >= 400);
  await drag('rzL', 300, 360);
  const lsaved = await ev(`JSON.parse(localStorage.getItem('davfx-store-graphics-panels'))`);
  chk('widths saved in localStorage', lsaved && lsaved.l === 260 && typeof lsaved.r === 'number', lsaved);
  chk('not in the project/undo snapshot', !/davfx-store-graphics-panels|"lw"/.test(await ev('snapState()')));
  await reload();
  chk('widths applied after reload', (await wd('left')) === 260 && (await wd('right')) === lsaved.r, [await wd('left'), await wd('right')]);
  await ev(`document.getElementById('rzL').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); 1`);
  await delay(50);
  const lback = await wd('left');
  chk('double-click resets left', lback !== 260 && !(await ev(`JSON.parse(localStorage.getItem('davfx-store-graphics-panels')).l`)), lback);
  await ev(`document.getElementById('rzR').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); 1`);

  /* --- 9. image strip height */
  const s9 = await ev(`(async()=>{
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + (i*37) + ',60%,50%)'; g.fillRect(0,0,64,36); return segnaImmagine(c); };
    SHOTS = []; for(let i=0;i<24;i++) SHOTS.push({img: mk(i), name: 'i'+i+'.png', thumb: null});
    imgShot = SHOTS[0].img; buildControls(); render();
    await new Promise(r => setTimeout(r, 300));
    const lib = document.querySelector('#imgs .lib'), h = document.querySelector('#imgs .rzh');
    if(!lib || !h) return {nolib: !lib, noh: !h};
    const el0 = document.getElementById('imgs');
    const h0 = Math.round(lib.getBoundingClientRect().height);
    const mkE = (t, y) => new PointerEvent(t, {clientX: 100, clientY: y, pointerId: 9, button: 0, bubbles: true, cancelable: true});
    h.dispatchEvent(mkE('pointerdown', 300)); h.dispatchEvent(mkE('pointermove', 340)); h.dispatchEvent(mkE('pointerup', 340));
    await new Promise(r => setTimeout(r, 100));
    const h1 = Math.round(lib.getBoundingClientRect().height);
    h.dispatchEvent(mkE('pointerdown', 300)); h.dispatchEvent(mkE('pointermove', 5000)); h.dispatchEvent(mkE('pointerup', 5000));
    const hmax = Math.round(lib.getBoundingClientRect().height), box = document.getElementById('controls').clientHeight;
    h.dispatchEvent(mkE('pointerdown', 300)); h.dispatchEvent(mkE('pointermove', -5000)); h.dispatchEvent(mkE('pointerup', -5000));
    const hmin = Math.round(lib.getBoundingClientRect().height);
    h.dispatchEvent(mkE('pointerdown', 300)); h.dispatchEvent(mkE('pointermove', 340)); h.dispatchEvent(mkE('pointerup', 340));
    await new Promise(r => setTimeout(r, 100));
    const saved = JSON.parse(localStorage.getItem('davfx-store-graphics-panels')).lib;
    const ph = document.getElementById('controls').style.getPropertyValue('--phead-h');
    const phh = document.querySelector('#controls .phead').offsetHeight;
    stripImmagini();  /* reuse path */
    const same = document.getElementById('imgs') === el0 || !!document.querySelector('#imgs .rzh');
    return {h0, h1, hmax, box, hmin, saved, ph, phh, same};
  })()`);
  chk('strip handle exists', !s9.nolib && !s9.noh, s9);
  chk('strip height follows the drag', s9.h1 > s9.h0 - 1 && s9.h1 !== s9.h0 || s9.h1 === s9.h0 + 40, s9);
  chk('strip max is 60% of the panel', s9.hmax <= Math.round(s9.box * 0.6) + 1, s9);
  chk('strip min is about one row', s9.hmin >= 40 && s9.hmin <= 60, s9);
  chk('strip height saved', typeof s9.saved === 'number', s9);
  chk('--phead-h tracks the header', parseInt(s9.ph) === s9.phh, [s9.ph, s9.phh]);
  chk('strip reuse keeps the handle', s9.same, s9);
  await ev(`(()=>{ const h = document.querySelector('#imgs .rzh'); h.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); SHOTS = []; imgShot = null; buildControls(); render(); 1; })()`);
  chk('dblclick resets strip height', !(await ev(`document.body.classList.contains('lib-custom')`)));
  await ev(`localStorage.removeItem('davfx-store-graphics-panels'); 1`);

  /* --- 10. export folder picker: one in-flight promise */
  const e10 = await ev(`(async()=>{
    window.__pk = 0; window.__tt = [];
    const t0 = toast; window.toast = function(m, o){ __tt.push(String(m)); return t0.apply(this, arguments); };
    const fake = {name: 'fakeout', kind: 'directory', queryPermission: async()=>'granted', requestPermission: async()=>'granted',
      entries: async function*(){}, getFileHandle: async()=>({createWritable: async()=>({write: async()=>{}, close: async()=>{}, abort: async()=>{}})}),
      removeEntry: async()=>{}, getDirectoryHandle: async()=>fake};
    window.showDirectoryPicker = () => { __pk++; if(__pk > 1 && window.__open) return Promise.reject(new DOMException('File picker already active.', 'NotAllowedError')); window.__open = true; return new Promise(r => setTimeout(()=>{ window.__open = false; r(fake); }, 200)); };
    cartellaExport = null;
    const b = document.getElementById('bExp');
    await Promise.all([b.onclick(), b.onclick()]);
    const afterTwo = __pk, errTwo = __tt.filter(x => /Export failed/.test(x));
    __pk = 0; __tt = [];
    await b.onclick();
    const withFolder = __pk, errOne = __tt.filter(x => /Export failed/.test(x));
    /* cancelled picker: silent */
    cartellaExport = null; __pk = 0; __tt = [];
    window.showDirectoryPicker = () => { __pk++; return Promise.reject(new DOMException('cancel', 'AbortError')); };
    await Promise.all([b.onclick(), b.onclick()]);
    const cancelled = {pk: __pk, err: __tt.filter(x => /Export failed/.test(x))};
    window.toast = t0; delete window.showDirectoryPicker; cartellaExport = null;
    return {afterTwo, errTwo, withFolder, errOne, cancelled};
  })()`);
  chk('two concurrent Export current, no folder: one picker, no error', e10.afterTwo === 1 && e10.errTwo.length === 0, e10);
  chk('folder already set: zero picker calls', e10.withFolder === 0 && e10.errOne.length === 0, e10);
  chk('cancelled picker is silent and shared', e10.cancelled.pk === 1 && e10.cancelled.err.length === 0, e10);

  /* --- 11. Export to Desktop */
  const fsx = require('node:fs'), pth = require('node:path');
  const desk = pth.join(process.env.USERPROFILE || require('node:os').homedir(), 'Desktop');
  const antes = new Set(fsx.readdirSync(desk));
  const has = await ev('typeof desktop !== "undefined" && typeof desktop.saveToDesktop === "function"');
  chk('bridge present in the harness', has);
  if (has) {
    chk('button visible with the bridge', await ev(`(()=>{ mostraBottoneDesktop(); return !document.getElementById('bDesk').hidden; })()`));
    const r11 = await ev(`(async()=>{ window.__tt = []; const t0 = toast; window.toast = function(m, o){ __tt.push(String(m)); return t0.apply(this, arguments); };
      document.getElementById('bDesk').click();
      for(let i=0;i<100 && !__tt.some(x=>/Saved|failed/.test(x));i++) await new Promise(r=>setTimeout(r,100));
      window.toast = t0; return __tt; })()`);
    const nuovi = fsx.readdirSync(desk).filter(f => !antes.has(f));
    chk('toast says Saved ... to the Desktop', r11.some(x => /^Saved .+ to the Desktop/.test(x)), r11);
    chk('exactly one new file on the Desktop, a real image', nuovi.length === 1 && fsx.statSync(pth.join(desk, nuovi[0])).size > 1000 && /_\d+\.(png|jpg|jpeg|webp)$/i.test(nuovi[0]), nuovi);
    nuovi.forEach(f => { if (nuovi.length === 1) fsx.unlinkSync(pth.join(desk, f)); });
    const bad = await ev(`window.desktop.saveToDesktop('../evil.png', new Uint8Array([1,2,3]))`);
    chk('bad name rejected', bad && bad.error, bad);
    chk('nothing else created', fsx.readdirSync(desk).filter(f => !antes.has(f)).length === 0);
  }
  await ev(`document.getElementById('bDesk') && 1`);

  await capture('t15-fixes');
  const errs = await ev('qaErrors');
  chk('no page errors', errs.length === 0, errs);
  return out;
};
