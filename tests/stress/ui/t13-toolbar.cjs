'use strict';
// 2D: canvas toolbar order and tooltips, Reset format with Undo toast, Recentre image,
// renamed labels (data paths untouched) and rewritten tooltips.
//   node tests/stress/run.cjs tests/stress/ui/t13-toolbar.cjs
module.exports = async ({ev, command, delay, capture}) => {
  const res = {ok: true};
  const fail = (k, v) => { res.ok = false; (res.fail = res.fail || {})[k] = v; };
  // ---- toolbar order
  const bar = await ev(`(()=>{ const t = document.getElementById('tools');
    const kids = [...t.children].map(e => e.className === 'tsep' ? '|' : e.className === 'tgrow' ? 'grow' :
      (e.textContent.trim() || (e.title.split('.')[0])));
    const tr = t.getBoundingClientRect();
    const rs = [...t.querySelectorAll('button')].find(b => /Reset format/.test(b.textContent)).getBoundingClientRect();
    const cp = [...t.querySelectorAll('button')].find(b => /Compare/.test(b.textContent)).getBoundingClientRect();
    return {kids, titles: [...t.querySelectorAll('button')].map(b => [b.textContent.trim(), b.title]),
      resetRightGap: Math.round(tr.right - rs.right), resetAfterCompare: rs.left > cp.right + 20, h: Math.round(tr.height)}; })()`);
  res.bar = bar.kids.join(' ');
  const want = ['Undo', 'Redo', '|', 'Recentre image', '|', 'Snap', 'Grid', 'Wheel resizes', '|', 'Lock', '|'];
  if (bar.kids.slice(0, 11).join(',') !== want.join(',')) fail('order', bar.kids);
  if (bar.kids[bar.kids.length - 2] !== 'grow' || bar.kids[bar.kids.length - 1] !== 'Reset format') fail('tail', bar.kids);
  if (bar.kids.indexOf('Compare variants') < 0) fail('compare', bar.kids);
  if (!bar.resetAfterCompare || bar.resetRightGap > 16) fail('resetPosition', [bar.resetRightGap, bar.resetAfterCompare]);
  const noKey = bar.titles.filter(([, t]) => !/Key: \S/.test(t) || /\.$/.test(t.trim()));
  if (noKey.length) fail('tooltipKey', noKey);
  res.oneLine = bar.h;
  // ---- Reset format: default layout back, toast, one undo step
  await ev(`state.active = FORMATS[0].id; buildFormats(); buildControls(); render(); 1`);
  await ev(`window._toasts = []; const _t = toast; toast = function(m, o){ _toasts.push([m, o]); return _t.apply(this, arguments); }; 1`);
  await ev(`(()=>{ const id = state.active; pushUndo(); state.layouts[id].band.top = 0.42; state.layouts[id].row.x = 0.3; buildControls(); render(); return 1; })()`);
  const r1 = await ev(`(()=>{ const id = state.active, f = FORMATS.find(x=>x.id===id);
    const b = [...document.querySelectorAll('#tools button')].find(x=>/Reset format/.test(x.textContent));
    const n0 = (typeof undoStack !== 'undefined') ? undoStack.length : -1;
    b.click();
    const L = state.layouts[id], d = defLayout(f);
    const t = _toasts[_toasts.length-1];
    const after = {top: L.band.top, defTop: d.band.top, x: L.row.x, toast: t && t[0], opt: t && t[1], steps: ((typeof undoStack !== 'undefined') ? undoStack.length : -1) - n0, name: nomeFormato(f)};
    undo();
    after.undoneTop = state.layouts[id].band.top; after.undoneX = state.layouts[id].row.x;
    return after; })()`);
  res.reset = r1;
  if (r1.top !== r1.defTop) fail('resetTop', r1);
  if (!(r1.toast || '').startsWith(r1.name) || !/back to its default layout$/.test(r1.toast)) fail('resetToast', r1.toast);
  if (!r1.opt || r1.opt.undo !== true) fail('resetToastUndo', r1.opt);
  if (r1.steps !== 1 && r1.steps !== -1) fail('resetSteps', r1.steps);
  if (Math.abs(r1.undoneTop - 0.42) > 1e-9 || Math.abs(r1.undoneX - 0.3) > 1e-9) fail('resetUndo', r1);
  // ---- Recentre image
  const r2 = await ev(`(()=>{
    const id = state.active; const S = state.layouts[id].shot; const i = pannelloAttivo(S);
    pushUndo(); S.sc[i] = 2.2; S.px[i] = 0.7; S.rot[i] = 15; render();
    [...document.querySelectorAll('#tools button')].find(x=>/Recentre image/.test(x.textContent)).click();
    const S2 = state.layouts[id].shot;
    const out = {sc: S2.sc[i], px: S2.px[i], rot: S2.rot[i]};
    undo(); out.undoneSc = state.layouts[id].shot.sc[i];
    return out; })()`);
  res.recentre = r2;
  if (r2.sc !== 1 || r2.px !== 0.5 || r2.rot !== 0 || r2.undoneSc !== 2.2) fail('recentre', r2);
  // ---- labels: renamed in PARTS, data paths unchanged
  const lab = await ev(`(()=>{ const all = []; PARTS.forEach(p => (p.rows || []).forEach(r => { if(r.p) all.push([r.p, r.l]); }));
    return all; })()`);
  const L = Object.fromEntries(lab);
  const exp = {'shot.slant': 'Cut angle (all)', 'shot.gap': 'Panel gap', 'row.itemFont': 'Brand font',
    'row.itemSize': 'Brand size', 'row.itemColor': 'Brand colour', 'row.y2': 'Line 2 Y', 'row.x2': 'Line 2 X',
    'accent.gradLink': 'Theme gradient', 'badges.gradLink': 'Theme gradient'};
  Object.entries(exp).forEach(([p, l]) => { if (L[p] !== l) fail('label ' + p, L[p]); });
  const olds = ['Cut slant', 'Cut gap', 'Item font', 'Item size', 'Item colour', '2nd line Y', '2nd line X', 'Follow theme'];
  const left = lab.filter(([, l]) => olds.indexOf(l) >= 0);
  if (left.length) fail('oldLabels', left);
  // per-panel label in the DOM (Image tab, 3 panels)
  const dom = await ev(`(()=>{ state.layouts[state.active].shot.panels = 3; activeTab = 'image'; buildControls();
    const labs = [...document.querySelectorAll('#controls label')].map(l => l.textContent);
    return {right: labs.filter(t => t === 'Right cut angle').length, old: labs.filter(t => t === 'Cut angle').length}; })()`);
  res.panelLabels = dom;
  if (dom.right < 1 || dom.old) fail('panelCutAngle', dom);
  // ---- tooltips for the listed controls reach the rows (tipFor)
  const need = ['band.feather', 'band.sideFeather', 'band.slant', 'accent.endCut', 'accent.segments', 'accent.segGap', 'logo.outLink',
    'logo.mapMode', 'logo.darkColor', 'logo.lightColor', 'logo.mapCut', 'logo.tintOn', 'logo.fill', 'row.y', 'row.fitW', 'row.gap',
    'row.hCenter', 'fx.tintMode', 'shot.fit', 'badges.gap', 'accent.gradLink', 'shot.slant', 'shot.gap'];
  const tips = await ev(`(()=>{ const rows = {}; PARTS.forEach(p => (p.rows || []).forEach(r => { if(r.p) rows[r.p] = r; }));
    return ${JSON.stringify(need)}.map(p => [p, rows[p] ? tipFor(rows[p]) : null]); })()`);
  const miss = tips.filter(([, t]) => !t || t.length < 12 || /\n/.test(t));
  if (miss.length) fail('tips', miss);
  const acts = await ev(`['centerRow', 'centerRowAll'].map(a => ACT_TIP[a])`);
  if (acts.some(t => !t)) fail('actTips', acts);
  res.tipSample = tips.slice(0, 3);
  await capture('toolbar');
  // ---- narrow windows: the bar still fits on one line and the Reset button stays reachable
  res.narrow = {};
  for(const w of [1280, 1100]){
    await command('Emulation.setDeviceMetricsOverride', {width: w, height: 800, deviceScaleFactor: 1, mobile: false});
    await delay(600);
    const n = await ev(`(()=>{ const t = document.getElementById('tools'), tr = t.getBoundingClientRect();
      const rs = [...t.querySelectorAll('button')].find(b => b.title.indexOf('default layout') >= 0).getBoundingClientRect();
      return {h: Math.round(tr.height), cls: t.className, resetInside: rs.right <= tr.right + 1 && rs.left >= tr.left - 1, sw: document.documentElement.scrollWidth, iw: innerWidth}; })()`);
    res.narrow[w] = n;
    if (n.h > 46 || !n.resetInside || n.sw > n.iw) fail('narrow' + w, n);
  }
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  return res;
};
