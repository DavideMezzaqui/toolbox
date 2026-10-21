'use strict';
// Z2 (1.8.0): stage, toolbar, header, icons, toasts, shortcuts, keyboard.
//   node tests/stress/run.cjs tests/stress/ui/t17-stage.cjs
// Active toggles are not the primary white; icons are distinct; toast sits bottom-left of the
// stage and never over the caption; no toast on a format switch; an arrow burst is one undo step;
// Ctrl+N opens the New dialog; R / # keys; shortcuts popover; compare name and plural.
module.exports = async ({ev, evaluate, command, delay, capture}) => {
  const res = {ok: true};
  const fail = (k, v) => { res.ok = false; (res.fail = res.fail || {})[k] = v; };
  const key = (k, o) => ev(`window.dispatchEvent(new KeyboardEvent('keydown',Object.assign({key:${JSON.stringify(k)},bubbles:true,cancelable:true},${JSON.stringify(o || {})})))`);

  // some images, so the strip header and the canvas have content
  await ev(`(async()=>{
    const mk = async (n, h) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + h + ',55%,28%)'; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = 'hsl(' + (h + 90) + ',70%,55%)'; g.fillRect(200, 160, 600, 320);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type: 'image/png', lastModified: h}); };
    const files = []; for(const [n, h] of [['st_a', 20], ['st_b', 150], ['st_c', 260]]) files.push(await mk(n, h));
    await new Promise(r => addShots(files, r)); return SHOTS.length; })()`);
  await ev(`state.active = FORMATS[0].id; buildFormats(); buildControls(); render(); 1`);

  // ---- 1. active toggles are not the primary white button
  await ev(`state.snap.on = true; showGrid = true; buildTools(); 1`);
  const tg = await ev(`(()=>{ const c = e => { const s = getComputedStyle(e); return {bg: s.backgroundColor, bd: s.borderTopColor, fg: s.color}; };
    const on = [...document.querySelectorAll('#tools button.on')].map(b => ({t: b.textContent.trim(), ...c(b)}));
    return {on, off: c([...document.querySelectorAll('#tools button:not(.on)')].find(b => /Lock/.test(b.textContent))),
      primary: c(document.getElementById('bZip'))}; })()`);
  res.toggle = tg;
  if (tg.on.length < 2) fail('toggleCount', tg.on);
  tg.on.forEach(o => { if (o.bg === tg.primary.bg || o.bg === tg.off.bg || o.fg !== 'rgb(255, 255, 255)' || o.bd === tg.off.bd) fail('toggleStyle', o); });

  // ---- 2. distinct icons, one meaning each
  const ic = await ev(`(()=>{ const d = el => { const p = el && el.querySelector('svg.ic path'); return p ? p.getAttribute('d') : null; };
    const hdr = id => d(document.getElementById(id));
    const tool = re => d([...document.querySelectorAll('#tools button')].find(b => re.test(b.textContent + ' ' + b.title)));
    const strip = re => d([...document.querySelectorAll('#imgs .ih button')].find(b => re.test(b.textContent + ' ' + b.title)));
    const m = {New: hdr('bNew'), Open: hdr('bLoad'), Save: hdr('bSave'), SaveAs: hdr('bSaveAs'), ExportCurrent: hdr('bExp'), Desktop: hdr('bDesk'),
      ExportAll: hdr('bZip'), Shortcuts: hdr('bKeys'), WholeLayout: hdr('bAll'),
      Undo: tool(/Undo the last/), Redo: tool(/Redo what/), Recentre: tool(/Recentre/), Snap: tool(/Snap to/), Grid: tool(/Show a grid/),
      Wheel: tool(/Wheel resizes/), Lock: tool(/Lock the selection/), ZoomOut: tool(/Zoom out/), ZoomIn: tool(/Zoom into/),
      Compare: tool(/Compare/), Reset: tool(/Reset format/),
      StripAdd: strip(/Add images/), StripFolder: strip(/Add every image in a folder/), StripUnused: strip(/no panel shows/), StripRemoveAll: strip(/Remove every image/)};
    return m; })()`);
  const seen = {};
  Object.entries(ic).forEach(([k, v]) => { if (!v) fail('iconMissing', k); else (seen[v] = seen[v] || []).push(k); });
  Object.values(seen).filter(a => a.length > 1).forEach(a => fail('iconDuplicate', a));
  // the layer-duplicate icon ('copy') must also differ from Save as / Whole layout
  const copyD = await ev(`ICONS.copy`);
  Object.entries(ic).forEach(([k, v]) => { if (v === copyD) fail('iconIsDuplicate', k); });

  // ---- 3. Tab (format switch) fires no toast; Tab still switches
  const tab = await ev(`(()=>{ window.__tc = 0; const t0 = toast; window.toast = function(m, o){ __tc++; return t0.apply(this, arguments); };
    const a = state.active; document.getElementById('toast').classList.remove('on');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
    const r = {switched: state.active !== a, toasts: __tc, on: document.getElementById('toast').classList.contains('on')};
    window.toast = t0; state.active = a; buildFormats(); buildControls(); render(); return r; })()`);
  if (!tab.switched || tab.toasts !== 0 || tab.on) fail('tabToast', tab);

  // ---- 4. toast anchor: inside the stage, bottom-left, never over the caption or the toolbar (two window sizes)
  res.toastPos = {};
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await command('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await delay(500);
    await ev(`render(); 1`);
    for (const fmt of ['unity_cover', 'unity_card']) {
      const r = await ev(`(()=>{ state.active = ${JSON.stringify(fmt)}; buildFormats(); buildControls(); render();
        toast('Selection locked on Screenshot and a few more words to make it wrap a little longer than usual here');
        const t = document.getElementById('toast'), tb = t.getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect();
        const ov = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const caps = ['dims', 'selinfo'].map(id => document.getElementById(id)).filter(e => e.textContent).map(e => e.getBoundingClientRect());
        const tools = document.getElementById('tools').getBoundingClientRect();
        return {left: Math.round(tb.left - st.left), bottomGap: Math.round(st.bottom - tb.bottom), inside: tb.left >= st.left && tb.right <= st.right + 1 && tb.top >= st.top,
          overCaption: caps.some(c => ov(tb, c)), overTools: ov(tb, tools), stageW: Math.round(st.width), toastW: Math.round(tb.width)}; })()`);
      res.toastPos[w + ':' + fmt] = r;
      if (!r.inside || r.overCaption || r.overTools || r.left > 40) fail('toastPlace', [w, h, fmt, r]);
    }
    if (w === 1280) await capture('t17-toast-1280x720'); else await capture('t17-toast-1920x1080');
  }
  await ev(`document.getElementById('toast').classList.remove('on'); state.active = FORMATS[0].id; buildFormats(); buildControls(); render(); 1`);

  // ---- 5. arrow burst = one undo step (typed in a burst, and a held key), a later burst = another
  const ar = await ev(`(async()=>{ state.sel = 'row'; selectEl && selectEl('row');
    const x0 = state.layouts[state.active].row.x, n0 = undoStack.length;
    const arrow = (k, rep) => window.dispatchEvent(new KeyboardEvent('keydown', {key:k, repeat:!!rep, bubbles:true, cancelable:true}));
    for(let i = 0; i < 6; i++){ arrow('ArrowRight', i > 0); await new Promise(r => setTimeout(r, 80)); }
    const x1 = state.layouts[state.active].row.x, n1 = undoStack.length;
    await new Promise(r => setTimeout(r, 750));
    for(let i = 0; i < 3; i++){ arrow('ArrowDown', false); await new Promise(r => setTimeout(r, 120)); }
    const n2 = undoStack.length;
    undo(); const afterUndo2 = state.layouts[state.active].row.x;
    undo(); const afterUndo1 = state.layouts[state.active].row.x;
    return {x0, x1, steps1: n1 - n0, steps2: n2 - n1, afterUndo2, afterUndo1}; })()`);
  res.arrows = ar;
  if (ar.x1 <= ar.x0 || ar.steps1 !== 1 || ar.steps2 !== 1) fail('arrowSteps', ar);
  if (Math.abs(ar.afterUndo2 - ar.x1) > 1e-9 || Math.abs(ar.afterUndo1 - ar.x0) > 1e-9) fail('arrowUndo', ar);
  // a drag/undo between two bursts opens a new step even inside 600 ms
  const ar2 = await ev(`(async()=>{ state.sel = 'row'; const arrow = k => window.dispatchEvent(new KeyboardEvent('keydown', {key:k, bubbles:true, cancelable:true}));
    const n0 = undoStack.length; arrow('ArrowLeft'); undo(); arrow('ArrowLeft'); const d = undoStack.length - n0;
    undo(); return d; })()`);
  if (ar2 !== 1) fail('arrowAfterUndo', ar2);

  // ---- 6. keys: Ctrl+N dialog, R recentre (one step), # grid
  await key('n', {ctrlKey: true});
  await delay(150);
  const dlg = await ev(`({open: dialogoAperto(), title: (document.querySelector('#dlg h3')||{}).textContent})`);
  res.ctrlN = dlg;
  if (!dlg.open || !/New/i.test(dlg.title || '')) fail('ctrlN', dlg);
  await key('Escape'); await delay(100);
  if (await ev(`dialogoAperto()`)) fail('ctrlNClose', 1);
  const rk = await ev(`(()=>{ const S = state.layouts[state.active].shot, i = pannelloAttivo(S);
    pushUndo(); S.sc[i] = 2.3; S.px[i] = 0.7; render(); const n0 = undoStack.length;
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'r', bubbles:true, cancelable:true}));
    const o = {sc: S.sc[i], px: S.px[i], steps: undoStack.length - n0};
    undo(); const S2 = state.layouts[state.active].shot; o.back = S2.sc[i]; const g0 = showGrid;
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'#', bubbles:true, cancelable:true}));
    o.grid = showGrid !== g0; window.dispatchEvent(new KeyboardEvent('keydown', {key:'#', bubbles:true, cancelable:true})); o.gridBack = showGrid === g0;
    const inp = document.createElement('input'); inp.type = 'text'; document.body.appendChild(inp); inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', {key:'r', bubbles:true, cancelable:true})); o.typing = S2.sc[i] === 2.3; inp.remove();
    return o; })()`);
  res.keysRG = rk;
  if (rk.sc !== 1 || rk.px !== 0.5 || rk.steps !== 1 || rk.back !== 2.3 || !rk.grid || !rk.gridBack || !rk.typing) fail('keysRG', rk);
  const tips = await ev(`[...document.querySelectorAll('#tools button')].map(b => [b.textContent.trim(), b.title]).filter(([n]) => /Recentre|Grid|Compare/.test(n))`);
  if (!tips.every(([, t]) => /Key: \S/.test(t) && !/\.$/.test(t.trim()))) fail('tipKeys', tips);
  if (!/Key: R/.test(tips.find(t => /Recentre/.test(t[0]))[1]) || !/Key: #/.test(tips.find(t => /Grid/.test(t[0]))[1])) fail('tipKeyValues', tips);

  // ---- 7. shortcuts popover
  await ev(`document.getElementById('bKeys').click()`);
  await delay(100);
  const kp = await ev(`(()=>{ const p = document.getElementById('keysPop'); const rows = [...p.querySelectorAll('.kgrid > div')];
    const gr = p.querySelector('.kgrid').getBoundingClientRect();
    const xs = new Set(rows.map(r => Math.round(r.querySelector('span').getBoundingClientRect().left - r.getBoundingClientRect().left)));
    const descs = rows.map(r => r.querySelector('span').textContent), keys = rows.map(r => r.querySelector('b').textContent);
    const x = p.querySelector('.kx'), head = p.querySelector('.khead');
    return {hidden: p.hidden, redo: descs.filter(d => /^Redo/.test(d)).length, dragEmpty: keys.includes('Drag on empty'), box: descs[keys.indexOf('Shift+drag')],
      keysHas: ['Ctrl+N', 'R', '#'].filter(k => keys.includes(k)), spanOffsets: [...xs], hasX: !!x, headText: head && head.textContent, firstChild: p.firstElementChild.className,
      fits: p.getBoundingClientRect().bottom <= innerHeight, rows: rows.length, w: Math.round(p.getBoundingClientRect().width)}; })()`);
  res.keysPop = kp;
  if (kp.hidden || kp.redo !== 1 || kp.dragEmpty || kp.keysHas.length !== 3 || kp.spanOffsets.length !== 1 || !kp.hasX || !/Esc/.test(kp.headText || '') || kp.firstChild !== 'khead') fail('keysPop', kp);
  if (!/plain drag/i.test(kp.box || '')) fail('boxWording', kp.box);
  await capture('t17-keys');
  await ev(`document.querySelector('#keysPop .kx').click()`);
  if (!(await ev(`document.getElementById('keysPop').hidden`))) fail('keysClose', 1);
  // the wording is true: with an image loaded a plain drag on the image moves it, Shift+drag starts a box
  const bs = await ev(`(()=>{ const r = cv.getBoundingClientRect(); const mk = (shift) => { boxSel = null; dragging = false;
      startDrag({button:0, clientX:r.left + r.width*0.5, clientY:r.top + r.height*0.5, shiftKey:shift, ctrlKey:false, metaKey:false, preventDefault(){}, touches:null});
      const o = {box: !!boxSel, drag: dragging}; boxSel = null; dragging = false; render(); return o; };
    state.sel = 'shot'; const A = mk(false), B = mk(true); undo(); return {plain: A, shift: B, haveImg: !!imgShot}; })()`);
  res.dragWording = bs;
  if (!bs.haveImg || bs.plain.box || bs.shift.box !== true) fail('dragWording', bs);

  // ---- 8. compare: one name, plural
  const names = await ev(`({tool: [...document.querySelectorAll('#tools button')].find(b => /Compare/.test(b.textContent)).textContent.trim(),
    variantsBtn: (() => { let r = null; PARTS.forEach(p => (p.rows || []).forEach(x => { if(x.act === 'compareShow') r = x.text; })); (typeof SECTIONS !== 'undefined' ? SECTIONS : []).forEach(s => (s.rows || []).forEach(x => { if(x.act === 'compareShow') r = x.text; })); return r; })()})`);
  res.compareNames = names;
  if (names.tool !== 'Compare variants') fail('compareTool', names);
  const cmp = await ev(`(()=>{ state.variants = [];
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'c', bubbles:true, cancelable:true}));
    const a = {mode: compareMode, dims: document.getElementById('dims').textContent, info: document.getElementById('selinfo').textContent, on: document.querySelector('#tools button.on') && document.querySelector('#tools button.on').textContent.trim()};
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'c', bubbles:true, cancelable:true})); a.back = !compareMode; return a; })()`);
  res.compare = cmp;
  if (!cmp.mode || !/, 1 variant of /.test(cmp.dims) || /variants/.test(cmp.dims) || !/Compare variants/.test(cmp.info) || !cmp.back) fail('comparePlural', cmp);

  // ---- 9. hover state on a toolbar button (real mouse move): lighter than rest, border changes
  await command('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  await delay(400);
  const rect = await ev(`(()=>{ const b = [...document.querySelectorAll('#tools button')].find(x => /Lock the selection/.test(x.title)); const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
  const off = await evaluate(`(()=>{ const r = document.querySelector('iframe[src*="store"]').getBoundingClientRect(); return {x: r.left, y: r.top}; })()`);
  const st = () => ev(`(()=>{ const b = [...document.querySelectorAll('#tools button')].find(x => /Lock the selection/.test(x.title)); const s = getComputedStyle(b); return {bg: s.backgroundColor, bd: s.borderTopColor}; })()`);
  await command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 5, y: 5}); await delay(250);
  const rest = await st();
  await command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: off.x + rect.x, y: off.y + rect.y}); await delay(300);
  const hov = await st();
  await command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 5, y: 5});
  res.hover = {rest, hov};
  const lum = c => { const m = c.match(/\d+/g).map(Number); return m[0] + m[1] + m[2]; };
  if (lum(hov.bg) <= lum(rest.bg) || hov.bd === rest.bd) fail('hover', res.hover);

  // ---- screenshots of the final state at both sizes
  await ev(`state.snap.on = true; showGrid = false; buildTools(); render(); 1`);
  await capture('t17-stage-1920x1080');
  await command('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
  await delay(500);
  await capture('t17-stage-1280x720');
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  return res;
};
