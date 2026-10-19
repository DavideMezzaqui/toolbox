'use strict';
// 4A: conditional rows (layer/part shadow, grid autoRows), per-panel sliders with data-path,
// stale picker after rebuild, zoom label kept by buildTools.
//   APP_ROOT=<copy> PORT=<port> node tests/stress/run.cjs tests/stress/ui/t14-controls.cjs
module.exports = async ({ev, delay}) => {
  const res = {ok: true, checks: {}};
  const chk = (name, cond, extra) => { res.checks[name] = cond ? true : (extra === undefined ? false : extra); if (!cond) res.ok = false; };
  const has = p => ev(`!!document.querySelector('#controls [data-path="${p}"]')`);
  const flip = (p, on) => ev(`(()=>{ const e = document.querySelector('#controls [data-path="${p}"]'); e.checked = ${on}; e.dispatchEvent(new Event('change', {bubbles: true})); return 1; })()`);

  await ev(`state.active = FORMATS[0].id; buildFormats(); buildControls(); render(); 1`);

  // ---------- 1a: layer shadow rows
  await ev(`vaiScheda(tabOf('Layers')); openSecs['Layers'] = true; layerAdd('shape'); vaiScheda(tabOf('Layers')); 1`);
  const lid = await ev(`state.sel`);
  chk('shape layer selected', /^lay:/.test(lid), lid);
  chk('layer: shadowOn row built', await has(lid + '.shadowOn'));
  chk('layer: shadow rows hidden when off', !(await has(lid + '.shadowBlur')) && !(await has(lid + '.shadowColor')));
  await flip(lid + '.shadowOn', true);
  chk('layer: shadow rows appear when ticked', (await has(lid + '.shadowBlur')) && (await has(lid + '.shadowColor')) && (await has(lid + '.shadowY')));
  chk('layer: state set', await ev(`layOfKey(${JSON.stringify(lid)}).shadowOn === true`));
  await flip(lid + '.shadowOn', false);
  chk('layer: shadow rows vanish when unticked', !(await has(lid + '.shadowBlur')));
  await flip(lid + '.shadowOn', true);
  chk('layer: rows keep their order', await ev(`(()=>{ const ps = [...document.querySelectorAll('#controls [data-path^="${lid}.shadow"]')].map(e => e.getAttribute('data-path').split('.')[1]);
    return ps.join() === 'shadowOn,shadowColor,shadowOpacity,shadowBlur,shadowX,shadowY'; })()`));

  // ---------- 1b: part shadow rows appear immediately
  await ev(`selectEl('band'); vaiScheda(tabOf(SEL_SECTION.band)); state.layouts[state.active].band.shadowOn = false; buildControls(); 1`);
  chk('band: shadowOn row built', await has('band.shadowOn'));
  chk('band: shadow rows hidden when off', !(await has('band.shadowBlur')));
  await flip('band.shadowOn', true);
  chk('band: shadow rows appear immediately', (await has('band.shadowBlur')) && (await has('band.shadowColor')));
  await flip('band.shadowOn', false);
  chk('band: shadow rows gone again', !(await has('band.shadowBlur')));
  for (const part of ['logo', 'row', 'badges']) {
    await ev(`selectEl(${JSON.stringify(part)}); vaiScheda(tabOf(SEL_SECTION[${JSON.stringify(part)}])); state.layouts[state.active][${JSON.stringify(part)}].shadowOn = false; buildControls(); 1`);
    await flip(part + '.shadowOn', true);
    chk(part + ': shadow rows appear immediately', await has(part + '.shadowBlur'));
    await flip(part + '.shadowOn', false);
  }

  // ---------- 1c: grid autoRows
  await ev(`vaiScheda(tabOf('Layers')); layerAdd('grid'); vaiScheda(tabOf('Layers')); 1`);
  const gid = await ev(`state.sel`);
  const auto0 = await ev(`!!layOfKey(${JSON.stringify(gid)}).autoRows`);
  const view = async () => ({rows: await has(gid + '.rows'), rowH: await has(gid + '.rowH'), h: await has(gid + '.h')});
  let v = await view();
  chk('grid: starts consistent with autoRows=' + auto0, auto0 ? (!v.rows && v.rowH && !v.h) : (v.rows && !v.rowH && v.h), v);
  await flip(gid + '.autoRows', !auto0);
  v = await view();
  chk('grid: toggling autoRows swaps Rows/Height and Row height', !auto0 ? (!v.rows && v.rowH && !v.h) : (v.rows && !v.rowH && v.h), v);
  await flip(gid + '.autoRows', auto0);
  v = await view();
  chk('grid: toggling back restores', auto0 ? (!v.rows && v.rowH && !v.h) : (v.rows && !v.rowH && v.h), v);

  // ---------- 2: per-panel sliders follow the state
  const secShot = await ev(`SECTIONS.find(s => s.rows.some(r => r.type === 'panels')).t`);
  await ev(`state.sel = 'shot'; const S = state.layouts[state.active].shot; S.panels = 2; S.active = 0; buildControls(); vaiScheda(tabOf(${JSON.stringify(secShot)})); openSecs[${JSON.stringify(secShot)}] = true; 1`);
  chk('panel sliders carry data-path', (await has('shot.sc#0')) && (await has('shot.px#1')) && (await has('shot.rot#1')) && (await has('shot.weights#1')) && (await has('shot.slants#2')));
  const sync = await ev(`(()=>{ const S = state.layouts[state.active].shot;
    S.sc[1] = 2.31; S.px[1] = 0.8; S.py[0] = 0.25; S.rot[1] = 12.5; S.fh[1] = true;      // as canvas drag, arrows and Alt+wheel do
    syncControls();
    const g = p => document.querySelector('#controls [data-path="' + p + '"]');
    const val = p => g(p).parentNode.querySelector('.val').value;
    return {sc: g('shot.sc#1').value, scLab: val('shot.sc#1'), px: g('shot.px#1').value, py: g('shot.py#0').value, rot: g('shot.rot#1').value, rotLab: val('shot.rot#1'), fh: g('shot.fh#1').checked, fh0: g('shot.fh#0').checked}; })()`);
  chk('panel slider equals S.sc[1] after programmatic change', sync.sc === '2.31' && sync.scLab === '2.31', sync);
  chk('panel X/Y/rotation/flip follow too', sync.px === '0.8' && sync.py === '0.25' && sync.rot === '12.5' && parseFloat(sync.rotLab) === 12.5 && sync.fh === true && sync.fh0 === false, sync);
  const touch = await ev(`(()=>{ const S = state.layouts[state.active].shot; S.active = 0;
    const e = document.querySelector('#controls [data-path="shot.sc#1"]');
    e.value = '1.5'; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true}));
    return {sc1: S.sc[1], sc0: S.sc[0], active: S.active}; })()`);
  chk('touching a panel slider writes that panel and selects it', touch.sc1 === 1.5 && touch.sc0 !== 1.5 && touch.active === 1, touch);
  const typed = await ev(`(()=>{ const S = state.layouts[state.active].shot; S.active = 1;
    const e = document.querySelector('#controls [data-path="shot.sc#0"]'), v = e.parentNode.querySelector('.val');
    v.value = '5'; v.dispatchEvent(new Event('change', {bubbles: true}));
    return {sc0: S.sc[0], active: S.active}; })()`);
  chk('typed value follows the makeRow range rule (up to 2x max) and selects the panel', typed.sc0 === 5 && typed.active === 0, typed);
  const alt = await ev(`(()=>{ const S = state.layouts[state.active].shot; S.active = 0; S.px[1] = 0.9;
    const r = document.querySelector('#controls [data-path="shot.px#1"]').parentNode;
    r.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, altKey: true, button: 0}));
    return {px1: state.layouts[state.active].shot.px[1], active: state.layouts[state.active].shot.active}; })()`);
  chk('Alt+click puts the panel value back to its default', alt.px1 === 0.5 && alt.active === 1, alt);
  const dv = await ev(`[defaultVal('shot.sc#0'), defaultVal('shot.px#2'), defaultVal('shot.rot#1'), defaultVal('shot.weights#1'), defaultVal('shot.slants#2')]`);
  chk('defaultVal knows the #i form', JSON.stringify(dv) === '[1,0.5,0,1,0]', dv);

  // ---------- 3: picker stale after a rebuild
  const pop = await ev(`(()=>{ const c = document.querySelector('#controls .pick>.cur'); if(!c) return 'nopick'; c.click();
    const open1 = !!openPop; buildControls(); return {open1, afterRebuild: openPop === null, domPop: document.querySelectorAll('.pop').length}; })()`);
  chk('openPop cleared by buildControls', pop && pop.open1 && pop.afterRebuild && pop.domPop === 0, pop);
  const again = await ev(`(()=>{ const c = document.querySelector('#controls .pick>.cur'); c.click(); const o = !!openPop && !!document.querySelector('.pop'); closePop(); return o; })()`);
  chk('same picker opens at the first click after a rebuild', again === true, again);

  // ---------- 4: zoom label kept by buildTools
  const zoom = await ev(`(()=>{ viewFit(); zoomStep(1); zoomStep(1); zoomStep(1);
    const f = FORMATS.find(x => x.id === state.active);
    const want = () => Math.round(misureVista(f, false).scala * 100) + '%';
    const lab = () => document.querySelector('#bZoom span').textContent;
    const btn = re => [...document.querySelectorAll('#tools button')].find(b => re.test(b.title));
    const out = {z: view.z, before: lab(), want0: want()};
    btn(/^Snap to the margins/).click();
    out.afterSnap = lab(); out.onSnap = document.getElementById('bZoom').classList.contains('on'); out.want1 = want();
    btn(/^On: the mouse wheel/).click();
    out.afterWheel = lab(); out.onWheel = document.getElementById('bZoom').classList.contains('on');
    btn(/^On: the mouse wheel/).click();
    viewFit(); out.fitLab = lab(); out.fitOn = document.getElementById('bZoom').classList.contains('on');
    return out; })()`);
  chk('zoomed in', zoom.z > 1.5, zoom);
  chk('label survives Snap toggle', zoom.afterSnap === zoom.want1 && zoom.afterSnap === zoom.before && zoom.afterSnap !== '100%', zoom);
  chk('zoom button keeps "on" after Snap/Wheel', zoom.onSnap === true && zoom.onWheel === true && zoom.afterWheel === zoom.before, zoom);
  chk('Fit turns it off again', zoom.fitOn === false, zoom);

  res.sample = {lid, gid, sync, zoom};
  return res;
};
