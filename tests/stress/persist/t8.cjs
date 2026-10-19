'use strict';
// 3E New from this pack + overwrite guard.
//  - New asks with a dialog (no window.confirm): Blank new pack / New from this pack / Cancel
//  - both New paths undo in one step (title, images, layouts, Save target, titoloFile)
//  - New from this pack keeps layouts + variants, clears title/category/images/file, version v1.0
//  - Save to the same file with another non-empty title asks: Save as new file / Overwrite / Cancel
//  - silent when the title is unchanged; Save as never asks
//  - titoloFile is set by Open and Save, carried by undo, autosave, and restart (with the sporco flag)
module.exports = async ({ ev, delay, reload, until }) => {
  const res = { checks: {} }; const fails = [];
  const chk = (name, cond, info) => { res.checks[name] = !!cond; if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 300) : '')); };

  const HELP = `window.mkImg = async (name, hue) => { const c = document.createElement('canvas'); c.width = 320 + hue; c.height = 180; const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + hue + ',60%,40%)'; g.fillRect(0, 0, c.width, c.height);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name, { type: 'image/png', lastModified: 1000 + hue }); };
    window.opfsHandle = async name => { const root = await navigator.storage.getDirectory(); return root.getFileHandle(name, { create: true }); };
    window.dlgBtn = label => [...document.querySelectorAll('#dlg .dlg-btns button')].find(b => b.textContent === label);
    window.dlgOpen = () => !document.getElementById('dlg').hidden;
    window.waitDlg = async (ms = 4000) => { const t = performance.now(); while (!dlgOpen()) { if (performance.now() - t > ms) return false; await new Promise(r => setTimeout(r, 10)); } return true; };
    window.waitDone = async (p, ms = 8000) => Promise.race([p.then(() => true), new Promise(r => setTimeout(() => r(false), ms))]);
    window.fileTitle = async h => JSON.parse(await (await h.getFile()).text()).pack.title;
    window.confirmCalled = 0; window.confirm = () => { confirmCalled++; return true; };
    1`;
  await ev(HELP);
  await ev(`(async () => { SHOTS = []; imgShot = null; const fl = []; for (let i = 0; i < 3; i++) fl.push(await mkImg('p' + i + '.png', 20 + i * 60));
      await new Promise(r => addShots(fl, r)); state.pack.title = 'Alpha'; state.pack.category = 'VFX'; state.pack.version = 'v2.3';
      FORMATS.forEach((f, k) => { const S = state.layouts[f.id].shot; S.src = [k % 3, (k + 1) % 3, -1, -1, -1, -1]; });
      state.layouts.unity_cover.band.opacity = 0.37; state.layouts.unity_card.row.titleSize = 0.071;
      variantAdd(); state.pack.title = 'Alpha'; buildControls(); render(); return SHOTS.length; })()`);

  /* ---- Save + guard */
  const s1 = await ev(`(async () => { const h = await opfsHandle('t8-a.json'); fileProgetto = h; nomeProgetto = h.name; titoloFile = '';
      await salvaProgetto(false); return { tf: titoloFile, ft: await fileTitle(h) }; })()`);
  chk('Save sets titoloFile', s1.tf === 'Alpha' && s1.ft === 'Alpha', s1);
  const s2 = await ev(`(async () => { const p = salvaProgetto(false); const done = await waitDone(p); return { done, dlg: dlgOpen() }; })()`);
  chk('same title: silent save, no dialog', s2.done && !s2.dlg, s2);

  /* title changed: dialog, Cancel */
  const g1 = await ev(`(async () => { state.pack.title = 'Beta'; const p = salvaProgetto(false); const open = await waitDlg();
      const txt = open ? document.querySelector('#dlg .dlg').textContent : '';
      const btns = [...document.querySelectorAll('#dlg .dlg-btns button')].map(b => b.textContent + (b.classList.contains('primary') ? '*' : ''));
      dlgBtn('Cancel').click(); const done = await waitDone(p);
      return { open, txt, btns, done, ft: await fileTitle(fileProgetto), tf: titoloFile, dlgGone: !dlgOpen() }; })()`);
  chk('guard dialog shown with both titles', g1.open && /Alpha/.test(g1.txt) && /Beta/.test(g1.txt), g1.txt);
  chk('guard buttons: Save as new file (primary) / Overwrite / Cancel', JSON.stringify(g1.btns) === JSON.stringify(['Save as new file*', 'Overwrite', 'Cancel']), g1.btns);
  chk('Cancel: file untouched, titoloFile unchanged, save finished', g1.done && g1.ft === 'Alpha' && g1.tf === 'Alpha' && g1.dlgGone, g1);

  /* Esc cancels too */
  const g2 = await ev(`(async () => { const p = salvaProgetto(false); await waitDlg(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const done = await waitDone(p); return { done, ft: await fileTitle(fileProgetto) }; })()`);
  chk('Esc cancels, file untouched', g2.done && g2.ft === 'Alpha', g2);

  /* Overwrite */
  const g3 = await ev(`(async () => { const p = salvaProgetto(false); await waitDlg(); dlgBtn('Overwrite').click(); const done = await waitDone(p);
      return { done, ft: await fileTitle(fileProgetto), tf: titoloFile, name: nomeProgetto }; })()`);
  chk('Overwrite: file now holds Beta, titoloFile Beta, same target', g3.done && g3.ft === 'Beta' && g3.tf === 'Beta' && g3.name === 't8-a.json', g3);
  const g3b = await ev(`(async () => { const p = salvaProgetto(false); return { done: await waitDone(p), dlg: dlgOpen() }; })()`);
  chk('after overwrite: silent again', g3b.done && !g3b.dlg, g3b);

  /* Save as new file */
  const g4 = await ev(`(async () => { state.pack.title = 'Gamma'; const h2 = await opfsHandle('t8-b.json'); let asked = 0;
      window.showSaveFilePicker = async () => { asked++; return h2; };
      const old = fileProgetto; const p = salvaProgetto(false); await waitDlg(); dlgBtn('Save as new file').click(); const done = await waitDone(p);
      return { done, asked, newTarget: fileProgetto === h2, oldTitle: await fileTitle(old), newTitle: await fileTitle(h2), tf: titoloFile }; })()`);
  chk('Save as new file: picker asked once, new target, old file kept', g4.done && g4.asked === 1 && g4.newTarget && g4.oldTitle === 'Beta' && g4.newTitle === 'Gamma' && g4.tf === 'Gamma', g4);

  /* Save as (explicit) never asks, even with another title */
  const g5 = await ev(`(async () => { state.pack.title = 'Delta'; const h3 = await opfsHandle('t8-c.json'); window.showSaveFilePicker = async () => h3;
      const p = salvaProgetto(true); const done = await waitDone(p); return { done, dlg: dlgOpen(), tf: titoloFile, ft: await fileTitle(h3) }; })()`);
  chk('Save as: no guard', g5.done && !g5.dlg && g5.tf === 'Delta' && g5.ft === 'Delta', g5);

  /* empty file title / empty current title: no guard */
  const g6 = await ev(`(async () => { titoloFile = ''; state.pack.title = 'Other'; const p = salvaProgetto(false); const done = await waitDone(p); const d1 = dlgOpen();
      state.pack.title = ''; const p2 = salvaProgetto(false); const done2 = await waitDone(p2); return { done, d1, done2, d2: dlgOpen() }; })()`);
  chk('file with no title, or empty current title: no guard', g6.done && !g6.d1 && g6.done2 && !g6.d2, g6);

  /* moved file: NotFound -> Save asks where (1.6.2), no guard involved */
  const g7 = await ev(`(async () => { state.pack.title = 'Delta'; titoloFile = 'Delta'; const h = fileProgetto; const h4 = await opfsHandle('t8-d.json'); let asked = 0;
      h.createWritable = async () => { const e = new Error('gone'); e.name = 'NotFoundError'; throw e; };
      window.showSaveFilePicker = async () => { asked++; return h4; };
      const p = salvaProgetto(false); const done = await waitDone(p); return { done, asked, now: fileProgetto === h4, dlg: dlgOpen() }; })()`);
  chk('moved file: Save asks where (picker once)', g7.done && g7.asked === 1 && g7.now && !g7.dlg, g7);

  /* ---- Open sets titoloFile; undo across Open restores Save target + titoloFile */
  const o1 = await ev(`(async () => { const hA = await opfsHandle('t8-a.json'); const hB = await opfsHandle('t8-b.json');
      fileProgetto = hA; nomeProgetto = hA.name; titoloFile = 'Beta'; firmaSalvata = firmaProgetto(); state.pack.title = 'Beta';
      const u0 = undoStack.length; caricaPresetFile(await hB.getFile(), hB);
      const t = performance.now(); while (aprendoProgetto && performance.now() - t < 20000) await new Promise(r => setTimeout(r, 20));
      const after = { tf: titoloFile, title: state.pack.title, tgt: fileProgetto === hB, steps: undoStack.length - u0 };
      undo(); await new Promise(r => setTimeout(r, 100));
      return { after, back: { tf: titoloFile, tgt: fileProgetto === hA, name: nomeProgetto } }; })()`);
  chk('Open sets titoloFile to the file title', o1.after.tf === 'Gamma' && o1.after.title === 'Gamma' && o1.after.tgt && o1.after.steps === 1, o1.after);
  chk('undo across Open restores Save target and titoloFile', o1.back.tf === 'Beta' && o1.back.tgt && o1.back.name === 't8-a.json', o1.back);

  /* ---- New dialogs */
  const mk = `(async () => { const hA = await opfsHandle('t8-a.json'); SHOTS = []; imgShot = null; const fl = []; for (let i = 0; i < 3; i++) fl.push(await mkImg('q' + i + '.png', 30 + i * 50));
      await new Promise(r => addShots(fl, r)); FORMATS.forEach((f, k) => { state.layouts[f.id].shot.src = [k % 3, (k + 1) % 3, -1, -1, -1, -1]; });
      state.pack.title = 'Zeta'; state.pack.category = 'Fire'; state.pack.version = 'v3.1'; state.layouts.unity_cover.band.opacity = 0.37;
      fileProgetto = hA; nomeProgetto = hA.name; titoloFile = 'Zeta'; firmaSalvata = firmaProgetto(); aggiornaInfoProgetto(firmaSalvata); return 1; })()`;
  await ev(mk);
  const snapIn = `(() => ({ pack: JSON.stringify(state.pack), lay: JSON.stringify(state.layouts), vars: JSON.stringify(state.variants), n: SHOTS.length, main: SHOTS.findIndex(x => x.img === imgShot),
      tgt: !!fileProgetto, name: nomeProgetto, tf: titoloFile, src: JSON.stringify(FORMATS.map(f => state.layouts[f.id].shot.src)) }))()`;
  const b0 = await ev(snapIn);
  const dg = await ev(`(async () => { confirmCalled = 0; const u0 = undoStack.length; document.getElementById('bNew').click(); const open = await waitDlg();
      const btns = [...document.querySelectorAll('#dlg .dlg-btns button')].map(b => b.textContent + (b.classList.contains('primary') ? '*' : ''));
      dlgBtn('Cancel').click(); await new Promise(r => setTimeout(r, 50)); return { open, btns, confirmCalled, steps: undoStack.length - u0, n: SHOTS.length, title: state.pack.title }; })()`);
  chk('New opens dialogo (no window.confirm), Blank is primary', dg.open && dg.confirmCalled === 0 && JSON.stringify(dg.btns) === JSON.stringify(['Blank new pack*', 'New from this pack', 'Cancel']), dg);
  chk('New > Cancel changes nothing', dg.steps === 0 && dg.n === 3 && dg.title === 'Zeta', dg);

  /* New from this pack */
  const nf = await ev(`(async () => { const u0 = undoStack.length; document.getElementById('bNew').click(); await waitDlg(); dlgBtn('New from this pack').click(); await new Promise(r => setTimeout(r, 150));
      const s = ${snapIn}; const tb = document.querySelector('#toast button'); s.steps = undoStack.length - u0; s.toastUndo = !!tb; s.toast = document.getElementById('toast').textContent; return s; })()`);
  const P0 = JSON.parse(b0.pack), P1 = JSON.parse(nf.pack);
  chk('from this pack: title/category empty, version v1.0', P1.title === '' && P1.category === '' && P1.version === 'v1.0', P1);
  chk('from this pack: other pack fields kept', Object.keys(P0).filter(k => !['title', 'category', 'version'].includes(k)).every(k => JSON.stringify(P0[k]) === JSON.stringify(P1[k])));
  chk('from this pack: layouts kept (except panel sources -> main image)', (() => { const a = JSON.parse(b0.lay), b = JSON.parse(nf.lay); Object.values(a).forEach(L => { L.shot.src = L.shot.src.map(v => v < 0 ? v : -1); }); return JSON.stringify(a) === JSON.stringify(b); })());
  chk('from this pack: variants kept (panel sources -> main image)', (() => { const a = JSON.parse(b0.vars), b = JSON.parse(nf.vars); a.forEach(v => Object.values(v.layouts || {}).forEach(L => { if (L.shot && L.shot.src) L.shot.src = L.shot.src.map(x => x < 0 ? x : -1); })); return a.length > 0 && JSON.stringify(a) === JSON.stringify(b); })());
  chk('from this pack: no images, no main, no file, no titoloFile', nf.n === 0 && nf.main === -1 && !nf.tgt && nf.name === '' && nf.tf === '', nf);
  chk('from this pack: one undo step, toast with Undo button', nf.steps === 1 && nf.toastUndo, nf);
  const nu = await ev(`(async () => { undo(); await new Promise(r => setTimeout(r, 150)); return ${snapIn}; })()`);
  chk('undo restores everything in one step', JSON.stringify(nu) === JSON.stringify(b0), { a: nu.n, b: b0.n, tf: nu.tf, tgt: nu.tgt });

  /* Blank new pack */
  const bl = await ev(`(async () => { const u0 = undoStack.length; document.getElementById('bNew').click(); await waitDlg(); dlgBtn('Blank new pack').click(); await new Promise(r => setTimeout(r, 200));
      const s = ${snapIn}; s.steps = undoStack.length - u0; s.toastUndo = !!document.querySelector('#toast button'); return s; })()`);
  chk('blank: empty pack, no images, no file, default layouts', JSON.parse(bl.pack).title === '' && bl.n === 0 && !bl.tgt && bl.tf === '' && JSON.parse(bl.lay).unity_cover.band.opacity !== 0.37, bl);
  chk('blank: one undo step', bl.steps === 1, bl);
  const bu = await ev(`(async () => { undo(); await new Promise(r => setTimeout(r, 150)); return ${snapIn}; })()`);
  chk('blank: undo restores everything', JSON.stringify(bu) === JSON.stringify(b0));

  /* ---- autosave carries titoloFile and sporco; restart keeps both */
  await ev(`(async () => { const hA = await opfsHandle('t8-a.json'); fileProgetto = hA; nomeProgetto = hA.name; titoloFile = 'Zeta'; state.pack.title = 'Zeta'; await salvaProgetto(false);
      ricordaFileProgetto(hA); state.pack.category = 'Fire2'; autoSaveNow(); return 1; })()`);
  await delay(600);
  const au = await ev(`(() => { const a = JSON.parse(localStorage.getItem(AUTOKEY)); return { tf: a.titoloFile, sporco: a.sporco }; })()`);
  chk('autosave carries titoloFile and sporco', au.tf === 'Zeta' && au.sporco === true, au);
  await delay(900);
  await reload();
  await until(() => ev('nomeProgetto === "t8-a.json"'), 'project file resumed', 30000);
  await ev(HELP);
  const rs = await ev(`(async () => { await new Promise(r => setTimeout(r, 400)); const a = JSON.parse(localStorage.getItem(AUTOKEY)); return { tf: titoloFile, mark: document.querySelector('#projInfo b').textContent, a: { tf: a.titoloFile, sporco: a.sporco }, cat: state.pack.category }; })()`);
  chk('restart keeps titoloFile', rs.tf === 'Zeta' && rs.a.tf === 'Zeta', rs);
  chk('restart keeps the unsaved mark (sporco)', /\*$/.test(rs.mark) && rs.a.sporco === true, rs);
  const rg = await ev(`(async () => { state.pack.title = 'Omega'; const p = salvaProgetto(false); const open = await waitDlg(); if (open) dlgBtn('Cancel').click(); await waitDone(p); return { open, ft: await fileTitle(fileProgetto) }; })()`);
  chk('guard still works after restart', rg.open && rg.ft === 'Zeta', rg);

  res.ok = fails.length === 0; res.fails = fails;
  return res;
};
