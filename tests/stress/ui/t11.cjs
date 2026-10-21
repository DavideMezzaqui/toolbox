'use strict';
// 2C: feedback. toast API (old calls, kind, action, duration), dialogo(), shortcuts popover,
// Ctrl+O, Undo buttons (remove image, remove all, delete layer, delete variant, reset accent),
// size check dialog, caricaPresetFile without the typeof guards.
//   node tests/stress/run.cjs tests/stress/ui/t11.cjs
module.exports = async ({ev, delay, capture}) => {
  const res = {ok: true};
  const fail = (k, v) => { res.ok = false; res[k] = v; };
  const key = (k, o) => ev(`window.dispatchEvent(new KeyboardEvent('keydown',Object.assign({key:${JSON.stringify(k)},bubbles:true,cancelable:true},${JSON.stringify(o || {})})))`);

  await ev(`(async()=>{
    const mk = async (n, h) => { const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + h + ',60%,30%)'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = 'hsl(' + (h + 90) + ',80%,60%)'; g.fillRect(100, 80, 300, 160);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type: 'image/png', lastModified: h}); };
    const files = []; for(const [n, h] of [['fb_a', 20], ['fb_b', 150], ['fb_c', 260]]) files.push(await mk(n, h));
    await new Promise(r => addShots(files, r)); return SHOTS.length; })()`);

  // ---- 1. toast API
  const t1 = await ev(`(async()=>{
    const t = document.getElementById('toast'), o = {};
    toast('Plain old call');
    o.old = {text: t.textContent, on: t.classList.contains('on'), err: t.classList.contains('toast-err'), btn: t.querySelectorAll('button').length};
    toast('Could not do the thing');
    o.auto = t.classList.contains('toast-err');
    toast('Export failed: x'); o.auto2 = t.classList.contains('toast-err');
    toast('Autosave failed'); o.auto3 = t.classList.contains('toast-err');
    toast('Nice'); o.cleared = !t.classList.contains('toast-err');
    toast('Careful', {kind:'warn'}); o.warn = t.classList.contains('toast-warn');
    let hit = 0;
    toast('With action', {action:{label:'Do it', fn:()=>hit++}});
    const b = t.querySelector('button'); o.label = b && b.textContent;
    b.click(); o.hit = hit; o.hiddenAfterClick = !t.classList.contains('on');
    toast('Again'); o.noOldButton = t.querySelectorAll('button').length === 0;
    // duration: long message outlasts 2.8 s, short one does not
    toast('x'.repeat(100)); const t0 = performance.now();
    await new Promise(r => setTimeout(r, 3600)); o.longStill = t.classList.contains('on');
    toast('short'); await new Promise(r => setTimeout(r, 3100)); o.shortGone = !t.classList.contains('on');
    toast('fixed', {ms:500}); await new Promise(r => setTimeout(r, 800)); o.msGone = !t.classList.contains('on');
    return o; })()`);
  res.toast = t1;
  if (t1.old.text !== 'Plain old call' || !t1.old.on || t1.old.err || t1.old.btn) fail('toastOld', t1.old);
  if (!t1.auto || !t1.auto2 || !t1.auto3 || !t1.cleared || !t1.warn) fail('toastKind', t1);
  if (t1.label !== 'Do it' || t1.hit !== 1 || !t1.hiddenAfterClick || !t1.noOldButton) fail('toastAction', t1);
  if (!t1.longStill || !t1.shortGone || !t1.msGone) fail('toastDuration', t1);

  // ---- 2. dialogo
  const d = await ev(`(async()=>{
    const o = {}, q = ()=> document.getElementById('dlg');
    const key = (k, tgt) => (tgt || window).dispatchEvent(new KeyboardEvent('keydown', {key:k, bubbles:true, cancelable:true}));
    let p = dialogo({title:'T', text:'Body text', buttons:[{id:'no', label:'Cancel'}, {id:'yes', label:'Go', primary:true, danger:true}]});
    o.open = {shown: !q().hidden, title: q().querySelector('h3').textContent, text: q().querySelector('.dlg-body').textContent,
              btns: [...q().querySelectorAll('.dlg-btns button')].map(b=>b.textContent + (b.classList.contains('primary')?'*':'') + (b.classList.contains('danger')?'!':'')),
              focus: document.activeElement.textContent};
    q().querySelectorAll('.dlg-btns button')[0].click(); o.byBtn = await p; o.closed = q().hidden;
    p = dialogo({title:'E', buttons:[{id:'a', label:'A'}, {id:'b', label:'B', primary:true}]}); key('Escape'); o.esc = await p;
    p = dialogo({title:'E', buttons:[{id:'a', label:'A'}, {id:'b', label:'B', primary:true}]}); key('Enter'); o.enter = await p;
    p = dialogo({title:'S', text:'x'}); q().querySelector('.dlg-scrim').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    q().querySelector('.dlg-scrim').click(); o.scrim = await p;
    // click inside the box does not close
    p = dialogo({title:'S', text:'x', buttons:[{id:'k', label:'K', primary:true}]});
    const bx = q().querySelector('.dlg'); bx.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); bx.click();
    o.insideStays = !q().hidden; q().querySelector('button').click(); o.defaultBtn = await p;
    // a second dialog closes the first with null
    const p1 = dialogo({title:'1'}); const p2 = dialogo({title:'2'}); o.first = await p1; o.secondOpen = !q().hidden && q().querySelector('h3').textContent;
    q().querySelector('button').click(); o.second = await p2;
    // keys go to the dialog, not to the shortcuts (G toggles snapping)
    const snap = state.snap.on; const p3 = dialogo({title:'K'}); key('g', document.body); o.gIgnored = state.snap.on === snap;
    key('Escape'); await p3;
    // focus returns to the element that had it
    const inp = document.querySelector('#bKeys'); inp.focus(); const p4 = dialogo({title:'F'}); key('Escape'); await p4; o.focusBack = document.activeElement === inp;
    return o; })()`);
  res.dialog = d;
  if (!d.open.shown || d.open.title !== 'T' || !/Body text/.test(d.open.text) || d.open.btns.join('|') !== 'Cancel|Go*!' || d.open.focus !== 'Go') fail('dlgOpen', d.open);
  if (d.byBtn !== 'no' || !d.closed || d.esc !== null || d.enter !== 'b' || d.scrim !== null) fail('dlgResult', d);
  if (!d.insideStays || d.defaultBtn !== 'k' || d.first !== null || d.secondOpen !== '2' || d.second !== 'ok') fail('dlgMisc', d);
  if (!d.gIgnored || !d.focusBack) fail('dlgKeys', d);

  // ---- 3. shortcuts popover
  const k0 = await ev(`(()=>{ const p = document.getElementById('keysPop'); return {hidden: p.hidden, ctrlBox: !!document.querySelector('#controls .keys:not([hidden])')}; })()`);
  if (!k0.hidden || k0.ctrlBox) fail('keysInitial', k0);
  await ev(`document.getElementById('bKeys').click()`);
  const k1 = await ev(`(()=>{ const p = document.getElementById('keysPop'); return {hidden: p.hidden, h4: [...p.querySelectorAll('h4')].map(h=>h.textContent),
    n: p.querySelectorAll('.kgrid > div').length, want: SHORTCUTS.reduce((n,g)=>n+g[1].length,0),
    keys: [...p.querySelectorAll('b')].map(b=>b.textContent), toastOn: document.getElementById('toast').classList.contains('on'),
    exp: document.getElementById('bKeys').getAttribute('aria-expanded'), r: JSON.parse(JSON.stringify(p.getBoundingClientRect()))}; })()`);
  res.keys = {h4: k1.h4, n: k1.n};
  if (k1.hidden || k1.h4.join(',') !== 'Edit,Canvas,Layers,File,View' || k1.n !== k1.want || k1.exp !== 'true') fail('keysOpen', k1);
  for (const must of ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+O', 'Ctrl+S', 'Ctrl+E', 'Ctrl+Shift+E', 'Ctrl+D', 'Ctrl+A', 'Delete', 'Tab', 'G', 'L', 'C', 'Esc', '?', 'Shift+Arrows', 'Alt+Wheel', 'Space+drag'])
    if (!k1.keys.includes(must)) fail('keysMissing', must);
  // every single-key / Ctrl shortcut the keydown handler knows is in the list
  const src = await ev(`(()=>{ const s = String(window.__kd || ''); return s.length; })()`);
  await capture('t11-keys');
  await ev(`document.getElementById('bKeys').click()`);
  if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysToggleBtn', 1);
  await key('?'); if (await ev(`document.getElementById('keysPop').hidden`)) fail('keysQuestion', 1);
  await key('?'); if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysQuestion2', 1);
  await key('?'); await key('Escape'); if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysEsc', 1);
  await key('?');
  await ev(`document.getElementById('stage').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`);
  if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysOutside', 1);
  // '?' in a text field types, does not open
  await ev(`(()=>{ const i = document.querySelector('#packcard input, #controls input[type=text]'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', {key:'?', bubbles:true, cancelable:true})); })()`);
  if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysInField', 1);

  // ---- 4. Ctrl+O
  const o1 = await ev(`(async()=>{
    let n = 0; const keep = window.showOpenFilePicker;
    window.showOpenFilePicker = async ()=>{ n++; throw new DOMException('x', 'AbortError'); };
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'o', ctrlKey:true, bubbles:true, cancelable:true}));
    await new Promise(r => setTimeout(r, 100)); const a = n;
    const inp = document.querySelector('#packcard input, #controls input[type=text]'); inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', {key:'o', ctrlKey:true, bubbles:true, cancelable:true}));
    await new Promise(r => setTimeout(r, 100)); const b = n;
    inp.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'o', ctrlKey:true, shiftKey:true, bubbles:true, cancelable:true}));
    await new Promise(r => setTimeout(r, 100)); const c = n;
    window.showOpenFilePicker = keep; return {a, b, c}; })()`);
  res.ctrlO = o1;
  if (o1.a !== 1 || o1.b !== 2 || o1.c !== 2) fail('ctrlO', o1);

  // ---- 5. Undo buttons
  const U = async (name, setup, act, check) => {
    const r = await ev(`(async()=>{
      ${setup}
      const snap0 = snapState(), n0 = undoStack.length, sh0 = SHOTS.length, vr0 = state.variants.length;
      ${act}
      const t = document.getElementById('toast'), b = t.querySelector('button');
      const o = {btn: b && b.textContent, on: t.classList.contains('on'), msg: t.firstChild && t.firstChild.textContent,
                 changed: snapState() !== snap0 || SHOTS.length !== sh0, grew: undoStack.length - n0};
      if(b) b.click();
      o.restored = snapState() === snap0 && SHOTS.length === sh0; o.stack = undoStack.length - n0; o.hid = !t.querySelector('button') && /^Undo(:|$)/.test(t.firstChild.textContent);
      o.imgs = SHOTS.length === sh0; o.vr = state.variants.length === vr0;
      return o; })()`);
    res['undo_' + name] = r;
    if (r.btn !== 'Undo' || !r.on || r.grew !== 1 || !r.restored || r.stack !== 0 || !r.hid || !r.imgs || !r.vr) fail('undo_' + name, r);
  };
  await U('removeImage', ``, `togliImmagine(1);`);
  await U('removeAll', ``, `runAction('shotsClear');`);
  await U('deleteLayer', `layerAdd('shape');`, `layerDelete(state.sel.slice(4));`);
  await U('deleteVariant', `variantAdd();`, `variantDelete(state.variants.length - 1);`);
  await U('resetAccent', `state.theme.accent = '#336699';`, `runAction('resetAccent');`);
  // Delete key on a layer also offers Undo (single layer message)
  const dk = await ev(`(async()=>{ layerAdd('shape'); const s0 = snapState();
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true}));
    const t = document.getElementById('toast'); const o = {msg: t.firstChild.textContent, btn: !!t.querySelector('button')};
    t.querySelector('button').click(); o.back = snapState() === s0; return o; })()`);
  res.deleteKey = dk;
  if (dk.msg !== 'Layer deleted' || !dk.btn || !dk.back) fail('deleteKey', dk);
  // stale Undo: another change after the action -> button refuses, nothing undone
  const st = await ev(`(async()=>{ togliImmagine(0); const t = document.getElementById('toast'), b = t.querySelector('button');
    pushUndo(); state.pack.title = 'Other'; const n = undoStack.length, n2 = SHOTS.length; b.click();
    const o = {untouched: undoStack.length === n && SHOTS.length === n2, msg: t.firstChild.textContent}; undo(); undo(); return o; })()`);
  res.stale = st;
  if (!st.untouched || !/Too late/.test(st.msg)) fail('staleUndo', st);

  // ---- 6. size check dialog (a Fab format forced above 3 MB)
  const sc = await ev(`(async()=>{
    const orig = renderFormatToBlob;
    renderFormatToBlob = (f, cb) => orig(f, b => (f.group === 'Fab' && f.id === 'fab_gallery') ? cb(new Blob([new Uint8Array(3.5 * 1048576)])) : cb(b));
    const on = FORMATS.filter(f => state.layouts[f.id].on).length;
    try{
      const lines = await sizeCheck();
      const q = document.getElementById('dlg'); const rows = [...q.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent));
      const data = rows.filter(r => r.length === 3 && /KB$/.test(r[2]));
      const kb = data.map(r => parseInt(r[2].replace(/[^0-9]/g, '')));
      const o = {on, shown: !q.hidden, title: q.querySelector('h3').textContent, data: data.length, header: rows[0], total: rows[rows.length - 1],
                 sorted: kb.every((v, i) => !i || kb[i - 1] >= v), fabNote: rows.filter(r => /Fab asks under 3 MB/.test(r[0])).length,
                 names: data.map(r => r[0]), sizes: data.map(r => r[1]), lines: lines.length};
      await new Promise(r => setTimeout(r, 3500));
      o.stillOpen = !q.hidden;
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
      o.closed = q.hidden;
      return o;
    } finally { renderFormatToBlob = orig; } })()`);
  res.sizeCheck = sc;
  if (!sc.shown || sc.title !== 'Size of every format' || sc.data !== sc.on || sc.lines !== sc.on || !sc.sorted || sc.fabNote !== 1) fail('sizeCheck', sc);
  if (!sc.stillOpen || !sc.closed) fail('sizeCheckStays', sc);
  if (!/^Total/.test(sc.total[0]) || !/MB$/.test(sc.total[2])) fail('sizeCheckTotal', sc.total);
  if (!sc.names.includes('YouTube Thumbnail') && sc.on === 8) fail('sizeCheckNames', sc.names);
  await ev(`sizeCheck()`); await delay(400);
  await until_(ev, `!document.getElementById('dlg').hidden`);
  await capture('t11-sizecheck');
  await key('Escape');

  // ---- 7. no typeof guards left in caricaPresetFile; project round trip still lets images in
  const g = await ev(`(()=>{ const s = String(caricaPresetFile); return {typeofGuard: /typeof (preparaImmagini|scaldaImmagini)/.test(s), fallback: /haTrasparenza/.test(s), keep: typeof haTrasparenza === 'function'}; })()`);
  res.guards = g;
  if (g.typeofGuard || g.fallback || !g.keep) fail('guards', g);
  const rt = await ev(`(async()=>{
    const root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('t11-proj.json', {create:true});
    fileProgetto = h; await new Promise(r => { const b = document.getElementById('bSave'); b.click(); setTimeout(r, 1500); });
    const f = await h.getFile(); const n = SHOTS.length, names = SHOTS.map(s => s.name).join(',');
    SHOTS = []; imgShot = null;
    caricaPresetFile(f, h); while(aprendoProgetto) await new Promise(r => setTimeout(r, 50));
    return {size: f.size, n, after: SHOTS.length, same: SHOTS.map(s => s.name).join(',') === names, thumbs: SHOTS.every(s => s.thumb || s.buchi !== undefined), msg: document.getElementById('toast').textContent}; })()`);
  res.roundTrip = rt;
  if (!rt.size || rt.after !== rt.n || !rt.same || !/Project opened/.test(rt.msg)) fail('roundTrip', rt);

  return res;
};
async function until_(ev, expr) { for (let i = 0; i < 100; i++) { if (await ev(expr)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('timeout ' + expr); }
