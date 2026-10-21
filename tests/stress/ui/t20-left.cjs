'use strict';
// Z4 (1.8.0): colonna sinistra. Scheda Pack compatta sotto gli 800 px, righe dei formati con riquadro
// anteprima fisso 72x44, velo solo sulla miniatura dei formati spenti, thumbSize che dallo spento va a 44,
// finestra New pack (due scelte, Invio = New from this pack).
//   node tests/stress/run.cjs tests/stress/ui/t20-left.cjs
//   REAL_PROJECT=<json>  apre prima un progetto vero (solo lettura) per le schermate
const fs = require('node:fs');
module.exports = async ({ev, command, until, delay, capture}) => {
  const out = {ok: true, checks: {}};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const file = process.env.REAL_PROJECT;
  if (file && fs.existsSync(file)) {
    const doc = await command('DOM.getDocument', {depth: -1, pierce: true});
    const find = n => { if (n.attributes) { const i = n.attributes.indexOf('id'); if (i >= 0 && n.attributes[i + 1] === 'fPreset') return n; } for (const c of (n.children || []).concat(n.contentDocument ? [n.contentDocument] : [])) { const r = find(c); if (r) return r; } return null; };
    await ev('toast(""); 1');
    await command('DOM.setFileInputFiles', {files: [file], backendNodeId: find(doc.root).backendNodeId});
    await until(() => ev('/Project opened|could not be read|Older preset/.test(document.getElementById("toast").textContent)'), 'open', 120000);
    await delay(2000);
  }
  await command('Emulation.setFocusEmulationEnabled', {enabled: true});
  const rows = () => ev(`[...document.querySelectorAll('#formats .fmt')].map(e => ({h: Math.round(e.getBoundingClientRect().height), seg: !!e.querySelector('.seg'), id: e.querySelector('canvas.th') && e.querySelector('canvas.th').dataset.fmt}))`);
  const waitDlg = async () => { for (let i = 0; i < 100; i++) { if (await ev(`!!document.querySelector('#dlg .dlg-btns button')`)) return true; await delay(30); } return false; };

  /* ---- 1. righe: stessa altezza, riquadro anteprima fisso */
  await command('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  await delay(700);
  await ev('state.ui.thumb = 72; buildFormats(); 1'); await delay(900);
  const r1 = await rows();
  const plain = [...new Set(r1.filter(r => !r.seg).map(r => r.h))], withSeg = [...new Set(r1.filter(r => r.seg).map(r => r.h))];
  chk('plain rows all the same height (Icon square included)', plain.length === 1 && r1.length >= 8, plain);
  chk('rows with 4K|1080p all the same height', withSeg.length === 1, withSeg);
  const boxes = await ev(`[...new Set([...document.querySelectorAll('#formats canvas.th')].map(c => c.style.width + 'x' + c.style.height))]`);
  chk('one thumbnail box 72x44 for every format', boxes.length === 1 && boxes[0] === '72pxx44px', boxes);
  const sqId = await ev('FORMATS.find(f => sizeOf(f).w === sizeOf(f).h).id');
  const drawn = await ev(`(()=>{ const c = document.querySelector('#formats canvas.th[data-fmt="${sqId}"]'); const g = c.getContext('2d'); const w = c.width, h = c.height;
    const px = x => g.getImageData(x, Math.floor(h/2), 1, 1).data[3];
    return {left: px(2), mid: px(Math.floor(w/2)), right: px(w-3)}; })()`);
  chk('square format is drawn centred inside the box (contain)', drawn.mid > 0 && drawn.left === 0 && drawn.right === 0, drawn);
  const foot = await ev(`(()=>{ const a = document.querySelector('aside.left'); a.scrollTop = a.scrollHeight; const rs = [...document.querySelectorAll('#formats .fmt')]; const last = rs[rs.length-1].getBoundingClientRect(), ft = document.querySelector('.leftfoot').getBoundingClientRect(); a.scrollTop = 0; return Math.round(ft.top - last.bottom); })()`);
  chk('last row clears the foot button', foot >= 12, foot);

  /* ---- 2. unticked + selected: only the thumbnail is dimmed */
  const dim = await ev(`(()=>{ const id = FORMATS[2].id; state.layouts[id].on = false; state.active = id; buildFormats();
    const row = document.querySelector('.fmt.on'); const th = row.querySelector('canvas.th'), nm = row.querySelector('.nm b');
    const other = [...document.querySelectorAll('.fmt:not(.on) canvas.th')].find(c => state.layouts[c.dataset.fmt].on);
    const cs = e => getComputedStyle(e);
    return {selected: row.classList.contains('on'), rowOp: cs(row).opacity, nmOp: cs(nm).opacity, nmColor: cs(nm).color, thOp: +cs(th).opacity, otherOp: +cs(other).opacity, off: row.classList.contains('off')}; })()`);
  chk('unticked selected row: not dimmed, name white', dim.selected && dim.off && dim.rowOp === '1' && dim.nmOp === '1' && dim.nmColor === 'rgb(230, 230, 232)', dim);
  chk('only the thumbnail of the unticked format is dimmed', dim.thOp < 1 && dim.thOp >= 0.5 && dim.otherOp === 1, dim);
  await delay(900);
  const dim2 = await ev(`(()=>{ const id = FORMATS[2].id; const row = [...document.querySelectorAll('.fmt')].find(r => r.querySelector('canvas.th').dataset.fmt === id);
    row.querySelector('input[type=checkbox]').click(); const a = {off: row.classList.contains('off')}; row.querySelector('input[type=checkbox]').click(); a.off2 = row.classList.contains('off'); return a; })()`);
  chk('ticking toggles the dim at once', dim2.off === false && dim2.off2 === true, dim2);
  await ev(`state.layouts[FORMATS[2].id].on = true; buildFormats(); 1`);
  await delay(900);
  await capture('t20-left-1920');

  /* ---- 3. thumbSize: 0 -> 44 -> 72 */
  const steps = await ev(`(()=>{ state.ui.thumb = 0; thumbSize(1); const a = state.ui.thumb; thumbSize(1); const b = state.ui.thumb; thumbSize(-1); thumbSize(-1); const c = state.ui.thumb; thumbSize(-1); const d = state.ui.thumb;
    const noThumbs = document.querySelectorAll('#formats canvas.th').length; state.ui.thumb = 72; buildFormats(); return {a, b, c, d, noThumbs}; })()`);
  chk('thumbSize: off -> 44 -> 72', steps.a === 44 && steps.b === 72, steps);
  chk('thumbSize: 72 -> 44 -> off, then stays off', steps.c === 0 && steps.d === 0 && steps.noThumbs === 0, steps);

  /* ---- 4. order of the card */
  chk('card order Title, Version, Category, Accent', JSON.stringify(await ev(`[...document.querySelectorAll('#packrows [data-path]')].map(e => e.getAttribute('data-path'))`)) === JSON.stringify(['pack.title', 'pack.version', 'pack.category', 'theme.accent']));

  /* ---- 5. compact card at 1280x720 */
  const tall = await ev(`Math.round(document.getElementById('packcard').getBoundingClientRect().height)`);
  await command('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
  await delay(900);
  const c = await ev(`(()=>{ const q = s => document.querySelector(s), b = e => e.getBoundingClientRect();
    const a = b(q('aside.left')), ft = b(q('.leftfoot')), card = b(q('#packcard')), lg = b(q('.pc-logo')), ta = q('#packrows textarea');
    const vis = [...document.querySelectorAll('#formats .fmt')].filter(r => b(r).top >= a.top && b(r).bottom <= ft.top).length;
    const logoBtns = [...document.querySelectorAll('.pc-logo > *')].map(e => Math.round(b(e).top + b(e).height/2));
    return {vh: innerHeight, card: Math.round(card.height), vis, taH: Math.round(b(ta).height), logoH: Math.round(lg.height), logoOneLine: Math.max(...logoBtns) - Math.min(...logoBtns) <= 3,
      hdHidden: getComputedStyle(q('#packcard .pc-hd')).display === 'none', labelsOk: [...document.querySelectorAll('#packcard .row label')].every(l => l.scrollWidth <= l.clientWidth + 1),
      btnTexts: [...document.querySelectorAll('.pc-logo button')].map(x => [x.textContent.trim(), x.scrollWidth <= x.clientWidth + 1])}; })()`);
  chk('window under 800 px: card <= 190 px (was 270-310)', c.vh < 800 && c.card <= 190 && tall >= 250, {c, tall});
  chk('compact: at least 4 format rows visible without scrolling', c.vis >= 4, c.vis);
  chk('compact: title is one line, logo thumb + 3 buttons on one line', c.taH <= 30 && c.logoOneLine && c.logoH <= 34, c);
  chk('compact: no clipped label or button text', c.labelsOk && c.btnTexts.every(x => x[1]), c.btnTexts);
  const focusH = await ev(`(()=>{ const ta = document.querySelector('#packrows textarea'); ta.focus(); const h = Math.round(ta.getBoundingClientRect().height); ta.blur(); return h; })()`);
  chk('compact: title expands while typing', focusH >= 50, focusH);
  await capture('t20-left-1280');

  /* ---- 6. New dialog */
  const u0 = await ev('undoStack.length'), n0 = await ev('JSON.stringify(state.pack)');
  await ev(`document.getElementById('bNew').click(); 1`);
  chk('New opens a dialogo', await waitDlg());
  const dg = await ev(`(()=>{ const q = s => [...document.querySelectorAll(s)], b = e => e.getBoundingClientRect();
    const opts = q('#dlg .newopt'); const act = document.activeElement;
    return {btns: q('#dlg .dlg-btns button').map(x => x.textContent + (x.classList.contains('primary') ? '*' : '')), focus: act && act.textContent, n: opts.length,
      oneLine: opts.every(o => { const s = o.querySelector('span'), n = o.querySelector('b'); return b(s).height < 24 && b(n).height < 24 && s.scrollWidth <= s.clientWidth + 1; }),
      text: opts.map(o => o.textContent), h: Math.round(b(document.querySelector('#dlg .dlg')).height), words: document.querySelector('#dlg .dlg-body').textContent.split(/\\s+/).length}; })()`);
  chk('buttons: Cancel, Blank (secondary), New from this pack (primary)', JSON.stringify(dg.btns) === JSON.stringify(['Cancel', 'Blank new pack', 'New from this pack*']), dg.btns);
  chk('default focus = New from this pack', dg.focus === 'New from this pack', dg.focus);
  chk('two option rows, one line each, short text', dg.n === 2 && dg.oneLine && dg.words <= 40, dg);
  await capture('t20-new-dialog');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); 1`); await delay(150);
  chk('Esc cancels, nothing changed', (await ev('undoStack.length')) === u0 && (await ev('JSON.stringify(state.pack)')) === n0 && !(await ev(`!!document.querySelector('#dlg .dlg-btns button')`)));
  /* Enter = New from this pack (keeps layouts, clears texts) */
  await ev(`state.pack.title = 'Keep me?'; 1`);
  const u1 = await ev('undoStack.length');
  await ev(`document.getElementById('bNew').click(); 1`); await waitDlg();
  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); 1`); await delay(300);
  const en = await ev(`({title: state.pack.title, steps: undoStack.length, toast: document.getElementById('toast').textContent})`);
  chk('Enter = New from this pack (title cleared, one undo step)', en.title === '' && en.steps === u1 + 1 && /same layouts/.test(en.toast), en);
  await ev('undo()'); await delay(200);
  chk('undo brings the pack back', (await ev('state.pack.title')) === 'Keep me?');
  /* Blank still reachable by click */
  await ev(`document.getElementById('bNew').click(); 1`); await waitDlg();
  await ev(`[...document.querySelectorAll('#dlg .dlg-btns button')].find(x => x.textContent === 'Blank new pack').click(); 1`); await delay(300);
  chk('Blank new pack by click works', (await ev('state.pack.title')) === '' && (await ev('SHOTS.length')) === 0);
  await ev('undo()'); await delay(200);

  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  const errs = await ev('qaErrors');
  chk('no page errors', errs.length === 0, errs);
  return out;
};
