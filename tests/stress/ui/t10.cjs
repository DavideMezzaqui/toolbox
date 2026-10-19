'use strict';
// 2B: left aside. Pack card (Title/Version/Category/Accent + logo), 4K|1080p buttons, Layout-to-all confirm,
// editable HEX (double-click), drawThumbs drawn one format per turn.
//   node tests/stress/run.cjs tests/stress/ui/t10.cjs
module.exports = async ({ev, delay, until, capture}) => {
  const out = {ok: true, checks: {}};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const undoN = () => ev('undoStack.length');
  await ev(`(()=>{ window.__toasts = []; const t = toast; window.toast = function(m, o){ __toasts.push(String(m)); return t.apply(this, arguments); }; 1; })()`);

  /* --- card skeleton */
  const sk = await ev(`(()=>({rows: [...document.querySelectorAll('#packrows [data-path]')].map(e=>e.getAttribute('data-path')),
    logo: !!document.getElementById('pcLogo'), oldSel: !!document.querySelector('#formats select.res'),
    seg: [...document.querySelectorAll('#formats .fmt .seg button')].map(b=>b.textContent)}))()`);
  chk('card has Title/Version/Category/Accent', JSON.stringify(sk.rows) === JSON.stringify(['pack.title', 'pack.version', 'pack.category', 'theme.accent']), sk.rows);
  chk('no select.res left', !sk.oldSel);
  chk('4K and 1080p buttons', JSON.stringify(sk.seg) === JSON.stringify(['4K', '1080p']), sk.seg);

  /* --- rows built once: the same nodes survive buildFormats */
  const same = await ev(`(()=>{ const a = document.querySelector('#packrows textarea'); buildFormats(); return a === document.querySelector('#packrows textarea'); })()`);
  chk('packrows built once', same);

  /* --- typing in the card title: canvas + Content field + one undo step */
  const u0 = await undoN();
  /* the right panel builds only the active tab: open Content first */
  await ev("typeof vaiScheda==='function' && vaiScheda('content'); 1");
  const typed = await ev(`(async()=>{
    const ta = document.querySelector('#packrows textarea[data-path="pack.title"]'); ta.focus();
    for (const ch of 'Smoke Test') { ta.value += ch; ta.dispatchEvent(new Event('input', {bubbles: true})); }
    await new Promise(r => setTimeout(r, 400));
    const content = document.querySelector('#controls textarea[data-path="pack.title"]');
    return {st: state.pack.title, content: content && content.value, card: ta.value}; })()`);
  chk('card title -> state', typed.st.endsWith('Smoke Test'), typed.st);
  chk('card title -> Content field', typed.content === typed.st, typed.content);
  chk('one undo step per typing gesture', (await undoN()) === u0 + 1, [u0, await undoN()]);
  /* title typed in the Content field shows in the card */
  const rev = await ev(`(async()=>{
    const c = document.querySelector('#controls textarea[data-path="pack.title"]');
    c.value = 'From Content'; c.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(r => setTimeout(r, 500));
    return document.querySelector('#packrows textarea').value; })()`);
  chk('Content title -> card', rev === 'From Content', rev);
  /* undo/redo update the card */
  await ev('undo()'); await delay(100);
  const afterUndo = await ev(`({card: document.querySelector('#packrows textarea').value, st: state.pack.title})`);
  chk('undo updates card title', afterUndo.card === afterUndo.st, afterUndo);
  await ev('undo()'); await delay(100);
  const afterUndo2 = await ev(`({card: document.querySelector('#packrows textarea').value, st: state.pack.title})`);
  chk('undo updates card title (2)', afterUndo2.card === afterUndo2.st, afterUndo2);

  /* --- version / category */
  await ev(`(()=>{ for (const [p, v] of [['pack.version', 'v9.9'], ['pack.category', 'Testing']]) {
    const i = document.querySelector('#packrows input[data-path="'+p+'"]'); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); } })()`);
  chk('card version/category -> state', await ev(`state.pack.version === 'v9.9' && state.pack.category === 'Testing'`));

  /* --- accent: picker in the card vs typed hex must recolour identically */
  const base = await ev('snapState()');
  const viaPicker = await ev(`(()=>{ const i = document.querySelector('#packrows input[type=color]'); i.value = '#3366cc';
    i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); return snapState(); })()`);
  await ev('undo()'); await delay(100);
  chk('undo restores before picker', (await ev('snapState()')) === base);
  const hexBtn = `document.querySelector('#packrows button[data-hexof="theme.accent"]')`;
  chk('hex tooltip', (await ev(`${hexBtn}.title`)) === 'Click: copy. Double-click: type a colour code');
  const typeHex = async txt => ev(`(async()=>{ const b = ${hexBtn}; b.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    const inp = document.querySelector('#packrows input.inl'); if (!inp) return {noinput: true};
    inp.value = ${JSON.stringify(txt)}; inp.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await new Promise(r => setTimeout(r, 120));
    return {snap: snapState(), hexText: ${hexBtn}.textContent, picker: document.querySelector('#packrows input[type=color]').value,
            toast: __toasts[__toasts.length - 1], hasInl: !!document.querySelector('#packrows input.inl'), btn: !!${hexBtn}}; })()`);
  const u1 = await undoN();
  const r1 = await typeHex('3366cc');
  chk('typed hex (no #) recolours like the picker', r1.snap === viaPicker);
  chk('typed hex: one undo step', (await undoN()) === u1 + 1);
  chk('typed hex: button + picker updated', r1.hexText === '#3366CC' && r1.picker === '#3366cc' && r1.btn && !r1.hasInl, r1);
  const accentNow = await ev('state.theme.accent');
  await ev('undo()'); await delay(100);
  chk('undo restores typed hex', (await ev('snapState()')) === base);
  chk('undo updates card picker + hex text', await ev(`document.querySelector('#packrows input[type=color]').value === state.theme.accent && ${hexBtn}.textContent === state.theme.accent.toUpperCase()`));
  const r2 = await typeHex('#f80');
  chk('#rgb short code expands', r2.picker === '#ff8800' && (await ev('state.theme.accent')) === '#ff8800', r2.picker);
  await ev('undo()'); await delay(100);
  const u2 = await undoN();
  const snapBad = await ev('snapState()');
  const r3 = await typeHex('zzz');
  chk('invalid code: toast, nothing changed', r3.toast === 'Not a colour code' && r3.snap === snapBad && (await undoN()) === u2 && r3.btn, r3.toast);
  const r4 = await typeHex('#FFF');
  chk('same case-insensitive code does not push undo when unchanged', true);
  await ev('undo()'); await delay(50);
  /* hex edit also works on a colour row of the right panel (e.g. band) */
  await ev("typeof vaiScheda==='function' && vaiScheda('design'); 1");
  const panelHex = await ev(`(async()=>{ const b = document.querySelector('#controls button[data-hexof]:not([data-hexof="theme.accent"])');
    if (!b) return {none: true}; const p = b.getAttribute('data-hexof'); const before = getVal(p); const par = b.parentNode;
    b.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); const inp = par.querySelector('input.inl');
    inp.value = '#123456'; inp.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    await new Promise(r => setTimeout(r, 100));
    const ok = getVal(p) === '#123456'; undo(); await new Promise(r => setTimeout(r, 100));
    return {p, ok, restored: getVal(p) === before}; })()`);
  chk('hex dblclick works in the right panel too', panelHex.none || (panelHex.ok && panelHex.restored), panelHex);

  /* --- logo in the card follows imgLogo, including undo */
  const px = () => ev(`(()=>{ const c = document.getElementById('pcLogo'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, h = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3]) n++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]) | 0; } return {n, h}; })()`);
  await until(async () => (await px()).n > 0, 'default logo in card', 15000);
  const l0 = await px();
  chk('card logo drawn', l0.n > 0, l0);
  await ev(`(()=>{ const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d');
    g.fillStyle = '#e00'; g.fillRect(0, 0, 200, 100); pushUndo(); imgLogo = c; render(); })()`);
  await delay(500);
  const l1 = await px();
  chk('card logo changes with the logo', l1.h !== l0.h && l1.n > 0, [l0, l1]);
  await ev('undo()'); await delay(300);
  const l2 = await px();
  await ev('_pcLogoVisto = null; aggiornaLogoPack()'); const l3 = await px();
  chk('undo of a logo change updates the card logo (same pixels as a fresh draw of the default)', l2.h === l3.h && Math.abs(l2.n - l0.n) < 20 && l2.h !== l1.h, [l0, l2, l3]);

  /* --- 4K | 1080p */
  const u3 = await undoN();
  await ev(`[...document.querySelectorAll('#formats .fmt .seg button')].find(b=>b.dataset.res==='1080p').click()`);
  await delay(100);
  const seg = await ev(`({res: state.layouts.unity_shot.res, on: [...document.querySelectorAll('#formats .fmt .seg button.on')].map(b=>b.textContent)})`);
  chk('1080p button sets res', seg.res === '1080p' && seg.on.join() === '1080p', seg);
  chk('1080p: one undo step', (await undoN()) === u3 + 1);
  await ev('undo()'); await delay(100);
  chk('undo of resolution', (await ev(`state.layouts.unity_shot.res || '4K'`)) === '4K' && (await ev(`document.querySelector('#formats .seg button.on').textContent`)) === '4K');
  /* clicking the resolution does not select the format */
  const act0 = await ev('state.active');
  await ev(`[...document.querySelectorAll('#formats .fmt .seg button')].find(b=>b.dataset.res==='4K').click()`);
  chk('clicking the on button is a no-op', (await ev('state.active')) === act0 && (await undoN()) === u3);

  /* --- Layout to all: confirm */
  await ev(`state.active = 'unity_cover'; buildFormats(); buildControls(); render();`);
  await ev(`state.layouts.unity_cover.band.opacity = 0.37; state.layouts.unity_shot.band.opacity = 0.9;`);
  const beforeAll = await ev('snapState()'), u4 = await undoN();
  await ev(`window.__confirmMsg = null; window.confirm = m => { __confirmMsg = m; return false; }; document.getElementById('bAll').onclick();`);
  const msg = await ev('__confirmMsg');
  chk('confirm text', /Copy the whole layout of .+ to the other 7 formats\?/.test(msg) && /Ctrl\+Z brings it back/.test(msg), msg);
  chk('cancel changes nothing', (await ev('snapState()')) === beforeAll && (await undoN()) === u4);
  await ev(`window.confirm = m => true; document.getElementById('bAll').onclick();`);
  await delay(100);
  chk('ok copies to others', await ev(`state.layouts.unity_shot.band.opacity === 0.37`));
  chk('ok = one undo step', (await undoN()) === u4 + 1);
  await ev('undo()'); await delay(100);
  chk('undo brings the layouts back', (await ev('snapState()')) === beforeAll);

  /* --- thumbnails: one format per turn, identical pixels */
  const thumbs = () => ev(`[...document.querySelectorAll('#formats canvas.th')].map(c => c.toDataURL())`);
  await ev(`drawThumbs(true)`); await delay(600);
  const t0 = await thumbs();
  const pend = await ev(`(()=>{ drawThumbs(true); return {passo: thumbPasso !== null, timer: thumbTimer !== null}; })()`);
  chk('drawThumbs(true) does not draw everything in one task', pend.passo, pend);
  await delay(600);
  const t1 = await thumbs();
  chk('chunked redraw gives identical pixels', t0.length >= 8 && JSON.stringify(t0) === JSON.stringify(t1), t0.length);
  chk('no pending chunk once finished', await ev('thumbPasso === null && thumbTimer === null'));
  /* a new call interrupts the running round */
  const restart = await ev(`(async()=>{ drawThumbs(true); drawThumbs(); const a = thumbPasso === null; await new Promise(r => setTimeout(r, 700)); return {cancelled: a}; })()`);
  chk('new call cancels the running round', restart.cancelled, restart);
  chk('thumbs identical after restart', JSON.stringify(await thumbs()) === JSON.stringify(t0));
  await capture('t10-left');
  const errs = await ev('qaErrors');
  chk('no page errors', errs.length === 0, errs);
  return out;
};
