'use strict';
// Package 1C: unique format names (YouTube / Fab Thumbnail) and inline rename
// (layers, variants). Run with the stress harness:
//   PORT=495xx node tests/stress/run.cjs tests/stress/ui/t12-names-rename.cjs
// Names that existed before 1C ({platform}_{format}, every other format) are
// compared against a fixed table: the same table holds on the pristine page,
// except the two Thumbnail entries marked NEW.
module.exports = async ({ ev, command, delay, log }) => {
  const bad = [];
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(m + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); };
  const yes = (c, m) => { if (!c) bad.push(m); };
  const tab = t => ev(`(()=>{ if(typeof tabOf==='function') { activeTab = tabOf(${JSON.stringify(t)}); openSecs[${JSON.stringify(t)}] = true; } buildControls(); return 1; })()`);
  const KEY = (k) => `(()=>{ const i = document.querySelector('#controls input.inl'); if(!i) return 'gone';
    i.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(k)}, bubbles: true, cancelable: true})); return 'ok'; })()`;

  // ---- names
  const names = await ev(`(()=>{
    const out = {};
    const run = (pat, folder) => { state.naming.pattern = pat; state.naming.folder = folder;
      out[pat + '|' + folder] = FORMATS.map(f => folderFor(f, state.pack, 1) + fileNameFor(f, state.pack, 1)); };
    state.pack.title = 'Test Pack';
    run('{format}', '{title}'); run('{platform}_{format}', '{title}'); run('{platform}_{format}_{w}x{h}', '');
    run('{format}_{index}', '{platform}'); run('{title}', '');
    state.naming.pattern = '{format}'; state.naming.folder = '{title}';
    return out; })()`);
  const base = ['Cover', 'Asset page', 'Card', 'Icon', 'Social'].map(x => x.replace(' ', '_'));
  const def = names['{format}|{title}'];
  eq(def, base.map(x => 'Test_Pack/' + x + '.png').concat(['Test_Pack/YouTube_Thumbnail.png', 'Test_Pack/Fab_Thumbnail.png', 'Test_Pack/Gallery.png']), 'default names (NEW: YouTube_/Fab_Thumbnail)');
  yes(new Set(def).size === def.length, 'default names unique');
  eq(names['{platform}_{format}|{title}'], ['Unity_Cover', 'Unity_Asset_page', 'Unity_Card', 'Unity_Icon', 'Unity_Social', 'YouTube_Thumbnail', 'Fab_Thumbnail', 'Fab_Gallery'].map(x => 'Test_Pack/' + x + '.png'), '{platform}_{format} unchanged');
  eq(names['{platform}_{format}_{w}x{h}|'], ['Unity_Cover_1950x1300', 'Unity_Asset_page_3840x2160', 'Unity_Card_420x280', 'Unity_Icon_160x160', 'Unity_Social_1200x630', 'YouTube_Thumbnail_1920x1080', 'Fab_Thumbnail_1920x1080', 'Fab_Gallery_1920x1080'].map(x => x + '.png'), '{platform}_{format}_{w}x{h} unchanged');
  eq(names['{title}|'].length, 8, 'title pattern count');
  yes(new Set(names['{format}_{index}|{platform}']).size === 8, '{format}_{index} names unique');

  // ---- preflight: no duplicate error by default, finding carries the format id
  const pf = await ev(`(()=>{
    FORMATS.forEach(f => state.layouts[f.id].on = true);
    const t = preflight();
    return {dup: t.filter(x => /more than one file/.test(x.testo)).length,
            allId: t.every(x => typeof x.id === 'string' && typeof x.formato === 'string')}; })()`);
  eq(pf.dup, 0, 'no "more than one file" error with default naming');
  yes(pf.allId, 'preflight entries have formato and id');
  // a real duplicate is still reported
  const dup = await ev(`(()=>{ state.naming.pattern = 'same'; state.naming.folder = '';
    const n = preflight().filter(x => /more than one file/.test(x.testo)).length;
    state.naming.pattern = '{format}'; state.naming.folder = '{title}'; return n; })()`);
  yes(dup >= 1, 'real duplicates are still reported');

  // ---- preflight line for the YouTube thumbnail jumps to YouTube (not Fab)
  const jump = await ev(`(()=>{
    state.active = 'unity_cover';
    const t = [{formato: nomeFormato(FORMATS.find(f => f.id === 'yt_thumb')), id: 'yt_thumb', tipo: 'errore', testo: 'probe YT'},
               {formato: nomeFormato(FORMATS.find(f => f.id === 'fab_thumb')), id: 'fab_thumb', tipo: 'nota', testo: 'probe Fab'}];
    PREVOLO = {quando: Date.now(), trovati: t, accettate: 0};
    preflightDialogo();
    const rows = [...document.querySelectorAll('#dlg .pf-row')];
    const yt = rows.find(r => /probe YT/.test(r.textContent)), fab = rows.find(r => /probe Fab/.test(r.textContent));
    const res = {labels: rows.map(r => r.textContent)};
    yt.click(); res.afterYT = state.active;
    state.active = 'unity_cover'; fab.click(); res.afterFab = state.active;
    const hd = document.getElementById('dlg'); if(hd._chiudi) hd._chiudi(null);
    state.active = 'unity_cover'; PREVOLO = null; return res; })()`);
  eq(jump.labels, ['YouTube Thumbnail: probe YT', 'Fab Thumbnail: probe Fab'], 'preflight line labels');
  eq(jump.afterYT, 'yt_thumb', 'clicking the YouTube line opens YouTube');
  eq(jump.afterFab, 'fab_thumb', 'clicking the Fab line opens Fab');

  // ---- layer rename: dblclick, type, Enter = one undo step; Esc = nothing
  await ev(`(()=>{ state.active = 'unity_cover'; layerAdd('text'); return 1; })()`);
  await tab('Layers');
  const lay0 = await ev(`(()=>{ const l = layersOf(state.layouts.unity_cover).slice(-1)[0];
    return {id: l.id, name: l.name, undo: undoStack.length}; })()`);
  const dbl = sel => ev(`(()=>{ const n = [...document.querySelectorAll('#controls .lname')].find(x => x.textContent.indexOf(${JSON.stringify(sel)}) === 0);
    if(!n) return 'no .lname'; n.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
    const i = n.querySelector('input.inl'); return i ? (document.activeElement === i ? 'focus' : 'nofocus') : 'no input'; })()`);
  const typeIn = (txt, key) => ev(`(()=>{ const i = document.querySelector('#controls input.inl'); if(!i) return 'gone';
    i.value = ${JSON.stringify(txt)};
    i.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, bubbles: true, cancelable: true})); return 'ok'; })()`);
  eq(await dbl(lay0.name), 'focus', 'dblclick turns the layer name into a focused field');
  // shortcuts typed in the field do nothing
  const before = await ev(`JSON.stringify(snapState())`);
  const uBefore = await ev(`undoStack.length`);
  for (const k of ['l', 'c', 'g', 'Delete', 'Backspace', 'z']) await ev(KEY(k));
  eq(await ev(`JSON.stringify(snapState()) === ${JSON.stringify(before)} && undoStack.length`), uBefore, 'typing L/C/G/Delete/Z in the field fires no shortcut');
  yes(await ev(`!!document.querySelector('#controls input.inl')`), 'field still open after those keys');
  // Esc
  eq(await typeIn('Should not stick', 'Escape'), 'ok', 'Esc sent');
  eq(await ev(`({name: layersOf(state.layouts.unity_cover).slice(-1)[0].name, undo: undoStack.length, field: !!document.querySelector('#controls input.inl')})`),
     { name: lay0.name, undo: lay0.undo, field: false }, 'Esc leaves the name and the history unchanged');
  yes(await ev(`[...document.querySelectorAll('#controls .lname')].some(x => x.textContent.indexOf(${JSON.stringify(lay0.name)}) === 0)`), 'Esc restores the label');
  // Enter
  eq(await dbl(lay0.name), 'focus', 'second dblclick');
  await typeIn('Hero title', 'Enter');
  eq(await ev(`({name: layersOf(state.layouts.unity_cover).slice(-1)[0].name, undo: undoStack.length})`), { name: 'Hero title', undo: lay0.undo + 1 }, 'Enter renames in exactly one undo step');
  yes(await ev(`[...document.querySelectorAll('#controls .lname')].some(x => x.textContent.indexOf('Hero title') === 0)`), 'new name shown');
  await ev('undo(); 1');
  eq(await ev(`layersOf(state.layouts.unity_cover).slice(-1)[0].name`), lay0.name, 'one undo restores the old name');
  await ev('redo(); 1');
  // empty / unchanged do not commit
  const u1 = await ev('undoStack.length');
  await dbl('Hero title'); await typeIn('   ', 'Enter');
  await dbl('Hero title'); await typeIn('Hero title', 'Enter');
  eq(await ev('undoStack.length'), u1, 'empty or unchanged names add no undo step');
  // blur commits
  await dbl('Hero title');
  await ev(`(()=>{ const i = document.querySelector('#controls input.inl'); i.value = 'Blurred'; i.dispatchEvent(new FocusEvent('blur')); return 1; })()`);
  eq(await ev(`layersOf(state.layouts.unity_cover).slice(-1)[0].name`), 'Blurred', 'blur commits');
  eq(await ev('undoStack.length'), u1 + 1, 'blur commit = one step');

  // ---- real mouse double click (first click rebuilds the list), real keys
  await ev(`(()=>{ state.active = 'unity_cover'; layerAdd('text'); return 1; })()`);
  await tab('Layers');
  const where = () => ev(`(()=>{ const n = document.querySelector('#controls .lname'); n.scrollIntoView({block: 'center'});
    const r = n.getBoundingClientRect(), f = window.frameElement.getBoundingClientRect();
    return {x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2}; })()`);
  let pos = await where();
  const uMouse = await ev('undoStack.length');
  const mouse = (t, c) => command('Input.dispatchMouseEvent', {type: t, x: pos.x, y: pos.y, button: 'left', clickCount: c});
  await mouse('mousePressed', 1); await mouse('mouseReleased', 1); pos = await where();
  await mouse('mousePressed', 2); await mouse('mouseReleased', 2); await delay(200);
  yes(await ev(`document.activeElement.className === 'inl'`), 'real double click opens the focused field');
  await command('Input.insertText', {text: 'Typed for real'});
  await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
  await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
  await delay(200);
  eq(await ev(`({n: document.querySelector('#controls .lname').textContent, u: undoStack.length - ${uMouse}})`), {n: 'Typed for real', u: 1}, 'real double click + typing + Enter = one step');

  // ---- variants: rename in place via the "name" button
  await ev(`(()=>{ variantAdd(); return 1; })()`);
  await tab('Variants');
  await ev(`(()=>{ const s = document.querySelector('#controls .sec[data-title="Variants"]'); if(s && !s.classList.contains('open')) s.querySelector('.hd').click(); return 1; })()`);
  const v0 = await ev(`({n: state.variants.length, name: state.variants[state.variants.length - 1].name, undo: undoStack.length})`);
  const vi = v0.n - 1;
  const vr = await ev(`(()=>{ const b = document.querySelector('#controls [data-variant="${vi}"]'); if(!b) return 'no button';
    b.parentNode.querySelector('button[title="Rename this variant"]').click();
    const i = document.querySelector('#controls input.inl'); return i ? (document.activeElement === i ? 'focus' : 'nofocus') : 'no input'; })()`);
  eq(vr, 'focus', 'variant name button turns into a field');
  await typeIn('Night cover', 'Enter');
  eq(await ev(`({name: state.variants[${vi}].name, undo: undoStack.length})`), { name: 'Night cover', undo: v0.undo + 1 }, 'variant renamed in one step');
  await ev('undo(); 1');
  eq(await ev(`state.variants[${vi}] && state.variants[${vi}].name`), v0.name, 'undo restores the variant name');
  await ev('redo(); 1');
  // Esc on a variant
  await ev(`(()=>{ const b = document.querySelector('#controls [data-variant="${vi}"]'); b.parentNode.querySelector('button[title="Rename this variant"]').click(); return 1; })()`);
  await typeIn('zzz', 'Escape');
  eq(await ev(`state.variants[${vi}].name`), 'Night cover', 'Esc keeps the variant name');
  // variantRename(i) without an element finds the button itself
  await ev(`variantRename(${vi}); 1`);
  yes(await ev(`!!document.querySelector('#controls input.inl')`), 'variantRename(i) alone opens the field');
  await ev(KEY('Escape'));

  await ev(`state.naming.pattern = '{format}'; state.naming.folder = '{title}'; 1`);
  const errs = await ev('window.qaErrors');
  return { ok: bad.length === 0 && !errs.length, bad, errs };
};
