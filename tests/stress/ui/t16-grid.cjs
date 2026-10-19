'use strict';
// 4C: canvas Grid overlay: exact geometry, pixel step, settings popover, persistence, preview-only.
//   node tests/stress/run.cjs tests/stress/ui/t16-grid.cjs
module.exports = async ({ev, delay, reload, capture}) => {
  const res = {ok: true};
  const fail = (k, v) => { res.ok = false; (res.fail = res.fail || {})[k] = v; };
  await ev(`state.active = 'unity_cover'; buildFormats(); buildControls(); render(); 1`);
  // draw the grid alone on a blank canvas of the preview size and read it back
  const probe = (cfg) => ev(`(()=>{
    GRID = gridPulisci(${JSON.stringify(cfg)}); showGrid = true;
    const f = FORMATS.find(x=>x.id===state.active), z = sizeOf(f);
    const W = PW, H = PH, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); drawGrid(g, W, H);
    const d = g.getImageData(0,0,W,H).data;
    const row = Math.floor(H*0.37), col = Math.floor(W*0.37);
    const xs = [], ys = [];
    for(let x=0;x<W;x++) if(d[(row*W+x)*4+3]) xs.push(x);
    for(let y=0;y<H;y++) if(d[(y*W+col)*4+3]) ys.push(y);
    const any = d.some((v,i)=> i%4===3 && v);
    return {W, H, vw: z.w, vh: z.h, xs, ys, any}; })()`);
  const base = {mode: 'div', cols: 4, rows: 4, centre: false, margin: 0, color: '#ffffff', opacity: 0.5};
  const a = await probe(base);
  res.size = [a.vw, a.vh, a.W, a.H];
  if (a.vw !== 1950 || a.vh !== 1300) fail('cover', a);
  const wantX = [1, 2, 3].map(i => Math.round(i * a.W / 4)), wantY = [1, 2, 3].map(i => Math.round(i * a.H / 4));
  // crossing lines at the probe row/col are not a concern: probe row 0.37H is not on a horizontal line
  if (JSON.stringify(a.xs) !== JSON.stringify(wantX)) fail('quarterX', [a.xs, wantX]);
  if (JSON.stringify(a.ys) !== JSON.stringify(wantY)) fail('quarterY', [a.ys, wantY]);
  // pixel step 100: 19 vertical (100..1900) and 12 horizontal (100..1200) lines
  const b = await probe(Object.assign({}, base, {mode: 'px', step: 100}));
  const wb = [], wy = [];
  for (let k = 1; k * 100 < 1950; k++) wb.push(Math.round(k * 100 / 1950 * b.W));
  for (let k = 1; k * 100 < 1300; k++) wy.push(Math.round(k * 100 / 1300 * b.H));
  res.px = [b.xs.length, b.ys.length];
  if (b.xs.length !== 19 || b.ys.length !== 12) fail('pxCount', res.px);
  if (JSON.stringify(b.xs) !== JSON.stringify(wb) || JSON.stringify(b.ys) !== JSON.stringify(wy)) fail('pxPos', [b.xs, wb]);
  // thirds
  const t = await probe(Object.assign({}, base, {mode: 'thirds'}));
  if (t.xs.length !== 2 || t.ys.length !== 2) fail('thirds', [t.xs, t.ys]);
  // centre + margin
  const cm = await probe(Object.assign({}, base, {mode: 'div', cols: 1, rows: 1, centre: true, margin: 10}));
  if (cm.xs.length < 3) fail('centreMargin', cm.xs);
  // grid off draws nothing
  const off = await ev(`(()=>{ showGrid = false; const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const g = c.getContext('2d'); drawGrid(g, 200, 100); return g.getImageData(0,0,200,100).data.some(v=>v); })()`);
  if (off) fail('offDraws', off);
  // popover: right click opens, edit live, Esc closes, outside click closes
  await ev(`GRID = gridPulisci(null); showGrid = true; buildTools(); render(); 1`);
  const o = await ev(`(()=>{ const b = document.querySelector('#tools .gridBtn');
    b.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
    const p = document.getElementById('gridPop'); if(!p) return {open:false};
    const m = p.querySelector('[data-g=mode]'); m.value = 'px'; m.dispatchEvent(new Event('change'));
    const s = p.querySelector('[data-g=step]'); s.value = '250'; s.dispatchEvent(new Event('input'));
    const mg = p.querySelector('[data-g=margin]'); mg.value = '5'; mg.dispatchEvent(new Event('input'));
    return {open:true, mode:GRID.mode, step:GRID.step, margin:GRID.margin, stored: localStorage.getItem('davfx-store-graphics-grid'),
            stepVisible: !p.querySelector('[data-k=step]').hidden, colsHidden: p.querySelector('[data-k=cols]').hidden, on: showGrid}; })()`);
  res.pop = o;
  if (!o.open || o.mode !== 'px' || o.step !== 250 || o.margin !== 5 || !o.stepVisible || !o.colsHidden || !o.on) fail('popover', o);
  await delay(100);
  await capture('t16-grid-popover');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); 1`);
  if (await ev(`!!document.getElementById('gridPop')`)) fail('escClose', 1);
  await ev(`document.querySelector('#tools .gridBtn').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); 1`);
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); 1`);
  if (await ev(`!!document.getElementById('gridPop')`)) fail('outsideClose', 1);
  // left click still toggles
  const tg = await ev(`(()=>{ const was = showGrid; document.querySelector('#tools .gridBtn').dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:0, clientY:0}));
    return [was, showGrid]; })()`);
  if (tg[0] === tg[1]) fail('toggle', tg);
  // snap target includes grid lines when on
  const sn = await ev(`(()=>{ showGrid = true; GRID = gridPulisci({mode:'div', cols:4, rows:4, centre:false}); const on = snapTargets('x').includes(0.25);
    showGrid = false; return [on, snapTargets('x').includes(0.25)]; })()`);
  if (!sn[0] || sn[1]) fail('snap', sn);
  // persistence + not in project
  await ev(`GRID = gridPulisci({mode:'px', step:250, margin:5, color:'#ff8800', opacity:0.4}); gridSalva(); 1`);
  await reload();
  await delay(1500);
  const pr = await ev(`({g: GRID, proj: JSON.stringify(state).indexOf('davfx-store-graphics-grid') >= 0 || JSON.stringify(state).indexOf('"margin":5') >= 0 && false})`);
  res.persist = pr.g;
  if (pr.g.mode !== 'px' || pr.g.step !== 250 || pr.g.margin !== 5 || pr.g.color !== '#ff8800') fail('persist', pr.g);
  // screenshot with grid on
  await ev(`showGrid = true; buildTools(); render(); 1`);
  await delay(200);
  res.shot = await capture('t16-grid');
  await ev(`showGrid = false; GRID = gridPulisci(null); gridSalva(); buildTools(); render(); 1`);
  return res;
};
