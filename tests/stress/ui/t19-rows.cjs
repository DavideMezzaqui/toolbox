'use strict';
// Z3b: pannello destro, sezioni e righe. Una freccia sola sui selettori, nessuna etichetta a capo a 1920,
// il controllo prima dell'export si apre in una finestra, le note accettate restano nascoste dopo aver
// riaperto il lavoro, il blocco del pannello scelto resta in vista, HEX senza "copied" sul doppio clic.
//   node tests/stress/run.cjs tests/stress/ui/t19-rows.cjs
module.exports = async ({ev, evaluate, command, delay, until, reload, capture}) => {
  const out = {ok: true, checks: {}};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const off = () => evaluate('(()=>{const r=[...document.querySelectorAll("iframe")].find(f=>/store/.test(f.src||f.name||f.id));const b=r.getBoundingClientRect();return {x:b.left,y:b.top}})()');
  const click = async (x, y, n) => {
    const o = await off();
    for (let c = 1; c <= (n || 1); c++) for (const t of ['mousePressed', 'mouseReleased'])
      await command('Input.dispatchMouseEvent', {type: t, x: x + o.x, y: y + o.y, button: 'left', clickCount: c});
  };
  const open1 = async (tab, title) => {
    await ev(`(()=>{ SECTIONS.forEach(s=> openSecs[s.t] = (s.t === ${JSON.stringify(title)})); activeTab = ${JSON.stringify(tab)}; secFilter=''; buildControls(); return 1; })()`);
    await delay(250);
  };
  // immagini finte, per avere un'immagine sulla tela
  const aggiungiImmagini = () => ev(`(async()=>{
    const mk = async (n, h) => { const c = document.createElement('canvas'); c.width = 960; c.height = 540;
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + h + ',50%,30%)'; g.fillRect(0, 0, 960, 540);
      g.fillStyle = 'hsl(' + (h + 60) + ',70%,60%)'; g.fillRect(300, 150, 360, 240);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], n + '.png', {type: 'image/png', lastModified: h}); };
    const files = []; for (const [n, h] of [['a', 20], ['b', 150], ['c', 260]]) files.push(await mk(n, h));
    await new Promise(r => addShots(files, r)); return SHOTS.length; })()`);
  await aggiungiImmagini();
  await ev(`state.active = 'unity_cover'; buildFormats(); 1`);

  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await command('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await delay(600);
    const tag = w + 'x' + h;

    // ---- etichette: nessuna va a capo (righe costruite una per una, condizioni ignorate)
    const wrapped = await ev(`(()=>{
      const box = document.getElementById('controls');
      const host = document.createElement('div'); host.className = 'sec open'; host.style.cssText = 'position:absolute;left:10px;right:10px;top:0;visibility:hidden';
      const bd = document.createElement('div'); bd.className = 'bd'; host.appendChild(bd);
      const bad = [], seen = {};
      const skip = ['group','alignpad','layerlist','panels','swatches','gradsets','preflight','lastexport','exportdir','variants','note'];
      const check = (r, src)=>{
        if(!r || skip.indexOf(r.type) >= 0) return;
        let el; try{ el = makeRow(r); }catch(e){ return; }
        if(!host.isConnected) box.appendChild(host);
        bd.appendChild(el);
        const lb = el.querySelector(':scope > label');
        if(lb){
          const lh = parseFloat(getComputedStyle(lb).lineHeight) || 15;
          if(lb.getBoundingClientRect().height > lh*1.5 && !seen[src + r.l]){ seen[src + r.l] = 1; bad.push(src + ': ' + r.l); }
        }
        bd.removeChild(el);
      };
      SECTIONS.forEach(s=> s.rows.forEach(r=> check(r, s.t)));
      ['shape','text','grid'].forEach(t=>{
        layerAdd(t);
        const lays = layersOf(state.layouts[state.active]), lay = lays[lays.length-1];
        if(t === 'shape') ['rect','cut','slant','frame','bars','corner','cross'].forEach(k=>{ lay.kind = k; layerRows(lay).forEach(r=> check(r, 'layer:' + k)); });
        else layerRows(lay).forEach(r=> check(r, 'layer:' + t));
        layerDelete(lay.id);
      });
      if(host.isConnected) box.removeChild(host);
      return bad; })()`);
    chk('no wrapped labels ' + tag, wrapped.length === 0, wrapped);

    // ---- nessun testo sotto 10 px nel pannello (sezioni aperte, tre schede)
    const tiny = await ev(`(()=>{
      const bad = [];
      ['design','image','pack'].forEach(tb=>{
        SECTIONS.forEach(s=> openSecs[s.t] = true); activeTab = tb; buildControls();
        document.querySelectorAll('#controls .sec .bd *').forEach(e=>{
          if(!e.childNodes.length) return;
          const t = [...e.childNodes].filter(n=> n.nodeType === 3 && n.textContent.trim()).length;
          if(t && parseFloat(getComputedStyle(e).fontSize) < 10) bad.push(e.className || e.tagName);
        });
      });
      return [...new Set(bad)]; })()`);
    chk('no text under 10px ' + tag, tiny.length === 0, tiny);

    // ---- selettori: una sola freccia, stessa altezza dei menu a tendina
    await open1('image', 'Screenshot');
    const sel = await ev(`(()=>{
      const cars = [...document.querySelectorAll('#controls .pick .car')];
      const cur = document.querySelector('#controls .pick > .cur');
      const se = document.querySelector('#controls .row select');
      return {n: cars.length, texts: cars.map(c=> c.textContent), bg: cars.length ? getComputedStyle(cars[0]).backgroundImage.slice(0, 12) : '',
        curH: cur ? Math.round(cur.getBoundingClientRect().height) : 0, selH: se ? Math.round(se.getBoundingClientRect().height) : 0,
        selBg: se ? getComputedStyle(se).backgroundImage.slice(0, 12) : '', selApp: se ? getComputedStyle(se).appearance : '',
        title: cur ? cur.title : '' , val: (()=>{ const v = document.querySelector('#controls input.val'); return v ? Math.round(v.getBoundingClientRect().height) : 0; })(),
        valBorder: (()=>{ const v = document.querySelector('#controls input.val'); return v ? getComputedStyle(v).borderTopWidth : ''; })()}; })()`);
    chk('pickers drawn: ' + tag, sel.n > 0 && sel.texts.every(t => t === '') && /url/.test(sel.bg), sel);
    chk('picker and select same height ' + tag, sel.curH === sel.selH && sel.curH >= 24, [sel.curH, sel.selH]);
    chk('select has the same chevron ' + tag, /url/.test(sel.selBg) && /none/.test(sel.selApp));
    chk('picker tooltip carries the full name ' + tag, /\.png|main image|\(none\)/.test(sel.title) || sel.title.length > 3, sel.title);
    chk('number field boxed ' + tag, parseFloat(sel.valBorder) > 0, sel.valBorder);
    chk('single panel has no nested frame ' + tag, await ev(`(()=>{ const b = document.querySelector('#controls .pblk'); return !!b && b.classList.contains('solo') && parseFloat(getComputedStyle(b).borderTopWidth) === 0; })()`));

    // ---- intestazioni di sezione: stesso sfondo, la tinta resta sull'icona
    const heads = await ev(`(()=>{
      SECTIONS.forEach(s=> openSecs[s.t] = false); activeTab = 'design'; buildControls();
      const bg = [...document.querySelectorAll('#controls .sec>.hd')].filter(h=> h.offsetParent).map(h=> getComputedStyle(h).backgroundColor);
      const ic = [...document.querySelectorAll('#controls .sec>.hd>svg.ic')].filter(h=> h.parentNode.offsetParent).map(h=> getComputedStyle(h).color);
      openSecs['Colours'] = true; buildControls();
      const open = getComputedStyle(document.querySelector('#controls .sec.open>.hd')).backgroundColor;
      return {bg: [...new Set(bg)], icons: new Set(ic).size, open}; })()`);
    chk('section headers one neutral background ' + tag, heads.bg.length === 1, heads);
    chk('section icons keep a tint ' + tag, heads.icons > 3, heads.icons);
    chk('open header lighter ' + tag, heads.open !== heads.bg[0], heads);

    // ---- campioni di gradiente: l'ultima riga arriva al bordo destro
    await open1('design', 'Colours');
    const gr = await ev(`(()=>{
      const box = document.querySelector('#controls .grads'); const r = box.getBoundingClientRect();
      const rows = {}; [...box.children].forEach(b=>{ const q = b.getBoundingClientRect(); (rows[Math.round(q.top)] = rows[Math.round(q.top)] || []).push(q); });
      const ks = Object.keys(rows).map(Number).sort((a,b)=> a-b);
      const lastRow = rows[ks[ks.length-1]];
      return {rows: ks.length, counts: ks.map(k=> rows[k].length), gap: Math.round(r.right - Math.max(...lastRow.map(q=> q.right))), gapFirst: Math.round(r.right - Math.max(...rows[ks[0]].map(q=> q.right))), n: box.children.length}; })()`);
    chk('gradient grid fills every row ' + tag, gr.gap <= 1 && gr.gapFirst <= 1, gr);

    // ---- Pack data: Brand e Badges, titolo versione e categoria stanno a sinistra
    await open1('pack', 'Pack data');
    const pk = await ev(`(()=>({paths: [...document.querySelectorAll('#controls .sec[data-title="Pack data"] [data-path]')].map(e=> e.getAttribute('data-path')),
      note: (document.querySelector('#controls .sec[data-title="Pack data"] .hint')||{}).textContent,
      card: [...document.querySelectorAll('#packrows [data-path]')].map(e=> e.getAttribute('data-path'))}))()`);
    chk('Pack data keeps brand + badges ' + tag, JSON.stringify(pk.paths) === JSON.stringify(['pack.brand', 'pack.badges']), pk.paths);
    chk('Pack data note ' + tag, /Title, version and category are in the Pack card on the left/.test(pk.note || ''), pk.note);
    chk('card order Title, Version, Category ' + tag, pk.card.slice(0, 3).join() === 'pack.title,pack.version,pack.category', pk.card);

    // ---- Export: cartella senza taglio
    await open1('pack', 'Export');
    const ed = await ev(`(()=>{ const e = document.querySelector('#controls .expdir'); const cs = getComputedStyle(e);
      return {ws: cs.whiteSpace, fits: e.scrollWidth <= e.clientWidth + 1, h: Math.round(e.getBoundingClientRect().height)}; })()`);
    chk('export folder status wraps, not cut ' + tag, ed.ws === 'normal' && ed.fits, ed);
  }
  await command('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  await delay(500);

  // ---- testi vecchi spariti, parole di prima ancora trovabili
  const strs = await ev(`(()=>{
    const labels = []; PARTS.forEach(p=> (p.rows||[]).forEach(r=> { if(r.p) labels.push([r.p, r.l]); }));
    const all = {}; labels.forEach(([p, l])=> all[p] = l);
    return {gap: all['shot.gap'], grad: all['accent.gradLink'], brand: all['row.itemFont'], tipA: TIP_PATH['accent.gradLink'], tipB: TIP_PATH['badges.gradLink'], tipGap: TIP_PATH['shot.gap'], tipItem: TIP_PATH['row.itemFont'],
      reset: (THEME_SECTION.rows.find(r=> r.act === 'resetAccent')||{}).text, note: EXPORT_SECTION.note}; })()`);
  chk('labels shortened', strs.gap === 'Panel gap' && strs.grad === 'Theme gradient' && strs.brand === 'Brand font', strs);
  chk('tooltips keep the old words (search)', /Use theme gradient/.test(strs.tipA) && /Use theme gradient/.test(strs.tipB) && /Gap between panels/.test(strs.tipGap) && /Category\/brand font/.test(strs.tipItem), strs);
  chk('stale strings fixed', !/Theme section/.test(strs.tipA + strs.tipB) && !/under Naming/.test(strs.note) && strs.reset === 'Back to default colour', strs);
  await ev(`vaiScheda('design'); secFilter = 'category/brand'; riempiTutte(); applyFilter(); 1`);
  chk('search still finds the renamed brand rows', await ev(`[...document.querySelectorAll('#controls .sec')].some(s=> s.dataset.title === 'Text row' && s.style.display !== 'none')`));
  await ev(`secFilter = ''; buildControls(); 1`);

  // ---- tabella dei pesi: l'ultima riga non ha bordo
  const sz = await ev(`(async()=>{ const p = sizeCheck(); await new Promise(r=> setTimeout(r, 300)); await p;
    const t = document.querySelector('#dlg .sztab'); if(!t) return null;
    const rows = [...t.querySelectorAll('tr')];
    const last = rows[rows.length-1].querySelector('td'), first = rows[1].querySelector('td');
    const r = {last: getComputedStyle(last).borderBottomWidth, first: getComputedStyle(first).borderBottomWidth};
    document.getElementById('dlg')._chiudi(null); return r; })()`);
  chk('size table: last row without border', sz && parseFloat(sz.last) === 0 && parseFloat(sz.first) > 0, sz);

  // ---- controllo prima dell'export: finestra, righe, un clic porta al formato, Accept
  await ev(`(()=>{ state.pack.title = ''; const L = state.layouts.unity_icon; L.on = true; L.row.on = true; L.badges.on = true;
    state.layouts.youtube_thumb && (state.layouts.youtube_thumb.on = true); buildFormats(); buildControls(); render(); return 1; })()`);
  await open1('pack', 'Export');
  const btn = await ev(`(()=>{ const b = [...document.querySelectorAll('#controls button')].find(x=> /Check before exporting/.test(x.textContent)); const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
  await click(btn.x, btn.y);
  await until(() => ev(`!document.getElementById('dlg').hidden && !!document.querySelector('#dlg .pf-row')`), 'preflight dialog', 20000);
  await delay(300);
  await capture('t19-preflight-dialog');
  const dl = await ev(`(()=>({ title: document.querySelector('#dlg h3').textContent,
    rows: [...document.querySelectorAll('#dlg .pf-row')].map(r=> ({cls: r.className, dot: getComputedStyle(r.querySelector('.pf-dot')).backgroundColor, txt: r.textContent, go: r.classList.contains('go'), acc: !!r.querySelector('.pf-acc')})),
    summary: (document.querySelector('#controls .pfsum span:not(.pf-dot)')||{}).textContent,
    toast: document.getElementById('toast').classList.contains('on') }))()`);
  chk('preflight opens a dialog', /Check before exporting/.test(dl.title) && dl.rows.length >= 2, dl);
  chk('one line per issue, red for problem, amber for note', dl.rows.some(r => /bad/.test(r.cls)) && dl.rows.some(r => /warn/.test(r.cls)) && new Set(dl.rows.map(r => r.dot)).size >= 2, dl.rows);
  chk('notes can be accepted, problems cannot', dl.rows.filter(r => /bad/.test(r.cls)).every(r => !r.acc) && dl.rows.filter(r => /warn/.test(r.cls)).every(r => r.acc), dl.rows);
  chk('one-line summary in the Export section', /problem/.test(dl.summary || ''), dl.summary);
  // clic su una riga con formato = si va a quel formato
  const goRow = await ev(`(()=>{ const r = [...document.querySelectorAll('#dlg .pf-row.go')][0]; if(!r) return null; const b = r.querySelector('.pf-txt').getBoundingClientRect(); return {x: b.left + 20, y: b.top + b.height/2, name: r.querySelector('b').textContent}; })()`);
  chk('a line goes to its format', !!goRow, goRow);
  if (goRow) {
    await ev(`state.active = FORMATS.find(f=> nomeFormato(f) !== ${JSON.stringify(goRow.name.replace(/: $/, ''))}).id; buildFormats(); 1`);
    await click(goRow.x, goRow.y);
    await delay(300);
    const now = await ev(`({a: state.active, name: nomeFormato(FORMATS.find(f=> f.id===state.active)), open: !document.getElementById('dlg').hidden})`);
    chk('click closes the dialog and selects the format', goRow.name.indexOf(now.name) === 0 && !now.open, [now, goRow]);
  }
  // Accept
  await ev(`state.pack.title = 'Test Pack'; preflightRun(); 1`);
  await delay(300);
  const u0 = await ev('undoStack.length');
  const before = await ev(`PREVOLO.trovati.filter(x=> x.tipo === 'nota').length`);
  const acc = await ev(`(()=>{ const b = document.querySelector('#dlg .pf-acc'); if(!b) return null; b.click(); return 1; })()`);
  await delay(400);
  const after = await ev(`({notes: PREVOLO.trovati.filter(x=> x.tipo === 'nota').length, acc: PREVOLO.accettate, list: state.export.accepted, steps: undoStack.length, dlgOpen: !document.getElementById('dlg').hidden,
    sum: (document.querySelector('#controls .pfsum span:not(.pf-dot)')||{}).textContent})`);
  chk('Accept hides the note and counts it', !!acc && after.notes === before - 1 && after.acc === 1 && after.list.length === 1 && /1 accepted/.test(after.sum), after);
  chk('Accept is one undo step', after.steps === u0 + 1, [u0, after.steps]);
  await ev(`document.getElementById('dlg')._chiudi && document.getElementById('dlg')._chiudi(null); 1`);
  // rifatto il controllo: la nota accettata non c'e'
  const again = await ev(`(()=>{ const t = preflight(); return {notes: t.filter(x=> x.tipo === 'nota' && x.chiave).length, acc: PREVOLO.accettate}; })()`);
  chk('accepted note stays hidden on a new check', again.acc === 1 && again.notes === before - 1, again);
  // si salva nel progetto: testo del progetto, riaperto
  const proj = await ev(`(async()=>{ const t = await testoProgetto(); const o = JSON.parse(t); return {acc: o.export.accepted}; })()`);
  chk('accepted notes travel in the project', Array.isArray(proj.acc) && proj.acc.length === 1, proj);
  // ricaricata la pagina (salvataggio automatico)
  await ev(`autoSaveNow(); 1`);
  await reload();
  await delay(1500);
  const rl = await ev(`(()=>{ const t = preflight(); return {acc: PREVOLO.accettate, list: state.export.accepted}; })()`);
  chk('accepted note hidden after reload', rl.acc === 1 && Array.isArray(rl.list), rl);
  // un progetto senza "accepted" non eredita quelli di prima
  const inh = await ev(`(async()=>{ const o = JSON.parse(await testoProgetto()); delete o.export.accepted; o.images = [];
    const f = new File([JSON.stringify(o)], 'noacc.json', {type: 'application/json'});
    await new Promise(r=> { caricaPresetFile(f, null); const t = setInterval(()=>{ if(!aprendoProgetto){ clearInterval(t); r(); } }, 100); });
    const t = preflight(); return {acc: PREVOLO.accettate, list: state.export.accepted}; })()`);
  chk('opening a project without accepted notes clears them', inh.acc === 0 && !Array.isArray(inh.list), inh);

  // ---- layers: placement in due colonne, anteprima del livello
  await ev(`state.active = 'unity_cover'; buildFormats(); layerAdd('shape'); 1`);
  await open1('design', 'Layers');
  const ly = await ev(`(()=>{ const col = document.querySelector('#controls .acol'); const bs = [...col.children].map(b=> b.getBoundingClientRect());
    const xs = [...new Set(bs.map(b=> Math.round(b.left)))]; const hint = document.querySelector('#controls .ahint');
    return {cols: xs.length, n: bs.length, hintPx: parseFloat(getComputedStyle(hint).fontSize), clipped: [...col.children].filter(b=> b.scrollWidth > b.clientWidth + 1).map(b=> b.textContent),
      icon: Math.round(document.querySelector('#controls .layrow svg.ic').getBoundingClientRect().width)}; })()`);
  chk('placement buttons in two columns, labels not cut', ly.cols === 2 && ly.n >= 5 && ly.clipped.length === 0, ly);
  chk('layer row icons 13px, hint >= 11px', ly.icon >= 12 && ly.icon <= 13 && ly.hintPx >= 11, ly);
  await ev(`layersOf(state.layouts[state.active]).length = 0; state.sel = 'row'; buildControls(); 1`);

  await aggiungiImmagini();
  // ---- pannello scelto dalla tela: il suo blocco resta in vista sotto la testata
  await ev(`(()=>{ state.active = 'unity_cover'; buildFormats(); const S = state.layouts.unity_cover.shot; S.panels = 4; S.active = 0; state.sel = 'row'; render(); return 1; })()`);
  await open1('image', 'Screenshot');
  const pt = await ev(`(()=>{ let cx = PW*0.9, cy = PH*0.4; const r = cv.getBoundingClientRect();
    return {i: pannelloSotto(cx, cy), x: r.left + cx/PW*r.width, y: r.top + cy/PH*r.height}; })()`);
  await click(pt.x, pt.y);
  await delay(500);
  const vis = await ev(`(()=>{ const box = document.getElementById('controls'), head = box.querySelector('.phead').getBoundingClientRect(), cr = box.getBoundingClientRect();
    const b = document.querySelector('#controls .pblk.on'); const r = b.getBoundingClientRect();
    return {act: pannelloAttivo(state.layouts.unity_cover.shot), title: b.querySelector('.ph').textContent, top: Math.round(r.top), headBottom: Math.round(head.bottom), bottom: Math.round(r.bottom), box: Math.round(cr.bottom)}; })()`);
  chk('clicked panel selected', vis.act === pt.i && pt.i >= 2, [vis.act, pt.i]);
  chk('selected panel block visible below the head', vis.top >= vis.headBottom - 1 && vis.top < vis.box - 40, vis);
  await capture('t19-panel-visible');

  // ---- HEX: un doppio clic non fa comparire "copied", il campo ha l'altezza del bottone
  await ev(`state.layouts.unity_cover.shot.panels = 1; buildControls(); 1`);
  await open1('design', 'Colours');
  await ev(`window.__t = []; const _t = toast; toast = function(m, o){ __t.push(String(m)); return _t.apply(this, arguments); }; 1`);
  const hx = await ev(`(()=>{ const b = document.querySelector('#controls button.hex'); const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: Math.round(r.height), row: Math.round(b.parentNode.getBoundingClientRect().height)}; })()`);
  await click(hx.x, hx.y, 2);
  await delay(600);
  const ed2 = await ev(`(()=>{ const i = document.querySelector('#controls input.inl'); return {has: !!i, h: i ? Math.round(i.getBoundingClientRect().height) : 0, row: i ? Math.round(i.parentNode.getBoundingClientRect().height) : 0, toasts: __t.slice()}; })()`);
  chk('double-click opens the editor without a copy toast', ed2.has && !ed2.toasts.some(t => /copied/.test(t)), ed2);
  chk('editor same height as the button, row does not grow', ed2.h === hx.h && ed2.row === hx.row, [hx, ed2]);
  await ev(`(()=>{ const i = document.querySelector('#controls input.inl'); if(i) i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); return 1; })()`);
  await delay(200);
  await ev(`__t.length = 0; 1`);
  const hx2 = await ev(`(()=>{ const b = document.querySelector('#controls button.hex'); const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
  await click(hx2.x, hx2.y, 1);
  await delay(700);
  chk('single click still copies (after a short wait)', await ev(`__t.some(t=> /copied|clipboard/.test(t))`), await ev('__t'));
  await capture('t19-final');
  return out;
};
