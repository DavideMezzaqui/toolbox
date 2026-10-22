'use strict';
// Texture names (app/textures): the parse table for space / underscore / hyphen names, short map aliases, the preset
// "Save as" through a real dialog (never window.prompt), Delete through a confirm, rename + undo on a temp folder
// (created under TP_TMP, default <V>/w2-D4/tmp-textures; never a real user folder), table without clipped text,
// and the Studio embed contract (register / actions / Embed.prompt / Embed.confirm).
// The page runs in the "textures" mode iframe of the real Studio host (?embed=1): ev() runs in that nested frame and `parent`
// is the host. Dialogs (Save as / Delete), toasts, the header buttons and the status text live in the HOST document; the last
// section checks the standalone page, where the page shows them itself.
//   APP_ROOT=<copy> TAB=textures PORT=<port> node tests/stress/run-tab.cjs tests/stress/textures/t1.cjs
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ev, evaluate, command, until, delay, capture, reload}) => {
  const out = {ok: true, checks: {}, shots: []};
  const chk = (n, v, extra) => { out.checks[n] = extra === undefined ? !!v : {ok: !!v, v: extra}; if (!v) out.ok = false; };
  const shot = async name => { out.shots.push(await capture(name)); };
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const MODE = "frames.studio.contentWindow.Studio.modes.find(m=>m.id==='textures')";   // the host's record of the mode
  const EMBED = 'app://local/textures/index.html?embed=1', STANDALONE = 'app://local/textures/index.html';
  const HD = 'parent.document';      // where dialogs, toasts and the header buttons are when embedded
  // size(w, h) sizes the MODE frame (what the page sees); the window is that plus the Studio rail and the shell bar
  const chrome = () => evaluate(`(()=>{const b=${MODE}.frame.getBoundingClientRect();return {dx:innerWidth-b.width,dy:innerHeight-b.height,w:b.width}})()`);
  const size = async (w, h) => {
    for (let i = 0; i < 4; i++) {
      const c = await chrome();
      if (Math.round(c.w) === w && i > 0) break;
      await command('Emulation.setDeviceMetricsOverride', {width: Math.round(w + c.dx), height: Math.round(h + c.dy), deviceScaleFactor: 1, mobile: false});
      await delay(150);
    }
  };
  const hostBtn = id => `${HD}.querySelector('#actions [data-action=${id}]')`;
  const hostToast = () => ev(`(${HD}.querySelector('.kit-toast.on')||{}).textContent||''`);
  const TMP = path.resolve(process.env.TP_TMP || path.join(__dirname, '..', '..', '..', '..', 'tmp-textures'));
  fs.rmSync(TMP, {recursive: true, force: true}); fs.mkdirSync(TMP, {recursive: true});

  await ev(`localStorage.removeItem('tp-presets');localStorage.removeItem('tp-last-rename');localStorage.removeItem('textures.ui');1`);
  await reload();
  await size(1280, 800);

  const NAMES = [
    'Air Burst 1 Emissive Scattering 8x8.png', 'Air_Burst_1_Emissive_Scattering_8x8.png', 'Air-Burst-1-Emissive-Scattering-8x8.png',
    'Rock Wall Normal.png', 'Rock-Wall-Base Color.png', 'T_Fire_BaseColor_001.png', 'Smoke_d.png', 'Level A.png', 'Sand.png',
    'Rock Wall Normal - Copy.png', 'Air Burst 1 8x8.png', 'Smoke_Wall_E.png', 'Wall d Normal.png', 'Fire 8 x 8 Smoke.png',
    'Ground_Mark_Decal_3_Emissive.png', 'notes.txt'
  ];
  const fake = names => ev(`window.__real=window.__real||window.desktop;window.__promptCalled=0;window.prompt=()=>{window.__promptCalled++;return null};window.confirm=()=>{window.__promptCalled++;return false};parent.prompt=window.prompt;parent.confirm=window.confirm;
    window.desktop={pickFolder:async()=>'C:/fake/Texture Folder',listFiles:async()=>({error:'',files:${JSON.stringify(names)}}),renameMany:async()=>({error:'',done:[]}),openFolder:async()=>''};
    ${$('pick')}.click();1`);
  const rows = () => ev(`[...document.querySelectorAll('#rows tr')].map(tr=>({name:tr.children[1].textContent,chips:[...tr.querySelectorAll('.chip')].map(c=>c.textContent).join('|'),asset:tr.querySelector('.chips').title.replace('asset: ',''),
    to:tr.children[3].textContent,cls:tr.className}))`);
  const byName = list => Object.fromEntries(list.map(r => [r.name, r]));
  const setPreset = async n => { await ev(`(()=>{const s=${$('preset')};s.value=${JSON.stringify(n)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100); };

  // ---- 1. look
  const look = await ev(`(()=>{const cs=getComputedStyle(document.body);const bs=[...document.querySelectorAll('button.primary')].map(b=>getComputedStyle(b).backgroundColor);
    const blue=[...document.querySelectorAll('*')].some(e=>{const c=getComputedStyle(e);return /rgb\\((90, 169, 230|27, 58, 82)\\)/.test(c.borderTopColor+c.backgroundColor+c.color)});
    return {kit:document.body.classList.contains('kit'),bg:cs.backgroundColor,bs,blue,secs:[...document.querySelectorAll('.sec>.hd b')].map(b=>b.textContent),
      ids:['pick','rescan','openFolder','undo','apply','preset','presetSave','presetDel','pattern','sep','caseName','caseMap','pad','find','repl','filter','clCopy','clDup','clUntitled','onlyImages','skipUnknown','lowerExt','pickAll','rows','status','lbl_base_color'].filter(i=>!document.getElementById(i))}})()`);
  chk('kit page, white primary, no blue accent, 4 sections, old ids present', look.kit && look.bg === 'rgb(16, 16, 18)' && look.bs.every(c => c === 'rgb(230, 230, 232)') && !look.blue && look.secs.join() === 'Output name,Rename the asset,Clean up,Map names' && look.ids.length === 0, look);

  // ---- 2. parse table (fake folder)
  await fake(NAMES);
  await until(() => ev(`document.querySelectorAll('#rows tr').length===${NAMES.length}`), 'rows', 8000);
  await setPreset('T_Name_Map (underscores)');
  let R = byName(await rows());
  const exp = (n, chips, asset, label) => {
    const r = R[n]; const ok = r && r.chips === chips && r.asset === asset;
    chk('parse: ' + (label || n), ok, r);
  };
  exp('Air Burst 1 Emissive Scattering 8x8.png', 'Emissive + Scattering|8x8', 'Air Burst 1', 'space-separated EmberGen name');
  exp('Air_Burst_1_Emissive_Scattering_8x8.png', 'Emissive + Scattering|8x8', 'Air_Burst_1', 'underscore name');
  exp('Air-Burst-1-Emissive-Scattering-8x8.png', 'Emissive + Scattering|8x8', 'Air-Burst-1', 'hyphen name');
  exp('Rock Wall Normal.png', 'Normal', 'Rock Wall');
  exp('Rock-Wall-Base Color.png', 'BaseColor', 'Rock-Wall', 'mixed hyphen and space, two-word map');
  exp('T_Fire_BaseColor_001.png', 'BaseColor|#1', 'Fire', 'prefix, map and frame number');
  exp('Smoke_d.png', 'BaseColor', 'Smoke', 'single-letter alias d as last token');
  exp('Level A.png', 'Opacity', 'Level', 'single-letter alias a as last token');
  exp('Sand.png', 'no map type', 'Sand', 'a letter inside a word is not an alias');
  exp('Rock Wall Normal - Copy.png', 'Normal', 'Rock Wall', 'copy debris with spaces');
  exp('Air Burst 1 8x8.png', 'no map type|8x8', 'Air Burst 1', 'number before the grid belongs to the asset');
  exp('Smoke_Wall_E.png', 'Emissive', 'Smoke_Wall', 'alias e');
  exp('Wall d Normal.png', 'Normal', 'Wall d', 'a single letter in the middle is never taken ("nothing better")');
  exp('Fire 8 x 8 Smoke.png', 'Smoke|8x8', 'Fire', '"8 x 8" written with spaces is a grid');
  exp('Ground_Mark_Decal_3_Emissive.png', 'Emissive', 'Ground_Mark_Decal_3', 'Emissive is not Emissive + Scattering');
  chk('non-image is skipped', R['notes.txt'] && R['notes.txt'].cls === 'skip' && R['notes.txt'].to === '—');
  // the fire frame sequence: index shows when the pattern asks for it
  await setPreset('Frame sequence');
  R = byName(await rows());
  chk('frame index detected (#1) and used by {name}_{index}', R['T_Fire_BaseColor_001.png'] && R['T_Fire_BaseColor_001.png'].chips.includes('#1') && R['T_Fire_BaseColor_001.png'].to === 'fire_01.png', R['T_Fire_BaseColor_001.png']);
  await setPreset('EmberGen (spaces)');
  R = byName(await rows());
  chk('EmberGen preset on a spaced name', R['Air Burst 1 Emissive Scattering 8x8.png'].to === 'T_Air Burst 1_Emissive + Scattering_8x8.png', R['Air Burst 1 Emissive Scattering 8x8.png'].to);
  // Find text typed as shown in the list matches whatever separator the file used
  await ev(`(()=>{const f=${$('find')},r=${$('repl')};f.value='Air Burst 1';r.value='air_expl_2';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  R = byName(await rows());
  chk('Find "Air Burst 1" works on the space-separated file', /air.expl.2/.test(R['Air Burst 1 Emissive Scattering 8x8.png'].to), R['Air Burst 1 Emissive Scattering 8x8.png'].to);
  await ev(`${$('find')}.value='';${$('repl')}.value='';${$('find')}.dispatchEvent(new Event('input',{bubbles:true}))`);
  // collisions
  await fake(['Rock Wall Normal.png', 'Rock-Wall-Normal.png', 'Other_Normal.png']);
  await until(() => ev(`document.querySelectorAll('#rows tr').length===3`), 'rows 3', 5000);
  await setPreset('T_Name_Map (underscores)');
  const col = await ev(`({cls:[...document.querySelectorAll('#rows tr')].map(t=>t.className).join(),apply:${$('apply')}.disabled,st:${$('status')}.className})`);
  chk('two names landing on one target: conflict rows, Rename disabled', col.cls === ',conflict,conflict' && col.apply && col.st.includes('err'), col);

  // ---- 3. preset Save as / Delete through dialogs (shown by the Studio host, Embed.prompt / Embed.confirm), never window.prompt
  await fake(NAMES);
  await until(() => ev(`document.querySelectorAll('#rows tr').length===${NAMES.length}`), 'rows again', 8000);
  await setPreset('T_Name_Map (underscores)');
  await ev(`${$('pattern')}.value='X_{name}_{map}';${$('pattern')}.dispatchEvent(new Event('input',{bubbles:true}));${$('presetSave')}.click()`);
  await until(() => ev(`!!parent.document.querySelector('.kit-dlg .kit-prompt')`), 'save-as dialog', 4000);
  const dlg = await ev(`({title:parent.document.querySelector('.kit-dlg h3').textContent,val:parent.document.querySelector('.kit-prompt').value,focus:parent.document.activeElement===parent.document.querySelector('.kit-prompt')})`);
  chk('Save as opens a real dialog proposing the current preset name', dlg.title === 'Save these rules as' && dlg.val === 'T_Name_Map (underscores)' && dlg.focus, dlg);
  chk('the dialog is in the host document, none in the page', await ev(`!document.querySelector('.kit-dlg')`));
  await shot('textures-1280-prompt');
  await ev(`(()=>{const i=parent.document.querySelector('.kit-prompt');i.value='   ';parent.document.querySelector('.kit-dlg-btns button.primary').click()})()`);
  chk('empty name is refused inside the dialog', await ev(`!!parent.document.querySelector('.kit-dlg') && /name/i.test(parent.document.querySelector('.kit-prompt-err').textContent)`));
  await ev(`(()=>{const i=parent.document.querySelector('.kit-prompt');i.value='My preset';parent.document.querySelector('.kit-dlg-btns button.primary').click()})()`);
  await until(() => ev(`!parent.document.querySelector('.kit-dlg') || parent.document.querySelector('.kit-dlg-host').hidden`), 'dialog closed', 4000);
  await delay(100);
  const pre = await ev(`({opts:[...${$('preset')}.options].map(o=>o.value),cur:${$('preset')}.value,store:Object.keys(JSON.parse(localStorage.getItem('tp-presets'))),pat:JSON.parse(localStorage.getItem('tp-presets'))['My preset']?.pattern,pc:window.__promptCalled})`);
  chk('preset saved under the typed name, selected, stored in tp-presets, window.prompt untouched', pre.cur === 'My preset' && pre.store.includes('My preset') && pre.pat === 'X_{name}_{map}' && pre.pc === 0, pre);
  chk('the host toast says the preset was saved', /^Preset .My preset. saved\./.test(await hostToast()), await hostToast());
  // cancel
  await ev(`${$('presetSave')}.click()`);
  await until(() => ev(`!!parent.document.querySelector('.kit-dlg .kit-prompt')`), 'dialog 2', 4000);
  await ev(`(()=>{parent.document.querySelector('.kit-prompt').value='Nope';parent.document.querySelector('.kit-dlg-btns button:not(.primary)').click()})()`);
  await delay(150);
  chk('Cancel saves nothing', await ev(`!Object.keys(JSON.parse(localStorage.getItem('tp-presets'))).includes('Nope')`));
  // delete: cancel then confirm
  await ev(`${$('presetDel')}.click()`);
  await until(() => ev(`!!parent.document.querySelector('.kit-dlg')&&!parent.document.querySelector('.kit-dlg-host').hidden`), 'confirm', 4000);
  const cdlg = await ev(`({t:parent.document.querySelector('.kit-dlg h3').textContent,txt:parent.document.querySelector('.kit-dlg-body').textContent,danger:!!parent.document.querySelector('.kit-dlg-btns button.danger')})`);
  chk('Delete asks through a dialog naming the preset', /Delete preset/.test(cdlg.t) && /My preset/.test(cdlg.txt) && cdlg.danger, cdlg);
  await ev(`parent.document.querySelector('.kit-dlg-btns button:not(.danger)').click()`); await delay(150);
  chk('Cancel keeps the preset', await ev(`!!JSON.parse(localStorage.getItem('tp-presets'))['My preset']`));
  await ev(`${$('presetDel')}.click()`);
  await until(() => ev(`!!parent.document.querySelector('.kit-dlg')&&!parent.document.querySelector('.kit-dlg-host').hidden`), 'confirm 2', 4000);
  await ev(`parent.document.querySelector('.kit-dlg-btns button.danger').click()`); await delay(200);
  chk('Delete removes it and window.confirm is untouched', await ev(`!JSON.parse(localStorage.getItem('tp-presets'))['My preset'] && ![...${$('preset')}.options].some(o=>o.value==='My preset') && window.__promptCalled===0`));

  // ---- 4. no clipped text at 1280 (and 1920), screenshots
  await setPreset('EmberGen (spaces)');
  const clip = async () => ev(`(()=>{const bad=[];document.querySelectorAll('#rows td, #rows .chip, th, .rules label, .rules .check span, .tbar .fname, .status').forEach(e=>{const cs=getComputedStyle(e);
      if(cs.textOverflow==='ellipsis'||(e.scrollWidth>e.clientWidth+1&&cs.display!=='inline'&&cs.display!=='inline-block'&&!e.closest('.chips')))bad.push(e.tagName+':'+(e.textContent||'').slice(0,30)+' '+e.scrollWidth+'>'+e.clientWidth)});
    document.querySelectorAll('.rules .sec.open>.bd *').forEach(e=>{const b=e.closest('.bd').getBoundingClientRect(),r=e.getBoundingClientRect();if(r.width&&r.right>b.right+1)bad.push('outside section: '+e.tagName+':'+(e.textContent||'').slice(0,24))});
    const wrap=document.querySelector('.table-wrap'),asd=document.querySelector('aside.rules');return {bad:bad.slice(0,5),tableH:wrap.scrollWidth>wrap.clientWidth+1,asideH:asd.scrollWidth>asd.clientWidth+1,docH:document.documentElement.scrollWidth>innerWidth}})()`);
  await ev(`${$('filter')}.value='';1`);
  let cl = await clip();
  chk('table, panel and status never clip text at 1280', cl.bad.length === 0 && !cl.tableH && !cl.asideH && !cl.docH, cl);
  await shot('textures-1280');
  await ev(`document.querySelector('.rules .sec:last-of-type>.hd').click()`); await delay(100);
  await shot('textures-1280-maps-open');
  await ev(`document.querySelector('.rules .sec:last-of-type>.hd').click()`);
  await size(1920, 1080); await delay(250);
  cl = await clip();
  chk('...and at 1920', cl.bad.length === 0 && !cl.tableH && !cl.asideH && !cl.docH, cl);
  await shot('textures-1920');
  await size(1280, 800); await delay(200);
  // empty state look
  await reload();
  await size(1280, 800); await delay(300);
  await shot('textures-1280-empty');
  chk('sections open/closed remembered in textures.ui', await ev(`(()=>{const h=document.querySelector('.rules .sec:last-of-type>.hd');h.click();const a=JSON.parse(localStorage.getItem('textures.ui')||'{}');h.click();return a.open&&a.open.maps===true})()`));

  // ---- 5. real rename + undo on a temp folder, driven by the page buttons, then by the Studio header buttons and the toast Undo
  const files = ['Air Burst 1 Emissive Scattering 8x8.png', 'Rock Wall Normal.png', 'notes.txt'];
  const listTmp = () => fs.readdirSync(TMP).sort();
  // how: 'page' = the buttons of the page (its own header when standalone), 'host' = the Studio header buttons + the toast Undo
  const realFlow = async (label, how) => {
    fs.rmSync(TMP, {recursive: true, force: true}); fs.mkdirSync(TMP, {recursive: true});
    files.forEach(f => fs.writeFileSync(path.join(TMP, f), 'x'));
    await ev(`window.__real=window.__real||window.desktop;window.desktop=Object.assign({},window.__real,{pickFolder:async()=>${JSON.stringify(TMP)}});1`);
    const press = id => how === 'host' ? ev(`${hostBtn(id)}.click()`) : ev(`${$(id === 'open' ? 'openFolder' : id)}.click()`);
    await press('pick');
    await until(() => ev(`document.querySelectorAll('#rows tr').length===3`), label + ' scan', 8000);
    await setPreset('T_Name_Map (underscores)');
    const lab = await ev(`document.getElementById('apply').textContent`);
    chk(label + ': button says Rename 2 files', lab === 'Rename 2 files', lab);
    if (how === 'host') {
      chk(label + ': the Studio header button follows (Rename 2 files, enabled, primary)', await ev(`(()=>{const b=${hostBtn('apply')};return b.textContent.trim()==='Rename 2 files'&&!b.disabled&&b.classList.contains('primary')})()`));
      chk(label + ': rescan/open enabled in the header after choosing a folder', await ev(`!${hostBtn('rescan')}.disabled && !${hostBtn('open')}.disabled`));
      const st = await ev(`${HD}.getElementById('status').textContent`);
      chk(label + ': status in the Studio header', /^3 files, 2 to rename/.test(st), st);
    }
    await press('apply');
    await until(() => ev(`document.querySelectorAll('#rows tr').length===3 && /T_Rock_Wall_Normal/.test(document.getElementById('rows').textContent)`), label + ' renamed', 8000);
    await delay(200);
    chk(label + ': files renamed on disk', listTmp().includes('T_Rock_Wall_Normal.png') && !listTmp().includes('Rock Wall Normal.png') && listTmp().includes('notes.txt') && listTmp().length === 3, listTmp());
    chk(label + ': undo enabled and last rename stored', await ev(`!document.getElementById('undo').disabled && JSON.parse(localStorage.getItem('tp-last-rename')).ops.length===2`));
    if (how === 'host') {
      chk(label + ': the Studio Undo button is enabled', await ev(`!${hostBtn('undo')}.disabled`));
      const tt = await hostToast();
      chk(label + ': host toast "Renamed 2 files" carries an Undo button, none in the page', /^Renamed 2 files/.test(tt) && await ev(`!!${HD}.querySelector('.kit-toast.on button') && !document.querySelector('.kit-toast.on')`), tt);
      await ev(`${HD}.querySelector('.kit-toast.on button').click()`);     // the toast's own Undo
    } else await press('undo');
    await until(() => ev(`document.getElementById('undo').disabled`), label + ' undone', 8000);
    await delay(200);
    chk(label + ': undo restores the original names', JSON.stringify(listTmp()) === JSON.stringify(files.slice().sort()), listTmp());
    chk(label + ': tp-last-rename cleared', await ev(`localStorage.getItem('tp-last-rename')===null`));
    if (how === 'host') {
      const tt = await hostToast();
      chk(label + ': host toast "Restored 2 names", Studio Undo button disabled again', /^Restored 2 names/.test(tt) && await ev(`${hostBtn('undo')}.disabled`), tt);
    }
  };
  await realFlow('embedded (page buttons)', 'page');

  // ---- 6. the registration with the real host
  const emb = await ev(`(()=>{const M=parent.Studio.modes.find(m=>m.id==='textures'),r=M.spec,H=parent.document;
    return {realHost:parent!==window&&typeof parent.Studio.register==='function'&&typeof parent.Studio.trayItems==='function',state:M.state,active:parent.Studio.mode(),id:r.id,title:r.title,hostTitle:H.getElementById('title').textContent,
      actions:r.actions.map(a=>a.id+':'+a.label+(a.primary?'*':'')),hostBtns:[...H.querySelectorAll('#actions button')].map(b=>b.dataset.action+':'+b.textContent.trim()+(b.classList.contains('primary')?'*':'')).map(x=>x.startsWith('apply:')?'apply:Rename*':x),
      acc:r.accepts,groups:r.shortcuts.map(g=>g[0]),recv:typeof r.onReceive}})()`);
  chk('registers with the real host: id/title/actions/accepts/shortcuts', emb && emb.realHost && emb.state === 'ready' && emb.active === 'textures' && emb.id === 'textures' && emb.title === 'Texture names' && emb.hostTitle === 'Texture names'
    && emb.actions.join() === 'pick:Choose folder,rescan:Rescan,open:Open folder,undo:Undo last rename,apply:Rename*' && Array.isArray(emb.acc) && emb.acc.length === 0 && emb.groups.length === 1 && emb.recv === 'function', emb);
  chk('the host header shows the five buttons in order', emb.hostBtns.join() === 'pick:Choose folder,rescan:Rescan,open:Open folder,undo:Undo last rename,apply:Rename*', emb.hostBtns);
  chk('embedded: own header hidden', await ev(`document.body.classList.contains('embed') && getComputedStyle(document.getElementById('head')).display==='none'`));
  // a mode that accepts nothing: Studio.send refuses with a toast in the host
  const sent = await ev(`parent.Studio.send('textures',[new File(['x'],'a.png',{type:'image/png'})])`);
  chk('Studio.send refuses files (Texture prep takes none), toast in the host', sent === false && /Textures does not take this file/.test(await hostToast()), await hostToast());
  await ev(`window.__errs=[];addEventListener('error',e=>__errs.push(e.message));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));1`);
  await realFlow('embedded (Studio header)', 'host');
  // the Shortcuts popover of the host carries this mode's group
  await ev(`${HD}.getElementById('bKeys').click()`);
  const keys = await ev(`(${HD}.querySelector('.kit-keys')||{}).textContent||''`);
  chk('host Shortcuts popover merges Studio + the Folder group', /Switch mode/.test(keys) && /Choose a folder/.test(keys) && /Rename the files/.test(keys), keys.slice(0, 120));
  await ev(`parent.Kit.keys.close();1`);
  chk('window.prompt/confirm never used, no page errors', await ev(`!window.__promptCalled && __errs.length===0`), await ev('__errs'));
  await fake(NAMES);
  await until(() => ev(`document.querySelectorAll('#rows tr').length===${NAMES.length}`), 'rows embedded', 8000);
  await setPreset('EmberGen (spaces)');
  await shot('textures-1280-embedded');
  await size(1920, 1080); await delay(250);
  await shot('textures-1920-embedded');
  chk('Studio header fits at 1920 and 1280', await ev(`(()=>{const h=${HD}.getElementById('head');return h.scrollWidth<=h.clientWidth+1})()`));
  await size(1280, 800);
  chk('Studio header fits at 1280', await ev(`(()=>{const h=${HD}.getElementById('head');return h.scrollWidth<=h.clientWidth+1})()`));

  // ---- 7. the same page standalone (no ?embed): own header and buttons, never registers with the host, dialogs/toasts in the page
  await evaluate(`${MODE}.frame.src=${JSON.stringify(STANDALONE)};1`);
  await delay(600);
  await until(() => ev(`document.readyState==='complete' && !Embed.active && !!document.getElementById('rows') && !!window.desktop`), 'standalone textures', 15000);
  await delay(1800);       // the host waits 1.5 s for a registration, then treats the page as a plain one
  await ev(`window.__errs=[];addEventListener('error',e=>__errs.push(e.message));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));1`);
  const sa = await ev(`(()=>{const M=parent.Studio.modes.find(m=>m.id==='textures'),hd=document.getElementById('head');
    return {embed:Embed.active,bodyEmbed:document.body.classList.contains('embed'),head:getComputedStyle(hd).display,pick:document.getElementById('pick').offsetParent!==null,state:M.state,spec:!!M.spec,hostActions:parent.document.querySelectorAll('#actions button').length}})()`);
  chk('standalone: own header and buttons shown, page not registered with the host', sa.embed === false && sa.bodyEmbed === false && sa.head !== 'none' && sa.pick && sa.state === 'legacy' && sa.spec === false && sa.hostActions === 0, sa);
  await realFlow('standalone', 'page');
  chk('standalone: the toasts of the rename were the page own (none in the host)', await ev(`!${HD}.querySelector('.kit-toast.on')`));
  await fake(NAMES);
  await until(() => ev(`document.querySelectorAll('#rows tr').length===${NAMES.length}`), 'rows standalone', 8000);
  await ev(`${$('pattern')}.value='Y_{name}_{map}';${$('pattern')}.dispatchEvent(new Event('input',{bubbles:true}));${$('presetSave')}.click()`);
  await until(() => ev(`!!document.querySelector('.kit-dlg .kit-prompt')`), 'standalone save-as dialog', 4000);
  chk('standalone: Save as shows the page own dialog, none in the host', await ev(`!${HD}.querySelector('.kit-dlg .kit-prompt')`));
  await ev(`(()=>{const i=document.querySelector('.kit-prompt');i.value='Plain preset';document.querySelector('.kit-dlg-btns button.primary').click()})()`);
  await delay(250);
  chk('standalone: preset saved', await ev(`!!JSON.parse(localStorage.getItem('tp-presets'))['Plain preset'] && ${$('preset')}.value==='Plain preset' && window.__promptCalled===0 && __errs.length===0`), await ev('__errs'));
  await shot('textures-1280-standalone');

  // back to the embedded page and the usual state
  await evaluate(`${MODE}.frame.src=${JSON.stringify(EMBED)};1`);
  await delay(500);
  await until(() => ev('document.readyState==="complete" && Embed.active'), 'embedded again', 10000);
  await ev('window.qaErrors=[];addEventListener("error",e=>qaErrors.push(e.message));1');
  await command('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false});
  fs.rmSync(TMP, {recursive: true, force: true});
  return out;
};
